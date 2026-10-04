pub(crate) mod extract;
mod tokens;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::index_key::{self, IndexKey, OpenedKey};
use crate::org_policy;
use extract::{extract_file, ExtractNote};
use tokens::{contains_query, hashed_tokens, match_expr, snippet_around};

const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILES: usize = 20_000;
const MAX_DEPTH: u32 = 8;
const REREAD_CAP: usize = 40;
const REREAD_BUDGET: Duration = Duration::from_millis(1500);

struct Gate {
    running: AtomicBool,
    stop: AtomicBool,
    migrating: AtomicBool,
    status: Mutex<DocStatus>,
}

fn gate() -> &'static Gate {
    static GATE: OnceLock<Gate> = OnceLock::new();
    GATE.get_or_init(|| Gate {
        running: AtomicBool::new(false),
        stop: AtomicBool::new(false),
        migrating: AtomicBool::new(false),
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
    pub cloud_skipped: u32,
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
            cloud_skipped: 0,
            current: String::new(),
            message: String::new(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocFolder {
    pub path: String,
    pub id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocHit {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub snippet: String,
    pub note: String,
    pub score: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocCard {
    pub name: String,
    pub ext: String,
    pub snippet: String,
    pub note: String,
    pub score: i32,
    pub place: String,
    pub launch_id: String,
    pub folder_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocQuery {
    pub hits: Vec<DocCard>,
    pub hint: String,
    pub batch: String,
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
            indexed_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|_| "검색 기록을 준비하지 못했습니다.".to_string())?;
    if has_body_column(&conn) {
        return Ok(conn);
    }
    let fts = conn.execute_batch(
        "
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
            tokens,
            content='',
            contentless_delete=1,
            detail=none,
            tokenize='unicode61'
        );
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

fn has_body_column(conn: &Connection) -> bool {
    let Ok(mut stmt) = conn.prepare("SELECT COUNT(*) FROM pragma_table_info('docs') WHERE name = 'body'") else {
        return false;
    };
    stmt.query_row([], |row| row.get::<_, i64>(0)).unwrap_or(0) > 0
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

fn main_search(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("이 창에서는 바꿀 수 없습니다.".into())
    }
}

fn remember_index_folder(app: &AppHandle, path: &str) -> Result<String, String> {
    let book = app.state::<crate::path_grant::GrantBook>();
    let name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("폴더");
    let id = book
        .issue(
            crate::path_grant::GrantUse::Index,
            Path::new(path),
            name,
            "dir",
            crate::path_grant::GrantOrigin::Index,
        )
        .map_err(|_| "폴더 목록을 읽지 못했습니다.".to_string())?;
    Ok(crate::path_grant::id_text(id))
}

#[tauri::command]
pub fn doc_search_folders(app: AppHandle, window: WebviewWindow) -> Result<Vec<DocFolder>, String> {
    main_search(&window)?;
    let conn = open_db(&db_path(&app)?)?;
    let mut stmt = conn
        .prepare("SELECT path FROM folders ORDER BY added_at")
        .map_err(|_| "폴더 목록을 읽지 못했습니다.".to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| "폴더 목록을 읽지 못했습니다.".to_string())?;
    let book = app.state::<crate::path_grant::GrantBook>();
    book.forget_use(crate::path_grant::GrantUse::Index);
    let mut folders = Vec::new();
    for row in rows {
        let Ok(path) = row else {
            continue;
        };
        let id = remember_index_folder(&app, &path)?;
        folders.push(DocFolder { path, id });
    }
    Ok(folders)
}

fn store_index_folder(app: &AppHandle, folder: &Path) -> Result<(), String> {
    if !folder.is_dir() {
        return Err("폴더만 넣을 수 있습니다.".to_string());
    }
    if drive_root(folder) {
        return Err("드라이브 전체는 고르지 않습니다. 그 안의 폴더를 고르세요.".to_string());
    }
    if blocked_place(folder) {
        return Err("Windows와 Program Files 폴더는 색인하지 않습니다.".to_string());
    }
    let stored = folder.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
    let conn = open_db(&db_path(app)?)?;
    conn.execute(
        "INSERT OR IGNORE INTO folders(path, added_at) VALUES (?1, ?2)",
        params![stored, now_secs()],
    )
    .map_err(|_| "폴더를 넣지 못했습니다.".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn doc_search_add_folder(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    main_search(&window)?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.dialog()
        .file()
        .set_parent(&window)
        .set_title("색인 폴더")
        .pick_folder(move |picked| {
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
    store_index_folder(&app, &path)
}

#[tauri::command]
pub fn doc_search_remove_folder(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    main_search(&window)?;
    let book = app.state::<crate::path_grant::GrantBook>();
    let path = crate::path_grant::view_index(&book, &id).map_err(|_| "폴더를 빼지 못했습니다.".to_string())?;
    let stored = path.to_string_lossy().trim_end_matches(['\\', '/']).to_string();
    let conn = open_db(&db_path(&app)?)?;
    conn.execute("DELETE FROM folders WHERE path = ?1 COLLATE NOCASE", params![stored])
        .map_err(|_| "폴더를 빼지 못했습니다.".to_string())?;
    purge_under(&conn, &stored)?;
    crate::path_grant::spend(&book, &id);
    Ok(())
}

#[tauri::command]
pub fn doc_search_clear(app: AppHandle) -> Result<(), String> {
    if org_policy::document_index_blocked() {
        return Err("관리자가 설정함".to_string());
    }
    let conn = open_db(&db_path(&app)?)?;
    if has_body_column(&conn) {
        conn.execute("DELETE FROM docs", [])
            .map_err(|_| "색인을 지우지 못했습니다.".to_string())?;
        return Ok(());
    }
    clear_rows(&conn);
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
    if org_policy::document_index_blocked() {
        return Err("관리자가 설정함".to_string());
    }
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
        cloud_skipped: 0,
        current: String::new(),
        message: "색인을 시작합니다.".to_string(),
    });
    let dir = app.path().app_data_dir().map_err(|_| "색인 키를 준비하지 못했습니다.".to_string())?;
    thread::spawn(move || {
        let outcome = run_index(&path, &dir);
        let stopped = gate().stop.load(Ordering::Relaxed);
        gate().running.store(false, Ordering::Relaxed);
        let mut message = if stopped {
            "색인을 멈췄습니다.".to_string()
        } else if outcome.failed > 0 {
            format!("색인이 끝났습니다. 읽지 못한 파일 {}개.", outcome.failed)
        } else {
            "색인이 끝났습니다.".to_string()
        };
        if outcome.cloud_skipped > 0 {
            message.push_str(&format!(
                " 이 PC에 내려받지 않은 클라우드 파일 {}개는 색인하지 않았습니다.",
                outcome.cloud_skipped
            ));
        }
        set_status(DocStatus {
            running: false,
            indexed: outcome.indexed,
            skipped: outcome.skipped,
            failed: outcome.failed,
            cloud_skipped: outcome.cloud_skipped,
            current: String::new(),
            message,
        });
    });
    Ok(())
}

struct Tally {
    indexed: u32,
    skipped: u32,
    failed: u32,
    cloud_skipped: u32,
}

struct ListedFile {
    path: PathBuf,
    size: u64,
    modified: i64,
}

struct LiveFile {
    size: u64,
    modified: i64,
    cloud: bool,
    missing: bool,
}

fn run_index(db_file: &Path, key_dir: &Path) -> Tally {
    let mut tally = Tally {
        indexed: 0,
        skipped: 0,
        failed: 0,
        cloud_skipped: 0,
    };
    if org_policy::document_index_blocked() {
        return tally;
    }
    let Ok(conn) = open_db(db_file) else {
        patch_status(|status| status.message = "검색 기록을 열지 못했습니다.".to_string());
        return tally;
    };
    if has_body_column(&conn) {
        patch_status(|status| status.message = "색인을 새 방식으로 바꾸는 중입니다".to_string());
        return tally;
    }
    let key = match index_key::open_dir(key_dir) {
        Ok(OpenedKey::Same(key)) => key,
        Ok(OpenedKey::Rebuilt(key)) => {
            clear_rows(&conn);
            key
        }
        Err(_) => {
            patch_status(|status| status.message = "색인 키를 준비하지 못했습니다.".to_string());
            return tally;
        }
    };
    let folders = folder_list(&conn);
    if purge_outside(&conn, &folders).is_err() {
        tally.failed += 1;
    }
    let mut seen = HashSet::new();
    for folder in &folders {
        if gate().stop.load(Ordering::Relaxed) {
            break;
        }
        let (found, cloud) = list_folder(Path::new(folder));
        tally.cloud_skipped = tally.cloud_skipped.saturating_add(cloud);
        for file in found {
            if gate().stop.load(Ordering::Relaxed) {
                break;
            }
            let key_path = file.path.to_string_lossy().to_lowercase();
            seen.insert(key_path);
            let name = file
                .path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();
            patch_status(|status| {
                status.current = name;
                status.message = "색인 중...".to_string();
            });
            match index_one(&conn, &key, &file) {
                Ok(IndexOne::Wrote) => tally.indexed += 1,
                Ok(IndexOne::Unchanged) => tally.skipped += 1,
                Err(ExtractNote::Skip(_)) => tally.skipped += 1,
                Err(ExtractNote::Fail(_)) => tally.failed += 1,
            }
            patch_status(|status| {
                status.indexed = tally.indexed;
                status.skipped = tally.skipped;
                status.failed = tally.failed;
                status.cloud_skipped = tally.cloud_skipped;
            });
        }
    }
    if !gate().stop.load(Ordering::Relaxed) && purge_unseen(&conn, &folders, &seen).is_err() {
        tally.failed += 1;
    }
    tally
}


enum IndexOne {
    Wrote,
    Unchanged,
}

fn index_one(conn: &Connection, key: &IndexKey, file: &ListedFile) -> Result<IndexOne, ExtractNote> {
    if file.size > MAX_FILE_BYTES {
        return Err(ExtractNote::Skip("파일이 너무 큽니다.".to_string()));
    }
    let modified = file.modified;
    let size = file.size as i64;
    let stored = file.path.to_string_lossy().to_string();
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
    if cloud_file(&file.path) {
        return Err(ExtractNote::Skip("클라우드 파일입니다.".to_string()));
    }
    let body = extract_file(&file.path)?;
    let hash = index_key::mac_hex(key.bytes(), &body).ok_or_else(|| ExtractNote::Fail("검색 기록에 넣지 못했습니다.".to_string()))?;
    let name = file
        .path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| stored.clone());
    let ext = file
        .path
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
    forget_row(conn, &stored);
    conn.execute(
        "
        INSERT INTO docs(path, name, ext, modified, size, hash, indexed_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            ext = excluded.ext,
            modified = excluded.modified,
            size = excluded.size,
            hash = excluded.hash,
            indexed_at = excluded.indexed_at
        ",
        params![stored, name, ext, modified, size, hash, now_secs()],
    )
    .map_err(|_| ExtractNote::Fail("검색 기록에 넣지 못했습니다.".to_string()))?;
    let rowid: i64 = conn
        .query_row("SELECT rowid FROM docs WHERE path = ?1", params![stored], |row| row.get(0))
        .map_err(|_| ExtractNote::Fail("검색 기록에 넣지 못했습니다.".to_string()))?;
    let tokens = hashed_tokens(key.bytes(), &body).join(" ");
    if !tokens.is_empty() {
        conn.execute(
            "INSERT INTO docs_fts(rowid, tokens) VALUES (?1, ?2)",
            params![rowid, tokens],
        )
        .map_err(|_| ExtractNote::Fail("검색 기록에 넣지 못했습니다.".to_string()))?;
    }
    Ok(IndexOne::Wrote)
}

fn forget_row(conn: &Connection, path: &str) {
    let rowid: Option<i64> = conn
        .query_row("SELECT rowid FROM docs WHERE path = ?1", params![path], |row| row.get(0))
        .ok();
    if let Some(rowid) = rowid {
        let _ = conn.execute("INSERT INTO docs_fts(docs_fts, rowid) VALUES ('delete', ?1)", params![rowid]);
    }
}

fn clear_rows(conn: &Connection) {
    let paths: Vec<String> = folder_paths(conn, "SELECT path FROM docs");
    for path in paths {
        forget_row(conn, &path);
        let _ = conn.execute("DELETE FROM docs WHERE path = ?1", params![path]);
    }
}

fn folder_paths(conn: &Connection, sql: &str) -> Vec<String> {
    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };
    stmt.query_map([], |row| row.get::<_, String>(0))
        .ok()
        .map(|rows| rows.filter_map(|row| row.ok()).collect())
        .unwrap_or_default()
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
        forget_row(conn, &path);
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
        forget_row(conn, &path);
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
        forget_row(conn, &path);
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

fn list_folder(dir: &Path) -> (Vec<ListedFile>, u32) {
    #[cfg(windows)]
    {
        return list_folder_win(dir);
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        (Vec::new(), 0)
    }
}

#[cfg(windows)]
fn list_folder_win(root: &Path) -> (Vec<ListedFile>, u32) {
    use std::os::windows::ffi::OsStrExt;
    use crate::privacy_folder::{classify_dir, classify_file, plain_text, prefixed, FileKind};
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW, FIND_FIRST_EX_LARGE_FETCH,
        WIN32_FIND_DATAW,
    };
    let mut found = Vec::new();
    let mut cloud = 0u32;
    let mut stack = vec![(plain_text(root), 0u32)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_DEPTH || found.len() >= MAX_FILES || gate().stop.load(Ordering::Relaxed) {
            continue;
        }
        let pattern = format!("{dir}\\*");
        let wide: Vec<u16> = prefixed(&pattern).as_os_str().encode_wide().chain(std::iter::once(0)).collect();
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
        let Ok(handle) = handle else {
            continue;
        };
        loop {
            if found.len() >= MAX_FILES || gate().stop.load(Ordering::Relaxed) {
                break;
            }
            let name = wide_find_name(&data.cFileName);
            if name != "." && name != ".." && !name.is_empty() {
                let child = format!("{dir}\\{name}");
                let attrs = data.dwFileAttributes;
                let tag = if attrs & 1024 != 0 { data.dwReserved0 } else { 0 };
                if attrs & 16 != 0 {
                    if !skip_dir(&name) && enter_dir(classify_dir(attrs, tag, &name, false)) && depth < MAX_DEPTH {
                        stack.push((child, depth + 1));
                    }
                } else {
                    let size = ((data.nFileSizeHigh as u64) << 32) | data.nFileSizeLow as u64;
                    let ext = Path::new(&name)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let kind = classify_file(attrs, tag, size, &ext);
                    if kind == FileKind::CloudOnly {
                        cloud = cloud.saturating_add(1);
                    } else if doc_ext(&ext) && size <= MAX_FILE_BYTES && kind != FileKind::Link && kind != FileKind::HiddenSystem {
                        let ticks = ((data.ftLastWriteTime.dwHighDateTime as u64) << 32) | data.ftLastWriteTime.dwLowDateTime as u64;
                        let modified = if ticks > 11_644_473_600_000_0000 {
                            ((ticks - 11_644_473_600_000_0000) / 10_000_000) as i64
                        } else {
                            0
                        };
                        found.push(ListedFile {
                            path: PathBuf::from(child),
                            size,
                            modified,
                        });
                    }
                }
            }
            data = WIN32_FIND_DATAW::default();
            if unsafe { FindNextFileW(handle, &mut data) }.is_err() {
                break;
            }
        }
        let _ = unsafe { FindClose(handle) };
    }
    (found, cloud)
}

fn wide_find_name(raw: &[u16]) -> String {
    let end = raw.iter().position(|ch| *ch == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..end])
}

fn doc_ext(ext: &str) -> bool {
    matches!(ext, "hwpx" | "hwp" | "xlsx" | "docx" | "pdf" | "txt" | "md" | "csv")
}

fn cloud_bits(attrs: u32) -> bool {
    const OFFLINE: u32 = 4096;
    const RECALL_OPEN: u32 = 262144;
    const RECALL_DATA: u32 = 4194304;
    attrs & (OFFLINE | RECALL_OPEN | RECALL_DATA) != 0
}

fn enter_dir(kind: crate::privacy_folder::DirKind) -> bool {
    matches!(kind, crate::privacy_folder::DirKind::Enter)
}

fn cloud_file(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::GetFileAttributesW;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let attrs = unsafe { GetFileAttributesW(PCWSTR(wide.as_ptr())) };
        if attrs == u32::MAX {
            return false;
        }
        return cloud_bits(attrs);
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

fn publish_doc_hits(app: &AppHandle, hits: Vec<DocHit>, hint: String) -> DocQuery {
    let book = app.state::<crate::path_grant::GrantBook>();
    let batch = book.begin_batch(crate::path_grant::GrantOrigin::SearchDoc);
    let mut cards = Vec::new();
    let mut folders: Vec<(std::path::PathBuf, String)> = Vec::new();
    for hit in hits {
        let path = std::path::PathBuf::from(&hit.path);
        let launch_id = crate::path_grant::remember_launch(
            &book,
            crate::path_grant::GrantOrigin::SearchDoc,
            batch,
            &path,
            "file",
        )
        .unwrap_or_default();
        let parent = path.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
        let folder_id = if parent.as_os_str().is_empty() {
            String::new()
        } else if let Some((_, id)) = folders.iter().find(|(dir, _)| dir == &parent) {
            id.clone()
        } else {
            let id = crate::path_grant::remember_launch(
                &book,
                crate::path_grant::GrantOrigin::SearchDoc,
                batch,
                &parent,
                "place",
            )
            .unwrap_or_default();
            folders.push((parent, id.clone()));
            id
        };
        cards.push(DocCard {
            name: hit.name,
            ext: hit.ext,
            snippet: hit.snippet,
            note: hit.note,
            score: hit.score,
            place: crate::path_grant::place_label(&path),
            launch_id,
            folder_id,
        });
    }
    DocQuery {
        hits: cards,
        hint,
        batch: batch.to_string(),
    }
}

#[tauri::command]
pub fn doc_search_query(app: AppHandle, window: WebviewWindow, query: String, limit: u32) -> Result<DocQuery, String> {
    if window.label() != "main" {
        return Err("이 창에서는 실행할 수 없습니다.".into());
    }
    let needle = query.trim();
    if needle.is_empty() {
        return Ok(publish_doc_hits(&app, Vec::new(), String::new()));
    }
    if org_policy::document_index_blocked() {
        return Ok(publish_doc_hits(&app, Vec::new(), String::new()));
    }
    let cap = limit.clamp(1, 40) as usize;
    let db = db_path(&app)?;
    let conn = open_db(&db)?;
    let chars = needle.chars().count();
    let mut hint = if chars < 3 {
        "본문은 세 글자 이상으로 검색할 수 있습니다.".to_string()
    } else {
        String::new()
    };
    let mut hits = name_hits(&conn, needle, cap);
    let body_ok = chars >= 3 && !gate().migrating.load(Ordering::Relaxed) && !has_body_column(&conn);
    if body_ok {
        let dir = app.path().app_data_dir().map_err(|_| "색인 키를 준비하지 못했습니다.".to_string())?;
        if let Some(key) = index_key::read_dir(&dir) {
            let (extra, partial, _) = body_hits(&conn, &key, needle, cap);
            if partial {
                hint = "결과가 많아 일부만 확인했습니다.".to_string();
            }
            for hit in extra {
                if let Some(slot) = hits.iter_mut().find(|item| item.path.eq_ignore_ascii_case(&hit.path)) {
                    if slot.snippet.is_empty() && slot.note.is_empty() {
                        *slot = hit;
                    }
                } else {
                    hits.push(hit);
                }
            }
        }
    }
    hits.sort_by(|left, right| right.score.cmp(&left.score).then_with(|| left.name.cmp(&right.name)));
    hits.truncate(cap);
    Ok(publish_doc_hits(&app, hits, hint))
}

fn name_hits(conn: &Connection, needle: &str, cap: usize) -> Vec<DocHit> {
    let like = like_pattern(needle);
    let mut hits = Vec::new();
    let Ok(mut stmt) = conn.prepare(
        "SELECT path, name, ext FROM docs WHERE name LIKE ?1 ESCAPE '\\' LIMIT ?2",
    ) else {
        return hits;
    };
    let Ok(rows) = stmt.query_map(params![like, cap as i64], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    }) else {
        return hits;
    };
    for row in rows.flatten() {
        hits.push(score_hit(needle, row.0, row.1, row.2, String::new(), String::new()));
    }
    hits
}

fn body_hits(conn: &Connection, key: &IndexKey, needle: &str, cap: usize) -> (Vec<DocHit>, bool, usize) {
    let Some(expr) = match_expr(key.bytes(), needle) else {
        return (Vec::new(), false, 0);
    };
    let Ok(mut stmt) = conn.prepare(
        "
        SELECT d.path, d.name, d.ext, d.modified, d.size
        FROM docs_fts
        JOIN docs d ON d.rowid = docs_fts.rowid
        WHERE docs_fts MATCH ?1
        LIMIT 400
        ",
    ) else {
        return (Vec::new(), false, 0);
    };
    let Ok(rows) = stmt.query_map(params![expr], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    }) else {
        return (Vec::new(), false, 0);
    };
    let started = Instant::now();
    let mut hits = Vec::new();
    let mut checked = 0usize;
    let mut partial = false;
    for row in rows.flatten() {
        if hits.len() >= cap {
            partial = true;
            break;
        }
        if checked >= REREAD_CAP || started.elapsed() >= REREAD_BUDGET {
            partial = true;
            break;
        }
        checked += 1;
        let path = PathBuf::from(&row.0);
        let live = live_file(&path);
        if live.missing || live.cloud || live.size != row.4 as u64 || live.modified != row.3 {
            let note = if live.cloud {
                "이 PC에 내려받지 않은 파일이라 내용을 확인하지 못했습니다".to_string()
            } else {
                "파일이 바뀌어 내용을 확인하지 못했습니다".to_string()
            };
            hits.push(score_hit(needle, row.0, row.1, row.2, String::new(), note));
            continue;
        }
        let Ok(body) = extract_file(&path) else {
            hits.push(score_hit(
                needle,
                row.0,
                row.1,
                row.2,
                String::new(),
                "파일이 바뀌어 내용을 확인하지 못했습니다".to_string(),
            ));
            continue;
        };
        if !contains_query(&body, needle) {
            continue;
        }
        hits.push(score_hit(needle, row.0, row.1, row.2, snippet_around(&body, needle), String::new()));
    }
    (hits, partial, checked)
}

fn live_file(path: &Path) -> LiveFile {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{GetFileAttributesExW, GetFileExInfoStandard, WIN32_FILE_ATTRIBUTE_DATA};
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut data = WIN32_FILE_ATTRIBUTE_DATA::default();
        let ok = unsafe { GetFileAttributesExW(PCWSTR(wide.as_ptr()), GetFileExInfoStandard, &mut data as *mut _ as *mut core::ffi::c_void) };
        if ok.is_err() {
            return LiveFile { size: 0, modified: 0, cloud: false, missing: true };
        }
        let cloud = cloud_bits(data.dwFileAttributes);
        let size = ((data.nFileSizeHigh as u64) << 32) | data.nFileSizeLow as u64;
        let ticks = ((data.ftLastWriteTime.dwHighDateTime as u64) << 32) | data.ftLastWriteTime.dwLowDateTime as u64;
        let modified = if ticks > 11_644_473_600_000_0000 {
            ((ticks - 11_644_473_600_000_0000) / 10_000_000) as i64
        } else {
            0
        };
        return LiveFile { size, modified, cloud, missing: false };
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        LiveFile { size: 0, modified: 0, cloud: false, missing: true }
    }
}

fn score_hit(query: &str, path: String, name: String, ext: String, snippet: String, note: String) -> DocHit {
    let query_key = query.to_lowercase();
    let name_key = name.to_lowercase();
    let score = if name_key == query_key {
        100
    } else if name_key.contains(&query_key) {
        80
    } else if !snippet.is_empty() {
        60
    } else {
        40
    };
    DocHit { path, name, ext, snippet, score, note }
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

pub fn boot(app: &AppHandle) {
    if org_policy::document_index_blocked() {
        return;
    }
    let Ok(db) = db_path(app) else {
        return;
    };
    if !db.is_file() {
        return;
    }
    let Ok(conn) = Connection::open(&db) else {
        return;
    };
    if !has_body_column(&conn) {
        return;
    }
    let folders = folder_list(&conn);
    drop(conn);
    if gate().migrating.swap(true, Ordering::Relaxed) {
        return;
    }
    set_status(DocStatus {
        running: true,
        indexed: 0,
        skipped: 0,
        failed: 0,
        cloud_skipped: 0,
        current: String::new(),
        message: "색인을 새 방식으로 바꾸는 중입니다".to_string(),
    });
    let Ok(dir) = app.path().app_data_dir() else {
        gate().migrating.store(false, Ordering::Relaxed);
        return;
    };
    thread::spawn(move || {
        if !replace_legacy(&db, &folders) {
            let _ = vacuum_legacy(&db, &folders);
        }
        gate().migrating.store(false, Ordering::Relaxed);
        if org_policy::document_index_blocked() {
            set_status(DocStatus::idle());
            return;
        }
        let outcome = run_index(&db, &dir);
        set_status(DocStatus {
            running: false,
            indexed: outcome.indexed,
            skipped: outcome.skipped,
            failed: outcome.failed,
            cloud_skipped: outcome.cloud_skipped,
            current: String::new(),
            message: "색인이 끝났습니다.".to_string(),
        });
    });
}

fn side_path(db: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{suffix}", db.display()))
}

fn replace_legacy(db: &Path, folders: &[String]) -> bool {
    if let Ok(conn) = Connection::open(db) {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        drop(conn);
    }
    if fs::remove_file(db).is_err() {
        return false;
    }
    let _ = fs::remove_file(side_path(db, "-wal"));
    let _ = fs::remove_file(side_path(db, "-shm"));
    let Ok(conn) = open_db(db) else {
        return false;
    };
    restore_folders(&conn, folders);
    true
}

fn vacuum_legacy(db: &Path, folders: &[String]) -> bool {
    let Ok(conn) = Connection::open(db) else {
        return false;
    };
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA secure_delete=ON;");
    let triggers = folder_paths(&conn, "SELECT name FROM sqlite_master WHERE type = 'trigger'");
    for name in triggers {
        if name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
            let _ = conn.execute_batch(&format!("DROP TRIGGER IF EXISTS {name}"));
        }
    }
    let dropped = conn.execute_batch(
        "
        DROP TABLE IF EXISTS docs_fts;
        DROP TABLE IF EXISTS docs;
        DROP TABLE IF EXISTS folders;
        VACUUM;
        ",
    );
    drop(conn);
    if dropped.is_err() {
        return false;
    }
    let Ok(conn) = open_db(db) else {
        return false;
    };
    restore_folders(&conn, folders);
    true
}

fn restore_folders(conn: &Connection, folders: &[String]) {
    for folder in folders {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO folders(path, added_at) VALUES (?1, ?2)",
            params![folder, now_secs()],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FlagsOff;
    impl Drop for FlagsOff {
        fn drop(&mut self) {
            org_policy::set_test_flags(None);
        }
    }

    fn scratch(name: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("edul-doc-{name}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn listed(path: &Path) -> ListedFile {
        let live = live_file(path);
        ListedFile {
            path: path.to_path_buf(),
            size: live.size,
            modified: live.modified,
        }
    }

    fn contains_text(path: &Path, needle: &str) -> bool {
        let bytes = fs::read(path).unwrap_or_default();
        let raw = needle.as_bytes();
        !raw.is_empty() && bytes.windows(raw.len()).any(|window| window == raw)
    }

    fn index_sample(dir: &Path, db: &Path, key_dir: &Path, name: &str, body: &str) -> IndexKey {
        let file = dir.join(name);
        fs::write(&file, body).unwrap();
        let conn = open_db(db).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO folders(path, added_at) VALUES (?1, 1)",
            params![dir.to_string_lossy().to_string()],
        )
        .unwrap();
        let opened = index_key::open_dir(key_dir).unwrap();
        let key = match opened {
            OpenedKey::Same(key) | OpenedKey::Rebuilt(key) => key,
        };
        index_one(&conn, &key, &listed(&file)).unwrap();
        key
    }

    #[test]
    fn hashed_index_hides_sentence_and_name() {
        let dir = scratch("plain");
        let db = dir.join("doc-search.db");
        let keys = dir.join("keys");
        let sentence = "내일은 맑다고 적힌 가짜문장입니다";
        let key = index_sample(&dir, &db, &keys, "memo-a.txt", &format!("담당자는 홍길동. {sentence}"));
        drop(key);
        let conn = open_db(&db).unwrap();
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(FULL);");
        drop(conn);
        for path in [db.clone(), side_path(&db, "-wal"), side_path(&db, "-shm")] {
            if path.is_file() {
                assert!(!contains_text(&path, "홍길동"), "{}", path.display());
                assert!(!contains_text(&path, sentence), "{}", path.display());
                assert!(!contains_text(&path, "맑다고"), "{}", path.display());
            }
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn other_key_finds_nothing() {
        let dir = scratch("other");
        let db = dir.join("doc-search.db");
        let key = index_sample(&dir, &db, &dir.join("keys"), "memo-a.txt", "담당자는 홍길동.");
        let other = match index_key::open_dir(&dir.join("other-keys")).unwrap() {
            OpenedKey::Same(key) | OpenedKey::Rebuilt(key) => key,
        };
        let conn = open_db(&db).unwrap();
        let expr = match_expr(other.bytes(), "홍길동").unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM docs_fts WHERE docs_fts MATCH ?1", params![expr], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        let own = match_expr(key.bytes(), "홍길동").unwrap();
        let own_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM docs_fts WHERE docs_fts MATCH ?1", params![own], |row| row.get(0))
            .unwrap();
        assert_eq!(own_count, 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn reread_drops_false_name_hit() {
        let dir = scratch("reread");
        let db = dir.join("doc-search.db");
        let key = index_sample(&dir, &db, &dir.join("keys"), "memo-a.txt", "담당자는 홍길동.");
        fs::write(dir.join("memo-b.txt"), "이 파일에는 다른 이야기만 있습니다.").unwrap();
        let conn = open_db(&db).unwrap();
        index_one(&conn, &key, &listed(&dir.join("memo-b.txt"))).unwrap();
        let rowid: i64 = conn
            .query_row("SELECT rowid FROM docs WHERE name = 'memo-b.txt'", [], |row| row.get(0))
            .unwrap();
        let tokens = hashed_tokens(key.bytes(), "홍길동").join(" ");
        conn.execute("INSERT INTO docs_fts(rowid, tokens) VALUES (?1, ?2)", params![rowid, tokens])
            .unwrap();
        let (hits, _, checked) = body_hits(&conn, &key, "홍길동", 10);
        assert!(checked >= 1);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].path.ends_with("memo-a.txt"));
        assert!(hits[0].snippet.contains("홍길동"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn short_query_is_name_only() {
        let dir = scratch("short");
        let db = dir.join("doc-search.db");
        let key = index_sample(&dir, &db, &dir.join("keys"), "zzzz.txt", "본문에는 홍길동만 있습니다.");
        let conn = open_db(&db).unwrap();
        let names = name_hits(&conn, "zz", 10);
        assert_eq!(names.len(), 1);
        assert!(match_expr(key.bytes(), "zz").is_none());
        assert!(match_expr(key.bytes(), "홍").is_none());
        let body = name_hits(&conn, "홍", 10);
        assert!(body.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn damaged_key_rebuilds_index() {
        let dir = scratch("damage");
        let db = dir.join("doc-search.db");
        let keys = dir.join("keys");
        let _ = index_sample(&dir, &db, &keys, "memo-a.txt", "담당자는 홍길동.");
        fs::write(keys.join("doc-index.key"), b"damaged").unwrap();
        let tally = run_index(&db, &keys);
        assert!(tally.indexed >= 1);
        let key = index_key::read_dir(&keys).unwrap();
        let conn = open_db(&db).unwrap();
        let (hits, _, _) = body_hits(&conn, &key, "홍길동", 10);
        assert_eq!(hits.len(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn legacy_body_is_replaced_and_folders_stay() {
        let dir = scratch("legacy");
        let db = dir.join("doc-search.db");
        let secret = "옛본문비밀문장";
        let folder = dir.to_string_lossy().to_string();
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "
            CREATE TABLE folders(path TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
            CREATE TABLE docs(
                path TEXT PRIMARY KEY, name TEXT NOT NULL, ext TEXT NOT NULL,
                modified INTEGER NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL,
                body TEXT NOT NULL, indexed_at INTEGER NOT NULL
            );
            ",
        )
        .unwrap();
        conn.execute("INSERT INTO folders(path, added_at) VALUES (?1, 1)", params![folder])
            .unwrap();
        conn.execute(
            "INSERT INTO docs(path, name, ext, modified, size, hash, body, indexed_at) VALUES ('a','a.txt','txt',1,1,'h',?1,1)",
            params![secret],
        )
        .unwrap();
        drop(conn);
        assert!(contains_text(&db, secret));
        let folders = vec![folder];
        assert!(replace_legacy(&db, &folders));
        let conn = open_db(&db).unwrap();
        assert!(!has_body_column(&conn));
        let kept: String = conn.query_row("SELECT path FROM folders", [], |row| row.get(0)).unwrap();
        assert_eq!(kept, folders[0]);
        drop(conn);
        assert!(!contains_text(&db, secret));
        let wal = side_path(&db, "-wal");
        if wal.is_file() {
            assert!(!contains_text(&wal, secret));
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn policy_blocks_index_and_file_read() {
        let _guard = FlagsOff;
        let dir = scratch("policy");
        let db = dir.join("doc-search.db");
        let file = dir.join("memo-a.txt");
        fs::write(&file, "담당자는 홍길동.").unwrap();
        let conn = open_db(&db).unwrap();
        conn.execute(
            "INSERT INTO folders(path, added_at) VALUES (?1, 1)",
            params![dir.to_string_lossy().to_string()],
        )
        .unwrap();
        drop(conn);
        org_policy::set_test_flags(Some(org_policy::OrgFlags {
            disable_admin_tools: false,
            disable_document_index: true,
            disable_startup_update: false,
            disable_startup_knowledge: false,
        }));
        let tally = run_index(&db, &dir.join("keys"));
        assert_eq!(tally.indexed, 0);
        let conn = open_db(&db).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM docs", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
        assert!(index_key::read_dir(&dir.join("keys")).is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cloud_and_link_dirs_are_not_entered() {
        use crate::privacy_folder::{classify_dir, DirKind};
        assert!(cloud_bits(4096));
        assert!(cloud_bits(262144));
        assert!(cloud_bits(4194304));
        assert!(!cloud_bits(0));
        assert!(!enter_dir(DirKind::Link));
        assert!(!enter_dir(DirKind::OtherLink));
        assert!(!enter_dir(DirKind::System));
        assert!(enter_dir(DirKind::Enter));
        assert!(!enter_dir(classify_dir(1024, 0xA0000003, "joined", false)));
    }

    #[test]
    fn thousand_docs_index_and_search() {
        let dir = scratch("thousand");
        let db = dir.join("doc-search.db");
        let keys = dir.join("keys");
        for index in 0..1000 {
            let name = format!("note-{index}.txt");
            let body = if index == 777 {
                "담당자는 홍길동. 내일은 맑다고 적힌 가짜문장입니다".to_string()
            } else {
                format!("일반 메모 {index} 번")
            };
            fs::write(dir.join(name), body).unwrap();
        }
        let conn = open_db(&db).unwrap();
        conn.execute(
            "INSERT INTO folders(path, added_at) VALUES (?1, 1)",
            params![dir.to_string_lossy().to_string()],
        )
        .unwrap();
        drop(conn);
        let started = Instant::now();
        let tally = run_index(&db, &keys);
        let index_ms = started.elapsed().as_millis();
        assert!(tally.indexed >= 1000);
        let key = index_key::read_dir(&keys).unwrap();
        let conn = open_db(&db).unwrap();
        let started = Instant::now();
        let (hits, _, checked) = body_hits(&conn, &key, "홍길동", 10);
        let search_ms = started.elapsed().as_millis();
        eprintln!("index_ms={index_ms} search_ms={search_ms} reread={checked}");
        assert_eq!(hits.len(), 1);
        assert!(hits[0].name == "note-777.txt");
        assert!(checked < 40);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn changed_file_keeps_the_name_without_a_snippet() {
        let dir = scratch("changed");
        let db = dir.join("doc-search.db");
        let key = index_sample(&dir, &db, &dir.join("keys"), "memo-a.txt", "담당자는 홍길동.");
        let file = dir.join("memo-a.txt");
        let mut bytes = fs::read(&file).unwrap();
        bytes.push(b' ');
        fs::write(&file, bytes).unwrap();
        let conn = open_db(&db).unwrap();
        let (hits, _, _) = body_hits(&conn, &key, "홍길동", 10);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.is_empty());
        assert_eq!(hits[0].note, "파일이 바뀌어 내용을 확인하지 못했습니다");
        let _ = fs::remove_dir_all(dir);
    }
}
