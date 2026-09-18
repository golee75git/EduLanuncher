use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

mod netutil;
mod shortcut;
#[cfg(windows)]
mod drop_target;
#[cfg(windows)]
mod shell_icon;

#[cfg(windows)]
#[link(name = "shell32")]
extern "system" {
    fn SHChangeNotify(event: i32, flags: u32, item1: *const std::ffi::c_void, item2: *const std::ffi::c_void);
}

struct PanelState {
    position: Mutex<String>,
}

struct StartupPacks(Mutex<Vec<String>>);

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

fn reveal_panel(app: &AppHandle) {
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
        let _ = window.emit("focus-search", ());
        #[cfg(windows)]
        {
            let _ = drop_target::install(&window, app);
        }
    }
}

fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            reveal_panel(app);
        }
    }
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
    let portal = MenuItemBuilder::with_id("portal", "업무포털").build(app)?;
    let neis = MenuItemBuilder::with_id("neis", "나이스 바로가기").build(app)?;
    let edufine = MenuItemBuilder::with_id("edufine", "에듀파인 바로가기").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "설정").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "종료").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &sep1, &portal, &neis, &edufine, &sep2, &settings, &quit])
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("교육업무 런처")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => reveal_panel(app),
            "portal" => {
                reveal_panel(app);
                let _ = app.emit("launch-tool-id", "tool-portal");
            }
            "neis" => {
                reveal_panel(app);
                let _ = app.emit("launch-tool-id", "tool-neis");
            }
            "edufine" => {
                reveal_panel(app);
                let _ = app.emit("launch-tool-id", "tool-edufine");
            }
            "settings" => {
                reveal_panel(app);
                let _ = app.emit("open-settings", ());
            }
            "quit" => app.exit(0),
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
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_clone.hide();
        }
    });
    #[cfg(windows)]
    {
        let _ = drop_target::install(&window, app.handle());
        drop_target::install_later(app.handle().clone());
    }
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
    let _ = std::process::Command::new("reg")
        .args(["add", key, "/ve", "/t", "REG_SZ", "/d", data, "/f"])
        .status();
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

fn enable_login_item(exe: &std::path::Path) {
    let value = format!("\"{}\"", exe.display());
    let _ = std::process::Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "EduLauncher",
            "/t",
            "REG_SZ",
            "/d",
            &value,
            "/f",
        ])
        .status();
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
fn set_launcher_position(state: tauri::State<PanelState>, position: String) {
    if let Ok(mut current) = state.position.lock() {
        *current = position;
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
        "file" | "folder" => {
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
                std::process::Command::new(&target)
                    .spawn()
                    .map(|_| ())
                    .map_err(|err| err.to_string())
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

#[tauri::command]
fn take_startup_pack_paths(state: tauri::State<StartupPacks>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
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
    Ok(UrlShortcut {
        name: shortcut_display_name(&path, &url),
        url,
        icon_image: local_file_icon(&path),
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
fn scan_ipv4_range(start: String, end: String) -> Result<Vec<netutil::HostHit>, String> {
    netutil::scan_ipv4_range(&start, &end)
}

#[tauri::command]
fn scan_cctv_range(start: String, end: String) -> Result<Vec<netutil::HostHit>, String> {
    netutil::scan_cctv_range(&start, &end)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            reveal_panel(app);
            emit_pack_paths(app, &pack_paths_from(argv));
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
        .invoke_handler(tauri::generate_handler![
            hide_panel,
            show_panel,
            toggle_panel,
            set_launcher_position,
            register_shortcut,
            launch_tool,
            read_json_file,
            read_url_shortcut,
            dropped_path_info,
            write_json_file,
            write_csv_file,
            take_startup_pack_paths,
            this_pc_ipv4,
            lookup_public_ipv4,
            scan_ipv4_range,
            scan_cctv_range
        ])
        .setup(|app| {
            setup_tray(app)?;
            setup_window(app)?;
            setup_autostart(app);
            setup_edupack_association();
            let _ = app.global_shortcut().register("Ctrl+Alt+E");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
