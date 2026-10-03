use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

mod doc_shrink;
mod document_search;
mod netcheck;
mod fixed_https;
mod knowledge_sign;
mod printcheck;
mod pdf_pages;
mod admin_tools;
mod netutil;
mod shortcut;
mod privacy_mask;
#[allow(dead_code)]
mod privacy_scan;
mod privacy_folder;
mod file_desk;
mod url_mark;
mod user_folder;
use doc_shrink::{doc_picture_bytes, plan_doc_save, write_new_picture};
use document_search::{
    doc_search_add_folder, doc_search_clear, doc_search_folders, doc_search_halt, doc_search_query,
    doc_search_remove_folder, doc_search_start, doc_search_status,
};
use pdf_pages::{pdf_arrange, pdf_extract, pdf_glance, pdf_halt, pdf_merge};
use privacy_mask::{read_privacy_picture, write_privacy_picture};
use url_mark::{build_url_mark, read_picture_file, write_png_file};
#[cfg(windows)]
mod drop_target;
#[cfg(windows)]
mod shell_icon;
#[cfg(windows)]
mod favicon_db;

#[cfg(windows)]
#[link(name = "shell32")]
extern "system" {
    fn SHChangeNotify(event: i32, flags: u32, item1: *const std::ffi::c_void, item2: *const std::ffi::c_void);
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn run_reg(args: &[&str]) {
    let mut cmd = Command::new("reg");
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd.status();
}

struct PanelState {
    position: Mutex<String>,
}

struct StartupPacks(Mutex<Vec<String>>);

struct StartupUrls(Mutex<Vec<String>>);

struct RangeHalt(Arc<AtomicBool>);

struct FolderWalkHalt(Arc<AtomicBool>);

struct WorkMapFocus(Mutex<String>);

struct MemoDraft(Mutex<String>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardNote {
    id: String,
    text: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoBoardBody {
    text: String,
    notes: Vec<BoardNote>,
    selected: String,
}

struct MemoPages(Mutex<MemoBoardBody>);

struct NoteSlot {
    text: String,
    title: String,
}

struct NoteDrafts(Mutex<HashMap<String, NoteSlot>>);

const PANEL_DEFAULT_W: f64 = 520.0;
const PANEL_DEFAULT_H: f64 = 720.0;
const PANEL_MIN_W: f64 = 400.0;
const PANEL_MIN_H: f64 = 550.0;
const PANEL_MAX_W: f64 = 720.0;
const PANEL_MAX_H: f64 = 900.0;
const MEMO_MIN_W: f64 = 280.0;
const MEMO_MIN_H: f64 = 400.0;
const MEMO_MAX_W: f64 = 720.0;
const MEMO_MAX_H: f64 = 900.0;
const NOTE_MIN_W: f64 = 220.0;
const NOTE_MIN_H: f64 = 180.0;
const NOTE_MAX_W: f64 = 720.0;
const NOTE_MAX_H: f64 = 900.0;
fn clip_panel_size(width: f64, height: f64) -> (f64, f64) {
    (
        width.clamp(PANEL_MIN_W, PANEL_MAX_W),
        height.clamp(PANEL_MIN_H, PANEL_MAX_H),
    )
}

fn read_saved_panel_size(app: &AppHandle) -> (f64, f64) {
    use tauri_plugin_store::StoreExt;

    let Ok(store) = app.store("settings.json") else {
        return (PANEL_DEFAULT_W, PANEL_DEFAULT_H);
    };
    let value = store.get("value");
    let width = value
        .as_ref()
        .and_then(|entry| entry.get("panelWidth"))
        .and_then(|entry| entry.as_f64())
        .unwrap_or(PANEL_DEFAULT_W);
    let height = value
        .as_ref()
        .and_then(|entry| entry.get("panelHeight"))
        .and_then(|entry| entry.as_f64())
        .unwrap_or(PANEL_DEFAULT_H);
    clip_panel_size(width, height)
}

fn save_panel_size(app: &AppHandle, width: f64, height: f64) {
    use tauri_plugin_store::StoreExt;

    let (width, height) = clip_panel_size(width, height);
    let Ok(store) = app.store("settings.json") else {
        return;
    };
    let mut value = store
        .get("value")
        .and_then(|entry| entry.as_object().cloned())
        .unwrap_or_default();
    value.insert(
        "panelWidth".into(),
        serde_json::Value::from(width.round() as u32),
    );
    value.insert(
        "panelHeight".into(),
        serde_json::Value::from(height.round() as u32),
    );
    let _ = store.set("value", serde_json::Value::Object(value));
    let _ = store.save();
}

fn panel_logical_size(window: &tauri::WebviewWindow) -> (f64, f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let inner = window
        .inner_size()
        .unwrap_or(tauri::PhysicalSize::new(
            (PANEL_DEFAULT_W * scale).round() as u32,
            (PANEL_DEFAULT_H * scale).round() as u32,
        ));
    clip_panel_size(
        inner.width as f64 / scale,
        inner.height as f64 / scale,
    )
}

fn apply_panel_size(window: &tauri::WebviewWindow, width: f64, height: f64) {
    let (width, height) = clip_panel_size(width, height);
    let _ = window.set_size(Size::Logical(LogicalSize::new(width, height)));
}

fn persist_panel_size(app: &AppHandle, window: &tauri::WebviewWindow) {
    let (width, height) = panel_logical_size(window);
    save_panel_size(app, width, height);
}

fn clip_memo_size(width: f64, height: f64) -> (f64, f64) {
    (
        width.clamp(MEMO_MIN_W, MEMO_MAX_W),
        height.clamp(MEMO_MIN_H, MEMO_MAX_H),
    )
}

fn read_saved_memo_size(app: &AppHandle) -> Option<(f64, f64)> {
    use tauri_plugin_store::StoreExt;

    let Ok(store) = app.store("settings.json") else {
        return None;
    };
    let value = store.get("value")?;
    let width = value.get("memoWidth")?.as_f64()?;
    let height = value.get("memoHeight")?.as_f64()?;
    Some(clip_memo_size(width, height))
}

fn save_memo_size(app: &AppHandle, width: f64, height: f64) {
    use tauri_plugin_store::StoreExt;

    let (width, height) = clip_memo_size(width, height);
    let Ok(store) = app.store("settings.json") else {
        return;
    };
    let mut value = store
        .get("value")
        .and_then(|entry| entry.as_object().cloned())
        .unwrap_or_default();
    value.insert(
        "memoWidth".into(),
        serde_json::Value::from(width.round() as u32),
    );
    value.insert(
        "memoHeight".into(),
        serde_json::Value::from(height.round() as u32),
    );
    let _ = store.set("value", serde_json::Value::Object(value));
    let _ = store.save();
}

fn memo_logical_size(window: &tauri::WebviewWindow) -> (f64, f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let inner = window
        .inner_size()
        .unwrap_or(tauri::PhysicalSize::new(
            (MEMO_MIN_W * scale).round() as u32,
            (MEMO_MIN_H * scale).round() as u32,
        ));
    clip_memo_size(inner.width as f64 / scale, inner.height as f64 / scale)
}

fn persist_memo_size(app: &AppHandle, window: &tauri::WebviewWindow) {
    let (width, height) = memo_logical_size(window);
    save_memo_size(app, width, height);
}

fn clip_memo_text(raw: &str) -> String {
    raw.chars()
        .filter(|ch| *ch == '\n' || *ch == '\r' || *ch == '\t' || (*ch >= ' ' && *ch != '\u{007f}'))
        .take(2000)
        .collect()
}

fn memo_draft_text(app: &AppHandle) -> String {
    app.state::<MemoDraft>()
        .0
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}


fn empty_board() -> MemoBoardBody {
    MemoBoardBody {
        text: String::new(),
        notes: Vec::new(),
        selected: String::new(),
    }
}

fn note_id_ok(raw: &str) -> bool {
    (4..=16).contains(&raw.len())
        && raw
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
}

fn clip_board_notes(notes: Vec<BoardNote>) -> Vec<BoardNote> {
    let mut kept = Vec::new();
    for note in notes {
        if kept.len() >= 4 || !note_id_ok(&note.id) {
            continue;
        }
        if kept.iter().any(|item: &BoardNote| item.id == note.id) {
            continue;
        }
        kept.push(BoardNote {
            id: note.id,
            text: clip_memo_text(&note.text),
        });
    }
    kept
}

fn chosen_note(selected: &str, notes: &[BoardNote]) -> String {
    if note_id_ok(selected) && notes.iter().any(|note| note.id == selected) {
        selected.to_string()
    } else {
        String::new()
    }
}

fn write_board(app: &AppHandle, body: MemoBoardBody) {
    if let Ok(mut guard) = app.state::<MemoPages>().0.lock() {
        *guard = body;
    }
}

fn read_board(app: &AppHandle) -> MemoBoardBody {
    app.state::<MemoPages>()
        .0
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| empty_board())
}

fn emit_board(app: &AppHandle) {
    if app.get_webview_window("memo-pad").is_some() {
        let body = read_board(app);
        let _ = app.emit_to("memo-pad", "memo-board", &body);
    }
}

fn remember_home_text(app: &AppHandle, text: &str) {
    if let Ok(mut guard) = app.state::<MemoPages>().0.lock() {
        guard.text = text.to_string();
    }
}


fn safe_map_id(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(80)
        .collect();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchResult {
    ok: bool,
    error: Option<String>,
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedPathInfo {
    path: String,
    exists: bool,
    kind: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_image: Option<String>,
}

fn panel_place_mode(app: &AppHandle) -> String {
    app.state::<PanelState>()
        .position
        .lock()
        .map(|value| value.clone())
        .unwrap_or_else(|_| "bottom-right".to_string())
}

fn place_main_panel(app: &AppHandle, window: &tauri::WebviewWindow) {
    position_panel(window, &panel_place_mode(app));
}

fn reveal_panel(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        place_main_panel(app, &window);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("focus-search", ());
        show_map_window(app);
        place_map_next_to_panel(app, &window, false);
        show_memo_pad(app);
        #[cfg(windows)]
        {
            let _ = drop_target::install(&window, app);
        }
    }
}

fn hide_map_window(app: &AppHandle) {
    if let Some(map) = app.get_webview_window("work-map") {
        let _ = map.hide();
    }
}

fn show_map_window(app: &AppHandle) {
    if let Some(map) = app.get_webview_window("work-map") {
        let _ = map.unminimize();
        let _ = map.show();
    }
}

fn each_note_window(app: &AppHandle, mut visit: impl FnMut(&tauri::WebviewWindow)) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("memo-n-") {
            visit(&window);
        }
    }
}

fn hide_memo_pad(app: &AppHandle) {
    if let Some(pad) = app.get_webview_window("memo-pad") {
        persist_memo_size(app, &pad);
        let _ = pad.hide();
    }
    each_note_window(app, |window| {
        let _ = window.hide();
    });
}

fn show_memo_pad(app: &AppHandle) {
    if let Some(pad) = app.get_webview_window("memo-pad") {
        let _ = pad.unminimize();
        let _ = pad.show();
    }
    each_note_window(app, |window| {
        let _ = window.unminimize();
        let _ = window.show();
    });
}

fn panel_is_open(window: &tauri::WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
}

fn hide_window(app: &AppHandle) {
    file_desk::disarm(app, true);
    hide_map_window(app);
    hide_memo_pad(app);
    if let Some(window) = app.get_webview_window("main") {
        persist_panel_size(app, &window);
        let _ = window.minimize();
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if panel_is_open(&window) {
            hide_window(app);
        } else {
            reveal_panel(app);
        }
    }
}

fn panel_inner_logical(panel: &tauri::WebviewWindow) -> (f64, f64) {
    let scale = panel.scale_factor().unwrap_or(1.0);
    let inner = panel
        .inner_size()
        .unwrap_or(tauri::PhysicalSize::new(440, 650));
    (
        (inner.width as f64 / scale).max(280.0),
        (inner.height as f64 / scale).max(400.0),
    )
}

fn map_inner_from_panel(panel: &tauri::WebviewWindow) -> (f64, f64) {
    let (pw, ph) = panel_inner_logical(panel);
    let want = (pw * 1.4).max(320.0);
    let scale = panel.scale_factor().unwrap_or(1.0);
    let Some(pos) = panel.outer_position().ok() else {
        return (want, ph);
    };
    let Some(outer) = panel.outer_size().ok() else {
        return (want, ph);
    };
    let Some(monitor) = panel
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| panel.primary_monitor().ok().flatten())
    else {
        return (want, ph);
    };
    let work = monitor.work_area();
    let gap = 4i32;
    let left = pos.x - work.position.x - gap;
    let right = work.position.x + work.size.width as i32 - pos.x - outer.width as i32 - gap;
    let cap = (left.max(right).max(280) as f64) / scale;
    (want.min(cap).max(280.0), ph)
}

