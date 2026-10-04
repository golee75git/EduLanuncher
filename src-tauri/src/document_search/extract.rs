use std::fs::File;
use std::io::Read;
use std::path::Path;

use lopdf::Document;
use quick_xml::events::Event;
use quick_xml::Reader;
use zip::ZipArchive;

const MAX_BODY_CHARS: usize = 200_000;
const MAX_XML_BYTES: u64 = 20_000_000;

#[derive(Debug)]
pub enum ExtractNote {
    Skip(String),
    Fail(String),
}

pub fn extract_file(path: &Path) -> Result<String, ExtractNote> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "txt" | "md" | "csv" => read_plain(path),
        "hwpx" => read_hwpx(path),
        "docx" => read_docx(path),
        "xlsx" => read_xlsx(path),
        "pdf" => read_pdf(path),
        "hwp" => Err(ExtractNote::Skip("HWP는 아직 지원하지 않습니다.".to_string())),
        _ => Err(ExtractNote::Skip("지원하지 않는 파일입니다.".to_string())),
    }
}

fn clip(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars().take(MAX_BODY_CHARS) {
        if ch == '\u{0}' {
            continue;
        }
        out.push(ch);
    }
    out
}

fn read_plain(path: &Path) -> Result<String, ExtractNote> {
    let mut file = File::open(path).map_err(|_| ExtractNote::Fail("파일을 열지 못했습니다.".to_string()))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| ExtractNote::Fail("파일을 읽지 못했습니다.".to_string()))?;
    let text = String::from_utf8_lossy(&bytes);
    let body = clip(text.trim());
    if body.is_empty() {
        return Err(ExtractNote::Skip("텍스트가 없습니다.".to_string()));
    }
    Ok(body)
}

fn zip_entry(archive: &mut ZipArchive<File>, name: &str) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > MAX_XML_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn zip_names(path: &Path) -> Result<Vec<String>, ExtractNote> {
    let file = File::open(path).map_err(|_| ExtractNote::Fail("파일을 열지 못했습니다.".to_string()))?;
    let mut archive = ZipArchive::new(file).map_err(|_| ExtractNote::Fail("압축을 열지 못했습니다.".to_string()))?;
    let mut names = Vec::new();
    for index in 0..archive.len() {
        if let Ok(entry) = archive.by_index(index) {
            if entry.is_file() {
                names.push(entry.name().replace('\\', "/"));
            }
        }
    }
    Ok(names)
}

fn open_zip(path: &Path) -> Result<ZipArchive<File>, ExtractNote> {
    let file = File::open(path).map_err(|_| ExtractNote::Fail("파일을 열지 못했습니다.".to_string()))?;
    ZipArchive::new(file).map_err(|_| ExtractNote::Fail("압축을 열지 못했습니다.".to_string()))
}

fn read_docx(path: &Path) -> Result<String, ExtractNote> {
    let names = zip_names(path)?;
    let mut archive = open_zip(path)?;
    let mut parts = Vec::new();
    for name in names {
        let lower = name.to_ascii_lowercase();
        let useful = lower == "word/document.xml"
            || (lower.starts_with("word/header") && lower.ends_with(".xml"))
            || (lower.starts_with("word/footer") && lower.ends_with(".xml"));
        if !useful {
            continue;
        }
        if let Some(xml) = zip_entry(&mut archive, &name) {
            parts.push(xml_text(&xml));
        }
    }
    finish_parts(parts)
}

fn read_hwpx(path: &Path) -> Result<String, ExtractNote> {
    let names = zip_names(path)?;
    let mut archive = open_zip(path)?;
    let mut parts = Vec::new();
    for name in names {
        let lower = name.to_ascii_lowercase();
        if lower.starts_with("contents/") && lower.ends_with(".xml") {
            if let Some(xml) = zip_entry(&mut archive, &name) {
                parts.push(xml_text(&xml));
            }
        }
    }
    finish_parts(parts)
}

