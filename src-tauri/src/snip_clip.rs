//! 화면 캡처를 누른 뒤에만 클립보드의 그림을 한 번 읽는다.
//! 그림 바이트는 이 모듈 밖으로 경로와 함께 나가지 않는다.

#![cfg(windows)]

use std::sync::atomic::{AtomicU64, Ordering};

static TICKET: AtomicU64 = AtomicU64::new(0);

const MAX_PNG: usize = 8 * 1024 * 1024;
const MAX_SIDE: u32 = 8_000;

pub fn next_ticket() -> u64 {
    TICKET.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn ticket_is(ticket: u64) -> bool {
    TICKET.load(Ordering::SeqCst) == ticket
}

pub fn clipboard_sequence() -> u32 {
    unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

/// PNG 바이트. 없거나 너무 크면 None.
pub fn clipboard_png() -> Option<Vec<u8>> {
    let raw = copy_image()?;
    if is_png(&raw) {
        return (raw.len() <= MAX_PNG).then_some(raw);
    }
    dib_to_png(&raw).ok()
}

pub fn is_png(bytes: &[u8]) -> bool {
    bytes.len() >= 24 && bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10])
}

pub fn dib_to_png(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    if bytes.len() < 40 {
        return Err("그림이 아닙니다.");
    }
    let header = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
    if header < 40 || header > bytes.len() {
        return Err("그림이 아닙니다.");
    }
    let width = i32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let height_raw = i32::from_le_bytes(bytes[8..12].try_into().unwrap());
    let planes = u16::from_le_bytes(bytes[12..14].try_into().unwrap());
    let bits = u16::from_le_bytes(bytes[14..16].try_into().unwrap());
    let compression = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    if width <= 0 || planes != 1 || compression != 0 || (bits != 24 && bits != 32) {
        return Err("그림이 아닙니다.");
    }
    let top_down = height_raw < 0;
    let height = height_raw.unsigned_abs();
    let width_u = width as u32;
    if width_u > MAX_SIDE || height > MAX_SIDE {
        return Err("그림이 너무 큽니다.");
    }
    let stride = ((width_u as usize * bits as usize + 31) / 32) * 4;
    let pixels = header;
    let need = pixels.saturating_add(stride.saturating_mul(height as usize));
    if need > bytes.len() || need > 24 * 1024 * 1024 {
        return Err("그림이 너무 큽니다.");
    }
    let mut rgba = vec![255u8; width_u as usize * height as usize * 4];
    for y in 0..height as usize {
        let src_y = if top_down { y } else { height as usize - 1 - y };
        let row = pixels + src_y * stride;
        for x in 0..width_u as usize {
            let src = row + x * (bits as usize / 8);
            let dst = (y * width_u as usize + x) * 4;
            rgba[dst] = bytes[src + 2];
            rgba[dst + 1] = bytes[src + 1];
            rgba[dst + 2] = bytes[src];
            if bits == 32 {
                rgba[dst + 3] = bytes[src + 3];
            }
        }
    }
    encode_png(width_u, height, &rgba)
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, &'static str> {
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|_| "그림을 만들지 못했습니다.")?;
    writer.write_image_data(rgba).map_err(|_| "그림을 만들지 못했습니다.")?;
    writer.finish().map_err(|_| "그림을 만들지 못했습니다.")?;
    if png.len() > MAX_PNG {
        return Err("그림이 너무 큽니다.");
    }
    Ok(png)
}

fn copy_image() -> Option<Vec<u8>> {
    use windows::Win32::System::DataExchange::{
        CloseClipboard, OpenClipboard, RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::core::w;

    unsafe {
        OpenClipboard(None).ok()?;
        let png_format = RegisterClipboardFormatW(w!("PNG"));
        let format = if png_format != 0 && format_ready(png_format) {
            png_format
        } else {
            8
        };
        let copied = read_handle(format, GlobalLock, GlobalSize, GlobalUnlock);
        let _ = CloseClipboard();
        copied
    }
}

fn format_ready(format: u32) -> bool {
    use windows::Win32::System::DataExchange::IsClipboardFormatAvailable;
    unsafe { IsClipboardFormatAvailable(format).is_ok() }
}

fn read_handle(
    format: u32,
    lock: unsafe fn(windows::Win32::Foundation::HGLOBAL) -> *mut std::ffi::c_void,
    size_of: unsafe fn(windows::Win32::Foundation::HGLOBAL) -> usize,
    unlock: unsafe fn(windows::Win32::Foundation::HGLOBAL) -> windows::core::Result<()>,
) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::GetClipboardData;
    unsafe {
        let handle = GetClipboardData(format).ok()?;
        let global = HGLOBAL(handle.0);
        let ptr = lock(global);
        if ptr.is_null() {
            return None;
        }
        let size = size_of(global);
        let bytes = if size == 0 || size > 24 * 1024 * 1024 {
            None
        } else {
            Some(std::slice::from_raw_parts(ptr as *const u8, size).to_vec())
        };
        let _ = unlock(global);
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_pixel_dib_becomes_png() {
        let mut dib = vec![0u8; 44];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&1i32.to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&32u16.to_le_bytes());
        dib[40] = 1;
        dib[41] = 2;
        dib[42] = 3;
        dib[43] = 255;
        let png = dib_to_png(&dib).unwrap();
        assert!(is_png(&png));
        assert!(png.len() <= MAX_PNG);
    }

    #[test]
    fn odd_dib_is_refused() {
        assert!(dib_to_png(&[0; 40]).is_err());
        assert!(dib_to_png(&[]).is_err());
    }
}
