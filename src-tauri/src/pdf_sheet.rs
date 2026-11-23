//! 글자가 있는 PDF를 줄·칸 표로 읽는다.
//!
//! 이미 있는 lopdf로 글자 층만 읽는다. 칸은 탭, 또는 띄어쓰기가 두 칸 이상인 자리에서 나눈다.
//! 암호 PDF와 글자가 없는 PDF는 표로 만들지 않는다. 오류 문구에는 경로와 본문을 넣지 않는다.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use lopdf::Document;

const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PAGES: usize = 40;
const MAX_PAGE_BYTES: usize = 512 * 1024;
const MAX_TEXT_CHARS: usize = 2_000_000;
const MAX_ROWS: usize = 50_000;
const MAX_COLUMNS: usize = 200;
const MAX_CELL_CHARS: usize = 32_767;

const OPEN_FAIL: &str = "PDF를 열지 못했습니다.";
const LOCKED: &str = "암호가 있는 PDF는 엑셀로 바꾸지 않습니다.";
const NO_TEXT: &str = "글자가 없는 PDF는 엑셀로 바꾸지 않습니다.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfRows {
    pub rows: Vec<Vec<String>>,
    pub limited: bool,
}

pub fn read_rows(path: &Path) -> Result<PdfRows, String> {
    let meta = std::fs::metadata(path).map_err(|_| OPEN_FAIL.to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err(OPEN_FAIL.into());
    }
    let file = File::open(path).map_err(|_| OPEN_FAIL.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| OPEN_FAIL.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(OPEN_FAIL.into());
    }
    let doc = Document::load_mem(&bytes).map_err(|_| OPEN_FAIL.to_string())?;
    if doc.is_encrypted() || doc.was_encrypted() {
        return Err(LOCKED.into());
    }
    let mut pages: Vec<u32> = doc.get_pages().keys().copied().collect();
    pages.sort_unstable();
    if pages.is_empty() {
        return Err(NO_TEXT.into());
    }
    let mut limited = pages.len() > MAX_PAGES;
    pages.truncate(MAX_PAGES);
    let mut text = String::new();
    for page in pages {
        let chunks = doc.extract_text_chunks_with_limit(&[page], MAX_PAGE_BYTES);
        let piece = match chunks.into_iter().next() {
            Some(Ok(value)) => value,
            _ => String::new(),
        };
        if text.chars().count() >= MAX_TEXT_CHARS {
            limited = true;
            break;
        }
        let room = MAX_TEXT_CHARS.saturating_sub(text.chars().count());
        let taken: String = piece.chars().take(room).collect();
        if taken.chars().count() < piece.chars().count() {
            limited = true;
        }
        text.push_str(&taken);
        text.push('\n');
        if taken.chars().count() < piece.chars().count() {
            break;
        }
    }
    let rows = rows_from_text(&text, &mut limited);
    if rows.is_empty() {
        return Err(NO_TEXT.into());
    }
    Ok(PdfRows { rows, limited })
}

fn rows_from_text(text: &str, limited: &mut bool) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    for line in text.split(['\n', '\u{000c}']) {
        if rows.len() >= MAX_ROWS {
            *limited = true;
            break;
        }
        let mut cells = split_line(line);
        if cells.is_empty() {
            continue;
        }
        if cells.len() > MAX_COLUMNS {
            cells.truncate(MAX_COLUMNS);
            *limited = true;
        }
        rows.push(cells);
    }
    rows
}

fn split_line(line: &str) -> Vec<String> {
    let line = line.trim_matches(|ch: char| ch == '\r' || ch == '\u{feff}');
    if line.trim().is_empty() {
        return Vec::new();
    }
    let parts = if line.contains('\t') {
        line.split('\t').map(clip_cell).collect()
    } else {
        split_wide_gap(line)
    };
    trim_trailing_empty(parts)
}

fn split_wide_gap(line: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut gap = 0usize;
    for ch in line.chars() {
        if ch == ' ' || ch == '\u{00a0}' {
            gap += 1;
            if gap == 1 {
                current.push(ch);
            }
            continue;
        }
        if gap >= 2 {
            push_cell(&mut cells, &current);
            current.clear();
        }
        gap = 0;
        current.push(ch);
    }
    push_cell(&mut cells, &current);
    cells
}

fn push_cell(cells: &mut Vec<String>, current: &str) {
    cells.push(clip_cell(current));
}

fn clip_cell(text: &str) -> String {
    text.trim().chars().take(MAX_CELL_CHARS).collect()
}

fn trim_trailing_empty(mut cells: Vec<String>) -> Vec<String> {
    while cells.last().is_some_and(|cell| cell.is_empty()) {
        cells.pop();
    }
    if cells.iter().all(|cell| cell.is_empty()) {
        Vec::new()
    } else {
        cells
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_gap_and_tab_become_cells() {
        assert_eq!(split_line("A학교  2026-03-01"), vec!["A학교".to_string(), "2026-03-01".to_string()]);
        assert_eq!(split_line("A학교\t점검\t"), vec!["A학교".to_string(), "점검".to_string()]);
        assert_eq!(split_line("한 칸으로 이어진 줄"), vec!["한 칸으로 이어진 줄".to_string()]);
        assert!(split_line("   ").is_empty());
    }

    #[test]
    fn text_pdf_rows_keep_two_gaps() {
        let path = std::env::temp_dir().join(format!("edulauncher-pdf-sheet-{}.pdf", std::process::id()));
        let body = text_pdf("BT /F1 12 Tf 40 100 Td (SchoolA  2026-03-01) Tj ET\n");
        std::fs::write(&path, body).unwrap();
        let parsed = read_rows(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(parsed.rows, vec![vec!["SchoolA".to_string(), "2026-03-01".to_string()]]);

        let glued = std::env::temp_dir().join(format!("edulauncher-pdf-glued-{}.pdf", std::process::id()));
        let body = text_pdf("BT /F1 12 Tf 40 100 Td (SchoolA) Tj 120 0 Td (2026-03-01) Tj ET\n");
        std::fs::write(&glued, body).unwrap();
        let parsed = read_rows(&glued).unwrap();
        let _ = std::fs::remove_file(&glued);
        assert_eq!(parsed.rows, vec![vec!["SchoolA2026-03-01".to_string()]]);
    }

    #[test]
    fn locked_or_empty_pdf_is_refused() {
        let path = std::env::temp_dir().join(format!("edulauncher-pdf-empty-{}.pdf", std::process::id()));
        std::fs::write(&path, b"%PDF-1.4\n").unwrap();
        let error = read_rows(&path).unwrap_err();
        let _ = std::fs::remove_file(&path);
        assert!(!error.contains('\\') && !error.contains('/'));
        assert!(error.contains("PDF"));
    }

    fn text_pdf(stream: &str) -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Count 1 /Kids [3 0 R] >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_string(),
            format!("<< /Length {} >>\nstream\n{stream}endstream", stream.len()),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = vec![0usize];
        for (index, body) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n{body}\nendobj\n", index + 1).as_bytes());
        }
        let xref_at = out.len();
        let size = objects.len() + 1;
        let mut xref = format!("xref\n0 {size}\n0000000000 65535 f \n");
        for offset in offsets.iter().skip(1) {
            xref.push_str(&format!("{offset:010} 00000 n \n"));
        }
        out.extend(xref.as_bytes());
        out.extend(format!("trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n").as_bytes());
        out
    }
}
