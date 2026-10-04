//! 규칙 카드가 만들어진 뒤, 이 PC의 모델이 이름·할 일·기관·날짜를 제안한다.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::loopback::{self, LoopStop, DEFAULT_WAIT_MS, REPLY_CAP};
use crate::path_grant::{self, GrantBook};
use crate::privacy_scan::{find_patterns, FindingKind, Profile};

use super::marks::{DateMark, MarkKind, MarkSource, WEIGHT_MODEL};
use super::{build_card, file_under, read_body, CardBatch, WorkCard, WorkFile, HALT};

pub const AI_FILE_CAP: usize = 3;
pub const HEAD_CHARS: usize = 3_000;

const ASK_PATH: &str = "/v1/chat/completions";
const LIST_PATH: &str = "/api/tags";
const GUIDE: &str = "너는 공공기관 업무 인수인계를 돕는 도우미다. 사용자가 준 문서 한 건을 읽고 JSON 객체 하나만 출력하라.\n설명, 코드블록, 마크다운은 쓰지 마라.\n형식:\n{\"업무명\": \"연도·날짜 없는 짧은 업무 이름\", \"문서유형\": \"공문|계획|결과보고|회의록|서식|명단|메모|기타\",\n \"할일\": [\"후임자가 해야 할 일을 짧게\"], \"관련기관\": [\"협의·제출 상대\"],\n \"날짜\": [{\"날짜\": \"YYYY-MM-DD 또는 MM-DD\", \"의미\": \"제출기한|행사일|시행일|기타\"}],\n \"요약\": \"한 문장\"}\n규칙: 문서에 없는 내용은 만들지 마라. 모르면 빈 배열이나 빈 문자열로 둔다.";

fn loop_message(stop: LoopStop) -> String {
    match stop {
        LoopStop::Rejected | LoopStop::Redirected => "이 주소는 연결하지 않습니다.".to_string(),
        LoopStop::TimedOut => "응답 시간이 너무 깁니다.".to_string(),
        LoopStop::TooLarge => "응답이 너무 큽니다.".to_string(),
        LoopStop::Failed => "연결하지 못했습니다.".to_string(),
    }
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("이 창에서는 바꿀 수 없습니다.".into())
    }
}

fn model_name_ok(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name.chars().count() <= 80
        && name.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, ':' | '.' | '_' | '-'))
}

pub fn hide_personal(text: &str) -> String {
    let hits = find_patterns(text, &Profile::v1());
    let mut spans: Vec<(usize, usize)> = hits
        .into_iter()
        .filter(|hit| matches!(hit.kind, FindingKind::Rrn | FindingKind::Mobile | FindingKind::Account | FindingKind::Email))
        .map(|hit| (hit.start, hit.end))
        .collect();
    spans.sort_by_key(|span| span.0);
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut cursor = 0usize;
    for (start, end) in spans {
        if start < cursor || end > chars.len() || start >= end {
            continue;
        }
        out.extend(chars[cursor..start].iter());
        out.push_str("[가림]");
        cursor = end;
    }
    out.extend(chars[cursor..].iter());
    out
}

fn ask_body(model: &str, rel: &str, text: &str) -> String {
    serde_json::json!({
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": GUIDE},
            {"role": "user", "content": format!("파일 경로: {rel}\n\n본문(앞부분):\n{text}")}
        ]
    })
    .to_string()
}

fn reply_object(body: &[u8]) -> Option<Value> {
    let text = std::str::from_utf8(body).ok()?;
    let value: Value = serde_json::from_str(text).ok()?;
    let content = value.get("choices")?.get(0)?.get("message")?.get("content")?.as_str()?;
    object_in_text(content)
}

pub fn object_in_text(content: &str) -> Option<Value> {
    let stripped = content.replace("```json", "").replace("```", "");
    let start = stripped.find('{')?;
    let end = stripped.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&stripped[start..=end]).ok()
}

fn model_date(text: &str) -> Option<(Option<u32>, u32, Option<u32>)> {
    let text = text.trim();
    let parts: Vec<&str> = text.split(['-', '.', '/']).filter(|part| !part.is_empty()).collect();
    let (year, month, day) = if parts.len() >= 3 && parts[0].len() == 4 {
        (parts[0].parse().ok(), parts[1].parse().ok()?, parts[2].parse().ok())
    } else if parts.len() >= 2 {
        (None, parts[0].parse().ok()?, parts.get(1).and_then(|part| part.parse().ok()))
    } else {
        return None;
    };
    if !(1..=12).contains(&month) {
        return None;
    }
    if let Some(day) = day {
        if !(1..=31).contains(&day) {
            return None;
        }
    }
    if let Some(year) = year {
        if !(2000..=2100).contains(&year) {
            return None;
        }
    }
    Some((year, month, day))
}

