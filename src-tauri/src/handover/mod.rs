//! 업무 폴더를 읽어 업무 카드를 만든다. 모델 연결은 다음 단계이다.
//! 원본 폴더는 읽기만 하고, 결과 위치는 원본 안이면 거부한다.

pub(crate) mod assist;
mod marks;
mod ratio;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::document_search::extract::{extract_card_body, ExtractNote};
use crate::path_grant::{self, GrantBook, GrantOrigin, GrantUse};
use crate::privacy_folder::{self, DirKind, FileKind};
use crate::privacy_scan::read::decode::decode_bytes;

use marks::{marks_from_name, marks_from_text, tidy_title, DateMark, MarkKind, MarkSource, WEIGHT_MODIFIED};

pub const OLD_HWP_NOTE: &str = "구형 한글 문서는 읽지 않습니다. HWPX로 저장한 파일을 폴더에 넣어 주세요.";
pub const FILE_CAP: usize = 5_000;
pub const DEPTH_CAP: u32 = 12;
pub const BYTE_CAP: u64 = 50 * 1024 * 1024;
pub const TIME_CAP: Duration = Duration::from_secs(180);

const CARD_EXTS: &[&str] = &["hwpx", "hwp", "pdf", "xlsx", "docx", "txt", "md", "csv"];
static HALT: AtomicBool = AtomicBool::new(false);
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CardBatch {
    pub file_count: usize,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub notice: Option<String>,
    #[serde(default)]
    pub reviewed_at: Option<String>,
    pub tasks: Vec<WorkCard>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkCard {
    pub name: String,
    #[serde(default)]
    pub ai_name: Option<String>,
    #[serde(default)]
    pub ai_open: bool,
    pub months: Vec<u32>,
    pub period: String,
    pub confidence: String,
    pub years: Vec<u32>,
    pub deadlines: Vec<Deadline>,
    pub todos: Vec<String>,
    #[serde(default)]
    pub todo_open: Vec<bool>,
    pub orgs: Vec<String>,
    #[serde(default)]
    pub org_open: Vec<bool>,
    pub files: Vec<WorkFile>,
    pub include: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Deadline {
    pub month: u32,
    pub day: u32,
    pub year: Option<u32>,
    pub file: String,
    pub snippet: String,
    #[serde(default)]
    pub from_model: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkFile {
    pub rel: String,
    pub modified: String,
    pub error: Option<String>,
    #[serde(default)]
    pub clues: Vec<DateMark>,
}

pub fn reject_result_inside_source(source: &Path, result: &Path) -> Result<(), &'static str> {
    let source = path_chain(source);
    let result = path_chain(result);
    if source.is_empty() || result.is_empty() {
        return Err("결과 폴더는 원본 폴더 바깥이어야 합니다.");
    }
    if result == source || result.starts_with(&source) {
        return Err("결과 폴더는 원본 폴더 바깥이어야 합니다.");
    }
    Ok(())
}

pub fn remember_work_folder(book: &GrantBook, path: &Path) -> Result<String, &'static str> {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("folder");
    let id = book.issue(GrantUse::WorkFolder, path, name, "dir", GrantOrigin::Dialog)?;
    Ok(path_grant::id_text(id))
}

struct ScanLimit {
    files: usize,
    depth: u32,
    bytes: u64,
    started: Instant,
    budget: Duration,
}

struct ScanFlag {
    files: bool,
    depth: bool,
    time: bool,
    halted: bool,
}

fn default_limit() -> ScanLimit {
    ScanLimit { files: FILE_CAP, depth: DEPTH_CAP, bytes: BYTE_CAP, started: Instant::now(), budget: TIME_CAP }
}

pub fn read_work_cards(book: &GrantBook, id: &str) -> Result<CardBatch, String> {
    let root = path_grant::view_work_folder(book, id).map_err(|_| "폴더를 찾지 못했습니다.".to_string())?;
    let idle = AtomicBool::new(false);
    scan_folder(&root, &default_limit(), &idle, &|_, _| {})
}

fn scan_folder(root: &Path, limit: &ScanLimit, halt: &AtomicBool, progress: &dyn Fn(u32, u32)) -> Result<CardBatch, String> {
    let (found, mut flag) = list_work_files(root, limit, halt)?;
    let total = found.len() as u32;
    progress(0, total);
    let mut files = Vec::new();
    for (index, item) in found.into_iter().enumerate() {
        if halt.load(Ordering::Relaxed) {
            flag.halted = true;
            break;
        }
        if limit.started.elapsed() >= limit.budget {
            flag.time = true;
            break;
        }
        files.push(read_one(root, &item));
        progress((index as u32) + 1, total);
    }
    files.sort_by(|left, right| path_chain(Path::new(&left.rel)).cmp(&path_chain(Path::new(&right.rel))));
    let mut tasks: Vec<WorkCard> = group_files(files).into_iter().map(|(name, group)| build_card(name, group)).collect();
    tasks.sort_by(|left, right| {
        let left_month = left.months.first().copied().unwrap_or(13);
        let right_month = right.months.first().copied().unwrap_or(13);
        left_month.cmp(&right_month).then_with(|| left.name.cmp(&right.name))
    });
    let file_count = tasks.iter().map(|task| task.files.len()).sum();
    Ok(CardBatch {
        file_count,
        model: None,
        notice: scan_notice(&flag, limit),
        reviewed_at: None,
        tasks,
    })
}

fn scan_notice(flag: &ScanFlag, limit: &ScanLimit) -> Option<String> {
    if flag.halted {
        return Some("중지했습니다.".to_string());
    }
    if flag.files {
        return Some(format!("파일이 많아 처음 {}개까지만 분석했습니다.", limit.files));
    }
    if flag.time {
        return Some("시간이 길어 그때까지 읽은 파일만 분석했습니다.".to_string());
    }
    if flag.depth {
        return Some(format!("폴더가 깊어 {}단계까지만 분석했습니다.", limit.depth));
    }
    None
}

pub fn months_without_modified(card: &WorkCard) -> Vec<u32> {
    month_list(&card.files, true).0
}

#[tauri::command]
pub async fn pick_work_folder(app: AppHandle, window: WebviewWindow) -> Result<String, String> {
    if window.label() != "main" {
        return Err("이 창에서는 바꿀 수 없습니다.".into());
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.dialog().file().set_parent(&window).set_title("업무 폴더").pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|_| "폴더를 넣지 못했습니다.".to_string())?
        .map_err(|_| "폴더를 넣지 못했습니다.".to_string())?;
    let Some(file) = picked else {
        return Err("cancelled".into());
    };
    let path = file.into_path().map_err(|_| "폴더를 넣지 못했습니다.".to_string())?;
    if !path.is_dir() {
        return Err("폴더만 넣을 수 있습니다.".into());
    }
    let plain = privacy_folder::plain_text(&path);
    match privacy_folder::judge(&plain, &privacy_folder::known_roots()) {
        privacy_folder::PlaceAsk::System | privacy_folder::PlaceAsk::Root | privacy_folder::PlaceAsk::Link | privacy_folder::PlaceAsk::Slow => {
            Err("드라이브 전체나 Windows 폴더, 연결 폴더는 고르지 않습니다.".into())
        }
        _ => {
            let book = app.state::<GrantBook>();
            remember_work_folder(&book, &path).map_err(|_| "폴더를 넣지 못했습니다.".to_string())
        }
    }
}

#[tauri::command]
pub fn work_cards(app: AppHandle, window: WebviewWindow, id: String) -> Result<CardBatch, String> {
    if window.label() != "main" {
        return Err("이 창에서는 바꿀 수 없습니다.".into());
    }
    let book = app.state::<GrantBook>();
    read_work_cards(&book, &id)
}

#[derive(Clone, Serialize)]
struct HandoverStep {
    read: u32,
    total: u32,
    phase: String,
}

#[tauri::command]
pub fn halt_work_cards() {
    HALT.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub async fn run_work_cards(app: AppHandle, window: WebviewWindow, id: String) -> Result<CardBatch, String> {
    if window.label() != "main" {
        return Err("이 창에서는 바꿀 수 없습니다.".into());
    }
    if BUSY.swap(true, Ordering::AcqRel) {
        return Err("이미 파일을 읽고 있습니다.".into());
    }
    HALT.store(false, Ordering::Relaxed);
    let app_for_scan = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let book = app_for_scan.state::<GrantBook>();
        let root = path_grant::view_work_folder(&book, &id).map_err(|_| "폴더를 찾지 못했습니다.".to_string())?;
        scan_folder(&root, &default_limit(), &HALT, &|read, total| {
            let _ = app_for_scan.emit("handover-step", HandoverStep { read, total, phase: "read".to_string() });
        })
    })
    .await;
    BUSY.store(false, Ordering::Release);
    result.map_err(|_| "파일을 읽지 못했습니다.".to_string())?
}

