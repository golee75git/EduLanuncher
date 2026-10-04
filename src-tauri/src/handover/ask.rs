//! 후임자 화면의 질문. 조각과 색인은 메모리에만 두고 디스크에 쓰지 않는다.

use std::sync::atomic::Ordering;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::document_search::tokens::{contains_query, folded, trigram_set};
use crate::loopback::{self, LoopStop, DEFAULT_WAIT_MS, REPLY_CAP};
use crate::path_grant::{self, GrantBook};

use super::assist::hide_personal;
use super::handover_box::{match_file, FileMatch, HandoverBox};
use super::{folder_passages, BUSY};

pub const CHUNK_CHARS: usize = 480;
pub const CHUNK_OVERLAP: usize = 80;
pub const TOP_N: usize = 5;
pub const NOT_FOUND: &str = "넘겨받은 자료에서 찾지 못했습니다";
pub const FOUND: &str = "관련 내용을 찾았습니다";
pub const UNCHECKED: &str = "근거를 확인하지 못한 답입니다";
pub const CHANGED_LABEL: &str = "전임자가 넘긴 뒤 바뀐 파일";

const ASK_PATH: &str = "/v1/chat/completions";
const GUIDE: &str = "주어진 근거만으로 답하세요. 근거에 답이 없으면 모른다고 하세요. 문장마다 근거 번호 [1]처럼 붙이세요.";

#[derive(Clone, Debug, Serialize)]
pub struct AskPiece {
    pub title: String,
    pub excerpt: String,
    pub rel: String,
    pub changed: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct AskReply {
    pub kind: String,
    pub text: String,
    pub pieces: Vec<AskPiece>,
    pub warning: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct AskDraft {
    pub question: String,
    pub folder_id: String,
    pub packed: HandoverBox,
    pub notes: Vec<String>,
    pub port: u16,
    pub model: String,
    pub use_model: bool,
}

#[derive(Clone)]
struct Piece {
    title: String,
    rel: String,
    changed: bool,
    text: String,
    score: i32,
    order: usize,
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("이 창에서는 바꿀 수 없습니다.".into())
    }
}

fn loop_message(stop: LoopStop) -> String {
    match stop {
        LoopStop::Rejected | LoopStop::Redirected => "이 주소는 연결하지 않습니다.".to_string(),
        LoopStop::TimedOut => "응답 시간이 너무 깁니다.".to_string(),
        LoopStop::TooLarge => "응답이 너무 큽니다.".to_string(),
        LoopStop::Failed => "연결하지 못했습니다.".to_string(),
    }
}

fn clip_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn file_title(rel: &str) -> String {
    rel.split(['/', '\\']).next_back().unwrap_or(rel).to_string()
}

fn chunks_of(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for para in text.split("\n\n") {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }
        let chars: Vec<char> = para.chars().collect();
        if chars.len() <= CHUNK_CHARS {
            out.push(para.to_string());
            continue;
        }
        let step = CHUNK_CHARS.saturating_sub(CHUNK_OVERLAP).max(1);
        let mut start = 0usize;
        while start < chars.len() {
            let end = (start + CHUNK_CHARS).min(chars.len());
            let slice: String = chars[start..end].iter().collect();
            if !slice.trim().is_empty() {
                out.push(slice);
            }
            if end == chars.len() {
                break;
            }
            start += step;
        }
    }
    if out.is_empty() && !text.trim().is_empty() {
        out.push(clip_chars(text.trim(), CHUNK_CHARS));
    }
    out
}

fn score_text(query: &str, text: &str) -> i32 {
    let shared = trigram_set(&folded(query)).intersection(&trigram_set(&folded(text))).count() as i32;
    let mut words = 0i32;
    for word in query.split(|ch: char| ch.is_whitespace() || matches!(ch, '?' | '？' | '.' | ',' | '!' | '！')) {
        let word = word.trim();
        if word.chars().count() >= 2 && contains_query(text, word) {
            words += 1;
        }
    }
    if shared == 0 && words == 0 {
        0
    } else {
        shared.saturating_mul(2).saturating_add(words.saturating_mul(20))
    }
}

fn card_body(card: &super::handover_box::BoxCard, note: &str) -> String {
    let mut parts = vec![card.name.clone(), card.period.clone()];
    for item in &card.deadlines {
        parts.push(format!("{}월 {}일 {}", item.month, item.day, item.snippet));
    }
    parts.extend(card.todos.iter().cloned());
    parts.extend(card.orgs.iter().cloned());
    if !card.note.trim().is_empty() {
        parts.push(card.note.clone());
    }
    if !note.trim().is_empty() {
        parts.push(note.to_string());
    }
    parts.join("\n")
}

