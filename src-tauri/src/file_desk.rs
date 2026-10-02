//! 개인정보 화면이 고른 파일만 메모리에 둔다. 경로는 이 모듈 밖으로 나가지 않는다.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::privacy_scan::{self, ReadBudget};

const CAP: usize = 200;
const FOLDER_CAP: usize = 5_000;
const WORKERS: usize = 2;
const FILE_LIMIT: Duration = Duration::from_secs(30);
const PICK_EVENT: &str = "privacy-picked";
const PROGRESS_EVENT: &str = "privacy-progress";
const FOLDER_EVENT: &str = "privacy-folder";
const DISARM_EVENT: &str = "privacy-disarmed";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Purpose {
    PrivacyScan,
}

struct Held {
    id: u64,
    path: PathBuf,
    name: String,
    ext: String,
    purpose: Purpose,
    scanned_size: Option<u64>,
    scanned_modified: Option<Option<SystemTime>>,
}

#[derive(Clone)]
struct FolderChoice {
    id: u64,
    path: PathBuf,
    name: String,
}

struct FolderRow {
    place: String,
    note: FileNote,
}

pub struct FileDesk {
    armed: AtomicBool,
    running: AtomicBool,
    stop: Arc<AtomicBool>,
    items: Mutex<Vec<Held>>,
    folder_items: Mutex<Vec<Held>>,
    folder_rows: Mutex<Vec<FolderRow>>,
    folder_summary: Mutex<FolderSummary>,
    choice: Mutex<Option<FolderChoice>>,
    flags: Mutex<Vec<Arc<AtomicBool>>>,
}

impl FileDesk {
    pub fn new() -> Self {
        Self {
            armed: AtomicBool::new(false),
            running: AtomicBool::new(false),
            stop: Arc::new(AtomicBool::new(false)),
            items: Mutex::new(Vec::new()),
            folder_items: Mutex::new(Vec::new()),
            folder_rows: Mutex::new(Vec::new()),
            folder_summary: Mutex::new(FolderSummary::default()),
            choice: Mutex::new(None),
            flags: Mutex::new(Vec::new()),
        }
    }
}