struct ListedFile {
    path: PathBuf,
    rel: String,
    cloud: bool,
    link: bool,
    too_big: bool,
}

fn list_work_files(root: &Path, limit: &ScanLimit, halt: &AtomicBool) -> Result<(Vec<ListedFile>, ScanFlag), String> {
    #[cfg(windows)]
    {
        Ok(walk_tree(root, limit, halt))
    }
    #[cfg(not(windows))]
    {
        let _ = (root, limit, halt);
        Err("이 기능은 Windows에서만 동작합니다.".into())
    }
}

#[cfg(windows)]
fn walk_tree(root: &Path, limit: &ScanLimit, halt: &AtomicBool) -> (Vec<ListedFile>, ScanFlag) {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW, FIND_FIRST_EX_LARGE_FETCH,
        WIN32_FIND_DATAW,
    };
    let known = privacy_folder::known_roots();
    let mut found = Vec::new();
    let mut flag = ScanFlag { files: false, depth: false, time: false, halted: false };
    let mut stack = vec![(privacy_folder::plain_text(root), 0u32, String::new())];
    while let Some((dir, depth, relative)) = stack.pop() {
        if halt.load(Ordering::Relaxed) {
            flag.halted = true;
            break;
        }
        if limit.started.elapsed() >= limit.budget {
            flag.time = true;
            break;
        }
        let pattern = format!("{dir}\\*");
        let wide: Vec<u16> = privacy_folder::prefixed(&pattern).as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut data = WIN32_FIND_DATAW::default();
        let handle = unsafe {
            FindFirstFileExW(
                PCWSTR(wide.as_ptr()),
                FindExInfoBasic,
                &mut data as *mut _ as *mut core::ffi::c_void,
                FindExSearchNameMatch,
                None,
                FIND_FIRST_EX_LARGE_FETCH,
            )
        };
        let Ok(handle) = handle else { continue };
        loop {
            let name = wide_to_string(&data.cFileName);
            if name != "." && name != ".." && !name.is_empty() {
                let child = format!("{dir}\\{name}");
                let child_rel = if relative.is_empty() { name.clone() } else { format!("{relative}\\{name}") };
                let attrs = data.dwFileAttributes;
                let tag = if attrs & 1024 != 0 { data.dwReserved0 } else { 0 };
                if attrs & 16 != 0 {
                    if depth < limit.depth {
                        match privacy_folder::classify_dir(attrs, tag, &name, privacy_folder::under_known(&child, &known)) {
                            DirKind::Enter => stack.push((child, depth + 1, child_rel)),
                            DirKind::Link | DirKind::OtherLink | DirKind::System => {}
                        }
                    } else {
                        flag.depth = true;
                    }
                } else if keep_name(&name) {
                    let ext = Path::new(&name).extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
                    if CARD_EXTS.contains(&ext.as_str()) {
                        let size = ((data.nFileSizeHigh as u64) << 32) | data.nFileSizeLow as u64;
                        let kind = privacy_folder::classify_file(attrs, tag, size, &ext);
                        let rel = child_rel.replace('\\', "/");
                        found.push(ListedFile {
                            path: PathBuf::from(&child),
                            rel,
                            cloud: kind == FileKind::CloudOnly,
                            link: kind == FileKind::Link,
                            too_big: size > limit.bytes,
                        });
                        if found.len() >= limit.files {
                            flag.files = true;
                            break;
                        }
                    }
                }
            }
            if flag.files || unsafe { FindNextFileW(handle, &mut data) }.is_err() {
                break;
            }
        }
        let _ = unsafe { FindClose(handle) };
        if flag.files {
            break;
        }
    }
    (found, flag)
}

