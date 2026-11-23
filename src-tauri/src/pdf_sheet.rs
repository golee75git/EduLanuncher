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

type Matrix = [f32; 6];

const IDENTITY: Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

/// 행렬 `left`를 먼저, `right`를 나중에 적용한 합성 행렬(PDF의 행 벡터 규칙).
fn multiply(left: &Matrix, right: &Matrix) -> Matrix {
    [
        left[0] * right[0] + left[1] * right[2],
        left[0] * right[1] + left[1] * right[3],
        left[2] * right[0] + left[3] * right[2],
        left[2] * right[1] + left[3] * right[3],
        left[4] * right[0] + left[5] * right[2] + right[4],
        left[4] * right[1] + left[5] * right[3] + right[5],
    ]
}

fn shifted(tx: f32, ty: f32, base: &Matrix) -> Matrix {
    multiply(&[1.0, 0.0, 0.0, 1.0, tx, ty], base)
}

#[derive(Clone)]
struct Pen {
    /// 글자 공간 → 쪽 공간 변환(`cm`).
    ctm: Matrix,
    /// 글자 행렬과 줄 시작 행렬(`Tm`, `Td`로 바뀐다).
    text: Matrix,
    line: Matrix,
    /// `Tf` 글꼴 크기. 실제 크기는 행렬 배율을 곱해야 한다.
    size: f32,
    leading: f32,
    font: Vec<u8>,
}

impl Default for Pen {
    fn default() -> Self {
        Self { ctm: IDENTITY, text: IDENTITY, line: IDENTITY, size: 12.0, leading: 12.0, font: Vec::new() }
    }
}

impl Pen {
    fn page_matrix(&self) -> Matrix {
        multiply(&self.text, &self.ctm)
    }

    /// 쪽 공간에서 본 글꼴 크기.
    fn page_size(&self) -> f32 {
        let m = self.page_matrix();
        let scale = (m[0] * m[0] + m[1] * m[1]).sqrt();
        let size = self.size * scale;
        if size.is_finite() && size > 0.1 {
            size
        } else {
            self.size.max(0.1)
        }
    }
}

struct Mark {
    x: f32,
    y: f32,
    text: String,
    width: f32,
    size: f32,
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
            "cm" => {
                if let Some(m) = matrix_of(&op.operands) {
                    pen.ctm = multiply(&m, &pen.ctm);
                }
            }
            "BT" => {
                pen.text = IDENTITY;
                pen.line = IDENTITY;
            }
            "Tf" => {
                if let Some(name) = op.operands.first().and_then(|item| item.as_name().ok()) {
                    pen.font = name.to_vec();
                }
                if let Some(size) = op.operands.get(1).and_then(number_of) {
                    if size.abs() > 0.0001 {
                        pen.size = size.abs();
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

fn matrix_of(operands: &[Object]) -> Option<Matrix> {
    if operands.len() < 6 {
        return None;
    }
    let mut m = IDENTITY;
    for (slot, item) in m.iter_mut().zip(operands.iter()) {
        let value = number_of(item)?;
        if !value.is_finite() {
            return None;
        }
        *slot = value;
    }
    Some(m)
}

fn move_line(pen: &mut Pen, operands: &[Object], set_leading: bool) {
    let tx = operands.first().and_then(number_of).unwrap_or(0.0);
    let ty = operands.get(1).and_then(number_of).unwrap_or(0.0);
    if set_leading {
        pen.leading = -ty;
    }
    pen.line = shifted(tx, ty, &pen.line);
    pen.text = pen.line;
}

fn place_line(pen: &mut Pen, operands: &[Object]) {
    if let Some(m) = matrix_of(operands) {
        pen.line = m;
        pen.text = m;
    }
}

fn carriage(pen: &mut Pen) {
    let lead = if pen.leading.abs() < 0.0001 { pen.size } else { pen.leading };
    pen.line = shifted(0.0, -lead, &pen.line);
    pen.text = pen.line;
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
            pen.text = shifted(-adjust / 1000.0 * pen.size, 0.0, &pen.text);
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
        let size = pen.page_size();
        let width = text_width(part, size);
        let at = pen.page_matrix();
        marks.push(Mark { x: at[4], y: at[5], text: part.to_string(), width, size });
        pen.text = shifted(text_width(part, pen.size), 0.0, &pen.text);
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
            let width = text_width(&piece, mark.size);
            spots.push((x, mark.y, piece, width));
            x += width + COLUMN_SLACK + 6.0;
        }
    }
    if spots.is_empty() {
        return Vec::new();
    }
    // 먼저 높이(y)로 줄을 묶고, 줄 안에서 왼쪽부터 정렬한다.
    // y가 조금씩 다른 글자가 한 줄에 섞여도 순서가 뒤엉키지 않게 한다.
    spots.sort_by(|left, right| right.1.partial_cmp(&left.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut grouped: Vec<Vec<(f32, f32, String, f32)>> = Vec::new();
    let mut line_y = f32::NAN;
    for spot in spots {
        if grouped.len() >= MAX_ROWS {
            *limited = true;
            break;
        }
        if grouped.is_empty() || (line_y - spot.1).abs() > ROW_SLACK {
            line_y = spot.1;
            grouped.push(Vec::new());
        }
        grouped.last_mut().unwrap().push(spot);
    }
    let mut lines: Vec<Vec<Placed>> = Vec::new();
    for mut group in grouped {
        group.sort_by(|left, right| left.0.partial_cmp(&right.0).unwrap_or(std::cmp::Ordering::Equal));
        let mut line: Vec<Placed> = Vec::new();
        for (x, _y, text, width) in group {
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
        lines.push(line);
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

    #[test]
    fn scaled_text_matrix_keeps_rows_and_columns() {
        let path = std::env::temp_dir().join(format!("edulauncher-pdf-scaled-{}.pdf", std::process::id()));
        let body = text_pdf(
            "BT /F1 1 Tf 12 0 0 12 40 100 Tm (SchoolA) Tj 10 0 Td (2026-03-01) Tj ET
             BT /F1 1 Tf 12 0 0 12 40 80 Tm (SchoolB) Tj 10 0 Td (kept) Tj ET
             q 2 0 0 2 0 0 cm BT /F1 6 Tf 20 20 Td (SchoolC) Tj 60 0 Td (viaCm) Tj ET Q
",
        );
        std::fs::write(&path, body).unwrap();
        let parsed = read_rows(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            parsed.rows,
            vec![
                vec!["SchoolA".to_string(), "2026-03-01".to_string()],
                vec!["SchoolB".to_string(), "kept".to_string()],
                vec!["SchoolC".to_string(), "viaCm".to_string()],
            ]
        );
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
