//! 가짜 테스트 데이터만 사용한다. 실제 개인정보는 없다.

use std::io::{Cursor, Write};
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::detect::{self, find_patterns};
use super::model::{ExtractStatus, FindingKind, Grade, ReasonCode, PARTIAL_NOTE};
use super::profile::Profile;
use std::sync::atomic::AtomicBool;

use super::{preview_bytes, scan_bytes, scan_bytes_halt, scan_path, PreviewTarget, ReadBudget, ScanResult};

fn budget() -> ReadBudget {
    ReadBudget::standard()
}

fn scan(ext: &str, bytes: &[u8]) -> ScanResult {
    scan_bytes(ext, bytes, &budget())
}

fn count(result: &ScanResult, kind: FindingKind) -> u32 {
    result.types.iter().find(|item| item.kind == kind).map(|item| item.count).unwrap_or(0)
}

fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
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

fn rrn(front: &str, tail6: &str, good_check: bool) -> String {
    let twelve = format!("{front}{tail6}");
    let weights = Profile::v1().rrn_weights;
    let mut check = detect::checksum_digit(twelve.as_bytes(), weights).expect("digit");
    if !good_check {
        check = (check + 1) % 10;
    }
    format!("{front}-{tail6}{check}")
}

fn patterns(text: &str) -> Vec<FindingKind> {
    find_patterns(text, &Profile::v1()).into_iter().map(|hit| hit.kind).collect()
}

fn has_kind(text: &str, kind: FindingKind) -> bool {
    patterns(text).contains(&kind)
}

#[test]
fn rrn_accepts_real_dates_and_leap_years() {
    assert!(has_kind("000229-3000000", FindingKind::Rrn), "2000-02-29");
    assert!(!has_kind("000229-1000000", FindingKind::Rrn), "1900-02-29");
    assert!(!has_kind("990231-1234567", FindingKind::Rrn), "invalid feb 31");
    assert!(has_kind("110111-1234567", FindingKind::Rrn), "1911-01-11 shape");
    let bad = rrn("900101", "100000", false);
    assert!(has_kind(&bad, FindingKind::Rrn), "checksum miss stays");
}

#[test]
fn phone_forms_and_boundaries() {
    for sample in ["010-1111-2222", "010.1111.2222", "010 1111 2222", "01011112222"] {
        assert!(has_kind(sample, FindingKind::Mobile), "{sample}");
    }
    assert!(has_kind("011-111-2222", FindingKind::Mobile));
    assert!(!has_kind("010111122229", FindingKind::Mobile));
    assert!(!has_kind("901011112222", FindingKind::Mobile));
    assert!(has_kind("02-1234-5678", FindingKind::Landline));
    assert!(has_kind("1588-0000", FindingKind::Landline));
}

#[test]
fn email_and_ip_shapes() {
    assert!(has_kind("zzsecret@example.com", FindingKind::Email));
    assert!(!has_kind("not-an-email", FindingKind::Email));
    assert!(has_kind("192.168.0.10", FindingKind::Ip));
}

#[test]
fn three_hundred_students_are_red_at_105() {
    let mut csv = String::from("학생명,학년,반,보호자 휴대전화\n");
    for index in 1..=300 {
        csv.push_str(&format!("가짜{index:04},1,2,010-0000-{index:04}\n"));
    }
    let result = scan("csv", csv.as_bytes());
    assert_eq!(result.status, ExtractStatus::Complete);
    assert_eq!(result.grade, Grade::High);
    assert_eq!(result.score, 105, "10+15+15+25+40");
    assert!(!result.immediate);
    assert_eq!(count(&result, FindingKind::Mobile), 300);
    assert!(result.partial_note.is_none());
}

#[test]
fn five_name_phone_rows_are_yellow() {
    let mut csv = String::from("이름,휴대전화\n");
    for index in 1..=5 {
        csv.push_str(&format!("가짜{index},010-1000-{index:04}\n"));
    }
    let result = scan("csv", csv.as_bytes());
    assert_eq!(result.grade, Grade::Possible);
    assert_eq!(result.score, 25, "10+15");
    assert_eq!(count(&result, FindingKind::Mobile), 5);
}

