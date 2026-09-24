#![cfg(windows)]

use std::cell::RefCell;
use std::ffi::c_void;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{implement, w, BOOL, Result as WinResult};
use windows::Win32::Foundation::{HWND, LPARAM, POINTL};
use windows::Win32::System::Com::{
    IDataObject, DATADIR_GET, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL, TYMED_ISTREAM,
};
use windows::Win32::System::DataExchange::{GetClipboardFormatNameW, RegisterClipboardFormatW};
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::{
    OleInitialize, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop, CF_HDROP, CF_TEXT,
    CF_UNICODETEXT, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_NONE, IDropTarget,
    IDropTarget_Impl,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    DragQueryFileW, ILCombine, ILFree, SHGetPathFromIDListW, HDROP,
};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum LauncherDrop {
    #[serde(rename = "paths")]
    Paths { paths: Vec<String> },
    #[serde(rename = "unreadable")]
    Unreadable { formats: Vec<String> },
    #[serde(rename = "url")]
    Url {
        url: String,
        name: Option<String>,
        #[serde(rename = "iconImage", skip_serializing_if = "Option::is_none")]
        icon_image: Option<String>,
    },
}

thread_local! {
    static TARGETS: RefCell<Vec<IDropTarget>> = const { RefCell::new(Vec::new()) };
}

#[implement(IDropTarget)]
struct LauncherDropTarget {
    app: AppHandle,
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for LauncherDropTarget_Impl {
    fn DragEnter(
        &self,
        _pDataObj: windows_core::Ref<'_, IDataObject>,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdwEffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        unsafe {
            *pdwEffect = accepted_effect(*pdwEffect);
        }
        let _ = self.app.emit("launcher-drop-hover", true);
        Ok(())
    }

    fn DragOver(
        &self,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdwEffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        unsafe {
            *pdwEffect = accepted_effect(*pdwEffect);
        }
        let _ = self.app.emit("launcher-drop-hover", true);
        Ok(())
    }

    fn DragLeave(&self) -> WinResult<()> {
        let _ = self.app.emit("launcher-drop-hover", false);
        Ok(())
    }

    fn Drop(
        &self,
        pDataObj: windows_core::Ref<'_, IDataObject>,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdwEffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        unsafe {
            *pdwEffect = accepted_effect(*pdwEffect);
        }
        let _ = self.app.emit("launcher-drop-hover", false);
        if let Some(data) = pDataObj.as_ref() {
            let payload = read_drop(data).unwrap_or_else(|| LauncherDrop::Unreadable {
                formats: format_names(data),
            });
            let _ = self.app.emit("launcher-drop", payload);
        }
        Ok(())
    }
}

/// 끌어 온 쪽이 허용한 동작 안에서만 고른다. 복사를 먼저, 없으면 링크. 이동은 원본을 지울 수
/// 있어 받지 않는다.
fn accepted_effect(allowed: DROPEFFECT) -> DROPEFFECT {
    if allowed.0 & DROPEFFECT_COPY.0 != 0 {
        DROPEFFECT_COPY
    } else if allowed.0 & DROPEFFECT_LINK.0 != 0 {
        DROPEFFECT_LINK
    } else {
        DROPEFFECT_NONE
    }
}

fn read_drop(data: &IDataObject) -> Option<LauncherDrop> {
    let paths = read_hdrop(data);
    if !paths.is_empty() {
        return Some(LauncherDrop::Paths { paths });
    }
    let paths = read_shell_id_list_paths(data);
    if !paths.is_empty() {
        return Some(LauncherDrop::Paths { paths });
    }
    if let Some((name, url, icon_image)) = read_virtual_url_shortcut(data) {
        return Some(LauncherDrop::Url {
            url,
            name: Some(name),
            icon_image,
        });
    }
    if let Some(url) = read_inet_url(data) {
        let name = read_virtual_file_name(data)
            .filter(|file| crate::is_url_shortcut_file(std::path::Path::new(file)))
            .map(|file| crate::shortcut_display_name(std::path::Path::new(&file), &url));
        return Some(LauncherDrop::Url {
            url,
            name,
            icon_image: None,
        });
    }
    let text = read_unicode_text(data).or_else(|| read_ansi_text(data))?;
    let url = first_http_url(&text)?;
    Some(LauncherDrop::Url {
        url,
        name: None,
        icon_image: None,
    })
}

