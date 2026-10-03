//! 메모리 전용 경로 등록소. 경로는 이 모듈 밖으로 나가지 않고, 화면에는 표시 이름만 나간다.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::privacy_folder;

/// 사진 용량 줄이기가 한 번에 100장까지라, 읽기 등록은 128개까지 두고 넘치면 가장 오래된 것을 잊는다.
const READ_CAP: usize = 128;
const WRITE_CAP: usize = 32;
const PRIVACY_CAP: usize = 200;
/// 쪽마다 뽑기는 최대 800개라, 결과 열기 등록은 800개까지 두고 넘치면 가장 오래된 것을 잊는다.
const REVEAL_CAP: usize = 800;
/// 즐겨찾기 목록이 400개까지라, 실행 등록은 800개까지 두고 넘치면 가장 오래된 것을 잊는다.
const LAUNCH_CAP: usize = 800;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GrantUse {
    Read,
    Write,
    PrivacyScan,
    Reveal,
    Launch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GrantOrigin {
    Dialog,
    Drop,
    Startup,
    Derived,
    SearchDoc,
    SearchUser,
    SearchUrl,
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
    batch: u64,
    #[allow(dead_code)]
    at: Instant,
}

pub struct GrantBook {
    items: Mutex<Vec<Grant>>,
    batch: Mutex<u64>,
}

impl GrantBook {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(Vec::new()),
            batch: Mutex::new(0),
        }
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
            GrantUse::Reveal => REVEAL_CAP,
            GrantUse::Launch => LAUNCH_CAP,
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
            batch: 0,
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

    pub fn forget_use(&self, use_for: GrantUse) {
        let Ok(mut items) = self.items.lock() else {
            return;
        };
        items.retain(|item| item.use_for != use_for);
    }

    pub fn issue_marked(
        &self,
        use_for: GrantUse,
        path: &Path,
        name: &str,
        ext: &str,
        origin: GrantOrigin,
        batch: u64,
    ) -> Result<u64, &'static str> {
        let id = self.issue(use_for, path, name, ext, origin)?;
        if let Ok(mut items) = self.items.lock() {
            if let Some(item) = items.iter_mut().find(|item| item.id == id) {
                item.batch = batch;
            }
        }
        Ok(id)
    }

    pub fn begin_batch(&self, origin: GrantOrigin) -> u64 {
        let stamp = {
            let Ok(mut batch) = self.batch.lock() else {
                return 0;
            };
            *batch = batch.wrapping_add(1);
            if *batch == 0 {
                *batch = 1;
            }
            *batch
        };
        if let Ok(mut items) = self.items.lock() {
            items.retain(|item| item.origin != origin);
        }
        stamp
    }

    pub fn forget_batch(&self, origin: GrantOrigin, batch: u64) {
        if batch == 0 {
            return;
        }
        let Ok(mut items) = self.items.lock() else {
            return;
        };
        items.retain(|item| !(item.origin == origin && item.batch == batch));
    }

    pub fn forget_folder(&self, id: &str) {
        let Some(number) = parse_id(id) else {
            return;
        };
        let Ok(mut items) = self.items.lock() else {
            return;
        };
        items.retain(|item| !(item.id == number && item.use_for == GrantUse::Write && item.ext == "dir"));
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
            batch: item.batch,
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

pub fn drop_grant(book: &GrantBook, id: u64) {
    book.forget(&[id]);
}

pub fn output_dir_allowed(dir: &Path) -> Result<(), &'static str> {
    output_dir_allowed_in(dir, &privacy_folder::save_deny_roots(), live_exe_dir().as_deref())
}

fn output_dir_allowed_in(dir: &Path, roots: &[String], exe_dir: Option<&Path>) -> Result<(), &'static str> {
    if dir.as_os_str().is_empty() {
        return Err("저장 폴더를 찾지 못했습니다.");
    }
    let probe = dir.join("a.pdf");
    if write_blocked(&probe, roots, exe_dir) {
        Err("시스템 폴더에는 저장하지 않습니다.")
    } else {
        Ok(())
    }
}

pub fn begin_derived_write(book: &GrantBook, path: &Path) -> Result<u64, &'static str> {
    let parent = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .ok_or("저장 폴더를 찾지 못했습니다.")?;
    output_dir_allowed(parent)?;
    let name = display_name(path);
    let ext = extension_of(path);
    book.issue(GrantUse::Write, path, &name, &ext, GrantOrigin::Derived)
}

pub struct MadeCard {
    pub name: String,
    pub reveal_id: String,
}