#[test]
fn name_and_rrn_one_row_is_immediate_red() {
    let number = rrn("900101", "100000", true);
    let csv = format!("이름,구분\n가짜,{number}\n");
    let result = scan("csv", csv.as_bytes());
    assert_eq!(result.grade, Grade::High);
    assert!(result.immediate);
    assert_eq!(result.score, 80, "40+40");
    assert_eq!(count(&result, FindingKind::Rrn), 1);
    assert!(!format!("{result:?}").contains(&number));
}

#[test]
fn rrn_without_name_is_yellow() {
    let number = rrn("900101", "100000", true);
    let result = scan("csv", format!("{number}\n").as_bytes());
    assert_eq!(result.grade, Grade::Possible);
    assert!(!result.immediate);
    assert_eq!(result.score, 40);
    assert_eq!(count(&result, FindingKind::Rrn), 1);
}

#[test]
fn checksum_mismatch_with_name_stays_red() {
    let number = rrn("900101", "100000", false);
    let csv = format!("이름,구분\n가짜,{number}\n");
    let result = scan("csv", csv.as_bytes());
    assert_eq!(result.grade, Grade::High);
    assert!(result.immediate);
    assert_eq!(count(&result, FindingKind::Rrn), 1);
}

#[test]
fn account_two_rows_yellow_three_rows_red() {
    let mut two = String::from("이름,입금계좌\n");
    two.push_str("가짜1,123-456-789001\n가짜2,123-456-789002\n");
    let yellow = scan("csv", two.as_bytes());
    assert_eq!(yellow.grade, Grade::Possible);
    assert!(!yellow.immediate);
    assert_eq!(yellow.score, 50, "20+30");
    assert_eq!(count(&yellow, FindingKind::Account), 2);

    let mut three = two.clone();
    three.push_str("가짜3,123-456-789003\n");
    let red = scan("csv", three.as_bytes());
    assert_eq!(red.grade, Grade::High);
    assert!(red.immediate);
    assert_eq!(count(&red, FindingKind::Account), 3);
}

#[test]
fn one_general_candidate_is_never_green() {
    let result = scan("txt", b"zzonly@example.com\n");
    assert_eq!(result.grade, Grade::Possible);
    assert_ne!(result.grade, Grade::Clear);
    assert_eq!(result.score, 5);
}

#[test]
fn corporate_context_is_not_an_rrn() {
    let csv = "이름,법인등록번호\n가짜,110111-1234567\n";
    let result = scan("csv", csv.as_bytes());
    assert_eq!(count(&result, FindingKind::Rrn), 0);
    assert_eq!(count(&result, FindingKind::Account), 0);
    assert_eq!(result.grade, Grade::Clear);
}

#[test]
fn address_column_is_reference_and_free_text_is_not() {
    let column = scan("csv", "주소\n서울시 가짜구\n".as_bytes());
    assert_eq!(column.grade, Grade::Clear);
    assert!(column.reference_count > 0);
    assert!(column.reference_note.is_some());
    assert_eq!(count(&column, FindingKind::Address), 0);

    let phrase = scan("txt", "주소: 서울시 가짜구\n".as_bytes());
    assert!(phrase.reference_count > 0);

    let free = scan("txt", "서울시 가짜구에 갔다\n".as_bytes());
    assert_eq!(free.reference_count, 0);
    assert_eq!(free.grade, Grade::Clear);

    let named = scan("csv", "이름,주소\n가짜,서울시 가짜구\n".as_bytes());
    assert_eq!(named.grade, Grade::Possible);
    assert_eq!(named.score, 20);
}

#[test]
fn repeated_contacts_stay_reference_distinct_ones_do_not() {
    let mut same = String::new();
    for _ in 0..50 {
        same.push_str("office@example.com\n");
    }
    let repeated = scan("txt", same.as_bytes());
    assert_eq!(repeated.grade, Grade::Clear);
    assert_eq!(count(&repeated, FindingKind::Email), 0);
    assert!(repeated.reference_note.is_some());

    let mut phones = String::new();
    for index in 1..=30 {
        phones.push_str(&format!("010-2000-{index:04}\n"));
    }
    let distinct = scan("txt", phones.as_bytes());
    assert_eq!(count(&distinct, FindingKind::Mobile), 30);
    assert_eq!(distinct.reference_count, 0);
    assert_eq!(distinct.grade, Grade::Possible);

    let ip = scan("txt", b"10.0.0.8\n");
    assert_eq!(ip.grade, Grade::Clear);
    assert!(ip.reference_note.is_some());
    assert_eq!(count(&ip, FindingKind::Ip), 0);
}