fn map_end_x(panel: &tauri::WebviewWindow, map_outer_width: u32) -> Option<i32> {
    let panel_pos = panel.outer_position().ok()?;
    let panel_size = panel.outer_size().ok()?;
    let monitor = panel
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| panel.primary_monitor().ok().flatten())?;
    let work = monitor.work_area();
    let gap = 4i32;
    let left_x = panel_pos.x - map_outer_width as i32 - gap;
    let right_x = panel_pos.x + panel_size.width as i32 + gap;
    let work_left = work.position.x;
    let work_right = work.position.x + work.size.width as i32;
    if left_x >= work_left {
        Some(left_x)
    } else if right_x + map_outer_width as i32 <= work_right {
        Some(right_x)
    } else {
        Some(work_left)
    }
}

fn place_map_next_to_panel(app: &AppHandle, panel: &tauri::WebviewWindow, glide: bool) {
    let Some(map) = app.get_webview_window("work-map") else {
        return;
    };
    let (end_w, end_h) = map_inner_from_panel(panel);
    let (start_w, start_h) = panel_inner_logical(panel);
    let Ok(panel_pos) = panel.outer_position() else {
        return;
    };
    let scale = panel.scale_factor().unwrap_or(1.0);
    let end_outer_w = (end_w * scale).round().max(1.0) as u32;
    let Some(end_x) = map_end_x(panel, end_outer_w) else {
        return;
    };
    let start_x = panel_pos.x;
    let y = panel_pos.y;
    if !glide {
        let _ = map.set_size(Size::Logical(LogicalSize::new(end_w, end_h)));
        let _ = map.set_position(PhysicalPosition::new(end_x, y));
        return;
    }
    let _ = map.set_size(Size::Logical(LogicalSize::new(start_w, start_h)));
    let _ = map.set_position(PhysicalPosition::new(start_x, y));
    let moving = map.clone();
    thread::spawn(move || {
        let steps = 12u32;
        for i in 1..=steps {
            thread::sleep(Duration::from_millis(16));
            let t = i as f64 / f64::from(steps);
            let w = start_w + (end_w - start_w) * t;
            let x = start_x + ((end_x - start_x) as f64 * t).round() as i32;
            let _ = moving.set_size(Size::Logical(LogicalSize::new(w, end_h)));
            let _ = moving.set_position(PhysicalPosition::new(x, y));
        }
        let _ = moving.set_size(Size::Logical(LogicalSize::new(end_w, end_h)));
        let _ = moving.set_position(PhysicalPosition::new(end_x, y));
    });
}

fn place_memo_next_to_panel(app: &AppHandle, panel: &tauri::WebviewWindow) {
    let Some(pad) = app.get_webview_window("memo-pad") else {
        return;
    };
    let (end_w, end_h) = read_saved_memo_size(app).unwrap_or_else(|| map_inner_from_panel(panel));
    let (start_w, start_h) = panel_inner_logical(panel);
    let Ok(panel_pos) = panel.outer_position() else {
        return;
    };
    let scale = panel.scale_factor().unwrap_or(1.0);
    let end_outer_w = (end_w * scale).round().max(1.0) as u32;
    let Some(end_x) = map_end_x(panel, end_outer_w) else {
        return;
    };
    let start_x = panel_pos.x;
    let y = panel_pos.y;
    let _ = pad.set_size(Size::Logical(LogicalSize::new(start_w, start_h)));
    let _ = pad.set_position(PhysicalPosition::new(start_x, y));
    let moving = pad.clone();
    thread::spawn(move || {
        let steps = 12u32;
        for i in 1..=steps {
            thread::sleep(Duration::from_millis(16));
            let t = i as f64 / f64::from(steps);
            let w = start_w + (end_w - start_w) * t;
            let h = start_h + (end_h - start_h) * t;
            let x = start_x + ((end_x - start_x) as f64 * t).round() as i32;
            let _ = moving.set_size(Size::Logical(LogicalSize::new(w, h)));
            let _ = moving.set_position(PhysicalPosition::new(x, y));
        }
        let _ = moving.set_size(Size::Logical(LogicalSize::new(end_w, end_h)));
        let _ = moving.set_position(PhysicalPosition::new(end_x, y));
    });
}

