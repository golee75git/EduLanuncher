//! 엑셀 통합용 표 읽기·저장.
//!
//! 읽기: `.xlsx`(첫 시트)와 UTF-8 `.csv`를 표로 읽는다. 공개 표준 ECMA-376(Office Open XML)만 보고
//! `zip` + `quick-xml`로 직접 읽으며, 원본은 읽기 전용으로만 연다.
//! 수식은 계산하지 않고 저장된 캐시값(`<v>`)만 읽는다. 외부 링크·매크로는 따라가지 않는다.
//!
//! 저장: 표를 새 `.xlsx` 한 개로 쓴다(`write_xlsx_new`). 최소 OOXML만 만들고, 글자는 모두
//! 문자열 셀(`inlineStr`)로 두므로 `=`·`+`·`-`·`@`로 시작해도 수식이 되지 않는다.
//! 이미 있는 파일은 덮어쓰지 않는다. 매크로·외부 링크·문서 속성은 넣지 않는다.
//!
//! 통합: 첫 파일의 첫 줄을 제목 줄로 삼고, 다른 파일은 제목 이름(공백·대소문자 무시)으로 열을 맞춰
//! 세로로 잇는다(`merge_tables`). 커맨드는 `excel_merge_glance`(파일 하나 미리 보기)와
//! `excel_merge_run`(통합 실행)이며, 파일은 path_grant 번호로만 받고 결과는 첫 파일 옆에 새 파일로 만든다.
//!
//! 병합: 기준 파일의 키 열로 다른 파일의 줄을 찾고, 고른 열의 빈 칸에만 값을 넣는다(`join_tables`).
//! 미리보기는 `excel_join_look`, 저장은 `excel_join_save`다. 보여줄 값은 40줄까지만 돌려준다.
//!
//! 오류 문구에는 경로나 셀 내용을 넣지 않는다.
//! 설계: docs/excel-merge-design-2026-11-23.md

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::path_grant;

pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PART_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 96 * 1024 * 1024;
const MAX_ENTRIES: usize = 256;
pub const MAX_ROWS: usize = 50_000;
pub const MAX_COLUMNS: usize = 200;
const MAX_CELL_CHARS: usize = 32_767;
const READ_FAIL: &str = "엑셀 파일을 읽지 못했습니다.";

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Cell {
    #[default]
    Empty,
    Text(String),
    Number(String),
}

impl Cell {
    pub fn is_blank(&self) -> bool {
        match self {
            Cell::Empty => true,
            Cell::Text(text) => text.trim().is_empty(),
            Cell::Number(_) => false,
        }
    }

    fn text(value: String) -> Cell {
        if value.is_empty() {
            Cell::Empty
        } else {
            Cell::Text(clip_chars(&value, MAX_CELL_CHARS))
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SheetTable {
    /// 완전히 빈 줄은 빼고, 줄 끝의 빈 칸도 뺀 표
    pub rows: Vec<Vec<Cell>>,
    /// 행·열 상한 때문에 일부를 잘랐으면 true
    pub limited: bool,
}

pub fn read_table(path: &Path) -> Result<SheetTable, String> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "xlsx" => read_xlsx(path),
        "csv" => read_csv(path),
        _ => Err("xlsx 또는 csv 파일만 읽을 수 있습니다. 엑셀에서 xlsx로 저장해 주세요.".into()),
    }
}

fn read_slot(path: &Path) -> Result<SheetTable, String> {
    if path_ext(path) == "pdf" {
        let parsed = crate::pdf_sheet::read_rows(path)?;
        return Ok(labels_to_table(parsed.rows, parsed.limited));
    }
    read_table(path)
}

fn labels_to_table(rows: Vec<Vec<String>>, mut limited: bool) -> SheetTable {
    let mut out = Vec::new();
    for row in rows {
        if out.len() >= MAX_ROWS {
            limited = true;
            break;
        }
        let mut cells = Vec::new();
        for label in row {
            if cells.len() >= MAX_COLUMNS {
                limited = true;
                break;
            }
            cells.push(Cell::text(label));
        }
        if cells.iter().all(|cell| cell.is_blank()) {
            continue;
        }
        out.push(cells);
    }
    SheetTable { rows: out, limited }
}

fn path_ext(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

fn spreadsheet_base(path: &Path) -> bool {
    matches!(path_ext(path).as_str(), "xlsx" | "csv")
}

// ---------------------------------------------------------------- xlsx

pub fn read_xlsx(path: &Path) -> Result<SheetTable, String> {
    let meta = std::fs::metadata(path).map_err(|_| READ_FAIL.to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err(READ_FAIL.into());
    }
    let file = File::open(path).map_err(|_| READ_FAIL.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| READ_FAIL.to_string())?;
    if archive.len() > MAX_ENTRIES {
        return Err(READ_FAIL.into());
    }
    let mut names = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| READ_FAIL.to_string())?;
        let name = entry.name().replace('\\', "/");
        if name.contains("..") {
            return Err(READ_FAIL.into());
        }
        if entry.is_file() {
            names.push(name);
        }
    }
    let mut budget = 0u64;
    let workbook = read_part(&mut archive, "xl/workbook.xml", &mut budget)?.unwrap_or_default();
    let rels = read_part(&mut archive, "xl/_rels/workbook.xml.rels", &mut budget)?.unwrap_or_default();
    let sheet_name = first_sheet_path(&names, &workbook, &rels)?;
    let shared_xml = read_part(&mut archive, "xl/sharedStrings.xml", &mut budget)?.unwrap_or_default();
    let styles_xml = read_part(&mut archive, "xl/styles.xml", &mut budget)?.unwrap_or_default();
    let sheet_xml = read_part(&mut archive, &sheet_name, &mut budget)?.ok_or_else(|| READ_FAIL.to_string())?;
    let shared = shared_strings(&shared_xml);
    let date_styles = date_style_flags(&styles_xml);
    let date1904 = uses_1904_dates(&workbook);
    Ok(parse_sheet(&sheet_xml, &shared, &date_styles, date1904))
}

fn read_part(archive: &mut ZipArchive<File>, name: &str, budget: &mut u64) -> Result<Option<String>, String> {
    if name.contains("..") || name.contains('\\') {
        return Err(READ_FAIL.into());
    }
    let entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(_) => return Ok(None),
    };
    if entry.size() > MAX_PART_BYTES {
        return Err(READ_FAIL.into());
    }
    *budget = budget.saturating_add(entry.size());
    if *budget > MAX_TOTAL_BYTES {
        return Err(READ_FAIL.into());
    }
    let mut bytes = Vec::new();
    entry
        .take(MAX_PART_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| READ_FAIL.to_string())?;
    if bytes.len() as u64 > MAX_PART_BYTES {
        return Err(READ_FAIL.into());
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

fn first_sheet_path(names: &[String], workbook: &str, rels: &str) -> Result<String, String> {
    if let Some(id) = first_sheet_rel_id(workbook) {
        if let Some(target) = rel_target(rels, &id) {
            return safe_sheet_path(&target).ok_or_else(|| READ_FAIL.to_string());
        }
    }
    names
        .iter()
        .filter(|name| {
            let lower = name.to_ascii_lowercase();
            lower.starts_with("xl/worksheets/sheet") && lower.ends_with(".xml")
        })
        .min()
        .cloned()
        .ok_or_else(|| READ_FAIL.to_string())
}

fn first_sheet_rel_id(xml: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element) | Event::Empty(element)) if local_name(element.name().as_ref()) == "sheet" => {
                for attr in element.attributes().flatten() {
                    if local_name(attr.key.as_ref()) == "id" {
                        let id = attr.value.as_ref().trim().to_string();
                        if !id.is_empty() {
                            return Some(id);
                        }
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

fn uses_1904_dates(workbook: &str) -> bool {
    let mut reader = Reader::from_str(workbook);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element) | Event::Empty(element)) if local_name(element.name().as_ref()) == "workbookPr" => {
                for attr in element.attributes().flatten() {
                    if local_name(attr.key.as_ref()) == "date1904" {
                        let value = attr.value.as_ref().to_ascii_lowercase();
                        return value == "1" || value == "true";
                    }
                }
                return false;
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    false
}

fn rel_target(xml: &str, id: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element) | Event::Empty(element)) if local_name(element.name().as_ref()) == "Relationship" => {
                let mut found = false;
                let mut target = String::new();
                for attr in element.attributes().flatten() {
                    match local_name(attr.key.as_ref()) {
                        "Id" => found = attr.value.as_ref().trim() == id,
                        "Target" => target = attr.value.as_ref().trim().to_string(),
                        _ => {}
                    }
                }
                if found && !target.is_empty() {
                    return Some(target);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

fn safe_sheet_path(target: &str) -> Option<String> {
    let target = target.replace('\\', "/");
    if target.contains("..") || target.contains(':') {
        return None;
    }
    let trimmed = target.trim_start_matches('/');
    let full = if trimmed.starts_with("xl/") {
        trimmed.to_string()
    } else if trimmed.starts_with("worksheets/") {
        format!("xl/{trimmed}")
    } else {
        return None;
    };
    let rest = full.strip_prefix("xl/worksheets/")?;
    if rest.is_empty() || rest.contains('/') || !rest.to_ascii_lowercase().ends_with(".xml") {
        return None;
    }
    if !rest.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-') {
        return None;
    }
    Some(full)
}

fn shared_strings(xml: &str) -> Vec<String> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_item = false;
    let mut in_text = false;
    let mut phonetic = 0usize;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) => match local_name(element.name().as_ref()) {
                "si" => {
                    in_item = true;
                    current.clear();
                }
                "rPh" if in_item => phonetic += 1,
                "t" if in_item && phonetic == 0 => in_text = true,
                _ => {}
            },
            Ok(Event::End(element)) => match local_name(element.name().as_ref()) {
                "si" => {
                    items.push(clip_chars(&current, MAX_CELL_CHARS));
                    current.clear();
                    in_item = false;
                    in_text = false;
                    phonetic = 0;
                }
                "rPh" => phonetic = phonetic.saturating_sub(1),
                "t" => in_text = false,
                _ => {}
            },
            Ok(Event::Text(text)) if in_text => {
                let raw: &str = text.as_ref();
                current.push_str(raw);
            }
            Ok(Event::GeneralRef(reference)) if in_text => push_reference(&mut current, &reference),
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    items
}

fn push_reference(out: &mut String, reference: &str) {
    let name: &str = reference;
    if let Some(number) = name.strip_prefix('#') {
        let code = match number.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok(),
            None => number.parse::<u32>().ok(),
        };
        if let Some(ch) = code.and_then(char::from_u32) {
            out.push(ch);
        }
        return;
    }
    match name {
        "amp" => out.push('&'),
        "lt" => out.push('<'),
        "gt" => out.push('>'),
        "quot" => out.push('"'),
        "apos" => out.push('\''),
        _ => {}
    }
}

