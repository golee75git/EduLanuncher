use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Serialize;
use zip::ZipArchive;

const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PART_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ENTRIES: usize = 128;
const MAX_ROWS: usize = 300;
const MAX_NAME_CHARS: usize = 80;
const MAX_URL_CHARS: usize = 2048;
const MAX_COLUMN: usize = 32;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SiteSheet {
    pub rows: Vec<SiteNameUrl>,
    pub skipped: u32,
    pub limited: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SiteNameUrl {
    pub name: String,
    pub url: String,
}

pub fn urls_in_document(path: &Path) -> Result<SiteSheet, String> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "xlsx" && ext != "pdf" && ext != "hwpx" {
        return Err("이 파일에서는 주소를 찾지 않습니다.".into());
    }
    let meta = std::fs::metadata(path).map_err(|_| "파일을 읽지 못했습니다.".to_string())?;
    if !meta.is_file() || meta.len() > 20 * 1024 * 1024 {
        return Ok(SiteSheet { rows: Vec::new(), skipped: 0, limited: false });
    }
    match crate::document_search::extract::extract_file(path) {
        Ok(text) => Ok(urls_in_text(&text)),
        Err(_) => Ok(SiteSheet { rows: Vec::new(), skipped: 0, limited: false }),
    }
}

pub fn urls_in_text(text: &str) -> SiteSheet {
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    let mut limited = false;
    let mut rest = text;
    while !rest.is_empty() {
        let lower = rest.to_ascii_lowercase();
        let https_at = lower.find("https://");
        let http_at = lower.find("http://");
        let Some(at) = (match (https_at, http_at) {
            (Some(https), Some(http)) => Some(https.min(http)),
            (Some(https), None) => Some(https),
            (None, Some(http)) => Some(http),
            (None, None) => None,
        }) else {
            break;
        };
        let tail = &rest[at..];
        let mut end = 0usize;
        for (index, ch) in tail.char_indices() {
            if url_stop(ch) {
                break;
            }
            end = index + ch.len_utf8();
        }
        if end == 0 {
            rest = &tail[1..];
            continue;
        }
        let raw = tail[..end].trim_end_matches(|ch: char| matches!(ch, '.' | ',' | ';' | ')' | ']' | '。' | '，'));
        if rows.len() >= MAX_ROWS {
            if http_url(raw).is_some() {
                limited = true;
            }
            break;
        }
        if let Some(url) = http_url(raw) {
            if seen.insert(url_key(&url)) {
                rows.push(SiteNameUrl { name: host_label(&url), url });
            }
        }
        rest = &tail[end..];
    }
    SiteSheet { rows, skipped: 0, limited }
}

fn url_stop(ch: char) -> bool {
    ch.is_whitespace() || ch.is_control() || matches!(ch, '"' | '\'' | '<' | '>' | '{' | '}' | '|' | '\\' | '「' | '」' | '『' | '』')
}

pub fn read_site_sheet(path: &Path) -> Result<SiteSheet, String> {
    let meta = std::fs::metadata(path).map_err(|_| "엑셀 파일을 읽지 못했습니다.".to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err("엑셀 파일을 읽지 못했습니다.".into());
    }
    let names = zip_names(path)?;
    let mut archive = open_zip(path)?;
    let mut budget = 0u64;
    let workbook = read_part(&mut archive, "xl/workbook.xml", &mut budget)?.unwrap_or_default();
    let rels = read_part(&mut archive, "xl/_rels/workbook.xml.rels", &mut budget)?.unwrap_or_default();
    let sheet_name = first_sheet_name(&names, &workbook, &rels)?;
    let shared = read_part(&mut archive, "xl/sharedStrings.xml", &mut budget)?.unwrap_or_default();
    let sheet = read_part(&mut archive, &sheet_name, &mut budget)?.ok_or("첫 시트를 읽지 못했습니다.")?;
    rows_from_sheet(&shared, &sheet)
}

