//! 사진 위 가릴 영역 후보. 얼굴과 글자 후보는 이 PC의 Windows 기능으로만 찾는다.
//! 인식한 글자는 이 모듈 안에서만 쓰고, 명령 결과에는 좌표와 종류만 넣는다.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::path_grant;
use crate::privacy_scan::{find_patterns, FindingKind, Profile};
use crate::url_mark::picture_mime;

pub const TILE_OVERLAP: f64 = 0.20;
pub const FACE_PAD: f64 = 0.15;
pub const MERGE_IOU: f64 = 0.30;
pub const CONTAIN_RATIO: f64 = 0.60;
pub const FINE_SHORT_SIDE: u32 = 1600;
pub const FACE_FULL_LONG: u32 = 1600;
pub const FACE_TILE_LONG: u32 = 2000;
pub const FIND_LIMIT: Duration = Duration::from_secs(30);
const MAX_PIXELS: u64 = 40_000_000;
const MAX_READ_BYTES: u64 = 40 * 1024 * 1024;
const MAX_REGIONS: usize = 240;
const MIN_TILE: u32 = 64;
const MIN_FACE: u32 = 36;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PxRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NormBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug)]
pub struct WordBox {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Wish {
    pub face: bool,
    pub number: bool,
    pub plate: bool,
    pub text: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Availability {
    pub face: bool,
    pub text: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct FoundBox {
    pub kind: &'static str,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct StageMark {
    pub stage: &'static str,
    pub kind: &'static str,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindOutcome {
    pub regions: Vec<FoundBox>,
    pub stages: Vec<StageMark>,
    pub face_count: u32,
    pub number_count: u32,
    pub plate_count: u32,
    pub text_count: u32,
    pub face_available: bool,
    pub text_available: bool,
    pub partial: bool,
    pub partial_reason: String,
    pub elapsed_ms: u64,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct FindCaps {
    pub face: bool,
    pub text: bool,
    pub debug: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TilePass {
    All,
    Full,
    Grid2,
    Grid3,
}

struct RunSlot {
    id: u64,
    cancel: bool,
}

static RUN: Mutex<RunSlot> = Mutex::new(RunSlot { id: 0, cancel: false });

fn begin_run() -> u64 {
    let mut slot = RUN.lock().unwrap_or_else(|err| err.into_inner());
    slot.id = slot.id.wrapping_add(1);
    slot.cancel = false;
    slot.id
}

fn request_stop() {
    let mut slot = RUN.lock().unwrap_or_else(|err| err.into_inner());
    slot.cancel = true;
}

fn keep_going(id: u64, started: Instant) -> Keep {
    let slot = RUN.lock().unwrap_or_else(|err| err.into_inner());
    if slot.id != id || slot.cancel {
        return Keep::Stopped;
    }
    if started.elapsed() >= FIND_LIMIT {
        return Keep::Timeout;
    }
    Keep::Yes
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Keep {
    Yes,
    Stopped,
    Timeout,
}

pub fn active_wish(wish: Wish, avail: Availability) -> Wish {
    Wish {
        face: wish.face && avail.face,
        number: wish.number && avail.text,
        plate: wish.plate && avail.text,
        text: wish.text && avail.text,
    }
}

pub fn grid_tiles(n: u32, width: u32, height: u32, overlap: f64) -> Vec<PxRect> {
    if n == 0 || width == 0 || height == 0 {
        return Vec::new();
    }
    let n_f = n as f64;
    let overlap = overlap.clamp(0.0, 0.45);
    let tile_w = width as f64 / (n_f - (n_f - 1.0) * overlap);
    let tile_h = height as f64 / (n_f - (n_f - 1.0) * overlap);
    let step_w = tile_w * (1.0 - overlap);
    let step_h = tile_h * (1.0 - overlap);
    let mut out = Vec::with_capacity((n * n) as usize);
    for row in 0..n {
        for col in 0..n {
            let x = if col + 1 == n {
                width.saturating_sub(tile_w.round() as u32)
            } else {
                (col as f64 * step_w).round() as u32
            };
            let y = if row + 1 == n {
                height.saturating_sub(tile_h.round() as u32)
            } else {
                (row as f64 * step_h).round() as u32
            };
            let right = if col + 1 == n {
                width
            } else {
                ((x as f64) + tile_w).round() as u32
            }
            .min(width);
            let bottom = if row + 1 == n {
                height
            } else {
                ((y as f64) + tile_h).round() as u32
            }
            .min(height);
            out.push(PxRect {
                x,
                y,
                w: right.saturating_sub(x).max(1),
                h: bottom.saturating_sub(y).max(1),
            });
        }
    }
    out
}

pub fn view_tiles(width: u32, height: u32) -> Vec<PxRect> {
    tiles_for(width, height, TilePass::All).into_iter().map(|(tile, _)| tile).collect()
}

pub fn tiles_for(width: u32, height: u32, pass: TilePass) -> Vec<(PxRect, &'static str)> {
    let mut tiles = Vec::new();
    if pass == TilePass::All || pass == TilePass::Full {
        tiles.push((PxRect { x: 0, y: 0, w: width, h: height }, "full"));
    }
    if pass == TilePass::All || pass == TilePass::Grid2 {
        for tile in grid_tiles(2, width, height, TILE_OVERLAP) {
            if tile.w >= MIN_TILE && tile.h >= MIN_TILE {
                tiles.push((tile, "grid2"));
            }
        }
    }
    let fine = pass == TilePass::Grid3 || (pass == TilePass::All && width.min(height) >= FINE_SHORT_SIDE);
    if fine {
        for tile in grid_tiles(3, width, height, TILE_OVERLAP) {
            if tile.w >= MIN_TILE && tile.h >= MIN_TILE {
                tiles.push((tile, "grid3"));
            }
        }
    }
    tiles
}

pub fn map_detector_box(
    tile: PxRect,
    det_x: f64,
    det_y: f64,
    det_w: f64,
    det_h: f64,
    scale_x: f64,
    scale_y: f64,
    image_w: f64,
    image_h: f64,
) -> NormBox {
    let scale_x = if scale_x <= f64::EPSILON { 1.0 } else { scale_x };
    let scale_y = if scale_y <= f64::EPSILON { 1.0 } else { scale_y };
    let image_w = image_w.max(1.0);
    let image_h = image_h.max(1.0);
    NormBox {
        x: (tile.x as f64 + det_x / scale_x) / image_w,
        y: (tile.y as f64 + det_y / scale_y) / image_h,
        w: (det_w / scale_x) / image_w,
        h: (det_h / scale_y) / image_h,
    }
}

pub fn output_size(tile_w: u32, tile_h: u32, max_long: u32) -> (u32, u32) {
    let long = tile_w.max(tile_h).max(1);
    let limit = if max_long == 0 { long } else { max_long.max(1) };
    let scale = if long > limit { limit as f64 / long as f64 } else { 1.0 };
    let out_w = ((tile_w as f64) * scale).round().max(1.0) as u32;
    let out_h = ((tile_h as f64) * scale).round().max(1.0) as u32;
    (out_w, out_h)
}

/// 원본 BGRA에서 조각만 잘라 긴 변 기준으로 줄인다. 가로·세로는 같은 배율이다.
pub fn crop_bgra(src: &[u8], src_w: u32, src_h: u32, stride: u32, tile: PxRect, max_long: u32) -> Option<(Vec<u8>, u32, u32, f64, f64)> {
    if src_w == 0 || src_h == 0 || tile.w == 0 || tile.h == 0 {
        return None;
    }
    if stride < src_w.saturating_mul(4) {
        return None;
    }
    if tile.x.saturating_add(tile.w) > src_w || tile.y.saturating_add(tile.h) > src_h {
        return None;
    }
    let need = stride as usize * src_h as usize;
    if src.len() < need {
        return None;
    }
    let (out_w, out_h) = output_size(tile.w, tile.h, max_long);
    let scale_x = out_w as f64 / tile.w as f64;
    let scale_y = out_h as f64 / tile.h as f64;
    let mut out = vec![255u8; out_w as usize * out_h as usize * 4];
    for oy in 0..out_h {
        for ox in 0..out_w {
            let sx = tile.x as f64 + (ox as f64 + 0.5) / scale_x - 0.5;
            let sy = tile.y as f64 + (oy as f64 + 0.5) / scale_y - 0.5;
            let sx = sx.round().clamp(tile.x as f64, (tile.x + tile.w - 1) as f64) as u32;
            let sy = sy.round().clamp(tile.y as f64, (tile.y + tile.h - 1) as f64) as u32;
            let src_i = sy as usize * stride as usize + sx as usize * 4;
            let dst_i = (oy as usize * out_w as usize + ox as usize) * 4;
            out[dst_i..dst_i + 4].copy_from_slice(&src[src_i..src_i + 4]);
        }
    }
    Some((out, out_w, out_h, scale_x, scale_y))
}

fn remember_stage(stages: &mut Vec<StageMark>, capture: bool, stage: &'static str, kind: &'static str, area: NormBox) {
    #[cfg(debug_assertions)]
    if capture {
        stages.push(StageMark { stage, kind, x: area.x, y: area.y, w: area.w, h: area.h });
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (stages, capture, stage, kind, area);
    }
}

pub fn merge_boxes(boxes: &[NormBox]) -> Vec<NormBox> {
    let mut pending: Vec<NormBox> = boxes.to_vec();
    let mut out = Vec::new();
    while let Some(seed) = pending.pop() {
        let mut acc = seed;
        let mut grew = true;
        while grew {
            grew = false;
            let mut rest = Vec::new();
            for other in pending.drain(..) {
                if iou(acc, other) >= MERGE_IOU || contain_ratio(acc, other) >= CONTAIN_RATIO {
                    acc = union_box(acc, other);
                    grew = true;
                } else {
                    rest.push(other);
                }
            }
            pending = rest;
        }
        out.push(acc);
    }
    out
}

pub fn pad_box(area: NormBox, ratio: f64) -> NormBox {
    let dx = area.w * ratio;
    let dy = area.h * ratio;
    clamp_box(NormBox {
        x: area.x - dx,
        y: area.y - dy,
        w: area.w + dx * 2.0,
        h: area.h + dy * 2.0,
    })
    .unwrap_or(area)
}

pub fn clamp_box(area: NormBox) -> Option<NormBox> {
    let mut x = area.x;
    let mut y = area.y;
    let mut w = area.w;
    let mut h = area.h;
    if w < 0.0 {
        x += w;
        w = -w;
    }
    if h < 0.0 {
        y += h;
        h = -h;
    }
    if x < 0.0 {
        w += x;
        x = 0.0;
    }
    if y < 0.0 {
        h += y;
        y = 0.0;
    }
    if x + w > 1.0 {
        w = 1.0 - x;
    }
    if y + h > 1.0 {
        h = 1.0 - y;
    }
    if w < 0.004 || h < 0.004 || x >= 1.0 || y >= 1.0 {
        return None;
    }
    Some(NormBox { x, y, w, h })
}

pub fn regions_from_words(words: &[WordBox], wish: Wish) -> Vec<FoundBox> {
    let mut line = String::new();
    let mut owner: Vec<Option<usize>> = Vec::new();
    let mut compact = String::new();
    let mut compact_owner: Vec<usize> = Vec::new();
    for (index, word) in words.iter().enumerate() {
        for ch in word.text.chars() {
            line.push(ch);
            owner.push(Some(index));
            if !ch.is_whitespace() {
                compact.push(ch);
                compact_owner.push(index);
            }
        }
    }
    let mut regions = Vec::new();
    if wish.number {
        let profile = Profile::v1();
        for hit in find_patterns(&line, &profile) {
            if !is_number_kind(hit.kind) {
                continue;
            }
            if let Some(area) = union_span(&owner, hit.start, hit.end, words) {
                regions.push(FoundBox { kind: "number", x: area.x, y: area.y, w: area.w, h: area.h });
            }
        }
    }
    if wish.plate {
        let chars: Vec<char> = compact.chars().collect();
        for (start, end) in plate_spans(&chars) {
            if let Some(area) = union_indexed(&compact_owner, start, end, words) {
                regions.push(FoundBox { kind: "plate", x: area.x, y: area.y, w: area.w, h: area.h });
            }
        }
    }
    if wish.text {
        for word in words {
            let area = NormBox { x: word.x, y: word.y, w: word.w, h: word.h };
            if regions.iter().any(|region| iou(area, NormBox { x: region.x, y: region.y, w: region.w, h: region.h }) >= 0.5) {
                continue;
            }
            if let Some(area) = clamp_box(area) {
                regions.push(FoundBox { kind: "text", x: area.x, y: area.y, w: area.w, h: area.h });
            }
        }
    }
    regions
}

fn is_number_kind(kind: FindingKind) -> bool {
    matches!(kind, FindingKind::Rrn | FindingKind::Account | FindingKind::Mobile | FindingKind::Landline | FindingKind::Email)
}

pub fn plate_spans(chars: &[char]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if let Some(end) = try_plate(chars, index) {
            out.push((index, end));
            index = end;
        } else {
            index += 1;
        }
    }
    out
}

fn try_plate(chars: &[char], index: usize) -> Option<usize> {
    if index > 0 && chars[index - 1].is_ascii_digit() {
        return None;
    }
    let mut cursor = index;
    let mut digits = 0usize;
    while cursor < chars.len() && chars[cursor].is_ascii_digit() {
        digits += 1;
        cursor += 1;
        if digits > 3 {
            return None;
        }
    }
    if !(2..=3).contains(&digits) || cursor >= chars.len() || !is_hangul(chars[cursor]) {
        return None;
    }
    cursor += 1;
    let mut tail = 0usize;
    while cursor < chars.len() && chars[cursor].is_ascii_digit() {
        tail += 1;
        cursor += 1;
        if tail > 4 {
            return None;
        }
    }
    if tail != 4 {
        return None;
    }
    if cursor < chars.len() && (chars[cursor].is_ascii_digit() || is_hangul(chars[cursor])) {
        return None;
    }
    Some(cursor)
}

fn is_hangul(ch: char) -> bool {
    ('\u{AC00}'..='\u{D7A3}').contains(&ch)
}

fn union_span(owner: &[Option<usize>], start: usize, end: usize, words: &[WordBox]) -> Option<NormBox> {
    let mut indexes = Vec::new();
    for slot in owner.iter().take(end).skip(start).flatten() {
        if !indexes.contains(slot) {
            indexes.push(*slot);
        }
    }
    union_words(&indexes, words)
}

fn union_indexed(owner: &[usize], start: usize, end: usize, words: &[WordBox]) -> Option<NormBox> {
    let mut indexes = Vec::new();
    for slot in owner.iter().take(end).skip(start) {
        if !indexes.contains(slot) {
            indexes.push(*slot);
        }
    }
    union_words(&indexes, words)
}

fn union_words(indexes: &[usize], words: &[WordBox]) -> Option<NormBox> {
    let mut acc: Option<NormBox> = None;
    for index in indexes {
        let word = words.get(*index)?;
        let area = NormBox { x: word.x, y: word.y, w: word.w, h: word.h };
        acc = Some(match acc {
            Some(current) => union_box(current, area),
            None => area,
        });
    }
    acc.and_then(clamp_box)
}

fn union_box(left: NormBox, right: NormBox) -> NormBox {
    let x = left.x.min(right.x);
    let y = left.y.min(right.y);
    let right_edge = (left.x + left.w).max(right.x + right.w);
    let bottom = (left.y + left.h).max(right.y + right.h);
    NormBox { x, y, w: right_edge - x, h: bottom - y }
}

fn iou(left: NormBox, right: NormBox) -> f64 {
    let inter = intersection(left, right);
    let union = left.w * left.h + right.w * right.h - inter;
    if union <= f64::EPSILON { 0.0 } else { inter / union }
}

fn contain_ratio(left: NormBox, right: NormBox) -> f64 {
    let inter = intersection(left, right);
    let small = (left.w * left.h).min(right.w * right.h);
    if small <= f64::EPSILON { 0.0 } else { inter / small }
}

fn intersection(left: NormBox, right: NormBox) -> f64 {
    let x = left.x.max(right.x);
    let y = left.y.max(right.y);
    let right_edge = (left.x + left.w).min(right.x + right.w);
    let bottom = (left.y + left.h).min(right.y + right.h);
    (right_edge - x).max(0.0) * (bottom - y).max(0.0)
}

fn finish_regions(mut faces: Vec<NormBox>, mut numbers: Vec<NormBox>, mut plates: Vec<NormBox>, mut texts: Vec<NormBox>) -> (Vec<FoundBox>, bool) {
    faces = merge_boxes(&faces).into_iter().map(|area| pad_box(area, FACE_PAD)).filter_map(clamp_box).collect();
    numbers = merge_boxes(&numbers).into_iter().filter_map(clamp_box).collect();
    plates = merge_boxes(&plates).into_iter().filter_map(clamp_box).collect();
    texts = merge_boxes(&texts).into_iter().filter_map(clamp_box).collect();
    let mut regions = Vec::new();
    push_kind(&mut regions, "face", &faces);
    push_kind(&mut regions, "number", &numbers);
    push_kind(&mut regions, "plate", &plates);
    push_kind(&mut regions, "text", &texts);
    let trimmed = regions.len() > MAX_REGIONS;
    regions.truncate(MAX_REGIONS);
    (regions, trimmed)
}

fn push_kind(regions: &mut Vec<FoundBox>, kind: &'static str, boxes: &[NormBox]) {
    for area in boxes {
        regions.push(FoundBox { kind, x: area.x, y: area.y, w: area.w, h: area.h });
    }
}

fn counts(regions: &[FoundBox]) -> (u32, u32, u32, u32) {
    let mut face = 0;
    let mut number = 0;
    let mut plate = 0;
    let mut text = 0;
    for region in regions {
        match region.kind {
            "face" => face += 1,
            "number" => number += 1,
            "plate" => plate += 1,
            "text" => text += 1,
            _ => {}
        }
    }
    (face, number, plate, text)
}

#[cfg(windows)]
mod media {
    use super::*;
    #[cfg(debug_assertions)]
    use std::sync::atomic::{AtomicBool, Ordering};
    use windows::core::Interface;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapBuffer, BitmapBufferAccessMode, BitmapDecoder, BitmapPixelFormat, BitmapPlaneDescription, BitmapSize, BitmapTransform,
        ColorManagementMode, ExifOrientationMode, SoftwareBitmap,
    };
    use windows::Media::FaceAnalysis::FaceDetector;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{Buffer, DataReader, DataWriter, InMemoryRandomAccessStream};

    #[windows::core::interface("5b0d3235-4dba-4d44-865e-8f1d0e4fd04d")]
    unsafe trait IMemoryBufferByteAccess: windows::core::IUnknown {
        unsafe fn get_buffer(&self, value: *mut *mut u8, capacity: *mut u32) -> windows::core::HRESULT;
    }

    #[cfg(debug_assertions)]
    static DIAG: AtomicBool = AtomicBool::new(false);

    struct DiagGuard;

    impl Drop for DiagGuard {
        fn drop(&mut self) {
            #[cfg(debug_assertions)]
            set_diag(false);
        }
    }

    #[cfg(debug_assertions)]
    pub fn set_diag(on: bool) {
        if on {
            let dir = diag_dir();
            let _ = std::fs::remove_dir_all(&dir);
            let _ = std::fs::create_dir_all(&dir);
        }
        DIAG.store(on, Ordering::Relaxed);
    }

    #[cfg(not(debug_assertions))]
    fn set_diag(_on: bool) {}

    #[cfg(debug_assertions)]
    fn diag_on() -> bool {
        DIAG.load(Ordering::Relaxed)
    }

    #[cfg(debug_assertions)]
    fn diag_capture() -> bool {
        diag_on()
    }

    #[cfg(not(debug_assertions))]
    fn diag_capture() -> bool {
        false
    }

    fn diag_dir() -> std::path::PathBuf {
        std::env::temp_dir().join("edulauncher-find-diag")
    }

    pub struct MediaFacts {
        pub face: bool,
        pub text: bool,
        pub max_dimension: u32,
        pub languages: Vec<String>,
    }

    pub fn facts() -> MediaFacts {
        let face = FaceDetector::IsSupported().unwrap_or(false);
        let text = korean_ocr().unwrap_or(false);
        let max_dimension = OcrEngine::MaxImageDimension().unwrap_or(0);
        let mut languages = Vec::new();
        if let Ok(list) = OcrEngine::AvailableRecognizerLanguages() {
            for language in list {
                if let Ok(tag) = language.LanguageTag() {
                    languages.push(tag.to_string());
                }
            }
        }
        MediaFacts { face, text, max_dimension, languages }
    }

    fn korean_ocr() -> windows::core::Result<bool> {
        let tag = windows::core::HSTRING::from("ko");
        let language = Language::CreateLanguage(&tag)?;
        OcrEngine::IsLanguageSupported(&language)
    }

    pub fn scan_file(app: &AppHandle, path: &Path, wish: Wish, run: u64, started: Instant, pass: TilePass) -> Result<FindOutcome, String> {
        let _guard = DiagGuard;
        scan_bytes_with(Some(app), &read_picture(path)?, wish, run, started, started + FIND_LIMIT, pass)
    }

    pub fn scan_bytes(bytes: &[u8], wish: Wish, pass: TilePass) -> Result<FindOutcome, String> {
        #[cfg(debug_assertions)]
        set_diag(false);
        let started = Instant::now();
        let run = begin_run();
        scan_bytes_with(None, bytes, wish, run, started, started + Duration::from_secs(180), pass)
    }

    fn scan_bytes_with(
        app: Option<&AppHandle>,
        bytes: &[u8],
        wish: Wish,
        run: u64,
        started: Instant,
        deadline: Instant,
        pass: TilePass,
    ) -> Result<FindOutcome, String> {
        let avail = Availability { face: facts().face, text: facts().text };
        let active = active_wish(wish, avail);
        let mut faces = Vec::new();
        let mut numbers = Vec::new();
        let mut plates = Vec::new();
        let mut texts = Vec::new();
        let mut stages = Vec::new();
        let mut reason = String::new();
        if active.face || active.number || active.plate || active.text {
            match decode_and_scan(app, bytes, active, run, deadline, pass) {
                Ok((found_faces, found_numbers, found_plates, found_texts, found_stages, stop)) => {
                    faces = found_faces;
                    numbers = found_numbers;
                    plates = found_plates;
                    texts = found_texts;
                    stages = found_stages;
                    reason = stop;
                }
                Err(()) => return Err("사진을 확인하지 못했습니다.".into()),
            }
        }
        let (regions, trimmed) = finish_regions(faces, numbers, plates, texts);
        if trimmed && reason.is_empty() {
            reason = "trimmed".into();
        }
        let (face_count, number_count, plate_count, text_count) = counts(&regions);
        let partial = !reason.is_empty();
        Ok(FindOutcome {
            regions,
            stages,
            face_count,
            number_count,
            plate_count,
            text_count,
            face_available: avail.face,
            text_available: avail.text,
            partial,
            partial_reason: reason,
            elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        })
    }

    fn read_picture(path: &Path) -> Result<Vec<u8>, String> {
        let meta = std::fs::metadata(path).map_err(|_| "그림 파일을 읽지 못했습니다.".to_string())?;
        if !meta.is_file() || meta.len() > MAX_READ_BYTES {
            return Err("그림이 너무 큽니다.".into());
        }
        let bytes = std::fs::read(path).map_err(|_| "그림 파일을 읽지 못했습니다.".to_string())?;
        if picture_mime(&bytes).is_none() {
            return Err("그림 파일을 읽지 못했습니다.".into());
        }
        Ok(bytes)
    }

    fn emit_step(app: Option<&AppHandle>, step: &str) {
        if let Some(app) = app {
            let _ = app.emit("privacy-find-step", step);
        }
    }

    fn still_going(run: u64, deadline: Instant) -> Keep {
        if Instant::now() >= deadline {
            return Keep::Timeout;
        }
        keep_going(run, Instant::now())
    }

    fn decode_and_scan(
        app: Option<&AppHandle>,
        bytes: &[u8],
        wish: Wish,
        run: u64,
        deadline: Instant,
        pass: TilePass,
    ) -> Result<(Vec<NormBox>, Vec<NormBox>, Vec<NormBox>, Vec<NormBox>, Vec<StageMark>, String), ()> {
        let frame = load_frame(bytes)?;
        let tiles = tiles_for(frame.width, frame.height, pass);
        let capture = diag_capture();
        let mut faces = Vec::new();
        let mut numbers = Vec::new();
        let mut plates = Vec::new();
        let mut texts = Vec::new();
        let mut stages = Vec::new();
        let mut reason = String::new();
        if wish.face {
            emit_step(app, "face");
            if let Ok(detector) = FaceDetector::CreateAsync().and_then(|op| op.get()) {
                for (index, (tile, stage)) in tiles.iter().enumerate() {
                    match still_going(run, deadline) {
                        Keep::Yes => {}
                        Keep::Stopped => {
                            reason = "stopped".into();
                            break;
                        }
                        Keep::Timeout => {
                            reason = "timeout".into();
                            break;
                        }
                    }
                    let max_long = if *stage == "full" { FACE_FULL_LONG } else { FACE_TILE_LONG };
                    if let Some(found) = detect_on(&frame, &detector, *tile, max_long, &format!("face-{stage}-{index}")) {
                        for area in found {
                            remember_stage(&mut stages, capture, stage, "face", area);
                            faces.push(area);
                        }
                    }
                }
            }
        }
        if reason.is_empty() && (wish.number || wish.plate || wish.text) {
            emit_step(app, "text");
            let max_long = OcrEngine::MaxImageDimension().unwrap_or(0);
            if max_long > 0 {
                if let Some(engine) = korean_engine() {
                    for (index, (tile, stage)) in tiles.iter().enumerate() {
                        match still_going(run, deadline) {
                            Keep::Yes => {}
                            Keep::Stopped => {
                                reason = "stopped".into();
                                break;
                            }
                            Keep::Timeout => {
                                reason = "timeout".into();
                                break;
                            }
                        }
                        if let Some(words) = read_on(&frame, &engine, *tile, max_long, &format!("text-{stage}-{index}")) {
                            let found = regions_from_words(&words, wish);
                            for region in found {
                                let area = NormBox { x: region.x, y: region.y, w: region.w, h: region.h };
                                remember_stage(&mut stages, capture, stage, region.kind, area);
                                match region.kind {
                                    "number" => numbers.push(area),
                                    "plate" => plates.push(area),
                                    "text" => texts.push(area),
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok((faces, numbers, plates, texts, stages, reason))
    }

    fn korean_engine() -> Option<OcrEngine> {
        let tag = windows::core::HSTRING::from("ko");
        let language = Language::CreateLanguage(&tag).ok()?;
        if !OcrEngine::IsLanguageSupported(&language).unwrap_or(false) {
            return None;
        }
        OcrEngine::TryCreateFromLanguage(&language).ok()
    }

    struct Frame {
        width: u32,
        height: u32,
        stride: u32,
        pixels: Vec<u8>,
        format: &'static str,
        plane_stride: i32,
        #[allow(dead_code)]
        oriented_w: u32,
        #[allow(dead_code)]
        oriented_h: u32,
    }

    fn load_frame(bytes: &[u8]) -> Result<Frame, ()> {
        let stream = InMemoryRandomAccessStream::new().map_err(|_| ())?;
        let writer = DataWriter::CreateDataWriter(&stream).map_err(|_| ())?;
        writer.WriteBytes(bytes).map_err(|_| ())?;
        writer.StoreAsync().map_err(|_| ())?.get().map_err(|_| ())?;
        let _detached = writer.DetachStream().map_err(|_| ())?;
        stream.Seek(0).map_err(|_| ())?;
        let decoder = BitmapDecoder::CreateAsync(&stream).map_err(|_| ())?.get().map_err(|_| ())?;
        let oriented_w = decoder.OrientedPixelWidth().unwrap_or(0);
        let oriented_h = decoder.OrientedPixelHeight().unwrap_or(0);
        let transform = BitmapTransform::new().map_err(|_| ())?;
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Ignore,
                &transform,
                ExifOrientationMode::RespectExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )
            .map_err(|_| ())?
            .get()
            .map_err(|_| ())?;
        let width = bitmap.PixelWidth().unwrap_or(0).max(0) as u32;
        let height = bitmap.PixelHeight().unwrap_or(0).max(0) as u32;
        if width < 2 || height < 2 || u64::from(width) * u64::from(height) > MAX_PIXELS {
            let _ = bitmap.Close();
            let _ = stream.Close();
            return Err(());
        }
        let Some((pixels, stride, plane_stride, format)) = read_bgra(&bitmap) else {
            let _ = bitmap.Close();
            let _ = stream.Close();
            return Err(());
        };
        let _ = bitmap.Close();
        let _ = stream.Close();
        Ok(Frame { width, height, stride, pixels, format, plane_stride, oriented_w, oriented_h })
    }

    fn detect_on(frame: &Frame, detector: &FaceDetector, tile: PxRect, max_long: u32, label: &str) -> Option<Vec<NormBox>> {
        let (bitmap, scale_x, scale_y) = tile_bitmap(frame, tile, true, max_long, label)?;
        let short = (bitmap.PixelWidth().unwrap_or(0) as u32).min(bitmap.PixelHeight().unwrap_or(0) as u32);
        if short > MIN_FACE {
            let _ = detector.SetMinDetectableFaceSize(BitmapSize { Width: MIN_FACE, Height: MIN_FACE });
        }
        let faces = match detector.DetectFacesAsync(&bitmap).and_then(|op| op.get()) {
            Ok(faces) => faces,
            Err(_) => {
                let _ = bitmap.Close();
                return None;
            }
        };
        let mut out = Vec::new();
        for face in faces {
            let bounds = face.FaceBox().ok()?;
            if bounds.Width == 0 || bounds.Height == 0 {
                continue;
            }
            let area = map_detector_box(
                tile,
                f64::from(bounds.X),
                f64::from(bounds.Y),
                f64::from(bounds.Width),
                f64::from(bounds.Height),
                scale_x,
                scale_y,
                f64::from(frame.width),
                f64::from(frame.height),
            );
            if let Some(area) = clamp_box(area) {
                out.push(area);
            }
        }
        let _ = bitmap.Close();
        Some(out)
    }

    fn read_on(frame: &Frame, engine: &OcrEngine, tile: PxRect, max_long: u32, label: &str) -> Option<Vec<WordBox>> {
        let (bitmap, scale_x, scale_y) = tile_bitmap(frame, tile, false, max_long, label)?;
        let result = match engine.RecognizeAsync(&bitmap).and_then(|op| op.get()) {
            Ok(result) => result,
            Err(_) => {
                let _ = bitmap.Close();
                return None;
            }
        };
        let lines = result.Lines().ok()?;
        let mut words = Vec::new();
        for line in lines {
            let line_words = line.Words().ok()?;
            for word in line_words {
                let text = word.Text().ok()?.to_string();
                if text.trim().is_empty() {
                    continue;
                }
                let rect = word.BoundingRect().ok()?;
                let area = map_detector_box(
                    tile,
                    f64::from(rect.X),
                    f64::from(rect.Y),
                    f64::from(rect.Width),
                    f64::from(rect.Height),
                    scale_x,
                    scale_y,
                    f64::from(frame.width),
                    f64::from(frame.height),
                );
                let Some(area) = clamp_box(area) else { continue };
                words.push(WordBox { text, x: area.x, y: area.y, w: area.w, h: area.h });
            }
        }
        let _ = bitmap.Close();
        Some(words)
    }

    fn tile_bitmap(frame: &Frame, tile: PxRect, gray: bool, max_long: u32, label: &str) -> Option<(SoftwareBitmap, f64, f64)> {
        let (pixels, out_w, out_h, scale_x, scale_y) = crop_bgra(&frame.pixels, frame.width, frame.height, frame.stride, tile, max_long)?;
        let bgra = bitmap_from_bgra(&pixels, out_w, out_h)?;
        let bitmap = if gray {
            let converted = match SoftwareBitmap::Convert(&bgra, BitmapPixelFormat::Gray8) {
                Ok(converted) => converted,
                Err(_) => {
                    let _ = bgra.Close();
                    return None;
                }
            };
            let _ = bgra.Close();
            converted
        } else {
            bgra
        };
        #[cfg(debug_assertions)]
        maybe_dump(label, &bitmap);
        #[cfg(not(debug_assertions))]
        let _ = label;
        Some((bitmap, scale_x, scale_y))
    }

    fn bitmap_from_bgra(pixels: &[u8], width: u32, height: u32) -> Option<SoftwareBitmap> {
        let writer = DataWriter::new().ok()?;
        writer.WriteBytes(pixels).ok()?;
        let buffer = writer.DetachBuffer().ok()?;
        SoftwareBitmap::CreateCopyWithAlphaFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width as i32, height as i32, BitmapAlphaMode::Ignore).ok()
    }

    fn read_bgra(bitmap: &SoftwareBitmap) -> Option<(Vec<u8>, u32, i32, &'static str)> {
        let format = bitmap.BitmapPixelFormat().ok()?;
        let name = format_name(format);
        let locked = bitmap.LockBuffer(BitmapBufferAccessMode::Read).ok()?;
        let plane = locked.GetPlaneDescription(0).ok()?;
        let copied = copy_plane(&locked, &plane, 4);
        let _ = locked.Close();
        let (pixels, stride) = copied.or_else(|| copy_packed(bitmap))?;
        Some((pixels, stride, plane.Stride, name))
    }

    fn copy_plane(locked: &BitmapBuffer, plane: &BitmapPlaneDescription, bpp: usize) -> Option<(Vec<u8>, u32)> {
        let reference = locked.CreateReference().ok()?;
        let access: IMemoryBufferByteAccess = Interface::cast(&reference).ok()?;
        let mut data = std::ptr::null_mut();
        let mut capacity = 0u32;
        unsafe { access.get_buffer(&mut data, &mut capacity) }.ok().ok()?;
        if data.is_null() || capacity == 0 {
            return None;
        }
        let w = plane.Width.max(0) as usize;
        let h = plane.Height.max(0) as usize;
        let stride = plane.Stride.max(0) as usize;
        let start = plane.StartIndex.max(0) as usize;
        if w == 0 || h == 0 || stride < w * bpp {
            return None;
        }
        let tail = start.checked_add(stride.checked_mul(h.saturating_sub(1))?)?.checked_add(w * bpp)?;
        if tail > capacity as usize {
            return None;
        }
        let mut out = vec![0u8; stride * h];
        unsafe {
            for row in 0..h {
                let src = std::slice::from_raw_parts(data.add(start + row * stride), stride);
                out[row * stride..row * stride + stride].copy_from_slice(src);
            }
        }
        Some((out, stride as u32))
    }

    fn copy_packed(bitmap: &SoftwareBitmap) -> Option<(Vec<u8>, u32)> {
        let w = bitmap.PixelWidth().ok()?.max(0) as u32;
        let h = bitmap.PixelHeight().ok()?.max(0) as u32;
        let bytes = w.checked_mul(h)?.checked_mul(4)?;
        let buffer = Buffer::Create(bytes).ok()?;
        bitmap.CopyToBuffer(&buffer).ok()?;
        let reader = DataReader::FromBuffer(&buffer).ok()?;
        let mut packed = vec![0u8; bytes as usize];
        reader.ReadBytes(&mut packed).ok()?;
        Some((packed, w * 4))
    }

    fn format_name(format: BitmapPixelFormat) -> &'static str {
        if format == BitmapPixelFormat::Bgra8 {
            "Bgra8"
        } else if format == BitmapPixelFormat::Gray8 {
            "Gray8"
        } else if format == BitmapPixelFormat::Rgba8 {
            "Rgba8"
        } else {
            "other"
        }
    }

    #[cfg(debug_assertions)]
    fn maybe_dump(label: &str, bitmap: &SoftwareBitmap) {
        if !diag_on() {
            return;
        }
        let format = bitmap.BitmapPixelFormat().unwrap_or(BitmapPixelFormat::Unknown);
        let w = bitmap.PixelWidth().unwrap_or(0);
        let h = bitmap.PixelHeight().unwrap_or(0);
        let stride = bitmap.LockBuffer(BitmapBufferAccessMode::Read).ok().and_then(|locked| {
            let stride = locked.GetPlaneDescription(0).ok().map(|plane| plane.Stride);
            let _ = locked.Close();
            stride
        });
        let dir = diag_dir();
        let _ = std::fs::create_dir_all(&dir);
        let line = format!("{label} {w}x{h} format={} stride={}\n", format_name(format), stride.unwrap_or(-1));
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("sizes.txt")) {
            use std::io::Write;
            let _ = file.write_all(line.as_bytes());
        }
        if let Some(png) = png_of_bitmap(bitmap) {
            let _ = std::fs::write(dir.join(format!("{label}.png")), png);
        }
    }

    #[cfg(debug_assertions)]
    fn png_of_bitmap(bitmap: &SoftwareBitmap) -> Option<Vec<u8>> {
        let format = bitmap.BitmapPixelFormat().ok()?;
        let w = bitmap.PixelWidth().ok()?.max(1) as u32;
        let h = bitmap.PixelHeight().ok()?.max(1) as u32;
        let locked = bitmap.LockBuffer(BitmapBufferAccessMode::Read).ok()?;
        let plane = locked.GetPlaneDescription(0).ok()?;
        let bpp = if format == BitmapPixelFormat::Gray8 { 1 } else { 4 };
        let copied = copy_plane(&locked, &plane, bpp);
        let _ = locked.Close();
        let (pixels, stride) = copied?;
        let mut rgba = vec![255u8; w as usize * h as usize * 4];
        for y in 0..h as usize {
            for x in 0..w as usize {
                let dst = (y * w as usize + x) * 4;
                if bpp == 1 {
                    let gray = pixels[y * stride as usize + x];
                    rgba[dst] = gray;
                    rgba[dst + 1] = gray;
                    rgba[dst + 2] = gray;
                } else {
                    let src = y * stride as usize + x * 4;
                    rgba[dst] = pixels[src + 2];
                    rgba[dst + 1] = pixels[src + 1];
                    rgba[dst + 2] = pixels[src];
                    rgba[dst + 3] = pixels[src + 3];
                }
            }
        }
        encode_rgba(&rgba, w, h)
    }

    #[cfg(any(debug_assertions, test))]
    fn encode_rgba(rgba: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
        let mut png = Vec::new();
        let mut encoder = png::Encoder::new(&mut png, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
        writer.finish().ok()?;
        Some(png)
    }

    #[cfg(test)]
    fn legacy_bounds_size(bytes: &[u8], tile: PxRect) -> Option<(i32, i32, Option<(u32, u32)>)> {
        let stream = InMemoryRandomAccessStream::new().ok()?;
        let writer = DataWriter::CreateDataWriter(&stream).ok()?;
        writer.WriteBytes(bytes).ok()?;
        writer.StoreAsync().ok()?.get().ok()?;
        let _detached = writer.DetachStream().ok()?;
        stream.Seek(0).ok()?;
        let decoder = BitmapDecoder::CreateAsync(&stream).ok()?.get().ok()?;
        let (scaled_w, scaled_h) = output_size(tile.w, tile.h, 10_000);
        let transform = BitmapTransform::new().ok()?;
        transform
            .SetBounds(windows::Graphics::Imaging::BitmapBounds { X: tile.x, Y: tile.y, Width: tile.w, Height: tile.h })
            .ok()?;
        transform.SetScaledWidth(scaled_w).ok()?;
        transform.SetScaledHeight(scaled_h).ok()?;
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(
                BitmapPixelFormat::Bgra8,
                BitmapAlphaMode::Ignore,
                &transform,
                ExifOrientationMode::RespectExifOrientation,
                ColorManagementMode::DoNotColorManage,
            )
            .ok()?
            .get()
            .ok()?;
        let width = bitmap.PixelWidth().unwrap_or(0);
        let height = bitmap.PixelHeight().unwrap_or(0);
        let red = read_bgra(&bitmap).and_then(|(pixels, stride, _, _)| first_red(&pixels, width as u32, height as u32, stride));
        let _ = bitmap.Close();
        let _ = stream.Close();
        Some((width, height, red))
    }

    #[cfg(test)]
    pub fn probe_marker(bytes: &[u8], mark_x: u32, mark_y: u32) -> String {
        let Ok(frame) = load_frame(bytes) else {
            return "picture=broken decode".into();
        };
        let master_red = first_red(&frame.pixels, frame.width, frame.height, frame.stride);
        let master_white = pixel_is_white(&frame.pixels, frame.stride, 8, 8);
        let Some((tile, _)) = tiles_for(frame.width, frame.height, TilePass::Grid2).into_iter().find(|(tile, _)| tile.x > 0 && tile.y > 0) else {
            return "picture=broken tile".into();
        };
        let expect_x = mark_x.saturating_sub(tile.x);
        let expect_y = mark_y.saturating_sub(tile.y);
        let cropped = crop_bgra(&frame.pixels, frame.width, frame.height, frame.stride, tile, 10_000);
        let (crop_red, crop_white, crop_size) = match &cropped {
            Some((pixels, w, h, _, _)) => (first_red(pixels, *w, *h, w * 4), pixel_is_white(pixels, w * 4, 4, 4), format!("{w}x{h}")),
            None => (None, false, "none".into()),
        };
        let bounds = legacy_bounds_size(bytes, tile);
        #[cfg(debug_assertions)]
        let saved = {
            set_diag(true);
            if let Some((pixels, w, h, _, _)) = &cropped {
                if let Some(bitmap) = bitmap_from_bgra(pixels, *w, *h) {
                    maybe_dump("crop-marker", &bitmap);
                    let _ = bitmap.Close();
                }
            }
            let saved = diag_dir().join("crop-marker.png").exists();
            let _ = std::fs::remove_dir_all(diag_dir());
            saved
        };
        #[cfg(not(debug_assertions))]
        let saved = false;
        let crop_ok = crop_red == Some((expect_x, expect_y)) && crop_white && master_white && master_red == Some((mark_x, mark_y));
        format!(
            "picture={} master={}x{} oriented={}x{} format={} stride={} plane={} marker={master_red:?} white={master_white} crop={crop_size} crop_red={crop_red:?} expect={expect_x},{expect_y} crop_white={crop_white} bounds={bounds:?} saved_then_deleted={saved} crop_ok={crop_ok}",
            if crop_ok { "ok" } else { "broken" },
            frame.width,
            frame.height,
            frame.oriented_w,
            frame.oriented_h,
            frame.format,
            frame.stride,
            frame.plane_stride,
        )
    }

    #[cfg(test)]
    fn first_red(pixels: &[u8], width: u32, height: u32, stride: u32) -> Option<(u32, u32)> {
        for y in 0..height {
            for x in 0..width {
                let i = y as usize * stride as usize + x as usize * 4;
                if i + 3 < pixels.len() && pixels[i] < 30 && pixels[i + 1] < 30 && pixels[i + 2] > 200 {
                    return Some((x, y));
                }
            }
        }
        None
    }

    #[cfg(test)]
    fn pixel_is_white(pixels: &[u8], stride: u32, x: u32, y: u32) -> bool {
        let i = y as usize * stride as usize + x as usize * 4;
        i + 3 < pixels.len() && pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240
    }

    pub fn measure_blank() -> String {
        let facts = facts();
        let mut notes = Vec::new();
        notes.push(format!("face={} text={} max={} langs={}", facts.face, facts.text, facts.max_dimension, facts.languages.join(",")));
        if facts.face {
            let started = Instant::now();
            match SoftwareBitmap::Create(BitmapPixelFormat::Gray8, 4000, 3000) {
                Ok(bitmap) => {
                    if let Ok(detector) = FaceDetector::CreateAsync().and_then(|op| op.get()) {
                        let first = Instant::now();
                        let found = detector.DetectFacesAsync(&bitmap).and_then(|op| op.get()).map(|faces| faces.into_iter().count()).unwrap_or(0);
                        let first_ms = first.elapsed().as_millis();
                        let more = Instant::now();
                        for _ in 0..4 {
                            let _ = detector.DetectFacesAsync(&bitmap).and_then(|op| op.get());
                        }
                        notes.push(format!("blank12mp_face_ms={first_ms} faces={found} five_pass_ms={}", first_ms + more.elapsed().as_millis()));
                    } else {
                        notes.push("blank12mp_face=create_detector_failed".into());
                    }
                    let _ = bitmap.Close();
                    notes.push(format!("blank12mp_alloc_ms={}", started.elapsed().as_millis()));
                }
                Err(_) => notes.push("blank12mp_face=bitmap_failed".into()),
            }
        }
        if facts.text {
            if let Some(engine) = korean_engine() {
                if let Ok(bitmap) = SoftwareBitmap::Create(BitmapPixelFormat::Bgra8, 4000, 3000) {
                    let started = Instant::now();
                    let _ = engine.RecognizeAsync(&bitmap).and_then(|op| op.get());
                    notes.push(format!("blank12mp_ocr_ms={}", started.elapsed().as_millis()));
                    let _ = bitmap.Close();
                } else {
                    notes.push("blank12mp_ocr=bitmap_failed".into());
                }
            }
        }
        notes.join(" | ")
    }
}

#[cfg(not(windows))]
mod media {
    use super::*;

    pub struct MediaFacts {
        pub face: bool,
        pub text: bool,
        pub max_dimension: u32,
        pub languages: Vec<String>,
    }

    pub fn facts() -> MediaFacts {
        MediaFacts { face: false, text: false, max_dimension: 0, languages: Vec::new() }
    }

    pub fn scan_file(_app: &AppHandle, _path: &Path, _wish: Wish, _run: u64, started: Instant, _pass: TilePass) -> Result<FindOutcome, String> {
        Ok(empty_outcome(false, false, started))
    }

    pub fn measure_blank() -> String {
        "windows_media=absent".into()
    }
}

#[cfg(not(windows))]
fn empty_outcome(face: bool, text: bool, started: Instant) -> FindOutcome {
        FindOutcome {
        regions: Vec::new(),
        stages: Vec::new(),
        face_count: 0,
        number_count: 0,
        plate_count: 0,
        text_count: 0,
        face_available: face,
        text_available: text,
        partial: false,
        partial_reason: String::new(),
        elapsed_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
    }
}

#[tauri::command]
pub fn privacy_find_caps(window: WebviewWindow) -> Result<FindCaps, String> {
    if window.label() != "main" {
        return Err("이 창에서는 확인할 수 없습니다.".into());
    }
    let facts = media::facts();
    Ok(FindCaps { face: facts.face, text: facts.text, debug: cfg!(debug_assertions) })
}

#[tauri::command]
pub async fn find_privacy_regions(
    app: AppHandle,
    window: WebviewWindow,
    read_id: String,
    face: bool,
    number: bool,
    plate: bool,
    text: bool,
    full_only: Option<bool>,
    diag: Option<bool>,
) -> Result<FindOutcome, String> {
    if window.label() != "main" {
        return Err("이 창에서는 찾을 수 없습니다.".into());
    }
    let book = app.state::<path_grant::GrantBook>();
    let path = path_grant::view_read(&book, &read_id).map_err(|text| text.to_string())?;
    drop(book);
    let wish = Wish { face, number, plate, text };
    let pass = if cfg!(debug_assertions) && full_only.unwrap_or(false) { TilePass::Full } else { TilePass::All };
    #[cfg(debug_assertions)]
    media::set_diag(diag.unwrap_or(false));
    #[cfg(not(debug_assertions))]
    let _ = diag;
    let run = begin_run();
    let started = Instant::now();
    let app_for_find = app.clone();
    tauri::async_runtime::spawn_blocking(move || media::scan_file(&app_for_find, &path, wish, run, started, pass))
        .await
        .map_err(|_| "사진을 확인하지 못했습니다.".to_string())?
}

#[tauri::command]
pub fn stop_privacy_find(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("이 창에서는 멈출 수 없습니다.".into());
    }
    request_stop();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_restores_detector_box_to_original() {
        let tile = PxRect { x: 100, y: 50, w: 200, h: 100 };
        let area = map_detector_box(tile, 10.0, 20.0, 30.0, 40.0, 0.5, 0.5, 1000.0, 800.0);
        assert!((area.x - 0.12).abs() < 0.0001);
        assert!((area.y - 0.1125).abs() < 0.0001);
        assert!((area.w - 0.06).abs() < 0.0001);
        assert!((area.h - 0.1).abs() < 0.0001);
    }

    #[test]
    fn tiles_cover_edges_and_large_photos_add_a_finer_grid() {
        let small = view_tiles(1000, 800);
        assert_eq!(small[0], PxRect { x: 0, y: 0, w: 1000, h: 800 });
        assert_eq!(small.len(), 5);
        let right = &small[2];
        let left = &small[1];
        let overlap = left.x + left.w - right.x;
        let ratio = overlap as f64 / left.w as f64;
        assert!((ratio - TILE_OVERLAP).abs() < 0.08, "{ratio}");
        assert_eq!(small[4].x + small[4].w, 1000);
        assert_eq!(small[4].y + small[4].h, 800);
        let large = view_tiles(2400, 1800);
        assert_eq!(large.len(), 1 + 4 + 9);
        assert!(view_tiles(2000, 1599).len() == 5);
    }

    #[test]
    fn overlapping_boxes_merge_then_padding_stays_inside() {
        let merged = merge_boxes(&[
            NormBox { x: 0.10, y: 0.10, w: 0.20, h: 0.20 },
            NormBox { x: 0.12, y: 0.12, w: 0.20, h: 0.20 },
            NormBox { x: 0.70, y: 0.70, w: 0.10, h: 0.10 },
        ]);
        assert_eq!(merged.len(), 2);
        let padded = pad_box(NormBox { x: 0.0, y: 0.05, w: 0.20, h: 0.20 }, FACE_PAD);
        assert!(padded.x >= 0.0 && padded.y >= 0.0);
        assert!(padded.x + padded.w <= 1.0 + 0.0001);
        assert!(padded.w > 0.20);
    }

    #[test]
    fn word_union_covers_a_split_number_and_plate() {
        let phone = regions_from_words(
            &[
                WordBox { text: "010-2000-".into(), x: 0.10, y: 0.20, w: 0.20, h: 0.04 },
                WordBox { text: "0001".into(), x: 0.32, y: 0.20, w: 0.10, h: 0.04 },
            ],
            Wish { face: false, number: true, plate: false, text: false },
        );
        assert_eq!(phone.len(), 1);
        assert_eq!(phone[0].kind, "number");
        assert!(phone[0].x <= 0.10 + 0.001);
        assert!(phone[0].x + phone[0].w >= 0.42 - 0.001);

        let rrn = regions_from_words(
            &[WordBox { text: "900101-1234567".into(), x: 0.05, y: 0.40, w: 0.30, h: 0.05 }],
            Wish { face: false, number: true, plate: false, text: false },
        );
        assert_eq!(rrn.len(), 1);
        assert_eq!(rrn[0].kind, "number");

        let mail = regions_from_words(
            &[WordBox { text: "user@example.com".into(), x: 0.15, y: 0.50, w: 0.25, h: 0.04 }],
            Wish { face: false, number: true, plate: false, text: false },
        );
        assert_eq!(mail.len(), 1);

        let account = regions_from_words(
            &[WordBox { text: "123456789012".into(), x: 0.20, y: 0.60, w: 0.30, h: 0.04 }],
            Wish { face: false, number: true, plate: false, text: false },
        );
        assert_eq!(account.len(), 1);

        let plate = regions_from_words(
            &[
                WordBox { text: "12".into(), x: 0.10, y: 0.70, w: 0.06, h: 0.04 },
                WordBox { text: "가".into(), x: 0.17, y: 0.70, w: 0.04, h: 0.04 },
                WordBox { text: "3456".into(), x: 0.22, y: 0.70, w: 0.10, h: 0.04 },
            ],
            Wish { face: false, number: false, plate: true, text: false },
        );
        assert_eq!(plate.len(), 1);
        assert_eq!(plate[0].kind, "plate");
        assert!(plate[0].w > 0.15);
        assert!(plate_spans(&['1', '2', '가', '3', '4', '5']).is_empty());
        assert!(plate_spans(&['1', '2', '3', '4', '가', '3', '4', '5', '6']).is_empty());
    }

    #[test]
    fn serialized_regions_do_not_contain_the_source_text() {
        let secret = "010-2000-0001";
        let regions = regions_from_words(
            &[WordBox { text: secret.into(), x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
            Wish { face: false, number: true, plate: true, text: true },
        );
        let payload = serde_json::to_string(&regions).expect("json");
        assert!(!payload.contains(secret));
        assert!(!payload.contains("010"));
        assert!(!payload.contains("2000"));
        assert!(payload.contains("number"));
    }

    #[test]
    fn missing_text_engine_drops_text_wishes_and_keeps_faces() {
        let active = active_wish(
            Wish { face: true, number: true, plate: true, text: true },
            Availability { face: true, text: false },
        );
        assert!(active.face);
        assert!(!active.number && !active.plate && !active.text);
        let no_face = active_wish(
            Wish { face: true, number: true, plate: false, text: false },
            Availability { face: false, text: true },
        );
        assert!(!no_face.face);
        assert!(no_face.number);
    }

    #[test]
    fn crop_respects_stride_and_keeps_aspect() {
        let src_w = 12u32;
        let src_h = 8u32;
        let stride = src_w * 4 + 16;
        let mut src = vec![255u8; stride as usize * src_h as usize];
        let mark_x = 9u32;
        let mark_y = 6u32;
        let at = mark_y as usize * stride as usize + mark_x as usize * 4;
        src[at] = 0;
        src[at + 1] = 0;
        src[at + 2] = 255;
        src[at + 3] = 255;
        let tile = PxRect { x: 8, y: 4, w: 4, h: 4 };
        let (pixels, width, height, scale_x, scale_y) = crop_bgra(&src, src_w, src_h, stride, tile, 10_000).expect("crop");
        assert_eq!((width, height), (4, 4));
        assert!((scale_x - 1.0).abs() < 1e-9 && (scale_y - 1.0).abs() < 1e-9);
        let local = ((2 * width + 1) * 4) as usize;
        assert_eq!(&pixels[local..local + 4], &[0, 0, 255, 255]);
        let (out_w, out_h) = output_size(3000, 1000, 1600);
        assert_eq!(out_w, 1600);
        assert!((3000.0 / 1000.0 - out_w as f64 / out_h as f64).abs() < 0.01, "{out_w}x{out_h}");
    }

    #[test]
    fn fake_face_uses_the_same_map_as_text() {
        let tile = PxRect { x: 1800, y: 200, w: 900, h: 700 };
        let face = map_detector_box(tile, 40.0, 30.0, 80.0, 90.0, 0.5, 0.5, 4000.0, 3000.0);
        let text = map_detector_box(tile, 40.0, 30.0, 80.0, 90.0, 0.5, 0.5, 4000.0, 3000.0);
        assert_eq!(face, text);
        assert!((face.x - 1880.0 / 4000.0).abs() < 1e-9);
        assert!((face.y - 260.0 / 3000.0).abs() < 1e-9);
    }

    #[cfg(windows)]
    #[test]
    fn cropped_bitmap_matches_the_marker_and_is_deleted() {
        let png = solid_marker_png(640, 480, 400, 300, 24);
        let report = media::probe_marker(&png, 400, 300);
        eprintln!("privacy-find-bitmap {report}");
        assert!(report.contains("picture=ok"), "{report}");
        assert!(report.contains("crop_ok=true"), "{report}");
        assert!(!std::env::temp_dir().join("edulauncher-find-diag").exists());
    }

    #[cfg(windows)]
    #[test]
    fn drawn_phone_number_lands_within_three_percent() {
        if !media::facts().text {
            eprintln!("korean ocr unavailable, skip");
            return;
        }
        check_phone(1200, 1600);
        check_phone(4000, 3000);
    }

    #[cfg(windows)]
    fn check_phone(width: i32, height: i32) {
        let (png, expect) = draw_phone_png(width, height).expect("gdi phone");
        for pass in [TilePass::Full, TilePass::Grid2, TilePass::Grid3, TilePass::All] {
            let outcome = media::scan_bytes(&png, Wish { face: false, number: true, plate: false, text: false }, pass).expect("scan");
            assert!(!outcome.partial, "{width}x{height} {pass:?} {}", outcome.partial_reason);
            let numbers: Vec<_> = outcome.regions.iter().filter(|region| region.kind == "number").collect();
            assert_eq!(numbers.len(), 1, "{width}x{height} {pass:?} {numbers:?}");
            let found = numbers[0];
            let dx = (found.x + found.w / 2.0) - (expect.x + expect.w / 2.0);
            let dy = (found.y + found.h / 2.0) - (expect.y + expect.h / 2.0);
            eprintln!("ocr {width}x{height} {pass:?} dx={dx:.4} dy={dy:.4} found=({:.4},{:.4},{:.4},{:.4})", found.x, found.y, found.w, found.h);
            assert!(dx.abs() <= 0.03 && dy.abs() <= 0.03, "{width}x{height} {pass:?} dx={dx} dy={dy} found={found:?} expect={expect:?}");
        }
    }

    #[cfg(windows)]
    fn solid_marker_png(width: u32, height: u32, x: u32, y: u32, size: u32) -> Vec<u8> {
        let mut rgba = vec![255u8; width as usize * height as usize * 4];
        for row in y..y.saturating_add(size).min(height) {
            for col in x..x.saturating_add(size).min(width) {
                let at = (row * width + col) as usize * 4;
                rgba[at] = 255;
                rgba[at + 1] = 0;
                rgba[at + 2] = 0;
            }
        }
        encode_test_png(&rgba, width, height)
    }

    #[cfg(windows)]
    fn encode_test_png(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
        let mut png = Vec::new();
        let mut encoder = png::Encoder::new(&mut png, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("png header");
        writer.write_image_data(rgba).expect("png data");
        writer.finish().expect("png finish");
        png
    }

    #[cfg(windows)]
    fn draw_phone_png(width: i32, height: i32) -> Option<(Vec<u8>, NormBox)> {
        use std::mem::size_of;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{COLORREF, SIZE};
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, GetTextExtentPoint32W, SelectObject, SetBkMode, SetTextColor, TextOutW,
            ANTIALIASED_QUALITY, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, HFONT, HGDIOBJ, OUT_DEFAULT_PRECIS, TRANSPARENT,
        };
        let text: Vec<u16> = "010-1234-5678".encode_utf16().collect();
        let face: Vec<u16> = "Malgun Gothic\0".encode_utf16().collect();
        unsafe {
            let hdc = CreateCompatibleDC(None);
            if hdc.is_invalid() {
                return None;
            }
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
            let dib = CreateDIBSection(Some(hdc), &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
            let previous = SelectObject(hdc, HGDIOBJ(dib.0));
            if !bits.is_null() {
                let count = (width as usize) * (height as usize) * 4;
                std::ptr::write_bytes(bits as *mut u8, 255, count);
            }
            let corner = grid_tiles(3, width as u32, height as u32, TILE_OVERLAP).pop()?;
            let origin_x = corner.x as i32 + 28;
            let origin_y = corner.y as i32 + 28;
            let limit_w = corner.w as i32 - 56;
            let limit_h = corner.h as i32 - 56;
            if limit_w < 40 || limit_h < 40 {
                let _ = DeleteObject(HGDIOBJ(dib.0));
                let _ = DeleteDC(hdc);
                return None;
            }
            let mut font_px = (limit_h / 2).clamp(32, 180);
            let mut font = HFONT::default();
            let mut extent = SIZE::default();
            let mut measured = windows::core::BOOL(0);
            while font_px >= 32 {
                font = CreateFontW(
                    -font_px,
                    0,
                    0,
                    0,
                    700,
                    0,
                    0,
                    0,
                    DEFAULT_CHARSET,
                    OUT_DEFAULT_PRECIS,
                    CLIP_DEFAULT_PRECIS,
                    ANTIALIASED_QUALITY,
                    0,
                    PCWSTR(face.as_ptr()),
                );
                let previous_try = SelectObject(hdc, HGDIOBJ(font.0));
                measured = GetTextExtentPoint32W(hdc, &text, &mut extent);
                SelectObject(hdc, previous_try);
                if measured.as_bool() && extent.cx <= limit_w && extent.cy <= limit_h {
                    break;
                }
                let _ = DeleteObject(HGDIOBJ(font.0));
                font_px -= 4;
            }
            if font_px < 32 || !measured.as_bool() {
                let _ = DeleteObject(HGDIOBJ(dib.0));
                let _ = DeleteDC(hdc);
                return None;
            }
            let previous_font = SelectObject(hdc, HGDIOBJ(font.0));
            let _ = SetBkMode(hdc, TRANSPARENT);
            let _ = SetTextColor(hdc, COLORREF(0));
            let drawn = TextOutW(hdc, origin_x, origin_y, &text);
            let rgba = if drawn.as_bool() && measured.as_bool() && !bits.is_null() {
                let bgra = std::slice::from_raw_parts(bits as *const u8, (width as usize) * (height as usize) * 4);
                let mut rgba = vec![255u8; bgra.len()];
                for pixel in 0..(bgra.len() / 4) {
                    rgba[pixel * 4] = bgra[pixel * 4 + 2];
                    rgba[pixel * 4 + 1] = bgra[pixel * 4 + 1];
                    rgba[pixel * 4 + 2] = bgra[pixel * 4];
                    rgba[pixel * 4 + 3] = 255;
                }
                Some(rgba)
            } else {
                None
            };
            SelectObject(hdc, previous_font);
            SelectObject(hdc, previous);
            let _ = DeleteObject(HGDIOBJ(font.0));
            let _ = DeleteObject(HGDIOBJ(dib.0));
            let _ = DeleteDC(hdc);
            let rgba = rgba?;
            if extent.cx < 8 || extent.cy < 8 {
                return None;
            }
            let png = encode_test_png(&rgba, width as u32, height as u32);
            let expect = NormBox {
                x: origin_x as f64 / width as f64,
                y: origin_y as f64 / height as f64,
                w: extent.cx as f64 / width as f64,
                h: extent.cy as f64 / height as f64,
            };
            Some((png, expect))
        }
    }

    #[test]
    #[ignore]
    fn measure_windows_media_on_a_blank_frame() {
        let note = media::measure_blank();
        eprintln!("privacy-find-measure {note}");
        assert!(!note.is_empty());
    }
}