fn sources(packed: &HandoverBox, notes: &[String], rows: &[(String, String, bool)]) -> Vec<Piece> {
    let mut found = Vec::new();
    if !packed.note.trim().is_empty() {
        found.push(Piece {
            title: "전임자 한마디".to_string(),
            rel: String::new(),
            changed: false,
            text: packed.note.clone(),
            score: 0,
            order: found.len(),
        });
    }
    for memo in &packed.memos {
        if memo.trim().is_empty() {
            continue;
        }
        found.push(Piece {
            title: "메모".to_string(),
            rel: String::new(),
            changed: false,
            text: memo.clone(),
            score: 0,
            order: found.len(),
        });
    }
    for (index, card) in packed.cards.iter().enumerate() {
        let note = notes.get(index).map(|text| text.as_str()).unwrap_or("");
        found.push(Piece {
            title: card.name.clone(),
            rel: String::new(),
            changed: false,
            text: card_body(card, note),
            score: 0,
            order: found.len(),
        });
    }
    for (rel, text, changed) in rows {
        if text.trim().is_empty() {
            continue;
        }
        found.push(Piece {
            title: file_title(rel),
            rel: rel.clone(),
            changed: *changed,
            text: text.clone(),
            score: 0,
            order: found.len(),
        });
    }
    found
}

fn top_pieces(question: &str, packed: &HandoverBox, notes: &[String], rows: &[(String, String, bool)]) -> Vec<Piece> {
    let mut ranked = Vec::new();
    for source in sources(packed, notes, rows) {
        for chunk in chunks_of(&source.text) {
            let score = score_text(question, &chunk);
            if score <= 0 {
                continue;
            }
            ranked.push(Piece { text: chunk, score, ..source.clone() });
        }
    }
    ranked.sort_by(|left, right| right.score.cmp(&left.score).then(left.order.cmp(&right.order)));
    ranked.truncate(TOP_N);
    ranked
}

fn show_pieces(pieces: &[Piece]) -> Vec<AskPiece> {
    pieces
        .iter()
        .map(|piece| AskPiece {
            title: piece.title.clone(),
            excerpt: clip_chars(&piece.text.split_whitespace().collect::<Vec<_>>().join(" "), 120),
            rel: piece.rel.clone(),
            changed: piece.changed,
        })
        .collect()
}

fn month_text(question: &str, packed: &HandoverBox, notes: &[String], month: u32) -> Option<String> {
    let question = question.trim();
    if question.contains("이번 달") && (question.contains("할 일") || question.contains("업무")) {
        let mut lines = Vec::new();
        for (index, card) in packed.cards.iter().enumerate() {
            if !card.months.contains(&month) {
                continue;
            }
            let todos = if card.todos.is_empty() { card.period.clone() } else { card.todos.join(", ") };
            let note = notes.get(index).map(|text| text.trim()).unwrap_or("");
            if note.is_empty() {
                lines.push(format!("{} — {}", card.name, todos));
            } else {
                lines.push(format!("{} — {} — {}", card.name, todos, note));
            }
        }
        if lines.is_empty() {
            return None;
        }
        return Some(format!("이번 달 할 일\n{}", lines.join("\n")));
    }
    if question.contains("다음 달") && question.contains("기한") {
        let next = if month >= 12 { 1 } else { month + 1 };
        let mut lines = Vec::new();
        for card in &packed.cards {
            let mut hit = false;
            for item in &card.deadlines {
                if item.month == next {
                    hit = true;
                    lines.push(format!("{} — {}월 {}일 {}", card.name, item.month, item.day, item.snippet));
                }
            }
            if !hit && card.months.contains(&next) {
                lines.push(format!("{} — {}월 · {}", card.name, next, card.period));
            }
        }
        if lines.is_empty() {
            return None;
        }
        return Some(format!("다음 달 기한\n{}", lines.join("\n")));
    }
    None
}

fn has_evidence_number(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    for index in 0..chars.len() {
        if chars[index] != '[' {
            continue;
        }
        let mut cursor = index + 1;
        if cursor >= chars.len() || !chars[cursor].is_ascii_digit() {
            continue;
        }
        while cursor < chars.len() && chars[cursor].is_ascii_digit() {
            cursor += 1;
        }
        if cursor < chars.len() && chars[cursor] == ']' {
            return true;
        }
    }
    false
}

