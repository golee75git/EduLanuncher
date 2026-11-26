#![cfg(windows)]

use std::collections::VecDeque;
use std::ffi::c_void;
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::slice;
use std::sync::Mutex;

use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::GetDriveTypeW;
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL};
use windows::Win32::UI::Shell::{
    ExtractIconExW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON};

const ICON_SIZE: i32 = 32;
const MAX_PNG: usize = 24 * 1024;
const MAX_ICO_FILE: u64 = 1024 * 1024;
const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;
const DRIVE_REMOTE: u32 = 4;
const SEARCH_ICON_CAP: usize = 96;

pub fn png_data_url(path: &Path) -> Option<String> {
    let rgba = rgba_from_path(path)?;
    png_url(&rgba)
}

/// 검색 줄 앞에 둘 그림. 폴더와 일반 파일은 확장자 그림만 한 번 만들고, 실행 파일·바로가기는 그 파일 그림이다.
/// 네트워크 경로와 1024자를 넘는 경로는 만들지 않는다. 그림은 이 프로세스 메모리에만 둔다.
pub fn search_png_data_url(path: &Path, folder: bool) -> Option<String> {
    if path.as_os_str().is_empty() || path.as_os_str().len() > 1024 || !fixed_or_removable(path) {
        return None;
    }
    let key = icon_memo_key(path, folder);
    if let Some(found) = memo_get(&key) {
        return found;
    }
    let made = if folder {
        type_png("folder", true)
    } else if own_icon(path) {
        png_data_url(path)
    } else {
        match path.extension().and_then(|ext| ext.to_str()) {
            Some(ext) => type_png(&ext.to_ascii_lowercase(), false),
            None => type_png("file", false),
        }
    };
    memo_put(key, made.clone());
    made
}

fn png_url(rgba: &[u8]) -> Option<String> {
    let png = encode_png(rgba)?;
    if png.len() > MAX_PNG {
        return None;
    }
    let mut url = String::from("data:image/png;base64,");
    url.push_str(&base64_encode(&png));
    Some(url)
}

fn own_icon(path: &Path) -> bool {
    let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "exe" | "lnk" | "ico" | "dll" | "scr" | "url")
}

fn icon_memo_key(path: &Path, folder: bool) -> String {
    if folder {
        return "dir".to_string();
    }
    if own_icon(path) {
        return format!("path:{}", path.to_string_lossy().to_ascii_lowercase());
    }
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if !ext.is_empty() => format!("ext:{}", ext.to_ascii_lowercase()),
        _ => "ext:file".to_string(),
    }
}

fn fixed_or_removable(path: &Path) -> bool {
    let text = path.to_string_lossy();
    if text.starts_with("\\\\") || text.contains('\0') {
        return false;
    }
    let bytes = text.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || (bytes[2] != b'\\' && bytes[2] != b'/')
    {
        return false;
    }
    let root: Vec<u16> = format!("{}:\\", (bytes[0] as char).to_ascii_uppercase())
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let kind = unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) };
    kind == DRIVE_FIXED || kind == DRIVE_REMOVABLE
}

fn type_png(token: &str, directory: bool) -> Option<String> {
    let token = token.trim().trim_matches('.');
    if token.is_empty()
        || token.len() > 16
        || !token.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return None;
    }
    let name = if directory {
        String::from("C:\\folder")
    } else {
        format!("C:\\file.{token}")
    };
    let rgba = rgba_from_shell(
        Path::new(&name),
        if directory { FILE_ATTRIBUTE_DIRECTORY } else { FILE_ATTRIBUTE_NORMAL },
        SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES,
    )?;
    png_url(&rgba)
}

struct IconMemo {
    rows: VecDeque<(String, Option<String>)>,
}

fn icon_memo() -> &'static Mutex<IconMemo> {
    static MEMO: std::sync::OnceLock<Mutex<IconMemo>> = std::sync::OnceLock::new();
    MEMO.get_or_init(|| Mutex::new(IconMemo { rows: VecDeque::new() }))
}

fn memo_lock() -> std::sync::MutexGuard<'static, IconMemo> {
    icon_memo().lock().unwrap_or_else(|err| err.into_inner())
}

