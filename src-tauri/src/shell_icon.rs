#![cfg(windows)]

use std::ffi::c_void;
use std::mem::size_of;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::slice;

use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
use windows::Win32::Storage::FileSystem::GetDriveTypeW;
use windows::Win32::UI::Shell::{
    ExtractIconExW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON};

const ICON_SIZE: i32 = 32;
const MAX_PNG: usize = 24 * 1024;
const MAX_ICO_FILE: u64 = 1024 * 1024;
const DRIVE_REMOTE: u32 = 4;

pub fn png_data_url(path: &Path) -> Option<String> {
    let rgba = rgba_from_path(path)?;
    let png = encode_png(&rgba)?;
    if png.len() > MAX_PNG {
        return None;
    }
    let mut url = String::from("data:image/png;base64,");
    url.push_str(&base64_encode(&png));
    Some(url)
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
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut info = SHFILEINFOW::default();
    unsafe {
        let result = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
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