fn default_year(file: &WorkFile) -> u32 {
    file.clues
        .iter()
        .filter(|clue| clue.source != MarkSource::Modified)
        .filter_map(|clue| clue.year)
        .max()
        .or_else(|| file.modified.get(..4).and_then(|text| text.parse().ok()))
        .unwrap_or(2000)
}

fn push_unique(items: &mut Vec<String>, open: &mut Vec<bool>, text: &str, from_model: bool) {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 80 || items.len() >= 8 {
        return;
    }
    if items.iter().any(|have| have == text) {
        return;
    }
    items.push(text.to_string());
    open.push(from_model);
}

fn apply_object(file: &mut WorkFile, object: &Value, names: &mut Vec<String>, todos: &mut Vec<String>, todo_open: &mut Vec<bool>, orgs: &mut Vec<String>, org_open: &mut Vec<bool>) {
    if let Some(name) = object.get("업무명").and_then(|item| item.as_str()) {
        let name = name.trim();
        if !name.is_empty() && name.chars().count() <= 40 {
            names.push(name.to_string());
        }
    }
    if let Some(list) = object.get("할일").and_then(|item| item.as_array()) {
        for item in list {
            if let Some(text) = item.as_str() {
                push_unique(todos, todo_open, text, true);
            }
        }
    }
    if let Some(list) = object.get("관련기관").and_then(|item| item.as_array()) {
        for item in list {
            if let Some(text) = item.as_str() {
                push_unique(orgs, org_open, text, true);
            }
        }
    }
    let year = default_year(file);
    let Some(dates) = object.get("날짜").and_then(|item| item.as_array()) else {
        return;
    };
    for item in dates {
        let Some((found_year, month, day)) = item.get("날짜").and_then(|value| value.as_str()).and_then(model_date) else {
            continue;
        };
        let meaning = item.get("의미").and_then(|value| value.as_str()).unwrap_or("");
        let kind = if meaning.contains("기한") { MarkKind::Deadline } else { MarkKind::Event };
        let label: String = meaning.chars().take(20).collect();
        file.clues.push(DateMark {
            month,
            year: Some(found_year.unwrap_or(year)),
            day,
            kind,
            source: MarkSource::Model,
            weight: WEIGHT_MODEL,
            snippet: label,
            held: false,
        });
    }
}

fn majority(names: &[String]) -> Option<String> {
    let mut best: Option<(String, usize)> = None;
    for name in names {
        let count = names.iter().filter(|item| *item == name).count();
        let replace = match &best {
            Some((_, have)) => count > *have,
            None => true,
        };
        if replace {
            best = Some((name.clone(), count));
        }
    }
    best.map(|(name, _)| name)
}

fn drop_open_model(card: &mut WorkCard) {
    for file in &mut card.files {
        file.clues.retain(|clue| clue.source != MarkSource::Model || clue.held);
    }
    let mut todos = Vec::new();
    let mut todo_open = Vec::new();
    for (index, text) in card.todos.iter().enumerate() {
        if !card.todo_open.get(index).copied().unwrap_or(false) {
            todos.push(text.clone());
            todo_open.push(false);
        }
    }
    card.todos = todos;
    card.todo_open = todo_open;
    let mut orgs = Vec::new();
    let mut org_open = Vec::new();
    for (index, text) in card.orgs.iter().enumerate() {
        if !card.org_open.get(index).copied().unwrap_or(false) {
            orgs.push(text.clone());
            org_open.push(false);
        }
    }
    card.orgs = orgs;
    card.org_open = org_open;
    card.ai_name = None;
    card.ai_open = false;
}

fn refill(card: WorkCard) -> WorkCard {
    let WorkCard { name, ai_name, ai_open, todos, todo_open, orgs, org_open, files, include, .. } = card;
    let mut next = build_card(name, files);
    next.ai_name = ai_name;
    next.ai_open = ai_open;
    next.todos = todos;
    next.todo_open = todo_open;
    next.orgs = orgs;
    next.org_open = org_open;
    next.include = include;
    next
}