/// `cellXfs`의 각 서식(번호 = 셀의 `s` 값)이 날짜·시간 표시인지
fn date_style_flags(xml: &str) -> Vec<bool> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut custom: Vec<(u32, String)> = Vec::new();
    let mut xf_ids: Vec<u32> = Vec::new();
    let mut in_cell_xfs = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) => match local_name(element.name().as_ref()) {
                "cellXfs" => in_cell_xfs = true,
                "xf" if in_cell_xfs => xf_ids.push(num_fmt_id(&element)),
                _ => {}
            },
            Ok(Event::Empty(element)) => match local_name(element.name().as_ref()) {
                "numFmt" => {
                    let mut id = None;
                    let mut code = String::new();
                    for attr in element.attributes().flatten() {
                        match local_name(attr.key.as_ref()) {
                            "numFmtId" => id = attr.value.as_ref().trim().parse::<u32>().ok(),
                            "formatCode" => code = unescape_attr(attr.value.as_ref()),
                            _ => {}
                        }
                    }
                    if let Some(id) = id {
                        custom.push((id, code));
                    }
                }
                "xf" if in_cell_xfs => xf_ids.push(num_fmt_id(&element)),
                _ => {}
            },
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "cellXfs" => in_cell_xfs = false,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    xf_ids
        .into_iter()
        .map(|id| match custom.iter().find(|(known, _)| *known == id) {
            Some((_, code)) => custom_is_date(code),
            None => builtin_is_date(id),
        })
        .collect()
}

fn num_fmt_id(element: &quick_xml::events::BytesStart<'_>) -> u32 {
    for attr in element.attributes().flatten() {
        if local_name(attr.key.as_ref()) == "numFmtId" {
            return attr.value.as_ref().trim().parse::<u32>().unwrap_or(0);
        }
    }
    0
}

fn unescape_attr(raw: &str) -> String {
    raw
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn builtin_is_date(id: u32) -> bool {
    matches!(id, 14..=22 | 27..=36 | 45..=47 | 50..=58)
}

fn custom_is_date(code: &str) -> bool {
    let mut quoted = false;
    let mut bracket = false;
    let mut escaped = false;
    for ch in code.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' | '_' | '*' if !quoted && !bracket => escaped = true,
            '"' if !bracket => quoted = !quoted,
            '[' if !quoted => bracket = true,
            ']' if !quoted => bracket = false,
            _ if quoted || bracket => {}
            'y' | 'Y' | 'd' | 'D' | 'h' | 'H' | 's' | 'S' | 'm' | 'M' => return true,
            _ => {}
        }
    }
    false
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Number,
    Shared,
    Inline,
    Text,
    Bool,
    Error,
}

fn parse_sheet(xml: &str, shared: &[String], date_styles: &[bool], date1904: bool) -> SheetTable {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut table = SheetTable::default();
    let mut row: Vec<Cell> = Vec::new();
    let mut in_row = false;
    let mut in_cell = false;
    let mut in_value = false;
    let mut in_inline = false;
    let mut in_text = false;
    let mut phonetic = 0usize;
    let mut column = 0usize;
    let mut kind = Kind::Number;
    let mut date_cell = false;
    let mut out_of_range = false;
    let mut text = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) => match local_name(element.name().as_ref()) {
                "row" => {
                    in_row = true;
                    row.clear();
                    column = 0;
                }
                "c" => {
                    in_cell = true;
                    in_value = false;
                    in_inline = false;
                    in_text = false;
                    phonetic = 0;
                    text.clear();
                    let start = cell_start(&element, column);
                    column = start.column;
                    kind = start.kind;
                    out_of_range = start.out_of_range;
                    date_cell = start.style.map(|index| date_styles.get(index).copied().unwrap_or(false)).unwrap_or(false);
                }
                "v" if in_cell => in_value = true,
                "is" if in_cell => in_inline = true,
                "rPh" if in_inline => phonetic += 1,
                "t" if in_inline && phonetic == 0 => in_text = true,
                _ => {}
            },
            Ok(Event::Empty(element)) => {
                if local_name(element.name().as_ref()) == "c" {
                    let start = cell_start(&element, column);
                    column = start.column.saturating_add(1);
                }
            }
            Ok(Event::End(element)) => match local_name(element.name().as_ref()) {
                "row" => {
                    if in_row {
                        while matches!(row.last(), Some(Cell::Empty)) {
                            row.pop();
                        }
                        if row.iter().any(|cell| !cell.is_blank()) {
                            if table.rows.len() >= MAX_ROWS {
                                table.limited = true;
                                break;
                            }
                            table.rows.push(std::mem::take(&mut row));
                        }
                    }
                    in_row = false;
                }
                "c" => {
                    if in_cell {
                        if out_of_range {
                            table.limited = true;
                        } else {
                            let value = finish_cell(kind, &text, shared, date_cell, date1904);
                            if !matches!(value, Cell::Empty) {
                                if row.len() <= column {
                                    row.resize(column + 1, Cell::Empty);
                                }
                                row[column] = value;
                            }
                        }
                        column = column.saturating_add(1);
                    }
                    in_cell = false;
                    in_value = false;
                    in_inline = false;
                    in_text = false;
                    text.clear();
                }
                "v" => in_value = false,
                "is" => in_inline = false,
                "rPh" => phonetic = phonetic.saturating_sub(1),
                "t" => in_text = false,
                _ => {}
            },
            Ok(Event::Text(chunk)) if in_value || in_text => {
                let raw: &str = chunk.as_ref();
                text.push_str(raw);
            }
            Ok(Event::GeneralRef(reference)) if in_value || in_text => push_reference(&mut text, &reference),
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    table
}

struct CellStart {
    column: usize,
    kind: Kind,
    style: Option<usize>,
    out_of_range: bool,
}

fn cell_start(element: &quick_xml::events::BytesStart<'_>, running: usize) -> CellStart {
    let mut column = running;
    let mut kind = Kind::Number;
    let mut style = None;
    let mut out_of_range = false;
    for attr in element.attributes().flatten() {
        let value = attr.value.as_ref().to_string();
        match local_name(attr.key.as_ref()) {
            "r" => match column_index(&value) {
                Some(index) => column = index,
                None => out_of_range = true,
            },
            "t" => {
                kind = match value.as_str() {
                    "s" => Kind::Shared,
                    "inlineStr" => Kind::Inline,
                    "str" | "d" => Kind::Text,
                    "b" => Kind::Bool,
                    "e" => Kind::Error,
                    _ => Kind::Number,
                }
            }
            "s" => style = value.trim().parse::<usize>().ok(),
            _ => {}
        }
    }
    if column >= MAX_COLUMNS {
        out_of_range = true;
    }
    CellStart { column, kind, style, out_of_range }
}

fn finish_cell(kind: Kind, text: &str, shared: &[String], date_cell: bool, date1904: bool) -> Cell {
    match kind {
        Kind::Shared => text
            .trim()
            .parse::<usize>()
            .ok()
            .and_then(|index| shared.get(index))
            .map(|value| Cell::text(value.clone()))
            .unwrap_or(Cell::Empty),
        Kind::Inline | Kind::Text | Kind::Error => Cell::text(text.to_string()),
        Kind::Bool => match text.trim() {
            "" => Cell::Empty,
            "0" => Cell::Text("FALSE".into()),
            _ => Cell::Text("TRUE".into()),
        },
        Kind::Number => {
            let raw = text.trim();
            if raw.is_empty() {
                return Cell::Empty;
            }
            let Ok(value) = raw.parse::<f64>() else {
                return Cell::text(raw.to_string());
            };
            if date_cell {
                if let Some(shown) = serial_to_text(value, date1904) {
                    return Cell::Text(shown);
                }
            }
            match number_text(value) {
                Some(shown) => Cell::Number(shown),
                None => Cell::text(raw.to_string()),
            }
        }
    }
}

/// 저장된 실수를 화면에서 보이는 15자리 유효숫자로 다듬는다 (0.30000000000000004 → 0.3)
fn number_text(value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    if value == value.trunc() && value.abs() < 1e15 {
        return Some(format!("{}", value as i64));
    }
    let rounded: f64 = format!("{:.14e}", value).parse().ok()?;
    Some(format!("{rounded}"))
}

/// 엑셀 날짜 시리얼 → "YYYY-MM-DD", 시각이 있으면 " HH:MM:SS" 덧붙임, 0일이면 시각만
fn serial_to_text(value: f64, date1904: bool) -> Option<String> {
    if !value.is_finite() || value < 0.0 || value >= 2_958_466.0 {
        return None;
    }
    let whole = value.floor();
    let mut days = whole as i64;
    let mut secs = ((value - whole) * 86_400.0).round() as i64;
    if secs >= 86_400 {
        days += 1;
        secs -= 86_400;
    }
    let clock = format!("{:02}:{:02}:{:02}", secs / 3600, (secs % 3600) / 60, secs % 60);
    if !date1904 && days == 0 {
        return Some(clock);
    }
    let unix_days = if date1904 {
        days - 24_107
    } else if days < 60 {
        days - 25_568
    } else {
        days - 25_569
    };
    let (year, month, day) = civil_from_days(unix_days);
    let date = format!("{year:04}-{month:02}-{day:02}");
    if secs == 0 {
        Some(date)
    } else {
        Some(format!("{date} {clock}"))
    }
}

/// 1970-01-01 기준 일수 → (연, 월, 일). 그레고리력 계산식
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

fn column_index(reference: &str) -> Option<usize> {
    let mut index = 0usize;
    let mut seen = false;
    for ch in reference.chars() {
        if !ch.is_ascii_alphabetic() {
            break;
        }
        seen = true;
        index = index.saturating_mul(26).saturating_add(ch.to_ascii_uppercase() as usize - b'A' as usize + 1);
        if index > MAX_COLUMNS {
            return None;
        }
    }
    if !seen {
        return None;
    }
    index.checked_sub(1)
}

fn local_name(text: &str) -> &str {
    text.rsplit(':').next().unwrap_or(text)
}

fn clip_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

// ---------------------------------------------------------------- csv

pub fn read_csv(path: &Path) -> Result<SheetTable, String> {
    let meta = std::fs::metadata(path).map_err(|_| "CSV 파일을 읽지 못했습니다.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err("CSV 파일을 읽지 못했습니다.".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "CSV 파일을 읽지 못했습니다.".to_string())?;
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let text = std::str::from_utf8(body).map_err(|_| "CSV는 UTF-8로 저장한 파일만 읽을 수 있습니다.".to_string())?;
    Ok(parse_csv(text))
}

fn parse_csv(text: &str) -> SheetTable {
    let mut table = SheetTable::default();
    let mut row: Vec<Cell> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut was_quoted = false;
    let mut chars = text.chars().peekable();
    let finish_field = |row: &mut Vec<Cell>, field: &mut String, was_quoted: &mut bool, table: &mut SheetTable| {
        if row.len() < MAX_COLUMNS {
            row.push(csv_cell(std::mem::take(field), *was_quoted));
        } else {
            table.limited = true;
            field.clear();
        }
        *was_quoted = false;
    };
    let finish_row = |row: &mut Vec<Cell>, table: &mut SheetTable| -> bool {
        while matches!(row.last(), Some(Cell::Empty)) {
            row.pop();
        }
        if row.iter().any(|cell| !cell.is_blank()) {
            if table.rows.len() >= MAX_ROWS {
                table.limited = true;
                row.clear();
                return false;
            }
            table.rows.push(std::mem::take(row));
        } else {
            row.clear();
        }
        true
    };
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else {
                field.push(ch);
            }
            continue;
        }
        match ch {
            '"' if field.is_empty() => {
                quoted = true;
                was_quoted = true;
            }
            ',' => finish_field(&mut row, &mut field, &mut was_quoted, &mut table),
            '\r' => {}
            '\n' => {
                finish_field(&mut row, &mut field, &mut was_quoted, &mut table);
                if !finish_row(&mut row, &mut table) {
                    return table;
                }
            }
            _ => field.push(ch),
        }
    }
    if !field.is_empty() || was_quoted || !row.is_empty() {
        finish_field(&mut row, &mut field, &mut was_quoted, &mut table);
        finish_row(&mut row, &mut table);
    }
    table
}