fn position_panel(window: &tauri::WebviewWindow, mode: &str) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let work = monitor.work_area();
    let size = window
        .outer_size()
        .unwrap_or(tauri::PhysicalSize::new(440, 650));
    let margin = 12i32;
    let (x, y) = if mode == "center" {
        (
            work.position.x + (work.size.width as i32 - size.width as i32) / 2,
            work.position.y + (work.size.height as i32 - size.height as i32) / 2,
        )
    } else {
        (
            work.position.x + work.size.width as i32 - size.width as i32 - margin,
            work.position.y + work.size.height as i32 - size.height as i32 - margin,
        )
    };
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "교육업무 런처 열기").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "설정").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "종료").build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &sep, &settings, &quit])
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("교육업무 런처")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => reveal_panel(app),
            "settings" => {
                reveal_panel(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => {
                if let Some(window) = app.get_webview_window("main") {
                    persist_panel_size(app, &window);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn setup_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window is missing")?;
    let (width, height) = read_saved_panel_size(app.handle());
    apply_panel_size(&window, width, height);
    place_main_panel(app.handle(), &window);
    let app_handle = app.handle().clone();
    window.on_window_event(move |event| {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                hide_window(&app_handle);
            }
            WindowEvent::Focused(true) => {
                if let Some(panel) = app_handle.get_webview_window("main") {
                    if !panel.is_minimized().unwrap_or(false) {
                        place_main_panel(&app_handle, &panel);
                    }
                }
            }
            _ => {}
        }
    });
    #[cfg(windows)]
    {
        let _ = drop_target::install(&window, app.handle());
        drop_target::install_later(app.handle().clone());
    }
    let _ = window.show();
    let _ = window.minimize();
    Ok(())
}

fn wanted_auto_start(app: &tauri::App) -> bool {
    use tauri_plugin_store::StoreExt;

    let Ok(store) = app.store("settings.json") else {
        return true;
    };
    store
        .get("value")
        .and_then(|value| value.get("autoStart").and_then(|flag| flag.as_bool()))
        .unwrap_or(true)
}

fn installed_launcher_exe() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local).join("EduLauncher").join("edulauncher.exe"));
        candidates.push(
            PathBuf::from(&local)
                .join("Programs")
                .join("EduLauncher")
                .join("edulauncher.exe"),
        );
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("release")
            .join("edulauncher.exe"),
    );
    candidates.into_iter().find(|path| path.exists())
}

fn pack_association_exe() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return installed_launcher_exe();
    }
    std::env::current_exe()
        .ok()
        .filter(|path| path.exists())
        .or_else(installed_launcher_exe)
}

fn reg_set_default(key: &str, data: &str) {
    run_reg(&["add", key, "/ve", "/t", "REG_SZ", "/d", data, "/f"]);
}

fn register_edupack_association(exe: &std::path::Path) {
    let exe_quoted = format!("\"{}\"", exe.display());
    let open_command = format!("{exe_quoted} \"%1\"");
    let icon = format!("{exe_quoted},0");
    reg_set_default(r"HKCU\Software\Classes\.edupack", "EduLauncher.NoticePack");
    reg_set_default(
        r"HKCU\Software\Classes\EduLauncher.NoticePack",
        "EduLauncher Notice Pack",
    );
    reg_set_default(
        r"HKCU\Software\Classes\EduLauncher.NoticePack\DefaultIcon",
        &icon,
    );
    reg_set_default(
        r"HKCU\Software\Classes\EduLauncher.NoticePack\shell\open\command",
        &open_command,
    );
    #[cfg(windows)]
    unsafe {
        SHChangeNotify(0x0800_0000, 0, std::ptr::null(), std::ptr::null());
    }
}

fn setup_edupack_association() {
    if let Some(exe) = pack_association_exe() {
        register_edupack_association(&exe);
    }
}

fn setup_send_to_link() {
    if let Some(exe) = pack_association_exe() {
        let _ = shortcut::write_send_to_link(&exe);
    }
}

fn enable_login_item(exe: &std::path::Path) {
    let value = format!("\"{}\"", exe.display());
    run_reg(&[
        "add",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
        "/v",
        "EduLauncher",
        "/t",
        "REG_SZ",
        "/d",
        &value,
        "/f",
    ]);
}

fn setup_autostart(app: &tauri::App) {
    use tauri_plugin_autostart::ManagerExt;

    if !wanted_auto_start(app) {
        let _ = app.autolaunch().disable();
        return;
    }

    // Never register the Vite-backed debug binary. That loads localhost:1420
    // after login and shows a connection error.
    if cfg!(debug_assertions) {
        if let Some(exe) = installed_launcher_exe() {
            enable_login_item(&exe);
        }
        return;
    }

    let _ = app.autolaunch().enable();
}

#[tauri::command]
async fn open_work_map_window(app: AppHandle, root_id: String) -> Result<(), String> {
    let id = safe_map_id(&root_id).ok_or_else(|| "그릴 업무를 열 수 없습니다.".to_string())?;
    if let Ok(mut slot) = app.state::<WorkMapFocus>().0.lock() {
        *slot = id.clone();
    }
    if let Some(existing) = app.get_webview_window("work-map") {
        let _ = existing.destroy();
    }
    let panel = app
        .get_webview_window("main")
        .ok_or_else(|| "패널을 열 수 없습니다.".to_string())?;
    let mode = app
        .state::<PanelState>()
        .position
        .lock()
        .map(|value| value.clone())
        .unwrap_or_else(|_| "bottom-right".to_string());
    position_panel(&panel, &mode);
    let _ = panel.unminimize();
    let _ = panel.show();
    let (start_w, start_h) = panel_inner_logical(&panel);
    let url = if cfg!(dev) {
        match &app.config().build.dev_url {
            Some(dev_url) => WebviewUrl::External(dev_url.clone()),
            None => WebviewUrl::App("index.html".into()),
        }
    } else {
        WebviewUrl::App("index.html".into())
    };
    WebviewWindowBuilder::new(&app, "work-map", url)
        .title("업무 그림")
        .inner_size(start_w, start_h)
        .min_inner_size(280.0, 400.0)
        .resizable(false)
        .closable(true)
        .visible(false)
        .skip_taskbar(true)
        .build()
        .map_err(|err| err.to_string())?;
    if let Some(created) = app.get_webview_window("work-map") {
        if let Ok(pos) = panel.outer_position() {
            let _ = created.set_position(pos);
        }
        let _ = created.set_size(Size::Logical(LogicalSize::new(start_w, start_h)));
        let _ = created.emit("work-map-root", &id);
        let _ = created.show();
    }
    place_map_next_to_panel(&app, &panel, true);
    Ok(())
}

#[tauri::command]
fn work_map_root_id(app: AppHandle) -> String {
    app.state::<WorkMapFocus>()
        .0
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}