#[test]
fn false_positive_list_is_not_personal_data() {
    let text = "\
사업자등록번호: 123-45-67890
법인등록번호: 110111-1234567
우편번호: 12345
주문번호: 123456789012
계약번호: 123456789012
접수번호: 123456789012
제품번호: 123456789012
일련번호: 123456789012
거래번호: 123456789012
승인번호: 123456789012
2026-10-02
12:30
15000
1.2.3
123456789012
";
    let result = scan("txt", text.as_bytes());
    assert_eq!(count(&result, FindingKind::Account), 0);
    assert_eq!(count(&result, FindingKind::Rrn), 0);
    assert_eq!(count(&result, FindingKind::Mobile), 0);
    assert_eq!(count(&result, FindingKind::Email), 0);
    assert_eq!(result.grade, Grade::Clear, "score {}", result.score);
}

#[test]
fn unsupported_and_decode_and_size() {
    for ext in ["hwp", "jpg", "jpeg", "png"] {
        let result = scan(ext, b"not-a-real-file");
        assert_eq!(result.grade, Grade::Unavailable, "{ext}");
        assert_eq!(result.reason, Some(ReasonCode::Unsupported));
        assert_eq!(result.reason.unwrap().message(), "이 파일 형식은 검사할 수 없습니다.");
        assert!(!format!("{result:?}").contains("not-a-real-file"));
    }
    let partial = scan("csv", &[0x81]);
    assert_eq!(partial.status, ExtractStatus::Partial);
    assert_eq!(partial.grade, Grade::Incomplete);
    assert_eq!(partial.partial_note, Some(PARTIAL_NOTE));
    assert_ne!(partial.grade, Grade::Clear);

    let mut small = budget();
    small.max_file_bytes = 4;
    let too_big = scan_bytes("csv", b"12345", &small);
    assert_eq!(too_big.reason, Some(ReasonCode::TooLarge));
    assert_eq!(too_big.grade, Grade::Unavailable);
}

#[test]
fn cp949_header_is_read_and_utf8_still_works() {
    let utf8 = "학생명,휴대전화\n가짜,010-3000-0001\n";
    let utf8_result = scan("csv", utf8.as_bytes());
    assert_eq!(count(&utf8_result, FindingKind::Mobile), 1);
    assert_eq!(utf8_result.grade, Grade::Possible);

    let encoded = cp949_csv();
    let result = scan("csv", &encoded);
    assert_eq!(result.status, ExtractStatus::Complete, "{:?}", result.reason);
    assert_eq!(count(&result, FindingKind::Mobile), 1);
    assert_eq!(result.grade, Grade::Possible);
}

#[cfg(windows)]
fn cp949_csv() -> Vec<u8> {
    use windows::core::PCSTR;
    use windows::Win32::Globalization::WideCharToMultiByte;
    let text = "학생명,휴대전화\n가짜,010-3000-0002\n";
    let wide: Vec<u16> = text.encode_utf16().collect();
    unsafe {
        let need = WideCharToMultiByte(949, 0, &wide, None, PCSTR::null(), None);
        assert!(need > 0);
        let mut buf = vec![0u8; need as usize];
        let wrote = WideCharToMultiByte(949, 0, &wide, Some(&mut buf), PCSTR::null(), None);
        assert!(wrote > 0);
        buf.truncate(wrote as usize);
        buf
    }
}

#[cfg(not(windows))]
fn cp949_csv() -> Vec<u8> {
    Vec::new()
}