fn csv_cell(value: String, was_quoted: bool) -> Cell {
    if value.is_empty() {
        return Cell::Empty;
    }
    if !was_quoted && looks_numeric(&value) {
        Cell::Number(value)
    } else {
        Cell::text(value)
    }
}

/// 앞자리 0이 없는 평범한 숫자만 숫자로 본다 (학번·전화번호는 글자로 남긴다)
fn looks_numeric(value: &str) -> bool {
    let body = value.strip_prefix('-').unwrap_or(value);
    let (int_part, frac_part) = match body.split_once('.') {
        Some((int_part, frac_part)) => (int_part, Some(frac_part)),
        None => (body, None),
    };
    if int_part.is_empty() || !int_part.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    if int_part.len() > 1 && int_part.starts_with('0') {
        return false;
    }
    if let Some(frac) = frac_part {
        if frac.is_empty() || !frac.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }
    int_part.len() + frac_part.map(str::len).unwrap_or(0) <= 15
}

// ---------------------------------------------------------------- 저장

/// 엑셀 한 시트의 최대 행 수
const MAX_WRITE_ROWS: usize = 1_048_576;
const WRITE_FAIL: &str = "결과 엑셀 파일을 만들지 못했습니다.";
const SHEET_NAME: &str = "통합";

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#;

const WORKBOOK_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#;

const STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Malgun Gothic"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>"#;

/// 표를 새 `.xlsx` 파일로 저장한다. 이미 있는 파일은 덮어쓰지 않고 오류로 돌려준다.
/// 출력 위치가 원본 폴더 안인지는 호출하는 쪽(커맨드)이 확인한다.
pub fn write_xlsx_new(path: &Path, rows: &[Vec<Cell>]) -> Result<(), String> {
    let is_xlsx = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("xlsx"))
        .unwrap_or(false);
    if !is_xlsx {
        return Err(WRITE_FAIL.into());
    }
    if rows.len() > MAX_WRITE_ROWS {
        return Err("행이 너무 많아 한 시트에 담을 수 없습니다.".into());
    }
    if rows.iter().any(|row| row.len() > MAX_COLUMNS) {
        return Err("열이 너무 많아 결과 파일을 만들 수 없습니다.".into());
    }
    let sheet = sheet_xml(rows);
    let workbook = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets></workbook>"#
    );
    let file = OpenOptions::new().write(true).create_new(true).open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "같은 이름의 파일이 이미 있습니다.".to_string()
        } else {
            WRITE_FAIL.to_string()
        }
    })?;
    let parts: [(&str, &str); 6] = [
        ("[Content_Types].xml", CONTENT_TYPES),
        ("_rels/.rels", ROOT_RELS),
        ("xl/workbook.xml", &workbook),
        ("xl/_rels/workbook.xml.rels", WORKBOOK_RELS),
        ("xl/styles.xml", STYLES),
        ("xl/worksheets/sheet1.xml", &sheet),
    ];
    let result = (|| -> Result<(), String> {
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, body) in parts {
            writer.start_file(name, options).map_err(|_| WRITE_FAIL.to_string())?;
            writer.write_all(body.as_bytes()).map_err(|_| WRITE_FAIL.to_string())?;
        }
        writer.finish().map_err(|_| WRITE_FAIL.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(path);
    }
    result
}

fn sheet_xml(rows: &[Vec<Cell>]) -> String {
    let mut xml = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
    );
    for (row_index, row) in rows.iter().enumerate() {
        let row_number = row_index + 1;
        xml.push_str(&format!(r#"<row r="{row_number}">"#));
        for (column, cell) in row.iter().enumerate() {
            let reference = format!("{}{}", column_letters(column), row_number);
            match cell {
                Cell::Empty => {}
                Cell::Number(value) if writable_number(value) => {
                    xml.push_str(&format!(r#"<c r="{reference}"><v>{}</v></c>"#, value.trim()));
                }
                Cell::Number(value) | Cell::Text(value) => {
                    xml.push_str(&format!(
                        r#"<c r="{reference}" t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#,
                        xml_escape(&clip_chars(value, MAX_CELL_CHARS))
                    ));
                }
            }
        }
        xml.push_str("</row>");
    }
    xml.push_str("</sheetData></worksheet>");
    xml
}

/// 숫자 셀로 써도 되는 값인지 (엑셀이 읽을 수 있는 평범한 십진수만)
fn writable_number(value: &str) -> bool {
    let text = value.trim();
    !text.is_empty()
        && text.len() <= 32
        && text.bytes().all(|byte| byte.is_ascii_digit() || matches!(byte, b'-' | b'.'))
        && text.parse::<f64>().map(|parsed| parsed.is_finite()).unwrap_or(false)
}

fn column_letters(mut index: usize) -> String {
    let mut letters = Vec::new();
    loop {
        letters.push(b'A' + (index % 26) as u8);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    letters.reverse();
    String::from_utf8(letters).unwrap_or_default()
}

/// XML 글자 이스케이프. XML 1.0에서 쓸 수 없는 제어 문자는 뺀다.
fn xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\r' => out.push_str("&#13;"),
            '\t' | '\n' => out.push(ch),
            ch if ch < ' ' || ch == '\u{FFFE}' || ch == '\u{FFFF}' => {}
            ch => out.push(ch),
        }
    }
    out
}

// ---------------------------------------------------------------- 통합

const MAX_MERGE_FILES: usize = 20;
const MAX_UNMATCHED_LISTED: usize = 50;
const MAX_LABEL_CHARS: usize = 40;
const SOURCE_COLUMN: &str = "원본 파일";
const UNNAMED_COLUMN: &str = "(제목 없는 열)";

static EMPTY_CELL: Cell = Cell::Empty;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct MergeOutcome {
    /// 제목 줄 포함
    pub rows: Vec<Vec<Cell>>,
    pub data_rows: usize,
    pub files_used: usize,
    pub skipped_files: Vec<String>,
    /// (파일 이름, 열 이름). 맞출 열이 없어 버린 열. 목록은 일부만 담는다
    pub unmatched: Vec<(String, String)>,
    pub unmatched_total: usize,
    pub limited: bool,
    /// 파일마다 어떻게 됐는지. 넣은 순서대로 담는다
    pub files: Vec<FileReport>,
}

/// 합친 파일 하나의 결과. 줄 번호는 모두 1부터 센다.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FileReport {
    pub name: String,
    pub used: bool,
    pub reason: String,
    /// 원본에서 제목 줄이 있던 줄
    pub header_line: usize,
    pub data_rows: usize,
    /// 결과 파일에서 이 파일의 데이터가 놓인 첫 줄과 끝 줄
    pub first_row: usize,
    pub last_row: usize,
    pub unmatched_columns: usize,
}

pub struct MergeInput {
    pub name: String,
    pub table: SheetTable,
}

fn cell_text_of(cell: &Cell) -> &str {
    match cell {
        Cell::Text(text) | Cell::Number(text) => text,
        Cell::Empty => "",
    }
}

fn header_key(cell: &Cell) -> String {
    cell_text_of(cell).split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn note_unmatched(out: &mut MergeOutcome, file: &str, column: &str) {
    out.unmatched_total += 1;
    if out.unmatched.len() < MAX_UNMATCHED_LISTED {
        out.unmatched.push((file.to_string(), clip_chars(column.trim(), MAX_LABEL_CHARS)));
    }
}

const MAX_HEADER_SCAN: usize = 60;
const REASON_EMPTY: &str = "내용이 없습니다.";
const REASON_NO_DATA: &str = "제목 줄 아래에 합칠 줄이 없습니다.";
const REASON_ROW_LIMIT: &str = "줄 수 한도에 닿아 여기까지만 담았습니다.";
const REASON_NOT_REACHED: &str = "줄 수 한도에 닿아 담지 못했습니다.";
pub const REASON_UNREADABLE: &str = "파일을 읽지 못했습니다.";

fn row_is_blank(row: &[Cell]) -> bool {
    row.iter().all(Cell::is_blank)
}

fn first_filled_row(rows: &[Vec<Cell>]) -> Option<usize> {
    rows.iter().position(|row| !row_is_blank(row))
}

/// 첫 파일의 제목들을 모두 가진 줄을 앞쪽에서 찾는다. 제목 위에 표 이름이나 결재란이 있어도 찾는다.
fn find_header_row(rows: &[Vec<Cell>], wanted: &[String]) -> Option<usize> {
    let wanted: Vec<&String> = wanted.iter().filter(|key| !key.is_empty()).collect();
    if wanted.is_empty() {
        return None;
    }
    rows.iter().take(MAX_HEADER_SCAN).position(|row| {
        let keys: Vec<String> = row.iter().map(header_key).collect();
        wanted.iter().all(|key| keys.contains(*key))
    })
}

/// 같은 양식의 표 여러 개를 첫 표의 제목 줄 아래로 잇는다.
pub fn merge_tables(inputs: Vec<MergeInput>, add_source: bool) -> Result<MergeOutcome, String> {
    let mut out = MergeOutcome::default();
    let mut master_keys: Vec<String> = Vec::new();
    let mut width = 0usize;
    let mut has_master = false;
    let offset = usize::from(add_source);
    let mut inputs = inputs.into_iter();
    'files: while let Some(input) = inputs.next() {
        out.limited |= input.table.limited;
        let mut report = FileReport { name: input.name.clone(), ..FileReport::default() };
        let rows = input.table.rows;
        let header_at = if has_master {
            find_header_row(&rows, &master_keys).or_else(|| first_filled_row(&rows))
        } else {
            first_filled_row(&rows)
        };
        let Some(header_at) = header_at else {
            out.skipped_files.push(input.name);
            report.reason = REASON_EMPTY.into();
            out.files.push(report);
            continue;
        };
        report.header_line = header_at + 1;
        let mut lines = rows.into_iter().skip(header_at);
        let header = lines.next().unwrap_or_default();
        let data: Vec<Vec<Cell>> = lines.collect();
        let unmatched_before = out.unmatched_total;
        let map: Vec<Option<usize>> = if !has_master {
            if header.len() + offset > MAX_COLUMNS {
                return Err("열이 너무 많아 원본 파일 열을 붙일 수 없습니다.".into());
            }
            master_keys = header.iter().map(header_key).collect();
            width = header.len();
            let mut head = Vec::with_capacity(width + offset);
            if add_source {
                head.push(Cell::Text(SOURCE_COLUMN.to_string()));
            }
            head.extend(header.iter().cloned());
            out.rows.push(head);
            has_master = true;
            (0..width).map(Some).collect()
        } else {
            let mut used = vec![false; width];
            let mut map = Vec::with_capacity(header.len());
            for (index, cell) in header.iter().enumerate() {
                let key = header_key(cell);
                if key.is_empty() {
                    if data.iter().any(|row| row.get(index).is_some_and(|value| !value.is_blank())) {
                        note_unmatched(&mut out, &input.name, UNNAMED_COLUMN);
                    }
                    map.push(None);
                    continue;
                }
                match master_keys.iter().enumerate().position(|(at, known)| *known == key && !used[at]) {
                    Some(at) => {
                        used[at] = true;
                        map.push(Some(at));
                    }
                    None => {
                        note_unmatched(&mut out, &input.name, cell_text_of(cell));
                        map.push(None);
                    }
                }
            }
            map
        };
        let own_keys: Vec<String> = header.iter().map(header_key).collect();
        let rows_before = out.rows.len();
        let mut cut_short = false;
        for row in data {
            let repeats_header = (0..own_keys.len().max(row.len()))
                .all(|at| header_key(row.get(at).unwrap_or(&EMPTY_CELL)) == own_keys.get(at).cloned().unwrap_or_default());
            if repeats_header {
                continue;
            }
            let mut line = vec![Cell::Empty; width + offset];
            for (at, cell) in row.into_iter().enumerate() {
                if let Some(Some(target)) = map.get(at) {
                    line[offset + target] = cell;
                }
            }
            if line[offset..].iter().all(Cell::is_blank) {
                continue;
            }
            if out.rows.len() >= MAX_WRITE_ROWS {
                out.limited = true;
                cut_short = true;
                break;
            }
            if add_source {
                line[0] = Cell::text(input.name.clone());
            }
            out.rows.push(line);
            out.data_rows += 1;
        }
        out.files_used += 1;
        let added = out.rows.len() - rows_before;
        report.data_rows = added;
        report.used = added > 0;
        if added > 0 {
            report.first_row = rows_before + 1;
            report.last_row = out.rows.len();
        }
        report.unmatched_columns = out.unmatched_total - unmatched_before;
        if cut_short {
            report.reason = REASON_ROW_LIMIT.into();
        } else if added == 0 {
            report.reason = REASON_NO_DATA.into();
        }
        out.files.push(report);
        if cut_short {
            break 'files;
        }
    }
    for rest in inputs {
        out.files.push(FileReport { name: rest.name, reason: REASON_NOT_REACHED.into(), ..FileReport::default() });
    }
    if !has_master {
        return Err("합칠 내용이 없습니다. 첫 줄에 제목이 있는 엑셀 파일을 넣어 주세요.".into());
    }
    Ok(out)
}