#[tauri::command]
async fn open_memo_window(app: AppHandle) -> Result<(), String> {
    let draft = memo_draft_text(&app);
    if let Some(existing) = app.get_webview_window("memo-pad") {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        let _ = existing.emit("memo-draft", &draft);
        emit_board(&app);
        return Ok(());
    }
    let panel = app
        .get_webview_window("main")
        .ok_or_else(|| "패널을 열 수 없습니다.".to_string())?;
    let mode = app
        .state::<PanelState>()
        .position
        .lock()
        .map(|value| value.clone())
        .unwrap_or_else(|_| "bottom-right".to_string());
    position_panel(&panel, &mode);
    let _ = panel.unminimize();
    let _ = panel.show();
    let (start_w, start_h) = panel_inner_logical(&panel);
    let url = if cfg!(dev) {
        match &app.config().build.dev_url {
            Some(dev_url) => WebviewUrl::External(dev_url.clone()),
            None => WebviewUrl::App("index.html".into()),
        }
    } else {
        WebviewUrl::App("index.html".into())
    };
    WebviewWindowBuilder::new(&app, "memo-pad", url)
        .title("메모")
        .inner_size(start_w, start_h)
        .min_inner_size(MEMO_MIN_W, MEMO_MIN_H)
        .max_inner_size(MEMO_MAX_W, MEMO_MAX_H)
        .resizable(true)
        .closable(true)
        .visible(false)
        .skip_taskbar(true)
        .build()
        .map_err(|err| err.to_string())?;
    if let Some(created) = app.get_webview_window("memo-pad") {
        if let Ok(pos) = panel.outer_position() {
            let _ = created.set_position(pos);
        }
        let _ = created.set_size(Size::Logical(LogicalSize::new(start_w, start_h)));
        let app_for_close = app.clone();
        let pad_for_close = created.clone();
        created.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { .. } = event {
                persist_memo_size(&app_for_close, &pad_for_close);
            }
        });
        let _ = created.emit("memo-draft", &draft);
        let _ = created.show();
    }
    place_memo_next_to_panel(&app, &panel);
    if let Some(shown) = app.get_webview_window("memo-pad") {
        let _ = shown.set_focus();
        emit_board(&app);
    }
    Ok(())
}

#[tauri::command]
fn memo_draft(app: AppHandle) -> String {
    memo_draft_text(&app)
}

#[tauri::command]
fn set_memo_draft(app: AppHandle, text: String, source: String) {
    let clipped = clip_memo_text(&text);
    let state = app.state::<MemoDraft>();
    let changed = {
        let Ok(mut slot) = state.0.lock() else {
            return;
        };
        if *slot == clipped {
            false
        } else {
            *slot = clipped.clone();
            true
        }
    };
    if !changed {
        return;
    }
    remember_home_text(&app, &clipped);
    if source == "memo-pad" {
        let _ = app.emit_to("main", "memo-draft", &clipped);
    } else if let Some(pad) = app.get_webview_window("memo-pad") {
        let _ = pad.emit("memo-draft", &clipped);
    }
}


#[derive(Clone, Serialize)]
struct NoteChange {
    id: String,
    text: String,
}

#[tauri::command]
fn publish_memo_board(app: AppHandle, text: String, notes: Vec<BoardNote>, selected: String) {
    let notes = clip_board_notes(notes);
    let body = MemoBoardBody {
        text: clip_memo_text(&text),
        selected: chosen_note(&selected, &notes),
        notes,
    };
    if let Ok(mut slot) = app.state::<MemoDraft>().0.lock() {
        *slot = body.text.clone();
    }
    write_board(&app, body);
    emit_board(&app);
}

#[tauri::command]
fn memo_board(app: AppHandle) -> MemoBoardBody {
    read_board(&app)
}

#[tauri::command]
fn commit_memo_note(app: AppHandle, id: String, text: String) {
    if !note_id_ok(&id) {
        return;
    }
    let clipped = clip_memo_text(&text);
    if let Ok(mut guard) = app.state::<MemoPages>().0.lock() {
        if let Some(note) = guard.notes.iter_mut().find(|note| note.id == id) {
            note.text = clipped.clone();
        }
    }
    let drafts = app.state::<NoteDrafts>();
    if let Ok(mut guard) = drafts.0.lock() {
        if let Some(slot) = guard.get_mut(&id) {
            slot.text = clipped.clone();
        }
    }
    let _ = app.emit_to(
        "main",
        "memo-note-changed",
        NoteChange {
            id,
            text: clipped,
        },
    );
}

#[tauri::command]
fn request_memo_note(app: AppHandle) {
    let _ = app.emit_to("main", "memo-add-request", ());
}

#[tauri::command]
fn request_memo_remove(app: AppHandle, id: String) {
    if !note_id_ok(&id) {
        return;
    }
    let _ = app.emit_to("main", "memo-remove-request", &id);
}

fn note_label(raw: &str) -> Option<String> {
    if !note_id_ok(raw) {
        return None;
    }
    Some(format!("memo-n-{raw}"))
}

fn clip_note_size(width: f64, height: f64) -> (f64, f64) {
    (
        width.clamp(NOTE_MIN_W, NOTE_MAX_W),
        height.clamp(NOTE_MIN_H, NOTE_MAX_H),
    )
}

fn title_for_slot(slot: i32) -> String {
    let number = slot + 2;
    if (2..=5).contains(&number) {
        format!("메모 {number}")
    } else {
        "메모".to_string()
    }
}

fn clip_note_title(raw: &str, slot: i32) -> String {
    match raw.trim() {
        "메모 2" | "메모 3" | "메모 4" | "메모 5" => raw.trim().to_string(),
        _ => title_for_slot(slot),
    }
}

fn clamp_note_box(anchor: &tauri::WebviewWindow, x: f64, y: f64, width: f64, height: f64) -> (f64, f64, f64, f64) {
    let (mut width, mut height) = clip_note_size(width, height);
    let Some(monitor) = anchor
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| anchor.primary_monitor().ok().flatten())
    else {
        return (x, y, width, height);
    };
    let scale = anchor.scale_factor().unwrap_or(1.0).max(0.5);
    let work = monitor.work_area();
    let left = work.position.x as f64 / scale;
    let top = work.position.y as f64 / scale;
    let work_w = (work.size.width as f64 / scale).max(NOTE_MIN_W);
    let work_h = (work.size.height as f64 / scale).max(NOTE_MIN_H);
    width = width.min(work_w);
    height = height.min(work_h);
    let max_x = left + work_w - width;
    let max_y = top + work_h - height;
    let x = x.clamp(left, max_x.max(left));
    let y = y.clamp(top, max_y.max(top));
    (x, y, width, height)
}

fn fresh_note_place(panel: &tauri::WebviewWindow, width: f64, height: f64, slot: i32) -> (f64, f64, f64, f64) {
    let (width, height) = clip_note_size(width, height);
    let scale = panel.scale_factor().unwrap_or(1.0).max(0.5);
    let outer_w = (width * scale).round().max(1.0) as u32;
    let x_px = map_end_x(panel, outer_w).unwrap_or_else(|| panel.outer_position().map(|pos| pos.x).unwrap_or(0));
    let y_px = panel.outer_position().map(|pos| pos.y).unwrap_or(0) + slot.clamp(0, 3) * 36;
    clamp_note_box(panel, x_px as f64 / scale, y_px as f64 / scale, width, height)
}

fn remember_note(app: &AppHandle, id: &str, text: String, title: String) {
    let drafts = app.state::<NoteDrafts>();
    if let Ok(mut guard) = drafts.0.lock() {
        guard.insert(
            id.to_string(),
            NoteSlot { text, title },
        );
    };
}

#[derive(Serialize)]
struct NoteTextBody {
    text: String,
    title: String,
}