#[cfg(windows)]
fn wide_to_string(raw: &[u16]) -> String {
    let end = raw.iter().position(|unit| *unit == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..end])
}

fn keep_name(name: &str) -> bool {
    !name.starts_with("~$") && !name.starts_with('.')
}

fn read_one(root: &Path, item: &ListedFile) -> WorkFile {
    let rel_path = Path::new(&item.rel);
    let mut marks = Vec::new();
    let mut years = Vec::new();
    if let Some(parent) = rel_path.parent() {
        for part in parent.components() {
            let name = part.as_os_str().to_string_lossy();
            let info = marks_from_name(&name, MarkSource::Folder);
            years.extend(info.years);
            marks.extend(info.marks);
        }
    }
    let stem = rel_path.file_stem().and_then(|value| value.to_str()).unwrap_or("");
    let info = marks_from_name(stem, MarkSource::FileName);
    years.extend(info.years);
    marks.extend(info.marks);
    let modified = modified_stamp(&item.path);
    let default_year = years.iter().copied().max().unwrap_or(modified.0);
    for mark in &mut marks {
        if mark.year.is_none() {
            mark.year = Some(default_year);
        }
    }
    let (text, error) = if item.cloud {
        (String::new(), Some("클라우드에만 있는 파일은 열지 않습니다.".to_string()))
    } else if item.link {
        (String::new(), Some("연결된 파일은 열지 않습니다.".to_string()))
    } else if item.too_big {
        (String::new(), Some("파일이 너무 커서 본문을 읽지 않습니다.".to_string()))
    } else {
        read_body(&item.path)
    };
    marks.extend(marks_from_text(&text, Some(default_year)));
    marks.push(DateMark {
        month: modified.1,
        year: Some(modified.0),
        day: Some(modified.2),
        kind: MarkKind::Modified,
        source: MarkSource::Modified,
        weight: WEIGHT_MODIFIED,
        snippet: "파일 수정일".to_string(),
        held: false,
    });
    let _ = root;
    WorkFile {
        rel: item.rel.clone(),
        modified: format!("{:04}-{:02}-{:02}", modified.0, modified.1, modified.2),
        error,
        clues: marks,
    }
}

fn read_body(path: &Path) -> (String, Option<String>) {
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if ext == "hwp" {
        return (String::new(), Some(OLD_HWP_NOTE.to_string()));
    }
    if matches!(ext.as_str(), "txt" | "md" | "csv") {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(_) => return (String::new(), Some("파일을 열지 못했습니다.".to_string())),
        };
        return match decode_plain(&bytes) {
            Some(text) => (clip_chars(&text, 20_000), None),
            None => (String::new(), Some("글자를 읽지 못했습니다.".to_string())),
        };
    }
    match extract_card_body(path) {
        Ok(text) => (text, None),
        Err(ExtractNote::Skip(message) | ExtractNote::Fail(message)) => (String::new(), Some(message)),
    }
}

fn decode_plain(bytes: &[u8]) -> Option<String> {
    if let Some(text) = decode_utf16(bytes) {
        return Some(text);
    }
    decode_bytes(bytes).ok()
}

fn decode_utf16(bytes: &[u8]) -> Option<String> {
    let (body, little) = if bytes.starts_with(&[0xFF, 0xFE]) {
        (&bytes[2..], true)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        (&bytes[2..], false)
    } else {
        return None;
    };
    if body.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = body
        .chunks_exact(2)
        .map(|pair| if little { u16::from_le_bytes([pair[0], pair[1]]) } else { u16::from_be_bytes([pair[0], pair[1]]) })
        .collect();
    String::from_utf16(&units).ok()
}

fn clip_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn modified_stamp(path: &Path) -> (u32, u32, u32) {
    #[cfg(windows)]
    {
        if let Some(stamp) = file_stamp(path) {
            return stamp;
        }
    }
    let _ = path;
    (1970, 1, 1)
}

#[cfg(windows)]
fn file_stamp(path: &Path) -> Option<(u32, u32, u32)> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetFileAttributesExW, GetFileExInfoStandard, WIN32_FILE_ATTRIBUTE_DATA};
    let wide: Vec<u16> = privacy_folder::prefixed(&privacy_folder::plain_text(path))
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut data = WIN32_FILE_ATTRIBUTE_DATA::default();
    unsafe { GetFileAttributesExW(PCWSTR(wide.as_ptr()), GetFileExInfoStandard, &mut data as *mut _ as *mut _).ok()? };
    filetime_ymd(data.ftLastWriteTime)
}