pub fn finish_made(book: &GrantBook, write_id: u64) -> Result<MadeCard, &'static str> {
    let item = book.clone_of(write_id).ok_or("저장하지 못했습니다.")?;
    if item.use_for != GrantUse::Write || item.origin != GrantOrigin::Derived {
        return Err("저장하지 못했습니다.");
    }
    if !item.path.is_file() {
        book.forget(&[write_id]);
        return Err("저장하지 못했습니다.");
    }
    let name = item.name.clone();
    let ext = item.ext.clone();
    let path = item.path.clone();
    book.forget(&[write_id]);
    let reveal = book.issue(GrantUse::Reveal, &path, &name, &ext, GrantOrigin::Derived)?;
    Ok(MadeCard {
        name,
        reveal_id: id_text(reveal),
    })
}

#[derive(Debug)]
pub struct HeldLaunch {
    pub path: PathBuf,
    pub kind: String,
    pub once: bool,
}

pub fn view_launch(book: &GrantBook, id: &str) -> Result<HeldLaunch, &'static str> {
    let parsed = parse_id(id).ok_or("missing")?;
    let item = book.clone_of(parsed).ok_or("missing")?;
    if item.use_for != GrantUse::Launch {
        return Err("denied");
    }
    let once = matches!(item.origin, GrantOrigin::Dialog | GrantOrigin::Drop);
    Ok(HeldLaunch {
        path: item.path,
        kind: item.ext,
        once,
    })
}

pub fn remember_launch(
    book: &GrantBook,
    origin: GrantOrigin,
    batch: u64,
    path: &Path,
    kind: &str,
) -> Result<String, &'static str> {
    let name = display_name(path);
    let id = book.issue_marked(GrantUse::Launch, path, &name, kind, origin, batch)?;
    Ok(id_text(id))
}

pub fn search_origin(kind: &str) -> Option<GrantOrigin> {
    match kind {
        "doc" => Some(GrantOrigin::SearchDoc),
        "user" => Some(GrantOrigin::SearchUser),
        "url" => Some(GrantOrigin::SearchUrl),
        _ => None,
    }
}

pub fn place_label(path: &Path) -> String {
    let Some(parent) = path.parent() else {
        return String::new();
    };
    let mut parts = Vec::new();
    for part in parent.components() {
        match part {
            std::path::Component::Normal(text) => {
                if let Some(name) = text.to_str() {
                    parts.push(name.to_string());
                }
            }
            std::path::Component::Prefix(prefix) => {
                if let Some(name) = prefix.as_os_str().to_str() {
                    let short = name.trim_end_matches(['\\', '/']);
                    if !short.is_empty() {
                        parts.push(short.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    let start = parts.len().saturating_sub(2);
    parts[start..].join("\\")
}

pub fn web_target(raw: &str) -> Result<String, &'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("missing");
    }
    if trimmed.len() > 2048 || trimmed.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("denied");
    }
    let url = if trimmed.contains(':') {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let lower = url.to_ascii_lowercase();
    if url.len() < 10 || !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("denied");
    }
    Ok(url)
}

pub fn file_target(raw: &str) -> Result<PathBuf, &'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("missing");
    }
    if trimmed.len() > 1024 || trimmed.chars().any(|ch| ch.is_control()) || trimmed.contains("://") {
        return Err("denied");
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("denied");
    }
    Ok(path)
}

pub fn view_reveal(book: &GrantBook, id: &str) -> Result<PathBuf, &'static str> {
    let parsed = parse_id(id).ok_or("결과 파일을 열 수 없습니다.")?;
    let item = book.clone_of(parsed).ok_or("결과 파일을 열 수 없습니다.")?;
    if item.use_for != GrantUse::Reveal {
        return Err("결과 파일을 열 수 없습니다.");
    }
    if !item.path.is_file() {
        return Err("결과 파일을 열 수 없습니다.");
    }
    Ok(item.path)
}

pub fn view_folder(book: &GrantBook, id: &str) -> Result<PathBuf, &'static str> {
    view_folder_in(book, id, &privacy_folder::save_deny_roots(), live_exe_dir().as_deref())
}

fn view_folder_in(
    book: &GrantBook,
    id: &str,
    roots: &[String],
    exe_dir: Option<&Path>,
) -> Result<PathBuf, &'static str> {
    let parsed = parse_id(id).ok_or("저장 폴더를 찾지 못했습니다.")?;
    let item = book.clone_of(parsed).ok_or("저장 폴더를 찾지 못했습니다.")?;
    if item.use_for != GrantUse::Write || item.origin != GrantOrigin::Dialog || item.ext != "dir" {
        return Err("저장 폴더를 찾지 못했습니다.");
    }
    if write_blocked(&item.path, roots, exe_dir) {
        return Err("시스템 폴더에는 저장하지 않습니다.");
    }
    if !item.path.is_dir() {
        return Err("저장 폴더가 없습니다.");
    }
    Ok(item.path)
}

