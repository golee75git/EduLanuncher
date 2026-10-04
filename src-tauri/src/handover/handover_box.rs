//! 인계 박스. 내용 해시는 깨진 파일을 알아보는 용도이고, 만든 사람을 증명하는 서명이 아니다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::path_grant::{self, GrantBook};
use crate::privacy_scan::{find_patterns, FindingKind, Profile};

use super::assist::hide_personal;
use super::{file_under, reject_result_inside_source, rel_is_relative, CardBatch, WorkCard, BYTE_CAP};

pub const BOX_BYTES: usize = 2 * 1024 * 1024;
pub const CARD_CAP: usize = 40;
pub const LINK_CAP: usize = 40;
pub const MEMO_CAP: usize = 8;
pub const NOTE_CAP: usize = 400;
pub const CHANGED_FILE: &str = "전임자가 넘긴 뒤 바뀐 파일입니다";
pub const BROKEN_BOX: &str = "인계 박스가 깨졌습니다.";
pub const BIG_BOX: &str = "파일이 너무 큽니다.";
pub const BAD_BOX: &str = "인계 박스 형식이 올바르지 않습니다.";

const KIND: &str = "work-handover";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct HandoverBox {
    pub kind: String,
    pub format: u32,
    pub made_at: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub note: String,
    pub cards: Vec<BoxCard>,
    #[serde(default)]
    pub shortcuts: Vec<BoxLink>,
    #[serde(default)]
    pub folder: Option<BoxFolder>,
    #[serde(default)]
    pub memos: Vec<String>,
    #[serde(default)]
    pub content_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoxCard {
    pub name: String,
    pub months: Vec<u32>,
    pub period: String,
    pub confidence: String,
    pub deadlines: Vec<BoxDeadline>,
    pub todos: Vec<String>,
    #[serde(default)]
    pub todo_open: Vec<bool>,
    pub orgs: Vec<String>,
    #[serde(default)]
    pub org_open: Vec<bool>,
    #[serde(default)]
    pub ai_open: bool,
    #[serde(default)]
    pub note: String,
    pub files: Vec<BoxFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoxDeadline {
    pub month: u32,
    pub day: u32,
    pub file: String,
    pub snippet: String,
    #[serde(default)]
    pub from_model: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoxFile {
    pub name: String,
    pub rel: String,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoxLink {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub target: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoxFolder {
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PrivacySpot {
    pub key: String,
    pub label: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ExportDraft {
    pub folder_id: String,
    pub include_folder: bool,
    pub note: String,
    pub batch: CardBatch,
    pub shortcuts: Vec<BoxLink>,
    pub memos: Vec<String>,
    #[serde(default)]
    pub keep: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileMatch {
    Same,
    Changed,
    Missing,
}

pub fn open_box_text(text: &str) -> Result<HandoverBox, &'static str> {
    if text.len() > BOX_BYTES {
        return Err(BIG_BOX);
    }
    let mut box_value: HandoverBox = serde_json::from_str(text).map_err(|_| BAD_BOX)?;
    if box_value.kind != KIND || box_value.format != 1 {
        return Err(BAD_BOX);
    }
    let found = box_value.content_hash.clone();
    box_value.content_hash.clear();
    let expect = content_hash(&box_value).ok_or(BROKEN_BOX)?;
    if found != expect {
        return Err(BROKEN_BOX);
    }
    box_value.content_hash = found;
    check_shape(&box_value)?;
    Ok(box_value)
}

pub fn seal_box(mut pack: HandoverBox) -> Result<String, &'static str> {
    pack.kind = KIND.to_string();
    pack.format = 1;
    pack.content_hash.clear();
    check_shape(&pack)?;
    pack.content_hash = content_hash(&pack).ok_or(BROKEN_BOX)?;
    let text = serde_json::to_string(&pack).map_err(|_| BAD_BOX)?;
    if text.len() > BOX_BYTES {
        return Err(BIG_BOX);
    }
    Ok(text)
}

pub fn privacy_spots(draft: &ExportDraft) -> Result<Vec<PrivacySpot>, &'static str> {
    let mut spots = Vec::new();
    for (index, field) in export_fields(draft)?.into_iter().enumerate() {
        let _ = index;
        let kinds = hit_kinds(&field.text);
        if kinds.is_empty() {
            continue;
        }
        spots.push(PrivacySpot { key: field.key, label: field.label, kind: kinds.join(", ") });
    }
    Ok(spots)
}

pub fn build_box(root: Option<&Path>, draft: &ExportDraft, made_at: &str) -> Result<HandoverBox, &'static str> {
    let fields = export_fields(draft)?;
    let mut masked: Vec<(String, String)> = Vec::new();
    for field in fields {
        let text = if draft.keep.iter().any(|key| key == &field.key) { field.text } else { hide_personal(&field.text) };
        masked.push((field.key, text));
    }
    let take = |key: &str| masked.iter().find(|(have, _)| have == key).map(|(_, text)| text.clone()).unwrap_or_default();
    let mut cards = Vec::new();
    for (index, task) in draft.batch.tasks.iter().filter(|task| task.include).enumerate() {
        if cards.len() >= CARD_CAP {
            return Err("인계 내용이 너무 많습니다.");
        }
        let mut deadlines = Vec::new();
        for (deadline_index, item) in task.deadlines.iter().enumerate() {
            deadlines.push(BoxDeadline {
                month: item.month,
                day: item.day,
                file: clip(&take(&key_deadline_file(index, deadline_index)), 80),
                snippet: clip(&take(&key_deadline(index, deadline_index)), 80),
                from_model: item.from_model,
            });
        }
        let mut files = Vec::new();
        for file in &task.files {
            if !rel_is_relative(&file.rel) {
                continue;
            }
            let Some(root) = root else {
                continue;
            };
            let Ok(path) = file_under(root, &file.rel) else {
                continue;
            };
            let Some(hash) = hash_file(&path) else {
                continue;
            };
            let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("file");
            files.push(BoxFile { name: clip(name, 80), rel: file.rel.replace('\\', "/"), hash });
        }
        cards.push(BoxCard {
            name: clip(&take(&key_name(index)), 40),
            months: task.months.clone(),
            period: clip(&task.period, 80),
            confidence: task.confidence.clone(),
            deadlines,
            todos: task.todos.iter().enumerate().map(|(todo_index, _)| clip(&take(&key_todo(index, todo_index)), 80)).filter(|text| !text.is_empty()).collect(),
            todo_open: task.todo_open.clone(),
            orgs: task.orgs.iter().enumerate().map(|(org_index, _)| clip(&take(&key_org(index, org_index)), 80)).filter(|text| !text.is_empty()).collect(),
            org_open: task.org_open.clone(),
            ai_open: task.ai_open,
            note: clip(&take(&key_card_note(index)), NOTE_CAP),
            files,
        });
    }
    if draft.shortcuts.len() > LINK_CAP || draft.memos.len() > MEMO_CAP {
        return Err("인계 내용이 너무 많습니다.");
    }
    let memos = draft.memos.iter().enumerate().map(|(index, _)| clip(&take(&key_memo(index)), 2000)).filter(|text| !text.is_empty()).collect();
    let folder = if draft.include_folder {
        root.map(|path| BoxFolder {
            name: clip(path.file_name().and_then(|value| value.to_str()).unwrap_or("업무"), 80),
            path: clip(&path.to_string_lossy(), 1024),
        })
    } else {
        None
    };
    Ok(HandoverBox {
        kind: KIND.to_string(),
        format: 1,
        made_at: made_at.to_string(),
        model: draft.batch.model.clone().filter(|text| !text.trim().is_empty()),
        note: clip(&take("note"), NOTE_CAP),
        cards,
        shortcuts: draft.shortcuts.clone(),
        folder,
        memos,
        content_hash: String::new(),
    })
}

pub fn match_file(root: &Path, rel: &str, expect: &str) -> FileMatch {
    let Ok(path) = file_under(root, rel) else {
        return FileMatch::Missing;
    };
    if !path.is_file() {
        return FileMatch::Missing;
    }
    match hash_file(&path) {
        Some(hash) if hash == expect => FileMatch::Same,
        Some(_) => FileMatch::Changed,
        None => FileMatch::Missing,
    }
}

pub fn box_to_batch(pack: &HandoverBox) -> CardBatch {
    let tasks = pack.cards.iter().map(card_from_box).collect::<Vec<_>>();
    let file_count = tasks.iter().map(|task| task.files.len()).sum();
    CardBatch {
        file_count,
        model: pack.model.clone(),
        notice: None,
        reviewed_at: None,
        tasks,
    }
}

fn card_from_box(card: &BoxCard) -> WorkCard {
    WorkCard {
        name: card.name.clone(),
        ai_name: None,
        ai_open: card.ai_open,
        months: card.months.clone(),
        period: card.period.clone(),
        confidence: card.confidence.clone(),
        years: Vec::new(),
        deadlines: card
            .deadlines
            .iter()
            .map(|item| super::Deadline {
                month: item.month,
                day: item.day,
                year: None,
                file: item.file.clone(),
                snippet: item.snippet.clone(),
                from_model: item.from_model,
            })
            .collect(),
        todos: card.todos.clone(),
        todo_open: card.todo_open.clone(),
        orgs: card.orgs.clone(),
        org_open: card.org_open.clone(),
        files: card
            .files
            .iter()
            .map(|file| super::WorkFile { rel: file.rel.clone(), modified: String::new(), error: None, clues: Vec::new() })
            .collect(),
        include: true,
        successor_note: card.note.clone(),
    }
}

struct Field {
    key: String,
    label: String,
    text: String,
}

fn export_fields(draft: &ExportDraft) -> Result<Vec<Field>, &'static str> {
    if draft.note.chars().count() > NOTE_CAP {
        return Err("인계 내용이 너무 많습니다.");
    }
    let mut fields = vec![Field { key: "note".to_string(), label: "전임자 한마디".to_string(), text: draft.note.clone() }];
    let mut count = 0usize;
    for (index, task) in draft.batch.tasks.iter().filter(|task| task.include).enumerate() {
        count += 1;
        if count > CARD_CAP {
            return Err("인계 내용이 너무 많습니다.");
        }
        fields.push(Field { key: key_name(index), label: format!("카드 {}", index + 1), text: task.name.clone() });
        fields.push(Field { key: key_card_note(index), label: format!("카드 {} 메모", index + 1), text: task.successor_note.clone() });
        for (deadline_index, item) in task.deadlines.iter().enumerate() {
            fields.push(Field { key: key_deadline(index, deadline_index), label: format!("카드 {} 근거", index + 1), text: item.snippet.clone() });
            fields.push(Field {
                key: key_deadline_file(index, deadline_index),
                label: format!("카드 {} 파일 이름", index + 1),
                text: item.file.clone(),
            });
        }
        for (todo_index, text) in task.todos.iter().enumerate() {
            fields.push(Field { key: key_todo(index, todo_index), label: format!("카드 {} 할 일", index + 1), text: text.clone() });
        }
        for (org_index, text) in task.orgs.iter().enumerate() {
            fields.push(Field { key: key_org(index, org_index), label: format!("카드 {} 기관", index + 1), text: text.clone() });
        }
    }
    if draft.memos.len() > MEMO_CAP || draft.shortcuts.len() > LINK_CAP {
        return Err("인계 내용이 너무 많습니다.");
    }
    for (index, text) in draft.memos.iter().enumerate() {
        fields.push(Field { key: key_memo(index), label: format!("메모 {}", index + 1), text: text.clone() });
    }
    for link in &draft.shortcuts {
        if !matches!(link.kind.as_str(), "url" | "file" | "folder" | "app") || link.name.trim().is_empty() || link.target.trim().is_empty() {
            return Err(BAD_BOX);
        }
        if link.name.chars().count() > 80 || link.target.chars().count() > 1024 {
            return Err("인계 내용이 너무 많습니다.");
        }
    }
    Ok(fields)
}

fn key_name(index: usize) -> String {
    format!("card-{index}-name")
}
fn key_card_note(index: usize) -> String {
    format!("card-{index}-note")
}
fn key_deadline(index: usize, item: usize) -> String {
    format!("card-{index}-snippet-{item}")
}
fn key_deadline_file(index: usize, item: usize) -> String {
    format!("card-{index}-file-{item}")
}
fn key_todo(index: usize, item: usize) -> String {
    format!("card-{index}-todo-{item}")
}
fn key_org(index: usize, item: usize) -> String {
    format!("card-{index}-org-{item}")
}
fn key_memo(index: usize) -> String {
    format!("memo-{index}")
}

fn hit_kinds(text: &str) -> Vec<String> {
    let mut kinds = Vec::new();
    for hit in find_patterns(text, &Profile::v1()) {
        let label = match hit.kind {
            FindingKind::Rrn => "주민번호",
            FindingKind::Mobile => "휴대전화",
            FindingKind::Account => "계좌",
            FindingKind::Email => "이메일",
            _ => continue,
        };
        if !kinds.iter().any(|have| have == label) {
            kinds.push(label.to_string());
        }
    }
    kinds
}

fn check_shape(pack: &HandoverBox) -> Result<(), &'static str> {
    if pack.cards.len() > CARD_CAP || pack.shortcuts.len() > LINK_CAP || pack.memos.len() > MEMO_CAP || pack.note.chars().count() > NOTE_CAP {
        return Err("인계 내용이 너무 많습니다.");
    }
    for card in &pack.cards {
        if card.name.chars().count() > 40 || card.months.iter().any(|month| !(1..=12).contains(month)) {
            return Err(BAD_BOX);
        }
        for item in &card.deadlines {
            if !(1..=12).contains(&item.month) || !(1..=31).contains(&item.day) {
                return Err(BAD_BOX);
            }
        }
        for file in &card.files {
            if !rel_is_relative(&file.rel) || file.hash.len() != 64 || !file.hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
                return Err(BAD_BOX);
            }
        }
    }
    for link in &pack.shortcuts {
        if !matches!(link.kind.as_str(), "url" | "file" | "folder" | "app") {
            return Err(BAD_BOX);
        }
    }
    if let Some(folder) = &pack.folder {
        if folder.path.chars().count() > 1024 || folder.path.contains('\0') {
            return Err(BAD_BOX);
        }
    }
    Ok(())
}

fn clip(text: &str, max_chars: usize) -> String {
    text.trim().chars().take(max_chars).collect()
}

fn content_hash(pack: &HandoverBox) -> Option<String> {
    let bytes = serde_json::to_vec(pack).ok()?;
    sha256(&bytes).map(hex)
}

fn hash_file(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > BYTE_CAP {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    sha256(&bytes).map(hex)
}

fn hex(bytes: [u8; 32]) -> String {
    const DIGITS: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(windows)]
fn sha256(bytes: &[u8]) -> Option<[u8; 32]> {
    use windows::Win32::Security::Cryptography::{
        BCryptCloseAlgorithmProvider, BCryptHash, BCryptOpenAlgorithmProvider, BCRYPT_ALG_HANDLE, BCRYPT_SHA256_ALGORITHM,
    };
    unsafe {
        let mut alg = BCRYPT_ALG_HANDLE::default();
        if BCryptOpenAlgorithmProvider(&mut alg, BCRYPT_SHA256_ALGORITHM, None, Default::default()).is_err() {
            return None;
        }
        let mut out = [0u8; 32];
        let status = BCryptHash(alg, None, bytes, &mut out);
        let _ = BCryptCloseAlgorithmProvider(alg, 0);
        if status.is_err() { None } else { Some(out) }
    }
}

#[cfg(not(windows))]
fn sha256(_bytes: &[u8]) -> Option<[u8; 32]> {
    None
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("이 창에서는 바꿀 수 없습니다.".into())
    }
}

fn local_stamp() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::SYSTEMTIME;
        use windows::Win32::System::SystemInformation::GetLocalTime;
        let stamp: SYSTEMTIME = unsafe { GetLocalTime() };
        return format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}", stamp.wYear, stamp.wMonth, stamp.wDay, stamp.wHour, stamp.wMinute, stamp.wSecond);
    }
    #[cfg(not(windows))]
    "1970-01-01T00:00:00".to_string()
}

