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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindOutcome {
    pub regions: Vec<FoundBox>,
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
    let mut tiles = vec![PxRect { x: 0, y: 0, w: width, h: height }];
    for tile in grid_tiles(2, width, height, TILE_OVERLAP) {
        if tile.w >= MIN_TILE && tile.h >= MIN_TILE {
            tiles.push(tile);
        }
    }
    if width.min(height) >= FINE_SHORT_SIDE {
        for tile in grid_tiles(3, width, height, TILE_OVERLAP) {
            if tile.w >= MIN_TILE && tile.h >= MIN_TILE {
                tiles.push(tile);
            }
        }
    }
    tiles
}

pub fn map_detector_box(tile: PxRect, det_x: f64, det_y: f64, det_w: f64, det_h: f64, scale: f64, image_w: f64, image_h: f64) -> NormBox {
    let scale = if scale <= f64::EPSILON { 1.0 } else { scale };
    let image_w = image_w.max(1.0);
    let image_h = image_h.max(1.0);
    NormBox {
        x: (tile.x as f64 + det_x / scale) / image_w,
        y: (tile.y as f64 + det_y / scale) / image_h,
        w: (det_w / scale) / image_w,
        h: (det_h / scale) / image_h,
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
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapBounds, BitmapDecoder, BitmapPixelFormat, BitmapSize, BitmapTransform, ColorManagementMode, ExifOrientationMode, SoftwareBitmap};
    use windows::Media::FaceAnalysis::FaceDetector;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

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

    pub fn scan_file(app: &AppHandle, path: &Path, wish: Wish, run: u64, started: Instant) -> Result<FindOutcome, String> {
        let avail = Availability { face: facts().face, text: facts().text };
        let active = active_wish(wish, avail);
        let bytes = read_picture(path)?;
        let mut faces = Vec::new();
        let mut numbers = Vec::new();
        let mut plates = Vec::new();
        let mut texts = Vec::new();
        let mut reason = String::new();
        if active.face || active.number || active.plate || active.text {
            match decode_and_scan(app, &bytes, active, run, started) {
                Ok((found_faces, found_numbers, found_plates, found_texts, stop)) => {
                    faces = found_faces;
                    numbers = found_numbers;
                    plates = found_plates;
                    texts = found_texts;
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

    fn decode_and_scan(
        app: &AppHandle,
        bytes: &[u8],
        wish: Wish,
        run: u64,
        started: Instant,
    ) -> Result<(Vec<NormBox>, Vec<NormBox>, Vec<NormBox>, Vec<NormBox>, String), ()> {
        let stream = InMemoryRandomAccessStream::new().map_err(|_| ())?;
        let writer = DataWriter::CreateDataWriter(&stream).map_err(|_| ())?;
        writer.WriteBytes(bytes).map_err(|_| ())?;
        writer.StoreAsync().map_err(|_| ())?.get().map_err(|_| ())?;
        let _detached = writer.DetachStream().map_err(|_| ())?;
        stream.Seek(0).map_err(|_| ())?;
        let decoder = BitmapDecoder::CreateAsync(&stream).map_err(|_| ())?.get().map_err(|_| ())?;
        let width = decoder.OrientedPixelWidth().map_err(|_| ())?;
        let height = decoder.OrientedPixelHeight().map_err(|_| ())?;
        if width < 2 || height < 2 || u64::from(width) * u64::from(height) > MAX_PIXELS {
            return Err(());
        }
        let tiles = view_tiles(width, height);
        let mut faces = Vec::new();
        let mut numbers = Vec::new();
        let mut plates = Vec::new();
        let mut texts = Vec::new();
        let mut reason = String::new();
        if wish.face {
            let _ = app.emit("privacy-find-step", "face");
            if let Ok(detector) = FaceDetector::CreateAsync().and_then(|op| op.get()) {
                for (index, tile) in tiles.iter().enumerate() {
                    match keep_going(run, started) {
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
                    let max_long = if index == 0 { FACE_FULL_LONG } else { FACE_TILE_LONG };
                    if let Some(found) = detect_tile(&decoder, &detector, *tile, width, height, max_long) {
                        faces.extend(found);
                    }
                }
            }
        }
        if reason.is_empty() && (wish.number || wish.plate || wish.text) {
            let _ = app.emit("privacy-find-step", "text");
            let max_long = OcrEngine::MaxImageDimension().unwrap_or(0);
            if max_long > 0 {
                if let Some(engine) = korean_engine() {
                    for tile in &tiles {
                        match keep_going(run, started) {
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
                        if let Some(words) = read_tile(&decoder, &engine, *tile, width, height, max_long) {
                            let found = regions_from_words(&words, wish);
                            for region in found {
                                let area = NormBox { x: region.x, y: region.y, w: region.w, h: region.h };
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
        let _ = stream.Close();
        Ok((faces, numbers, plates, texts, reason))
    }

    fn korean_engine() -> Option<OcrEngine> {
        let tag = windows::core::HSTRING::from("ko");
        let language = Language::CreateLanguage(&tag).ok()?;
        if !OcrEngine::IsLanguageSupported(&language).unwrap_or(false) {
            return None;
        }
        OcrEngine::TryCreateFromLanguage(&language).ok()
    }

    fn detect_tile(decoder: &BitmapDecoder, detector: &FaceDetector, tile: PxRect, image_w: u32, image_h: u32, max_long: u32) -> Option<Vec<NormBox>> {
        let (bitmap, scale) = tile_bitmap(decoder, tile, BitmapPixelFormat::Gray8, max_long)?;
        let short = (bitmap.PixelWidth().unwrap_or(0) as u32).min(bitmap.PixelHeight().unwrap_or(0) as u32);
        if short > MIN_FACE {
            let _ = detector.SetMinDetectableFaceSize(BitmapSize { Width: MIN_FACE, Height: MIN_FACE });
        }
        let faces = detector.DetectFacesAsync(&bitmap).ok()?.get().ok()?;
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
                scale,
                f64::from(image_w),
                f64::from(image_h),
            );
            if let Some(area) = clamp_box(area) {
                out.push(area);
            }
        }
        let _ = bitmap.Close();
        Some(out)
    }

    fn read_tile(decoder: &BitmapDecoder, engine: &OcrEngine, tile: PxRect, image_w: u32, image_h: u32, max_long: u32) -> Option<Vec<WordBox>> {
        let (bitmap, scale) = tile_bitmap(decoder, tile, BitmapPixelFormat::Bgra8, max_long)?;
        let result = engine.RecognizeAsync(&bitmap).ok()?.get().ok()?;
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
                    scale,
                    f64::from(image_w),
                    f64::from(image_h),
                );
                let Some(area) = clamp_box(area) else { continue };
                words.push(WordBox { text, x: area.x, y: area.y, w: area.w, h: area.h });
            }
        }
        let _ = bitmap.Close();
        Some(words)
    }

    fn tile_bitmap(decoder: &BitmapDecoder, tile: PxRect, format: BitmapPixelFormat, max_long: u32) -> Option<(SoftwareBitmap, f64)> {
        let long = tile.w.max(tile.h).max(1);
        let limit = if max_long == 0 { long } else { max_long.max(1) };
        let scale = if long > limit { limit as f64 / long as f64 } else { 1.0 };
        let scaled_w = ((tile.w as f64) * scale).round().max(1.0) as u32;
        let scaled_h = ((tile.h as f64) * scale).round().max(1.0) as u32;
        let transform = BitmapTransform::new().ok()?;
        transform.SetBounds(BitmapBounds { X: tile.x, Y: tile.y, Width: tile.w, Height: tile.h }).ok()?;
        transform.SetScaledWidth(scaled_w).ok()?;
        transform.SetScaledHeight(scaled_h).ok()?;
        let bitmap = decoder
            .GetSoftwareBitmapTransformedAsync(format, BitmapAlphaMode::Ignore, &transform, ExifOrientationMode::RespectExifOrientation, ColorManagementMode::DoNotColorManage)
            .ok()?
            .get()
            .ok()?;
        let actual_w = bitmap.PixelWidth().unwrap_or(scaled_w as i32).max(1) as f64;
        Some((bitmap, actual_w / tile.w.max(1) as f64))
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

    pub fn scan_file(_app: &AppHandle, _path: &Path, _wish: Wish, _run: u64, started: Instant) -> Result<FindOutcome, String> {
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
    Ok(FindCaps { face: facts.face, text: facts.text })
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
) -> Result<FindOutcome, String> {
    if window.label() != "main" {
        return Err("이 창에서는 찾을 수 없습니다.".into());
    }
    let book = app.state::<path_grant::GrantBook>();
    let path = path_grant::view_read(&book, &read_id).map_err(|text| text.to_string())?;
    drop(book);
    let wish = Wish { face, number, plate, text };
    let run = begin_run();
    let started = Instant::now();
    let app_for_find = app.clone();
    tauri::async_runtime::spawn_blocking(move || media::scan_file(&app_for_find, &path, wish, run, started))
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
        let area = map_detector_box(tile, 10.0, 20.0, 30.0, 40.0, 0.5, 1000.0, 800.0);
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
    #[ignore]
    fn measure_windows_media_on_a_blank_frame() {
        let note = media::measure_blank();
        eprintln!("privacy-find-measure {note}");
        assert!(!note.is_empty());
    }
}