#[test]
fn zip_damage_budget_and_office_rows() {
    let damaged = scan("xlsx", b"this is not a zip");
    assert_eq!(damaged.status, ExtractStatus::Failed);
    assert_eq!(damaged.grade, Grade::Unavailable);

    let fat = vec![b'A'; 200];
    let bomb = zip_bytes(&[("xl/worksheets/sheet1.xml", &fat)]);
    let mut tight = budget();
    tight.max_unzip_bytes = 64;
    let limited = scan_bytes("xlsx", &bomb, &tight);
    assert_eq!(limited.status, ExtractStatus::Failed);
    assert_eq!(limited.reason, Some(ReasonCode::UnzipLimit));

    let sheet = r#"<worksheet><cols><col min="2" max="2" hidden="1"/></cols><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>이름</t></is></c><c r="B1" t="inlineStr"><is><t>휴대전화</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>가짜</t></is></c><c r="B2" t="inlineStr"><is><t>010-4444-5555</t></is></c></row>
<row r="3"><c r="C3"><f>1+1</f></c></row>
</sheetData></worksheet>"#;
    let book = zip_bytes(&[("xl/worksheets/sheet1.xml", sheet.as_bytes())]);
    let xlsx = scan("xlsx", &book);
    assert_eq!(xlsx.status, ExtractStatus::Partial);
    assert_eq!(xlsx.partial_note, Some(PARTIAL_NOTE));
    assert_eq!(count(&xlsx, FindingKind::Mobile), 1);
    assert_eq!(xlsx.grade, Grade::Possible);
    assert!(xlsx.hidden_notice.is_some());
    assert!(xlsx.types.iter().any(|item| item.kind == FindingKind::Mobile && item.hidden > 0));

    let doc = r#"<w:document><w:tbl>
<w:tr><w:tc><w:p><w:t>이름</w:t></w:p></w:tc><w:tc><w:p><w:t>휴대전화</w:t></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:t>가짜</w:t></w:p></w:tc><w:tc><w:p><w:t>010-5555-6666</w:t></w:p></w:tc></w:tr>
</w:tbl></w:document>"#;
    let footer = r#"<w:ftr><w:p><w:t>02-1234-5678</w:t></w:p></w:ftr>"#;
    let docx = zip_bytes(&[("word/document.xml", doc.as_bytes()), ("word/footer1.xml", footer.as_bytes())]);
    let word = scan("docx", &docx);
    assert_eq!(count(&word, FindingKind::Mobile), 1);
    assert_eq!(word.grade, Grade::Possible);
    assert!(word.reference_count > 0);

    let only_footer = zip_bytes(&[
        ("word/document.xml", br"<w:document></w:document>"),
        ("word/footer1.xml", footer.as_bytes()),
    ]);
    let footer_only = scan("docx", &only_footer);
    assert_eq!(footer_only.grade, Grade::Clear);
    assert!(footer_only.reference_note.is_some());
    assert_eq!(count(&footer_only, FindingKind::Landline), 0);

    let section = r#"<hp:sec><hp:tbl>
<hp:tr><hp:tc><hp:t>이름</hp:t></hp:tc><hp:tc><hp:t>휴대전화</hp:t></hp:tc></hp:tr>
<hp:tr><hp:tc><hp:t>가짜</hp:t></hp:tc><hp:tc><hp:t>010-6666-7777</hp:t></hp:tc></hp:tr>
</hp:tbl><hp:pic/></hp:sec>"#;
    let hwpx = zip_bytes(&[("Contents/section0.xml", section.as_bytes())]);
    let hangul = scan("hwpx", &hwpx);
    assert_eq!(hangul.status, ExtractStatus::Partial);
    assert_ne!(hangul.grade, Grade::Clear);
    assert_eq!(count(&hangul, FindingKind::Mobile), 1);
}

#[test]
fn pdf_text_damage_and_encryption() {
    let readable = build_pdf("010-7777-8888", false);
    let ok = scan("pdf", &readable);
    assert_eq!(ok.status, ExtractStatus::Complete, "{:?} score {}", ok.reason, ok.score);
    assert_eq!(count(&ok, FindingKind::Mobile), 1);

    let thin = build_pdf("Hi", false);
    let scanned = scan("pdf", &thin);
    assert_eq!(scanned.status, ExtractStatus::Failed);
    assert_eq!(scanned.grade, Grade::Unavailable);

    let broken = scan("pdf", b"%PDF-1.4\nnot-a-real-body");
    assert_eq!(broken.status, ExtractStatus::Failed);
    assert_eq!(broken.grade, Grade::Unavailable);

    let locked = build_pdf("010-7777-8888", true);
    let encrypted = scan("pdf", &locked);
    assert_eq!(encrypted.status, ExtractStatus::Failed);
    assert_eq!(encrypted.grade, Grade::Unavailable);
    assert_eq!(encrypted.reason, Some(ReasonCode::Encrypted));
}