fn day_stamp() -> String {
    local_stamp().chars().take(10).collect::<String>().replace('-', "")
}

fn safe_folder_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|ch| !matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).take(40).collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() { "업무".to_string() } else { cleaned.to_string() }
}

#[tauri::command]
pub fn handover_box_name(app: AppHandle, window: WebviewWindow, folder_id: String) -> Result<String, String> {
    main_only(&window)?;
    let name = if folder_id.is_empty() {
        "업무".to_string()
    } else {
        let book = app.state::<GrantBook>();
        let root = path_grant::view_work_folder(&book, &folder_id).map_err(|_| "폴더를 찾지 못했습니다.".to_string())?;
        safe_folder_name(root.file_name().and_then(|value| value.to_str()).unwrap_or("업무"))
    };
    Ok(format!("업무인계_{name}_{}.edupack", day_stamp()))
}

#[tauri::command]
pub fn handover_privacy_spots(window: WebviewWindow, draft: ExportDraft) -> Result<Vec<PrivacySpot>, String> {
    main_only(&window)?;
    privacy_spots(&draft).map_err(|text| text.to_string())
}

#[tauri::command]
pub fn write_handover_box(app: AppHandle, window: WebviewWindow, write_id: String, draft: ExportDraft) -> Result<(), String> {
    main_only(&window)?;
    let book = app.state::<GrantBook>();
    let dest = path_grant::view_write(&book, &write_id, &["edupack", "json"]).map_err(|_| "저장하지 못했습니다.".to_string())?;
    let root = if draft.folder_id.is_empty() {
        None
    } else {
        let path = path_grant::view_work_folder(&book, &draft.folder_id).map_err(|_| "폴더를 찾지 못했습니다.".to_string())?;
        reject_result_inside_source(&path, &dest).map_err(|message| message.to_string())?;
        Some(path)
    };
    let packed = build_box(root.as_deref(), &draft, &local_stamp()).map_err(|text| text.to_string())?;
    let text = seal_box(packed).map_err(|text| text.to_string())?;
    path_grant::write_text(&book, &write_id, &["edupack", "json"], &text, BOX_BYTES).map_err(|_| "저장하지 못했습니다.".to_string())
}

