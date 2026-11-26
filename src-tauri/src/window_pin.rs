//! 열려 있는 다른 창을 항상 위로 두고 되돌린다.
//! 창 핸들과 실행 파일 경로는 이 모듈 밖(화면)으로 넘기지 않고, 창 제목은 저장하지 않는다.

use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const CLOSED: &str = "창이 닫혔습니다.";
const HUNG: &str = "응답이 없는 창은 바꾸지 않습니다.";
const NOT_PINNED: &str = "이 창은 고정하지 못했습니다. 관리자 권한으로 실행한 창은 고정할 수 없습니다.";
const NOT_RELEASED: &str = "이 창은 해제하지 못했습니다. 관리자 권한으로 실행한 창은 바꿀 수 없습니다.";
const SOME_LEFT: &str = "일부 창은 해제하지 못했습니다.";
const WRONG_WINDOW: &str = "이 창에서는 바꿀 수 없습니다.";

const MAX_ROWS: usize = 60;
const MAX_TITLE: usize = 120;
/// 바탕화면과 작업 표시줄의 창 이름.
const SHELL_CLASSES: [&str; 4] = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

/// 목록에 넣을지 판단할 때 보는 창의 겉모습.
#[derive(Clone)]
pub struct WindowFace {
    pub visible: bool,
    /// 런처 자신의 창.
    pub own: bool,
    pub tool: bool,
    /// 작업 표시줄에 올리라고 표시한 창.
    pub app: bool,
    pub owned: bool,
    /// Windows가 숨겨 둔 창(다른 가상 데스크톱 등).
    pub cloaked: bool,
    pub class: String,
    pub title: String,
}

pub fn listable(face: &WindowFace) -> bool {
    face.visible
        && !face.own
        && !face.cloaked
        && !clip_title(&face.title).is_empty()
        && (face.app || (!face.tool && !face.owned))
        && !SHELL_CLASSES.contains(&face.class.as_str())
}

pub fn clip_title(raw: &str) -> String {
    let words: Vec<&str> = raw
        .split(|ch: char| ch.is_whitespace() || ch.is_control())
        .filter(|word| !word.is_empty())
        .collect();
    words.join(" ").chars().take(MAX_TITLE).collect()
}

const WORD_W: i32 = 72;
const WORD_H: i32 = 28;
/// 창을 따라가는 간격. Windows 타이머가 보통 한 프레임으로 지키는 값이다.
pub const FOLLOW_MS: u32 = 16;
/// 단추 배경. `COLORREF`는 0x00BBGGRR이다. 고정은 RGB(255, 140, 0), 해제는 RGB(80, 160, 255)이다.
pub fn word_fill_bgr(release: bool) -> u32 {
    if release { 0x00FF_A050 } else { 0x0000_8CFF }
}

pub fn word_for(state: PinState) -> &'static str {
    match state {
        PinState::Free => "고정",
        PinState::Ours | PinState::Other => "해제",
    }
}

/// 창 안쪽에 글자를 둘 자리. 패널과 겹치거나 창 밖으로 나가면 다른 모서리를 보고, 없으면 두지 않는다.
pub fn word_corner(
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    block: Option<(i32, i32, i32, i32)>,
) -> Option<(i32, i32)> {
    let spots = [
        (right - WORD_W - 8, top + 32),
        (left + 8, top + 32),
        (right - WORD_W - 8, top + 8),
        (left + 8, top + 8),
        (right - WORD_W - 8, bottom - WORD_H - 8),
        (left + 8, bottom - WORD_H - 8),
    ];
    spots.into_iter().find(|(x, y)| {
        *x >= left
            && *y >= top
            && *x + WORD_W <= right
            && *y + WORD_H <= bottom
            && !word_hits(*x, *y, block)
    })
}