#[test]
fn preview_returns_only_masked_text_and_debug_has_no_raw_values() {
    let csv = "이름,휴대전화,이메일,입금계좌\n가짜,010-0000-7777,zzsecret@example.com,123-456-789012\n";
    let result = scan("csv", csv.as_bytes());
    let phone_at = result
        .types
        .iter()
        .find(|item| item.kind == FindingKind::Mobile)
        .and_then(|item| item.locations.first())
        .cloned()
        .expect("phone location");
    let mail_at = result
        .types
        .iter()
        .find(|item| item.kind == FindingKind::Email)
        .and_then(|item| item.locations.first())
        .cloned()
        .expect("mail location");
    let account_at = result
        .types
        .iter()
        .find(|item| item.kind == FindingKind::Account)
        .and_then(|item| item.locations.first())
        .cloned()
        .expect("account location");
    let number = rrn("900101", "100000", true);
    let rrn_csv = format!("구분\n{number}\n");
    let rrn_result = scan("csv", rrn_csv.as_bytes());
    let rrn_at = rrn_result
        .types
        .iter()
        .find(|item| item.kind == FindingKind::Rrn)
        .and_then(|item| item.locations.first())
        .cloned()
        .expect("rrn location");

    let masked = preview_bytes(
        "csv",
        csv.as_bytes(),
        &[
            PreviewTarget { kind: FindingKind::Mobile, location: phone_at },
            PreviewTarget { kind: FindingKind::Email, location: mail_at },
            PreviewTarget { kind: FindingKind::Account, location: account_at.clone() },
        ],
        &budget(),
    )
    .expect("preview");
    assert_eq!(masked[0], "010-****-****");
    assert!(!masked[0].contains("7777"));
    assert!(!masked[0].contains("0000"));
    assert_eq!(masked[1], "zz***@example.com");
    assert!(!masked[1].contains("secret"));
    assert_eq!(masked[2], "123-*********");
    assert!(!masked[2].contains("456"));
    assert!(!masked[2].contains("789012"));

    let rrn_mask = preview_bytes(
        "csv",
        rrn_csv.as_bytes(),
        &[PreviewTarget { kind: FindingKind::Rrn, location: rrn_at }],
        &budget(),
    )
    .expect("rrn preview");
    assert_eq!(rrn_mask[0], "******-*******");
    assert!(!rrn_mask[0].chars().any(|ch| ch.is_ascii_digit()));

    let dumped = format!("{result:?} {rrn_result:?} {:?}", ReasonCode::Missing);
    assert!(!dumped.contains("010-0000-7777"));
    assert!(!dumped.contains("zzsecret"));
    assert!(!dumped.contains("789012"));
    assert!(!dumped.contains(&number));
    assert!(!dumped.contains("가짜"));
    let _ = account_at;
}

#[test]
fn missing_path_and_panic_text_do_not_leak() {
    let path = Path::new(r"C:\__edulauncher_missing_privacy_scan__.csv");
    let result = scan_path(path);
    assert_eq!(result.grade, Grade::Unavailable);
    assert_eq!(result.reason, Some(ReasonCode::Missing));
    let dumped = format!("{result:?} {}", result.reason.unwrap().message());
    assert!(!dumped.contains("__edulauncher_missing"));
    assert!(!dumped.contains("privacy_scan"));

    let caught = std::panic::catch_unwind(|| panic!("raw-probe"));
    assert!(caught.is_err());
    let failed = ScanResult::failed(ReasonCode::ParserPanic);
    assert!(!format!("{failed:?}").contains("raw-probe"));
    assert_eq!(failed.grade.label(), "검사 불가");
}

#[test]
fn release_profile_can_catch_unwind() {
    let caught = std::panic::catch_unwind(|| panic!("unwind-probe"));
    assert!(caught.is_err());
}

