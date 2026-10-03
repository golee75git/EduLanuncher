//! 메모리 전용 경로 등록소. 경로는 이 모듈 밖으로 나가지 않고, 화면에는 표시 이름만 나간다.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::privacy_folder;

/// 사진 용량 줄이기가 한 번에 100장까지라, 읽기 등록은 128개까지 두고 넘치면 가장 오래된 것을 잊는다.
const READ_CAP: usize = 128;
const WRITE_CAP: usize = 32;
const PRIVACY_CAP: usize = 200;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GrantUse {
    Read,
    Write,
    PrivacyScan,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GrantOrigin {
    Dialog,
    Drop,
    Startup,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CapMode {
    Refuse,
    DropOldest,
}

struct Grant {
    id: u64,
    path: PathBuf,
    #[allow(dead_code)]
    name: String,
    ext: String,
    use_for: GrantUse,
    origin: GrantOrigin,
    #[allow(dead_code)]
    at: Instant,
}

pub struct GrantBook {
    items: Mutex<Vec<Grant>>,
}

impl GrantBook {
    pub fn new() -> Self {
        Self { items: Mutex::new(Vec::new()) }
    }

    pub fn issue(
        &self,
        use_for: GrantUse,
        path: &Path,
        name: &str,
        ext: &str,
        origin: GrantOrigin,
    ) -> Result<u64, &'static str> {
        let cap = match use_for {
            GrantUse::Read => READ_CAP,
            GrantUse::Write => WRITE_CAP,
            GrantUse::PrivacyScan => PRIVACY_CAP,
        };
        let mode = match use_for {
            GrantUse::PrivacyScan => CapMode::Refuse,
            _ => CapMode::DropOldest,
        };
        let mut items = self.items.lock().map_err(|_| "저장 위치를 열 수 없습니다.")?;
        if items.iter().filter(|item| item.use_for == use_for).count() >= cap {
            match mode {
                CapMode::Refuse => return Err("full"),
                CapMode::DropOldest => {
                    if let Some(index) = items.iter().position(|item| item.use_for == use_for) {
                        items.remove(index);
                    }
                }
            }
        }
        let id = fresh_id(&items);
        items.push(Grant {
            id,
            path: path.to_path_buf(),
            name: name.to_string(),
            ext: ext.to_string(),
            use_for,
            origin,
            at: Instant::now(),
        });
        Ok(id)
    }

    pub fn forget(&self, ids: &[u64]) {
        let Ok(mut items) = self.items.lock() else {
            return;
        };
        items.retain(|item| !ids.contains(&item.id));
    }

    fn clone_of(&self, id: u64) -> Option<Grant> {
        let Ok(items) = self.items.lock() else {
            return None;
        };
        items.iter().find(|item| item.id == id).map(|item| Grant {
            id: item.id,
            path: item.path.clone(),
            name: item.name.clone(),
            ext: item.ext.clone(),
            use_for: item.use_for,
            origin: item.origin,
            at: item.at,
        })
    }
}

impl Default for GrantBook {
    fn default() -> Self {
        Self::new()
    }
}

pub fn id_text(id: u64) -> String {
    format!("{id:016x}")
}

fn parse_id(text: &str) -> Option<u64> {
    let text = text.trim();
    if text.len() != 16 || !text.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }
    u64::from_str_radix(text, 16).ok().filter(|id| *id != 0)
}

fn fresh_id(items: &[Grant]) -> u64 {
    let build = RandomState::new();
    loop {
        let id = build.build_hasher().finish();
        if id != 0 && items.iter().all(|item| item.id != id) {
            return id;
        }
    }
}

pub fn write_blocked(path: &Path, roots: &[String], exe_dir: Option<&Path>) -> bool {
    let plain = privacy_folder::plain_text(path);
    if privacy_folder::under_known(&plain, roots) {
        return true;
    }
    if let Some(dir) = exe_dir {
        let root = privacy_folder::plain_text(dir);
        if privacy_folder::under_known(&plain, &[root]) {
            return true;
        }
    }
    false
}

fn live_exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|path| path.parent().map(Path::to_path_buf))
}

pub fn same_place(left: &Path, right: &Path) -> bool {
    let key = |path: &Path| {
        privacy_folder::plain_text(path).replace('/', "\\").to_ascii_lowercase()
    };
    if key(left) == key(right) {
        return true;
    }
    let Ok(left_real) = std::fs::canonicalize(left) else {
        return false;
    };
    if key(&left_real) == key(right) {
        return true;
    }
    std::fs::canonicalize(right).map(|right_real| right_real == left_real).unwrap_or(false)
}