#[cfg(windows)]
fn filetime_ymd(ft: windows::Win32::Foundation::FILETIME) -> Option<(u32, u32, u32)> {
    use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows::Win32::Storage::FileSystem::FileTimeToLocalFileTime;
    use windows::Win32::System::Time::FileTimeToSystemTime;
    let mut local = FILETIME::default();
    let mut system = SYSTEMTIME::default();
    unsafe {
        FileTimeToLocalFileTime(&ft, &mut local).ok()?;
        FileTimeToSystemTime(&local, &mut system).ok()?;
    }
    Some((system.wYear as u32, system.wMonth as u32, system.wDay as u32))
}

fn group_files(files: Vec<WorkFile>) -> Vec<(String, Vec<WorkFile>)> {
    let mut groups: Vec<(String, Vec<WorkFile>)> = Vec::new();
    for file in files {
        let stem = tidy_title(Path::new(&file.rel).file_stem().and_then(|value| value.to_str()).unwrap_or(""));
        let stem = if stem.is_empty() {
            Path::new(&file.rel).file_stem().and_then(|value| value.to_str()).unwrap_or("").to_string()
        } else {
            stem
        };
        let mut key = folder_label(&file.rel).unwrap_or(stem);
        let compact = key.replace(' ', "");
        if let Some(existing) = groups.iter().find_map(|(name, _)| {
            if ratio::match_ratio(&name.replace(' ', ""), &compact) >= 0.8 {
                Some(name.clone())
            } else {
                None
            }
        }) {
            key = existing;
        }
        if let Some((_, bucket)) = groups.iter_mut().find(|(name, _)| name == &key) {
            bucket.push(file);
        } else {
            groups.push((key, vec![file]));
        }
    }
    groups
}

fn folder_label(rel: &str) -> Option<String> {
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    for part in &parts[..parts.len() - 1] {
        let label = tidy_title(part);
        if !label.is_empty() && !label.chars().all(|ch| ch.is_ascii_digit()) {
            return Some(label);
        }
    }
    None
}

fn build_card(name: String, files: Vec<WorkFile>) -> WorkCard {
    let (months, month_years, strong, deadlines, years) = month_list(&files, false);
    let multi: Vec<u32> = months.iter().copied().filter(|month| month_years.get(month).map(|set| set.len() >= 2).unwrap_or(false)).collect();
    let (period, confidence) = if !multi.is_empty() {
        let label = multi.iter().map(|month| format!("{month}월")).collect::<Vec<_>>().join(", ");
        (format!("매년 {label}"), "높음".to_string())
    } else {
        let mut all_years = BTreeSet::new();
        for month in &months {
            if let Some(set) = month_years.get(month) {
                all_years.extend(set.iter().copied());
            }
        }
        let base = if all_years.is_empty() {
            " (수정일 기준)".to_string()
        } else {
            let text = all_years.iter().map(|year| year.to_string()).collect::<Vec<_>>().join(", ");
            format!(" ({text}년 자료 기준)")
        };
        let label = months.iter().map(|month| format!("{month}월")).collect::<Vec<_>>().join(", ");
        let confidence = if strong { "보통" } else { "추정" };
        (format!("{label}{base}"), confidence.to_string())
    };
    WorkCard {
        name,
        ai_name: None,
        ai_open: false,
        months,
        period,
        confidence,
        years,
        deadlines,
        todos: Vec::new(),
        todo_open: Vec::new(),
        orgs: Vec::new(),
        org_open: Vec::new(),
        files,
        include: true,
    }
}

fn month_list(files: &[WorkFile], drop_modified: bool) -> (Vec<u32>, BTreeMap<u32, BTreeSet<u32>>, bool, Vec<Deadline>, Vec<u32>) {
    let mut weights: BTreeMap<u32, f64> = BTreeMap::new();
    let mut month_years: BTreeMap<u32, BTreeSet<u32>> = BTreeMap::new();
    let mut strong = false;
    let mut deadlines: BTreeMap<(u32, u32), Deadline> = BTreeMap::new();
    let mut seen_deadline = BTreeSet::new();
    let mut years = BTreeSet::new();
    for file in files {
        for clue in &file.clues {
            if drop_modified && clue.source == MarkSource::Modified {
                continue;
            }
            *weights.entry(clue.month).or_insert(0.0) += clue.weight;
            if clue.source != MarkSource::Modified {
                if let Some(year) = clue.year {
                    month_years.entry(clue.month).or_default().insert(year);
                    years.insert(year);
                }
            }
            if clue.source == MarkSource::FileName || clue.source == MarkSource::Folder || clue.kind == MarkKind::Deadline {
                strong = true;
            }
            if clue.kind == MarkKind::Deadline {
                if let Some(day) = clue.day {
                    let key = (clue.month, day);
                    if seen_deadline.insert(key) {
                        deadlines.insert(key, Deadline {
                            month: clue.month,
                            day,
                            year: clue.year,
                            file: file.rel.clone(),
                            snippet: clue.snippet.clone(),
                            from_model: clue.source == MarkSource::Model && !clue.held,
                        });
                    }
                }
            }
        }
    }
    let top = weights.values().copied().fold(0.0_f64, f64::max);
    let months: Vec<u32> = weights.iter().filter(|(_, weight)| **weight >= top * 0.4).map(|(month, _)| *month).collect();
    let mut deadline_list: Vec<Deadline> = deadlines.into_values().collect();
    deadline_list.sort_by_key(|item| (item.month, item.day));
    (months, month_years, strong, deadline_list, years.into_iter().collect())
}

