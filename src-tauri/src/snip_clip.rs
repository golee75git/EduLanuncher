use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use windows::core::w;
use windows::Win32::Foundation::{HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
};
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

const WATCH_LIMIT: Duration = Duration::from_secs(120);
const MAX_BYTES: usize = 40 * 1024 * 1024;
const CF_DIB: u32 = 8;

pub struct SnipGate(pub Mutex<SnipHold>);

pub struct SnipHold {
    phase: Phase,
}

enum Phase {
    Idle,
    Watch { before: Option<u64>, until: Instant },
    Held { png: Vec<u8> },
}

impl Default for SnipHold {
    fn default() -> Self {
        Self { phase: Phase::Idle }
    }
}

#[tauri::command]
pub fn begin_screen_snip(gate: tauri::State<SnipGate>) -> Result<(), String> {
    let before = clipboard_mark();
    {
        let mut hold = lock(&gate);
        hold.phase = Phase::Watch {
            before,
            until: Instant::now() + WATCH_LIMIT,
        };
    }
    if let Err(err) = open_capture_tool() {
        lock(&gate).phase = Phase::Idle;
        return Err(err);
    }
    Ok(())
}

#[tauri::command]
pub fn poll_screen_snip(gate: tauri::State<SnipGate>) -> String {
    let mut hold = lock(&gate);
    match &hold.phase {
        Phase::Idle => "off".to_string(),
        Phase::Held { .. } => "ready".to_string(),
        Phase::Watch { until, .. } if Instant::now() > *until => {
            hold.phase = Phase::Idle;
            "off".to_string()
        }
        Phase::Watch { before, .. } => {
            let before = *before;
            drop(hold);
            let Some(png) = clipboard_png() else {
                return "wait".to_string();
            };
            let mark = mark_bytes(&png);
            if before == Some(mark) {
                return "wait".to_string();
            }
            let mut hold = lock(&gate);
            if matches!(hold.phase, Phase::Watch { .. }) {
                hold.phase = Phase::Held { png };
                "ready".to_string()
            } else {
                "off".to_string()
            }
        }
    }
}

#[tauri::command]
pub fn take_screen_snip(gate: tauri::State<SnipGate>, choice: String) -> Result<String, String> {
    let choice = choice.trim();
    let mut hold = lock(&gate);
    if choice == "drop" {
        hold.phase = Phase::Idle;
        return Ok(String::new());
    }
    let Phase::Held { png } = &hold.phase else {
        return Err("캡처한 그림이 없습니다.".into());
    };
    if choice != "shrink" && choice != "mask" {
        return Err("그림을 열 수 없습니다.".into());
    }
    let png = png.clone();
    let path = write_capture(&png)?;
    hold.phase = Phase::Idle;
    Ok(path)
}

pub fn open_capture_tool() -> Result<(), String> {
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

fn lock(gate: &SnipGate) -> std::sync::MutexGuard<'_, SnipHold> {
    gate.0.lock().unwrap_or_else(|err| err.into_inner())
}

fn clipboard_mark() -> Option<u64> {
    clipboard_png().map(|png| mark_bytes(&png))
}

fn clipboard_png() -> Option<Vec<u8>> {
    unsafe {
        if OpenClipboard(None).is_err() {
            return None;
        }
        let png = read_clipboard_png();
        let _ = CloseClipboard();
        png
    }
}

unsafe fn read_clipboard_png() -> Option<Vec<u8>> {
    let format = RegisterClipboardFormatW(w!("PNG"));
    if format != 0 {
        if let Ok(handle) = GetClipboardData(format as u32) {
            if let Some(bytes) = copy_global(handle) {
                if is_png(&bytes) && bytes.len() <= MAX_BYTES {
                    return Some(bytes);
                }
            }
        }
    }
    if let Ok(handle) = GetClipboardData(CF_DIB) {
        if let Some(dib) = copy_global(handle) {
            return dib_to_png(&dib);
        }
    }
    None
}

unsafe fn copy_global(handle: HANDLE) -> Option<Vec<u8>> {
    if handle.is_invalid() {
        return None;
    }
    let global = HGLOBAL(handle.0);
    let size = GlobalSize(global);
    if size < 16 || size > MAX_BYTES {
        return None;
    }
    let ptr = GlobalLock(global);
    if ptr.is_null() {
        return None;
    }
    let bytes = std::slice::from_raw_parts(ptr as *const u8, size).to_vec();
    let _ = GlobalUnlock(global);
    Some(bytes)
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
}