fn sample_index(card: &WorkCard) -> Vec<usize> {
    let mut order: Vec<usize> = card.files.iter().enumerate().filter(|(_, file)| file.error.is_none()).map(|(index, _)| index).collect();
    order.sort_by(|left, right| card.files[*right].modified.cmp(&card.files[*left].modified).then(left.cmp(right)));
    order.truncate(AI_FILE_CAP);
    order
}

pub fn assist_batch(root: &Path, mut batch: CardBatch, port: u16, model: &str, wait_ms: i32, halt: &AtomicBool, progress: &dyn Fn(u32, u32)) -> Result<CardBatch, String> {
    if !model_name_ok(model) {
        return Err("모델 이름을 입력하세요.".into());
    }
    let total = batch.tasks.len() as u32;
    progress(0, total);
    for index in 0..batch.tasks.len() {
        if halt.load(Ordering::Relaxed) {
            batch.notice = Some("중지했습니다.".to_string());
            break;
        }
        let mut card = batch.tasks[index].clone();
        drop_open_model(&mut card);
        let mut names = Vec::new();
        let chosen = sample_index(&card);
        for file_index in chosen {
            let file = &card.files[file_index];
            let path = file_under(root, &file.rel).map_err(|_| "파일을 열지 못했습니다.".to_string())?;
            let (text, _) = read_body(&path);
            if text.is_empty() {
                continue;
            }
            let head = super::clip_chars(&text, HEAD_CHARS);
            let hidden = hide_personal(&head);
            let payload = ask_body(model, &file.rel, &hidden);
            let reply = loopback::exchange("127.0.0.1", port, "POST", ASK_PATH, payload.as_bytes(), REPLY_CAP, wait_ms).map_err(loop_message)?;
            let Some(object) = reply_object(&reply) else {
                continue;
            };
            apply_object(&mut card.files[file_index], &object, &mut names, &mut card.todos, &mut card.todo_open, &mut card.orgs, &mut card.org_open);
        }
        if let Some(name) = majority(&names) {
            card.ai_name = Some(name);
            card.ai_open = true;
        }
        batch.tasks[index] = refill(card);
        progress((index as u32) + 1, total);
    }
    batch.model = Some(model.trim().to_string());
    Ok(batch)
}

#[tauri::command]
pub fn list_local_models(window: WebviewWindow, port: u16) -> Result<Vec<String>, String> {
    main_only(&window)?;
    let body = loopback::exchange("127.0.0.1", port, "GET", LIST_PATH, b"", REPLY_CAP, 5_000).map_err(|_| "목록을 가져오지 못했습니다. 모델 이름을 입력하세요.".to_string())?;
    let text = std::str::from_utf8(&body).map_err(|_| "목록을 가져오지 못했습니다. 모델 이름을 입력하세요.".to_string())?;
    let value: Value = serde_json::from_str(text).map_err(|_| "목록을 가져오지 못했습니다. 모델 이름을 입력하세요.".to_string())?;
    let mut names = Vec::new();
    if let Some(models) = value.get("models").and_then(|item| item.as_array()) {
        for item in models {
            if let Some(name) = item.get("name").and_then(|value| value.as_str()) {
                if model_name_ok(name) {
                    names.push(name.to_string());
                }
            }
        }
    }
    if names.is_empty() {
        return Err("목록을 가져오지 못했습니다. 모델 이름을 입력하세요.".into());
    }
    Ok(names)
}

#[tauri::command]
pub fn check_local_model(window: WebviewWindow, port: u16, model: String) -> Result<u64, String> {
    main_only(&window)?;
    if !model_name_ok(&model) {
        return Err("모델 이름을 입력하세요.".into());
    }
    let payload = serde_json::json!({
        "model": model.trim(),
        "temperature": 0,
        "messages": [{"role": "user", "content": "ok"}]
    })
    .to_string();
    let started = Instant::now();
    let reply = loopback::exchange("127.0.0.1", port, "POST", ASK_PATH, payload.as_bytes(), REPLY_CAP, DEFAULT_WAIT_MS).map_err(loop_message)?;
    if serde_json::from_slice::<Value>(&reply).is_err() {
        return Err("연결하지 못했습니다.".into());
    }
    Ok(started.elapsed().as_millis() as u64)
}