fn read_xlsx(path: &Path) -> Result<String, ExtractNote> {
    let names = zip_names(path)?;
    let mut archive = open_zip(path)?;
    let shared = zip_entry(&mut archive, "xl/sharedStrings.xml")
        .map(|xml| shared_strings(&xml))
        .unwrap_or_default();
    let book = zip_entry(&mut archive, "xl/workbook.xml").unwrap_or_default();
    let sheet_names = workbook_sheet_names(&book);
    let mut sheets: Vec<String> = names
        .iter()
        .filter(|name| {
            let lower = name.to_ascii_lowercase();
            lower.starts_with("xl/worksheets/sheet") && lower.ends_with(".xml")
        })
        .cloned()
        .collect();
    sheets.sort();
    let mut parts = Vec::new();
    for (index, sheet) in sheets.iter().enumerate() {
        let Some(xml) = zip_entry(&mut archive, sheet) else {
            continue;
        };
        let cells = sheet_cells(&xml, &shared);
        if cells.is_empty() {
            continue;
        }
        let title = sheet_names.get(index).cloned().unwrap_or_default();
        if title.is_empty() {
            parts.push(cells);
        } else {
            parts.push(format!("{title}\n{cells}"));
        }
    }
    finish_parts(parts)
}

fn finish_parts(parts: Vec<String>) -> Result<String, ExtractNote> {
    let body = clip(parts.join("\n").trim());
    if body.is_empty() {
        return Err(ExtractNote::Skip("텍스트가 없습니다.".to_string()));
    }
    Ok(body)
}

fn read_pdf(path: &Path) -> Result<String, ExtractNote> {
    read_pdf_pages(path, 200)
}

fn read_pdf_pages(path: &Path, page_limit: usize) -> Result<String, ExtractNote> {
    let doc = Document::load(path).map_err(|_| ExtractNote::Fail("PDF를 열지 못했습니다.".to_string()))?;
    if doc.is_encrypted() || doc.was_encrypted() {
        return Err(ExtractNote::Skip("암호가 있는 PDF는 색인하지 않습니다.".to_string()));
    }
    let pages = doc.get_pages();
    let numbers: Vec<u32> = pages.keys().copied().take(page_limit).collect();
    if numbers.is_empty() {
        return Err(ExtractNote::Skip("텍스트를 추출할 수 없는 PDF입니다.".to_string()));
    }
    let text = doc.extract_text(&numbers).unwrap_or_default();
    let body = clip(text.trim());
    if body.is_empty() {
        return Err(ExtractNote::Skip("텍스트를 추출할 수 없는 PDF입니다.".to_string()));
    }
    Ok(body)
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

fn xml_text(xml: &str) -> String {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(text)) => push_piece(&mut out, &plain_text(text.as_ref())),
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

fn push_piece(out: &mut String, piece: &str) {
    if piece.is_empty() {
        return;
    }
    if !out.is_empty() && !out.ends_with('\n') && !piece.starts_with('\n') {
        out.push(' ');
    }
    out.push_str(piece);
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

fn sheet_cells(xml: &str, shared: &[String]) -> String {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut in_cell = false;
    let mut shared_cell = false;
    let mut cell = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) if local_name(element.name().as_ref()) == "c" => {
                in_cell = true;
                shared_cell = false;
                cell.clear();
                for attr in element.attributes().flatten() {
                    if local_name(attr.key.as_ref()) == "t" && attr.value.as_ref() == "s" {
                        shared_cell = true;
                    }
                }
            }
            Ok(Event::Empty(element)) if local_name(element.name().as_ref()) == "c" => {
                in_cell = false;
            }
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "c" => {
                let value = cell.trim();
                if !value.is_empty() {
                    let shown = if shared_cell {
                        value
                            .parse::<usize>()
                            .ok()
                            .and_then(|index| shared.get(index))
                            .cloned()
                            .unwrap_or_default()
                    } else {
                        value.to_string()
                    };
                    if !shown.is_empty() {
                        push_piece(&mut out, &shown);
                    }
                }
                in_cell = false;
                cell.clear();
            }
            Ok(Event::Text(text)) if in_cell => cell.push_str(&plain_text(text.as_ref())),
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

fn workbook_sheet_names(xml: &str) -> Vec<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut names = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element) | Event::Empty(element))
                if local_name(element.name().as_ref()) == "sheet" =>
            {
                for attr in element.attributes().flatten() {
                    if local_name(attr.key.as_ref()) == "name" {
                        names.push(plain_text(attr.value.as_ref()).trim().to_string());
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    names
}

/// 업무 카드용 본문. 문서 검색의 `extract_file`은 바꾸지 않고, 쪽·행·머리글 범위만 여기서 좁힌다.
pub(crate) fn extract_card_body(path: &Path) -> Result<String, ExtractNote> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let text = match ext.as_str() {
        "hwpx" => read_hwpx_sections(path)?,
        "docx" => read_docx_body(path)?,
        "xlsx" => read_xlsx_rows(path, 200)?,
        "pdf" => read_pdf_pages(path, 20)?,
        _ => return Err(ExtractNote::Skip("지원하지 않는 파일입니다.".to_string())),
    };
    Ok(clip_chars(&text, 20_000))
}

fn clip_chars(text: &str, max_chars: usize) -> String {
    text.chars().filter(|ch| *ch != '\u{0}').take(max_chars).collect()
}

fn read_hwpx_sections(path: &Path) -> Result<String, ExtractNote> {
    let names = zip_names(path)?;
    let mut sections: Vec<(u32, String)> = names
        .into_iter()
        .filter_map(|name| section_number(&name).map(|number| (number, name)))
        .collect();
    sections.sort_by_key(|(number, _)| *number);
    let mut archive = open_zip(path)?;
    let mut parts = Vec::new();
    for (_, name) in sections {
        if let Some(xml) = zip_entry(&mut archive, &name) {
            parts.push(collapse_blank_lines(&xml_paragraphs(&xml)));
        }
    }
    Ok(parts.join("\n"))
}

fn section_number(name: &str) -> Option<u32> {
    let name = name.replace('\\', "/");
    let rest = name.strip_prefix("Contents/section")?;
    let number = rest.strip_suffix(".xml")?;
    if number.is_empty() || !number.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    number.parse().ok()
}

fn read_docx_body(path: &Path) -> Result<String, ExtractNote> {
    let mut archive = open_zip(path)?;
    let xml = zip_entry(&mut archive, "word/document.xml").unwrap_or_default();
    Ok(collapse_blank_lines(&xml_paragraphs(&xml)))
}

fn xml_paragraphs(xml: &str) -> String {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(text)) => push_piece(&mut out, &plain_text(text.as_ref())),
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "p" => out.push('\n'),
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

fn collapse_blank_lines(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '\n' {
            let mut next = index + 1;
            let mut another = false;
            while next < chars.len() && chars[next].is_whitespace() {
                if chars[next] == '\n' {
                    another = true;
                }
                next += 1;
            }
            if another {
                out.push('\n');
                index = next;
                continue;
            }
        }
        out.push(chars[index]);
        index += 1;
    }
    out.trim().to_string()
}