fn path_chain(path: &Path) -> Vec<String> {
    let text = privacy_folder::strip_prefix(&path.to_string_lossy().replace('/', "\\"));
    let mut chain = Vec::new();
    for part in text.split('\\') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            chain.pop();
            continue;
        }
        chain.push(part.to_ascii_lowercase());
    }
    chain
}

pub fn merge_cards(left: WorkCard, right: WorkCard) -> WorkCard {
    let mut files = left.files;
    for file in right.files {
        if let Some(slot) = files.iter_mut().find(|item| item.rel == file.rel) {
            if slot.clues.is_empty() {
                *slot = file;
            }
        } else {
            files.push(file);
        }
    }
    let mut todos = left.todos;
    let mut todo_open = left.todo_open;
    for (index, item) in right.todos.into_iter().enumerate() {
        let text = item.trim();
        if text.is_empty() || todos.len() >= 8 {
            continue;
        }
        if !todos.iter().any(|have| have == text) {
            todos.push(text.to_string());
            todo_open.push(right.todo_open.get(index).copied().unwrap_or(false));
        }
    }
    let mut orgs = left.orgs;
    let mut org_open = left.org_open;
    for (index, item) in right.orgs.into_iter().enumerate() {
        let text = item.trim();
        if text.is_empty() || orgs.len() >= 8 {
            continue;
        }
        if !orgs.iter().any(|have| have == text) {
            orgs.push(text.to_string());
            org_open.push(right.org_open.get(index).copied().unwrap_or(false));
        }
    }
    let mut card = build_card(left.name, files);
    card.todos = todos;
    card.todo_open = todo_open;
    card.orgs = orgs;
    card.org_open = org_open;
    card.ai_name = left.ai_name.or(right.ai_name);
    card.ai_open = left.ai_open || right.ai_open;
    card.include = left.include || right.include;
    card
}

fn file_under(root: &Path, rel: &str) -> Result<PathBuf, ()> {
    if rel.is_empty() || rel.contains(':') || rel.starts_with('/') || rel.starts_with('\\') {
        return Err(());
    }
    let mut path = root.to_path_buf();
    for part in rel.split(['/', '\\']) {
        if part.is_empty() || part == "." || part == ".." {
            return Err(());
        }
        path.push(part);
    }
    Ok(path)
}

fn rel_is_relative(rel: &str) -> bool {
    !rel.is_empty() && !rel.contains(':') && !rel.starts_with('/') && !rel.starts_with('\\') && !rel.split(['/', '\\']).any(|part| part == ".." || part == ".")
}

pub fn cards_to_json(batch: &CardBatch) -> String {
    let reviewed_at = reviewed_stamp();
    serde_json::json!({
        "meta": { "reviewed_at": reviewed_at },
        "file_count": batch.file_count,
        "model": batch.model,
        "notice": batch.notice,
        "tasks": batch.tasks,
    })
    .to_string()
}

pub fn cards_from_json(text: &str) -> Result<CardBatch, &'static str> {
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| "저장 파일을 읽지 못했습니다.")?;
    let reviewed_at = value.get("meta").and_then(|meta| meta.get("reviewed_at")).and_then(|item| item.as_str()).map(str::to_string);
    let mut batch: CardBatch = serde_json::from_value(value).map_err(|_| "저장 파일을 읽지 못했습니다.")?;
    for task in &batch.tasks {
        for file in &task.files {
            if !rel_is_relative(&file.rel) {
                return Err("저장 파일을 읽지 못했습니다.");
            }
        }
    }
    batch.reviewed_at = reviewed_at;
    Ok(batch)
}

fn reviewed_stamp() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::SYSTEMTIME;
        use windows::Win32::System::SystemInformation::GetLocalTime;
        let stamp: SYSTEMTIME = unsafe { GetLocalTime() };
        return format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
            stamp.wYear, stamp.wMonth, stamp.wDay, stamp.wHour, stamp.wMinute, stamp.wSecond
        );
    }
    #[cfg(not(windows))]
    "1970-01-01T00:00:00".to_string()
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("이 창에서는 바꿀 수 없습니다.".into())
    }
}

#[tauri::command]
pub fn merge_work_cards(window: WebviewWindow, left: WorkCard, right: WorkCard) -> Result<WorkCard, String> {
    main_only(&window)?;
    Ok(merge_cards(left, right))
}

#[tauri::command]
pub fn save_work_cards(app: AppHandle, window: WebviewWindow, folder_id: String, write_id: String, batch: CardBatch) -> Result<(), String> {
    main_only(&window)?;
    let book = app.state::<GrantBook>();
    let source = path_grant::view_work_folder(&book, &folder_id).map_err(|_| "폴더를 찾지 못했습니다.".to_string())?;
    let dest = path_grant::view_write(&book, &write_id, &["json"]).map_err(|_| "저장하지 못했습니다.".to_string())?;
    reject_result_inside_source(&source, &dest).map_err(|message| message.to_string())?;
    for task in &batch.tasks {
        for file in &task.files {
            if !rel_is_relative(&file.rel) {
                return Err("저장하지 못했습니다.".into());
            }
        }
    }
    let text = cards_to_json(&batch);
    path_grant::write_text(&book, &write_id, &["json"], &text, 2_000_000).map_err(|_| "저장하지 못했습니다.".to_string())
}

#[tauri::command]
pub fn load_work_cards(app: AppHandle, window: WebviewWindow, id: String) -> Result<CardBatch, String> {
    main_only(&window)?;
    let book = app.state::<GrantBook>();
    let path = path_grant::view_read(&book, &id).map_err(|_| "저장 파일을 읽지 못했습니다.".to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|_| "저장 파일을 읽지 못했습니다.".to_string())?;
    if text.len() > 2_000_000 {
        return Err("저장 파일을 읽지 못했습니다.".into());
    }
    let batch = cards_from_json(&text).map_err(|message| message.to_string())?;
    path_grant::spend(&book, &id);
    Ok(batch)
}