fn word_hits(x: i32, y: i32, block: Option<(i32, i32, i32, i32)>) -> bool {
    let Some((left, top, right, bottom)) = block else {
        return false;
    };
    x < right && x + WORD_W > left && y < bottom && y + WORD_H > top
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PinState {
    Free,
    /// 런처가 항상 위로 둔 창.
    Ours,
    /// 다른 곳에서 항상 위로 둔 창.
    Other,
}

#[derive(Clone, Copy)]
pub struct Seen {
    pub hwnd: isize,
    pub pid: u32,
    pub topmost: bool,
}

struct Entry {
    id: String,
    hwnd: isize,
    pid: u32,
    ours: bool,
}

#[derive(Default)]
struct Held {
    next: u64,
    entries: Vec<Entry>,
}

/// 화면에 넘긴 id와 실제 창을 잇는 장부. 메모리에만 둔다.
/// 잠금을 쥔 채 다른 창에 메시지를 보내는 호출(SetWindowPos 등)을 하지 않는다.
#[derive(Default)]
pub struct PinBook(Mutex<Held>);

impl PinBook {
    pub fn new() -> Self {
        Self::default()
    }

    fn held(&self) -> MutexGuard<'_, Held> {
        self.0.lock().unwrap_or_else(|broken| broken.into_inner())
    }

    /// 새로 읽은 창 목록에 맞춘다. `alive`는 같은 프로세스의 창이 남아 있으면 항상 위 여부를 준다.
    /// 반환 순서는 `listed`와 같다.
    pub fn reconcile(
        &self,
        listed: &[Seen],
        alive: impl Fn(isize, u32) -> Option<bool>,
    ) -> Vec<(String, PinState)> {
        let mut held = self.held();
        let mut before = std::mem::take(&mut held.entries);
        let mut rows = Vec::with_capacity(listed.len());
        for window in listed {
            let found = before
                .iter()
                .position(|entry| entry.hwnd == window.hwnd && entry.pid == window.pid);
            let mut entry = match found {
                Some(index) => before.swap_remove(index),
                None => {
                    held.next += 1;
                    Entry {
                        id: format!("w{}", held.next),
                        hwnd: window.hwnd,
                        pid: window.pid,
                        ours: false,
                    }
                }
            };
            entry.ours &= window.topmost;
            let state = if entry.ours {
                PinState::Ours
            } else if window.topmost {
                PinState::Other
            } else {
                PinState::Free
            };
            rows.push((entry.id.clone(), state));
            held.entries.push(entry);
        }
        // 트레이나 다른 가상 데스크톱으로 숨은 우리 고정 창은 나중에 풀 수 있게 남긴다.
        held.entries.extend(
            before
                .into_iter()
                .filter(|entry| entry.ours && alive(entry.hwnd, entry.pid) == Some(true)),
        );
        rows
    }

    pub fn target(&self, id: &str) -> Option<(isize, u32)> {
        self.held()
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| (entry.hwnd, entry.pid))
    }

    pub fn mark(&self, id: &str, ours: bool) {
        if let Some(entry) = self.held().entries.iter_mut().find(|entry| entry.id == id) {
            entry.ours = ours;
        }
    }

    pub fn ours(&self) -> Vec<(isize, u32)> {
        self.held()
            .entries
            .iter()
            .filter(|entry| entry.ours)
            .map(|entry| (entry.hwnd, entry.pid))
            .collect()
    }

    fn disown(&self, hwnd: isize, pid: u32) {
        for entry in self.held().entries.iter_mut() {
            if entry.hwnd == hwnd && entry.pid == pid {
                entry.ours = false;
            }
        }
    }

    pub fn holding_with(&self, alive: impl Fn(isize, u32) -> Option<bool>) -> bool {
        self.ours()
            .into_iter()
            .any(|(hwnd, pid)| alive(hwnd, pid) == Some(true))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinRow {
    id: String,
    title: String,
    app: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_image: Option<String>,
    state: PinState,
}

#[derive(Serialize)]
pub struct PinBoard {
    rows: Vec<PinRow>,
    /// 목록에 보이지 않는 창까지 포함해, 런처가 고정한 창이 남아 있는지.
    holding: bool,
}

#[tauri::command]
pub fn list_pin_windows(
    app: AppHandle,
    window: WebviewWindow,
    book: State<'_, PinBook>,
) -> Result<PinBoard, String> {
    if window.label() != "main" {
        return Err(WRONG_WINDOW.into());
    }
    let board = native::board(&book);
    crate::hold_panel_above(&app);
    Ok(board)
}

#[tauri::command(async)]
pub fn set_window_pin(
    app: AppHandle,
    window: WebviewWindow,
    book: State<'_, PinBook>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err(WRONG_WINDOW.into());
    }
    let done = native::apply_pin(&book, &id, pinned);
    crate::hold_panel_above(&app);
    done
}

#[tauri::command(async)]
pub fn release_window_pins(
    app: AppHandle,
    window: WebviewWindow,
    book: State<'_, PinBook>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err(WRONG_WINDOW.into());
    }
    let done = native::release_ours(&book);
    crate::hold_panel_above(&app);
    done
}

#[tauri::command]
pub fn place_pin_words(
    app: AppHandle,
    window: WebviewWindow,
    book: State<'_, PinBook>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err(WRONG_WINDOW.into());
    }
    native::remember_host(&app);
    let avoid = native::panel_box(&window);
    let owner = native::panel_raw(&window);
    let spots = native::word_spots(&book, avoid);
    let token = native::bump_wave();
    app.run_on_main_thread(move || {
        if native::wave_is(token) {
            native::show_words(owner, spots);
        }
    })
    .map_err(|_| "떠 있는 창에 글자를 두지 못했습니다.".to_string())
}

#[tauri::command]
pub fn clear_pin_words(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err(WRONG_WINDOW.into());
    }
    dismiss_pin_words(&app);
    Ok(())
}

pub fn dismiss_pin_words(app: &AppHandle) {
    let token = native::bump_wave();
    let app = app.clone();
    let _ = app.run_on_main_thread(move || {
        if native::wave_is(token) {
            native::drop_words();
        }
    });
}

pub fn dismiss_pin_words_now() {
    let _ = native::bump_wave();
    native::drop_words();
}