pub fn view_read(book: &GrantBook, id: &str) -> Result<PathBuf, &'static str> {
    let parsed = parse_id(id).ok_or("없는 파일입니다.")?;
    let item = book.clone_of(parsed).ok_or("없는 파일입니다.")?;
    if item.use_for != GrantUse::Read {
        return Err("이 용도로는 저장할 수 없습니다.");
    }
    Ok(item.path)
}

pub fn view_write(book: &GrantBook, id: &str, exts: &[&str]) -> Result<PathBuf, &'static str> {
    view_write_in(book, id, exts, &privacy_folder::save_deny_roots(), live_exe_dir().as_deref())
}

pub fn view_write_in(
    book: &GrantBook,
    id: &str,
    exts: &[&str],
    roots: &[String],
    exe_dir: Option<&Path>,
) -> Result<PathBuf, &'static str> {
    let parsed = parse_id(id).ok_or("없는 저장입니다.")?;
    let item = book.clone_of(parsed).ok_or("없는 저장입니다.")?;
    if item.use_for != GrantUse::Write || item.origin != GrantOrigin::Dialog {
        return Err("이 용도로는 저장할 수 없습니다.");
    }
    if !exts.iter().any(|ext| ext.eq_ignore_ascii_case(&item.ext)) {
        return Err("저장 형식이 올바르지 않습니다.");
    }
    if write_blocked(&item.path, roots, exe_dir) {
        return Err("시스템 폴더에는 저장하지 않습니다.");
    }
    Ok(item.path)
}

pub fn spend(book: &GrantBook, id: &str) {
    if let Some(parsed) = parse_id(id) {
        book.forget(&[parsed]);
    }
}

fn main_only(window: &WebviewWindow) -> Result<(), &'static str> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("이 창에서는 저장할 수 없습니다.")
    }
}

fn leaf_name(raw: &str) -> Result<String, &'static str> {
    let name = raw.trim();
    if name.is_empty() || name.len() > 120 {
        return Err("파일 이름이 올바르지 않습니다.");
    }
    if name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("파일 이름이 올바르지 않습니다.");
    }
    Ok(name.to_string())
}

fn kind_rule(kind: &str, picture: Option<&str>) -> Result<(&'static str, &'static [&'static str], &'static str), &'static str> {
    match kind {
        "pack" => Ok(("저장", &["edupack", "json"], "edupack")),
        "json" => Ok(("저장", &["json"], "json")),
        "csv" => Ok(("CSV 저장", &["csv"], "csv")),
        "png" => Ok(("PNG 저장", &["png"], "png")),
        "picture" => match picture.unwrap_or("") {
            "png" => Ok(("그림 저장", &["png"], "png")),
            "jpeg" => Ok(("그림 저장", &["jpg", "jpeg"], "jpg")),
            _ => Err("저장 형식이 올바르지 않습니다."),
        },
        _ => Err("저장 형식이 올바르지 않습니다."),
    }
}

fn with_extension(path: PathBuf, allowed: &[&str], fallback: &str) -> Result<(PathBuf, String), &'static str> {
    let current = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());
    if let Some(ext) = current {
        if allowed.iter().any(|item| item.eq_ignore_ascii_case(&ext)) {
            return Ok((path, ext));
        }
        return Err("저장 형식이 올바르지 않습니다.");
    }
    let next = path.with_extension(fallback);
    Ok((next, fallback.to_string()))
}

