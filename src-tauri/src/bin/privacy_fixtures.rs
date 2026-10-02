//! 가짜 테스트 파일만 만든다. 출력 폴더는 인자로 받는다. 만든 파일은 저장소에 넣지 않는다.

use std::env;
use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use windows::Win32::Globalization::WideCharToMultiByte;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let Some(folder) = args.next() else {
        eprintln!("사용법: cargo run --bin privacy_fixtures --features fixtures -- <출력 폴더> [folder]");
        return ExitCode::from(2);
    };
    let mode = args.next();
    if args.next().is_some() || (mode.is_some() && mode.as_deref() != Some("folder")) {
        eprintln!("사용법: cargo run --bin privacy_fixtures --features fixtures -- <출력 폴더> [folder]");
        return ExitCode::from(2);
    }
    let root = PathBuf::from(folder);
    if mode.as_deref() == Some("folder") {
        return write_tree(&root);
    }
    if let Err(error) = fs::create_dir_all(&root) {
        eprintln!("폴더를 만들지 못했습니다: {error}");
        return ExitCode::from(1);
    }
    let files = [
        ("가짜테스트-명단.xlsx", roster_xlsx()),
        ("가짜테스트-연락처.csv", contact_csv()),
        ("가짜테스트-공문.docx", footer_docx()),
        ("가짜테스트-숨은시트.xlsx", hidden_xlsx()),
        ("가짜테스트-본문.hwpx", hwpx_body()),
        ("가짜테스트-텍스트.pdf", text_pdf("FAKE TEST DATA 010-2222-3333")),
        ("가짜테스트-한글.hwp", "가짜 테스트 데이터. 이 파일은 HWP가 아닙니다.".as_bytes().to_vec()),
        ("가짜테스트-손상.zip", damaged_zip()),
    ];
    for (name, bytes) in files {
        let path = root.join(name);
        if let Err(error) = fs::write(&path, bytes) {
            eprintln!("쓰지 못했습니다: {error}");
            return ExitCode::from(1);
        }
        println!("{}", path.display());
    }
    ExitCode::SUCCESS
}

fn write_tree(root: &std::path::Path) -> ExitCode {
    let mark = "가짜 테스트 데이터";
    let files = [
        root.join("2026").join("가짜테스트-명단.txt"),
        root.join("2026").join("하위").join("가짜테스트-명단.txt"),
        root.join("기타").join("가짜테스트-메모.dat"),
        root.join("한글").join("가짜테스트-가.hwp"),
        root.join("한글").join("가짜테스트-나.hwp"),
    ];
    for path in files {
        if let Some(parent) = path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                eprintln!("폴더를 만들지 못했습니다: {error}");
                return ExitCode::from(1);
            }
        }
        if let Err(error) = fs::write(&path, mark) {
            eprintln!("쓰지 못했습니다: {error}");
            return ExitCode::from(1);
        }
        println!("{}", path.display());
    }
    ExitCode::SUCCESS
}

fn cp949(text: &str) -> Vec<u8> {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let words = &wide[..wide.len() - 1];
    let len = unsafe { WideCharToMultiByte(949, 0, words, None, None, None) };
    if len <= 0 {
        return text.as_bytes().to_vec();
    }
    let mut out = vec![0u8; len as usize];
    unsafe {
        WideCharToMultiByte(949, 0, words, Some(&mut out), None, None);
    }
    out
}

fn zip_stored(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, body) in entries {
            writer.start_file(*name, options).expect("zip");
            writer.write_all(body).expect("zip");
        }
        writer.finish().expect("zip");
    }
    cursor.into_inner()
}