#[cfg(windows)]
mod native {
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::path::PathBuf;

    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, CreateWindowExW, DefWindowProcW, DestroyWindow, EnumWindows, GetClassNameW,
        GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
        IsHungAppWindow, IsIconic, IsWindow, IsWindowVisible, SetWindowLongPtrW, SetWindowPos,
        GetClientRect, KillTimer, SetTimer, SetWindowTextW, ShowWindow, GWL_EXSTYLE, GW_OWNER,
        GWLP_WNDPROC, HWND_NOTOPMOST, HWND_TOPMOST, MA_NOACTIVATE, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, SW_RESTORE, WM_ERASEBKGND, WM_LBUTTONUP,
        WM_MOUSEACTIVATE, WM_PAINT, WNDPROC, WS_EX_APPWINDOW,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
    };
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateSolidBrush, DrawTextW, EndPaint, FillRect, GetStockObject, InvalidateRect,
        SelectObject, SetBkMode, SetTextColor, DEFAULT_GUI_FONT, DT_CENTER, DT_SINGLELINE, DT_VCENTER,
        HBRUSH, PAINTSTRUCT, TRANSPARENT,
    };

    use super::*;

    fn handle(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }

    pub fn is_topmost(raw: isize) -> bool {
        let style = unsafe { GetWindowLongPtrW(handle(raw), GWL_EXSTYLE) };
        style & WS_EX_TOPMOST.0 as isize != 0
    }

    pub fn alive(raw: isize, pid: u32) -> Option<bool> {
        let hwnd = handle(raw);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return None;
        }
        let mut owner = 0_u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner)) };
        (owner == pid).then(|| is_topmost(raw))
    }

    /// 위치와 크기, 초점은 바꾸지 않는다. `wait`이면 실제로 적용됐는지까지 확인한다.
    pub fn set_topmost(raw: isize, on: bool, wait: bool) -> bool {
        let mut flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
        if !wait {
            flags |= SWP_ASYNCWINDOWPOS;
        }
        let place = |band| unsafe { SetWindowPos(handle(raw), Some(band), 0, 0, 0, 0, flags) }.is_ok();
        let mut sent = place(if on { HWND_TOPMOST } else { HWND_NOTOPMOST });
        if sent && wait && on && !is_topmost(raw) {
            // Windows가 성공으로 답하고도 올리지 않을 때가 있다. 한 번 내렸다가 다시 올리면 적용된다.
            sent = place(HWND_NOTOPMOST) && place(HWND_TOPMOST);
        }
        sent && (!wait || is_topmost(raw) == on)
    }

    /// 이미 항상 위인 창들 가운데 맨 앞으로 올린다.
    pub fn raise(raw: isize) {
        let _ = set_topmost(raw, true, false);
    }

    impl PinBook {
        /// 우리가 고정한 창 가운데 아직 남아 있는 것이 있는지.
        pub fn holding(&self) -> bool {
            self.holding_with(alive)
        }
    }

    /// 런처가 끝날 때 부른다. 응답 없는 창 때문에 종료가 멈추지 않게 기다리지 않는다.
    pub fn release_all_on_exit(book: &PinBook) {
        for (raw, pid) in book.ours() {
            if alive(raw, pid) == Some(true) {
                let _ = set_topmost(raw, false, false);
            }
        }
    }

    fn hung(raw: isize) -> bool {
        unsafe { IsHungAppWindow(handle(raw)) }.as_bool()
    }

    pub fn apply_pin(book: &PinBook, id: &str, pinned: bool) -> Result<(), String> {
        let (raw, pid) = book.target(id).ok_or(CLOSED)?;
        let Some(was_topmost) = alive(raw, pid) else {
            return Err(CLOSED.into());
        };
        if hung(raw) {
            return Err(HUNG.into());
        }
        if pinned && unsafe { IsIconic(handle(raw)) }.as_bool() {
            // 최대화했다가 줄인 창은 최대화로 돌아온다. 응답 없는 창은 위에서 걸렀으므로 끝날 때까지 기다린다.
            let _ = unsafe { ShowWindow(handle(raw), SW_RESTORE) };
        }
        if !set_topmost(raw, pinned, true) {
            return Err(if pinned { NOT_PINNED } else { NOT_RELEASED }.into());
        }
        // 이미 다른 곳에서 항상 위였던 창은 우리 것으로 가져오지 않는다.
        if !(pinned && was_topmost) {
            book.mark(id, pinned);
        }
        Ok(())
    }

    pub fn release_ours(book: &PinBook) -> Result<(), String> {
        let mut left = false;
        for (raw, pid) in book.ours() {
            if alive(raw, pid) != Some(true) {
                book.disown(raw, pid);
            } else if !hung(raw) && set_topmost(raw, false, true) {
                book.disown(raw, pid);
            } else {
                left = true;
            }
        }
        if left {
            Err(SOME_LEFT.into())
        } else {
            Ok(())
        }
    }

    unsafe extern "system" fn take_window(hwnd: HWND, param: LPARAM) -> BOOL {
        if let Some(found) = (param.0 as *mut Vec<isize>).as_mut() {
            found.push(hwnd.0 as isize);
        }
        true.into()
    }

    /// 목록 대상이면 겉모습과 프로세스 번호를 준다. 런처 자신의 창은 제목도 읽지 않는다.
    fn look(raw: isize) -> Option<(WindowFace, u32)> {
        let hwnd = handle(raw);
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return None;
        }
        let mut pid = 0_u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
        let owned = unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|owner| !owner.is_invalid());
        let mut cloaked = 0_u32;
        let asked = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut c_void,
                size_of::<u32>() as u32,
            )
        };
        let mut class = [0_u16; 128];
        let class_len = unsafe { GetClassNameW(hwnd, &mut class) }.max(0) as usize;
        // 다른 프로세스 창의 제목은 그 창에 메시지를 보내지 않고 읽는다.
        let mut title = [0_u16; 512];
        let title_len = unsafe { GetWindowTextW(hwnd, &mut title) }.max(0) as usize;
        let face = WindowFace {
            visible: true,
            own: false,
            tool: style & WS_EX_TOOLWINDOW.0 as isize != 0,
            app: style & WS_EX_APPWINDOW.0 as isize != 0,
            owned,
            cloaked: asked.is_ok() && cloaked != 0,
            class: String::from_utf16_lossy(&class[..class_len]),
            title: String::from_utf16_lossy(&title[..title_len]),
        };
        listable(&face).then_some((face, pid))
    }

    fn program_path(pid: u32) -> Option<PathBuf> {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buffer = [0_u16; 1024];
        let mut length = buffer.len() as u32;
        let asked = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        };
        let _ = unsafe { CloseHandle(process) };
        asked.ok()?;
        Some(PathBuf::from(String::from_utf16_lossy(&buffer[..length as usize])))
    }

    fn program_name(path: Option<&PathBuf>) -> String {
        match path.and_then(|path| path.file_stem()).and_then(|name| name.to_str()) {
            Some("ApplicationFrameHost") => "Windows 앱".to_string(),
            Some(name) => clip_title(name),
            None => "알 수 없는 프로그램".to_string(),
        }
    }

    pub fn board(book: &PinBook) -> PinBoard {
        let mut found: Vec<isize> = Vec::new();
        let _ = unsafe {
            EnumWindows(Some(take_window), LPARAM(&mut found as *mut Vec<isize> as isize))
        };
        let mut seen = Vec::new();
        let mut titles = Vec::new();
        for raw in found {
            if seen.len() >= MAX_ROWS {
                break;
            }
            if let Some((face, pid)) = look(raw) {
                seen.push(Seen { hwnd: raw, pid, topmost: is_topmost(raw) });
                titles.push(clip_title(&face.title));
            }
        }
        let states = book.reconcile(&seen, alive);
        let mut icons: HashMap<PathBuf, Option<String>> = HashMap::new();
        let rows = states
            .into_iter()
            .zip(seen)
            .zip(titles)
            .map(|(((id, state), window), title)| {
                let path = program_path(window.pid);
                // 네트워크 위치의 실행 파일은 아이콘을 읽지 않는다.
                let icon_image = path
                    .as_ref()
                    .filter(|path| !path.to_string_lossy().starts_with("\\\\"))
                    .and_then(|path| {
                        icons
                            .entry(path.clone())
                            .or_insert_with(|| crate::shell_icon::png_data_url(path))
                            .clone()
                    });
                PinRow { id, title, app: program_name(path.as_ref()), icon_image, state }
            })
            .collect();
        PinBoard { rows, holding: book.holding() }
    }

    use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};

    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::COLORREF;

    const FOLLOW_ID: usize = 1;

    static HOST: OnceLock<AppHandle> = OnceLock::new();
    static WAVE: AtomicU64 = AtomicU64::new(0);
    static BUSY: AtomicBool = AtomicBool::new(false);
    static OWNER: AtomicIsize = AtomicIsize::new(0);
    static FOLLOW_HWND: AtomicIsize = AtomicIsize::new(0);
    static FILL: AtomicIsize = AtomicIsize::new(0);
    static RELEASE_FILL: AtomicIsize = AtomicIsize::new(0);
    static WORDS: Mutex<WordBook> = Mutex::new(WordBook { base: 0, rows: Vec::new() });

    struct WordBook {
        base: isize,
        rows: Vec<WordChip>,
    }

    #[derive(Clone)]
    struct WordChip {
        hwnd: isize,
        id: String,
        pin_on: bool,
        target: isize,
        x: i32,
        y: i32,
        shown: bool,
    }

    #[derive(Clone)]
    pub(super) struct WordSpot {
        id: String,
        pin_on: bool,
        word: String,
        target: isize,
        x: i32,
        y: i32,
    }

    pub fn remember_host(app: &AppHandle) {
        let _ = HOST.set(app.clone());
    }

    pub fn bump_wave() -> u64 {
        WAVE.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn wave_is(token: u64) -> bool {
        WAVE.load(Ordering::SeqCst) == token
    }

    pub fn panel_raw(window: &WebviewWindow) -> isize {
        panel_hwnd(window).map(|hwnd| hwnd.0 as isize).unwrap_or(0)
    }

    pub fn panel_box(window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
        let hwnd = panel_hwnd(window)?;
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
        Some((rect.left, rect.top, rect.right, rect.bottom))
    }

    fn panel_hwnd(window: &WebviewWindow) -> Option<HWND> {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let handle = window.window_handle().ok()?;
        match handle.as_raw() {
            RawWindowHandle::Win32(raw) => Some(HWND(raw.hwnd.get() as *mut c_void)),
            _ => None,
        }
    }

    pub fn word_spots(book: &PinBook, avoid: Option<(i32, i32, i32, i32)>) -> Vec<WordSpot> {
        let mut found: Vec<isize> = Vec::new();
        let _ = unsafe { EnumWindows(Some(take_window), LPARAM(&mut found as *mut Vec<isize> as isize)) };
        let mut seen = Vec::new();
        let mut corners = Vec::new();
        for raw in found {
            if seen.len() >= MAX_ROWS {
                break;
            }
            let Some((_, pid)) = look(raw) else {
                continue;
            };
            let iconic = unsafe { IsIconic(handle(raw)) }.as_bool();
            let mut rect = RECT::default();
            let corner = if iconic || unsafe { GetWindowRect(handle(raw), &mut rect) }.is_err() {
                None
            } else {
                word_corner(rect.left, rect.top, rect.right, rect.bottom, avoid)
            };
            seen.push(Seen { hwnd: raw, pid, topmost: is_topmost(raw) });
            corners.push(corner);
        }
        book.reconcile(&seen, alive)
            .into_iter()
            .zip(seen)
            .zip(corners)
            .filter_map(|(((id, state), window), corner)| {
                let (x, y) = corner?;
                Some(WordSpot {
                    id,
                    pin_on: state == PinState::Free,
                    word: word_for(state).to_string(),
                    target: window.hwnd,
                    x,
                    y,
                })
            })
            .collect()
    }

    fn lock_words() -> MutexGuard<'static, WordBook> {
        WORDS.lock().unwrap_or_else(|broken| broken.into_inner())
    }

    pub fn show_words(owner: isize, spots: Vec<WordSpot>) {
        disarm_follow();
        OWNER.store(owner, Ordering::SeqCst);
        let existing = lock_words().rows.clone();
        let mut kept = Vec::new();
        let mut made = Vec::new();
        for spot in spots {
            if let Some(chip) = existing.iter().find(|chip| chip.id == spot.id) {
                kept.push((chip.hwnd, spot));
            } else {
                made.push(spot);
            }
        }
        let kept_hwnds: Vec<isize> = kept.iter().map(|(hwnd, _)| *hwnd).collect();
        let gone: Vec<isize> = existing
            .iter()
            .filter(|chip| !kept_hwnds.contains(&chip.hwnd))
            .map(|chip| chip.hwnd)
            .collect();
        {
            let mut book = lock_words();
            book.rows.retain(|chip| kept_hwnds.contains(&chip.hwnd));
            for (hwnd, spot) in &kept {
                if let Some(row) = book.rows.iter_mut().find(|chip| chip.hwnd == *hwnd) {
                    row.pin_on = spot.pin_on;
                    row.target = spot.target;
                    row.x = spot.x;
                    row.y = spot.y;
                    row.shown = true;
                }
            }
        }
        for hwnd in gone {
            let _ = unsafe { DestroyWindow(handle(hwnd)) };
        }
        for (hwnd, spot) in &kept {
            write_word(*hwnd, &spot.word);
            move_word(*hwnd, spot.x, spot.y);
        }
        for spot in made {
            if let Some(hwnd) = open_word(owner, &spot) {
                lock_words().rows.push(WordChip {
                    hwnd,
                    id: spot.id,
                    pin_on: spot.pin_on,
                    target: spot.target,
                    x: spot.x,
                    y: spot.y,
                    shown: true,
                });
            }
        }
        arm_follow();
    }

    pub fn drop_words() {
        disarm_follow();
        OWNER.store(0, Ordering::SeqCst);
        let rows = std::mem::take(&mut lock_words().rows);
        for chip in rows {
            let _ = unsafe { DestroyWindow(handle(chip.hwnd)) };
        }
    }

    fn open_word(owner: isize, spot: &WordSpot) -> Option<isize> {
        let wide = utf16(&spot.word);
        let parent = (owner != 0).then(|| handle(owner));
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                w!("BUTTON"),
                PCWSTR(wide.as_ptr()),
                WS_POPUP | WS_VISIBLE,
                spot.x,
                spot.y,
                WORD_W,
                WORD_H,
                parent,
                None,
                None,
                None,
            )
        }
        .ok()?;
        hook_word(hwnd);
        move_word(hwnd.0 as isize, spot.x, spot.y);
        Some(hwnd.0 as isize)
    }

    fn hook_word(hwnd: HWND) {
        let prev = unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, word_proc as *const () as isize) };
        let mut book = lock_words();
        if book.base == 0 && prev != 0 {
            book.base = prev;
        }
    }

    fn write_word(raw: isize, word: &str) {
        let wide = utf16(word);
        let hwnd = handle(raw);
        let _ = unsafe { SetWindowTextW(hwnd, PCWSTR(wide.as_ptr())) };
        let _ = unsafe { InvalidateRect(Some(hwnd), None, false) };
    }

    fn window_box(raw: isize) -> Option<(i32, i32, i32, i32)> {
        if raw == 0 {
            return None;
        }
        let mut rect = RECT::default();
        unsafe { GetWindowRect(handle(raw), &mut rect) }.ok()?;
        Some((rect.left, rect.top, rect.right, rect.bottom))
    }

    fn arm_follow() {
        disarm_follow();
        let hwnd = lock_words().rows.first().map(|chip| chip.hwnd).unwrap_or(0);
        if hwnd == 0 {
            return;
        }
        let id = unsafe { SetTimer(Some(handle(hwnd)), FOLLOW_ID, FOLLOW_MS, Some(follow_tick)) };
        if id != 0 {
            FOLLOW_HWND.store(hwnd, Ordering::SeqCst);
        }
    }

    fn disarm_follow() {
        let hwnd = FOLLOW_HWND.swap(0, Ordering::SeqCst);
        if hwnd != 0 {
            let _ = unsafe { KillTimer(Some(handle(hwnd)), FOLLOW_ID) };
        }
    }

    unsafe extern "system" fn follow_tick(_hwnd: HWND, _msg: u32, _id: usize, _time: u32) {
        slide_words();
    }

    fn slide_words() {
        let avoid = window_box(OWNER.load(Ordering::SeqCst));
        let chips = lock_words().rows.clone();
        let mut moved = Vec::new();
        for mut chip in chips {
            let target = handle(chip.target);
            let alive = unsafe { IsWindow(Some(target)) }.as_bool();
            let iconic = alive && unsafe { IsIconic(target) }.as_bool();
            let mut rect = RECT::default();
            let corner = if !alive || iconic || unsafe { GetWindowRect(target, &mut rect) }.is_err() {
                None
            } else {
                word_corner(rect.left, rect.top, rect.right, rect.bottom, avoid)
            };
            match corner {
                Some((x, y)) => {
                    if !chip.shown || chip.x != x || chip.y != y {
                        move_word(chip.hwnd, x, y);
                        chip.x = x;
                        chip.y = y;
                        chip.shown = true;
                    }
                }
                None if chip.shown => {
                    let _ = unsafe { ShowWindow(handle(chip.hwnd), SW_HIDE) };
                    chip.shown = false;
                }
                None => {}
            }
            moved.push(chip);
        }
        let mut book = lock_words();
        for fresh in moved {
            if let Some(row) = book.rows.iter_mut().find(|row| row.hwnd == fresh.hwnd) {
                row.x = fresh.x;
                row.y = fresh.y;
                row.shown = fresh.shown;
            }
        }
    }

    fn fill_brush(release: bool) -> HBRUSH {
        let slot = if release { &RELEASE_FILL } else { &FILL };
        let raw = slot.load(Ordering::SeqCst);
        if raw != 0 {
            return HBRUSH(raw as *mut c_void);
        }
        let brush = unsafe { CreateSolidBrush(COLORREF(word_fill_bgr(release))) };
        slot.store(brush.0 as isize, Ordering::SeqCst);
        brush
    }

    fn paint_word(hwnd: HWND) {
        let mut paint = PAINTSTRUCT::default();
        let dc = unsafe { BeginPaint(hwnd, &mut paint) };
        if dc.is_invalid() {
            return;
        }
        let mut rect = RECT::default();
        let _ = unsafe { GetClientRect(hwnd, &mut rect) };
        let mut wide = [0_u16; 8];
        let len = unsafe { GetWindowTextW(hwnd, &mut wide) }.max(0) as usize;
        let release = String::from_utf16_lossy(&wide[..len.min(wide.len())]) == "해제";
        unsafe {
            let _ = FillRect(dc, &rect, fill_brush(release));
            let _ = SetBkMode(dc, TRANSPARENT);
            let _ = SetTextColor(dc, COLORREF(0));
            let old = SelectObject(dc, GetStockObject(DEFAULT_GUI_FONT));
            let _ = DrawTextW(
                dc,
                &mut wide[..len],
                &mut rect,
                DT_CENTER | DT_VCENTER | DT_SINGLELINE,
            );
            if !old.is_invalid() {
                SelectObject(dc, old);
            }
            let _ = EndPaint(hwnd, &paint);
        }
    }

    fn move_word(raw: isize, x: i32, y: i32) {
        let _ = unsafe {
            SetWindowPos(
                handle(raw),
                Some(HWND_TOPMOST),
                x,
                y,
                WORD_W,
                WORD_H,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        };
    }

    fn utf16(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn word_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_ERASEBKGND {
            return LRESULT(1);
        }
        if msg == WM_PAINT {
            paint_word(hwnd);
            return LRESULT(0);
        }
        if msg == WM_MOUSEACTIVATE {
            return LRESULT(MA_NOACTIVATE as isize);
        }
        if msg == WM_LBUTTONUP {
            let job = click_job(hwnd.0 as isize);
            let drawn = call_word_base(hwnd, msg, wparam, lparam);
            if let Some((id, pin_on)) = job {
                press_word(id, pin_on);
            }
            return drawn;
        }
        call_word_base(hwnd, msg, wparam, lparam)
    }

    fn click_job(raw: isize) -> Option<(String, bool)> {
        lock_words()
            .rows
            .iter()
            .find(|chip| chip.hwnd == raw)
            .map(|chip| (chip.id.clone(), chip.pin_on))
    }

    fn press_word(id: String, pin_on: bool) {
        if BUSY.swap(true, Ordering::SeqCst) {
            return;
        }
        let note = if let Some(app) = HOST.get() {
            let book = app.state::<PinBook>();
            let result = apply_pin(&book, &id, pin_on);
            crate::hold_panel_above(app);
            match result {
                Ok(()) => String::new(),
                Err(text) => text,
            }
        } else {
            String::new()
        };
        if let Some(app) = HOST.get() {
            let _ = app.emit_to("main", "pin-words-changed", note);
        }
        BUSY.store(false, Ordering::SeqCst);
    }

    fn call_word_base(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let base = lock_words().base;
        if base == 0 {
            return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
        }
        let prev = unsafe { std::mem::transmute::<isize, WNDPROC>(base) };
        unsafe { CallWindowProcW(prev, hwnd, msg, wparam, lparam) }
    }
}