#[tauri::command]
pub async fn assist_work_cards(app: AppHandle, window: WebviewWindow, folder_id: String, batch: CardBatch, port: u16, model: String) -> Result<CardBatch, String> {
    main_only(&window)?;
    if port == 0 {
        return Err("이 주소는 연결하지 않습니다.".into());
    }
    HALT.store(false, Ordering::Relaxed);
    let app_for_scan = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let book = app_for_scan.state::<GrantBook>();
        let root = path_grant::view_work_folder(&book, &folder_id).map_err(|_| "업무 폴더를 다시 고르면 열 수 있습니다.".to_string())?;
        assist_batch(&root, batch, port, &model, DEFAULT_WAIT_MS, &HALT, &|read, total| {
            let _ = app_for_scan.emit(
                "handover-step",
                serde_json::json!({"read": read, "total": total, "phase": "assist"}),
            );
        })
    })
    .await;
    result.map_err(|_| "연결하지 못했습니다.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;
    use std::time::Duration;

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
                    let Some(header_end) = header_end else {
                        continue;
                    };
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

    #[test]
    fn hides_a_number_and_a_phone_before_sending() {
        let raw = "담당 110111-1234567 연락 010-1234-5678";
        let hidden = hide_personal(raw);
        assert!(hidden.contains("[가림]"), "{hidden}");
        assert!(!hidden.contains("110111-1234567"), "{hidden}");
        assert!(!hidden.contains("010-1234-5678"), "{hidden}");
    }

    #[test]
    fn fake_server_returns_fenced_and_broken_json() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().unwrap();
                let text = read_request(&mut sock);
                let content = if text.contains("fence.txt") {
                    "```json\n{\"업무명\":\"울타리\",\"할일\":[],\"관련기관\":[],\"날짜\":[]}\n```"
                } else {
                    "[{깨짐"
                };
                let payload = serde_json::json!({"choices":[{"message":{"content": content}}]}).to_string();
                let reply = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                    payload.len()
                );
                let _ = sock.write_all(reply.as_bytes());
            }
        });
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("handover-scratch").join("fence");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("회의")).unwrap();
        std::fs::write(dir.join("회의").join("fence.txt"), "회의 자료").unwrap();
        std::fs::write(dir.join("회의").join("broken.txt"), "다른 자료").unwrap();
        let book = GrantBook::new();
        let id = super::super::remember_work_folder(&book, &dir).unwrap();
        let batch = super::super::read_work_cards(&book, &id).unwrap();
        let root = path_grant::view_work_folder(&book, &id).unwrap();
        let next = assist_batch(&root, batch, port, "demo:1", 3_000, &AtomicBool::new(false), &|_, _| {}).unwrap();
        assert_eq!(next.tasks.len(), 1);
        assert_eq!(next.tasks[0].ai_name.as_deref(), Some("울타리"));
        assert!(next.tasks[0].todos.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_fenced_json_and_drops_broken_json() {
        let fenced = "설명\n```json\n{\"업무명\":\"점검\",\"할일\":[],\"관련기관\":[],\"날짜\":[]}\n```";
        let object = object_in_text(fenced).unwrap();
        assert_eq!(object.get("업무명").and_then(|item| item.as_str()), Some("점검"));
        assert!(object_in_text("[{깨짐").is_none());
        assert!(object_in_text("그냥 문장").is_none());
    }

    #[test]
    fn local_reply_adds_a_suggestion_and_a_deadline() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let text = read_request(&mut sock);
            assert!(text.contains("[가림]"), "{text}");
            assert!(!text.contains("010-1234-5678"), "{text}");
            let content = r#"{"업무명":"점검","할일":["명단 확인"],"관련기관":["교육청"],"날짜":[{"날짜":"2024-04-02","의미":"제출기한"}]}"#;
            let payload = serde_json::json!({"choices":[{"message":{"content": content}}]}).to_string();
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                payload.len()
            );
            let _ = sock.write_all(reply.as_bytes());
        });
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("handover-scratch").join("assist");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("메모.txt"), "담당 110111-1234567 연락 010-1234-5678").unwrap();
        let book = GrantBook::new();
        let id = super::super::remember_work_folder(&book, &dir).unwrap();
        let batch = super::super::read_work_cards(&book, &id).unwrap();
        let root = path_grant::view_work_folder(&book, &id).unwrap();
        let next = assist_batch(&root, batch, port, "demo:1", 3_000, &AtomicBool::new(false), &|_, _| {}).unwrap();
        let card = &next.tasks[0];
        assert_eq!(card.ai_name.as_deref(), Some("점검"));
        assert!(card.ai_open);
        assert!(card.todos.iter().any(|item| item == "명단 확인"));
        assert!(card.todo_open.first().copied().unwrap_or(false));
        assert!(card.deadlines.iter().any(|item| item.month == 4 && item.day == 2 && item.from_model));
        assert_eq!(next.model.as_deref(), Some("demo:1"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