#[test]
fn birth_needs_label_and_real_date() {
    let address = scan("csv", &roster("주소", "강원도 춘천시 중앙로 1"));
    assert_eq!(count(&address, FindingKind::Birth), 30);
    assert_eq!(address.score, 60);
    assert_eq!(address.grade, Grade::Possible);
    assert!(!address.immediate);

    let phone = scan("csv", &roster("보호자 휴대전화", "010-2000-0001"));
    assert_eq!(count(&phone, FindingKind::Birth), 30);
    assert_eq!(count(&phone, FindingKind::Mobile), 30);
    assert_eq!(phone.grade, Grade::High);
    assert_eq!(phone.score, 120);

    let only = scan("csv", "생년월일\n2012-03-01\n".as_bytes());
    assert_eq!(count(&only, FindingKind::Birth), 1);
    assert_eq!(only.score, 0);
    assert_eq!(only.grade, Grade::Possible);

    let meeting = scan("txt", "2026-10-02 회의\n".as_bytes());
    assert_eq!(count(&meeting, FindingKind::Birth), 0);
    assert_eq!(meeting.grade, Grade::Clear);

    let leap = scan("csv", "생년월일\n2023-02-29\n".as_bytes());
    assert_eq!(count(&leap, FindingKind::Birth), 0);

    for sample in ["2012.03.01", "2012/03/01", "20120301", "120301", "2012년 3월 1일"] {
        let csv = format!("생일\n{sample}\n");
        let result = scan("csv", csv.as_bytes());
        assert_eq!(count(&result, FindingKind::Birth), 1, "{sample}");
    }
    let keyword = scan("txt", "출생일: 2012-03-01\n".as_bytes());
    assert_eq!(count(&keyword, FindingKind::Birth), 1);
}

fn roster(third: &str, sample: &str) -> Vec<u8> {
    let mut text = format!("학생명,생년월일,{third}\n");
    for index in 1..=30 {
        let value = if third.contains("휴대") {
            format!("010-2000-{index:04}")
        } else {
            sample.to_string()
        };
        text.push_str(&format!("학생{index},2012-03-01,{value}\n"));
    }
    text.into_bytes()
}

#[test]
fn hidden_places_raise_notice() {
    let cases = [
        ("xlsx", "xlsx-hidden-sheet", xlsx_sheet("hidden", "010-2111-2222"), FindingKind::Mobile),
        ("xlsx", "xlsx-very-hidden-sheet", xlsx_sheet("veryHidden", "010-2111-3333"), FindingKind::Mobile),
        ("xlsx", "xlsx-hidden-row", xlsx_row_or_col(true), FindingKind::Mobile),
        ("xlsx", "xlsx-hidden-col", xlsx_row_or_col(false), FindingKind::Mobile),
        ("xlsx", "xlsx-comment", xlsx_comment(), FindingKind::Email),
        ("docx", "docx-header-table", docx_header_table(), FindingKind::Mobile),
        ("docx", "docx-comment", docx_note("word/comments.xml"), FindingKind::Email),
        ("docx", "docx-property", docx_note("docProps/core.xml"), FindingKind::Email),
        ("hwpx", "hwpx-header", hwpx_part(true), FindingKind::Mobile),
        ("hwpx", "hwpx-footer", hwpx_part(false), FindingKind::Mobile),
    ];
    for (ext, name, bytes, kind) in cases {
        let result = scan(ext, &bytes);
        assert!(result.hidden_notice.is_some(), "{name} 미지원 또는 숨김 표시 없음");
        assert!(count(&result, kind) + result.reference_count >= 1, "{name}");
    }
}