const MAX_TEXT_UNITS: usize = 4096;
const MAX_ID_LIST_ITEMS: u32 = 16;

fn registered_format(name: windows::core::PCWSTR) -> u16 {
    unsafe { RegisterClipboardFormatW(name) as u16 }
}

/// 끌어 온 자료가 가진 형식 이름(안내용). 내용은 읽지 않는다.
fn format_names(data: &IDataObject) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    unsafe {
        let Ok(list) = data.EnumFormatEtc(DATADIR_GET.0 as u32) else {
            return names;
        };
        let mut item = [FORMATETC::default()];
        for _ in 0..64 {
            let mut fetched = 0u32;
            // 끝나면 S_FALSE(성공 값)를 돌려주므로 가져온 개수로 멈춘다.
            let status = list.Next(&mut item, Some(&mut fetched));
            if status.is_err() || fetched == 0 || names.len() >= 24 {
                break;
            }
            let format = item[0].cfFormat;
            if format == 0 {
                break;
            }
            let mut buf = [0u16; 80];
            let len = GetClipboardFormatNameW(format as u32, &mut buf);
            let name = if len > 0 {
                String::from_utf16_lossy(&buf[..len as usize])
            } else {
                match format {
                    1 => "CF_TEXT".into(),
                    13 => "CF_UNICODETEXT".into(),
                    15 => "CF_HDROP".into(),
                    other => format!("cf{other}"),
                }
            };
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names
}

fn read_hglobal_text(data: &IDataObject, format: u16, wide: bool) -> Option<String> {
    unsafe {
        let request = FORMATETC {
            cfFormat: format,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };
        let mut medium = data.GetData(&request).ok()?;
        let handle = medium.u.hGlobal;
        let size = GlobalSize(handle);
        let locked = GlobalLock(handle);
        let text = if locked.is_null() {
            None
        } else if wide {
            let units = std::slice::from_raw_parts(locked as *const u16, size / 2);
            let units: Vec<u16> = units
                .iter()
                .copied()
                .take(MAX_TEXT_UNITS)
                .take_while(|unit| *unit != 0)
                .collect();
            Some(String::from_utf16_lossy(&units))
        } else {
            let bytes = std::slice::from_raw_parts(locked as *const u8, size);
            let bytes: Vec<u8> = bytes
                .iter()
                .copied()
                .take(MAX_TEXT_UNITS)
                .take_while(|byte| *byte != 0)
                .collect();
            Some(String::from_utf8_lossy(&bytes).into_owned())
        };
        let _ = GlobalUnlock(handle);
        ReleaseStgMedium(&mut medium);
        text.filter(|value| !value.trim().is_empty())
    }
}

/// 브라우저·탐색기가 주소를 따로 실어 주는 형식(UniformResourceLocator).
fn read_inet_url(data: &IDataObject) -> Option<String> {
    let wide = read_hglobal_text(data, registered_format(w!("UniformResourceLocatorW")), true);
    let text = wide.or_else(|| {
        read_hglobal_text(data, registered_format(w!("UniformResourceLocator")), false)
    })?;
    first_http_url(&text)
}

fn read_ansi_text(data: &IDataObject) -> Option<String> {
    read_hglobal_text(data, CF_TEXT.0, false)
}

/// PIDL 목록 안에서 `offset`부터 끝 표식까지 자료 범위를 벗어나지 않는지 확인한다.
fn id_list_in_bounds(bytes: &[u8], offset: usize) -> bool {
    let mut at = offset;
    for _ in 0..64 {
        if at + 2 > bytes.len() {
            return false;
        }
        let size = u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize;
        if size == 0 {
            return true;
        }
        if size < 2 || at + size > bytes.len() {
            return false;
        }
        at += size;
    }
    false
}

/// 탐색기식 끌기(Shell IDList Array)에서 실제 파일 경로를 뽑는다. 즐겨찾기 항목은 파일이라
/// 경로가 나오고, 그 뒤는 `.url` 끌어넣기와 같은 길을 탄다.
fn read_shell_id_list_paths(data: &IDataObject) -> Vec<String> {
    let mut paths = Vec::new();
    unsafe {
        let request = FORMATETC {
            cfFormat: registered_format(w!("Shell IDList Array")),
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };
        let Ok(mut medium) = data.GetData(&request) else {
            return paths;
        };
        let handle = medium.u.hGlobal;
        let size = GlobalSize(handle);
        let locked = GlobalLock(handle);
        if !locked.is_null() && size >= 8 {
            let bytes = std::slice::from_raw_parts(locked as *const u8, size);
            let count = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            let offset_at = |index: usize| -> Option<usize> {
                let at = 4 + index * 4;
                let raw = bytes.get(at..at + 4)?;
                Some(u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize)
            };
            if count >= 1 && count <= MAX_ID_LIST_ITEMS {
                if let Some(parent) = offset_at(0).filter(|at| id_list_in_bounds(bytes, *at)) {
                    for index in 0..count as usize {
                        let Some(child) =
                            offset_at(index + 1).filter(|at| id_list_in_bounds(bytes, *at))
                        else {
                            continue;
                        };
                        let full = ILCombine(
                            Some(bytes.as_ptr().add(parent) as *const ITEMIDLIST),
                            Some(bytes.as_ptr().add(child) as *const ITEMIDLIST),
                        );
                        if full.is_null() {
                            continue;
                        }
                        let mut buf = [0u16; 260];
                        if SHGetPathFromIDListW(full, &mut buf).as_bool() {
                            let len = buf.iter().position(|unit| *unit == 0).unwrap_or(buf.len());
                            let path = String::from_utf16_lossy(&buf[..len]);
                            if !path.is_empty() {
                                paths.push(path);
                            }
                        }
                        ILFree(Some(full as *const ITEMIDLIST));
                    }
                }
            }
        }
        let _ = GlobalUnlock(handle);
        ReleaseStgMedium(&mut medium);
    }
    paths
}

const MAX_URL_FILE: usize = 16 * 1024;
const FILE_DESCRIPTOR_SIZE: usize = 592;
const FILE_NAME_OFFSET: usize = 4 + 72;

/// 경로 없이 넘어오는 가상 파일(.url)의 이름과 본문을 읽는다. 파일로 저장하지 않는다.
fn read_virtual_url_shortcut(data: &IDataObject) -> Option<(String, String, Option<String>)> {
    let file_name = read_virtual_file_name(data)?;
    if !crate::is_url_shortcut_file(std::path::Path::new(&file_name)) {
        return None;
    }
    let bytes = read_virtual_file_bytes(data)?;
    let contents = crate::decode_shortcut_bytes(&bytes);
    let url = crate::parse_url_from_shortcut(&contents)?;
    let name = crate::shortcut_display_name(std::path::Path::new(&file_name), &url);
    Some((name, url, crate::shortcut_body_icon(&contents)))
}

fn read_virtual_file_name(data: &IDataObject) -> Option<String> {
    unsafe {
        let format = FORMATETC {
            cfFormat: RegisterClipboardFormatW(w!("FileGroupDescriptorW")) as u16,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };
        let mut medium = data.GetData(&format).ok()?;
        let handle = medium.u.hGlobal;
        let size = GlobalSize(handle);
        let locked = GlobalLock(handle);
        let name = if locked.is_null() || size < 4 + FILE_DESCRIPTOR_SIZE {
            None
        } else {
            let bytes = std::slice::from_raw_parts(locked as *const u8, size);
            let count = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            let raw = &bytes[FILE_NAME_OFFSET..FILE_NAME_OFFSET + 520];
            let units: Vec<u16> = raw
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .take_while(|unit| *unit != 0)
                .collect();
            (count >= 1 && !units.is_empty()).then(|| String::from_utf16_lossy(&units))
        };
        let _ = GlobalUnlock(handle);
        ReleaseStgMedium(&mut medium);
        name
    }
}

fn read_virtual_file_bytes(data: &IDataObject) -> Option<Vec<u8>> {
    unsafe {
        let format = FORMATETC {
            cfFormat: RegisterClipboardFormatW(w!("FileContents")) as u16,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: 0,
            tymed: (TYMED_HGLOBAL.0 | TYMED_ISTREAM.0) as u32,
        };
        let mut medium = data.GetData(&format).ok()?;
        let mut out: Vec<u8> = Vec::new();
        if medium.tymed == TYMED_ISTREAM.0 as u32 {
            if let Some(stream) = (*medium.u.pstm).as_ref() {
                let mut chunk = [0u8; 2048];
                while out.len() <= MAX_URL_FILE {
                    let mut got = 0u32;
                    let status = stream.Read(
                        chunk.as_mut_ptr() as *mut c_void,
                        chunk.len() as u32,
                        Some(&mut got),
                    );
                    if status.is_err() || got == 0 {
                        break;
                    }
                    out.extend_from_slice(&chunk[..got as usize]);
                }
            }
        } else if medium.tymed == TYMED_HGLOBAL.0 as u32 {
            let handle = medium.u.hGlobal;
            let size = GlobalSize(handle).min(MAX_URL_FILE + 1);
            let locked = GlobalLock(handle);
            if !locked.is_null() {
                out.extend_from_slice(std::slice::from_raw_parts(locked as *const u8, size));
            }
            let _ = GlobalUnlock(handle);
        }
        ReleaseStgMedium(&mut medium);
        (!out.is_empty() && out.len() <= MAX_URL_FILE).then_some(out)
    }
}

fn first_http_url(text: &str) -> Option<String> {
    for line in text.lines() {
        let candidate = line.trim().split_whitespace().next().unwrap_or("");
        if candidate.starts_with("http://") || candidate.starts_with("https://") {
            return Some(candidate.to_string());
        }
    }
    None
}

fn read_hdrop(data: &IDataObject) -> Vec<String> {
    unsafe {
        let format = FORMATETC {
            cfFormat: CF_HDROP.0,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };
        let Ok(mut medium) = data.GetData(&format) else {
            return Vec::new();
        };
        let handle = HDROP(medium.u.hGlobal.0 as _);
        let count = DragQueryFileW(handle, 0xFFFF_FFFF, None);
        let mut paths = Vec::new();
        for index in 0..count {
            let needed = DragQueryFileW(handle, index, None) as usize;
            if needed == 0 {
                continue;
            }
            let mut buf = vec![0u16; needed + 1];
            let len = DragQueryFileW(handle, index, Some(&mut buf));
            if len == 0 {
                continue;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            if !path.is_empty() {
                paths.push(path);
            }
        }
        ReleaseStgMedium(&mut medium);
        paths
    }
}

fn read_unicode_text(data: &IDataObject) -> Option<String> {
    unsafe {
        let format = FORMATETC {
            cfFormat: CF_UNICODETEXT.0,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };
        let mut medium = data.GetData(&format).ok()?;
        let locked = GlobalLock(medium.u.hGlobal);
        let text = if locked.is_null() {
            None
        } else {
            let mut len = 0;
            let ptr = locked as *const u16;
            while *ptr.add(len) != 0 && len < 4096 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr, len);
            Some(String::from_utf16_lossy(slice))
        };
        let _ = GlobalUnlock(medium.u.hGlobal);
        ReleaseStgMedium(&mut medium);
        text.filter(|value| !value.trim().is_empty())
    }
}

fn hwnd_from_window(window: &WebviewWindow) -> Option<HWND> {
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::Win32(win) => Some(HWND(win.hwnd.get() as *mut c_void)),
        _ => None,
    }
}