fn cell(col: &str, row: u32, text: &str) -> String {
    format!(
        "<c r=\"{col}{row}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
        xml_escape(text)
    )
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn sheet(rows: &str) -> String {
    format!("<?xml version=\"1.0\"?><worksheet><sheetData>{rows}</sheetData></worksheet>")
}

fn roster_xlsx() -> Vec<u8> {
    let mut rows = format!(
        "<row r=\"1\">{}{}{}{}</row>",
        cell("A", 1, "학생명"),
        cell("B", 1, "학년"),
        cell("C", 1, "반"),
        cell("D", 1, "보호자 휴대전화")
    );
    for index in 1..=30 {
        let row = index + 1;
        rows.push_str(&format!(
            "<row r=\"{row}\">{}{}{}{}</row>",
            cell("A", row, &format!("가짜학생{index:02}")),
            cell("B", row, "1"),
            cell("C", row, "1"),
            cell("D", row, &format!("010-1000-{index:04}"))
        ));
    }
    let workbook = r#"<?xml version="1.0"?><workbook><sheets><sheet name="가짜명단" sheetId="1"/></sheets></workbook>"#;
    zip_stored(&[
        ("[Content_Types].xml", br#"<?xml version="1.0"?><Types></Types>"#),
        ("xl/workbook.xml", workbook.as_bytes()),
        ("xl/worksheets/sheet1.xml", sheet(&rows).as_bytes()),
    ])
}

fn hidden_xlsx() -> Vec<u8> {
    let visible = sheet(&format!("<row r=\"1\">{}</row>", cell("A", 1, "가짜 테스트 데이터")));
    let hidden = sheet(&format!("<row r=\"1\">{}</row>", cell("A", 1, "010-5555-6666")));
    let workbook = r#"<?xml version="1.0"?><workbook><sheets><sheet name="보이는표" sheetId="1"/><sheet name="숨은표" sheetId="2" state="hidden"/></sheets></workbook>"#;
    zip_stored(&[
        ("[Content_Types].xml", br#"<?xml version="1.0"?><Types></Types>"#),
        ("xl/workbook.xml", workbook.as_bytes()),
        ("xl/worksheets/sheet1.xml", visible.as_bytes()),
        ("xl/worksheets/sheet2.xml", hidden.as_bytes()),
    ])
}

fn contact_csv() -> Vec<u8> {
    let mut text = String::from("이름,휴대전화\n");
    for index in 1..=5 {
        text.push_str(&format!("가짜연락{index},010-2000-000{index}\n"));
    }
    text.push_str("가짜 테스트 데이터\n");
    cp949(&text)
}

fn footer_docx() -> Vec<u8> {
    let body = r#"<?xml version="1.0"?><document><body><p><r><t>가짜 테스트 데이터</t></r></p></body></document>"#;
    let footer = r#"<?xml version="1.0"?><ftr><p><r><t>대표번호 1588-0000</t></r></p><p><r><t>대표번호 1588-0000</t></r></p><p><r><t>대표번호 1588-0000</t></r></p></ftr>"#;
    zip_stored(&[
        ("[Content_Types].xml", br#"<?xml version="1.0"?><Types></Types>"#),
        ("word/document.xml", body.as_bytes()),
        ("word/footer1.xml", footer.as_bytes()),
    ])
}

fn hwpx_body() -> Vec<u8> {
    let section = r#"<?xml version="1.0"?><sec><p><run><t>가짜 테스트 데이터</t></run></p></sec>"#;
    zip_stored(&[
        ("mimetype", b"application/hwp+zip"),
        ("Contents/section0.xml", section.as_bytes()),
    ])
}

fn damaged_zip() -> Vec<u8> {
    let mut bytes = b"PK\x03\x04".to_vec();
    bytes.extend("가짜 테스트 데이터".as_bytes());
    bytes
}

fn text_pdf(text: &str) -> Vec<u8> {
    let stream = format!("BT /F1 12 Tf 40 100 Td ({text}) Tj ET\n");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_string(),
        format!("<< /Length {} >>\nstream\n{stream}endstream", stream.len()),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
    ];
    let mut out = b"%PDF-1.4\n% fake test data\n".to_vec();
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