impl Default for FileDesk {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickFile {
    id: String,
    name: String,
    ext: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickNote {
    files: Vec<PickFile>,
    skipped: u32,
    folders: u32,
    during_scan: bool,
    foreign: bool,
    folder: Option<FolderCard>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderCard {
    id: String,
    name: String,
    ask: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaceNote {
    kind: String,
    finding: String,
    a: u32,
    b: u32,
    c: u32,
    label: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TypeNote {
    kind: String,
    count: u32,
    places: Vec<PlaceNote>,
    overflow: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComboNote {
    label: String,
    records: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNote {
    id: String,
    name: String,
    ext: String,
    grade: String,
    status: String,
    types: Vec<TypeNote>,
    combos: Vec<ComboNote>,
    reference_count: u32,
    hidden: bool,
    partial: bool,
    reason: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressNote {
    done: u32,
    total: u32,
    finished: bool,
    stopped: bool,
    current_name: String,
    file: Option<FileNote>,
}

#[derive(Deserialize)]
pub struct PlaceAsk {
    kind: String,
    finding: String,
    a: u32,
    b: u32,
    c: u32,
}

struct JobCopy {
    id: u64,
    path: PathBuf,
    name: String,
    ext: String,
}

pub fn caller_allowed(label: &str) -> bool {
    label == "main"
}

fn deny_window(window: &WebviewWindow) -> Result<(), String> {
    if caller_allowed(window.label()) {
        Ok(())
    } else {
        Err("denied".into())
    }
}

pub fn is_armed(app: &AppHandle) -> bool {
    app.try_state::<FileDesk>()
        .map(|desk| desk.armed.load(Ordering::Relaxed))
        .unwrap_or(false)
}

pub fn disarm(app: &AppHandle, notify: bool) {
    let Some(desk) = app.try_state::<FileDesk>() else {
        return;
    };
    desk.armed.store(false, Ordering::Relaxed);
    desk.stop.store(true, Ordering::Relaxed);
    if let Ok(flags) = desk.flags.lock() {
        for flag in flags.iter() {
            flag.store(true, Ordering::Relaxed);
        }
    }
    if let Ok(mut items) = desk.items.lock() {
        items.clear();
    }
    desk.clear_folder();
    if notify {
        let _ = app.emit(DISARM_EVENT, ());
    }
}

pub fn take_path_strings(app: &AppHandle, paths: &[String]) -> PickNote {
    let owned: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    match app.try_state::<FileDesk>() {
        Some(desk) => desk.take_paths(&owned),
        None => PickNote::empty(),
    }
}

impl PickNote {
    fn empty() -> Self {
        Self {
            files: Vec::new(),
            skipped: 0,
            folders: 0,
            during_scan: false,
            foreign: false,
            folder: None,
        }
    }

    fn only_files() -> Self {
        Self {
            foreign: true,
            ..Self::empty()
        }
    }
}

impl FileDesk {
    fn take_paths(&self, paths: &[PathBuf]) -> PickNote {
        if !self.armed.load(Ordering::Relaxed) {
            return PickNote::empty();
        }
        if self.running.load(Ordering::Relaxed) {
            let mut note = PickNote::empty();
            note.during_scan = true;
            return note;
        }
        let mut note = PickNote::empty();
        let mut batch = 0usize;
        for path in paths {
            if path.is_dir() {
                note.folders = note.folders.saturating_add(1);
                if note.folder.is_none() {
                    note.folder = self.offer_dir(path);
                }
                continue;
            }
            if !path.is_file() {
                note.foreign = true;
                continue;
            }
            if batch >= CAP {
                note.skipped = note.skipped.saturating_add(1);
                continue;
            }
            match self.insert_file(path) {
                Insert::Added(file) => {
                    batch += 1;
                    note.files.push(file);
                }
                Insert::Full => note.skipped = note.skipped.saturating_add(1),
                Insert::Skip => note.foreign = true,
            }
        }
        note
    }

    fn insert_file(&self, path: &Path) -> Insert {
        let Ok(mut items) = self.items.lock() else {
            return Insert::Skip;
        };
        if items.len() >= CAP {
            return Insert::Full;
        }
        let Ok(meta) = std::fs::metadata(path) else {
            return Insert::Skip;
        };
        if !meta.is_file() {
            return Insert::Skip;
        }
        let id = fresh_id(&items);
        let name = display_name(path);
        let ext = extension_of(path);
        items.push(Held {
            id,
            path: path.to_path_buf(),
            name: name.clone(),
            ext: ext.clone(),
            purpose: Purpose::PrivacyScan,
            scanned_size: None,
            scanned_modified: None,
        });
        Insert::Added(PickFile {
            id: id_text(id),
            name,
            ext,
        })
    }

    fn clear_items(&self) {
        if let Ok(mut items) = self.items.lock() {
            items.clear();
        }
    }

    fn clear_folder(&self) {
        if let Ok(mut items) = self.folder_items.lock() {
            items.clear();
        }
        if let Ok(mut rows) = self.folder_rows.lock() {
            rows.clear();
        }
        if let Ok(mut summary) = self.folder_summary.lock() {
            *summary = FolderSummary::default();
        }
        if let Ok(mut choice) = self.choice.lock() {
            *choice = None;
        }
    }

    fn offer_dir(&self, path: &Path) -> Option<FolderCard> {
        let raw = path.to_string_lossy();
        if raw.starts_with(r"\\?\") || raw.starts_with(r"\\.\") {
            return Some(self.store_choice(path, "system"));
        }
        let plain = crate::privacy_folder::plain_text(path);
        let ask = judged_ask(&plain);
        Some(self.store_choice(Path::new(&plain), ask))
    }

    fn store_choice(&self, path: &Path, ask: &str) -> FolderCard {
        let id = fresh_id(&[]);
        let name = display_name(path);
        if let Ok(mut slot) = self.choice.lock() {
            *slot = Some(FolderChoice {
                id,
                path: path.to_path_buf(),
                name: name.clone(),
            });
        }
        FolderCard { id: id_text(id), name, ask: ask.to_string() }
    }

    fn held_copy(item: &Held) -> JobCopy {
        JobCopy {
            id: item.id,
            path: item.path.clone(),
            name: item.name.clone(),
            ext: item.ext.clone(),
        }
    }

    fn copies_for(&self, ids: &[String]) -> Result<Vec<JobCopy>, ()> {
        let Ok(items) = self.items.lock() else {
            return Err(());
        };
        let Ok(folder_items) = self.folder_items.lock() else {
            return Err(());
        };
        let mut jobs = Vec::new();
        for id in ids {
            let Some(parsed) = parse_id(id) else {
                return Err(());
            };
            let found = items
                .iter()
                .chain(folder_items.iter())
                .find(|item| item.id == parsed && item.purpose == Purpose::PrivacyScan);
            let Some(item) = found else {
                return Err(());
            };
            jobs.push(Self::held_copy(item));
        }
        Ok(jobs)
    }

    fn mark_scanned(&self, id: u64, size: u64, modified: Option<SystemTime>) {
        for slot in [&self.items, &self.folder_items] {
            if let Ok(mut items) = slot.lock() {
                if let Some(item) = items.iter_mut().find(|item| item.id == id) {
                    item.scanned_size = Some(size);
                    item.scanned_modified = Some(modified);
                    return;
                }
            }
        }
    }

    fn path_of(&self, id: u64) -> Option<PathBuf> {
        for slot in [&self.items, &self.folder_items] {
            if let Ok(items) = slot.lock() {
                if let Some(item) = items.iter().find(|item| item.id == id && item.purpose == Purpose::PrivacyScan) {
                    return Some(item.path.clone());
                }
            }
        }
        None
    }

    fn preview_of(&self, id: u64, places: &[PlaceAsk]) -> Result<Vec<String>, String> {
        let item = {
            let Ok(items) = self.items.lock() else {
                return Err("unknown".into());
            };
            let Ok(folder_items) = self.folder_items.lock() else {
                return Err("unknown".into());
            };
            items
                .iter()
                .chain(folder_items.iter())
                .find(|item| item.id == id && item.purpose == Purpose::PrivacyScan)
                .map(|item| (item.path.clone(), item.scanned_size, item.scanned_modified))
        };
        let Some((path, scanned_size, scanned_modified)) = item else {
            return Err("unknown".into());
        };
        let open = open_path(&path);
        let Ok(meta) = std::fs::metadata(&open) else {
            return Err("changed".into());
        };
        let Some(scanned_size) = scanned_size else {
            return Err("changed".into());
        };
        let Some(scanned_modified) = scanned_modified else {
            return Err("changed".into());
        };
        if meta.len() != scanned_size || meta.modified().ok() != scanned_modified {
            return Err("changed".into());
        }
        let targets = places.iter().filter_map(place_to_target).collect::<Vec<_>>();
        privacy_scan::preview_path_with(&open, &targets, &ReadBudget::standard()).map_err(|_| "failed".to_string())
    }
}

enum Insert {
    Added(PickFile),
    Full,
    Skip,
}

fn fresh_id(items: &[Held]) -> u64 {
    let build = RandomState::new();
    loop {
        let id = build.build_hasher().finish();
        if id != 0 && items.iter().all(|item| item.id != id) {
            return id;
        }
    }
}

fn id_text(id: u64) -> String {
    format!("{id:016x}")
}

fn parse_id(text: &str) -> Option<u64> {
    u64::from_str_radix(text.trim(), 16).ok().filter(|id| *id != 0)
}

fn display_name(path: &Path) -> String {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("파일");
    name.chars().take(120).collect()
}

fn open_path(path: &Path) -> PathBuf {
    crate::privacy_folder::prefixed(&crate::privacy_folder::plain_text(path))
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .chars()
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase()
}

fn track_flag(desk: &FileDesk, flag: Arc<AtomicBool>) {
    if let Ok(mut flags) = desk.flags.lock() {
        flags.push(flag);
    }
}

fn clear_flags(desk: &FileDesk) {
    if let Ok(mut flags) = desk.flags.lock() {
        flags.clear();
    }
}

#[tauri::command]
pub fn privacy_enter(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    desk.stop.store(false, Ordering::Relaxed);
    desk.armed.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn privacy_leave(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    deny_window(&window)?;
    disarm(&app, false);
    Ok(())
}

#[tauri::command]
pub fn privacy_reset(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    if !desk.armed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    desk.stop.store(true, Ordering::Relaxed);
    if let Ok(flags) = desk.flags.lock() {
        for flag in flags.iter() {
            flag.store(true, Ordering::Relaxed);
        }
    }
    desk.clear_items();
    desk.clear_folder();
    Ok(())
}

#[tauri::command]
pub fn privacy_pick(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    if !desk.armed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    if desk.running.load(Ordering::Relaxed) {
        let mut note = PickNote::empty();
        note.during_scan = true;
        let _ = app.emit(PICK_EVENT, note);
        return Ok(());
    }
    let app2 = app.clone();
    app.dialog()
        .file()
        .set_parent(&window)
        .set_title("검사할 파일")
        .add_filter(
            "문서",
            &["txt", "csv", "md", "xlsx", "docx", "hwpx", "pdf", "hwp", "jpg", "jpeg", "png"],
        )
        .pick_files(move |picked| {
            let note = match picked {
                Some(files) => {
                    let paths = files.into_iter().filter_map(|file| file.into_path().ok()).collect::<Vec<_>>();
                    app2.state::<FileDesk>().take_paths(&paths)
                }
                None => PickNote::empty(),
            };
            let _ = app2.emit(PICK_EVENT, note);
        });
    Ok(())
}

#[tauri::command]
pub fn privacy_pick_folder(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    if !desk.armed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    if desk.running.load(Ordering::Relaxed) {
        let mut note = PickNote::empty();
        note.during_scan = true;
        let _ = app.emit(PICK_EVENT, note);
        return Ok(());
    }
    let app2 = app.clone();
    app.dialog().file().set_parent(&window).set_title("검사할 폴더").pick_folder(move |picked| {
        let note = match picked.and_then(|file| file.into_path().ok()) {
            Some(path) => app2.state::<FileDesk>().take_paths(&[path]),
            None => PickNote::empty(),
        };
        let _ = app2.emit(PICK_EVENT, note);
    });
    Ok(())
}

#[tauri::command]
pub fn privacy_folder_begin(app: AppHandle, window: WebviewWindow, id: String, subfolders: bool, confirmed: bool) -> Result<(), String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    if !desk.armed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    if desk.running.swap(true, Ordering::AcqRel) {
        return Err("busy".into());
    }
    let choice = {
        let Ok(slot) = desk.choice.lock() else {
            desk.running.store(false, Ordering::Relaxed);
            return Err("unknown".into());
        };
        let Some(choice) = slot.clone() else {
            desk.running.store(false, Ordering::Relaxed);
            return Err("unknown".into());
        };
        choice
    };
    if id_text(choice.id) != id.trim() {
        desk.running.store(false, Ordering::Relaxed);
        return Err("unknown".into());
    }
    let ask = judged_ask(&crate::privacy_folder::plain_text(&choice.path));
    if matches!(ask, "system" | "root" | "link") {
        desk.running.store(false, Ordering::Relaxed);
        return Err(ask.into());
    }
    if matches!(ask, "slow" | "removable" | "network") && !confirmed {
        desk.running.store(false, Ordering::Relaxed);
        return Err("confirm".into());
    }
    desk.stop.store(false, Ordering::Relaxed);
    clear_flags(&desk);
    if let Ok(mut rows) = desk.folder_rows.lock() {
        rows.clear();
    }
    if let Ok(mut items) = desk.folder_items.lock() {
        items.clear();
    }
    let stop = Arc::clone(&desk.stop);
    thread::spawn(move || run_folder(app, choice, subfolders, stop));
    Ok(())
}

#[tauri::command]
pub fn privacy_folder_page(app: AppHandle, window: WebviewWindow, grade: String, page: u32, size: u32) -> Result<FolderPage, String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    if !desk.armed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    let size = size.clamp(1, 100) as usize;
    let page = page.max(1) as usize;
    let rows = desk.folder_rows.lock().map_err(|_| "unknown")?;
    let summary = desk.folder_summary.lock().map_err(|_| "unknown")?.clone();
    let matched = rows
        .iter()
        .filter(|row| grade == "all" || row.note.grade == grade)
        .collect::<Vec<_>>();
    let start = (page - 1).saturating_mul(size).min(matched.len());
    let end = start.saturating_add(size).min(matched.len());
    Ok(FolderPage {
        rows: matched[start..end]
            .iter()
            .map(|row| FolderLine {
                id: row.note.id.clone(),
                place: row.place.clone(),
                file: row.note.clone(),
            })
            .collect(),
        total: matched.len() as u32,
        overflow: summary.overflow,
        summary,
    })
}

#[tauri::command]
pub fn privacy_scan(app: AppHandle, window: WebviewWindow, ids: Vec<String>) -> Result<(), String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    if !desk.armed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    if desk.running.swap(true, Ordering::AcqRel) {
        return Err("busy".into());
    }
    let jobs = match desk.copies_for(&ids) {
        Ok(jobs) => jobs,
        Err(()) => {
            desk.running.store(false, Ordering::Relaxed);
            return Err("unknown".into());
        }
    };
    desk.stop.store(false, Ordering::Relaxed);
    clear_flags(&desk);
    let stop = Arc::clone(&desk.stop);
    thread::spawn(move || {
        run_scan(app, jobs, stop);
    });
    Ok(())
}

#[tauri::command]
pub fn privacy_stop(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    desk.stop.store(true, Ordering::Relaxed);
    if let Ok(flags) = desk.flags.lock() {
        for flag in flags.iter() {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn privacy_preview(app: AppHandle, window: WebviewWindow, id: String, places: Vec<PlaceAsk>) -> Result<Vec<String>, String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    if !desk.armed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    let Some(parsed) = parse_id(&id) else {
        return Err("unknown".into());
    };
    desk.preview_of(parsed, &places)
}

#[tauri::command]
pub fn privacy_reveal(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    deny_window(&window)?;
    let desk = app.state::<FileDesk>();
    if !desk.armed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    let Some(parsed) = parse_id(&id) else {
        return Err("unknown".into());
    };
    let Some(path) = desk.path_of(parsed) else {
        return Err("unknown".into());
    };
    app.opener().reveal_item_in_dir(path).map_err(|_| "failed".to_string())
}

fn scan_job(job: JobCopy, flag: Arc<AtomicBool>) -> FileNote {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if flag.load(Ordering::Relaxed) {
            return privacy_scan::ScanResult::failed(privacy_scan::ReasonCode::TimedOut);
        }
        privacy_scan::scan_path_halt(&open_path(&job.path), &ReadBudget::standard(), &flag)
    }));
    match outcome {
        Ok(result) => note_from_scan(&job, result),
        Err(_) => note_failed(&job, "parserPanic"),
    }
}

fn note_from_scan(job: &JobCopy, result: privacy_scan::ScanResult) -> FileNote {
    use privacy_scan::{ExtractStatus, Grade};
    let grade = match result.grade {
        Grade::High => "high",
        Grade::Possible => "possible",
        Grade::Clear => "clear",
        Grade::Incomplete => "incomplete",
        Grade::Unavailable => "unavailable",
    };
    let status = match result.status {
        ExtractStatus::Complete => "complete",
        ExtractStatus::Partial => "partial",
        ExtractStatus::Failed => "failed",
    };
    FileNote {
        id: id_text(job.id),
        name: job.name.clone(),
        ext: job.ext.clone(),
        grade: grade.into(),
        status: status.into(),
        types: result
            .types
            .iter()
            .map(|item| TypeNote {
                kind: kind_code(item.kind).into(),
                count: item.count,
                places: item.places_owned(),
                overflow: item.overflow,
            })
            .collect(),
        combos: result
            .combos
            .iter()
            .map(|item| ComboNote {
                label: item.label.to_string(),
                records: item.records,
            })
            .collect(),
        reference_count: result.reference_count,
        hidden: result.hidden_notice.is_some(),
        partial: result.status == ExtractStatus::Partial,
        reason: result.reason.map(reason_code),
    }
}

fn note_failed(job: &JobCopy, reason: &str) -> FileNote {
    FileNote {
        id: id_text(job.id),
        name: job.name.clone(),
        ext: job.ext.clone(),
        grade: "unavailable".into(),
        status: "failed".into(),
        types: Vec::new(),
        combos: Vec::new(),
        reference_count: 0,
        hidden: false,
        partial: false,
        reason: Some(reason.into()),
    }
}

trait PlacesOwned {
    fn places_owned(&self) -> Vec<PlaceNote>;
}

impl PlacesOwned for privacy_scan::TypeCount {
    fn places_owned(&self) -> Vec<PlaceNote> {
        self.locations.iter().take(100).map(|place| place_note(kind_code(self.kind), place)).collect()
    }
}

fn kind_code(kind: privacy_scan::FindingKind) -> &'static str {
    use privacy_scan::FindingKind;
    match kind {
        FindingKind::Rrn => "rrn",
        FindingKind::Account => "account",
        FindingKind::Mobile => "mobile",
        FindingKind::Landline => "landline",
        FindingKind::Email => "email",
        FindingKind::Address => "address",
        FindingKind::Birth => "birth",
        FindingKind::Ip => "ip",
    }
}

fn reason_code(reason: privacy_scan::ReasonCode) -> String {
    use privacy_scan::ReasonCode;
    match reason {
        ReasonCode::Unsupported => "unsupported",
        ReasonCode::TooLarge => "tooLarge",
        ReasonCode::Damaged => "damaged",
        ReasonCode::Encrypted => "encrypted",
        ReasonCode::UnzipLimit => "unzipLimit",
        ReasonCode::ScannedPdf => "scannedPdf",
        ReasonCode::WeakPdf => "weakPdf",
        ReasonCode::DecodeFailed => "decodeFailed",
        ReasonCode::FormulaGap => "formulaGap",
        ReasonCode::ParserPanic => "parserPanic",
        ReasonCode::Io => "io",
        ReasonCode::Missing => "missing",
        ReasonCode::TimedOut => "timedOut",
        ReasonCode::Denied => "denied",
    }
    .into()
}

fn place_note(finding: &str, place: &privacy_scan::Location) -> PlaceNote {
    use privacy_scan::Location;
    match place {
        Location::Line { line } => PlaceNote {
            kind: "line".into(),
            finding: finding.into(),
            a: *line,
            b: 0,
            c: 0,
            label: format!("{line}줄"),
        },
        Location::SheetCell { sheet, row, col } => PlaceNote {
            kind: "sheet".into(),
            finding: finding.into(),
            a: *sheet,
            b: *row,
            c: *col,
            label: format!("{sheet}시트 {row}행 {col}열"),
        },
        Location::Paragraph { index } => PlaceNote {
            kind: "paragraph".into(),
            finding: finding.into(),
            a: *index,
            b: 0,
            c: 0,
            label: format!("{index}문단"),
        },
        Location::TableCell { table, row, col } => PlaceNote {
            kind: "table".into(),
            finding: finding.into(),
            a: *table,
            b: *row,
            c: *col,
            label: format!("{table}표 {row}행 {col}열"),
        },
        Location::Page { page, line } => PlaceNote {
            kind: "page".into(),
            finding: finding.into(),
            a: *page,
            b: *line,
            c: 0,
            label: format!("{page}페이지 {line}줄"),
        },
    }
}

fn place_to_target(place: &PlaceAsk) -> Option<privacy_scan::PreviewTarget> {
    use privacy_scan::{FindingKind, Location, PreviewTarget};
    let kind = match place.finding.as_str() {
        "rrn" => FindingKind::Rrn,
        "account" => FindingKind::Account,
        "mobile" => FindingKind::Mobile,
        "landline" => FindingKind::Landline,
        "email" => FindingKind::Email,
        "address" => FindingKind::Address,
        "birth" => FindingKind::Birth,
        "ip" => FindingKind::Ip,
        _ => return None,
    };
    let location = match place.kind.as_str() {
        "line" => Location::Line { line: place.a },
        "sheet" => Location::SheetCell { sheet: place.a, row: place.b, col: place.c },
        "paragraph" => Location::Paragraph { index: place.a },
        "table" => Location::TableCell { table: place.a, row: place.b, col: place.c },
        "page" => Location::Page { page: place.a, line: place.b },
        _ => return None,
    };
    Some(PreviewTarget { kind, location })
}

struct Slot<T> {
    flag: Arc<AtomicBool>,
    started: Instant,
    handle: JoinHandle<T>,
}

fn drive_jobs<T, R, Work, Done>(jobs: Vec<T>, limit: Duration, stop: &AtomicBool, work: Work, mut done: Done) -> usize
where
    T: Send + 'static,
    R: Send + 'static,
    Work: Fn(T, Arc<AtomicBool>) -> R + Send + Sync + 'static,
    Done: FnMut(R),
{
    let work = Arc::new(work);
    let mut pending = jobs.into_iter();
    let mut live: Vec<Slot<R>> = Vec::new();
    let mut finished = 0usize;
    let total_started = AtomicUsize::new(0);
    loop {
        if stop.load(Ordering::Relaxed) {
            for slot in &live {
                slot.flag.store(true, Ordering::Relaxed);
            }
        }
        while live.len() < WORKERS {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let Some(job) = pending.next() else {
                break;
            };
            let flag = Arc::new(AtomicBool::new(false));
            let flag_for_job = Arc::clone(&flag);
            let work = Arc::clone(&work);
            let handle = thread::spawn(move || work(job, flag_for_job));
            live.push(Slot { flag, started: Instant::now(), handle });
            total_started.fetch_add(1, Ordering::Relaxed);
        }
        if live.is_empty() {
            break;
        }
        thread::sleep(Duration::from_millis(10));
        let mut index = 0;
        while index < live.len() {
            if live[index].started.elapsed() >= limit {
                live[index].flag.store(true, Ordering::Relaxed);
            }
            if live[index].handle.is_finished() {
                let slot = live.remove(index);
                if let Ok(value) = slot.handle.join() {
                    done(value);
                    finished += 1;
                }
            } else {
                index += 1;
            }
        }
    }
    let _ = total_started;
    finished
}

pub fn foreign_drop(app: &AppHandle) {
    let _ = app.emit(PICK_EVENT, PickNote::only_files());
}

fn remember_scan(app: &AppHandle, id: u64, size: u64, modified: Option<SystemTime>) {
    if let Some(desk) = app.try_state::<FileDesk>() {
        desk.mark_scanned(id, size, modified);
    }
}

fn scan_job_with_mark(app: &AppHandle, job: JobCopy, flag: Arc<AtomicBool>) -> FileNote {
    if let Some(desk) = app.try_state::<FileDesk>() {
        track_flag(&desk, Arc::clone(&flag));
    }
    let meta = std::fs::metadata(open_path(&job.path)).ok();
    let size = meta.as_ref().map(|item| item.len()).unwrap_or(0);
    let modified = meta.and_then(|item| item.modified().ok());
    remember_scan(app, job.id, size, modified);
    scan_job(job, flag)
}

fn run_scan(app: AppHandle, jobs: Vec<JobCopy>, stop: Arc<AtomicBool>) {
    let total = jobs.len() as u32;
    let mut done = 0u32;
    let app_for_jobs = app.clone();
    drive_jobs(
        jobs,
        FILE_LIMIT,
        &stop,
        move |job, flag| scan_job_with_mark(&app_for_jobs, job, flag),
        |note| {
            done = done.saturating_add(1);
            let _ = app.emit(
                PROGRESS_EVENT,
                ProgressNote {
                    done,
                    total,
                    finished: false,
                    stopped: false,
                    current_name: note.name.clone(),
                    file: Some(note),
                },
            );
        },
    );
    if let Some(desk) = app.try_state::<FileDesk>() {
        desk.running.store(false, Ordering::Relaxed);
        clear_flags(&desk);
    }
    let _ = app.emit(
        PROGRESS_EVENT,
        ProgressNote {
            done,
            total,
            finished: true,
            stopped: stop.load(Ordering::Relaxed),
            current_name: String::new(),
        file: None,
    },
);
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct FolderSummary {
    listed: u32,
    high: u32,
    possible: u32,
    clear: u32,
    incomplete: u32,
    unavailable: u32,
    cloud_files: u32,
    links: u32,
    other_links: u32,
    system_dirs: u32,
    hidden_system: u32,
    unsupported: u32,
    hwp: u32,
    images: u32,
    too_large: u32,
    overflow: u32,
    truncated: bool,
    stopped: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderLine {
    id: String,
    place: String,
    file: FileNote,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPage {
    rows: Vec<FolderLine>,
    total: u32,
    overflow: u32,
    summary: FolderSummary,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderPulse {
    phase: String,
    listed: u32,
    done: u32,
    total: u32,
    current_name: String,
    stopped: bool,
    truncated: bool,
    summary: Option<FolderSummary>,
}

fn judged_ask(plain: &str) -> &'static str {
    #[cfg(windows)]
    {
        let known = crate::privacy_folder::known_roots();
        return crate::privacy_folder::judge(plain, &known).code();
    }
    #[cfg(not(windows))]
    {
        let _ = plain;
        "start"
    }
}

fn grade_rank(grade: &str) -> u8 {
    match grade {
        "high" => 0,
        "possible" => 1,
        "incomplete" => 2,
        "unavailable" => 3,
        _ => 4,
    }
}

fn bump_grade(summary: &mut FolderSummary, grade: &str) {
    match grade {
        "high" => summary.high = summary.high.saturating_add(1),
        "possible" => summary.possible = summary.possible.saturating_add(1),
        "clear" => summary.clear = summary.clear.saturating_add(1),
        "incomplete" => summary.incomplete = summary.incomplete.saturating_add(1),
        _ => summary.unavailable = summary.unavailable.saturating_add(1),
    }
}

struct Kept {
    place: String,
    note: FileNote,
    held: Held,
}

fn run_folder(app: AppHandle, choice: FolderChoice, subfolders: bool, stop: Arc<AtomicBool>) {
    let mut summary = FolderSummary::default();
    let mut kept: Vec<Kept> = Vec::new();
    #[cfg(windows)]
    {
        let known = crate::privacy_folder::known_roots();
        let plain = crate::privacy_folder::plain_text(&choice.path);
        let opts = crate::privacy_folder::WalkOpts { subfolders, known: &known, folder_name: &choice.name };
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        let (seen, counts) = crate::privacy_folder::walk(Path::new(&plain), &opts, &stop, |listed| {
            if last_emit.elapsed() >= Duration::from_millis(200) {
                last_emit = Instant::now();
                let _ = app.emit(
                    FOLDER_EVENT,
                    FolderPulse {
                        phase: "list".into(),
                        listed,
                        done: 0,
                        total: 0,
                        current_name: String::new(),
                        stopped: false,
                        truncated: false,
                        summary: None,
                    },
                );
            }
        });
        summary.listed = counts.listed;
        summary.cloud_files = counts.cloud_files;
        summary.links = counts.link_dirs;
        summary.other_links = counts.other_links;
        summary.system_dirs = counts.system_dirs;
        summary.hidden_system = counts.hidden_system;
        summary.unsupported = counts.unsupported;
        summary.hwp = counts.hwp;
        summary.images = counts.images;
        summary.too_large = counts.too_large;
        summary.truncated = counts.truncated;
        summary.stopped = counts.stopped;
        let mut jobs = Vec::new();
        for item in seen {
            let id = fresh_id(&[]);
            let job = JobCopy { id, path: item.path.clone(), name: item.name.clone(), ext: item.ext.clone() };
            match item.kind {
                crate::privacy_folder::FileKind::Scan => jobs.push((item.place, job)),
                crate::privacy_folder::FileKind::Hwp | crate::privacy_folder::FileKind::Image => {
                    let note = note_failed(&job, "unsupported");
                    bump_grade(&mut summary, &note.grade);
                    kept.push(kept_from(item.place, note, &job));
                }
                crate::privacy_folder::FileKind::TooLarge => {
                    let note = note_failed(&job, "tooLarge");
                    bump_grade(&mut summary, &note.grade);
                    kept.push(kept_from(item.place, note, &job));
                }
                _ => {}
            }
        }
        let total = jobs.len() as u32;
        let mut done = 0u32;
        let mut last_scan = Instant::now() - Duration::from_secs(1);
        drive_ext_jobs(jobs, FILE_LIMIT, &stop, &app, |note, place, path, size, modified| {
            done = done.saturating_add(1);
            bump_grade(&mut summary, &note.grade);
            let name = note.name.clone();
            if note.grade != "clear" {
                let id = parse_id(&note.id).unwrap_or(0);
                kept.push(Kept {
                    place,
                    held: Held {
                        id,
                        path,
                        name: note.name.clone(),
                        ext: note.ext.clone(),
                        purpose: Purpose::PrivacyScan,
                        scanned_size: size,
                        scanned_modified: Some(modified),
                    },
                    note,
                });
            }
            if last_scan.elapsed() >= Duration::from_millis(200) || done == total {
                last_scan = Instant::now();
                let _ = app.emit(
                    FOLDER_EVENT,
                    FolderPulse {
                        phase: "scan".into(),
                        listed: summary.listed,
                        done,
                        total,
                        current_name: name.clone(),
                        stopped: false,
                        truncated: summary.truncated,
                        summary: None,
                    },
                );
            }
        });
        let _ = done;
    }
    finish_folder(&app, &mut summary, &stop, kept);
}

fn kept_from(place: String, note: FileNote, job: &JobCopy) -> Kept {
    Kept {
        place,
        note,
        held: Held {
            id: job.id,
            path: job.path.clone(),
            name: job.name.clone(),
            ext: job.ext.clone(),
            purpose: Purpose::PrivacyScan,
            scanned_size: Some(0),
            scanned_modified: Some(None),
        },
    }
}

struct ExtSlot {
    ext: String,
    flag: Arc<AtomicBool>,
    started: Instant,
    handle: JoinHandle<(FileNote, String, PathBuf, Option<u64>, Option<SystemTime>)>,
}

fn drive_ext_jobs<Done>(
    jobs: Vec<(String, JobCopy)>,
    limit: Duration,
    stop: &AtomicBool,
    app: &AppHandle,
    mut done: Done,
) where
    Done: FnMut(FileNote, String, PathBuf, Option<u64>, Option<SystemTime>),
{
    let mut pending: Vec<(String, JobCopy)> = jobs.into_iter().rev().collect();
    let mut live: Vec<ExtSlot> = Vec::new();
    loop {
        if stop.load(Ordering::Relaxed) {
            for slot in &live {
                slot.flag.store(true, Ordering::Relaxed);
            }
        }
        let stuck = live.len() >= WORKERS
            && live.iter().all(|slot| slot.started.elapsed() >= limit && !slot.handle.is_finished())
            && live.iter().all(|slot| slot.ext == live[0].ext);
        if stuck {
            let ext = live[0].ext.clone();
            let mut index = 0;
            while index < pending.len() {
                if pending[index].1.ext.eq_ignore_ascii_case(&ext) {
                    let (place, job) = pending.remove(index);
                    let path = job.path.clone();
                    done(note_failed(&job, "timedOut"), place, path, None, None);
                } else {
                    index += 1;
                }
            }
        }
        while live.len() < WORKERS && !stop.load(Ordering::Relaxed) {
            let Some((place, job)) = pending.pop() else {
                break;
            };
            if stuck && job.ext.eq_ignore_ascii_case(&live.first().map(|slot| slot.ext.as_str()).unwrap_or("")) {
                let path = job.path.clone();
                done(note_failed(&job, "timedOut"), place, path, None, None);
                continue;
            }
            let flag = Arc::new(AtomicBool::new(false));
            let flag_for_job = Arc::clone(&flag);
            let app = app.clone();
            let ext = job.ext.clone();
            let handle = thread::spawn(move || {
                let meta = std::fs::metadata(open_path(&job.path)).ok();
                let size = meta.as_ref().map(|item| item.len());
                let modified = meta.and_then(|item| item.modified().ok());
                if let Some(desk) = app.try_state::<FileDesk>() {
                    track_flag(&desk, Arc::clone(&flag_for_job));
                }
                let note = scan_job(job.clone_job(), flag_for_job);
                (note, place, job.path, size, modified)
            });
            live.push(ExtSlot { ext, flag, started: Instant::now(), handle });
        }
        if live.is_empty() {
            if stop.load(Ordering::Relaxed) {
                while let Some((place, job)) = pending.pop() {
                    let path = job.path.clone();
                    done(note_failed(&job, "timedOut"), place, path, None, None);
                }
            }
            break;
        }
        thread::sleep(Duration::from_millis(10));
        let mut index = 0;
        while index < live.len() {
            if live[index].started.elapsed() >= limit {
                live[index].flag.store(true, Ordering::Relaxed);
            }
            if live[index].handle.is_finished() {
                let slot = live.remove(index);
                if let Ok((note, place, path, size, modified)) = slot.handle.join() {
                    done(note, place, path, size, modified);
                }
            } else {
                index += 1;
            }
        }
    }
}

fn finish_folder(app: &AppHandle, summary: &mut FolderSummary, stop: &AtomicBool, mut kept: Vec<Kept>) {
    if stop.load(Ordering::Relaxed) {
        summary.stopped = true;
    }
    kept.sort_by(|left, right| left.note.grade_rank_cmp(&right.note).then_with(|| left.place.cmp(&right.place)));
    if kept.len() > FOLDER_CAP {
        summary.overflow = (kept.len() - FOLDER_CAP) as u32;
        kept.truncate(FOLDER_CAP);
    }
    if let Some(desk) = app.try_state::<FileDesk>() {
        if let Ok(mut items) = desk.folder_items.lock() {
            items.clear();
            items.extend(kept.iter().map(|item| Held {
                id: item.held.id,
                path: item.held.path.clone(),
                name: item.held.name.clone(),
                ext: item.held.ext.clone(),
                purpose: Purpose::PrivacyScan,
                scanned_size: item.held.scanned_size,
                scanned_modified: item.held.scanned_modified,
            }));
        }
        if let Ok(mut rows) = desk.folder_rows.lock() {
            *rows = kept
                .iter()
                .map(|item| FolderRow {
                    place: item.place.clone(),
                    note: item.note.clone(),
                })
                .collect();
        }
        if let Ok(mut stored) = desk.folder_summary.lock() {
            *stored = summary.clone();
        }
        desk.running.store(false, Ordering::Relaxed);
        clear_flags(&desk);
    }
    let _ = app.emit(
        FOLDER_EVENT,
        FolderPulse {
            phase: "done".into(),
            listed: summary.listed,
            done: summary.high + summary.possible + summary.clear + summary.incomplete + summary.unavailable,
            total: summary.high + summary.possible + summary.clear + summary.incomplete + summary.unavailable,
            current_name: String::new(),
            stopped: summary.stopped,
            truncated: summary.truncated,
            summary: Some(summary.clone()),
        },
    );
}

trait GradeOrder {
    fn grade_rank_cmp(&self, other: &Self) -> std::cmp::Ordering;
}

impl GradeOrder for FileNote {
    fn grade_rank_cmp(&self, other: &Self) -> std::cmp::Ordering {
        grade_rank(&self.grade).cmp(&grade_rank(&other.grade))
    }
}

trait CloneJob {
    fn clone_job(&self) -> Self;
}

impl CloneJob for JobCopy {
    fn clone_job(&self) -> Self {
        Self { id: self.id, path: self.path.clone(), name: self.name.clone(), ext: self.ext.clone() }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::AtomicUsize;

    use super::*;

    #[test]
    fn only_main_window_is_allowed() {
        assert!(caller_allowed("main"));
        assert!(!caller_allowed("work-map"));
        assert!(!caller_allowed("memo-pad"));
        assert!(!caller_allowed(""));
        assert!(!caller_allowed("Main"));
    }

    #[test]
    fn store_keeps_two_hundred_and_forgets_unknown_ids() {
        let desk = FileDesk::new();
        desk.armed.store(true, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("privacy-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("가짜.txt");
        std::fs::write(&path, "가짜 테스트 데이터").unwrap();
        let mut added = 0usize;
        let mut last = String::new();
        for _ in 0..201 {
            match desk.insert_file(&path) {
                Insert::Added(file) => {
                    added += 1;
                    last = file.id;
                }
                Insert::Full => {}
                Insert::Skip => panic!("file"),
            }
        }
        assert_eq!(added, 200);
        let extra = desk.take_paths(&[path.clone()]);
        assert!(extra.skipped >= 1);
        assert!(extra.files.is_empty());
        assert!(desk.copies_for(&["없음".into()]).is_err());
        desk.clear_items();
        assert!(desk.copies_for(&[last]).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn event_note_has_no_path_raw_or_score() {
        let body = "이름,전화\n가짜,010-0000-1111\n";
        let scanned = crate::privacy_scan::scan_bytes("csv", body.as_bytes(), &ReadBudget::standard());
        let note = note_from_scan(
            &JobCopy {
                id: 7,
                path: PathBuf::from("C:\\숨김\\가짜연락.csv"),
                name: "가짜연락.csv".into(),
                ext: "csv".into(),
            },
            scanned,
        );
        let json = serde_json::to_string(&note).unwrap();
        assert!(!json.contains("010-0000-1111"));
        assert!(!json.contains("숨김"));
        assert!(!json.contains("\"path\""));
        assert!(!json.contains("\"score\""));
        assert!(!json.contains("\"raw\""));
        assert!(json.contains("가짜연락.csv"));
    }

    #[test]
    fn preview_masks_until_the_file_changes() {
        let dir = std::env::temp_dir().join(format!("privacy-preview-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("가짜연락.csv");
        let body = "이름,전화\n가짜,010-0000-1111\n";
        std::fs::write(&path, body).unwrap();
        let desk = FileDesk::new();
        desk.armed.store(true, Ordering::Relaxed);
        let Insert::Added(file) = desk.insert_file(&path) else {
            panic!("insert");
        };
        let id = parse_id(&file.id).unwrap();
        let meta = std::fs::metadata(&path).unwrap();
        desk.mark_scanned(id, meta.len(), meta.modified().ok());
        let scanned = crate::privacy_scan::scan_path(&path);
        let places = places_of(&scanned);
        assert!(!places.is_empty());
        let masks = desk.preview_of(id, &places).unwrap();
        let joined = masks.join("\n");
        assert!(!joined.contains("010-0000-1111"));
        assert!(joined.contains('*'));
        std::fs::write(&path, format!("{body}바뀜\n")).unwrap();
        assert_eq!(desk.preview_of(id, &places).unwrap_err(), "changed");
        desk.clear_items();
        assert_eq!(desk.preview_of(id, &places).unwrap_err(), "unknown");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn timeout_returns_worker_slots() {
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let stop = AtomicBool::new(false);
        let active_job = Arc::clone(&active);
        let peak_job = Arc::clone(&peak);
        let finished = drive_jobs(
            vec![1, 2, 3, 4],
            Duration::from_millis(40),
            &stop,
            move |_job, flag| {
                let now = active_job.fetch_add(1, Ordering::SeqCst) + 1;
                peak_job.fetch_max(now, Ordering::SeqCst);
                while !flag.load(Ordering::Relaxed) {
                    thread::sleep(Duration::from_millis(5));
                }
                active_job.fetch_sub(1, Ordering::SeqCst);
            },
            |_| {},
        );
        assert_eq!(finished, 4);
        assert_eq!(active.load(Ordering::SeqCst), 0);
        assert!(peak.load(Ordering::SeqCst) <= WORKERS);
        assert!(peak.load(Ordering::SeqCst) >= 1);
    }

    #[test]
    fn folder_line_hides_the_full_path() {
        let line = FolderLine {
            id: "0000000000000007".into(),
            place: "학생지원\\2026\\명단.xlsx".into(),
            file: note_failed(
                &JobCopy {
                    id: 7,
                    path: PathBuf::from("C:\\숨김\\명단.xlsx"),
                    name: "명단.xlsx".into(),
                    ext: "xlsx".into(),
                },
                "tooLarge",
            ),
        };
        let json = serde_json::to_string(&line).unwrap();
        assert!(!json.contains("숨김"));
        assert!(!json.contains("\"path\""));
        assert!(!json.contains("\"score\""));
        assert!(!json.contains("\"raw\""));
        assert!(json.contains("학생지원\\\\2026\\\\명단.xlsx") || json.contains("학생지원\\2026\\명단.xlsx"));
    }

    fn places_of(result: &crate::privacy_scan::ScanResult) -> Vec<PlaceAsk> {
        let mut places = Vec::new();
        for item in &result.types {
            let finding = kind_code(item.kind);
            for place in &item.locations {
                let (kind, a, b, c) = match place {
                    crate::privacy_scan::Location::Line { line } => ("line", *line, 0, 0),
                    crate::privacy_scan::Location::SheetCell { sheet, row, col } => ("sheet", *sheet, *row, *col),
                    crate::privacy_scan::Location::Paragraph { index } => ("paragraph", *index, 0, 0),
                    crate::privacy_scan::Location::TableCell { table, row, col } => ("table", *table, *row, *col),
                    crate::privacy_scan::Location::Page { page, line } => ("page", *page, *line, 0),
                };
                places.push(PlaceAsk {
                    kind: kind.into(),
                    finding: finding.into(),
                    a,
                    b,
                    c,
                });
            }
        }
        places
    }
}
