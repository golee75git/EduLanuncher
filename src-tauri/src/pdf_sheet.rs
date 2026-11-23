//! 글자가 있는 PDF를 줄·칸 표로 읽는다.
//!
//! 이미 있는 lopdf로 글자 위치와 글자를 읽는다. 같은 높이의 글자를 한 줄로 보고,
//! 가로로 떨어진 글자를 다른 칸으로 둔다. 한 조각 안의 탭·넓은 띄어쓰기도 칸으로 나눈다.
//! 암호 PDF와 글자가 없는 PDF는 표로 만들지 않는다. 오류 문구에는 경로와 본문을 넣지 않는다.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use lopdf::content::Content;
use lopdf::{Document, Encoding, Object, ObjectId};

const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PAGES: usize = 40;
const MAX_PAGE_BYTES: usize = 512 * 1024;
const MAX_TEXT_CHARS: usize = 2_000_000;
const MAX_ROWS: usize = 50_000;
const MAX_COLUMNS: usize = 200;
const MAX_CELL_CHARS: usize = 32_767;
const MAX_MARKS: usize = 80_000;
const ROW_SLACK: f32 = 5.0;
const COLUMN_SLACK: f32 = 8.0;

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
    let page_map = doc.get_pages();
    let mut limited = pages.len() > MAX_PAGES;
    pages.truncate(MAX_PAGES);
    let mut rows = Vec::new();
    let mut chars = 0usize;
    for page in pages {
        if rows.len() >= MAX_ROWS || chars >= MAX_TEXT_CHARS {
            limited = true;
            break;
        }
        let Some(page_id) = page_map.get(&page).copied() else {
            continue;
        };
        let mut page_rows = rows_from_marks(marks_on_page(&doc, page_id), &mut limited);
        if page_rows.is_empty() {
            let chunks = doc.extract_text_chunks_with_limit(&[page], MAX_PAGE_BYTES);
            let piece = match chunks.into_iter().next() {
                Some(Ok(value)) => value,
                _ => String::new(),
            };
            page_rows = rows_from_text(&piece, &mut limited);
        }
        for row in page_rows {
            if rows.len() >= MAX_ROWS || chars >= MAX_TEXT_CHARS {
                limited = true;
                break;
            }
            chars += row.iter().map(|cell| cell.chars().count()).sum::<usize>();
            rows.push(row);
        }
    }
    if rows.is_empty() {
        return Err(NO_TEXT.into());
    }
    Ok(PdfRows { rows, limited })
}

#[derive(Clone)]
struct Pen {
    x: f32,
    y: f32,
    line_x: f32,
    line_y: f32,
    size: f32,
    leading: f32,
    font: Vec<u8>,
}

impl Default for Pen {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, line_x: 0.0, line_y: 0.0, size: 12.0, leading: 12.0, font: Vec::new() }
    }
}

struct Mark {
    x: f32,
    y: f32,
    text: String,
    width: f32,
}

struct Placed {
    x: f32,
    text: String,
    width: f32,
}

fn marks_on_page(doc: &Document, page_id: ObjectId) -> Vec<Mark> {
    let bytes = match doc.get_page_content_with_limit(page_id, MAX_PAGE_BYTES) {
        Ok(bytes) => bytes,
        Err(_) => return Vec::new(),
    };
    let content = match Content::decode(&bytes) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let fonts = doc.get_page_fonts(page_id).unwrap_or_default();
    let mut encodings = BTreeMap::new();
    for (name, font) in &fonts {
        if let Ok(encoding) = font.get_font_encoding_with_limit(doc, MAX_PAGE_BYTES) {
            encodings.insert(name.clone(), encoding);
        }
    }
    let mut pen = Pen::default();
    let mut stack = Vec::new();
    let mut marks = Vec::new();
    for op in content.operations {
        if marks.len() >= MAX_MARKS {
            break;
        }
        match op.operator.as_str() {
            "q" => {
                if stack.len() < 32 {
                    stack.push(pen.clone());
                }
            }
            "Q" => {
                if let Some(prev) = stack.pop() {
                    pen = prev;
                }
            }
            "BT" => {
                pen.x = 0.0;
                pen.y = 0.0;
                pen.line_x = 0.0;
                pen.line_y = 0.0;
            }
            "Tf" => {
                if let Some(name) = op.operands.first().and_then(|item| item.as_name().ok()) {
                    pen.font = name.to_vec();
                }
                if let Some(size) = op.operands.get(1).and_then(number_of) {
                    if size.abs() > 0.1 {
                        pen.size = size.abs();
                        pen.leading = pen.size;
                    }
                }
            }
            "TL" => {
                if let Some(lead) = op.operands.first().and_then(number_of) {
                    pen.leading = lead;
                }
            }
            "Td" => move_line(&mut pen, &op.operands, false),
            "TD" => move_line(&mut pen, &op.operands, true),
            "Tm" => place_line(&mut pen, &op.operands),
            "T*" => carriage(&mut pen),
            "Tj" => show_text(&mut pen, op.operands.first(), &encodings, &mut marks),
            "TJ" => show_items(&mut pen, op.operands.first(), &encodings, &mut marks),
            "'" => {
                carriage(&mut pen);
                show_text(&mut pen, op.operands.first(), &encodings, &mut marks);
            }
            "\"" => {
                carriage(&mut pen);
                show_text(&mut pen, op.operands.get(2), &encodings, &mut marks);
            }
            _ => {}
        }
    }
    marks
}