#[cfg(not(windows))]
mod native {
    use super::*;

    const ONLY_HERE: &str = "이 PC에서만 바꿉니다.";

    impl PinBook {
        pub fn holding(&self) -> bool {
            false
        }
    }

    pub fn raise(_raw: isize) {}

    pub fn release_all_on_exit(_book: &PinBook) {}

    pub fn apply_pin(_book: &PinBook, _id: &str, _pinned: bool) -> Result<(), String> {
        Err(ONLY_HERE.into())
    }

    pub fn release_ours(_book: &PinBook) -> Result<(), String> {
        Err(ONLY_HERE.into())
    }

    pub fn board(_book: &PinBook) -> PinBoard {
        PinBoard { rows: Vec::new(), holding: false }
    }

    pub fn remember_host(_app: &AppHandle) {}

    pub fn bump_wave() -> u64 {
        0
    }

    pub fn wave_is(_token: u64) -> bool {
        true
    }

    pub fn panel_raw(_window: &WebviewWindow) -> isize {
        0
    }

    pub fn panel_box(_window: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
        None
    }

    pub fn word_spots(_book: &PinBook, _avoid: Option<(i32, i32, i32, i32)>) -> Vec<()> {
        Vec::new()
    }

    pub fn show_words(_owner: isize, _spots: Vec<()>) {}

