use std::fs;
use std::path::{Path, PathBuf};

use qrcode::{Color, EcLevel, QrCode};
use serde::Serialize;

const MAX_PICTURE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PNG_BYTES: usize = 16 * 1024 * 1024;
const MAX_URL_CHARS: usize = 2048;

#[derive(Serialize)]
pub struct UrlMarkGrid {
    pub side: u32,
    pub cells: Vec<u8>,
}

#[derive(Serialize)]
pub struct PictureFile {
    pub mime: String,
    pub data: String,
}

#[tauri::command]
pub fn build_url_mark(url: String) -> Result<UrlMarkGrid, String> {
    let checked = as_web_url(&url)?;
    let code = QrCode::with_error_correction_level(checked.as_bytes(), EcLevel::Q)
        .map_err(|_| "주소 무늬를 만들지 못했습니다.".to_string())?;
    let width = code.width();
    let mut cells = Vec::with_capacity(width * width);
    for row in 0..width {
        for col in 0..width {
            let dark = code[(col, row)] == Color::Dark;
            cells.push(u8::from(dark));
        }
    }
    Ok(UrlMarkGrid {
        side: width as u32,
        cells,
    })
}

#[tauri::command]
pub fn read_picture_file(path: String) -> Result<PictureFile, String> {
    let path = PathBuf::from(path.trim());
    if !is_picture_path(&path) {
        return Err("PNG 또는 JPEG 그림만 고를 수 있습니다.".into());
    }
    let meta = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !meta.is_file() {
        return Err("파일이 아닙니다.".into());
    }
    if meta.len() > MAX_PICTURE_BYTES {
        return Err("그림이 너무 큽니다.".into());
    }
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    let mime = picture_mime(&bytes).ok_or_else(|| "그림 형식이 올바르지 않습니다.".to_string())?;
    Ok(PictureFile {
        mime: mime.into(),
        data: to_base64(&bytes),
    })
}

#[tauri::command]
pub fn write_png_file(path: String, data: String) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    if !is_png_path(&path) {
        return Err("PNG 파일만 저장할 수 있습니다.".into());
    }
    let bytes = from_base64(&data)?;
    if bytes.len() > MAX_PNG_BYTES {
        return Err("저장할 내용이 너무 큽니다.".into());
    }
    if picture_mime(&bytes) != Some("image/png") {
        return Err("PNG 형식이 아닙니다.".into());
    }
    fs::write(&path, bytes).map_err(|err| err.to_string())
}

fn as_web_url(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text.len() < 8 || text.len() > MAX_URL_CHARS {
        return Err("주소 길이가 올바르지 않습니다.".into());
    }
    if text.bytes().any(|b| b < 0x20 || b == b' ') {
        return Err("주소에 빈칸이나 제어 문자가 있습니다.".into());
    }
    let lower = text.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        if lower.starts_with("http:///") || lower.starts_with("https:///") {
            return Err("주소가 올바르지 않습니다.".into());
        }
        return Ok(text.to_string());
    }
    Err("http 또는 https 주소만 넣을 수 있습니다.".into())
}

fn is_picture_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            ext.eq_ignore_ascii_case("png")
                || ext.eq_ignore_ascii_case("jpg")
                || ext.eq_ignore_ascii_case("jpeg")
        })
}

fn is_png_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"))
}

fn picture_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some("image/jpeg");
    }
    None
}

const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn to_base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | bytes[i + 2] as u32;
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        out.push(B64[((n >> 6) & 63) as usize] as char);
        out.push(B64[(n & 63) as usize] as char);
        i += 3;
    }
    if i < bytes.len() {
        let b0 = bytes[i] as u32;
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8);
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(B64[((n >> 6) & 63) as usize] as char);
            out.push('=');
        } else {
            out.push('=');
            out.push('=');
        }
    }
    out
}

fn from_base64(text: &str) -> Result<Vec<u8>, String> {
    let cleaned: Vec<u8> = text
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if cleaned.len() % 4 != 0 {
        return Err("저장 자료가 올바르지 않습니다.".into());
    }
    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    for chunk in cleaned.chunks_exact(4) {
        let mut vals = [0u32; 4];
        let mut pads = 0;
        for (i, b) in chunk.iter().enumerate() {
            if *b == b'=' {
                pads += 1;
                vals[i] = 0;
                continue;
            }
            let pos = B64.iter().position(|c| c == b).ok_or("저장 자료가 올바르지 않습니다.")?;
            vals[i] = pos as u32;
        }
        let n = (vals[0] << 18) | (vals[1] << 12) | (vals[2] << 6) | vals[3];
        out.push((n >> 16) as u8);
        if pads < 2 {
            out.push((n >> 8) as u8);
        }
        if pads < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
}
