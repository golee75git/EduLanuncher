//! 스톱워치 구간 표를 xlsx 한 장으로 만든다.
//! 칸은 항상 글자로 넣고, 식 칸은 만들지 않는다.

use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const MAX_ROWS: usize = 51;
const COLS: usize = 4;
const MAX_CELL: usize = 80;

pub fn workbook_bytes(rows: &[Vec<String>]) -> Result<Vec<u8>, &'static str> {
    if rows.is_empty() || rows.len() > MAX_ROWS {
        return Err("기록 칸이 올바르지 않습니다.");
    }
    let sheet = sheet_xml(rows)?;
    let entries: [(&str, String); 5] = [
        ("[Content_Types].xml", content_types()),
        ("_rels/.rels", package_rels()),
        ("xl/workbook.xml", workbook_xml()),
        ("xl/_rels/workbook.xml.rels", workbook_rels()),
        ("xl/worksheets/sheet1.xml", sheet),
    ];
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, body) in &entries {
            writer.start_file(*name, options).map_err(|_| "표를 만들지 못했습니다.")?;
            writer.write_all(body.as_bytes()).map_err(|_| "표를 만들지 못했습니다.")?;
        }
        writer.finish().map_err(|_| "표를 만들지 못했습니다.")?;
    }
    Ok(cursor.into_inner())
}

fn sheet_xml(rows: &[Vec<String>]) -> Result<String, &'static str> {
    let mut body = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>",
    );
    for (index, row) in rows.iter().enumerate() {
        if row.len() != COLS {
            return Err("기록 칸이 올바르지 않습니다.");
        }
        let row_no = index + 1;
        body.push_str(&format!("<row r=\"{row_no}\">"));
        for (col, cell) in row.iter().enumerate() {
            if cell.chars().count() > MAX_CELL {
                return Err("기록 칸이 올바르지 않습니다.");
            }
            let letter = b'A' + col as u8;
            body.push_str(&format!(
                "<c r=\"{}{row_no}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
                letter as char,
                xml_text(cell)
            ));
        }
        body.push_str("</row>");
    }
    body.push_str("</sheetData></worksheet>");
    Ok(body)
}

fn xml_text(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\u{0000}'..='\u{001f}' | '\u{007f}' => out.push(' '),
            _ => out.push(ch),
        }
    }
    out
}

fn content_types() -> String {
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\
</Types>"
        .to_string()
}

fn package_rels() -> String {
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\
</Relationships>"
        .to_string()
}

fn workbook_xml() -> String {
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
<sheets><sheet name=\"기록\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"
        .to_string()
}

fn workbook_rels() -> String {
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>\
</Relationships>"
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::ZipArchive;

    fn entry(bytes: &[u8], name: &str) -> String {
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut file = archive.by_name(name).unwrap();
        let mut text = String::new();
        file.read_to_string(&mut text).unwrap();
        text
    }

    #[test]
    fn cells_are_text_and_marks_are_escaped() {
        let bytes = workbook_bytes(&[
            vec!["순서".into(), "누적".into(), "구간".into(), "메모".into()],
            vec!["1".into(), "00:01.00".into(), "00:01.00".into(), "a<b&c".into()],
            vec!["2".into(), "00:02.00".into(), "00:01.00".into(), "=1+1".into()],
        ])
        .unwrap();
        let sheet = entry(&bytes, "xl/worksheets/sheet1.xml");
        assert!(sheet.contains("t=\"inlineStr\""));
        assert!(sheet.contains("a&lt;b&amp;c"));
        assert!(sheet.contains("<t>=1+1</t>"));
        assert!(!sheet.contains("<f>"));
        assert!(entry(&bytes, "[Content_Types].xml").contains("sheet1.xml"));
        assert!(entry(&bytes, "xl/workbook.xml").contains("기록"));
    }

    #[test]
    fn empty_wide_and_long_rows_are_refused() {
        assert!(workbook_bytes(&[]).is_err());
        let wide = vec!["a".into(), "b".into(), "c".into(), "d".into(), "e".into()];
        assert!(workbook_bytes(&[wide]).is_err());
        let long = "가".repeat(81);
        assert!(workbook_bytes(&[vec!["1".into(), "2".into(), "3".into(), long]]).is_err());
        let mut many = Vec::new();
        for _ in 0..=MAX_ROWS {
            many.push(vec!["1".into(), "2".into(), "3".into(), "4".into()]);
        }
        assert!(workbook_bytes(&many).is_err());
    }
}