#[derive(Clone, Serialize)]
struct NotePlace {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[tauri::command]
fn memo_note_text(app: AppHandle, id: String) -> NoteTextBody {
    let drafts = app.state::<NoteDrafts>();
    let Ok(guard) = drafts.0.lock() else {
        return NoteTextBody {
            text: String::new(),
            title: "메모".to_string(),
        };
    };
    guard
        .get(&id)
        .map(|slot| NoteTextBody {
            text: slot.text.clone(),
            title: slot.title.clone(),
        })
        .unwrap_or_else(|| NoteTextBody {
            text: String::new(),
            title: "메모".to_string(),
        })
}

#[tauri::command]
async fn open_memo_note(
    app: AppHandle,
    id: String,
    text: String,
    title: String,
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
    slot: i32,
    large: Option<bool>,
) -> Result<(), String> {
    let Some(label) = note_label(&id) else {
        return Err("메모를 열 수 없습니다.".to_string());
    };
    let title = clip_note_title(&title, slot);
    let text = clip_memo_text(&text);
    remember_note(&app, &id, text, title.clone());
    let large = large.unwrap_or(false);
    let panel = app
        .get_webview_window("main")
        .ok_or_else(|| "패널을 열 수 없습니다.".to_string())?;
    // 크게 보기는 런처 창과 같은 크기로 연다.
    let (width, height) = if large {
        panel_inner_logical(&panel)
    } else {
        (width, height)
    };
    if let Some(existing) = app.get_webview_window(&label) {
        if large {
            let (w, h) = clip_note_size(width, height);
            let _ = existing.set_size(Size::Logical(LogicalSize::new(w, h)));
        }
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        notify_note_open(&app, &id, true);
        return Ok(());
    }
    let (x, y, width, height) = match (x, y) {
        (Some(x), Some(y)) if x.is_finite() && y.is_finite() => clamp_note_box(&panel, x, y, width, height),
        _ => fresh_note_place(&panel, width, height, slot),
    };
    let url = if cfg!(dev) {
        match &app.config().build.dev_url {
            Some(dev_url) => WebviewUrl::External(dev_url.clone()),
            None => WebviewUrl::App("index.html".into()),
        }
    } else {
        WebviewUrl::App("index.html".into())
    };
    WebviewWindowBuilder::new(&app, &label, url)
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(NOTE_MIN_W, NOTE_MIN_H)
        .max_inner_size(NOTE_MAX_W, NOTE_MAX_H)
        .resizable(true)
        .closable(true)
        .visible(false)
        .skip_taskbar(true)
        .build()
        .map_err(|err| err.to_string())?;
    if let Some(created) = app.get_webview_window(&label) {
        let scale = panel.scale_factor().unwrap_or(1.0).max(0.5);
        let _ = created.set_size(Size::Logical(LogicalSize::new(width, height)));
        let _ = created.set_position(PhysicalPosition::new(
            (x * scale).round() as i32,
            (y * scale).round() as i32,
        ));
        let _ = created.show();
        let _ = created.set_focus();
        notify_note_open(&app, &id, true);
    }
    Ok(())
}

#[derive(Clone, Serialize)]
struct NoteOpenState {
    id: String,
    open: bool,
}

fn notify_note_open(app: &AppHandle, id: &str, open: bool) {
    let _ = app.emit_to(
        "main",
        "memo-note-open",
        NoteOpenState {
            id: id.to_string(),
            open,
        },
    );
}

#[tauri::command]
fn place_memo_note(app: AppHandle, id: String, x: f64, y: f64, width: f64, height: f64) {
    let Some(label) = note_label(&id) else {
        return;
    };
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
        return;
    }
    let anchor = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window(&label));
    let (x, y, width, height) = if let Some(anchor) = anchor {
        clamp_note_box(&anchor, x, y, width, height)
    } else {
        let (width, height) = clip_note_size(width, height);
        (x, y, width, height)
    };
    let _ = app.emit_to(
        "main",
        "memo-note-placed",
        NotePlace {
            id,
            x,
            y,
            width,
            height,
        },
    );
}

#[tauri::command]
fn dismiss_memo_note(app: AppHandle, id: String) {
    let Some(label) = note_label(&id) else {
        return;
    };
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.destroy();
    }
    let drafts = app.state::<NoteDrafts>();
    if let Ok(mut guard) = drafts.0.lock() {
        guard.remove(&id);
    };
    notify_note_open(&app, &id, false);
}

#[tauri::command]
fn set_memo_window_size(app: AppHandle, width: f64, height: f64) {
    save_memo_size(&app, width, height);
}

#[tauri::command]
fn reveal_topic(app: AppHandle, topic_id: String) -> Result<(), String> {
    let id = safe_map_id(&topic_id).ok_or_else(|| "항목을 열 수 없습니다.".to_string())?;
    if let Some(window) = app.get_webview_window("main") {
        let position = app
            .state::<PanelState>()
            .position
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| "bottom-right".to_string());
        position_panel(&window, &position);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("open-topic", id);
        #[cfg(windows)]
        {
            let _ = drop_target::install(&window, &app);
        }
    }
    Ok(())
}

#[tauri::command]
fn hide_panel(app: AppHandle) {
    hide_window(&app);
}

#[tauri::command]
fn show_panel(app: AppHandle) {
    reveal_panel(&app);
}

#[tauri::command]
fn toggle_panel(app: AppHandle) {
    toggle_window(&app);
}

#[tauri::command]
fn set_launcher_position(app: AppHandle, state: tauri::State<PanelState>, position: String) {
    if let Ok(mut current) = state.position.lock() {
        *current = position.clone();
    }
    if let Some(window) = app.get_webview_window("main") {
        position_panel(&window, &position);
        place_map_next_to_panel(&app, &window, false);
    }
}

#[tauri::command]
fn register_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|err| err.to_string())?;
    manager
        .register(shortcut.as_str())
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn launch_tool(app: AppHandle, tool_type: String, target: String) -> LaunchResult {
    match tool_type.as_str() {
        "file" => {
            if !PathBuf::from(&target).exists() {
                return LaunchResult {
                    ok: false,
                    error: Some("not_found".into()),
                    path: Some(target),
                };
            }
            match app.opener().open_path(&target, None::<&str>) {
                Ok(_) => LaunchResult {
                    ok: true,
                    error: None,
                    path: None,
                },
                Err(err) => LaunchResult {
                    ok: false,
                    error: Some(err.to_string()),
                    path: Some(target),
                },
            }
        }
        "folder" => open_folder_with_explorer(&target),
        "app" => {
            if !PathBuf::from(&target).exists() {
                return LaunchResult {
                    ok: false,
                    error: Some("not_found".into()),
                    path: Some(target),
                };
            }
            let opened: Result<(), String> = if shortcut::is_shortcut(Path::new(&target)) {
                app.opener()
                    .open_path(&target, None::<&str>)
                    .map(|_| ())
                    .map_err(|err| err.to_string())
            } else {
                match std::process::Command::new(&target).spawn() {
                    Ok(_) => Ok(()),
                    Err(err) => {
                        let text = err.to_string();
                        if text.contains("740") {
                            app.opener()
                                .open_path(&target, None::<&str>)
                                .map(|_| ())
                                .map_err(|open_err| open_err.to_string())
                        } else {
                            Err(text)
                        }
                    }
                }
            };
            match opened {
                Ok(_) => LaunchResult {
                    ok: true,
                    error: None,
                    path: None,
                },
                Err(err) => LaunchResult {
                    ok: false,
                    error: Some(err),
                    path: Some(target),
                },
            }
        }
        _ => LaunchResult {
            ok: false,
            error: Some("unsupported".into()),
            path: Some(target),
        },
    }
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn LockWorkStation() -> i32;
}

fn open_folder_with_explorer(target: &str) -> LaunchResult {
    let path = PathBuf::from(target);
    if !path.is_dir() {
        return LaunchResult {
            ok: false,
            error: Some("not_found".into()),
            path: Some(target.to_string()),
        };
    }
    #[cfg(windows)]
    {
        let explorer = PathBuf::from(r"C:\Windows\explorer.exe");
        if !explorer.is_file() {
            return LaunchResult {
                ok: false,
                error: Some("폴더를 열 수 없습니다.".into()),
                path: Some(target.to_string()),
            };
        }
        match std::process::Command::new(&explorer).arg(&path).spawn() {
            Ok(_) => LaunchResult {
                ok: true,
                error: None,
                path: None,
            },
            Err(err) => LaunchResult {
                ok: false,
                error: Some(err.to_string()),
                path: Some(target.to_string()),
            },
        }
    }
    #[cfg(not(windows))]
    {
        LaunchResult {
            ok: false,
            error: Some("unsupported".into()),
            path: Some(target.to_string()),
        }
    }
}