#[tauri::command]
pub fn reveal_made_file(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("이 창에서는 열 수 없습니다.".into());
    }
    let book = app.state::<GrantBook>();
    let path = view_reveal(&book, &id).map_err(|text| text.to_string())?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|_| "파일 위치를 열지 못했습니다.".to_string())
}

#[tauri::command]
pub fn clear_search_grants(app: AppHandle, window: WebviewWindow, kind: String, batch: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("이 창에서는 실행할 수 없습니다.".into());
    }
    let Some(origin) = search_origin(kind.trim()) else {
        return Ok(());
    };
    let Ok(stamp) = batch.trim().parse::<u64>() else {
        return Ok(());
    };
    app.state::<GrantBook>().forget_batch(origin, stamp);
    Ok(())
}

#[tauri::command]
pub fn clear_made_reveals(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("이 창에서는 열 수 없습니다.".into());
    }
    app.state::<GrantBook>().forget_use(GrantUse::Reveal);
    Ok(())
}

#[tauri::command]
pub fn forget_save_folder(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("이 창에서는 열 수 없습니다.".into());
    }
    app.state::<GrantBook>().forget_folder(&id);
    Ok(())
}

#[tauri::command]
pub async fn pick_save_folder(app: AppHandle, window: WebviewWindow) -> Result<SaveCard, String> {
    main_only(&window).map_err(|_| "이 창에서는 저장할 수 없습니다.".to_string())?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.dialog()
        .file()
        .set_parent(&window)
        .set_title("저장 폴더")
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|_| "저장 폴더를 고르지 못했습니다.".to_string())?
        .map_err(|_| "저장 폴더를 고르지 못했습니다.".to_string())?;
    let Some(file) = picked else {
        return Err("cancelled".into());
    };
    let path = file.into_path().map_err(|_| "저장 폴더를 고르지 못했습니다.".to_string())?;
    if !path.is_dir() {
        return Err("저장 폴더가 없습니다.".into());
    }
    output_dir_allowed(&path).map_err(|text| text.to_string())?;
    let book = app.state::<GrantBook>();
    let name = display_name(&path);
    let id = book
        .issue(GrantUse::Write, &path, &name, "dir", GrantOrigin::Dialog)
        .map_err(|_| "저장 폴더를 고르지 못했습니다.".to_string())?;
    Ok(SaveCard { id: id_text(id), name })
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
        let shrink = include_str!("doc_shrink.rs");
        let write_at = shrink.find("fn write_new_picture").expect("write_new_picture");
        let write_end = shrink[write_at..].find('{').unwrap() + write_at;
        let write_sig = &shrink[write_at..write_end];
        let write_params = write_sig.split_once('(').map(|(_, rest)| rest).unwrap_or(write_sig);
        assert!(!write_params.contains("path"), "{write_sig}");
        assert!(write_params.contains("source_id"), "{write_sig}");
        assert!(!shrink.contains("fn plan_doc_save"), "plan_doc_save must stay inside write_new_picture");

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

    #[test]
    fn derived_write_is_not_a_dialog_save() {
        let (book, id) = book_with(GrantUse::Write, r"C:\Users\가짜\합친문서.pdf", "pdf", GrantOrigin::Derived);
        let err = view_write_in(&book, &id, &["pdf"], &[], None).unwrap_err();
        assert_eq!(err, "이 용도로는 저장할 수 없습니다.");
        assert!(!err.contains('\\'));
    }

    #[test]
    fn reveal_grant_is_not_a_save() {
        let (book, id) = book_with(GrantUse::Reveal, r"C:\Users\가짜\합친문서.pdf", "pdf", GrantOrigin::Derived);
        let err = view_reveal(&book, &id).unwrap_err();
        assert_eq!(err, "결과 파일을 열 수 없습니다.");
        assert!(!err.contains('\\'));
        assert!(!err.contains("합친"));
        let (book, write_id) = book_with(GrantUse::Write, r"C:\Users\가짜\메모.json", "json", GrantOrigin::Dialog);
        assert_eq!(view_reveal(&book, &write_id).unwrap_err(), "결과 파일을 열 수 없습니다.");
    }

    #[test]
    fn folder_grant_is_not_a_picture_save() {
        let (book, id) = book_with(GrantUse::Write, r"C:\Users\가짜\사진", "dir", GrantOrigin::Dialog);
        assert_eq!(
            view_write_in(&book, &id, &["png", "jpg"], &[], None).unwrap_err(),
            "저장 형식이 올바르지 않습니다."
        );
        let err = view_folder_in(&book, &id, &[], None).unwrap_err();
        assert_eq!(err, "저장 폴더가 없습니다.");
        assert!(!err.contains('\\'));
    }

    #[test]
    fn system_output_dir_is_refused() {
        let roots = vec![r"C:\Windows".to_string()];
        let exe = PathBuf::from(r"D:\EduLauncher");
        let err = output_dir_allowed_in(Path::new(r"C:\Windows"), &roots, Some(&exe)).unwrap_err();
        assert_eq!(err, "시스템 폴더에는 저장하지 않습니다.");
        assert!(!err.contains('\\'));
        assert!(output_dir_allowed_in(Path::new(r"D:\EduLauncher"), &roots, Some(&exe)).is_err());
        assert!(output_dir_allowed_in(Path::new(r"C:\Users\가짜"), &roots, Some(&exe)).is_ok());
    }

    #[test]
    fn search_launch_can_be_used_again_and_a_fresh_pick_is_once() {
        let book = GrantBook::new();
        let batch = book.begin_batch(GrantOrigin::SearchDoc);
        let id = remember_launch(
            &book,
            GrantOrigin::SearchDoc,
            batch,
            Path::new(r"C:\Users\가짜\문서\가.txt"),
            "file",
        )
        .unwrap();
        let held = view_launch(&book, &id).unwrap();
        assert!(!held.once);
        assert_eq!(held.kind, "file");
        assert!(view_launch(&book, &id).is_ok());
        let (read_book, read_id) = book_with(GrantUse::Read, r"C:\Users\가짜\가.txt", "txt", GrantOrigin::Drop);
        assert_eq!(view_launch(&read_book, &read_id).unwrap_err(), "denied");
        let once = book
            .issue_marked(
                GrantUse::Launch,
                Path::new(r"C:\Users\가짜\메모.txt"),
                "메모.txt",
                "file",
                GrantOrigin::Drop,
                0,
            )
            .unwrap();
        let held = view_launch(&book, &id_text(once)).unwrap();
        assert!(held.once);
        book.forget(&[once]);
        assert_eq!(view_launch(&book, &id_text(once)).unwrap_err(), "missing");
    }

    #[test]
    fn a_newer_search_keeps_its_ids_when_the_old_list_is_cleared() {
        let book = GrantBook::new();
        let first = book.begin_batch(GrantOrigin::SearchUser);
        let old = remember_launch(&book, GrantOrigin::SearchUser, first, Path::new(r"C:\Users\가짜\가.txt"), "file").unwrap();
        let second = book.begin_batch(GrantOrigin::SearchUser);
        let fresh = remember_launch(&book, GrantOrigin::SearchUser, second, Path::new(r"C:\Users\가짜\나.txt"), "file").unwrap();
        book.forget_batch(GrantOrigin::SearchUser, first);
        assert!(view_launch(&book, &old).is_err());
        assert!(view_launch(&book, &fresh).is_ok());
    }

    #[test]
    fn web_and_file_targets_follow_the_type_rule() {
        assert!(web_target("https://school.example").unwrap().starts_with("https://"));
        assert!(web_target("school.example").unwrap().starts_with("https://"));
        assert_eq!(web_target("javascript:alert(1)").unwrap_err(), "denied");
        assert_eq!(web_target("file:///C:/Windows/notepad.exe").unwrap_err(), "denied");
        assert_eq!(web_target("").unwrap_err(), "missing");
        assert!(file_target(r"C:\Users\가짜\메모.txt").is_ok());
        assert!(file_target(r"\\school\share\메모.txt").is_ok());
        assert_eq!(file_target("https://school.example").unwrap_err(), "denied");
        assert_eq!(file_target("메모.txt").unwrap_err(), "denied");
        assert_eq!(file_target("").unwrap_err(), "missing");
        let card = serde_json::json!({"ok": false, "error": "missing"});
        let text = card.to_string();
        assert!(!text.contains("path"));
        assert!(!text.contains('\\'));
    }

    #[test]
    fn clearing_reveals_keeps_other_grants() {
        let book = GrantBook::new();
        let reveal = book
            .issue(GrantUse::Reveal, Path::new(r"C:\Users\가짜\합친문서.pdf"), "합친문서.pdf", "pdf", GrantOrigin::Derived)
            .unwrap();
        let read = book
            .issue(GrantUse::Read, Path::new(r"C:\Users\가짜\가.pdf"), "가.pdf", "pdf", GrantOrigin::Dialog)
            .unwrap();
        book.forget_use(GrantUse::Reveal);
        assert!(book.clone_of(reveal).is_none());
        assert!(book.clone_of(read).is_some());
    }
}