#[tauri::command]
pub fn read_handover_box(app: AppHandle, window: WebviewWindow, id: String) -> Result<HandoverBox, String> {
    main_only(&window)?;
    let book = app.state::<GrantBook>();
    let path = path_grant::view_read(&book, &id).map_err(|_| BAD_BOX.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|_| BAD_BOX.to_string())?;
    let pack = open_box_text(&text).map_err(|message| message.to_string())?;
    path_grant::spend(&book, &id);
    Ok(pack)
}

#[tauri::command]
pub fn parse_handover_box(window: WebviewWindow, text: String) -> Result<HandoverBox, String> {
    main_only(&window)?;
    open_box_text(&text).map_err(|message| message.to_string())
}

#[tauri::command]
pub fn check_handover_file(app: AppHandle, window: WebviewWindow, folder_id: String, rel: String, hash: String) -> Result<String, String> {
    main_only(&window)?;
    let book = app.state::<GrantBook>();
    let root = path_grant::view_work_folder(&book, &folder_id).map_err(|_| "업무 폴더를 다시 고르면 열 수 있습니다.".to_string())?;
    match match_file(&root, &rel, &hash) {
        FileMatch::Same => Ok("same".to_string()),
        FileMatch::Changed => Ok(CHANGED_FILE.to_string()),
        FileMatch::Missing => Err("업무 폴더에서 찾지 못했습니다.".into()),
    }
}