fn number_of(obj: &Object) -> Option<f32> {
    obj.as_float().ok()
}

fn move_line(pen: &mut Pen, operands: &[Object], set_leading: bool) {
    let tx = operands.first().and_then(number_of).unwrap_or(0.0);
    let ty = operands.get(1).and_then(number_of).unwrap_or(0.0);
    if set_leading {
        pen.leading = -ty;
    }
    pen.line_x += tx;
    pen.line_y += ty;
    pen.x = pen.line_x;
    pen.y = pen.line_y;
}

fn place_line(pen: &mut Pen, operands: &[Object]) {
    if operands.len() < 6 {
        return;
    }
    let x = number_of(&operands[4]).unwrap_or(pen.x);
    let y = number_of(&operands[5]).unwrap_or(pen.y);
    pen.line_x = x;
    pen.line_y = y;
    pen.x = x;
    pen.y = y;
}

fn carriage(pen: &mut Pen) {
    let lead = if pen.leading.abs() < 0.1 { pen.size } else { pen.leading };
    pen.line_y -= lead;
    pen.y = pen.line_y;
    pen.x = pen.line_x;
}

fn show_text(pen: &mut Pen, operand: Option<&Object>, encodings: &BTreeMap<Vec<u8>, Encoding>, marks: &mut Vec<Mark>) {
    let Some(raw) = operand.and_then(|item| item.as_str().ok()) else {
        return;
    };
    let text = decode_bytes(&pen.font, raw, encodings);
    paint(pen, &text, marks);
}

fn show_items(pen: &mut Pen, operand: Option<&Object>, encodings: &BTreeMap<Vec<u8>, Encoding>, marks: &mut Vec<Mark>) {
    let Some(items) = operand.and_then(|item| item.as_array().ok()) else {
        show_text(pen, operand, encodings, marks);
        return;
    };
    for item in items {
        if marks.len() >= MAX_MARKS {
            break;
        }
        if item.as_str().is_ok() {
            show_text(pen, Some(item), encodings, marks);
        } else if let Some(adjust) = number_of(item) {
            pen.x -= adjust / 1000.0 * pen.size;
        }
    }
}

fn paint(pen: &mut Pen, text: &str, marks: &mut Vec<Mark>) {
    for (index, part) in text.split('\n').enumerate() {
        if index > 0 {
            carriage(pen);
        }
        let part = part.trim_matches('\r');
        if part.is_empty() {
            continue;
        }
        let width = text_width(part, pen.size);
        marks.push(Mark { x: pen.x, y: pen.y, text: part.to_string(), width });
        pen.x += width;
    }
}

fn decode_bytes(font: &[u8], raw: &[u8], encodings: &BTreeMap<Vec<u8>, Encoding>) -> String {
    if let Some(encoding) = encodings.get(font) {
        if let Ok(text) = Document::decode_text(encoding, raw) {
            if !text.is_empty() {
                return text;
            }
        }
    }
    String::from_utf8_lossy(raw).into_owned()
}