    pub fn drop_words() {}
}

pub use native::{raise, release_all_on_exit};
#[cfg(all(test, windows))]
use native::{apply_pin, is_topmost, release_ours, set_topmost};

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows::core::w;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, IsIconic, ShowWindow, SW_SHOWMINNOACTIVE, WS_EX_TOOLWINDOW, WS_OVERLAPPED,
    };

    fn face() -> WindowFace {
        WindowFace {
            visible: true,
            own: false,
            tool: false,
            app: false,
            owned: false,
            cloaked: false,
            class: "Chrome_WidgetWin_1".into(),
            title: "원격연수 강의실".into(),
        }
    }

    fn seen(hwnd: isize, pid: u32, topmost: bool) -> Seen {
        Seen { hwnd, pid, topmost }
    }

    fn first_id(book: &PinBook, hwnd: isize, pid: u32) -> String {
        book.reconcile(&[seen(hwnd, pid, false)], |_, _| Some(false))[0].0.clone()
    }

    #[test]
    fn listable_rules() {
        assert!(listable(&face()));
        assert!(!listable(&WindowFace { visible: false, ..face() }));
        assert!(!listable(&WindowFace { own: true, ..face() }));
        assert!(!listable(&WindowFace { cloaked: true, ..face() }));
        assert!(!listable(&WindowFace { title: "  ".into(), ..face() }));
        assert!(!listable(&WindowFace { tool: true, ..face() }));
        assert!(!listable(&WindowFace { owned: true, ..face() }));
        assert!(listable(&WindowFace { owned: true, app: true, ..face() }));
        assert!(listable(&WindowFace { tool: true, app: true, ..face() }));
        for class in ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"] {
            assert!(!listable(&WindowFace { class: class.into(), ..face() }), "{class}");
        }
    }

    #[test]
    fn title_is_clipped() {
        assert_eq!(clip_title("  강의\r\n창\t "), "강의 창");
        assert_eq!(clip_title(&"가".repeat(200)).chars().count(), 120);
    }

    #[test]
    fn word_names_match_the_list() {
        assert_eq!(word_for(PinState::Free), "고정");
        assert_eq!(word_for(PinState::Ours), "해제");
        assert_eq!(word_for(PinState::Other), "해제");
    }

    #[test]
    fn word_stays_inside_and_off_the_panel() {
        assert_eq!(word_corner(100, 100, 500, 400, None), Some((420, 132)));
        assert_eq!(word_corner(100, 100, 500, 400, Some((400, 100, 520, 200))), Some((108, 132)));
        assert_eq!(word_corner(0, 0, 200, 200, Some((-10, -10, 400, 400))), None);
        assert_eq!(word_corner(0, 0, 40, 20, None), None);
    }

    #[test]
    fn follow_interval_is_one_frame() {
        assert_eq!(FOLLOW_MS, 16);
    }

    #[test]
    fn word_fill_matches_the_word() {
        assert_eq!(word_fill_bgr(false), 0x0000_8CFF);
        assert_eq!(word_fill_bgr(true), 0x00FF_A050);
    }

    #[test]
    fn ids_survive_and_pid_reuse_gets_new_id() {
        let book = PinBook::new();
        let first = first_id(&book, 10, 1);
        assert_eq!(first_id(&book, 10, 1), first);
        let reused = first_id(&book, 10, 2);
        assert_ne!(reused, first);
        assert_eq!(book.target(&first), None);
        assert_eq!(book.target(&reused), Some((10, 2)));
    }

    #[test]
    fn hidden_pinned_window_stays_in_book() {
        let book = PinBook::new();
        let id = first_id(&book, 10, 1);
        book.mark(&id, true);
        assert!(book.reconcile(&[], |_, _| Some(true)).is_empty());
        assert_eq!(book.ours(), vec![(10, 1)]);
        assert_eq!(book.target(&id), Some((10, 1)));
        let back = book.reconcile(&[seen(10, 1, true)], |_, _| Some(true));
        assert_eq!(back, vec![(id, PinState::Ours)]);
    }

    #[test]
    fn outside_release_drops_ownership() {
        let book = PinBook::new();
        let id = first_id(&book, 10, 1);
        book.mark(&id, true);
        let freed = book.reconcile(&[seen(10, 1, false)], |_, _| Some(false));
        assert_eq!(freed, vec![(id.clone(), PinState::Free)]);
        assert!(book.ours().is_empty());
        let outside = book.reconcile(&[seen(10, 1, true)], |_, _| Some(true));
        assert_eq!(outside, vec![(id, PinState::Other)]);
    }

    #[test]
    fn closed_pinned_window_stops_holding() {
        let book = PinBook::new();
        let id = first_id(&book, 10, 1);
        assert!(!book.holding_with(|_, _| Some(true)));
        book.mark(&id, true);
        assert!(book.holding_with(|_, _| Some(true)));
        assert!(!book.holding_with(|_, _| Some(false)));
        assert!(!book.holding_with(|_, _| None));
        book.reconcile(&[], |_, _| None);
        assert!(book.ours().is_empty());
    }

    /// 이 시험 소유의 보조 창으로 실제 Windows 호출을 확인한다.
    #[test]
    fn real_window_pins_and_releases() {
        let hwnd = tool_window();
        let raw = hwnd.0 as isize;
        assert!(set_topmost(raw, true, true));
        assert!(is_topmost(raw));
        assert!(set_topmost(raw, false, true));
        assert!(!is_topmost(raw));

        let book = PinBook::new();
        let id = first_id(&book, raw, std::process::id());
        assert!(set_topmost(raw, true, true));
        book.mark(&id, true);
        assert!(book.holding());
        release_all_on_exit(&book);
        assert!(!is_topmost(raw));
        assert!(!book.holding());

        unsafe { DestroyWindow(hwnd) }.expect("시험 창 닫기");
        assert!(!set_topmost(raw, true, true));
    }

    fn tool_window() -> HWND {
        unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("pin-test"),
                WS_OVERLAPPED,
                0,
                0,
                10,
                10,
                None,
                None,
                None,
                None,
            )
        }
        .expect("시험 창")
    }

    #[test]
    fn pin_and_release_by_id() {
        let hwnd = tool_window();
        let raw = hwnd.0 as isize;
        let book = PinBook::new();
        assert_eq!(apply_pin(&book, "w999", true), Err(CLOSED.to_string()));
        let id = first_id(&book, raw, std::process::id());

        let _ = unsafe { ShowWindow(hwnd, SW_SHOWMINNOACTIVE) };
        assert!(unsafe { IsIconic(hwnd) }.as_bool());
        assert_eq!(apply_pin(&book, &id, true), Ok(()));
        // 돌아오기 전에 복원이 끝나 있어야, 뒤이어 올리는 패널이 그 창에 덮이지 않는다.
        assert!(!unsafe { IsIconic(hwnd) }.as_bool());
        assert!(is_topmost(raw));
        assert_eq!(book.ours(), vec![(raw, std::process::id())]);

        assert_eq!(release_ours(&book), Ok(()));
        assert!(!is_topmost(raw));
        assert!(book.ours().is_empty());

        unsafe { DestroyWindow(hwnd) }.expect("시험 창 닫기");
        assert_eq!(apply_pin(&book, &id, true), Err(CLOSED.to_string()));
    }

    #[test]
    fn outside_pin_is_not_taken_over() {
        let hwnd = tool_window();
        let raw = hwnd.0 as isize;
        let book = PinBook::new();
        let id = first_id(&book, raw, std::process::id());
        assert!(set_topmost(raw, true, true));

        assert_eq!(apply_pin(&book, &id, true), Ok(()));
        assert!(book.ours().is_empty());
        assert_eq!(release_ours(&book), Ok(()));
        assert!(is_topmost(raw));

        assert_eq!(apply_pin(&book, &id, false), Ok(()));
        assert!(!is_topmost(raw));
        unsafe { DestroyWindow(hwnd) }.expect("시험 창 닫기");
    }
}
