#![cfg(windows)]

use std::cell::RefCell;
use std::ffi::c_void;

use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{implement, BOOL, Result as WinResult};
use windows::Win32::Foundation::{HWND, LPARAM, POINTL};
use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
use windows::Win32::System::Ole::{
    OleInitialize, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop, CF_HDROP, CF_UNICODETEXT,
    DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE, IDropTarget, IDropTarget_Impl,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum LauncherDrop {
    #[serde(rename = "paths")]
    Paths { paths: Vec<String> },
    #[serde(rename = "url")]
    Url { url: String, name: Option<String> },
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
            *pdwEffect = DROPEFFECT_COPY;
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
            *pdwEffect = DROPEFFECT_COPY;
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
            *pdwEffect = DROPEFFECT_COPY;
        }
        let _ = self.app.emit("launcher-drop-hover", false);
        if let Some(data) = pDataObj.as_ref() {
            if let Some(payload) = read_drop(data) {
                let _ = self.app.emit("launcher-drop", payload);
            }
        }
        let _ = DROPEFFECT_NONE;
        Ok(())
    }
}

fn read_drop(data: &IDataObject) -> Option<LauncherDrop> {
    let paths = read_hdrop(data);
    if !paths.is_empty() {
        return Some(LauncherDrop::Paths { paths });
    }
    let text = read_unicode_text(data)?;
    let url = first_http_url(&text)?;
    Some(LauncherDrop::Url { url, name: None })
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
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(800));
        let handle = app.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Some(window) = app.get_webview_window("main") {
                let _ = install(&window, &app);
            }
        });
    });
}