fn text_width(text: &str, size: f32) -> f32 {
    let mut width = 0.0f32;
    for ch in text.chars() {
        width += if ch.is_ascii() { size * 0.45 } else { size * 0.95 };
    }
    width.max(0.1)
}

fn rows_from_marks(marks: Vec<Mark>, limited: &mut bool) -> Vec<Vec<String>> {
    let mut spots: Vec<(f32, f32, String, f32)> = Vec::new();
    for mark in marks {
        let pieces = split_line(&mark.text);
        if pieces.len() <= 1 {
            let text = clip_cell(&mark.text);
            if !text.is_empty() {
                spots.push((mark.x, mark.y, text, mark.width));
            }
            continue;
        }
        let mut x = mark.x;
        for piece in pieces {
            if piece.is_empty() {
                continue;
            }
            let width = text_width(&piece, 12.0);
            spots.push((x, mark.y, piece, width));
            x += width + COLUMN_SLACK + 6.0;
        }
    }
    if spots.is_empty() {
        return Vec::new();
    }
    spots.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(left.0.partial_cmp(&right.0).unwrap_or(std::cmp::Ordering::Equal))
    });
    let mut lines: Vec<Vec<Placed>> = Vec::new();
    let mut line_y = f32::NAN;
    for (x, y, text, width) in spots {
        if lines.len() >= MAX_ROWS {
            *limited = true;
            break;
        }
        if lines.is_empty() || (line_y - y).abs() > ROW_SLACK {
            lines.push(Vec::new());
            line_y = y;
        }
        let line = lines.last_mut().unwrap();
        if let Some(prev) = line.last_mut() {
            let gap = x - (prev.x + prev.width);
            if gap < COLUMN_SLACK {
                if gap > 1.5 && !prev.text.ends_with(' ') && !text.starts_with(' ') {
                    prev.text.push(' ');
                }
                let room = MAX_CELL_CHARS.saturating_sub(prev.text.chars().count());
                prev.text.extend(text.chars().take(room));
                prev.width += width.max(0.0);
                continue;
            }
        }
        line.push(Placed { x, text, width });
    }
    let mut samples = Vec::new();
    for line in &lines {
        for cell in line {
            samples.push(cell.x);
        }
    }
    let centers = column_centers(&samples);
    let width = centers.len().min(MAX_COLUMNS);
    if centers.len() > MAX_COLUMNS {
        *limited = true;
    }
    let mut rows = Vec::new();
    for line in lines {
        let mut row = vec![String::new(); width];
        for cell in line {
            let index = nearest_column(&centers[..width], cell.x);
            if row[index].is_empty() {
                row[index] = cell.text;
            } else if row[index].chars().count() < MAX_CELL_CHARS {
                row[index].push(' ');
                let room = MAX_CELL_CHARS.saturating_sub(row[index].chars().count());
                row[index].extend(cell.text.chars().take(room));
            }
        }
        if row.iter().any(|cell| !cell.is_empty()) {
            rows.push(row);
        }
    }
    rows
}

fn column_centers(samples: &[f32]) -> Vec<f32> {
    let mut ordered = samples.to_vec();
    ordered.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let mut centers = Vec::new();
    for x in ordered {
        if let Some(last) = centers.last_mut() {
            if x - *last <= COLUMN_SLACK {
                *last = (*last + x) / 2.0;
                continue;
            }
        }
        centers.push(x);
    }
    centers
}

fn nearest_column(centers: &[f32], x: f32) -> usize {
    centers
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            let left_gap = (x - *left).abs();
            let right_gap = (x - *right).abs();
            left_gap.partial_cmp(&right_gap).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
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
        let body = text_pdf("BT /F1 12 Tf 40 100 Td (SchoolA) Tj 120 0 Td (2026-03-01) Tj ET\nBT /F1 12 Tf 40 80 Td (SchoolB) Tj 120 0 Td (kept) Tj ET\n");
        std::fs::write(&glued, body).unwrap();
        let parsed = read_rows(&glued).unwrap();
        let _ = std::fs::remove_file(&glued);
        assert_eq!(
            parsed.rows,
            vec![
                vec!["SchoolA".to_string(), "2026-03-01".to_string()],
                vec!["SchoolB".to_string(), "kept".to_string()],
            ]
        );
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
