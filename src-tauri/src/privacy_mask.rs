use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::path_grant;
use crate::url_mark::{from_base64, picture_mime, to_base64};

const MAX_READ_BYTES: u64 = 40 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize)]
pub struct PrivacyPicture {
    pub id: String,
    pub mime: String,
    pub data: String,
}

#[tauri::command]
pub fn read_privacy_picture(app: AppHandle, id: String) -> Result<PrivacyPicture, String> {
    let book = app.state::<path_grant::GrantBook>();
    let path = path_grant::view_read(&book, &id).map_err(|text| text.to_string())?;
    if !is_picture_path(&path) {
        return Err("그림 파일을 읽지 못했습니다.".into());
    }
    let meta = fs::metadata(&path).map_err(|_| "그림 파일을 읽지 못했습니다.".to_string())?;
    if !meta.is_file() {
        return Err("그림 파일을 읽지 못했습니다.".into());
    }
    if meta.len() > MAX_READ_BYTES {
        return Err("그림이 너무 큽니다.".into());
    }
    let bytes = fs::read(&path).map_err(|_| "그림 파일을 읽지 못했습니다.".to_string())?;
    let mime = picture_mime(&bytes).ok_or_else(|| "그림 파일을 읽지 못했습니다.".to_string())?;
    Ok(PrivacyPicture {
        id,
        mime: mime.into(),
        data: to_base64(&bytes),
    })
}

#[tauri::command]
pub fn write_privacy_picture(
    app: AppHandle,
    window: WebviewWindow,
    read_id: String,
    write_id: String,
    data: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("이 창에서는 저장할 수 없습니다.".into());
    }
    let book = app.state::<path_grant::GrantBook>();
    let source = path_grant::view_read(&book, &read_id).map_err(|text| text.to_string())?;
    let path = path_grant::view_write(&book, &write_id, &["png", "jpg", "jpeg"]).map_err(|text| text.to_string())?;
    if path_grant::same_place(&source, &path) {
        return Err("원본 파일은 바꾸지 않습니다. 다른 이름으로 저장하세요.".into());
    }
    let bytes = drop_camera_notes(&from_base64(&data)?);
    if bytes.len() > MAX_WRITE_BYTES {
        return Err("저장할 내용이 너무 큽니다.".into());
    }
    let mime = picture_mime(&bytes).ok_or_else(|| "그림 형식이 올바르지 않습니다.".to_string())?;
    if !extension_matches(&path, mime) {
        return Err("저장 형식이 그림과 맞지 않습니다.".into());
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err("저장할 폴더가 없습니다.".into());
        }
    }
    fs::write(&path, &bytes).map_err(|_| "저장하지 못했습니다.".to_string())?;
    path_grant::spend(&book, &write_id);
    Ok(())
}

fn is_picture_path(path: &Path) -> bool {
    match extension(path) {
        Some("png" | "jpg" | "jpeg") => true,
        _ => false,
    }
}

fn extension_matches(path: &Path, mime: &str) -> bool {
    match (extension(path), mime) {
        (Some("png"), "image/png") => true,
        (Some("jpg" | "jpeg"), "image/jpeg") => true,
        _ => false,
    }
}

pub(crate) fn drop_camera_notes(bytes: &[u8]) -> Vec<u8> {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 {
        return drop_jpeg_notes(bytes);
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return drop_png_notes(bytes);
    }
    bytes.to_vec()
}

fn drop_jpeg_notes(bytes: &[u8]) -> Vec<u8> {
    let mut out = vec![0xFF, 0xD8];
    let mut index = 2usize;
    while index + 1 < bytes.len() {
        if bytes[index] != 0xFF {
            out.extend_from_slice(&bytes[index..]);
            return out;
        }
        let mut marker_at = index;
        while marker_at < bytes.len() && bytes[marker_at] == 0xFF {
            marker_at += 1;
        }
        if marker_at >= bytes.len() {
            out.extend_from_slice(&bytes[index..]);
            return out;
        }
        let marker = bytes[marker_at];
        if marker == 0xD8 || marker == 0xD9 || marker == 0x00 || (0xD0..=0xD7).contains(&marker) {
            out.extend_from_slice(&bytes[index..=marker_at]);
            index = marker_at + 1;
            if marker == 0xD9 {
                out.extend_from_slice(&bytes[index..]);
                return out;
            }
            continue;
        }
        if marker == 0xDA {
            out.extend_from_slice(&bytes[index..]);
            return out;
        }
        if marker_at + 3 > bytes.len() {
            out.extend_from_slice(&bytes[index..]);
            return out;
        }
        let seg_len = u16::from_be_bytes([bytes[marker_at + 1], bytes[marker_at + 2]]) as usize;
        if seg_len < 2 || marker_at + 1 + seg_len > bytes.len() {
            out.extend_from_slice(&bytes[index..]);
            return out;
        }
        let seg_end = marker_at + 1 + seg_len;
        let payload = &bytes[marker_at + 3..seg_end];
        let drop = marker == 0xE1 && (payload.starts_with(b"Exif\0") || payload.starts_with(b"http://ns.adobe.com/xap/") || payload.windows(3).any(|part| part == b"GPS"));
        if !drop {
            out.extend_from_slice(&bytes[index..seg_end]);
        }
        index = seg_end;
    }
    out.extend_from_slice(&bytes[index..]);
    out
}