struct DateBook {
    date1904: bool,
    styles: Vec<bool>,
}

fn read_xlsx_rows(path: &Path, max_rows: usize) -> Result<String, ExtractNote> {
    let names = zip_names(path)?;
    let mut archive = open_zip(path)?;
    let shared = zip_entry(&mut archive, "xl/sharedStrings.xml")
        .map(|xml| shared_strings(&xml))
        .unwrap_or_default();
    let book = zip_entry(&mut archive, "xl/workbook.xml").unwrap_or_default();
    let styles = zip_entry(&mut archive, "xl/styles.xml").unwrap_or_default();
    let dates = date_book(&book, &styles);
    let sheet_names = workbook_sheet_names(&book);
    let mut sheets: Vec<String> = names
        .iter()
        .filter(|name| {
            let lower = name.to_ascii_lowercase();
            lower.starts_with("xl/worksheets/sheet") && lower.ends_with(".xml")
        })
        .cloned()
        .collect();
    sheets.sort();
    let mut lines = Vec::new();
    for (index, sheet) in sheets.iter().enumerate() {
        let Some(xml) = zip_entry(&mut archive, sheet) else {
            continue;
        };
        let title = sheet_names.get(index).cloned().unwrap_or_default();
        lines.push(format!("[시트] {title}"));
        for row in sheet_grid(&xml, &shared, max_rows, &dates) {
            let cells: Vec<&str> = row.iter().map(String::as_str).filter(|cell| !cell.is_empty()).collect();
            if !cells.is_empty() {
                lines.push(cells.join(" | "));
            }
        }
    }
    Ok(lines.join("\n"))
}

fn date_book(workbook: &str, styles: &str) -> DateBook {
    DateBook {
        date1904: workbook.contains("date1904=\"1\"") || workbook.contains("date1904=\"true\""),
        styles: date_styles(styles),
    }
}

fn date_styles(styles: &str) -> Vec<bool> {
    let mut reader = Reader::from_str(styles);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut custom: Vec<(u32, String)> = Vec::new();
    let mut in_xfs = false;
    let mut out = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) | Ok(Event::Empty(element)) => {
                let name = local_name(element.name().as_ref()).to_string();
                if name == "cellXfs" {
                    in_xfs = true;
                } else if name == "numFmt" {
                    let mut id = None;
                    let mut code = String::new();
                    for attr in element.attributes().flatten() {
                        match local_name(attr.key.as_ref()) {
                            "numFmtId" => id = plain_text(attr.value.as_ref()).parse().ok(),
                            "formatCode" => code = plain_text(attr.value.as_ref()),
                            _ => {}
                        }
                    }
                    if let Some(id) = id {
                        custom.push((id, code));
                    }
                } else if name == "xf" && in_xfs {
                    let mut id = 0u32;
                    for attr in element.attributes().flatten() {
                        if local_name(attr.key.as_ref()) == "numFmtId" {
                            id = plain_text(attr.value.as_ref()).parse().unwrap_or(0);
                        }
                    }
                    out.push(style_is_date(id, &custom));
                }
            }
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "cellXfs" => in_xfs = false,
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