#[tauri::command]
pub fn local_target_present(window: WebviewWindow, target: String) -> Result<bool, String> {
    main_only(&window)?;
    if target.len() > 1024 || target.contains('\0') {
        return Ok(false);
    }
    let path = PathBuf::from(target.trim());
    Ok(path.is_file() || path.is_dir())
}

pub fn looks_like_handover(text: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    value.get("kind").and_then(|item| item.as_str()) == Some(KIND)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn sample_batch() -> CardBatch {
        let mut card = super::super::build_card("운영위원회".to_string(), vec![super::super::WorkFile {
            rel: "회의/메모.txt".to_string(),
            modified: "2026-04-02".to_string(),
            error: None,
            clues: Vec::new(),
        }]);
        card.deadlines.push(super::super::Deadline {
            month: 4,
            day: 2,
            year: Some(2026),
            file: "메모.txt".to_string(),
            snippet: "제출기한".to_string(),
            from_model: false,
        });
        card.todos = vec!["명단 확인".to_string()];
        card.todo_open = vec![false];
        card.orgs = vec!["교육청".to_string()];
        card.org_open = vec![false];
        card.include = true;
        CardBatch { file_count: 1, model: Some("demo:1".to_string()), notice: None, reviewed_at: None, tasks: vec![card] }
    }

    fn draft(batch: CardBatch, memos: Vec<String>) -> ExportDraft {
        ExportDraft {
            folder_id: String::new(),
            include_folder: false,
            note: "잘 부탁드립니다".to_string(),
            batch,
            shortcuts: vec![BoxLink { name: "나이스".to_string(), kind: "url".to_string(), target: "https://example.com".to_string() }],
            memos,
            keep: Vec::new(),
        }
    }

    #[test]
    fn roundtrip_keeps_cards_links_and_memos_without_a_file_path() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("handover-scratch").join("box");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("회의")).unwrap();
        let file = dir.join("회의").join("메모.txt");
        fs::write(&file, "회의 자료").unwrap();
        let mut ask = draft(sample_batch(), vec!["회의 메모".to_string()]);
        ask.include_folder = true;
        let packed = build_box(Some(&dir), &ask, "2026-10-04T21:00:00").unwrap();
        let text = seal_box(packed).unwrap();
        let root = dir.to_string_lossy().to_string();
        let mut value: Value = serde_json::from_str(&text).unwrap();
        value["folder"] = Value::Null;
        assert!(!value.to_string().contains(&root), "{text}");
        let opened = open_box_text(&text).unwrap();
        assert_eq!(opened.cards[0].name, "운영위원회");
        assert_eq!(opened.shortcuts[0].target, "https://example.com");
        assert_eq!(opened.memos, vec!["회의 메모".to_string()]);
        assert_eq!(opened.model.as_deref(), Some("demo:1"));
        assert_eq!(opened.cards[0].files[0].rel, "회의/메모.txt");
        assert!(opened.cards[0].deadlines.iter().any(|item| item.month == 4 && item.day == 2));
        let batch = box_to_batch(&opened);
        assert_eq!(batch.tasks[0].name, "운영위원회");
        assert_eq!(batch.tasks[0].files[0].rel, "회의/메모.txt");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn phone_in_a_memo_is_masked_unless_kept() {
        let ask = draft(sample_batch(), vec!["연락 010-1234-5678".to_string()]);
        let spots = privacy_spots(&ask).unwrap();
        assert!(spots.iter().any(|spot| spot.key == "memo-0" && spot.kind.contains("휴대전화")));
        let masked = build_box(None, &ask, "2026-10-04T21:00:00").unwrap();
        assert!(masked.memos[0].contains("[가림]"));
        assert!(!masked.memos[0].contains("010-1234-5678"));
        let mut kept = ask;
        kept.keep = vec!["memo-0".to_string()];
        let raw = build_box(None, &kept, "2026-10-04T21:00:00").unwrap();
        assert!(raw.memos[0].contains("010-1234-5678"));
    }

    #[test]
    fn other_kind_and_a_broken_hash_are_refused() {
        let err = open_box_text(r#"{"kind":"edulauncher-backup","tools":[]}"#).unwrap_err();
        assert_eq!(err, BAD_BOX);
        assert!(!looks_like_handover(r#"{"notices":[]}"#));
        assert!(looks_like_handover(r#"{"kind":"work-handover"}"#));
        let packed = build_box(None, &draft(sample_batch(), vec!["메모".to_string()]), "2026-10-04T21:00:00").unwrap();
        let mut text = seal_box(packed).unwrap();
        text = text.replacen("운영위원회", "운영위윈회", 1);
        assert_eq!(open_box_text(&text).unwrap_err(), BROKEN_BOX);
        let huge = "x".repeat(BOX_BYTES + 1);
        assert_eq!(open_box_text(&huge).unwrap_err(), BIG_BOX);
    }

    #[test]
    fn evidence_hash_matches_until_the_file_changes() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("handover-scratch").join("hash");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("회의")).unwrap();
        let file = dir.join("회의").join("메모.txt");
        fs::write(&file, "회의 자료").unwrap();
        let packed = build_box(Some(&dir), &draft(sample_batch(), Vec::new()), "2026-10-04T21:00:00").unwrap();
        let hash = packed.cards[0].files[0].hash.clone();
        assert_eq!(match_file(&dir, "회의/메모.txt", &hash), FileMatch::Same);
        fs::write(&file, "회의 자료 수정").unwrap();
        assert_eq!(match_file(&dir, "회의/메모.txt", &hash), FileMatch::Changed);
        assert_eq!(CHANGED_FILE, "전임자가 넘긴 뒤 바뀐 파일입니다");
        let _ = fs::remove_dir_all(&dir);
    }
}