fn xlsx_sheet(state: &str, phone: &str) -> Vec<u8> {
    let workbook = format!(
        r#"<?xml version="1.0"?><workbook><sheets><sheet name="숨김" sheetId="1" state="{state}" r:id="rId1"/></sheets></workbook>"#
    );
    let sheet = format!(
        r#"<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>{phone}</t></is></c></row></sheetData></worksheet>"#
    );
    zip_bytes(&[
        ("[Content_Types].xml", br#"<?xml version="1.0"?><Types></Types>"#),
        ("xl/workbook.xml", workbook.as_bytes()),
        ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
    ])
}

fn xlsx_row_or_col(row: bool) -> Vec<u8> {
    let body = if row {
        r#"<?xml version="1.0"?><worksheet><sheetData><row r="1" hidden="1"><c r="A1" t="inlineStr"><is><t>010-2444-5555</t></is></c></row></sheetData></worksheet>"#
    } else {
        r#"<?xml version="1.0"?><worksheet><cols><col min="1" max="1" hidden="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>010-2444-6666</t></is></c></row></sheetData></worksheet>"#
    };
    zip_bytes(&[
        ("[Content_Types].xml", br#"<?xml version="1.0"?><Types></Types>"#),
        ("xl/workbook.xml", r#"<?xml version="1.0"?><workbook><sheets><sheet name="표" sheetId="1" r:id="rId1"/></sheets></workbook>"#.as_bytes()),
        ("xl/worksheets/sheet1.xml", body.as_bytes()),
    ])
}

fn xlsx_comment() -> Vec<u8> {
    zip_bytes(&[
        ("[Content_Types].xml", br#"<?xml version="1.0"?><Types></Types>"#),
        ("xl/workbook.xml", r#"<?xml version="1.0"?><workbook><sheets><sheet name="표" sheetId="1" r:id="rId1"/></sheets></workbook>"#.as_bytes()),
        ("xl/worksheets/sheet1.xml", br#"<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#),
        ("xl/comments1.xml", "<?xml version=\"1.0\"?><comments><commentList><comment><text><t>zz@example.com</t></text></comment></commentList></comments>".as_bytes()),
    ])
}

fn docx_header_table() -> Vec<u8> {
    let header = r#"<?xml version="1.0"?><hdr><tbl><tr><tc><p><r><t>010-3000-0001</t></r></p></tc></tr><tr><tc><p><r><t>010-3000-0002</t></r></p></tc></tr></tbl></hdr>"#;
    zip_bytes(&[
        ("[Content_Types].xml", br#"<?xml version="1.0"?><Types></Types>"#),
        ("word/document.xml", r#"<?xml version="1.0"?><document><body><p><r><t>본문</t></r></p></body></document>"#.as_bytes()),
        ("word/header1.xml", header.as_bytes()),
    ])
}

fn docx_note(path: &str) -> Vec<u8> {
    let note = if path.contains("comments") {
        "<?xml version=\"1.0\"?><comments><comment><p><r><t>aa@example.com</t></r></p></comment></comments>"
    } else {
        "<?xml version=\"1.0\"?><coreProperties><creator>bb@example.com</creator></coreProperties>"
    };
    zip_bytes(&[
        ("[Content_Types].xml", br#"<?xml version="1.0"?><Types></Types>"#),
        ("word/document.xml", r#"<?xml version="1.0"?><document><body><p><r><t>본문</t></r></p></body></document>"#.as_bytes()),
        (path, note.as_bytes()),
    ])
}

fn hwpx_part(header: bool) -> Vec<u8> {
    let path = if header { "Contents/header.xml" } else { "Contents/footer.xml" };
    let phone = if header { "010-4111-2222" } else { "010-4111-3333" };
    let part = format!("<?xml version=\"1.0\"?><h><p><run><t>{phone}</t></run></p></h>");
    zip_bytes(&[
        ("mimetype", b"application/hwp+zip"),
        ("Contents/section0.xml", "<?xml version=\"1.0\"?><sec><p><run><t>본문</t></run></p></sec>".as_bytes()),
        (path, part.as_bytes()),
    ])
}

fn build_pdf(text: &str, encrypt: bool) -> Vec<u8> {
    let stream = format!("BT /F1 24 Tf 40 80 Td ({text}) Tj ET\n");
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_string(),
        format!("<< /Length {} >>\nstream\n{stream}endstream", stream.len()),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
    ];
    if encrypt {
        objects.push("<< /Filter /Standard /V 1 /R 2 >>".to_string());
    }
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
    let mut trailer = format!("trailer\n<< /Size {size} /Root 1 0 R");
    if encrypt {
        trailer.push_str(" /Encrypt 6 0 R");
    }
    trailer.push_str(" >>\n");
    out.extend(xref.as_bytes());
    out.extend(trailer.as_bytes());
    out.extend(format!("startxref\n{xref_at}\n%%EOF\n").as_bytes());
    out
}

#[test]
fn halt_before_parse_is_timeout() {
    let flag = AtomicBool::new(true);
    let csv = scan_bytes_halt("csv", "가짜,010-0000-1111\n".as_bytes(), &budget(), &flag);
    assert_eq!(csv.reason, Some(ReasonCode::TimedOut));
    assert_eq!(csv.grade, Grade::Unavailable);
    assert!(csv.types.is_empty());
    let packed = scan_bytes_halt("xlsx", &zip_bytes(&[("xl/workbook.xml", b"<workbook/>")]), &budget(), &flag);
    assert_eq!(packed.reason, Some(ReasonCode::TimedOut));
}