pub fn rows_from_sheet(shared_xml: &str, sheet_xml: &str) -> Result<SiteSheet, String> {
    let shared = shared_strings(shared_xml);
    let table = sheet_table(sheet_xml, &shared);
    let mut url_at: Option<usize> = None;
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    let mut skipped = 0u32;
    let mut data_rows = 0usize;
    let mut limited = false;
    for row in table {
        if row.iter().all(|cell| cell.trim().is_empty()) {
            continue;
        }
        let Some(url_column) = url_at else {
            let has_name = row.iter().any(|cell| cell.trim() == "사이트명");
            let found = row.iter().position(|cell| cell.trim().eq_ignore_ascii_case("url"));
            if !has_name || found.is_none() || found == Some(0) {
                return Err("첫 줄에 사이트명과 url 칸이 필요합니다.".into());
            }
            url_at = found;
            continue;
        };
        if data_rows >= MAX_ROWS {
            limited = true;
            break;
        }
        data_rows += 1;
        let raw_name = row.first().map(|cell| cell.trim()).unwrap_or("");
        let raw_url = row.get(url_column).map(|cell| cell.trim()).unwrap_or("");
        let Some(url) = http_url(raw_url) else {
            skipped += 1;
            continue;
        };
        let key = url_key(&url);
        if !seen.insert(key) {
            skipped += 1;
            continue;
        }
        rows.push(SiteNameUrl {
            name: site_name(raw_name, &url),
            url,
        });
    }
    if url_at.is_none() {
        return Err("첫 줄에 사이트명과 url 칸이 필요합니다.".into());
    }
    Ok(SiteSheet { rows, skipped, limited })
}

fn zip_names(path: &Path) -> Result<Vec<String>, String> {
    let mut archive = open_zip(path)?;
    if archive.len() > MAX_ENTRIES {
        return Err("엑셀 파일을 읽지 못했습니다.".into());
    }
    let mut names = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| "엑셀 파일을 읽지 못했습니다.".to_string())?;
        let name = entry.name().replace('\\', "/");
        if name.contains("..") {
            return Err("엑셀 파일을 읽지 못했습니다.".into());
        }
        if entry.is_file() {
            names.push(name);
        }
    }
    Ok(names)
}

fn open_zip(path: &Path) -> Result<ZipArchive<File>, String> {
    let file = File::open(path).map_err(|_| "엑셀 파일을 읽지 못했습니다.".to_string())?;
    ZipArchive::new(file).map_err(|_| "엑셀 파일을 읽지 못했습니다.".to_string())
}