#[tauri::command]
fn run_shortcut_action(action_id: String) -> Result<(), String> {
    let id = action_id.trim();
    if id.len() > 40 || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
        return Err("실행할 수 없습니다.".into());
    }
    #[cfg(windows)]
    {
        match id {
            "explorer" => {
                let explorer = PathBuf::from(r"C:\Windows\explorer.exe");
                if !explorer.is_file() {
                    return Err("탐색기를 열 수 없습니다.".into());
                }
                std::process::Command::new(explorer)
                    .spawn()
                    .map_err(|err| err.to_string())?;
                Ok(())
            }
            "taskmgr" => {
                let taskmgr = PathBuf::from(r"C:\Windows\System32\taskmgr.exe");
                if !taskmgr.is_file() {
                    return Err("작업 관리자를 열 수 없습니다.".into());
                }
                std::process::Command::new(taskmgr)
                    .spawn()
                    .map_err(|err| err.to_string())?;
                Ok(())
            }
            "snip" => {
                let snip = PathBuf::from(r"C:\Windows\System32\SnippingTool.exe");
                if snip.is_file() {
                    std::process::Command::new(snip)
                        .spawn()
                        .map_err(|err| err.to_string())?;
                    return Ok(());
                }
                let explorer = PathBuf::from(r"C:\Windows\explorer.exe");
                if !explorer.is_file() {
                    return Err("화면 캡처를 열 수 없습니다.".into());
                }
                std::process::Command::new(explorer)
                    .arg("ms-screenclip:")
                    .spawn()
                    .map_err(|err| err.to_string())?;
                Ok(())
            }
            "settings" => {
                let explorer = PathBuf::from(r"C:\Windows\explorer.exe");
                if !explorer.is_file() {
                    return Err("설정을 열 수 없습니다.".into());
                }
                std::process::Command::new(explorer)
                    .arg("ms-settings:")
                    .spawn()
                    .map_err(|err| err.to_string())?;
                Ok(())
            }
            "lock" => {
                let ok = unsafe { LockWorkStation() };
                if ok == 0 {
                    return Err("화면을 잠그지 못했습니다.".into());
                }
                Ok(())
            }
            _ => Err("실행할 수 없습니다.".into()),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        Err("unsupported".into())
    }
}

#[tauri::command]
fn open_ie_reset() -> Result<(), String> {
    #[cfg(windows)]
    {
        let rundll = PathBuf::from(r"C:\Windows\System32\rundll32.exe");
        if !rundll.is_file() {
            return Err("복원 화면을 열 수 없습니다.".into());
        }
        std::process::Command::new(rundll)
            .arg("inetcpl.cpl,ResetIEtoDefaults")
            .spawn()
            .map_err(|err| err.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Windows에서만 열 수 있습니다.".into())
    }
}

fn is_pack_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json") || ext.eq_ignore_ascii_case("edupack"))
}

fn is_url_shortcut_file(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| {
        ext.eq_ignore_ascii_case("url") || ext.eq_ignore_ascii_case("website")
    })
}

fn is_http_url(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.len() <= 2048
        && (trimmed.len() >= 10)
        && (trimmed.starts_with("http://")
            || trimmed.starts_with("https://")
            || trimmed.starts_with("HTTP://")
            || trimmed.starts_with("HTTPS://"))
}

fn decode_shortcut_bytes(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn parse_url_from_shortcut(contents: &str) -> Option<String> {
    for line in contents.lines() {
        let line = line.trim();
        let value = line
            .strip_prefix("URL=")
            .or_else(|| line.strip_prefix("url="))
            .or_else(|| line.strip_prefix("Url="));
        let Some(value) = value else {
            continue;
        };
        let url = value.trim();
        if is_http_url(url) {
            return Some(url.to_string());
        }
    }
    None
}

fn host_label(url: &str) -> String {
    let rest = url
        .split_once("://")
        .map(|(_, after)| after)
        .unwrap_or(url);
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim()
        .trim_start_matches("www.");
    if host.is_empty() {
        "사이트".into()
    } else {
        host.into()
    }
}

fn shortcut_display_name(path: &Path, url: &str) -> String {
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default()
        .trim()
        .to_string();
    let lower = stem.to_ascii_lowercase();
    if stem.is_empty() || lower.starts_with("http") || stem.contains("://") || lower.starts_with("www.")
    {
        return host_label(url);
    }
    stem.chars().take(80).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UrlShortcut {
    url: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_image: Option<String>,
}

fn local_file_icon(path: &Path) -> Option<String> {
    #[cfg(windows)]
    {
        shell_icon::png_data_url(path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

fn shortcut_body_icon(contents: &str) -> Option<String> {
    #[cfg(windows)]
    {
        shell_icon::png_data_url_from_shortcut(contents)
    }
    #[cfg(not(windows))]
    {
        let _ = contents;
        None
    }
}

fn pack_paths_from(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|arg| {
            let path = Path::new(arg);
            is_pack_file(path) && path.is_file()
        })
        .collect()
}

fn emit_pack_paths(app: &AppHandle, paths: &[String]) {
    for path in paths {
        let _ = app.emit("apply-notice-pack", path);
    }
}

fn url_paths_from(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|arg| {
            if arg.len() > 4096 || arg.contains('\0') {
                return false;
            }
            let path = Path::new(arg);
            is_url_shortcut_file(path) && path.is_file()
        })
        .collect()
}

fn emit_url_paths(app: &AppHandle, paths: &[String]) {
    for path in paths {
        let _ = app.emit("apply-url-shortcut", path);
    }
}

#[tauri::command]
fn take_startup_pack_paths(state: tauri::State<StartupPacks>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

#[tauri::command]
fn take_startup_url_paths(state: tauri::State<StartupUrls>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}

#[tauri::command(async)]
fn favicon_for_url(url: String) -> Option<String> {
    if !is_http_url(&url) {
        return None;
    }
    #[cfg(windows)]
    {
        favicon_db::icon_data_url(url.trim())
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[tauri::command(async)]
fn favicon_for_urls(urls: Vec<String>) -> Vec<Option<String>> {
    let urls: Vec<String> = urls.into_iter().take(1000).collect();
    #[cfg(windows)]
    {
        let valid: Vec<String> = urls
            .iter()
            .map(|url| if is_http_url(url) { url.trim().to_string() } else { String::new() })
            .collect();
        favicon_db::icon_data_urls(&valid)
    }
    #[cfg(not(windows))]
    {
        vec![None; urls.len()]
    }
}

#[tauri::command]
fn read_bookmark_html(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let is_html = path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| {
        ext.eq_ignore_ascii_case("html") || ext.eq_ignore_ascii_case("htm")
    });
    if !is_html {
        return Err("내보낸 즐겨찾기 파일(.html)만 불러올 수 있습니다.".into());
    }
    let meta = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !meta.is_file() {
        return Err("파일이 아닙니다.".into());
    }
    if meta.len() > 8 * 1024 * 1024 {
        return Err("파일이 너무 큽니다.".into());
    }
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

fn notices_window_allowed(label: &str) -> bool {
    label == "main"
}

#[tauri::command]
fn read_open_source_notices(window: tauri::WebviewWindow, app: AppHandle) -> Result<String, String> {
    if !notices_window_allowed(window.label()) {
        return Err("이 창에서는 열 수 없습니다.".into());
    }
    let root = app
        .path()
        .resource_dir()
        .map_err(|_| "고지 파일 위치를 찾지 못했습니다.".to_string())?;
    let path = root.join("THIRD_PARTY_NOTICES.txt");
    let root_real = root
        .canonicalize()
        .map_err(|_| "고지 파일 위치를 찾지 못했습니다.".to_string())?;
    let file_real = path
        .canonicalize()
        .map_err(|_| "고지 파일을 찾지 못했습니다.".to_string())?;
    if !file_real.starts_with(&root_real) {
        return Err("고지 파일을 열 수 없습니다.".into());
    }
    let meta = fs::metadata(&file_real).map_err(|_| "고지 파일을 찾지 못했습니다.".to_string())?;
    if !meta.is_file() || meta.len() > 5 * 1024 * 1024 {
        return Err("고지 파일을 열 수 없습니다.".into());
    }
    fs::read_to_string(&file_real).map_err(|_| "고지 파일을 읽지 못했습니다.".to_string())
}

#[tauri::command]
fn read_json_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !is_pack_file(&path) {
        return Err("Pack 파일(.edupack)만 가져올 수 있습니다.".into());
    }
    let meta = fs::metadata(&path).map_err(|err| err.to_string())?;
    if meta.len() > 256 * 1024 {
        return Err("파일이 너무 큽니다.".into());
    }
    fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[tauri::command]
fn read_url_shortcut(path: String) -> Result<UrlShortcut, String> {
    let path = PathBuf::from(path);
    if !is_url_shortcut_file(&path) {
        return Err("인터넷 바로가기(.url)만 넣을 수 있습니다.".into());
    }
    let meta = fs::metadata(&path).map_err(|err| err.to_string())?;
    if !meta.is_file() {
        return Err("파일이 아닙니다.".into());
    }
    if meta.len() > 16 * 1024 {
        return Err("파일이 너무 큽니다.".into());
    }
    let bytes = fs::read(&path).map_err(|err| err.to_string())?;
    let contents = decode_shortcut_bytes(&bytes);
    let url = parse_url_from_shortcut(&contents)
        .ok_or_else(|| "주소가 없거나 http(s)가 아닙니다.".to_string())?;
    let icon_image = shortcut_body_icon(&contents)
        .or_else(|| favicon_for_url(url.clone()))
        .or_else(|| local_file_icon(&path));
    Ok(UrlShortcut {
        name: shortcut_display_name(&path, &url),
        url,
        icon_image,
    })
}

#[tauri::command]
fn dropped_path_info(path: String) -> Result<DroppedPathInfo, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.len() > 4096 || trimmed.contains('\0') {
        return Err("경로가 올바르지 않습니다.".into());
    }
    if is_http_url(trimmed) {
        return Err("주소는 사이트 바로가기로 넣습니다.".into());
    }
    let dropped = PathBuf::from(trimmed);
    let name = shortcut::display_stem(&dropped);
    match fs::metadata(&dropped) {
        Ok(meta) => {
            let (kind, target) = classify_dropped_path(&dropped, meta.is_dir());
            Ok(DroppedPathInfo {
                path: target,
                exists: true,
                kind,
                name,
                icon_image: local_file_icon(&dropped),
            })
        }
        Err(_) => Ok(DroppedPathInfo {
            path: trimmed.to_string(),
            exists: false,
            kind: "file".into(),
            name,
            icon_image: None,
        }),
    }
}

fn classify_dropped_path(dropped: &Path, is_dir: bool) -> (String, String) {
    if is_dir {
        return ("folder".into(), dropped.to_string_lossy().into_owned());
    }
    if shortcut::is_shortcut(dropped) {
        if let Some(target) = shortcut::resolve_shortcut_target(dropped) {
            if let Ok(meta) = fs::metadata(&target) {
                if meta.is_dir() {
                    return ("folder".into(), target.to_string_lossy().into_owned());
                }
                if shortcut::is_exe(&target) {
                    return ("app".into(), target.to_string_lossy().into_owned());
                }
                return ("file".into(), target.to_string_lossy().into_owned());
            }
        }
        return ("file".into(), dropped.to_string_lossy().into_owned());
    }
    if shortcut::is_exe(dropped) {
        return ("app".into(), dropped.to_string_lossy().into_owned());
    }
    ("file".into(), dropped.to_string_lossy().into_owned())
}

#[tauri::command]
fn write_json_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !is_pack_file(&path) {
        return Err("Pack 파일(.edupack)만 저장할 수 있습니다.".into());
    }
    if contents.len() > 256 * 1024 {
        return Err("내용이 너무 큽니다.".into());
    }
    fs::write(&path, contents).map_err(|err| err.to_string())
}

fn is_csv_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("csv"))
}

#[tauri::command]
fn write_csv_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !is_csv_path(&path) {
        return Err("CSV 파일만 저장할 수 있습니다.".into());
    }
    if contents.len() > 512 * 1024 {
        return Err("내용이 너무 큽니다.".into());
    }
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(contents.as_bytes());
    fs::write(&path, bytes).map_err(|err| err.to_string())
}

#[tauri::command]
fn this_pc_ipv4() -> Vec<netutil::LocalAddress> {
    netutil::this_pc_ipv4()
}

#[tauri::command]
fn lookup_public_ipv4() -> Result<String, String> {
    netutil::lookup_public_ipv4()
}

#[tauri::command]
fn latest_release_tag() -> Result<String, String> {
    netutil::latest_release_tag()
}

fn admin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "관리자 도구 설정을 읽지 못했습니다.".to_string())
}