fn file_label(path: &Path) -> String {
    path.file_name().and_then(|name| name.to_str()).unwrap_or("파일").to_string()
}

fn stem_label(path: &Path) -> String {
    let stem: String = path
        .file_stem()
        .and_then(|text| text.to_str())
        .unwrap_or("엑셀")
        .chars()
        .take(MAX_LABEL_CHARS)
        .collect();
    if stem.is_empty() {
        "엑셀".into()
    } else {
        stem
    }
}

fn result_file_name(title: &str, first: &Path) -> String {
    let trimmed = title.trim();
    let bare = match trimmed.get(trimmed.len().saturating_sub(5)..) {
        Some(tail) if tail.eq_ignore_ascii_case(".xlsx") => trimmed[..trimmed.len() - 5].trim(),
        _ => trimmed,
    };
    let custom = crate::pdf_pages::tidy_merge_title(bare);
    if custom.is_empty() {
        format!("{}_취합.xlsx", stem_label(first))
    } else {
        format!("{custom}.xlsx")
    }
}

fn same_file(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => left == right,
    }
}

fn fresh_xlsx(dir: &Path, file_name: &str, sources: &[PathBuf]) -> Result<PathBuf, String> {
    let stem = Path::new(file_name).file_stem().and_then(|text| text.to_str()).unwrap_or("엑셀");
    for index in 1..=99 {
        let name = if index == 1 { format!("{stem}.xlsx") } else { format!("{stem}_{index}.xlsx") };
        let candidate = dir.join(name);
        if candidate.exists() || sources.iter().any(|source| same_file(source, &candidate)) {
            continue;
        }
        return Ok(candidate);
    }
    Err("같은 이름의 파일이 너무 많습니다.".into())
}