#[tauri::command]
pub fn open_work_file(app: AppHandle, window: WebviewWindow, folder_id: String, rel: String) -> Result<String, String> {
    main_only(&window)?;
    let book = app.state::<GrantBook>();
    let root = path_grant::view_work_folder(&book, &folder_id).map_err(|_| "업무 폴더를 다시 고르면 열 수 있습니다.".to_string())?;
    let path = file_under(&root, &rel).map_err(|_| "파일을 열지 못했습니다.".to_string())?;
    if !path.is_file() {
        return Err("파일을 열지 못했습니다.".into());
    }
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("file");
    let id = book
        .issue(GrantUse::Launch, &path, name, "file", GrantOrigin::Dialog)
        .map_err(|_| "파일을 열지 못했습니다.".to_string())?;
    Ok(path_grant::id_text(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn ratios_match_the_saved_pairs() {
        let pairs = [
            ("운영위원회", "운영위원회", 1.0),
            ("운영위원회", "운영위", 0.75),
            ("예산요구", "예산", 0.6666666666666666),
            ("정보공개", "직원연수", 0.0),
            ("abc", "abc", 1.0),
            ("", "", 1.0),
            ("가나다", "가다", 0.8),
            ("본예산요구서작성안내", "본예산요구서", 0.75),
            ("aaaaaaaaaa", "bbbbbbbbbb", 0.0),
            ("직원연수", "직원연수교육", 0.8),
        ];
        for (left, right, expected) in pairs {
            let got = ratio::match_ratio(left, right);
            assert!((got - expected).abs() < 1e-12, "{left} {right} {got} {expected}");
        }
    }

    #[test]
    fn february_31_is_kept() {
        let info = marks_from_name("2024. 2. 31. 안내", MarkSource::FileName);
        assert!(info.marks.iter().any(|mark| mark.month == 2 && mark.day == Some(31)));
    }

    #[test]
    fn result_inside_source_is_refused() {
        assert!(reject_result_inside_source(Path::new(r"C:\work\src"), Path::new(r"C:\work\src")).is_err());
        assert!(reject_result_inside_source(Path::new(r"C:\work\src"), Path::new(r"C:\work\src\out")).is_err());
        assert!(reject_result_inside_source(Path::new(r"C:\work\src"), Path::new(r"C:\work\out")).is_ok());
        assert!(reject_result_inside_source(Path::new(r"C:\work\src"), Path::new(r"C:\work")).is_ok());
    }

    #[test]
    fn cp949_text_keeps_deadline() {
        let dir = std::env::temp_dir().join(format!("edul-card-cp949-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("2020_보고.txt");
        fs::write(&path, cp949("제출기한: 2024. 4. 2.까지")).unwrap();
        set_morning(&path, 2024, 4, 2);
        let book = GrantBook::new();
        let id = remember_work_folder(&book, &dir).unwrap();
        let batch = read_work_cards(&book, &id).unwrap();
        let card = batch.tasks.iter().find(|task| task.files.iter().any(|file| file.rel.ends_with("2020_보고.txt"))).unwrap();
        assert!(card.deadlines.iter().any(|item| item.month == 4 && item.day == 2 && item.year == Some(2024)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_hwp_is_noted_and_name_month_remains() {
        let dir = scratch("hwp");
        fs::create_dir_all(dir.join("2024_점검")).unwrap();
        let path = dir.join("2024_점검").join("2024. 5. 1. 메모.hwp");
        fs::write(&path, b"not-a-real-hwp").unwrap();
        set_morning(&path, 2024, 5, 1);
        let book = GrantBook::new();
        let id = remember_work_folder(&book, &dir).unwrap();
        let batch = read_work_cards(&book, &id).unwrap();
        let file = batch.tasks.iter().flat_map(|task| task.files.iter()).find(|file| file.rel.ends_with(".hwp")).unwrap();
        assert_eq!(file.error.as_deref(), Some(OLD_HWP_NOTE));
        assert!(batch.tasks.iter().any(|task| task.months.contains(&5)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn virtual_folder_matches_expected_cards() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures").join("work-handover").join("folder");
        let stamps = [
            ("2024_운영위원회/2024 운영위원 위촉 계획.hwpx", 2024u16, 3u16, 8u16),
            ("2024_운영위원회/2024_제2차 운영위원회 회의록.hwpx", 2024, 9, 13),
            ("2025_운영위원회/2025 운영위원 위촉 계획.hwpx", 2025, 3, 8),
            ("2025_운영위원회/2025_제2차 운영위원회 회의록.hwpx", 2025, 9, 13),
            ("예산/2024_본예산 요구서 작성 안내(공문).hwpx", 2024, 8, 28),
            ("예산/2025_본예산 요구서 작성 안내(공문).hwpx", 2025, 8, 28),
            ("정보공개/2024 상반기 정보공개 처리현황 보고.hwpx", 2024, 7, 5),
            ("정보공개/2025 상반기 정보공개 처리현황 보고.hwpx", 2025, 7, 5),
            ("직원연수/2025 법정의무교육 이수 현황.xlsx", 2025, 11, 3),
            ("직원연수/2024_법정의무교육_이수현황_최종.xlsx", 2024, 11, 5),
            ("민원서식/정보공개청구서_서식.docx", 2023, 5, 2),
            ("업무메모.txt", 2025, 12, 20),
        ];
        for (rel, year, month, day) in stamps {
            set_morning(&root.join(rel), year, month, day);
        }
        let book = GrantBook::new();
        let id = remember_work_folder(&book, &root).unwrap();
        let batch = read_work_cards(&book, &id).unwrap();
        let expected: Vec<serde_json::Value> = serde_json::from_str(&fs::read_to_string(root.parent().unwrap().join("expected.json")).unwrap()).unwrap();
        let bare: Vec<serde_json::Value> = serde_json::from_str(&fs::read_to_string(root.parent().unwrap().join("months-without-mtime.json")).unwrap()).unwrap();
        assert_eq!(batch.tasks.len(), expected.len());
        assert!(batch.model.is_none());
        for task in &batch.tasks {
            let want = expected.iter().find(|item| item["name"] == task.name).unwrap_or_else(|| panic!("missing {}", task.name));
            assert_eq!(task.months, json_months(&want["months"]), "{}", task.name);
            assert_eq!(collapse(&task.period), collapse(want["period"].as_str().unwrap()), "{}", task.name);
            assert_eq!(task.confidence, want["confidence"].as_str().unwrap(), "{}", task.name);
            let got_files: Vec<&str> = task.files.iter().map(|file| file.rel.as_str()).collect();
            let want_files: Vec<&str> = want["files"].as_array().unwrap().iter().map(|file| file["rel"].as_str().unwrap()).collect();
            assert_eq!(got_files, want_files, "{}", task.name);
            let got_due: Vec<(u32, u32, Option<u32>, &str)> = task.deadlines.iter().map(|item| (item.month, item.day, item.year, item.file.as_str())).collect();
            let want_due: Vec<(u32, u32, Option<u32>, &str)> = want["deadlines"].as_array().unwrap().iter().map(|item| {
                (item["month"].as_u64().unwrap() as u32, item["day"].as_u64().unwrap() as u32, item["year"].as_u64().map(|year| year as u32), item["file"].as_str().unwrap())
            }).collect();
            assert_eq!(got_due, want_due, "{}", task.name);
            let bare_months = bare.iter().find(|item| item["name"] == task.name).unwrap();
            assert_eq!(months_without_modified(task), json_months(&bare_months["months_without_mtime"]), "{}", task.name);
        }
    }

    #[cfg(windows)]
    #[test]
    fn junction_is_not_entered() {
        let root = scratch("link");
        let outside = scratch("link-out");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("숨은메모.txt"), "제출기한: 2099. 1. 9.까지").unwrap();
        fs::create_dir_all(root.join("안쪽")).unwrap();
        fs::write(root.join("안쪽").join("안쪽메모.txt"), "제출기한: 2024. 6. 2.까지").unwrap();
        fs::write(root.join("보이는메모.txt"), "제출기한: 2024. 6. 1.까지").unwrap();
        let link = root.join("joined");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.display().to_string(), &outside.display().to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        let book = GrantBook::new();
        let id = remember_work_folder(&book, &root).unwrap();
        let batch = read_work_cards(&book, &id).unwrap();
        let rels: Vec<&str> = batch.tasks.iter().flat_map(|task| task.files.iter().map(|file| file.rel.as_str())).collect();
        assert!(rels.iter().any(|rel| rel.ends_with("보이는메모.txt")));
        assert!(rels.iter().any(|rel| rel.contains("안쪽메모.txt")));
        if made {
            assert!(rels.iter().all(|rel| !rel.contains("숨은메모")));
        }
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(windows)]
    #[test]
    fn offline_file_is_not_opened() {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_OFFLINE};
        let dir = std::env::temp_dir().join(format!("edul-card-cloud-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("2024. 8. 3. 메모.txt");
        fs::write(&path, "제출기한: 2099. 2. 2.까지").unwrap();
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        unsafe { SetFileAttributesW(PCWSTR(wide.as_ptr()), FILE_ATTRIBUTE_OFFLINE).ok().unwrap() };
        let book = GrantBook::new();
        let id = remember_work_folder(&book, &dir).unwrap();
        let batch = read_work_cards(&book, &id).unwrap();
        let file = batch.tasks.iter().flat_map(|task| task.files.iter()).next().unwrap();
        assert!(file.error.as_deref().unwrap_or("").contains("클라우드"));
        assert!(batch.tasks.iter().all(|task| task.deadlines.iter().all(|item| item.year != Some(2099))));
        assert!(batch.tasks.iter().any(|task| task.months.contains(&8)));
        let _ = fs::remove_dir_all(&dir);
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("handover-scratch").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn json_months(value: &serde_json::Value) -> Vec<u32> {
        value.as_array().unwrap().iter().map(|item| item.as_u64().unwrap() as u32).collect()
    }

    fn collapse(text: &str) -> String {
        text.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    fn cp949(text: &str) -> Vec<u8> {
        use windows::Win32::Globalization::WideCharToMultiByte;
        let wide: Vec<u16> = text.encode_utf16().collect();
        let len = unsafe { WideCharToMultiByte(949, 0, &wide, None, None, None) };
        let mut out = vec![0u8; len as usize];
        unsafe { WideCharToMultiByte(949, 0, &wide, Some(&mut out), None, None); }
        out
    }

    fn set_morning(path: &Path, year: u16, month: u16, day: u16) {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows::Win32::Foundation::{FILETIME, HANDLE, SYSTEMTIME};
            use windows::Win32::Storage::FileSystem::{LocalFileTimeToFileTime, SetFileTime};
            use windows::Win32::System::Time::SystemTimeToFileTime;
            let system = SYSTEMTIME { wYear: year, wMonth: month, wDay: day, wHour: 10, ..SYSTEMTIME::default() };
            let mut local = FILETIME::default();
            let mut utc = FILETIME::default();
            unsafe {
                SystemTimeToFileTime(&system, &mut local).ok().unwrap();
                LocalFileTimeToFileTime(&local, &mut utc).ok().unwrap();
            }
            let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
            unsafe { SetFileTime(HANDLE(file.as_raw_handle()), None, None, Some(&utc)).ok().unwrap() };
        }
        #[cfg(not(windows))]
        {
            let _ = (path, year, month, day);
        }
    }

    #[test]
    fn file_cap_keeps_a_partial_batch() {
        let dir = scratch("file-cap");
        for index in 0..3 {
            fs::write(dir.join(format!("메모{index}.txt")), "제출 기한 2024-03-15").unwrap();
        }
        let limit = ScanLimit { files: 2, depth: 12, bytes: BYTE_CAP, started: Instant::now(), budget: TIME_CAP };
        let batch = scan_folder(&dir, &limit, &AtomicBool::new(false), &|_, _| {}).unwrap();
        assert!(batch.file_count <= 2);
        assert_eq!(batch.notice.as_deref(), Some("파일이 많아 처음 2개까지만 분석했습니다."));
    }

    #[test]
    fn depth_cap_skips_a_deeper_folder() {
        let dir = scratch("depth-cap");
        let deep = dir.join("한").join("두");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("메모.txt"), "제출 기한 2024-03-15").unwrap();
        let limit = ScanLimit { files: 10, depth: 1, bytes: BYTE_CAP, started: Instant::now(), budget: TIME_CAP };
        let batch = scan_folder(&dir, &limit, &AtomicBool::new(false), &|_, _| {}).unwrap();
        assert_eq!(batch.file_count, 0);
        assert_eq!(batch.notice.as_deref(), Some("폴더가 깊어 1단계까지만 분석했습니다."));
    }

    #[test]
    fn time_cap_keeps_what_was_listed() {
        let dir = scratch("time-cap");
        fs::write(dir.join("메모.txt"), "제출 기한 2024-03-15").unwrap();
        let limit = ScanLimit {
            files: 10,
            depth: 12,
            bytes: BYTE_CAP,
            started: Instant::now() - Duration::from_secs(5),
            budget: Duration::from_secs(1),
        };
        let batch = scan_folder(&dir, &limit, &AtomicBool::new(false), &|_, _| {}).unwrap();
        assert_eq!(batch.notice.as_deref(), Some("시간이 길어 그때까지 읽은 파일만 분석했습니다."));
    }

    #[test]
    fn saved_cards_roundtrip_without_an_absolute_path() {
        let dir = scratch("round");
        fs::write(dir.join("업무메모.txt"), "제출 기한 2025-12-15").unwrap();
        let book = GrantBook::new();
        let id = remember_work_folder(&book, &dir).unwrap();
        let batch = read_work_cards(&book, &id).unwrap();
        let text = cards_to_json(&batch);
        assert!(text.contains("reviewed_at"));
        assert!(!text.contains(":\\"));
        assert!(!text.contains(&dir.to_string_lossy().to_string()));
        let mut edited = cards_from_json(&text).unwrap();
        edited.tasks[0].name = "바꾼이름".into();
        edited.tasks[0].period = "직접 고친 시기".into();
        let back = cards_from_json(&cards_to_json(&edited)).unwrap();
        assert_eq!(back.tasks[0].name, "바꾼이름");
        assert_eq!(back.tasks[0].period, "직접 고친 시기");
        assert!(reject_result_inside_source(&dir, &dir.join("결과.json")).is_err());
        let outside = scratch("round-out");
        assert!(reject_result_inside_source(&dir, &outside.join("결과.json")).is_ok());
    }

    #[test]
    fn merge_recalculates_period() {
        let dir = scratch("merge");
        fs::write(dir.join("가.txt"), "제출 기한 2024-03-15").unwrap();
        fs::write(dir.join("나.txt"), "제출 기한 2025-09-20").unwrap();
        let book = GrantBook::new();
        let id = remember_work_folder(&book, &dir).unwrap();
        let batch = read_work_cards(&book, &id).unwrap();
        assert_eq!(batch.tasks.len(), 2);
        let merged = merge_cards(batch.tasks[0].clone(), batch.tasks[1].clone());
        assert!(merged.months.contains(&3));
        assert!(merged.months.contains(&9));
        assert_eq!(merged.files.len(), 2);
        assert_ne!(merged.period, batch.tasks[0].period);
    }

    #[test]
    fn date_formatted_excel_cell_becomes_a_deadline() {
        use std::io::{Cursor, Write};
        use zip::write::SimpleFileOptions;
        use zip::{CompressionMethod, ZipWriter};
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            let entries = [
                ("xl/workbook.xml", r#"<workbook><workbookPr date1904="0"/><sheets><sheet name="일정"/></sheets></workbook>"#),
                ("xl/styles.xml", r#"<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>"#),
                (
                    "xl/worksheets/sheet1.xml",
                    r#"<worksheet><sheetData><row><c t="inlineStr"><is><t>이수기한</t></is></c><c s="1"><v>45991</v></c></row></sheetData></worksheet>"#,
                ),
            ];
            for (name, body) in entries {
                writer.start_file(name, options).unwrap();
                writer.write_all(body.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }
        let dir = scratch("excel-date");
        fs::write(dir.join("교육.xlsx"), cursor.into_inner()).unwrap();
        let book = GrantBook::new();
        let id = remember_work_folder(&book, &dir).unwrap();
        let batch = read_work_cards(&book, &id).unwrap();
        let hit = batch.tasks.iter().any(|task| task.deadlines.iter().any(|item| item.month == 11 && item.day == 30));
        assert!(hit, "{:?}", batch.tasks.iter().map(|task| task.period.clone()).collect::<Vec<_>>());
    }
}
