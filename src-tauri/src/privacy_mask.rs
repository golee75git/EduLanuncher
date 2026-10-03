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
    let bytes = from_base64(&data)?;
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

