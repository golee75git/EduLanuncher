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
    let doc = Document::load(path).map_err(|_| ExtractNote::Fail("PDF를 열지 못했습니다.".to_string()))?;
    if doc.is_encrypted() || doc.was_encrypted() {
        return Err(ExtractNote::Skip("암호가 있는 PDF는 색인하지 않습니다.".to_string()));
    }
    let pages = doc.get_pages();
    let numbers: Vec<u32> = pages.keys().copied().take(200).collect();
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
}