fn display_name(path: &Path) -> String {
    path.file_name().and_then(|name| name.to_str()).unwrap_or("파일").to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCard {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub async fn pick_save_file(
    app: AppHandle,
    window: WebviewWindow,
    kind: String,
    file_name: String,
    picture: Option<String>,
) -> Result<SaveCard, String> {
    main_only(&window).map_err(|text| text.to_string())?;
    let file_name = leaf_name(&file_name).map_err(|text| text.to_string())?;
    let (title, allowed, fallback) = kind_rule(&kind, picture.as_deref()).map_err(|text| text.to_string())?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .set_file_name(&file_name)
        .add_filter(title, allowed)
        .save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|_| "저장 위치를 열 수 없습니다.".to_string())?
        .map_err(|_| "저장 위치를 열 수 없습니다.".to_string())?;
    let Some(picked) = picked else {
        return Err("cancelled".into());
    };
    let path = picked.into_path().map_err(|_| "저장 위치를 열 수 없습니다.".to_string())?;
    let (path, ext) = with_extension(path, allowed, fallback).map_err(|text| text.to_string())?;
    if write_blocked(&path, &privacy_folder::save_deny_roots(), live_exe_dir().as_deref()) {
        return Err("시스템 폴더에는 저장하지 않습니다.".into());
    }
    let name = display_name(&path);
    let book = app.state::<GrantBook>();
    let id = book
        .issue(GrantUse::Write, &path, &name, &ext, GrantOrigin::Dialog)
        .map_err(|_| "저장 위치를 열 수 없습니다.".to_string())?;
    Ok(SaveCard { id: id_text(id), name })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCard {
    pub id: String,
    pub name: String,
}

fn open_rule(kind: &str) -> Result<(&'static str, &'static [&'static str], bool), &'static str> {
    match kind {
        "bookmark" => Ok(("즐겨찾기", &["html", "htm"], false)),
        "pack" => Ok(("Pack", &["edupack", "json"], false)),
        "json" => Ok(("JSON", &["json"], false)),
        "picture" => Ok(("그림", &["png", "jpg", "jpeg"], false)),
        "pictures" => Ok(("그림", &["png", "jpg", "jpeg"], true)),
        "pdf" => Ok(("PDF", &["pdf"], false)),
        "pdfs" => Ok(("PDF", &["pdf"], true)),
        _ => Err("열 형식이 올바르지 않습니다."),
    }
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn issue_read(book: &GrantBook, path: &Path, origin: GrantOrigin) -> Result<String, &'static str> {
    let name = display_name(path);
    let ext = extension_of(path);
    let id = book.issue(GrantUse::Read, path, &name, &ext, origin)?;
    Ok(id_text(id))
}

fn register_open(book: &GrantBook, path: PathBuf, allowed: &[&str]) -> Result<OpenCard, String> {
    let ext = extension_of(&path);
    if !allowed.iter().any(|item| item.eq_ignore_ascii_case(&ext)) {
        return Err("허용되지 않은 파일입니다.".into());
    }
    let name = display_name(&path);
    let id = book
        .issue(GrantUse::Read, &path, &name, &ext, GrantOrigin::Dialog)
        .map_err(|_| "파일을 열 수 없습니다.".to_string())?;
    Ok(OpenCard { id: id_text(id), name })
}

#[tauri::command]
pub async fn pick_open_files(app: AppHandle, window: WebviewWindow, kind: String) -> Result<Vec<OpenCard>, String> {
    main_only(&window).map_err(|_| "이 창에서는 열 수 없습니다.".to_string())?;
    let (title, allowed, multiple) = open_rule(&kind).map_err(|text| text.to_string())?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let dialog = app.dialog().file().set_parent(&window).set_title(title).add_filter(title, allowed);
    if multiple {
        dialog.pick_files(move |picked| {
            let _ = tx.send(picked.map(|files| files.into_iter().map(Some).collect::<Vec<_>>()));
        });
    } else {
        dialog.pick_file(move |picked| {
            let _ = tx.send(Some(vec![picked]));
        });
    }
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|_| "파일을 열 수 없습니다.".to_string())?
        .map_err(|_| "파일을 열 수 없습니다.".to_string())?;
    let Some(picked) = picked else {
        return Err("cancelled".into());
    };
    let book = app.state::<GrantBook>();
    let mut cards = Vec::new();
    for file in picked.into_iter().flatten() {
        let path = file.into_path().map_err(|_| "파일을 열 수 없습니다.".to_string())?;
        cards.push(register_open(&book, path, allowed)?);
    }
    if cards.is_empty() {
        return Err("cancelled".into());
    }
    Ok(cards)
}

pub fn write_text(book: &GrantBook, id: &str, exts: &[&str], contents: &str, limit: usize) -> Result<(), &'static str> {
    if contents.len() > limit {
        return Err("내용이 너무 큽니다.");
    }
    let path = view_write(book, id, exts)?;
    std::fs::write(&path, contents).map_err(|_| "저장하지 못했습니다.")?;
    spend(book, id);
    Ok(())
}

pub fn write_bytes(book: &GrantBook, id: &str, exts: &[&str], bytes: &[u8], limit: usize) -> Result<(), &'static str> {
    if bytes.len() > limit {
        return Err("저장할 내용이 너무 큽니다.");
    }
    let path = view_write(book, id, exts)?;
    std::fs::write(&path, bytes).map_err(|_| "저장하지 못했습니다.")?;
    spend(book, id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book_with(use_for: GrantUse, path: &str, ext: &str, origin: GrantOrigin) -> (GrantBook, String) {
        let book = GrantBook::new();
        let id = book.issue(use_for, Path::new(path), "표시", ext, origin).unwrap();
        (book, id_text(id))
    }

    #[test]
    fn unknown_spent_and_wrong_use_are_refused() {
        let (book, id) = book_with(GrantUse::Write, r"C:\Users\가짜\메모.json", "json", GrantOrigin::Dialog);
        assert_eq!(view_write_in(&book, "0000000000000000", &["json"], &[], None).unwrap_err(), "없는 저장입니다.");
        assert_eq!(view_write_in(&book, "zzzzzzzzzzzzzzzz", &["json"], &[], None).unwrap_err(), "없는 저장입니다.");
        spend(&book, &id);
        assert_eq!(view_write_in(&book, &id, &["json"], &[], None).unwrap_err(), "없는 저장입니다.");

        let (book, read_id) = book_with(GrantUse::Read, r"C:\Users\가짜\사진.png", "png", GrantOrigin::Drop);
        assert_eq!(
            view_write_in(&book, &read_id, &["png"], &[], None).unwrap_err(),
            "이 용도로는 저장할 수 없습니다."
        );
    }

    #[test]
    fn system_folders_and_the_program_folder_are_refused() {
        let roots = vec![r"C:\Windows".to_string(), r"C:\Program Files".to_string()];
        let exe = PathBuf::from(r"D:\EduLauncher");
        assert!(write_blocked(Path::new(r"C:\Windows\Temp\메모.json"), &roots, Some(&exe)));
        assert!(write_blocked(Path::new(r"C:\Program Files\EduLauncher\메모.json"), &roots, Some(&exe)));
        assert!(write_blocked(Path::new(r"D:\EduLauncher\메모.json"), &roots, Some(&exe)));
        assert!(!write_blocked(Path::new(r"C:\Users\가짜\메모.json"), &roots, Some(&exe)));

        let (book, id) = book_with(GrantUse::Write, r"C:\Windows\Temp\메모.json", "json", GrantOrigin::Dialog);
        let err = view_write_in(&book, &id, &["json"], &roots, Some(&exe)).unwrap_err();
        assert_eq!(err, "시스템 폴더에는 저장하지 않습니다.");
        assert!(!err.contains('\\'));
        assert!(!err.contains("메모"));
    }

    #[test]
    fn save_card_has_no_path() {
        let card = SaveCard { id: "0000000000000007".into(), name: "메모.json".into() };
        let json = serde_json::to_string(&card).unwrap();
        assert!(json.contains("메모.json"));
        assert!(!json.contains("\"path\""));
        assert!(!json.contains('\\'));
    }

    #[test]
    fn bundle_write_signatures_have_no_path_argument() {
        let lib = include_str!("lib.rs");
        for name in ["fn write_json_file", "fn write_csv_file"] {
            let start = lib.find(name).expect(name);
            let end = lib[start..].find('{').unwrap() + start;
            let sig = &lib[start..end];
            assert!(!sig.contains("path"), "{sig}");
            assert!(!sig.contains("target"), "{sig}");
        }
        for name in [
            "fn read_bookmark_html",
            "fn read_json_file",
            "fn read_url_shortcut",
            "fn dropped_path_info",
        ] {
            let start = lib.find(name).expect(name);
            let end = lib[start..].find('{').unwrap() + start;
            let sig = &lib[start..end];
            let params = sig.split_once('(').map(|(_, rest)| rest).unwrap_or(sig);
            assert!(!params.contains("path"), "{sig}");
            assert!(params.contains("id"), "{sig}");
        }
        for (file, name) in [("url_mark.rs", "fn write_png_file"), ("privacy_mask.rs", "fn write_privacy_picture")] {
            let source = if file.ends_with("url_mark.rs") {
                include_str!("url_mark.rs")
            } else {
                include_str!("privacy_mask.rs")
            };
            let start = source.find(name).expect(name);
            let end = source[start..].find('{').unwrap() + start;
            let sig = &source[start..end];
            assert!(!sig.contains("path"), "{sig}");
            assert!(!sig.contains("target"), "{sig}");
        }
        for (file, name) in [
            ("url_mark.rs", "fn read_picture_file"),
            ("privacy_mask.rs", "fn read_privacy_picture"),
        ] {
            let source = if file.ends_with("url_mark.rs") {
                include_str!("url_mark.rs")
            } else {
                include_str!("privacy_mask.rs")
            };
            let start = source.find(name).expect(name);
            let end = source[start..].find('{').unwrap() + start;
            let sig = &source[start..end];
            assert!(!sig.contains("path"), "{sig}");
            assert!(sig.contains("id"), "{sig}");
        }
    }
}