fn memo_get(key: &str) -> Option<Option<String>> {
    memo_lock().rows.iter().find(|(saved, _)| saved == key).map(|(_, value)| value.clone())
}

fn memo_put(key: String, value: Option<String>) {
    let mut memo = memo_lock();
    if memo.rows.iter().any(|(saved, _)| saved == &key) {
        return;
    }
    if memo.rows.len() >= SEARCH_ICON_CAP {
        memo.rows.pop_front();
    }
    memo.rows.push_back((key, value));
}

/// `.url` 본문의 IconFile/IconIndex가 이 PC 안의 그림 파일일 때만 그 그림을 PNG로 만든다.
/// 주소(http)·네트워크 경로·상대 경로·환경변수 없는 이름은 받지 않는다.
pub fn png_data_url_from_shortcut(contents: &str) -> Option<String> {
    let (file, index) = icon_location(contents)?;
    let path = local_icon_path(&file)?;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut large = [HICON::default()];
    let icon = unsafe {
        let got = ExtractIconExW(PCWSTR(wide.as_ptr()), index, Some(large.as_mut_ptr()), None, 1);
        if got == 0 || large[0].is_invalid() {
            return None;
        }
        large[0]
    };
    let pixels = unsafe { rgba_from_hicon(icon) };
    unsafe {
        let _ = DestroyIcon(icon);
    }
    let png = encode_png(&pixels?)?;
    if png.len() > MAX_PNG {
        return None;
    }
    let mut url = String::from("data:image/png;base64,");
    url.push_str(&base64_encode(&png));
    Some(url)
}

fn icon_location(contents: &str) -> Option<(String, i32)> {
    let mut file: Option<String> = None;
    let mut index = 0_i32;
    for line in contents.lines() {
        let line = line.trim();
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("IconFile") && file.is_none() {
            let value = value.trim().trim_matches('"').trim();
            if !value.is_empty() && value.len() <= 1024 {
                file = Some(value.to_string());
            }
        } else if key.trim().eq_ignore_ascii_case("IconIndex") {
            index = value.trim().parse::<i32>().unwrap_or(0);
        }
    }
    file.map(|value| (value, index))
}

fn expand_percent_vars(value: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find('%')?;
        let name = &after[..end];
        if name.is_empty() {
            return None;
        }
        out.push_str(&std::env::var(name).ok()?);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    (out.len() <= 1024 && !out.contains('\0')).then_some(out)
}

fn local_icon_path(raw: &str) -> Option<std::path::PathBuf> {
    let expanded = expand_percent_vars(raw)?;
    let bytes = expanded.as_bytes();
    if bytes.len() < 4
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || (bytes[2] != b'\\' && bytes[2] != b'/')
    {
        return None;
    }
    let path = std::path::PathBuf::from(&expanded);
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(ext.as_str(), "ico" | "exe" | "dll") {
        return None;
    }
    let root: Vec<u16> = format!("{}:\\", &expanded[..1])
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    if unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) } == DRIVE_REMOTE {
        return None;
    }
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() || (ext == "ico" && meta.len() > MAX_ICO_FILE) {
        return None;
    }
    Some(path)
}

fn rgba_from_path(path: &Path) -> Option<Vec<u8>> {
    rgba_from_shell(path, FILE_ATTRIBUTE_NORMAL, SHGFI_ICON | SHGFI_LARGEICON)
}

fn rgba_from_shell(
    path: &Path,
    attributes: windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES,
    flags: windows::Win32::UI::Shell::SHGFI_FLAGS,
) -> Option<Vec<u8>> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut info = SHFILEINFOW::default();
    unsafe {
        let result = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            attributes,
            Some(&mut info),
            size_of::<SHFILEINFOW>() as u32,
            flags,
        );
        if result == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let pixels = rgba_from_hicon(info.hIcon);
        let _ = DestroyIcon(info.hIcon);
        pixels
    }
}

