mod extract;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::Manager;
use tauri::AppHandle;

use extract::{extract_file, ExtractNote};

const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
const MAX_DEPTH: u32 = 8;

struct Gate {
    running: AtomicBool,
    stop: AtomicBool,
    status: Mutex<DocStatus>,
}

fn gate() -> &'static Gate {
    static GATE: OnceLock<Gate> = OnceLock::new();
    GATE.get_or_init(|| Gate {
        running: AtomicBool::new(false),
        stop: AtomicBool::new(false),
        status: Mutex::new(DocStatus::idle()),
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocStatus {
    pub running: bool,
    pub indexed: u32,
    pub skipped: u32,
    pub failed: u32,
    pub current: String,
    pub message: String,
}

impl DocStatus {
    fn idle() -> Self {
        Self {
            running: false,
            indexed: 0,
            skipped: 0,
            failed: 0,
            current: String::new(),
            message: String::new(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocFolder {
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocHit {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub snippet: String,
    pub score: i32,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "앱 폴더를 찾지 못했습니다.".to_string())?;
    fs::create_dir_all(&dir).map_err(|_| "앱 폴더를 만들지 못했습니다.".to_string())?;
    dir.push("doc-search.db");
    Ok(dir)
}

fn open_db(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|_| "검색 기록을 열지 못했습니다.".to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "검색 기록을 열지 못했습니다.".to_string())?;
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS folders (
            path TEXT PRIMARY KEY,
            added_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS docs (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            ext TEXT NOT NULL,
            modified INTEGER NOT NULL,
            size INTEGER NOT NULL,
            hash TEXT NOT NULL,
            body TEXT NOT NULL,
            indexed_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|_| "검색 기록을 준비하지 못했습니다.".to_string())?;
    let fts = conn.execute_batch(
        "
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
            name,
            body,
            content='docs',
            content_rowid='rowid',
            tokenize='trigram'
        );
        CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
            INSERT INTO docs_fts(rowid, name, body) VALUES (new.rowid, new.name, new.body);
        END;
        CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
            INSERT INTO docs_fts(docs_fts, rowid, name, body) VALUES ('delete', old.rowid, old.name, old.body);
        END;
        CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
            INSERT INTO docs_fts(docs_fts, rowid, name, body) VALUES ('delete', old.rowid, old.name, old.body);
            INSERT INTO docs_fts(rowid, name, body) VALUES (new.rowid, new.name, new.body);
        END;
        ",
    );
    if fts.is_err() {
        return Err("본문 검색 기능을 준비하지 못했습니다.".to_string());
    }
    Ok(conn)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn content_mark(text: &str) -> String {
    let mut mark: u64 = 14_695_981_039_346_656_037;
    for byte in text.as_bytes() {
        mark ^= u64::from(*byte);
        mark = mark.wrapping_mul(1_099_511_628_211);
    }
    format!("{mark:016x}")
}

fn set_status(next: DocStatus) {
    if let Ok(mut status) = gate().status.lock() {
        *status = next;
    }
}

fn patch_status(change: impl FnOnce(&mut DocStatus)) {
    if let Ok(mut status) = gate().status.lock() {
        change(&mut status);
    }
}

#[tauri::command]
pub fn doc_search_folders(app: AppHandle) -> Result<Vec<DocFolder>, String> {
    let conn = open_db(&db_path(&app)?)?;
    let mut stmt = conn
        .prepare("SELECT path FROM folders ORDER BY added_at")
        .map_err(|_| "폴더 목록을 읽지 못했습니다.".to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| "폴더 목록을 읽지 못했습니다.".to_string())?;
    let mut folders = Vec::new();
    for row in rows {
        if let Ok(path) = row {
            folders.push(DocFolder { path });
        }
    }
    Ok(folders)
}

#[tauri::command]
pub fn doc_search_add_folder(app: AppHandle, path: String) -> Result<(), String> {
    let folder = PathBuf::from(path.trim());
    if !folder.is_dir() {
        return Err("폴더만 넣을 수 있습니다.".to_string());
    }
    if drive_root(&folder) {
        return Err("드라이브 전체는 고르지 않습니다. 그 안의 폴더를 고르세요.".to_string());
    }
    if blocked_place(&folder) {
        return Err("Windows와 Program Files 폴더는 색인하지 않습니다.".to_string());
    }
    let stored = folder.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
    let conn = open_db(&db_path(&app)?)?;
    conn.execute(
        "INSERT OR IGNORE INTO folders(path, added_at) VALUES (?1, ?2)",
        params![stored, now_secs()],
    )
    .map_err(|_| "폴더를 넣지 못했습니다.".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn doc_search_remove_folder(app: AppHandle, path: String) -> Result<(), String> {
    let conn = open_db(&db_path(&app)?)?;
    let stored = path.trim().trim_end_matches(['\\', '/']).to_string();
    conn.execute("DELETE FROM folders WHERE path = ?1 COLLATE NOCASE", params![stored])
        .map_err(|_| "폴더를 빼지 못했습니다.".to_string())?;
    purge_under(&conn, &stored)?;
    Ok(())
}

#[tauri::command]
pub fn doc_search_clear(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&db_path(&app)?)?;
    conn.execute("DELETE FROM docs", [])
        .map_err(|_| "색인을 지우지 못했습니다.".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn doc_search_status() -> DocStatus {
    gate()
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_else(|_| DocStatus::idle())
}

#[tauri::command]
pub fn doc_search_halt() {
    gate().stop.store(true, Ordering::Relaxed);
    patch_status(|status| {
        if status.running {
            status.message = "멈추는 중...".to_string();
        }
    });
}

#[tauri::command]
pub fn doc_search_start(app: AppHandle) -> Result<(), String> {
    let path = db_path(&app)?;
    let conn = open_db(&path)?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0))
        .unwrap_or(0);
    if count == 0 {
        return Err("먼저 색인할 폴더를 고르세요.".to_string());
    }
    drop(conn);
    if gate().running.swap(true, Ordering::Relaxed) {
        return Err("이미 색인 중입니다.".to_string());
    }
    gate().stop.store(false, Ordering::Relaxed);
    set_status(DocStatus {
        running: true,
        indexed: 0,
        skipped: 0,
        failed: 0,
        current: String::new(),
        message: "색인을 시작합니다.".to_string(),
    });
    thread::spawn(move || {
        let outcome = run_index(&path);
        let stopped = gate().stop.load(Ordering::Relaxed);
        gate().running.store(false, Ordering::Relaxed);
        set_status(DocStatus {
            running: false,
            indexed: outcome.indexed,
            skipped: outcome.skipped,
            failed: outcome.failed,
            current: String::new(),
            message: if stopped {
                "색인을 멈췄습니다.".to_string()
            } else if outcome.failed > 0 {
                format!("색인이 끝났습니다. 읽지 못한 파일 {}개.", outcome.failed)
            } else {
                "색인이 끝났습니다.".to_string()
            },
        });
    });
    Ok(())
}

struct Tally {
    indexed: u32,
    skipped: u32,
    failed: u32,
}

fn run_index(db_file: &Path) -> Tally {
    let mut tally = Tally {
        indexed: 0,
        skipped: 0,
        failed: 0,
    };
    let Ok(conn) = open_db(db_file) else {
        patch_status(|status| status.message = "검색 기록을 열지 못했습니다.".to_string());
        return tally;
    };
    let folders = folder_list(&conn);
    if let Err(_) = purge_outside(&conn, &folders) {
        tally.failed += 1;
    }
    let mut seen = HashSet::new();
    for folder in &folders {
        if gate().stop.load(Ordering::Relaxed) {
            break;
        }
        let mut found = Vec::new();
        walk_folder(Path::new(folder), 0, &mut found);
        for file in found {
            if gate().stop.load(Ordering::Relaxed) {
                break;
            }
            let key = file.to_string_lossy().to_lowercase();
            seen.insert(key);
            let name = file
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| file.to_string_lossy().to_string());
            patch_status(|status| {
                status.current = name.clone();
                status.message = "색인 중...".to_string();
            });
            match index_one(&conn, &file) {
                Ok(IndexOne::Wrote) => tally.indexed += 1,
                Ok(IndexOne::Unchanged) => tally.skipped += 1,
                Err(ExtractNote::Skip(reason)) => {
                    let _ = reason;
                    tally.skipped += 1;
                }
                Err(ExtractNote::Fail(reason)) => {
                    let _ = reason;
                    tally.failed += 1;
                }
            }
            patch_status(|status| {
                status.indexed = tally.indexed;
                status.skipped = tally.skipped;
                status.failed = tally.failed;
            });
        }
    }
    if !gate().stop.load(Ordering::Relaxed) {
        let _ = purge_unseen(&conn, &folders, &seen);
    }
    tally
}

enum IndexOne {
    Wrote,
    Unchanged,
}

fn index_one(conn: &Connection, path: &Path) -> Result<IndexOne, ExtractNote> {
    let meta = fs::metadata(path).map_err(|_| ExtractNote::Fail("파일을 열지 못했습니다.".to_string()))?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err(ExtractNote::Skip("파일이 너무 큽니다.".to_string()));
    }
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_secs() as i64)
        .unwrap_or(0);
    let size = meta.len() as i64;
    let stored = path.to_string_lossy().to_string();
    let previous: Option<(i64, i64)> = conn
        .query_row(
            "SELECT modified, size FROM docs WHERE path = ?1",
            params![stored],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    if previous == Some((modified, size)) {
        return Ok(IndexOne::Unchanged);
    }
    let body = extract_file(path)?;
    let hash = content_mark(&body);
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| stored.clone());
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let same_hash: Option<String> = conn
        .query_row("SELECT hash FROM docs WHERE path = ?1", params![stored], |row| row.get(0))
        .ok();
    if same_hash.as_deref() == Some(hash.as_str()) {
        conn.execute(
            "UPDATE docs SET modified = ?1, size = ?2, indexed_at = ?3 WHERE path = ?4",
            params![modified, size, now_secs(), stored],
        )
        .map_err(|_| ExtractNote::Fail("검색 기록에 넣지 못했습니다.".to_string()))?;
        return Ok(IndexOne::Wrote);
    }
    conn.execute(
        "
        INSERT INTO docs(path, name, ext, modified, size, hash, body, indexed_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            ext = excluded.ext,
            modified = excluded.modified,
            size = excluded.size,
            hash = excluded.hash,
            body = excluded.body,
            indexed_at = excluded.indexed_at
        ",
        params![stored, name, ext, modified, size, hash, body, now_secs()],
    )
    .map_err(|_| ExtractNote::Fail("검색 기록에 넣지 못했습니다.".to_string()))?;
    Ok(IndexOne::Wrote)
}

fn folder_list(conn: &Connection) -> Vec<String> {
    let Ok(mut stmt) = conn.prepare("SELECT path FROM folders") else {
        return Vec::new();
    };
    stmt.query_map([], |row| row.get::<_, String>(0))
        .ok()
        .map(|rows| rows.filter_map(|row| row.ok()).collect())
        .unwrap_or_default()
}

fn purge_under(conn: &Connection, folder: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT path FROM docs")
        .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?;
    let paths: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?
        .filter_map(|row| row.ok())
        .filter(|path| path_under(path, folder))
        .collect();
    for path in paths {
        conn.execute("DELETE FROM docs WHERE path = ?1", params![path])
            .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?;
    }
    Ok(())
}

fn purge_outside(conn: &Connection, folders: &[String]) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT path FROM docs")
        .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?;
    let stale: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?
        .filter_map(|row| row.ok())
        .filter(|path| !folders.iter().any(|folder| path_under(path, folder)))
        .collect();
    for path in stale {
        conn.execute("DELETE FROM docs WHERE path = ?1", params![path])
            .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?;
    }
    Ok(())
}

fn purge_unseen(conn: &Connection, folders: &[String], seen: &HashSet<String>) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT path FROM docs")
        .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?;
    let stale: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?
        .filter_map(|row| row.ok())
        .filter(|path| {
            folders.iter().any(|folder| path_under(path, folder)) && !seen.contains(&path.to_lowercase())
        })
        .collect();
    for path in stale {
        conn.execute("DELETE FROM docs WHERE path = ?1", params![path])
            .map_err(|_| "색인을 정리하지 못했습니다.".to_string())?;
    }
    Ok(())
}

fn path_under(path: &str, folder: &str) -> bool {
    let path_key = path.to_lowercase();
    let folder_key = folder.trim_end_matches(['\\', '/']).to_lowercase();
    let rest = path_key.strip_prefix(&folder_key);
    matches!(rest, Some(tail) if tail.starts_with('\\') || tail.starts_with('/'))
}

fn drive_root(path: &Path) -> bool {
    let text = path.to_string_lossy();
    let trimmed = text.trim_end_matches(['\\', '/']);
    trimmed.len() == 2 && trimmed.as_bytes()[1] == b':'
}

fn blocked_place(path: &Path) -> bool {
    let text = path.to_string_lossy().to_lowercase();
    text.contains("\\windows\\")
        || text.ends_with("\\windows")
        || text.contains("\\program files")
        || text.contains("\\program files (x86)")
}

fn skip_dir(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    let key = name.to_ascii_lowercase();
    matches!(
        key.as_str(),
        "node_modules"
            | "target"
            | "dist"
            | "temp"
            | "windows"
            | "program files"
            | "program files (x86)"
            | "$recycle.bin"
            | "system volume information"
    )
}

fn wanted_ext(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(ext.as_str(), "hwpx" | "hwp" | "xlsx" | "docx" | "pdf" | "txt" | "md" | "csv")
}

fn walk_folder(dir: &Path, depth: u32, found: &mut Vec<PathBuf>) {
    if depth > MAX_DEPTH || found.len() >= MAX_FILES || gate().stop.load(Ordering::Relaxed) {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if found.len() >= MAX_FILES || gate().stop.load(Ordering::Relaxed) {
            return;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if meta.is_dir() {
            if skip_dir(&name) {
                continue;
            }
            walk_folder(&path, depth + 1, found);
        } else if meta.is_file() && wanted_ext(&path) && meta.len() <= MAX_FILE_BYTES {
            found.push(path);
        }
    }
}

#[tauri::command]
pub fn doc_search_query(app: AppHandle, query: String, limit: u32) -> Result<Vec<DocHit>, String> {
    let needle = query.trim();
    if needle.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let cap = limit.clamp(1, 40) as usize;
    let conn = open_db(&db_path(&app)?)?;
    let mut hits = Vec::new();
    if needle.chars().count() >= 3 {
        let quoted = fts_query(needle);
        if let Ok(mut stmt) = conn.prepare(
            "
            SELECT d.path, d.name, d.ext, snippet(docs_fts, 1, '', '', ' … ', 16)
            FROM docs_fts
            JOIN docs d ON d.rowid = docs_fts.rowid
            WHERE docs_fts MATCH ?1
            LIMIT ?2
            ",
        ) {
            if let Ok(rows) = stmt.query_map(params![quoted, cap as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            }) {
                for row in rows.flatten() {
                    hits.push(rank_hit(needle, row.0, row.1, row.2, row.3));
                }
            }
        }
    }
    let like = like_pattern(needle);
    if let Ok(mut stmt) = conn.prepare(
        "
        SELECT path, name, ext
        FROM docs
        WHERE name LIKE ?1 ESCAPE '\\'
        LIMIT ?2
        ",
    ) {
        if let Ok(rows) = stmt.query_map(params![like, cap as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        }) {
            for row in rows.flatten() {
                if hits.iter().any(|hit| hit.path.eq_ignore_ascii_case(&row.0)) {
                    continue;
                }
                hits.push(rank_hit(needle, row.0, row.1, row.2, String::new()));
            }
        }
    }
    if needle.chars().count() < 3 || hits.is_empty() {
        if let Ok(mut stmt) = conn.prepare(
            "
            SELECT path, name, ext, body
            FROM docs
            WHERE body LIKE ?1 ESCAPE '\\'
            LIMIT ?2
            ",
        ) {
            if let Ok(rows) = stmt.query_map(params![like.clone(), cap as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            }) {
                for row in rows.flatten() {
                    if hits.iter().any(|hit| hit.path.eq_ignore_ascii_case(&row.0)) {
                        continue;
                    }
                    hits.push(rank_hit(needle, row.0, row.1, row.2, row.3));
                }
            }
        }
    }
    hits.sort_by(|left, right| right.score.cmp(&left.score).then_with(|| left.name.cmp(&right.name)));
    hits.truncate(cap);
    Ok(hits)
}

fn rank_hit(query: &str, path: String, name: String, ext: String, snippet: String) -> DocHit {
    let query_key = query.to_lowercase();
    let name_key = name.to_lowercase();
    let score = if name_key == query_key {
        100
    } else if name_key.contains(&query_key) {
        80
    } else if snippet.to_lowercase().contains(&query_key) {
        60
    } else {
        40
    };
    let snippet = snippet_window(&snippet, query);
    DocHit {
        path,
        name,
        ext,
        snippet,
        score,
    }
}

fn snippet_window(snippet: &str, query: &str) -> String {
    let clean: String = snippet.chars().filter(|ch| *ch != '\u{0}').collect();
    let trimmed = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_lowercase();
    let query_key = query.to_lowercase();
    let start = lower.find(&query_key).unwrap_or(0);
    let from = start.saturating_sub(24);
    let mut window: String = trimmed.chars().skip(from).take(90).collect();
    if from > 0 {
        window.insert_str(0, "…");
    }
    if trimmed.chars().count() > from + 90 {
        window.push('…');
    }
    window
}

fn fts_query(query: &str) -> String {
    let cleaned: String = query.chars().filter(|ch| !ch.is_control()).take(80).collect();
    format!("\"{}\"", cleaned.replace('"', "\"\""))
}

fn like_pattern(query: &str) -> String {
    let mut out = String::from("%");
    for ch in query.chars().take(80) {
        if ch == '%' || ch == '_' || ch == '\\' {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('%');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_finds_body_and_delete_removes_it() {
        let dir = std::env::temp_dir().join(format!("edul-doc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("예산메모.txt");
        fs::write(&file, "집행 전에 품의를 확인합니다.").unwrap();
        let db = dir.join("search.db");
        let conn = open_db(&db).unwrap();
        conn.execute(
            "INSERT INTO folders(path, added_at) VALUES (?1, ?2)",
            params![dir.to_string_lossy().to_string(), 1],
        )
        .unwrap();
        index_one(&conn, &file).unwrap();
        let quoted = fts_query("품의를");
        let found: String = conn
            .query_row(
                "SELECT name FROM docs_fts WHERE docs_fts MATCH ?1",
                params![quoted],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(found, "예산메모.txt");
        fs::remove_file(&file).unwrap();
        let folders = folder_list(&conn);
        let seen = HashSet::new();
        purge_unseen(&conn, &folders, &seen).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM docs", [], |row| row.get(0)).unwrap();
        assert_eq!(left, 0);
        let _ = fs::remove_dir_all(dir);
    }
}