/// 원본들을 읽어 합치고, 첫 파일 옆에 새 xlsx로 저장한다. 원본은 바꾸지 않는다.
fn merge_files(sources: &[PathBuf], title: &str, add_source: bool) -> Result<(PathBuf, MergeOutcome), String> {
    let first = sources.first().ok_or_else(|| "엑셀 파일을 넣어 주세요.".to_string())?;
    let dir = first.parent().ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    let mut inputs = Vec::new();
    let mut unreadable = Vec::new();
    for source in sources {
        match read_table(source) {
            Ok(table) => inputs.push(MergeInput { name: file_label(source), table }),
            Err(_) => unreadable.push(file_label(source)),
        }
    }
    if inputs.is_empty() {
        return Err("읽을 수 있는 엑셀 파일이 없습니다. xlsx 또는 UTF-8 csv 파일을 넣어 주세요.".into());
    }
    let mut outcome = merge_tables(inputs, add_source)?;
    for name in &unreadable {
        outcome.files.push(FileReport { name: name.clone(), reason: REASON_UNREADABLE.into(), ..FileReport::default() });
    }
    outcome.skipped_files.extend(unreadable);
    let dest = fresh_xlsx(dir, &result_file_name(title, first), sources)?;
    write_xlsx_new(&dest, &outcome.rows)?;
    Ok((dest, outcome))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelGlance {
    pub data_rows: u32,
    pub columns: u32,
    pub header: Vec<String>,
    pub limited: bool,
}

#[derive(Serialize)]
pub struct UnmatchedColumn {
    pub file: String,
    pub column: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelFileResult {
    pub name: String,
    pub used: bool,
    pub reason: String,
    pub header_line: u32,
    pub data_rows: u32,
    pub first_row: u32,
    pub last_row: u32,
    pub unmatched_columns: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelMade {
    pub name: String,
    pub reveal_id: String,
    pub data_rows: u32,
    pub files_used: u32,
    pub skipped_files: Vec<String>,
    pub unmatched: Vec<UnmatchedColumn>,
    pub unmatched_total: u32,
    pub limited: bool,
    pub files: Vec<ExcelFileResult>,
}

fn granted_table(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let book = app.state::<path_grant::GrantBook>();
    path_grant::view_read(&book, id).map_err(|text| text.to_string())
}

/// 파일 하나의 제목 줄과 줄 수를 미리 본다 (원본은 읽기만 한다)
#[tauri::command(async)]
pub fn excel_merge_glance(app: AppHandle, id: String) -> Result<ExcelGlance, String> {
    let path = granted_table(&app, &id)?;
    let table = read_table(&path)?;
    let header: Vec<String> = table
        .rows
        .first()
        .map(|row| row.iter().map(|cell| clip_chars(cell_text_of(cell).trim(), MAX_LABEL_CHARS)).collect())
        .unwrap_or_default();
    Ok(ExcelGlance {
        data_rows: table.rows.len().saturating_sub(1) as u32,
        columns: header.len() as u32,
        header,
        limited: table.limited,
    })
}

/// 합치기 전에 파일마다 제목 줄이 어디인지, 첫 파일에 없는 열이 무엇인지 미리 본다.
#[derive(Debug, Default, PartialEq, Eq)]
struct Review {
    header_line: usize,
    data_rows: usize,
    missing: Vec<String>,
}

fn review_tables(tables: &[Option<&[Vec<Cell>]>]) -> Vec<Review> {
    let mut master_keys: Option<Vec<String>> = None;
    let mut out = Vec::with_capacity(tables.len());
    for table in tables {
        let Some(rows) = table else {
            out.push(Review::default());
            continue;
        };
        let header_at = match &master_keys {
            Some(keys) => find_header_row(rows, keys).or_else(|| first_filled_row(rows)),
            None => first_filled_row(rows),
        };
        let Some(at) = header_at else {
            out.push(Review::default());
            continue;
        };
        let header = &rows[at];
        let data_rows = rows[at + 1..].iter().filter(|row| !row_is_blank(row)).count();
        let mut missing: Vec<String> = Vec::new();
        match &master_keys {
            None => master_keys = Some(header.iter().map(header_key).collect()),
            Some(keys) => {
                let mut seen: Vec<String> = Vec::new();
                for cell in header {
                    let key = header_key(cell);
                    if key.is_empty() || keys.contains(&key) || seen.contains(&key) {
                        continue;
                    }
                    seen.push(key);
                    missing.push(clip_chars(cell_text_of(cell).trim(), MAX_LABEL_CHARS));
                }
            }
        }
        out.push(Review { header_line: at + 1, data_rows, missing });
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelReview {
    pub id: String,
    pub header_line: u32,
    pub data_rows: u32,
    pub missing: Vec<String>,
}

/// 고른 순서대로 파일마다 제목 줄 위치와 첫 파일에 없는 열을 미리 알려 준다 (원본은 읽기만 한다)
#[tauri::command(async)]
pub fn excel_merge_review(app: AppHandle, ids: Vec<String>) -> Result<Vec<ExcelReview>, String> {
    if ids.len() > MAX_MERGE_FILES {
        return Err(format!("한 번에 {MAX_MERGE_FILES}개까지 합칠 수 있습니다."));
    }
    let mut tables: Vec<Option<SheetTable>> = Vec::with_capacity(ids.len());
    for id in &ids {
        let path = granted_table(&app, id)?;
        tables.push(read_table(&path).ok());
    }
    let borrowed: Vec<Option<&[Vec<Cell>]>> = tables.iter().map(|table| table.as_ref().map(|t| t.rows.as_slice())).collect();
    let reviews = review_tables(&borrowed);
    Ok(ids
        .into_iter()
        .zip(reviews)
        .map(|(id, review)| ExcelReview {
            id,
            header_line: review.header_line as u32,
            data_rows: review.data_rows as u32,
            missing: review.missing,
        })
        .collect())
}

/// 고른 파일들을 하나로 합쳐 첫 파일 옆에 새 xlsx로 저장한다
#[tauri::command(async)]
pub fn excel_merge_run(app: AppHandle, ids: Vec<String>, title: String, add_source: bool) -> Result<ExcelMade, String> {
    if ids.is_empty() {
        return Err("엑셀 파일을 넣어 주세요.".into());
    }
    if ids.len() > MAX_MERGE_FILES {
        return Err(format!("한 번에 {MAX_MERGE_FILES}개까지 합칠 수 있습니다."));
    }
    let sources = ids.iter().map(|id| granted_table(&app, id)).collect::<Result<Vec<_>, _>>()?;
    let dir = sources
        .first()
        .and_then(|path| path.parent())
        .ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    path_grant::output_dir_allowed(dir).map_err(|text| text.to_string())?;
    let (dest, outcome) = merge_files(&sources, &title, add_source)?;
    let book = app.state::<path_grant::GrantBook>();
    let write_id = path_grant::begin_derived_write(&book, &dest).map_err(|text| text.to_string())?;
    let card = match path_grant::finish_made(&book, write_id) {
        Ok(card) => card,
        Err(text) => {
            path_grant::drop_grant(&book, write_id);
            return Err(text.to_string());
        }
    };
    Ok(ExcelMade {
        name: card.name,
        reveal_id: card.reveal_id,
        data_rows: outcome.data_rows as u32,
        files_used: outcome.files_used as u32,
        skipped_files: outcome.skipped_files,
        unmatched: outcome
            .unmatched
            .into_iter()
            .map(|(file, column)| UnmatchedColumn { file, column })
            .collect(),
        unmatched_total: outcome.unmatched_total as u32,
        limited: outcome.limited,
        files: outcome
            .files
            .into_iter()
            .map(|file| ExcelFileResult {
                name: file.name,
                used: file.used,
                reason: file.reason,
                header_line: file.header_line as u32,
                data_rows: file.data_rows as u32,
                first_row: file.first_row as u32,
                last_row: file.last_row as u32,
                unmatched_columns: file.unmatched_columns as u32,
            })
            .collect(),
    })
}

// ---------------------------------------------------------------- 병합

const MAX_JOIN_PAIRS: usize = 40;
const MAX_JOIN_SHOWN: usize = 40;
const MAX_JOIN_NOTES: usize = 8;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinPair {
    pub file_index: u32,
    pub source: String,
    pub target: String,
}

struct Slot {
    name: String,
    table: Option<SheetTable>,
}

struct JoinBuilt {
    rows: Vec<Vec<Cell>>,
    shown: Vec<JoinShown>,
    fill_count: usize,
    keep_count: usize,
    miss_count: usize,
    notes: Vec<String>,
    limited: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinShown {
    pub key: String,
    pub column: String,
    pub value: String,
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinLook {
    pub shown: Vec<JoinShown>,
    pub fill_count: u32,
    pub keep_count: u32,
    pub miss_count: u32,
    pub notes: Vec<String>,
    pub limited: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinMade {
    pub name: String,
    pub reveal_id: String,
    pub fill_count: u32,
    pub keep_count: u32,
    pub miss_count: u32,
    pub notes: Vec<String>,
    pub limited: bool,
}

fn name_key(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// 값 채우기에서 같은 줄을 찾는 키. 띄어쓰기를 무시하고, 학교 이름의 긴 끝말과 짧은 끝말을 같게 본다.
/// OO초 = OO초등학교, OO중 = OO중학교, OO고 = OO고등학교, OO유 = OO유치원.
fn value_key(text: &str) -> String {
    let squeezed: String = name_key(text).split_whitespace().collect();
    squeezed
        .replace("초등학교", "초")
        .replace("중학교", "중")
        .replace("고등학교", "고")
        .replace("유치원", "유")
}

fn clip_label(text: &str) -> String {
    clip_chars(text.trim(), MAX_LABEL_CHARS)
}

fn column_at(header: &[Cell], name: &str) -> Option<usize> {
    let want = name_key(name);
    if want.is_empty() {
        return None;
    }
    header.iter().position(|cell| header_key(cell) == want)
}

fn repeats_header(header: &[Cell], row: &[Cell]) -> bool {
    let width = header.len().max(row.len());
    (0..width).all(|at| header_key(row.get(at).unwrap_or(&EMPTY_CELL)) == header_key(header.get(at).unwrap_or(&EMPTY_CELL)))
}

fn pad_row(row: &mut Vec<Cell>, len: usize) {
    if row.len() < len {
        row.resize(len, Cell::Empty);
    }
}

fn push_note(notes: &mut Vec<String>, text: String) {
    if notes.len() < MAX_JOIN_NOTES && notes.iter().all(|item| item != &text) {
        notes.push(text);
    }
}

fn slots_from(paths: &[PathBuf]) -> Vec<Slot> {
    paths
        .iter()
        .map(|path| Slot {
            name: file_label(path),
            table: read_slot(path).ok(),
        })
        .collect()
}

/// 기준 표의 키와 같은 줄에서, 다른 표의 열 값을 빈 칸에만 넣는다.
fn join_tables(mut slots: Vec<Slot>, key_name: &str, pairs: &[JoinPair]) -> Result<JoinBuilt, String> {
    let key_name = clip_label(key_name);
    if name_key(&key_name).is_empty() {
        return Err("맞출 열을 골라 주세요.".into());
    }
    if pairs.is_empty() {
        return Err("가져올 열과 넣을 열을 골라 주세요.".into());
    }
    if pairs.len() > MAX_JOIN_PAIRS {
        return Err(format!("한 번에 {MAX_JOIN_PAIRS}개 열까지 넣을 수 있습니다."));
    }
    let base = slots
        .first_mut()
        .and_then(|slot| slot.table.take())
        .ok_or_else(|| "기준 파일을 읽지 못했습니다.".to_string())?;
    if base.rows.len() < 2 {
        return Err("기준 파일의 첫 줄에 제목이 있고, 그 아래 내용이 있어야 합니다.".into());
    }
    let mut limited = base.limited;
    let mut rows = base.rows;
    let header = rows.first().cloned().unwrap_or_default();
    if column_at(&header, &key_name).is_none() {
        return Err("기준 파일에 고른 맞출 열이 없습니다.".into());
    }
    let base_key_at = column_at(&header, &key_name).unwrap_or(0);
    let mut notes = Vec::new();
    let mut fills = Vec::new();
    let mut keeps = Vec::new();
    let mut fill_count = 0usize;
    let mut keep_count = 0usize;
    let mut miss_count = 0usize;

    for pair in pairs {
        let index = pair.file_index as usize;
        if index == 0 || index >= slots.len() {
            push_note(&mut notes, "가져올 파일을 다시 골라 주세요.".into());
            continue;
        }
        let source_name = clip_label(&pair.source);
        let target_name = clip_label(&pair.target);
        if name_key(&source_name).is_empty() || name_key(&target_name).is_empty() {
            push_note(&mut notes, "가져올 열과 넣을 열을 모두 골라 주세요.".into());
            continue;
        }
        let file_name = clip_label(&slots[index].name);
        let Some(table) = slots[index].table.as_ref() else {
            push_note(&mut notes, format!("{file_name} 파일을 읽지 못했습니다."));
            continue;
        };
        limited |= table.limited;
        let Some(source_header) = table.rows.first() else {
            push_note(&mut notes, format!("{file_name} 파일에 제목 줄이 없습니다."));
            continue;
        };
        let Some(source_key_at) = column_at(source_header, &key_name) else {
            push_note(&mut notes, format!("{file_name} 파일에 맞출 열이 없습니다."));
            continue;
        };
        let Some(source_col) = column_at(source_header, &source_name) else {
            push_note(&mut notes, format!("{file_name} 파일에 가져올 열이 없습니다."));
            continue;
        };
        if source_key_at == source_col {
            push_note(&mut notes, "맞출 열과 가져올 열은 서로 달라야 합니다.".into());
            continue;
        }
        let source_header = source_header.clone();
        let mut bag: HashMap<String, Cell> = HashMap::new();
        let mut repeated = false;
        for row in table.rows.iter().skip(1) {
            if repeats_header(&source_header, row) {
                continue;
            }
            let key = value_key(&cell_text_of(row.get(source_key_at).unwrap_or(&EMPTY_CELL)));
            if key.is_empty() {
                continue;
            }
            let cell = row.get(source_col).cloned().unwrap_or(Cell::Empty);
            if cell.is_blank() {
                continue;
            }
            match bag.get(&key) {
                None => {
                    bag.insert(key, cell);
                }
                Some(prev) if cell_text_of(prev) != cell_text_of(&cell) => repeated = true,
                _ => {}
            }
        }
        if repeated {
            push_note(&mut notes, format!("{file_name} 파일은 같은 키가 여러 줄이라 먼저 나온 값을 씁니다."));
        }
        let target_at = if let Some(found) = column_at(rows.first().unwrap_or(&Vec::new()), &target_name) {
            if found == base_key_at {
                push_note(&mut notes, "넣을 열은 맞출 열과 달라야 합니다.".into());
                continue;
            }
            found
        } else {
            let width = rows.first().map(|row| row.len()).unwrap_or(0);
            if width >= MAX_COLUMNS {
                limited = true;
                push_note(&mut notes, "열이 너무 많아 더 붙이지 못했습니다.".into());
                continue;
            }
            if let Some(head) = rows.first_mut() {
                head.push(Cell::text(target_name.clone()));
            }
            width
        };
        for row in rows.iter_mut().skip(1) {
            if repeats_header(&header, row) {
                continue;
            }
            pad_row(row, target_at + 1);
            let raw_key = cell_text_of(row.get(base_key_at).unwrap_or(&EMPTY_CELL)).to_string();
            let key = value_key(&raw_key);
            if key.is_empty() {
                continue;
            }
            let Some(incoming) = bag.get(&key).cloned() else {
                miss_count += 1;
                continue;
            };
            let shown_key = clip_label(&raw_key);
            let shown_column = clip_label(&target_name);
            let shown_value = clip_label(cell_text_of(&incoming));
            if row.get(target_at).is_some_and(|cell| !cell.is_blank()) {
                keep_count += 1;
                if keeps.len() < MAX_JOIN_SHOWN {
                    keeps.push(JoinShown {
                        key: shown_key,
                        column: shown_column,
                        value: shown_value,
                        kind: "그대로".into(),
                    });
                }
                continue;
            }
            row[target_at] = incoming;
            fill_count += 1;
            if fills.len() < MAX_JOIN_SHOWN {
                fills.push(JoinShown {
                    key: shown_key,
                    column: shown_column,
                    value: shown_value,
                    kind: "넣음".into(),
                });
            }
        }
    }

    if miss_count > 0 {
        push_note(&mut notes, format!("다른 파일에 없는 키 {miss_count}건"));
    }
    let mut shown = fills;
    for line in keeps {
        if shown.len() >= MAX_JOIN_SHOWN {
            break;
        }
        shown.push(line);
    }
    Ok(JoinBuilt { rows, shown, fill_count, keep_count, miss_count, notes, limited })
}

fn join_file_name(title: &str, first: &Path) -> String {
    let trimmed = title.trim();
    let bare = match trimmed.get(trimmed.len().saturating_sub(5)..) {
        Some(tail) if tail.eq_ignore_ascii_case(".xlsx") => trimmed[..trimmed.len() - 5].trim(),
        _ => trimmed,
    };
    let custom = crate::pdf_pages::tidy_merge_title(bare);
    if custom.is_empty() {
        format!("{}_병합.xlsx", stem_label(first))
    } else {
        format!("{custom}.xlsx")
    }
}

fn look_from(built: JoinBuilt) -> JoinLook {
    JoinLook {
        shown: built.shown,
        fill_count: built.fill_count as u32,
        keep_count: built.keep_count as u32,
        miss_count: built.miss_count as u32,
        notes: built.notes,
        limited: built.limited,
    }
}

fn granted_paths(app: &AppHandle, ids: &[String]) -> Result<Vec<PathBuf>, String> {
    if ids.len() < 2 {
        return Err("기준 파일과 값을 가져올 파일을 넣어 주세요.".into());
    }
    if ids.len() > MAX_MERGE_FILES {
        return Err(format!("한 번에 {MAX_MERGE_FILES}개까지 넣을 수 있습니다."));
    }
    let paths = ids.iter().map(|id| granted_table(app, id)).collect::<Result<Vec<_>, _>>()?;
    if !paths.first().is_some_and(|path| spreadsheet_base(path)) {
        return Err("기준 파일은 xlsx 또는 csv입니다.".into());
    }
    Ok(paths)
}

/// 맞출 키와 넣을 값을 미리 본다. 원본은 읽기만 하고 파일을 만들지 않는다.
#[tauri::command(async)]
pub fn excel_join_look(app: AppHandle, ids: Vec<String>, key: String, pairs: Vec<JoinPair>) -> Result<JoinLook, String> {
    let paths = granted_paths(&app, &ids)?;
    let built = join_tables(slots_from(&paths), &key, &pairs)?;
    Ok(look_from(built))
}

/// 빈 칸에 값을 넣은 새 xlsx를 첫 파일 옆에 만든다. 원본은 바꾸지 않는다.
#[tauri::command(async)]
pub fn excel_join_save(
    app: AppHandle,
    ids: Vec<String>,
    title: String,
    key: String,
    pairs: Vec<JoinPair>,
) -> Result<JoinMade, String> {
    let paths = granted_paths(&app, &ids)?;
    let dir = paths
        .first()
        .and_then(|path| path.parent())
        .ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    path_grant::output_dir_allowed(dir).map_err(|text| text.to_string())?;
    let built = join_tables(slots_from(&paths), &key, &pairs)?;
    if built.fill_count == 0 {
        return Err("넣을 값이 없습니다. 비어 있는 칸이 있는 열을 골라 주세요.".into());
    }
    let first = paths.first().ok_or_else(|| "엑셀 파일을 넣어 주세요.".to_string())?;
    let dest = fresh_xlsx(dir, &join_file_name(&title, first), &paths)?;
    write_xlsx_new(&dest, &built.rows)?;
    let book = app.state::<path_grant::GrantBook>();
    let write_id = path_grant::begin_derived_write(&book, &dest).map_err(|text| text.to_string())?;
    let card = match path_grant::finish_made(&book, write_id) {
        Ok(card) => card,
        Err(text) => {
            path_grant::drop_grant(&book, write_id);
            return Err(text.to_string());
        }
    };
    Ok(JoinMade {
        name: card.name,
        reveal_id: card.reveal_id,
        fill_count: built.fill_count as u32,
        keep_count: built.keep_count as u32,
        miss_count: built.miss_count as u32,
        notes: built.notes,
        limited: built.limited,
    })
}

const PREVIEW_ROWS: usize = 8;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSheetLook {
    pub data_rows: u32,
    pub columns: u32,
    pub header: Vec<String>,
    pub preview: Vec<Vec<String>>,
    pub limited: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSheetMade {
    pub name: String,
    pub reveal_id: String,
    pub data_rows: u32,
    pub limited: bool,
}

fn header_of(table: &SheetTable) -> Vec<String> {
    table
        .rows
        .first()
        .map(|row| row.iter().map(|cell| clip_chars(cell_text_of(cell).trim(), MAX_LABEL_CHARS)).collect())
        .unwrap_or_default()
}

fn preview_of(table: &SheetTable) -> Vec<Vec<String>> {
    table
        .rows
        .iter()
        .take(PREVIEW_ROWS)
        .map(|row| row.iter().map(|cell| clip_chars(cell_text_of(cell).trim(), MAX_LABEL_CHARS)).collect())
        .collect()
}

fn sheet_stem(path: &Path) -> String {
    let stem: String = path
        .file_stem()
        .and_then(|text| text.to_str())
        .unwrap_or("문서")
        .chars()
        .take(MAX_LABEL_CHARS)
        .collect();
    if stem.is_empty() { "문서".into() } else { stem }
}

fn sheet_file_name(title: &str, first: &Path) -> String {
    let trimmed = title.trim();
    let bare = match trimmed.get(trimmed.len().saturating_sub(5)..) {
        Some(tail) if tail.eq_ignore_ascii_case(".xlsx") => trimmed[..trimmed.len() - 5].trim(),
        _ => trimmed,
    };
    let custom = crate::pdf_pages::tidy_merge_title(bare);
    if custom.is_empty() {
        format!("{}_엑셀.xlsx", sheet_stem(first))
    } else {
        format!("{custom}.xlsx")
    }
}

fn finish_made_file(app: &AppHandle, dest: &Path) -> Result<(String, String), String> {
    let book = app.state::<path_grant::GrantBook>();
    let write_id = path_grant::begin_derived_write(&book, dest).map_err(|text| text.to_string())?;
    match path_grant::finish_made(&book, write_id) {
        Ok(card) => Ok((card.name, card.reveal_id)),
        Err(text) => {
            path_grant::drop_grant(&book, write_id);
            Err(text.to_string())
        }
    }
}

/// xlsx·csv·글자 PDF의 제목 줄을 본다. 값 채우기에서 PDF를 추가 파일로 고를 때 쓴다.
#[tauri::command(async)]
pub fn sheet_glance(app: AppHandle, id: String) -> Result<ExcelGlance, String> {
    let path = granted_table(&app, &id)?;
    let table = read_slot(&path)?;
    let header = header_of(&table);
    Ok(ExcelGlance {
        data_rows: table.rows.len().saturating_sub(1) as u32,
        columns: header.len() as u32,
        header,
        limited: table.limited,
    })
}

/// PDF 글자 표의 앞부분을 본다. 파일은 만들지 않는다.
#[tauri::command(async)]
pub fn pdf_sheet_look(app: AppHandle, id: String) -> Result<PdfSheetLook, String> {
    let path = granted_table(&app, &id)?;
    if path_ext(&path) != "pdf" {
        return Err("PDF 파일을 골라 주세요.".into());
    }
    let table = read_slot(&path)?;
    let header = header_of(&table);
    Ok(PdfSheetLook {
        data_rows: table.rows.len().saturating_sub(1) as u32,
        columns: header.len() as u32,
        header,
        preview: preview_of(&table),
        limited: table.limited,
    })
}

/// 글자가 있는 PDF를 새 xlsx로 저장한다. 원본은 바꾸지 않는다.
#[tauri::command(async)]
pub fn pdf_sheet_save(app: AppHandle, id: String, title: String) -> Result<PdfSheetMade, String> {
    let path = granted_table(&app, &id)?;
    if path_ext(&path) != "pdf" {
        return Err("PDF 파일을 골라 주세요.".into());
    }
    let dir = path.parent().ok_or_else(|| "저장 폴더를 찾지 못했습니다.".to_string())?;
    path_grant::output_dir_allowed(dir).map_err(|text| text.to_string())?;
    let table = read_slot(&path)?;
    if table.rows.is_empty() {
        return Err("글자가 없는 PDF는 엑셀로 바꾸지 않습니다.".into());
    }
    let dest = fresh_xlsx(dir, &sheet_file_name(&title, &path), &[path.clone()])?;
    write_xlsx_new(&dest, &table.rows)?;
    let (name, reveal_id) = finish_made_file(&app, &dest)?;
    Ok(PdfSheetMade {
        name,
        reveal_id,
        data_rows: table.rows.len().saturating_sub(1) as u32,
        limited: table.limited,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::sync::atomic::{AtomicU32, Ordering};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_file(ext: &str) -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("excel_merge_test_{}_{}.{}", std::process::id(), n, ext))
    }

    fn write_xlsx(parts: &[(&str, &str)]) -> std::path::PathBuf {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            for (name, body) in parts {
                writer.start_file(*name, options).unwrap();
                writer.write_all(body.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }
        let path = temp_file("xlsx");
        std::fs::write(&path, cursor.into_inner()).unwrap();
        path
    }

    const WORKBOOK: &str = r#"<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#;
    const RELS: &str = r#"<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>"#;

    fn sheet(body: &str) -> String {
        format!(r#"<worksheet><sheetData>{body}</sheetData></worksheet>"#)
    }

    fn read(parts: &[(&str, &str)]) -> Result<SheetTable, String> {
        let path = write_xlsx(parts);
        let result = read_xlsx(&path);
        let _ = std::fs::remove_file(&path);
        result
    }

    fn text(value: &str) -> Cell {
        Cell::Text(value.to_string())
    }

    fn number(value: &str) -> Cell {
        Cell::Number(value.to_string())
    }

    #[test]
    fn reads_shared_strings_numbers_and_column_gaps() {
        let sheet_xml = sheet(
            r#"<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
               <row r="2"><c r="A2"><v>12</v></c><c r="B2"><v>3.5</v></c></row>
               <row r="3"><c r="A3"/></row>"#,
        );
        let shared = r#"<sst><si><t>이름</t></si><si><t>점수</t></si></sst>"#;
        let table = read(&[
            ("xl/workbook.xml", WORKBOOK),
            ("xl/_rels/workbook.xml.rels", RELS),
            ("xl/sharedStrings.xml", shared),
            ("xl/worksheets/sheet1.xml", &sheet_xml),
        ])
        .unwrap();
        assert_eq!(
            table.rows,
            vec![
                vec![text("이름"), Cell::Empty, text("점수")],
                vec![number("12"), number("3.5")],
            ]
        );
        assert!(!table.limited);
    }

    #[test]
    fn formula_keeps_only_cached_value() {
        let sheet_xml = sheet(
            r#"<row r="1"><c r="A1"><f>SUM(B1:B2)</f><v>3</v></c><c r="B1" t="str"><f>"a"&amp;"b"</f><v>ab</v></c></row>"#,
        );
        let table = read(&[
            ("xl/workbook.xml", WORKBOOK),
            ("xl/_rels/workbook.xml.rels", RELS),
            ("xl/worksheets/sheet1.xml", &sheet_xml),
        ])
        .unwrap();
        assert_eq!(table.rows, vec![vec![number("3"), text("ab")]]);
    }

    #[test]
    fn keeps_entities_and_skips_phonetic_runs() {
        let sheet_xml = sheet(
            r#"<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>가 &amp; 나</t></is></c></row>"#,
        );
        let shared = r#"<sst><si><r><t>A&amp;B </t></r><r><t>&#x41;&lt;</t></r><rPh sb="0" eb="1"><t>ふりがな</t></rPh></si></sst>"#;
        let table = read(&[
            ("xl/workbook.xml", WORKBOOK),
            ("xl/_rels/workbook.xml.rels", RELS),
            ("xl/sharedStrings.xml", shared),
            ("xl/worksheets/sheet1.xml", &sheet_xml),
        ])
        .unwrap();
        assert_eq!(table.rows, vec![vec![text("A&B A<"), text("가 & 나")]]);
    }

    #[test]
    fn converts_date_styles_and_tidies_floats() {
        let styles = r#"<styleSheet>
            <numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy&quot;년&quot; m&quot;월&quot;"/></numFmts>
            <cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>
            <cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>
        </styleSheet>"#;
        let sheet_xml = sheet(
            r#"<row r="1"><c r="A1" s="1"><v>45000</v></c><c r="B1" s="2"><v>44927.5</v></c><c r="C1" s="0"><v>45000</v></c><c r="D1"><v>0.30000000000000004</v></c></row>"#,
        );
        let table = read(&[
            ("xl/workbook.xml", WORKBOOK),
            ("xl/_rels/workbook.xml.rels", RELS),
            ("xl/styles.xml", styles),
            ("xl/worksheets/sheet1.xml", &sheet_xml),
        ])
        .unwrap();
        assert_eq!(
            table.rows,
            vec![vec![text("2023-03-15"), text("2023-01-01 12:00:00"), number("45000"), number("0.3")]]
        );
    }

    #[test]
    fn booleans_and_errors_become_text() {
        let sheet_xml = sheet(
            r#"<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c><c r="C1" t="e"><v>#N/A</v></c></row>"#,
        );
        let table = read(&[
            ("xl/workbook.xml", WORKBOOK),
            ("xl/_rels/workbook.xml.rels", RELS),
            ("xl/worksheets/sheet1.xml", &sheet_xml),
        ])
        .unwrap();
        assert_eq!(table.rows, vec![vec![text("TRUE"), text("FALSE"), text("#N/A")]]);
    }

    #[test]
    fn drops_columns_past_limit_and_marks_limited() {
        let sheet_xml = sheet(r#"<row r="1"><c r="A1"><v>1</v></c><c r="ZZ1"><v>2</v></c></row>"#);
        let table = read(&[
            ("xl/workbook.xml", WORKBOOK),
            ("xl/_rels/workbook.xml.rels", RELS),
            ("xl/worksheets/sheet1.xml", &sheet_xml),
        ])
        .unwrap();
        assert_eq!(table.rows, vec![vec![number("1")]]);
        assert!(table.limited);
    }

    #[test]
    fn rejects_path_escape_and_wrong_extension() {
        let path = write_xlsx(&[("../evil.xml", "x"), ("xl/workbook.xml", WORKBOOK)]);
        assert!(read_table(&path).is_err());
        let _ = std::fs::remove_file(&path);

        let other = temp_file("hwp");
        std::fs::write(&other, b"x").unwrap();
        assert!(read_table(&other).is_err());
        let _ = std::fs::remove_file(&other);
    }

    #[test]
    fn falls_back_to_lowest_sheet_file_without_workbook_info() {
        let sheet_xml = sheet(r#"<row r="1"><c r="A1"><v>7</v></c></row>"#);
        let table = read(&[("xl/worksheets/sheet2.xml", &sheet(r#"<row r="1"><c r="A1"><v>9</v></c></row>"#)), ("xl/worksheets/sheet1.xml", &sheet_xml)]).unwrap();
        assert_eq!(table.rows, vec![vec![number("7")]]);
    }

    #[test]
    fn serial_dates_match_known_days() {
        assert_eq!(serial_to_text(1.0, false).as_deref(), Some("1900-01-01"));
        assert_eq!(serial_to_text(61.0, false).as_deref(), Some("1900-03-01"));
        assert_eq!(serial_to_text(25_569.0, false).as_deref(), Some("1970-01-01"));
        assert_eq!(serial_to_text(0.25, false).as_deref(), Some("06:00:00"));
        assert_eq!(serial_to_text(0.0, true).as_deref(), Some("1904-01-01"));
        assert_eq!(serial_to_text(-1.0, false), None);
    }

    #[test]
    fn custom_formats_are_classified() {
        assert!(custom_is_date("yyyy-mm-dd"));
        assert!(custom_is_date("[$-412]yyyy\"년\" m\"월\""));
        assert!(custom_is_date("[h]:mm:ss"));
        assert!(!custom_is_date("General"));
        assert!(!custom_is_date("#,##0\"원\""));
        assert!(!custom_is_date("0.00E+00"));
        assert!(!custom_is_date("0\\d"));
    }

    #[test]
    fn csv_handles_quotes_bom_and_leading_zeros() {
        let path = temp_file("csv");
        std::fs::write(&path, "\u{feff}번호,이름,점수\r\n001,\"홍,길동\",90\r\n002,\"한\n\"\"줄\"\"\",85.5\r\n\r\n").unwrap();
        let table = read_table(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            table.rows,
            vec![
                vec![text("번호"), text("이름"), text("점수")],
                vec![text("001"), text("홍,길동"), number("90")],
                vec![text("002"), text("한\n\"줄\""), number("85.5")],
            ]
        );
    }

    #[test]
    fn csv_rejects_non_utf8() {
        let path = temp_file("csv");
        std::fs::write(&path, [0xC8u8, 0xAB, 0xB1, 0xE6]).unwrap();
        assert!(read_table(&path).is_err());
        let _ = std::fs::remove_file(&path);
    }

    fn fresh_output() -> std::path::PathBuf {
        let path = temp_file("xlsx");
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn written_table_reads_back_the_same() {
        let rows = vec![
            vec![text("번호"), text("이름"), Cell::Empty, text("메모")],
            vec![text("001"), text("A&B <c> \"d\""), Cell::Empty, text(" 앞공백")],
            vec![number("12"), number("-3.5"), number("0.3"), text("줄\n바꿈\r끝")],
            vec![text("=SUM(A1:A2)"), text("+1"), text("-2"), text("@x")],
        ];
        let path = fresh_output();
        write_xlsx_new(&path, &rows).unwrap();
        let table = read_table(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(table.rows, rows);
        assert!(!table.limited);
    }

    #[test]
    fn written_file_has_no_formulas_and_drops_control_chars() {
        let rows = vec![vec![text("=1+1"), text("a\u{1}b\u{b}c")]];
        let path = fresh_output();
        write_xlsx_new(&path, &rows).unwrap();
        let mut archive = ZipArchive::new(File::open(&path).unwrap()).unwrap();
        let mut sheet = String::new();
        archive.by_name("xl/worksheets/sheet1.xml").unwrap().read_to_string(&mut sheet).unwrap();
        let names: Vec<String> = (0..archive.len()).map(|i| archive.by_index(i).unwrap().name().to_string()).collect();
        let back = read_table(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(!sheet.contains("<f>") && !sheet.contains("<f "));
        assert!(sheet.contains("inlineStr"));
        assert!(names.iter().all(|name| !name.contains("vba") && !name.contains("externalLink")));
        assert_eq!(back.rows, vec![vec![text("=1+1"), text("abc")]]);
    }

    #[test]
    fn unsafe_numbers_are_written_as_text() {
        let rows = vec![vec![number("1e999"), number("12abc"), number("")]];
        let path = fresh_output();
        write_xlsx_new(&path, &rows).unwrap();
        let back = read_table(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(back.rows, vec![vec![text("1e999"), text("12abc")]]);
    }

    #[test]
    fn write_never_overwrites_and_checks_limits() {
        let rows = vec![vec![text("a")]];
        let path = fresh_output();
        write_xlsx_new(&path, &rows).unwrap();
        let first = std::fs::read(&path).unwrap();
        assert!(write_xlsx_new(&path, &[vec![text("b")]]).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), first);
        let _ = std::fs::remove_file(&path);

        let wrong_ext = temp_file("csv");
        assert!(write_xlsx_new(&wrong_ext, &rows).is_err());
        assert!(!wrong_ext.exists());

        let too_wide = fresh_output();
        let wide = vec![vec![text("x"); MAX_COLUMNS + 1]];
        assert!(write_xlsx_new(&too_wide, &wide).is_err());
        assert!(!too_wide.exists());
    }

    #[test]
    fn column_letters_follow_spreadsheet_order() {
        assert_eq!(column_letters(0), "A");
        assert_eq!(column_letters(25), "Z");
        assert_eq!(column_letters(26), "AA");
        assert_eq!(column_letters(51), "AZ");
        assert_eq!(column_letters(52), "BA");
        assert_eq!(column_letters(199), "GR");
        assert_eq!(column_index("GR1"), Some(199));
    }

    fn input(name: &str, rows: Vec<Vec<Cell>>) -> MergeInput {
        MergeInput { name: name.to_string(), table: SheetTable { rows, limited: false } }
    }

    #[test]
    fn merge_matches_columns_by_header_name() {
        let first = input(
            "1반.xlsx",
            vec![vec![text("번호"), text("이름"), text("점수")], vec![number("1"), text("가"), number("90")]],
        );
        let second = input(
            "2반.xlsx",
            vec![
                vec![text(" 이름 "), text("점수"), text("비고"), text("번호")],
                vec![text("나"), number("80"), text("메모"), number("2")],
                vec![text("이름"), text("점수"), text("비고"), text("번호")],
                vec![Cell::Empty, Cell::Empty, text("   ")],
            ],
        );
        let out = merge_tables(vec![first, second], true).unwrap();
        assert_eq!(
            out.rows,
            vec![
                vec![text("원본 파일"), text("번호"), text("이름"), text("점수")],
                vec![text("1반.xlsx"), number("1"), text("가"), number("90")],
                vec![text("2반.xlsx"), number("2"), text("나"), number("80")],
            ]
        );
        assert_eq!(out.data_rows, 2);
        assert_eq!(out.files_used, 2);
        assert_eq!(out.unmatched, vec![("2반.xlsx".to_string(), "비고".to_string())]);
        assert_eq!(out.unmatched_total, 1);
    }

    #[test]
    fn merge_without_source_column_and_with_missing_columns() {
        let first = input("a.csv", vec![vec![text("A"), text("B")], vec![text("x"), text("y")]]);
        let second = input("b.csv", vec![vec![text("a")], vec![text("z")]]);
        let out = merge_tables(vec![first, second], false).unwrap();
        assert_eq!(
            out.rows,
            vec![vec![text("A"), text("B")], vec![text("x"), text("y")], vec![text("z"), Cell::Empty]]
        );
        assert!(out.unmatched.is_empty());
    }

    #[test]
    fn merge_skips_empty_files_and_reports_unnamed_columns_with_data() {
        let first = input("a.csv", vec![vec![text("A")], vec![text("1")]]);
        let empty = input("empty.csv", Vec::new());
        let unnamed = input("c.csv", vec![vec![text("A"), Cell::Empty], vec![text("2"), text("버려짐")]]);
        let out = merge_tables(vec![empty, first, unnamed], false).unwrap();
        assert_eq!(out.rows, vec![vec![text("A")], vec![text("1")], vec![text("2")]]);
        assert_eq!(out.skipped_files, vec!["empty.csv".to_string()]);
        assert_eq!(out.unmatched, vec![("c.csv".to_string(), "(제목 없는 열)".to_string())]);
        assert!(merge_tables(vec![input("x", Vec::new())], true).is_err());
    }

    #[test]
    fn merge_finds_the_header_line_below_a_title_and_reports_each_file() {
        let first = input("1반.xlsx", vec![vec![text("번호"), text("이름")], vec![number("1"), text("가")]]);
        let second = input(
            "2반.xlsx",
            vec![
                vec![text("2학년 점검표"), Cell::Empty],
                vec![Cell::Empty, Cell::Empty],
                vec![text("이름"), text("번호")],
                vec![text("나"), number("2")],
                vec![text("다"), number("3")],
            ],
        );
        let third = input("3반.xlsx", vec![vec![text("번호"), text("이름")]]);
        let out = merge_tables(vec![first, second, third], false).unwrap();
        assert_eq!(
            out.rows,
            vec![
                vec![text("번호"), text("이름")],
                vec![number("1"), text("가")],
                vec![number("2"), text("나")],
                vec![number("3"), text("다")],
            ]
        );
        assert_eq!(out.files.len(), 3);
        assert_eq!((out.files[0].header_line, out.files[0].first_row, out.files[0].last_row), (1, 2, 2));
        assert_eq!((out.files[1].header_line, out.files[1].first_row, out.files[1].last_row), (3, 3, 4));
        assert!(out.files[1].used && out.files[1].reason.is_empty());
        assert!(!out.files[2].used && out.files[2].data_rows == 0 && !out.files[2].reason.is_empty());
    }

    #[test]
    fn merge_reports_empty_and_unmatched_per_file() {
        let first = input("a.csv", vec![vec![text("A")], vec![text("1")]]);
        let empty = input("empty.csv", Vec::new());
        let extra = input("b.csv", vec![vec![text("A"), text("기타")], vec![text("2"), text("x")]]);
        let out = merge_tables(vec![first, empty, extra], false).unwrap();
        assert_eq!(out.files[1].name, "empty.csv");
        assert!(!out.files[1].used && out.files[1].header_line == 0);
        assert_eq!(out.files[2].unmatched_columns, 1);
        assert_eq!((out.files[2].first_row, out.files[2].last_row), (3, 3));
    }

    #[test]
    fn review_finds_header_lines_and_missing_columns_like_the_merge_does() {
        let first = vec![vec![text("번호"), text("이름")], vec![number("1"), text("가")]];
        let titled = vec![
            vec![text("점검표"), Cell::Empty, Cell::Empty],
            vec![text("이름"), text("번호"), text("비고")],
            vec![text("나"), number("2"), text("x")],
            vec![Cell::Empty, Cell::Empty, Cell::Empty],
        ];
        let empty: Vec<Vec<Cell>> = Vec::new();
        let tables = [Some(first.as_slice()), Some(titled.as_slice()), Some(empty.as_slice()), None];
        let reviews = review_tables(&tables);
        assert_eq!(reviews[0], Review { header_line: 1, data_rows: 1, missing: Vec::new() });
        assert_eq!(reviews[1], Review { header_line: 2, data_rows: 1, missing: vec!["비고".to_string()] });
        assert_eq!(reviews[2], Review::default());
        assert_eq!(reviews[3], Review::default());
    }

    #[test]
    fn merge_keeps_the_limited_flag_and_refuses_too_many_columns() {
        let mut limited = input("a.csv", vec![vec![text("A")], vec![text("1")]]);
        limited.table.limited = true;
        assert!(merge_tables(vec![limited], false).unwrap().limited);
        let wide = input("w.csv", vec![vec![text("x"); MAX_COLUMNS], vec![text("1")]]);
        assert!(merge_tables(vec![wide], true).is_err());
    }

    #[test]
    fn result_file_names_are_tidy() {
        let first = Path::new("C:/문서/1반 출석.xlsx");
        assert_eq!(result_file_name("", first), "1반 출석_취합.xlsx");
        assert_eq!(result_file_name("  3월 취합.XLSX ", first), "3월 취합.xlsx");
        assert_eq!(result_file_name("..\\evil", first), "1반 출석_취합.xlsx");
        assert_eq!(result_file_name("a/b", first), "1반 출석_취합.xlsx");
        assert_eq!(result_file_name("CON", first), "1반 출석_취합.xlsx");
    }

    #[test]
    fn merge_files_writes_a_new_file_beside_the_first_and_never_overwrites() {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("excel_merge_dir_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).unwrap();
        let first = dir.join("1반.csv");
        let second = dir.join("2반.csv");
        let broken = dir.join("깨짐.csv");
        std::fs::write(&first, "번호,이름\n1,가\n").unwrap();
        std::fs::write(&second, "이름,번호\n나,2\n").unwrap();
        std::fs::write(&broken, [0xC8u8, 0xAB, 0xB1]).unwrap();
        let sources = vec![first.clone(), second.clone(), broken.clone()];

        let (dest, outcome) = merge_files(&sources, "", true).unwrap();
        assert_eq!(dest, dir.join("1반_취합.xlsx"));
        assert_eq!(outcome.skipped_files, vec!["깨짐.csv".to_string()]);
        let back = read_table(&dest).unwrap();
        assert_eq!(
            back.rows,
            vec![
                vec![text("원본 파일"), text("번호"), text("이름")],
                vec![text("1반.csv"), number("1"), text("가")],
                vec![text("2반.csv"), number("2"), text("나")],
            ]
        );

        let (again, _) = merge_files(&sources, "", true).unwrap();
        assert_eq!(again, dir.join("1반_취합_2.xlsx"));
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "번호,이름\n1,가\n");
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "이름,번호\n나,2\n");

        assert!(merge_files(&[broken], "", true).is_err());
        assert!(merge_files(&[], "", true).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn slot(name: &str, rows: Vec<Vec<Cell>>) -> Slot {
        Slot { name: name.into(), table: Some(SheetTable { rows, limited: false }) }
    }

    #[test]
    fn join_fills_blank_cells_for_the_same_key_and_keeps_existing_values() {
        let base = slot(
            "기준.xlsx",
            vec![
                vec![text("학교명"), text("점검날짜")],
                vec![text("A학교"), Cell::Empty],
                vec![text("B학교"), text("2026-01-01")],
                vec![text("C학교"), Cell::Empty],
            ],
        );
        let other = slot(
            "시행.xlsx",
            vec![
                vec![text("학교명"), text("시행일자")],
                vec![text(" A학교 "), text("2026-03-01")],
                vec![text("B학교"), text("2026-04-01")],
                vec![text("A학교"), text("2099-01-01")],
            ],
        );
        let pairs = vec![JoinPair { file_index: 1, source: "시행일자".into(), target: "점검날짜".into() }];
        let built = join_tables(vec![base, other], " 학교명 ", &pairs).unwrap();
        assert_eq!(
            built.rows,
            vec![
                vec![text("학교명"), text("점검날짜")],
                vec![text("A학교"), text("2026-03-01")],
                vec![text("B학교"), text("2026-01-01")],
                vec![text("C학교"), Cell::Empty],
            ]
        );
        assert_eq!(built.fill_count, 1);
        assert_eq!(built.keep_count, 1);
        assert_eq!(built.miss_count, 1);
        assert_eq!(built.shown[0].kind, "넣음");
        assert_eq!(built.shown[0].key, "A학교");
        assert_eq!(built.shown[0].value, "2026-03-01");
        assert!(built.notes.iter().any(|note| note.contains("여러 줄")));
        assert!(built.notes.iter().any(|note| note.contains("없는 키")));
    }

    #[test]
    fn join_treats_short_and_long_school_names_as_the_same_key() {
        assert_eq!(value_key("강릉초"), value_key("강릉초등학교"));
        assert_eq!(value_key("주문진 중"), value_key("주문진중학교"));
        assert_eq!(value_key("강릉고"), value_key("강릉고등학교"));
        assert_eq!(value_key("솔향유"), value_key("솔향유치원"));
        assert_ne!(value_key("강릉초"), value_key("강릉중"));

        let base = slot(
            "기준.xlsx",
            vec![
                vec![text("학교명"), text("점검날짜")],
                vec![text("강릉초"), Cell::Empty],
                vec![text("주문진중학교"), Cell::Empty],
                vec![text("강릉고"), Cell::Empty],
                vec![text("솔향유치원"), Cell::Empty],
            ],
        );
        let other = slot(
            "시행.xlsx",
            vec![
                vec![text("학교명"), text("시행일자")],
                vec![text("강릉초등학교"), text("1")],
                vec![text("주문진중"), text("2")],
                vec![text("강릉고등학교"), text("3")],
                vec![text("솔향유"), text("4")],
            ],
        );
        let pairs = vec![JoinPair { file_index: 1, source: "시행일자".into(), target: "점검날짜".into() }];
        let built = join_tables(vec![base, other], "학교명", &pairs).unwrap();
        assert_eq!(built.fill_count, 4);
        assert_eq!(built.miss_count, 0);
        assert_eq!(built.rows[1][1], text("1"));
        assert_eq!(built.rows[4][1], text("4"));
    }

    #[test]
    fn join_adds_a_column_when_the_target_name_is_new_and_skips_a_file_without_the_key() {
        let base = slot("기준.xlsx", vec![vec![text("학교명")], vec![text("A학교")]]);
        let other = slot("시행.xlsx", vec![vec![text("학교명"), text("시행일자")], vec![text("A학교"), text("2026-03-01")]]);
        let missing = slot("없음.xlsx", vec![vec![text("이름")], vec![text("A학교")]]);
        let pairs = vec![
            JoinPair { file_index: 1, source: "시행일자".into(), target: "시행일자".into() },
            JoinPair { file_index: 2, source: "이름".into(), target: "이름".into() },
        ];
        let built = join_tables(vec![base, other, missing], "학교명", &pairs).unwrap();
        assert_eq!(
            built.rows,
            vec![vec![text("학교명"), text("시행일자")], vec![text("A학교"), text("2026-03-01")]]
        );
        assert_eq!(built.fill_count, 1);
        assert!(built.notes.iter().any(|note| note.contains("맞출 열")));
        assert!(join_tables(vec![slot("a", vec![vec![text("학교명")], vec![text("A")]])], "", &pairs).is_err());
    }

    #[test]
    fn join_file_name_uses_merge_suffix_only_when_a_title_is_given() {
        let first = Path::new("C:/문서/점검.xlsx");
        assert_eq!(join_file_name("", first), "점검_병합.xlsx");
        assert_eq!(join_file_name("3월 맞춤", first), "3월 맞춤.xlsx");
        assert_eq!(join_file_name("..\\evil", first), "점검_병합.xlsx");
    }

    #[test]
    fn sheet_file_name_uses_excel_suffix_and_keeps_a_spreadsheet_base() {
        let first = Path::new("C:/문서/점검표.pdf");
        assert_eq!(sheet_file_name("", first), "점검표_엑셀.xlsx");
        assert_eq!(sheet_file_name("3월 표", first), "3월 표.xlsx");
        assert_eq!(sheet_file_name("..\\evil", first), "점검표_엑셀.xlsx");
        assert!(spreadsheet_base(Path::new("a.xlsx")));
        assert!(spreadsheet_base(Path::new("a.CSV")));
        assert!(!spreadsheet_base(Path::new("a.pdf")));
    }
}