#[tauri::command]
fn admin_tools_query(app: AppHandle, window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("denied".into());
    }
    Ok(admin_tools::allowed(&admin_dir(&app)?))
}

#[tauri::command]
fn admin_tools_enable(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("denied".into());
    }
    admin_tools::write_enabled(&admin_dir(&app)?, true)
}

#[tauri::command]
fn admin_tools_disable(
    app: AppHandle,
    window: tauri::WebviewWindow,
    halt: tauri::State<RangeHalt>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("denied".into());
    }
    halt.0.store(true, Ordering::SeqCst);
    admin_tools::write_enabled(&admin_dir(&app)?, false)
}

#[tauri::command]
fn scan_ipv4_range(
    app: AppHandle,
    window: tauri::WebviewWindow,
    halt: tauri::State<RangeHalt>,
    start: String,
    end: String,
) -> Result<Vec<netutil::HostHit>, String> {
    if window.label() != "main" {
        return Err("denied".into());
    }
    let dir = admin_dir(&app)?;
    admin_tools::caller_result("main", &dir).map_err(|code| code.to_string())?;
    halt.0.store(false, Ordering::SeqCst);
    netutil::scan_ipv4_range(&app, &halt.0, &start, &end)
}

#[tauri::command]
fn scan_cctv_range(
    app: AppHandle,
    window: tauri::WebviewWindow,
    halt: tauri::State<RangeHalt>,
    start: String,
    end: String,
) -> Result<Vec<netutil::HostHit>, String> {
    if window.label() != "main" {
        return Err("denied".into());
    }
    let dir = admin_dir(&app)?;
    admin_tools::caller_result("main", &dir).map_err(|code| code.to_string())?;
    halt.0.store(false, Ordering::SeqCst);
    netutil::scan_cctv_range(&app, &halt.0, &start, &end)
}

#[tauri::command]
fn halt_range_check(window: tauri::WebviewWindow, halt: tauri::State<RangeHalt>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("denied".into());
    }
    halt.0.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn find_user_folder_names(
    halt: tauri::State<FolderWalkHalt>,
    query: String,
    include_media: bool,
    limit: u32,
) -> Result<Vec<user_folder::UserFolderHit>, String> {
    user_folder::find_names(&query, include_media, limit as usize, &halt.0)
}

#[tauri::command]
fn halt_user_folder_find(halt: tauri::State<FolderWalkHalt>) {
    halt.0.store(true, Ordering::SeqCst);
}

const MAX_PC_URLS: usize = 400;
const MAX_URL_WALK_DEPTH: u32 = 6;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PcUrlItem {
    name: String,
    url: String,
    folder: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

fn favorites_dir() -> Result<PathBuf, String> {
    let profile = std::env::var("USERPROFILE").map_err(|_| "사용자 폴더를 찾지 못했습니다.")?;
    if profile.is_empty() || profile.contains('\0') {
        return Err("사용자 폴더가 올바르지 않습니다.".into());
    }
    Ok(PathBuf::from(profile).join("Favorites"))
}

fn path_inside(root: &Path, candidate: &Path) -> bool {
    let strip = |value: &Path| {
        value
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .replace('/', "\\")
            .to_ascii_lowercase()
    };
    let root_s = strip(root);
    let child = strip(candidate);
    child == root_s || child.starts_with(&(root_s.clone() + "\\"))
}

fn relative_folder(root: &Path, file: &Path) -> String {
    let Some(parent) = file.parent() else {
        return String::new();
    };
    let strip = |value: &Path| {
        value
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .replace('/', "\\")
    };
    let root_s = strip(root);
    let parent_s = strip(parent);
    parent_s
        .strip_prefix(&root_s)
        .unwrap_or("")
        .trim_start_matches('\\')
        .replace('\\', "/")
}

fn collect_pc_urls(root: &Path, dir: &Path, depth: u32, out: &mut Vec<PcUrlItem>) {
    if depth > MAX_URL_WALK_DEPTH || out.len() >= MAX_PC_URLS {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_PC_URLS {
            break;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            let Ok(canon) = fs::canonicalize(&path) else {
                continue;
            };
            if !path_inside(root, &canon) {
                continue;
            }
            collect_pc_urls(root, &canon, depth + 1, out);
            continue;
        }
        if !meta.is_file() || !is_url_shortcut_file(&path) || meta.len() > 16 * 1024 {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let contents = decode_shortcut_bytes(&bytes);
        let Some(url) = parse_url_from_shortcut(&contents) else {
            continue;
        };
        let folder = join_folder("Windows", &relative_folder(root, &path));
        out.push(PcUrlItem {
            name: shortcut_display_name(&path, &url),
            url,
            folder,
            path: Some(path.to_string_lossy().into_owned()),
        });
    }
}

fn join_folder(base: &str, name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return base.to_string();
    }
    if base.is_empty() {
        return trimmed.chars().take(80).collect();
    }
    let short: String = trimmed.chars().take(60).collect();
    format!("{base} / {short}")
}

fn map_text<'a>(map: &'a serde_json::Map<String, serde_json::Value>, key: &str) -> Option<&'a str> {
    map.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn collect_json_urls(value: &serde_json::Value, folder: &str, out: &mut Vec<PcUrlItem>, depth: u32) {
    if depth > 12 || out.len() >= MAX_PC_URLS {
        return;
    }
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                collect_json_urls(item, folder, out, depth + 1);
            }
        }
        serde_json::Value::Object(map) => {
            if map.contains_key("children") {
                let name = map_text(map, "name").or_else(|| map_text(map, "title")).unwrap_or("");
                let next = join_folder(folder, name);
                if let Some(children) = map.get("children") {
                    collect_json_urls(children, &next, out, depth + 1);
                }
                return;
            }
            if let Some(raw) = map.get("url").and_then(|item| item.as_str()) {
                if is_http_url(raw) {
                    let label = map_text(map, "name")
                        .or_else(|| map_text(map, "title"))
                        .filter(|name| {
                            let lower = name.to_ascii_lowercase();
                            !lower.starts_with("http") && !name.contains("://") && !lower.starts_with("www.")
                        })
                        .map(|name| name.chars().take(80).collect::<String>())
                        .unwrap_or_else(|| host_label(raw));
                    out.push(PcUrlItem {
                        name: label,
                        url: raw.trim().to_string(),
                        folder: if folder.is_empty() {
                            "바로가기".into()
                        } else {
                            folder.to_string()
                        },
                        path: None,
                    });
                }
                return;
            }
            for nested in map.values() {
                collect_json_urls(nested, folder, out, depth + 1);
            }
        }
        _ => {}
    }
}

