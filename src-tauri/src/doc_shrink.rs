use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::path_grant;
use crate::url_mark::{from_base64, picture_mime};

const MAX_READ_BYTES: u64 = 40 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 64 * 1024 * 1024;

#[tauri::command]
fn granted_picture(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let book = app.state::<path_grant::GrantBook>();
    let path = path_grant::view_read(&book, id).map_err(|text| text.to_string())?;
    if !is_picture_path(&path) {
        return Err("그림 파일을 읽지 못했습니다.".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn doc_picture_bytes(app: AppHandle, id: String) -> Result<u64, String> {
    let path = granted_picture(&app, &id)?;
    let meta = fs::metadata(&path).map_err(|_| "그림 파일을 읽지 못했습니다.".to_string())?;
    if !meta.is_file() {
        return Err("그림 파일을 읽지 못했습니다.".into());
    }
    if meta.len() > MAX_READ_BYTES {
        return Err("그림이 너무 큽니다.".into());
    }
    Ok(meta.len())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureMade {
    pub name: String,
    pub reveal_id: String,
    pub bytes: u64,
}

#[tauri::command]
pub fn write_new_picture(
    app: AppHandle,
    source_id: String,
    mode: String,
    folder_id: Option<String>,
    data: String,
) -> Result<PictureMade, String> {
    let source = granted_picture(&app, &source_id)?;
    if !source.is_file() {
        return Err("그림 파일을 읽지 못했습니다.".into());
    }
    let dir = save_dir(&app, &source, mode.trim(), folder_id.as_deref())?;
    let bytes = from_base64(&data)?;
    if bytes.len() > MAX_WRITE_BYTES {
        return Err("저장할 내용이 너무 큽니다.".into());
    }
    let mime = picture_mime(&bytes).ok_or_else(|| "그림 형식이 올바르지 않습니다.".to_string())?;
    let dest = fresh_picture(&source, &dir, mime)?;
    if paths_same(&source, &dest) {
        return Err("원본 파일은 바꾸지 않습니다.".into());
    }
    if dest.exists() {
        return Err("이미 있는 파일은 덮어쓰지 않습니다.".into());
    }
    if !extension_matches(&dest, mime) {
        return Err("저장 형식이 그림과 맞지 않습니다.".into());
    }
    let book = app.state::<path_grant::GrantBook>();
    let write_id = path_grant::begin_derived_write(&book, &dest).map_err(|text| text.to_string())?;
    if let Err(err) = write_part(&dest, &bytes) {
        path_grant::drop_grant(&book, write_id);
        return Err(err);
    }
    let card = match path_grant::finish_made(&book, write_id) {
        Ok(card) => card,
        Err(text) => {
            path_grant::drop_grant(&book, write_id);
            return Err(text.to_string());
        }
    };
    Ok(PictureMade {
        name: card.name,
        reveal_id: card.reveal_id,
        bytes: bytes.len() as u64,
    })
}

fn save_dir(app: &AppHandle, source: &Path, mode: &str, folder_id: Option<&str>) -> Result<PathBuf, String> {
    let parent = source
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or_else(|| "저장할 폴더가 없습니다.".to_string())?;
    match mode {
        "beside" => {
            path_grant::output_dir_allowed(parent).map_err(|text| text.to_string())?;
            Ok(parent.to_path_buf())
        }
        "bundle" => {
            path_grant::output_dir_allowed(parent).map_err(|text| text.to_string())?;
            let dir = parent.join("문서용_사진");
            fs::create_dir_all(&dir).map_err(|err| write_error(&err))?;
            path_grant::output_dir_allowed(&dir).map_err(|text| text.to_string())?;
            Ok(dir)
        }
        "chosen" => {
            let id = folder_id.unwrap_or("").trim();
            if id.is_empty() {
                return Err("저장 폴더를 고르세요.".into());
            }
            let book = app.state::<path_grant::GrantBook>();
            path_grant::view_folder(&book, id).map_err(|text| text.to_string())
        }
        _ => Err("저장 위치를 고르세요.".into()),
    }
}

fn fresh_picture(source: &Path, dir: &Path, mime: &str) -> Result<PathBuf, String> {
    for index in 1..=99 {
        let candidate = dir.join(doc_file_name(source, index, mime));
        if paths_same(source, &candidate) || candidate.exists() {
            continue;
        }
        return Ok(candidate);
    }
    Err("같은 이름의 파일이 너무 많습니다.".into())
}

fn write_part(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = PathBuf::from(format!("{}.part", path.display()));
    if tmp.exists() {
        let _ = fs::remove_file(&tmp);
    }
    if let Err(err) = fs::write(&tmp, bytes) {
        let _ = fs::remove_file(&tmp);
        return Err(write_error(&err));
    }
    if let Err(err) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(write_error(&err));
    }
    Ok(())
}

fn doc_file_name(source: &Path, index: u32, mime: &str) -> String {
    let stem = source
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("사진");
    let ext = if mime == "image/png" { "png" } else { "jpg" };
    if index <= 1 {
        format!("{stem}_문서용.{ext}")
    } else {
        format!("{stem}_문서용_{index}.{ext}")
    }
}

fn is_picture_path(path: &Path) -> bool {
    matches!(extension(path), Some("png" | "jpg" | "jpeg"))
}

fn extension_matches(path: &Path, mime: &str) -> bool {
    match (extension(path), mime) {
        (Some("png"), "image/png") => true,
        (Some("jpg" | "jpeg"), "image/jpeg") => true,
        _ => false,
    }
}

fn extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?;
    if ext.eq_ignore_ascii_case("png") {
        Some("png")
    } else if ext.eq_ignore_ascii_case("jpg") {
        Some("jpg")
    } else if ext.eq_ignore_ascii_case("jpeg") {
        Some("jpeg")
    } else {
        None
    }
}

fn paths_same(source: &Path, dest: &Path) -> bool {
    if path_key(source) == path_key(dest) {
        return true;
    }
    let Ok(source_canon) = fs::canonicalize(source) else {
        return false;
    };
    if path_key(&source_canon) == path_key(dest) {
        return true;
    }
    fs::canonicalize(dest)
        .map(|dest_canon| dest_canon == source_canon)
        .unwrap_or(false)
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn write_error(err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::PermissionDenied => "저장 권한이 없습니다.".into(),
        std::io::ErrorKind::StorageFull => "디스크 공간이 부족합니다.".into(),
        _ => "저장하지 못했습니다.".into(),
    }
}