fn style_is_date(id: u32, custom: &[(u32, String)]) -> bool {
    if let Some((_, code)) = custom.iter().find(|(key, _)| *key == id) {
        return format_has_date(code);
    }
    matches!(id, 14..=17 | 22 | 27..=36 | 50..=58)
}

fn format_has_date(code: &str) -> bool {
    let mut plain = String::new();
    let chars: Vec<char> = code.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        match chars[index] {
            '"' => {
                index += 1;
                while index < chars.len() && chars[index] != '"' {
                    index += 1;
                }
                index += 1;
            }
            '[' => {
                index += 1;
                while index < chars.len() && chars[index] != ']' {
                    index += 1;
                }
                index += 1;
            }
            '\\' => index += 2,
            other => {
                plain.push(other);
                index += 1;
            }
        }
    }
    let lower = plain.to_ascii_lowercase();
    lower.contains('y') || lower.contains('d')
}

fn excel_date(serial: f64, date1904: bool) -> Option<String> {
    if !serial.is_finite() || serial < 1.0 {
        return None;
    }
    let mut days = serial.floor() as i64;
    let (year, month, day) = if date1904 {
        add_days(1904, 1, 1, days)?
    } else {
        if days > 0 && days < 60 {
            days += 1;
        }
        add_days(1899, 12, 30, days)?
    };
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

fn add_days(mut year: i32, mut month: u32, mut day: u32, mut left: i64) -> Option<(i32, u32, u32)> {
    if !(1..=12).contains(&month) || day == 0 || left < 0 {
        return None;
    }
    while left > 0 {
        if year > 9999 {
            return None;
        }
        let room = month_length(year, month).saturating_sub(day) as i64;
        if left <= room {
            day += left as u32;
            break;
        }
        left -= room + 1;
        day = 1;
        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
        }
    }
    Some((year, month, day))
}

fn month_length(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 30,
    }
}