fn read_bookmark_json(path: &Path, prefix: &str, out: &mut Vec<PcUrlItem>) {
    if out.len() >= MAX_PC_URLS {
        return;
    }
    let Ok(meta) = fs::symlink_metadata(path) else {
        return;
    };
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > 2 * 1024 * 1024 {
        return;
    }
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return;
    };
    collect_json_urls(&value, prefix, out, 0);
}

fn collect_user_data_bookmarks(label: &str, user_data: &Path, out: &mut Vec<PcUrlItem>) {
    if !user_data.is_dir() {
        return;
    }
    let Ok(root) = fs::canonicalize(user_data) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    let mut profiles = 0usize;
    for entry in entries.flatten() {
        if profiles >= 8 || out.len() >= MAX_PC_URLS {
            break;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            continue;
        }
        let Ok(canon) = fs::canonicalize(&path) else {
            continue;
        };
        if !path_inside(&root, &canon) {
            continue;
        }
        let bookmarks = canon.join("Bookmarks");
        let Ok(file_meta) = fs::symlink_metadata(&bookmarks) else {
            continue;
        };
        if file_meta.file_type().is_symlink() || !file_meta.is_file() {
            continue;
        }
        if !path_inside(&root, &bookmarks) {
            continue;
        }
        profiles += 1;
        let profile = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Default");
        let prefix = if profile.eq_ignore_ascii_case("default") {
            label.to_string()
        } else {
            format!("{label} / {profile}")
        };
        read_bookmark_json(&bookmarks, &prefix, out);
    }
}

#[tauri::command]
fn list_pc_url_shortcuts() -> Result<Vec<PcUrlItem>, String> {
    let mut items = Vec::new();
    let root = favorites_dir()?;
    if root.is_dir() {
        if let Ok(canonical) = fs::canonicalize(&root) {
            collect_pc_urls(&canonical, &canonical, 0, &mut items);
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        if !local.is_empty() && !local.contains('\0') {
            let base = PathBuf::from(local);
            collect_user_data_bookmarks("Edge", &base.join("Microsoft").join("Edge").join("User Data"), &mut items);
            collect_user_data_bookmarks("Chrome", &base.join("Google").join("Chrome").join("User Data"), &mut items);
        }
    }
    items.sort_by(|left, right| {
        left.folder
            .cmp(&right.folder)
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(items)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Started {
                file_desk::disarm(webview.app_handle(), true);
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            reveal_panel(app);
            emit_pack_paths(app, &pack_paths_from(argv.iter().cloned()));
            emit_url_paths(app, &url_paths_from(argv));
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("EduLauncher")
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        reveal_panel(app);
                    }
                })
                .build(),
        )
        .manage(PanelState {
            position: Mutex::new("bottom-right".to_string()),
        })
        .manage(StartupPacks(Mutex::new(pack_paths_from(
            std::env::args().skip(1),
        ))))
        .manage(StartupUrls(Mutex::new(url_paths_from(
            std::env::args().skip(1),
        ))))
        .manage(RangeHalt(Arc::new(AtomicBool::new(false))))
        .manage(FolderWalkHalt(Arc::new(AtomicBool::new(false))))
        .manage(WorkMapFocus(Mutex::new(String::new())))
        .manage(MemoDraft(Mutex::new(String::new())))
        .manage(MemoPages(Mutex::new(MemoBoardBody {
            text: String::new(),
            notes: Vec::new(),
            selected: String::new(),
        })))
        .manage(NoteDrafts(Mutex::new(HashMap::new())))
        .manage(file_desk::FileDesk::new())
        .invoke_handler(tauri::generate_handler![
            file_desk::privacy_enter,
            file_desk::privacy_leave,
            file_desk::privacy_reset,
            file_desk::privacy_pick,
            file_desk::privacy_pick_folder,
            file_desk::privacy_folder_begin,
            file_desk::privacy_folder_page,
            file_desk::privacy_scan,
            file_desk::privacy_stop,
            file_desk::privacy_preview,
            file_desk::privacy_reveal,
            hide_panel,
            show_panel,
            toggle_panel,
            set_launcher_position,
            register_shortcut,
            open_work_map_window,
            work_map_root_id,
            open_memo_window,
            memo_draft,
            set_memo_draft,
            publish_memo_board,
            memo_board,
            commit_memo_note,
            request_memo_note,
            request_memo_remove,
            memo_note_text,
            open_memo_note,
            place_memo_note,
            dismiss_memo_note,
            set_memo_window_size,
            reveal_topic,
            launch_tool,
            run_shortcut_action,
            open_ie_reset,
            read_open_source_notices,
            read_json_file,
            read_url_shortcut,
            dropped_path_info,
            write_json_file,
            write_csv_file,
            build_url_mark,
            read_picture_file,
            write_png_file,
            read_privacy_picture,
            write_privacy_picture,
            doc_picture_bytes,
            plan_doc_save,
            write_new_picture,
            pdf_glance,
            pdf_halt,
            pdf_merge,
            pdf_extract,
            pdf_arrange,
            doc_search_folders,
            doc_search_add_folder,
            doc_search_remove_folder,
            doc_search_clear,
            doc_search_status,
            doc_search_halt,
            doc_search_start,
            doc_search_query,
            take_startup_pack_paths,
            take_startup_url_paths,
            read_bookmark_html,
            favicon_for_url,
            favicon_for_urls,
            admin_tools_query,
            admin_tools_enable,
            admin_tools_disable,
            this_pc_ipv4,
            lookup_public_ipv4,
            netcheck::begin_pc_link,
            netcheck::halt_pc_link,
            netcheck::open_pc_setting,
            printcheck::begin_pc_print,
            printcheck::carry_pc_print,
            printcheck::halt_pc_print,
            printcheck::open_print_view,
            latest_release_tag,
            knowledge_sign::verified_knowledge,
            knowledge_sign::refresh_verified_knowledge,
            scan_ipv4_range,
            scan_cctv_range,
            halt_range_check,
            find_user_folder_names,
            halt_user_folder_find,
            list_pc_url_shortcuts
        ])
        .setup(|app| {
            setup_tray(app)?;
            setup_window(app)?;
            setup_autostart(app);
            setup_edupack_association();
            setup_send_to_link();
            let _ = app.global_shortcut().register("Ctrl+Alt+E");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