fn drop_png_notes(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::from(&bytes[..8]);
    let mut index = 8usize;
    while index + 12 <= bytes.len() {
        let len = u32::from_be_bytes([bytes[index], bytes[index + 1], bytes[index + 2], bytes[index + 3]]) as usize;
        let next = match index.checked_add(12 + len) {
            Some(next) if next <= bytes.len() => next,
            _ => return bytes.to_vec(),
        };
        let kind = &bytes[index + 4..index + 8];
        let data = &bytes[index + 8..index + 8 + len];
        if !(kind == b"eXIf" || png_text_has_location(kind, data)) {
            out.extend_from_slice(&bytes[index..next]);
        }
        index = next;
        if kind == b"IEND" {
            break;
        }
    }
    out
}

fn png_text_has_location(kind: &[u8], data: &[u8]) -> bool {
    if kind != b"tEXt" && kind != b"zTXt" && kind != b"iTXt" {
        return false;
    }
    let keyword_end = data.iter().position(|byte| *byte == 0).unwrap_or(data.len());
    let keyword = String::from_utf8_lossy(&data[..keyword_end]).to_ascii_lowercase();
    if keyword.contains("gps") || keyword.contains("exif") {
        return true;
    }
    kind == b"tEXt" && {
        let body = String::from_utf8_lossy(data).to_ascii_lowercase();
        body.contains("gps") || body.contains("exif")
    }
}

fn extension(path: &Path) -> Option<&str> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            if ext.eq_ignore_ascii_case("png") {
                "png"
            } else if ext.eq_ignore_ascii_case("jpg") {
                "jpg"
            } else if ext.eq_ignore_ascii_case("jpeg") {
                "jpeg"
            } else {
                ""
            }
        })
        .filter(|ext| !ext.is_empty())
}

#[cfg(test)]
mod tests {
    use super::drop_camera_notes;

    #[test]
    fn saved_jpeg_and_png_drop_exif_and_gps() {
        let jpeg_payload = b"Exif\0\0GPSLatitude";
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE1];
        let seg_len = (2 + jpeg_payload.len()) as u16;
        jpeg.extend_from_slice(&seg_len.to_be_bytes());
        jpeg.extend_from_slice(jpeg_payload);
        jpeg.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9]);
        let jpeg_out = drop_camera_notes(&jpeg);
        assert!(jpeg_out.starts_with(&[0xFF, 0xD8]));
        assert!(!jpeg_out.windows(4).any(|part| part == b"Exif"));
        assert!(!jpeg_out.windows(3).any(|part| part == b"GPS"));
        assert!(jpeg_out.windows(2).any(|part| part == [0xFF, 0xDA]));

        let clean = drop_camera_notes(&[0xFF, 0xD8, 0xFF, 0xD9]);
        assert_eq!(clean, vec![0xFF, 0xD8, 0xFF, 0xD9]);

        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend(png_chunk(b"IHDR", &[0u8; 13]));
        png.extend(png_chunk(b"eXIf", b"Exif\0GPS"));
        png.extend(png_chunk(b"tEXt", b"GPS\0place"));
        png.extend(png_chunk(b"IDAT", b"pixels"));
        png.extend(png_chunk(b"IEND", b""));
        let png_out = drop_camera_notes(&png);
        assert!(png_out.windows(4).any(|part| part == *b"IHDR"));
        assert!(png_out.windows(4).any(|part| part == *b"IDAT"));
        assert!(png_out.windows(4).any(|part| part == *b"IEND"));
        assert!(!png_out.windows(4).any(|part| part == *b"eXIf"));
        assert!(!png_out.windows(4).any(|part| part == b"Exif"));
        assert!(!png_out.windows(3).any(|part| part == b"GPS"));
        assert!(png_out.windows(6).any(|part| part == b"pixels"));
    }

    fn png_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut chunk = Vec::new();
        chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
        chunk.extend_from_slice(kind);
        chunk.extend_from_slice(data);
        chunk.extend_from_slice(&[1, 2, 3, 4]);
        chunk
    }
}