fn model_text(body: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let text = value.get("choices")?.get(0)?.get("message")?.get("content")?.as_str()?.trim();
    if text.is_empty() { None } else { Some(text.to_string()) }
}

fn model_ok(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty() && name.chars().count() <= 80 && name.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ':' | '.' | '_' | '-'))
}

fn prompt(question: &str, pieces: &[Piece], model: &str) -> String {
    let mut body = format!("질문: {}\n\n근거:\n", clip_chars(question.trim(), 200));
    for (index, piece) in pieces.iter().enumerate() {
        let mark = if piece.changed { format!(" ({CHANGED_LABEL})") } else { String::new() };
        body.push_str(&format!("[{}] {}{mark}\n{}\n", index + 1, piece.title, piece.text));
    }
    let hidden = hide_personal(&body);
    serde_json::json!({
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": GUIDE},
            {"role": "user", "content": hidden}
        ]
    })
    .to_string()
}

pub fn rows_from(root: &std::path::Path, packed: &HandoverBox) -> Vec<(String, String, bool)> {
    folder_passages(root)
        .into_iter()
        .map(|(rel, text)| {
            let changed = packed.cards.iter().any(|card| {
                card.files.iter().any(|file| {
                    file.rel.replace('\\', "/") == rel.replace('\\', "/")
                        && matches!(match_file(root, &rel, &file.hash), FileMatch::Changed)
                })
            });
            (rel, text, changed)
        })
        .collect()
}

pub fn answer_from(
    packed: &HandoverBox,
    notes: &[String],
    question: &str,
    month: u32,
    rows: &[(String, String, bool)],
    use_model: bool,
    port: u16,
    model: &str,
    mut fetch: impl FnMut(&str) -> Result<Vec<u8>, String>,
) -> AskReply {
    let pieces = top_pieces(question, packed, notes, rows);
    if let Some(text) = month_text(question, packed, notes, month) {
        return AskReply { kind: "month".to_string(), text, pieces: show_pieces(&pieces), warning: String::new() };
    }
    if pieces.is_empty() {
        return AskReply { kind: "none".to_string(), text: NOT_FOUND.to_string(), pieces: Vec::new(), warning: String::new() };
    }
    let shown = show_pieces(&pieces);
    if !use_model || port == 0 || !model_ok(model) {
        return AskReply { kind: "search".to_string(), text: FOUND.to_string(), pieces: shown, warning: String::new() };
    }
    let payload = prompt(question, &pieces, model.trim());
    let reply = match fetch(&payload) {
        Ok(body) => body,
        Err(_) => return AskReply { kind: "search".to_string(), text: FOUND.to_string(), pieces: shown, warning: String::new() },
    };
    let Some(text) = model_text(&reply) else {
        return AskReply { kind: "search".to_string(), text: FOUND.to_string(), pieces: shown, warning: String::new() };
    };
    let warning = if has_evidence_number(&text) { String::new() } else { UNCHECKED.to_string() };
    AskReply { kind: "model".to_string(), text, pieces: shown, warning }
}

fn local_month() -> u32 {
    #[cfg(windows)]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        return u32::from(unsafe { GetLocalTime() }.wMonth);
    }
    #[cfg(not(windows))]
    1
}