fn dib_to_png(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let header = u32::from_le_bytes(dib[0..4].try_into().ok()?) as usize;
    if header < 40 || dib.len() < header {
        return None;
    }
    let width = i32::from_le_bytes(dib[4..8].try_into().ok()?);
    let height_raw = i32::from_le_bytes(dib[8..12].try_into().ok()?);
    let planes = u16::from_le_bytes(dib[12..14].try_into().ok()?);
    let bits = u16::from_le_bytes(dib[14..16].try_into().ok()?);
    let compression = u32::from_le_bytes(dib[16..20].try_into().ok()?);
    if planes != 1 || compression != 0 || (bits != 24 && bits != 32) {
        return None;
    }
    if width < 2 || width > 16_000 {
        return None;
    }
    let top_down = height_raw < 0;
    let height = height_raw.unsigned_abs();
    if height < 2 || height > 16_000 {
        return None;
    }
    if u64::from(width as u32) * u64::from(height) > 40_000_000 {
        return None;
    }
    let row_bytes = (((width as u32) * u32::from(bits) + 31) / 32) * 4;
    let pixels = dib.get(header..)?;
    let need = row_bytes as usize * height as usize;
    if pixels.len() < need {
        return None;
    }
    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    for y in 0..height as usize {
        let src_y = if top_down { y } else { height as usize - 1 - y };
        let row = pixels.get(src_y * row_bytes as usize..)?;
        for x in 0..width as usize {
            let dest = (y * width as usize + x) * 4;
            if bits == 32 {
                let src = row.get(x * 4..x * 4 + 4)?;
                rgba[dest] = src[2];
                rgba[dest + 1] = src[1];
                rgba[dest + 2] = src[0];
                rgba[dest + 3] = 255;
            } else {
                let src = row.get(x * 3..x * 3 + 3)?;
                rgba[dest] = src[2];
                rgba[dest + 1] = src[1];
                rgba[dest + 2] = src[0];
                rgba[dest + 3] = 255;
            }
        }
    }
    encode_png(width as u32, height, &rgba)
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
        writer.finish().ok()?;
    }
    if png.len() > MAX_BYTES {
        return None;
    }
    Some(png)
}

fn mark_bytes(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    if hash == 0 {
        1
    } else {
        hash
    }
}

fn write_capture(png: &[u8]) -> Result<String, String> {
    if !is_png(png) || png.len() > MAX_BYTES {
        return Err("캡처한 그림을 열지 못했습니다.".into());
    }
    let dir = capture_dir()?;
    for index in 1..=99 {
        let name = if index == 1 {
            "캡처.png".to_string()
        } else {
            format!("캡처_{index}.png")
        };
        let path = dir.join(name);
        if path.exists() {
            continue;
        }
        let tmp = PathBuf::from(format!("{}.part", path.display()));
        if tmp.exists() {
            let _ = fs::remove_file(&tmp);
        }
        fs::write(&tmp, png).map_err(|_| "캡처한 그림을 저장하지 못했습니다.".to_string())?;
        if fs::rename(&tmp, &path).is_err() {
            let _ = fs::remove_file(&tmp);
            return Err("캡처한 그림을 저장하지 못했습니다.".into());
        }
        return path
            .to_str()
            .map(|text| text.to_string())
            .ok_or_else(|| "캡처한 그림을 저장하지 못했습니다.".to_string());
    }
    Err("캡처 그림이 너무 많습니다.".into())
}

fn capture_dir() -> Result<PathBuf, String> {
    let profile = std::env::var("USERPROFILE").map_err(|_| "그림 폴더를 찾지 못했습니다.".to_string())?;
    let root = Path::new(&profile);
    if !root.is_dir() {
        return Err("그림 폴더를 찾지 못했습니다.".into());
    }
    let dir = root.join("Pictures").join("Screenshots");
    fs::create_dir_all(&dir).map_err(|_| "그림 폴더를 만들지 못했습니다.".to_string())?;
    Ok(dir)
}