unsafe fn rgba_from_hicon(icon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Option<Vec<u8>> {
    let hdc_screen = GetDC(None);
    if hdc_screen.is_invalid() {
        return None;
    }
    let hdc = CreateCompatibleDC(Some(hdc_screen));
    if hdc.is_invalid() {
        ReleaseDC(None, hdc_screen);
        return None;
    }

    let mut bits: *mut c_void = std::ptr::null_mut();
    let bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: ICON_SIZE,
            biHeight: -ICON_SIZE,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let dib = match CreateDIBSection(Some(hdc), &bitmap_info, DIB_RGB_COLORS, &mut bits, None, 0) {
        Ok(handle) if !handle.is_invalid() && !bits.is_null() => handle,
        _ => {
            let _ = DeleteDC(hdc);
            ReleaseDC(None, hdc_screen);
            return None;
        }
    };

    let previous = SelectObject(hdc, HGDIOBJ(dib.0));
    let drawn = DrawIconEx(
        hdc,
        0,
        0,
        icon,
        ICON_SIZE,
        ICON_SIZE,
        0,
        None,
        DI_NORMAL,
    );
    let rgba = if drawn.is_ok() {
        let bgra = slice::from_raw_parts(bits as *const u8, (ICON_SIZE * ICON_SIZE * 4) as usize);
        let mut rgba = Vec::with_capacity(bgra.len());
        let mut opaque = true;
        for pixel in bgra.chunks_exact(4) {
            rgba.push(pixel[2]);
            rgba.push(pixel[1]);
            rgba.push(pixel[0]);
            rgba.push(pixel[3]);
            if pixel[3] != 0 {
                opaque = false;
            }
        }
        if opaque {
            for alpha in rgba.iter_mut().skip(3).step_by(4) {
                *alpha = 255;
            }
        }
        Some(rgba)
    } else {
        None
    };
    SelectObject(hdc, previous);
    let _ = DeleteObject(HGDIOBJ(dib.0));
    let _ = DeleteDC(hdc);
    ReleaseDC(None, hdc_screen);
    rgba
}

fn encode_png(rgba: &[u8]) -> Option<Vec<u8>> {
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, ICON_SIZE as u32, ICON_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
        writer.finish().ok()?;
    }
    Some(png)
}

pub(crate) fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let a = u32::from(chunk[0]);
        let b = if chunk.len() > 1 { u32::from(chunk[1]) } else { 0 };
        let c = if chunk.len() > 2 { u32::from(chunk[2]) } else { 0 };
        let triple = (a << 16) | (b << 8) | c;
        out.push(TABLE[((triple >> 18) & 63) as usize] as char);
        out.push(TABLE[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_icon_key_groups_pdf_and_keeps_programs() {
        assert_eq!(icon_memo_key(Path::new(r"C:\Users\a\Desktop\a.pdf"), false), "ext:pdf");
        assert_eq!(icon_memo_key(Path::new(r"D:\b\c.PDF"), false), "ext:pdf");
        assert_eq!(icon_memo_key(Path::new(r"C:\Users\a\Docs"), true), "dir");
        assert!(icon_memo_key(Path::new(r"C:\Apps\Note.exe"), false).starts_with("path:"));
        assert_eq!(icon_memo_key(Path::new(r"C:\Apps\readme"), false), "ext:file");
    }

    #[test]
    fn remote_or_short_path_has_no_search_icon() {
        assert!(search_png_data_url(Path::new(r"\\server\share\a.pdf"), false).is_none());
        assert!(search_png_data_url(Path::new("a.pdf"), false).is_none());
        assert!(search_png_data_url(Path::new(""), true).is_none());
    }

    #[test]
    fn local_type_and_program_icons_are_png() {
        let pdf = search_png_data_url(Path::new(r"C:\Users\Public\missing-edulauncher-icon.pdf"), false)
            .expect("pdf type icon");
        assert!(pdf.starts_with("data:image/png;base64,"));
        let folder = search_png_data_url(Path::new(r"C:\Users\Public"), true).expect("folder icon");
        assert!(folder.starts_with("data:image/png;base64,"));
        let note = Path::new(r"C:\Windows\System32\notepad.exe");
        if note.is_file() {
            let program = search_png_data_url(note, false).expect("program icon");
            assert!(program.starts_with("data:image/png;base64,"));
            assert_ne!(program, pdf);
            assert_eq!(search_png_data_url(note, false), Some(program));
        }
    }
}