#[tauri::command]
pub async fn ask_handover(app: AppHandle, window: WebviewWindow, draft: AskDraft) -> Result<AskReply, String> {
    main_only(&window)?;
    if BUSY.swap(true, Ordering::AcqRel) {
        return Err("이미 파일을 읽고 있습니다.".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<AskReply, String> {
        let rows = if draft.folder_id.is_empty() {
            Vec::new()
        } else {
            let book = app.state::<GrantBook>();
            let root = path_grant::view_work_folder(&book, &draft.folder_id).map_err(|_| "폴더를 찾지 못했습니다.".to_string())?;
            rows_from(&root, &draft.packed)
        };
        let port = draft.port;
        let model = draft.model.clone();
        let use_model = draft.use_model;
        Ok(answer_from(&draft.packed, &draft.notes, &draft.question, local_month(), &rows, use_model, port, &model, |payload| {
            loopback::exchange("127.0.0.1", port, "POST", ASK_PATH, payload.as_bytes(), REPLY_CAP, DEFAULT_WAIT_MS).map_err(loop_message)
        }))
    })
    .await;
    BUSY.store(false, Ordering::Release);
    result.map_err(|_| "답하지 못했습니다.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::Duration;

    use super::super::handover_box::{build_box, BoxLink, ExportDraft};
    use super::super::{build_card, CardBatch, Deadline, WorkFile};

    fn read_request(sock: &mut TcpStream) -> String {
        let _ = sock.set_read_timeout(Some(Duration::from_secs(2)));
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            match sock.read(&mut tmp) {
                Ok(0) => break,
                Ok(count) => {
                    buf.extend_from_slice(&tmp[..count]);
                    let header_end = buf.windows(4).position(|mark| mark == b"\r\n\r\n");
                    let Some(header_end) = header_end else { continue };
                    let headers = String::from_utf8_lossy(&buf[..header_end]);
                    let length = headers.lines().find_map(|line| {
                        let rest = line.split_once(':')?;
                        if rest.0.eq_ignore_ascii_case("content-length") {
                            rest.1.trim().parse::<usize>().ok()
                        } else {
                            None
                        }
                    });
                    if buf.len() >= header_end + 4 + length.unwrap_or(0) {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        String::from_utf8_lossy(&buf).into_owned()
    }

    fn http_ok(content: &str) -> String {
        let payload = serde_json::json!({"choices":[{"message":{"content": content}}]}).to_string();
        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}", payload.len())
    }

    fn card_box() -> HandoverBox {
        let mut card = build_card(
            "운영위원회".to_string(),
            vec![WorkFile { rel: "안내.txt".to_string(), modified: "2026-04-02".to_string(), error: None, clues: Vec::new() }],
        );
        card.months = vec![4];
        card.period = "4월".to_string();
        card.deadlines.push(Deadline {
            month: 5,
            day: 2,
            year: Some(2026),
            file: "안내.txt".to_string(),
            snippet: "제출기한".to_string(),
            from_model: false,
        });
        card.todos = vec!["명단 확인".to_string()];
        card.include = true;
        let draft = ExportDraft {
            folder_id: String::new(),
            include_folder: false,
            note: "잘 부탁드립니다".to_string(),
            batch: CardBatch { file_count: 1, model: None, notice: None, reviewed_at: None, tasks: vec![card] },
            shortcuts: vec![BoxLink { name: "나이스".to_string(), kind: "url".to_string(), target: "https://example.com".to_string() }],
            memos: vec!["회의 메모".to_string()],
            keep: Vec::new(),
        };
        build_box(None, &draft, "2026-10-04T22:20:00", "").unwrap()
    }

    #[test]
    fn deadline_question_brings_the_card_and_a_folder_sentence() {
        let packed = card_box();
        let reply = answer_from(&packed, &[], "제출기한은 무엇인가요", 10, &[], false, 0, "", |_| unreachable!("모델을 부르면 안 됩니다"));
        assert_eq!(reply.kind, "search");
        assert!(reply.pieces.iter().any(|piece| piece.title == "운영위원회" && piece.excerpt.contains("제출기한")), "{reply:?}");
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("handover-scratch").join("ask-folder");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("안내.txt"), "가상폴더 문장 제출은 사월입니다.").unwrap();
        let rows = rows_from(&dir, &packed);
        let reply = answer_from(&packed, &[], "가상폴더 문장", 10, &rows, false, 0, "", |_| unreachable!());
        assert!(reply.pieces.iter().any(|piece| piece.title == "안내.txt" && piece.excerpt.contains("가상폴더")), "{reply:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn month_questions_skip_the_model() {
        let packed = card_box();
        let called = std::sync::atomic::AtomicBool::new(false);
        let reply = answer_from(&packed, &["후임 메모".to_string()], "이번 달에 할 일은?", 4, &[], true, 9, "demo:1", |_| {
            called.store(true, Ordering::Relaxed);
            Err("부르면 안 됩니다".into())
        });
        assert!(!called.load(Ordering::Relaxed));
        assert_eq!(reply.kind, "month");
        assert!(reply.text.contains("운영위원회"), "{reply:?}");
        assert!(reply.text.contains("명단 확인"), "{reply:?}");
        let next = answer_from(&packed, &[], "다음 달 기한은?", 4, &[], true, 9, "demo:1", |_| unreachable!());
        assert_eq!(next.kind, "month");
        assert!(next.text.contains("제출기한"), "{next:?}");
    }

    #[test]
    fn missing_evidence_does_not_call_the_model() {
        let packed = card_box();
        let called = std::sync::atomic::AtomicBool::new(false);
        let reply = answer_from(&packed, &[], "zzzz없는질문qqq", 10, &[], true, 9, "demo:1", |_| {
            called.store(true, Ordering::Relaxed);
            Err("부르면 안 됩니다".into())
        });
        assert!(!called.load(Ordering::Relaxed));
        assert_eq!(reply.kind, "none");
        assert_eq!(reply.text, NOT_FOUND);
        assert!(reply.pieces.is_empty());
    }

    #[test]
    fn pieces_are_not_written() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join("handover-scratch").join("ask-disk");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let before = std::fs::read_dir(&dir).unwrap().count();
        let packed = card_box();
        let _ = answer_from(&packed, &[], "제출기한", 10, &[], false, 0, "", |_| unreachable!());
        let after = std::fs::read_dir(&dir).unwrap().count();
        assert_eq!(before, after);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_file_keeps_its_label() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("handover-scratch").join("ask-changed");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("안내.txt");
        std::fs::write(&file, "처음 문장").unwrap();
        let mut card = build_card(
            "운영위원회".to_string(),
            vec![WorkFile { rel: "안내.txt".to_string(), modified: "2026-04-02".to_string(), error: None, clues: Vec::new() }],
        );
        card.include = true;
        let draft = ExportDraft {
            folder_id: String::new(),
            include_folder: false,
            note: String::new(),
            batch: CardBatch { file_count: 1, model: None, notice: None, reviewed_at: None, tasks: vec![card] },
            shortcuts: Vec::new(),
            memos: Vec::new(),
            keep: Vec::new(),
        };
        let packed = build_box(Some(&dir), &draft, "2026-10-04T22:20:00", "").unwrap();
        std::fs::write(&file, "바뀐 파일의 가상문장입니다.").unwrap();
        let rows = rows_from(&dir, &packed);
        assert!(rows.iter().any(|(_, _, changed)| *changed));
        let reply = answer_from(&packed, &[], "가상문장", 10, &rows, false, 0, "", |_| unreachable!());
        let piece = reply.pieces.iter().find(|piece| piece.title == "안내.txt").unwrap();
        assert!(piece.changed, "{reply:?}");
        assert_eq!(CHANGED_LABEL, "전임자가 넘긴 뒤 바뀐 파일");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fake_model_numbers_missing_numbers_and_a_broken_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for _ in 0..3 {
                let (mut sock, _) = listener.accept().unwrap();
                let text = read_request(&mut sock);
                assert!(text.contains("[가림]"), "{text}");
                assert!(!text.contains("010-1234-5678"), "{text}");
                let content = if text.contains("번호있는질문") {
                    "연락은 전임자 한마디에 있습니다. [1]"
                } else if text.contains("번호없는질문") {
                    "잘 모르겠습니다"
                } else {
                    ""
                };
                let reply = if content.is_empty() {
                    let raw = "not-json";
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{raw}", raw.len())
                } else {
                    http_ok(content)
                };
                let _ = sock.write_all(reply.as_bytes());
            }
        });
        let mut packed = card_box();
        packed.note = "연락 010-1234-5678".to_string();
        let numbered = answer_from(&packed, &[], "번호있는질문 연락", 10, &[], true, port, "demo:1", |payload| {
            loopback::exchange("127.0.0.1", port, "POST", ASK_PATH, payload.as_bytes(), REPLY_CAP, 3_000).map_err(loop_message)
        });
        assert_eq!(numbered.kind, "model");
        assert!(numbered.text.contains("[1]"), "{numbered:?}");
        assert!(numbered.warning.is_empty());
        let bare = answer_from(&packed, &[], "번호없는질문 연락", 10, &[], true, port, "demo:1", |payload| {
            loopback::exchange("127.0.0.1", port, "POST", ASK_PATH, payload.as_bytes(), REPLY_CAP, 3_000).map_err(loop_message)
        });
        assert_eq!(bare.kind, "model");
        assert_eq!(bare.warning, UNCHECKED);
        let broken = answer_from(&packed, &[], "깨진질문 연락", 10, &[], true, port, "demo:1", |payload| {
            loopback::exchange("127.0.0.1", port, "POST", ASK_PATH, payload.as_bytes(), REPLY_CAP, 3_000).map_err(loop_message)
        });
        assert_eq!(broken.kind, "search");
        assert_eq!(broken.text, FOUND);
    }
}