fn inject(hwnd: HWND, app: &AppHandle, targets: &mut Vec<IDropTarget>) {
    let target: IDropTarget = LauncherDropTarget { app: app.clone() }.into();
    unsafe {
        let _ = RevokeDragDrop(hwnd);
        if RegisterDragDrop(hwnd, &target).is_ok() {
            targets.push(target);
        }
    }
}

pub fn install(window: &WebviewWindow, app: &AppHandle) -> Result<(), String> {
    unsafe {
        let _ = OleInitialize(None);
    }
    let hwnd = hwnd_from_window(window).ok_or("창 핸들을 찾지 못했습니다.")?;
    let mut targets = Vec::new();
    inject(hwnd, app, &mut targets);
    unsafe {
        let mut callback = |child| {
            inject(child, app, &mut targets);
            true
        };
        let mut trait_obj: &mut dyn FnMut(HWND) -> bool = &mut callback;
        let lparam = LPARAM(std::ptr::addr_of_mut!(trait_obj) as isize);
        unsafe extern "system" fn enumerate_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let closure = &mut *(lparam.0 as *mut &mut dyn FnMut(HWND) -> bool);
            closure(hwnd).into()
        }
        let _ = EnumChildWindows(Some(hwnd), Some(enumerate_callback), lparam);
    }
    TARGETS.with(|held| held.borrow_mut().extend(targets));
    Ok(())
}

pub fn install_later(app: AppHandle) {
    for delay_ms in [800_u64, 2500, 6000] {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            let handle = app.clone();
            let _ = handle.run_on_main_thread(move || {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = install(&window, &app);
                }
            });
        });
    }
}