fn read_part(archive: &mut ZipArchive<File>, name: &str, budget: &mut u64) -> Result<Option<String>, String> {
    if name.contains("..") || name.contains('\\') {
        return Err("엑셀 파일을 읽지 못했습니다.".into());
    }
    let entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(_) => return Ok(None),
    };
    if entry.size() > MAX_PART_BYTES {
        return Err("엑셀 파일을 읽지 못했습니다.".into());
    }
    *budget = budget.saturating_add(entry.size().min(MAX_PART_BYTES));
    if *budget > MAX_FILE_BYTES {
        return Err("엑셀 파일을 읽지 못했습니다.".into());
    }
    let mut bytes = Vec::new();
    entry
        .take(MAX_PART_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "엑셀 파일을 읽지 못했습니다.".to_string())?;
    if bytes.len() as u64 > MAX_PART_BYTES {
        return Err("엑셀 파일을 읽지 못했습니다.".into());
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

fn first_sheet_name(names: &[String], workbook: &str, rels: &str) -> Result<String, String> {
    if let Some(id) = first_sheet_id(workbook) {
        if let Some(target) = rel_target(rels, &id) {
            return safe_sheet_path(&target).ok_or_else(|| "첫 시트를 읽지 못했습니다.".to_string());
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
        .ok_or_else(|| "첫 시트를 읽지 못했습니다.".to_string())
}

fn first_sheet_id(xml: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element) | Event::Empty(element)) if local_name(element.name().as_ref()) == "sheet" => {
                for attr in element.attributes().flatten() {
                    if local_name(attr.key.as_ref()) == "id" {
                        let id = plain_text(attr.value.as_ref()).trim().to_string();
                        if !id.is_empty() {
                            return Some(id);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    None
}

fn rel_target(xml: &str, id: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element) | Event::Empty(element)) if local_name(element.name().as_ref()) == "Relationship" => {
                let mut found = false;
                let mut target = String::new();
                for attr in element.attributes().flatten() {
                    match local_name(attr.key.as_ref()) {
                        "Id" => found = plain_text(attr.value.as_ref()).trim() == id,
                        "Target" => target = plain_text(attr.value.as_ref()).trim().to_string(),
                        _ => {}
                    }
                }
                if found && !target.is_empty() {
                    return Some(target);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
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
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_item = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) if local_name(element.name().as_ref()) == "si" => {
                in_item = true;
                current.clear();
            }
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "si" => {
                items.push(current.trim().to_string());
                current.clear();
                in_item = false;
            }
            Ok(Event::Text(text)) if in_item => current.push_str(&plain_text(text.as_ref())),
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    items
}

fn sheet_table(xml: &str, shared: &[String]) -> Vec<Vec<String>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut in_row = false;
    let mut in_cell = false;
    let mut shared_cell = false;
    let mut column = 0usize;
    let mut cell = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) if local_name(element.name().as_ref()) == "row" => {
                in_row = true;
                row.clear();
                column = 0;
            }
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "row" => {
                if in_row {
                    rows.push(std::mem::take(&mut row));
                }
                in_row = false;
            }
            Ok(Event::Start(element)) if local_name(element.name().as_ref()) == "c" => {
                in_cell = true;
                shared_cell = false;
                cell.clear();
                let mut placed = false;
                for attr in element.attributes().flatten() {
                    match local_name(attr.key.as_ref()) {
                        "t" if attr.value.as_ref() == "s" => shared_cell = true,
                        "r" => {
                            if let Some(index) = column_index(attr.value.as_ref()) {
                                column = index;
                                placed = true;
                            }
                        }
                        _ => {}
                    }
                }
                if !placed {
                    column = row.len();
                }
            }
            Ok(Event::Empty(_)) if in_cell => {}
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "c" => {
                let shown = cell_text(&cell, shared_cell, shared);
                place_cell(&mut row, column, shown);
                in_cell = false;
                cell.clear();
                column = column.saturating_add(1);
            }
            Ok(Event::Text(text)) if in_cell => cell.push_str(&plain_text(text.as_ref())),
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    rows
}

fn cell_text(raw: &str, shared_cell: bool, shared: &[String]) -> String {
    let value = raw.trim();
    if value.is_empty() {
        return String::new();
    }
    if shared_cell {
        return value.parse::<usize>().ok().and_then(|index| shared.get(index)).cloned().unwrap_or_default();
    }
    value.to_string()
}

fn place_cell(row: &mut Vec<String>, index: usize, value: String) {
    if index > MAX_COLUMN {
        return;
    }
    if row.len() <= index {
        row.resize(index + 1, String::new());
    }
    row[index] = value;
}

fn column_index(reference: &str) -> Option<usize> {
    let mut index = 0usize;
    let mut seen = false;
    for ch in reference.chars() {
        if !ch.is_ascii_alphabetic() {
            break;
        }
        seen = true;
        let value = ch.to_ascii_uppercase() as usize;
        if !(b'A' as usize..=b'Z' as usize).contains(&value) {
            return None;
        }
        index = index.saturating_mul(26).saturating_add(value - b'A' as usize + 1);
        if index > MAX_COLUMN + 1 {
            return None;
        }
    }
    if !seen {
        return None;
    }
    index.checked_sub(1)
}

fn local_name(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}

fn plain_text(raw: &str) -> String {
    raw.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn http_url(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() || text.chars().count() > MAX_URL_CHARS {
        return None;
    }
    if text.chars().any(|ch| ch.is_whitespace() || ch.is_control()) {
        return None;
    }
    let lower = text.to_ascii_lowercase();
    let rest = if lower.starts_with("https://") {
        &text["https://".len()..]
    } else if lower.starts_with("http://") {
        &text["http://".len()..]
    } else {
        return None;
    };
    if rest.is_empty() || rest.starts_with('/') || rest.contains('\\') {
        return None;
    }
    Some(text.to_string())
}

fn url_key(url: &str) -> String {
    let mut key = url.trim().to_ascii_lowercase();
    while key.len() > "https://".len() && key.ends_with('/') {
        key.pop();
    }
    key
}

fn site_name(raw: &str, url: &str) -> String {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.eq_ignore_ascii_case(url) || name.contains("://") {
        return host_label(url);
    }
    clip_chars(&name, MAX_NAME_CHARS)
}

fn host_label(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = host.split(':').next().unwrap_or(host);
    let host = host.strip_prefix("www.").unwrap_or(host);
    if host.is_empty() {
        "사이트".to_string()
    } else {
        clip_chars(host, MAX_NAME_CHARS)
    }
}

fn clip_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn zip_with(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            for (name, body) in entries {
                writer.start_file(*name, options).unwrap();
                writer.write_all(body.as_bytes()).unwrap();
            }
            writer.finish().unwrap();
        }
        cursor.into_inner()
    }

    fn sheet(rows: &str) -> String {
        format!("<worksheet><sheetData>{rows}</sheetData></worksheet>")
    }

    #[test]
    fn reads_name_and_url_columns() {
        let shared = "<sst><si><t>사이트명</t></si><si><t>url</t></si><si><t>학교홈</t></si><si><t>https://school.example/home</t></si></sst>";
        let body = sheet(
            "<row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"s\"><v>1</v></c></row>\
             <row r=\"2\"><c r=\"A2\" t=\"s\"><v>2</v></c><c r=\"B2\" t=\"s\"><v>3</v></c></row>\
             <row r=\"3\"><c r=\"A3\" t=\"inlineStr\"><is><t>나이스</t></is></c><c r=\"B3\"><v>https://neis.example/a</v></c></row>\
             <row r=\"4\"><c r=\"A4\"><v>메모</v></c><c r=\"B4\"><v>ftp://skip.example</v></c></row>\
             <row r=\"5\"><c r=\"A5\"><v>같은곳</v></c><c r=\"B5\"><v>https://school.example/home/</v></c></row>",
        );
        let parsed = rows_from_sheet(shared, &body).unwrap();
        assert_eq!(parsed.rows.len(), 2);
        assert_eq!(parsed.rows[0].name, "학교홈");
        assert_eq!(parsed.rows[0].url, "https://school.example/home");
        assert_eq!(parsed.rows[1].name, "나이스");
        assert_eq!(parsed.skipped, 2);
        assert!(!parsed.limited);
    }

    #[test]
    fn first_column_is_the_shown_name() {
        let body = sheet(
            "<row r=\"1\"><c r=\"B1\"><v>url</v></c><c r=\"C1\"><v>사이트명</v></c></row>\
             <row r=\"2\"><c r=\"A2\"><v>학교홈</v></c><c r=\"B2\"><v>https://school.example/home</v></c><c r=\"C2\"><v>다른이름</v></c></row>",
        );
        let parsed = rows_from_sheet("", &body).unwrap();
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rows[0].name, "학교홈");
        assert_eq!(parsed.rows[0].url, "https://school.example/home");
        let swapped = sheet("<row><c r=\"A1\"><v>url</v></c><c r=\"B1\"><v>사이트명</v></c></row>");
        assert_eq!(
            rows_from_sheet("", &swapped).unwrap_err(),
            "첫 줄에 사이트명과 url 칸이 필요합니다."
        );
    }

    #[test]
    fn missing_header_is_refused() {
        let body = sheet("<row><c r=\"A1\"><v>이름</v></c><c r=\"B1\"><v>주소</v></c></row>");
        assert_eq!(
            rows_from_sheet("", &body).unwrap_err(),
            "첫 줄에 사이트명과 url 칸이 필요합니다."
        );
    }

    #[test]
    fn empty_name_uses_host_and_stops_at_row_cap() {
        let mut rows = String::from("<row r=\"1\"><c r=\"B1\"><v>url</v></c><c r=\"C1\"><v>사이트명</v></c></row>");
        for index in 2..=302 {
            rows.push_str(&format!(
                "<row r=\"{index}\"><c r=\"B{index}\"><v>https://item{index}.example/p</v></c><c r=\"C{index}\"><v></v></c></row>"
            ));
        }
        let parsed = rows_from_sheet("", &sheet(&rows)).unwrap();
        assert_eq!(parsed.rows.len(), 300);
        assert!(parsed.limited);
        assert_eq!(parsed.rows[0].name, "item2.example");
    }

    #[test]
    fn sheet_target_cannot_leave_the_workbook() {
        assert!(safe_sheet_path("worksheets/sheet1.xml").is_some());
        assert!(safe_sheet_path("../secret.xml").is_none());
        assert!(safe_sheet_path("xl/worksheets/../../secret.xml").is_none());
    }

    #[test]
    fn reads_the_first_workbook_sheet_from_a_file() {
        let bytes = zip_with(&[
            (
                "xl/workbook.xml",
                r#"<workbook><sheets><sheet name="목록" sheetId="1" r:id="rId3"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<Relationships><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                &sheet("<row><c r=\"A1\"><v>사이트명</v></c><c r=\"B1\"><v>url</v></c></row><row><c r=\"A2\"><v>잘못된시트</v></c><c r=\"B2\"><v>https://wrong.example</v></c></row>"),
            ),
            (
                "xl/worksheets/sheet3.xml",
                &sheet("<row><c r=\"A1\"><v>사이트명</v></c><c r=\"B1\"><v>url</v></c></row><row><c r=\"A2\"><v>맞는시트</v></c><c r=\"B2\"><v>https://right.example</v></c></row>"),
            ),
        ]);
        let dir = std::env::temp_dir().join(format!("edul-site-sheet-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sites.xlsx");
        std::fs::write(&path, bytes).unwrap();
        let parsed = read_site_sheet(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rows[0].name, "맞는시트");
        assert_eq!(parsed.rows[0].url, "https://right.example");
    }

    #[test]
    fn finds_urls_without_column_names() {
        let parsed = urls_in_text("안내 https://school.example/a, 다음 http://second.example/b 끝 https://school.example/a/");
        assert_eq!(parsed.rows.len(), 2);
        assert_eq!(parsed.rows[0].url, "https://school.example/a");
        assert_eq!(parsed.rows[0].name, "school.example");
        assert_eq!(parsed.rows[1].url, "http://second.example/b");
        assert!(urls_in_text("ftp://skip.example").rows.is_empty());
    }

    #[test]
    fn finds_a_url_in_hwpx_text() {
        let section = r#"<?xml version="1.0"?><sec><p><run><t>참고 https://note.example/p</t></run></p></sec>"#;
        let bytes = zip_with(&[("Contents/section0.xml", section)]);
        let dir = std::env::temp_dir().join(format!("edul-site-hwpx-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.hwpx");
        std::fs::write(&path, bytes).unwrap();
        let parsed = urls_in_document(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(parsed.rows.len(), 1);
        assert_eq!(parsed.rows[0].url, "https://note.example/p");
    }
}