fn sheet_grid(xml: &str, shared: &[String], max_rows: usize, dates: &DateBook) -> Vec<Vec<String>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut in_row = false;
    let mut in_cell = false;
    let mut shared_cell = false;
    let mut number_cell = false;
    let mut style_index = None;
    let mut cell = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) if local_name(element.name().as_ref()) == "row" => {
                if rows.len() >= max_rows {
                    break;
                }
                in_row = true;
                row.clear();
            }
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "row" => {
                if in_row {
                    rows.push(std::mem::take(&mut row));
                }
                in_row = false;
                if rows.len() >= max_rows {
                    break;
                }
            }
            Ok(Event::Start(element)) if local_name(element.name().as_ref()) == "c" => {
                in_cell = true;
                shared_cell = false;
                number_cell = true;
                style_index = None;
                cell.clear();
                for attr in element.attributes().flatten() {
                    match local_name(attr.key.as_ref()) {
                        "t" => {
                            let kind = attr.value.as_ref();
                            if kind == "s" {
                                shared_cell = true;
                            }
                            if kind != "n" {
                                number_cell = false;
                            }
                        }
                        "s" => style_index = plain_text(attr.value.as_ref()).parse().ok(),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(element)) if local_name(element.name().as_ref()) == "c" => {
                let value = cell.trim();
                if !value.is_empty() {
                    let shown = if shared_cell {
                        value.parse::<usize>().ok().and_then(|index| shared.get(index)).cloned().unwrap_or_default()
                    } else if number_cell && dates.styles.get(style_index.unwrap_or(usize::MAX)).copied().unwrap_or(false) {
                        value.parse::<f64>().ok().and_then(|serial| excel_date(serial, dates.date1904)).unwrap_or_else(|| value.to_string())
                    } else {
                        value.to_string()
                    };
                    if !shown.is_empty() {
                        row.push(shown);
                    }
                }
                in_cell = false;
                cell.clear();
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

    #[test]
    fn docx_text_includes_table_cell() {
        let xml = "<w:document><w:tbl><w:tr><w:tc><w:t>예산집행</w:t></w:tc></w:tr></w:tbl></w:document>";
        assert!(xml_text(xml).contains("예산집행"));
    }

    #[test]
    fn xlsx_cell_uses_shared_string() {
        let shared = shared_strings("<sst><si><t>모니터</t></si></sst>");
        let cells = sheet_cells(r#"<sheetData><c t="s"><v>0</v></c><c><v>12</v></c></sheetData>"#, &shared);
        assert!(cells.contains("모니터"));
        assert!(cells.contains("12"));
    }

    #[test]
    fn zip_roundtrip_keeps_hwpx_text() {
        let bytes = zip_with(&[("Contents/section0.xml", "<hp:p><hp:t>품의</hp:t></hp:p>")]);
        let dir = std::env::temp_dir().join(format!("edul-hwpx-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.hwpx");
        std::fs::write(&path, bytes).unwrap();
        let text = extract_file(&path).unwrap();
        assert!(text.contains("품의"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn card_body_skips_docx_header_that_search_keeps() {
        let bytes = zip_with(&[
            ("word/document.xml", "<w:document><w:p><w:t>본문기한</w:t></w:p></w:document>"),
            ("word/header1.xml", "<w:hdr><w:p><w:t>머리글기한</w:t></w:p></w:hdr>"),
        ]);
        let dir = std::env::temp_dir().join(format!("edul-docx-bound-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.docx");
        std::fs::write(&path, bytes).unwrap();
        let search = extract_file(&path).unwrap();
        let card = extract_card_body(&path).unwrap();
        assert!(search.contains("본문기한"));
        assert!(search.contains("머리글기한"));
        assert!(card.contains("본문기한"));
        assert!(!card.contains("머리글기한"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn card_sheet_keeps_raw_number() {
        let bytes = zip_with(&[
            ("xl/workbook.xml", r#"<workbook><sheets><sheet name="Sheet"/></sheets></workbook>"#),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData><row><c t="inlineStr"><is><t>2025-11-30</t></is></c></row><row><c><v>45991</v></c></row></sheetData></worksheet>"#,
            ),
        ]);
        let dir = std::env::temp_dir().join(format!("edul-xlsx-num-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.xlsx");
        std::fs::write(&path, bytes).unwrap();
        let card = extract_card_body(&path).unwrap();
        assert!(card.contains("2025-11-30"));
        assert!(card.contains("45991"));
        assert!(!card.contains("2025-11-30 00:00:00"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn excel_serial_matches_calendar() {
        assert_eq!(excel_date(1.0, false).as_deref(), Some("1900-01-01"));
        assert_eq!(excel_date(60.0, false).as_deref(), Some("1900-02-28"));
        assert_eq!(excel_date(61.0, false).as_deref(), Some("1900-03-01"));
        assert_eq!(excel_date(45991.0, false).as_deref(), Some("2025-11-30"));
        assert_eq!(excel_date(44529.0, true).as_deref(), Some("2025-11-30"));
    }

    #[test]
    fn card_sheet_reads_date_format_search_keeps_number() {
        let bytes = zip_with(&[
            (
                "xl/workbook.xml",
                r#"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets><sheet name="일정" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            ),
            (
                "xl/styles.xml",
                r#"<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData><row><c t="inlineStr"><is><t>이수기한</t></is></c><c s="1"><v>45991</v></c></row></sheetData></worksheet>"#,
            ),
        ]);
        let dir = std::env::temp_dir().join(format!("edul-xlsx-date-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("date.xlsx");
        std::fs::write(&path, bytes).unwrap();
        let search = extract_file(&path).unwrap();
        let card = extract_card_body(&path).unwrap();
        assert!(search.contains("45991"), "{search}");
        assert!(card.contains("2025-11-30"), "{card}");
        assert!(!card.contains("45991"), "{card}");
        let mac = zip_with(&[
            (
                "xl/workbook.xml",
                r#"<workbook><workbookPr date1904="1"/><sheets><sheet name="일정"/></sheets></workbook>"#,
            ),
            (
                "xl/styles.xml",
                r#"<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="1"><xf numFmtId="164"/></cellXfs></styleSheet>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData><row><c s="0"><v>44529</v></c></row></sheetData></worksheet>"#,
            ),
        ]);
        let mac_path = dir.join("mac.xlsx");
        std::fs::write(&mac_path, mac).unwrap();
        let mac_card = extract_card_body(&mac_path).unwrap();
        assert!(mac_card.contains("2025-11-30"), "{mac_card}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
