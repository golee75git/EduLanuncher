use std::collections::BTreeMap;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::privacy_scan::budget::ReadBudget;
use crate::privacy_scan::model::{ExtractedDocument, Field, Location, ReasonCode, Record, Role};
use crate::privacy_scan::read::xmlutil::{self, local_name};
use crate::privacy_scan::read::zipio;

pub fn read(bytes: &[u8], budget: &ReadBudget) -> ExtractedDocument {
    let files = match zipio::unzip(bytes, budget.max_unzip_bytes) {
        Ok(files) => files,
        Err(reason) => return ExtractedDocument::failed(reason),
    };
    let shared = files
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("xl/sharedStrings.xml"))
        .map(|(_, body)| shared_strings(&String::from_utf8_lossy(body)))
        .unwrap_or_default();
    let hidden_sheets = files
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("xl/workbook.xml"))
        .map(|(_, body)| workbook_hidden(&String::from_utf8_lossy(body)))
        .unwrap_or_default();
    if super::halted() {
        return ExtractedDocument::failed(ReasonCode::TimedOut);
    }
    let mut sheets: Vec<&(String, Vec<u8>)> = files
        .iter()
        .filter(|(name, _)| {
            let lower = name.to_ascii_lowercase();
            lower.starts_with("xl/worksheets/sheet") && lower.ends_with(".xml")
        })
        .collect();
    sheets.sort_by(|left, right| left.0.cmp(&right.0));
    if sheets.is_empty() && shared.is_empty() && files.iter().all(|(name, _)| !name.to_ascii_lowercase().contains("sheet")) {
        if files.is_empty() {
            return ExtractedDocument::failed(ReasonCode::Damaged);
        }
    }
    let mut records = Vec::new();
    let mut formula_gap = false;
    let mut broken = false;
    for (index, (name, body)) in sheets.iter().enumerate() {
        let sheet_no = sheet_number(name).unwrap_or((index + 1) as u32);
        let sheet_hidden = hidden_sheets.get(index).copied().unwrap_or(false);
        match parse_sheet(&String::from_utf8_lossy(body), &shared, sheet_no, sheet_hidden) {
            Some((mut rows, gap)) => {
                formula_gap |= gap;
                records.append(&mut rows);
            }
            None if super::halted() => return ExtractedDocument::failed(ReasonCode::TimedOut),
            None => broken = true,
        }
    }
    if super::halted() {
        return ExtractedDocument::failed(ReasonCode::TimedOut);
    }
    if let Some((_, body)) = files.iter().find(|(name, _)| name.to_ascii_lowercase().contains("comments")) {
        if let Some(text) = plain_text(&String::from_utf8_lossy(body)) {
            if !text.is_empty() {
                records.push(note_record(text, true));
            }
        }
    }
    if super::halted() {
        return ExtractedDocument::failed(ReasonCode::TimedOut);
    }
    if broken && records.is_empty() {
        return ExtractedDocument::failed(ReasonCode::Damaged);
    }
    if formula_gap || broken {
        ExtractedDocument::partial(ReasonCode::FormulaGap, records)
    } else {
        ExtractedDocument::complete(records)
    }
}

fn note_record(text: String, hidden: bool) -> Record {
    Record {
        location: Location::Paragraph { index: 1 },
        role: Role::Comment,
        hidden,
        cells: vec![Field {
            header: None,
            text,
            location: Location::Paragraph { index: 1 },
            hidden,
        }],
    }
}

fn shared_strings(xml: &str) -> Vec<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_item = false;
    loop {
        if super::halted() {
            return items;
        }
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
            Ok(Event::Text(text)) if in_item => current.push_str(&xmlutil::xml_text(text.as_ref())),
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    items
}

fn workbook_hidden(xml: &str) -> Vec<bool> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut flags = Vec::new();
    loop {
        if super::halted() {
            return flags;
        }
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element) | Event::Empty(element)) if local_name(element.name().as_ref()) == "sheet" => {
                let mut hidden = false;
                for attr in element.attributes().flatten() {
                    if local_name(attr.key.as_ref()) == "state" {
                        let value = attr.value.as_ref();
                        hidden = value.eq_ignore_ascii_case("hidden") || value.eq_ignore_ascii_case("veryhidden");
                    }
                }
                flags.push(hidden);
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    flags
}

fn parse_sheet(xml: &str, shared: &[String], sheet: u32, sheet_hidden: bool) -> Option<(Vec<Record>, bool)> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut hidden_cols: Vec<(u32, u32)> = Vec::new();
    let mut cells: BTreeMap<(u32, u32), (String, bool)> = BTreeMap::new();
    let mut formula_gap = false;
    let mut row = 0u32;
    let mut row_hidden = false;
    let mut in_cell = false;
    let mut cell_ref = String::new();
    let mut cell_type = String::new();
    let mut in_value = false;
    let mut in_formula = false;
    let mut in_inline = false;
    let mut saw_formula = false;
    let mut value = String::new();

    loop {
        if super::halted() {
            return None;
        }
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(element)) => {
                let name = local_name(element.name().as_ref()).to_string();
                match name.as_str() {
                    "row" => {
                        row = attr_num(&element, "r").unwrap_or(row.saturating_add(1));
                        row_hidden = attr_flag(&element, "hidden");
                    }
                    "c" => {
                        in_cell = true;
                        cell_ref = attr_string(&element, "r").unwrap_or_default();
                        cell_type = attr_string(&element, "t").unwrap_or_default();
                        in_value = false;
                        in_formula = false;
                        in_inline = false;
                        saw_formula = false;
                        value.clear();
                    }
                    "f" if in_cell => {
                        in_formula = true;
                        saw_formula = true;
                    }
                    "v" if in_cell => in_value = true,
                    "is" if in_cell => in_inline = true,
                    "t" if in_cell && in_inline => in_value = true,
                    _ => {}
                }
            }
            Ok(Event::Empty(element)) => {
                let name = local_name(element.name().as_ref()).to_string();
                if name == "col" && attr_flag(&element, "hidden") {
                    let min = attr_num(&element, "min").unwrap_or(1);
                    let max = attr_num(&element, "max").unwrap_or(min);
                    hidden_cols.push((min, max));
                }
            }
            Ok(Event::Text(text)) if in_cell && in_value && !in_formula => {
                value.push_str(&xmlutil::xml_text(text.as_ref()));
            }
            Ok(Event::End(element)) => {
                let name = local_name(element.name().as_ref()).to_string();
                match name.as_str() {
                    "f" => in_formula = false,
                    "v" | "t" => in_value = false,
                    "is" => in_inline = false,
                    "c" if in_cell => {
                        let shown = cell_value(&cell_type, &value, shared);
                        let (row_no, col_no) = cell_position(&cell_ref, row);
                        if shown.trim().is_empty() {
                            if saw_formula {
                                formula_gap = true;
                            }
                        } else {
                            let col_hidden = hidden_cols.iter().any(|(min, max)| col_no >= *min && col_no <= *max);
                            cells.insert((row_no, col_no), (shown, sheet_hidden || row_hidden || col_hidden));
                        }
                        in_cell = false;
                        value.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }

    let mut records = Vec::new();
    let mut current_row = 0u32;
    let mut current: Vec<Field> = Vec::new();
    for ((row_no, col_no), (text, hidden)) in cells {
        if row_no != current_row && !current.is_empty() {
            records.push(sheet_record(sheet, current_row, sheet_hidden, std::mem::take(&mut current)));
        }
        current_row = row_no;
        current.push(Field {
            header: None,
            text,
            location: Location::SheetCell { sheet, row: row_no, col: col_no },
            hidden,
        });
    }
    if !current.is_empty() {
        records.push(sheet_record(sheet, current_row, sheet_hidden, current));
    }
    Some((records, formula_gap))
}

fn sheet_record(sheet: u32, row: u32, hidden: bool, cells: Vec<Field>) -> Record {
    let row_hidden = hidden || cells.iter().all(|cell| cell.hidden);
    Record {
        location: Location::SheetCell { sheet, row, col: 1 },
        role: Role::Body,
        hidden: row_hidden,
        cells,
    }
}

fn cell_value(kind: &str, value: &str, shared: &[String]) -> String {
    if kind == "s" {
        return value
            .trim()
            .parse::<usize>()
            .ok()
            .and_then(|index| shared.get(index))
            .cloned()
            .unwrap_or_default();
    }
    value.trim().to_string()
}

fn cell_position(cell_ref: &str, fallback_row: u32) -> (u32, u32) {
    let col = column_index(cell_ref);
    let row: String = cell_ref.chars().filter(|ch| ch.is_ascii_digit()).collect();
    let row = row.parse::<u32>().unwrap_or(fallback_row);
    (row, col.max(1))
}

fn column_index(cell_ref: &str) -> u32 {
    let mut value = 0u32;
    for ch in cell_ref.chars() {
        if ch.is_ascii_alphabetic() {
            value = value.saturating_mul(26).saturating_add(ch.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
        } else {
            break;
        }
    }
    value
}

fn sheet_number(name: &str) -> Option<u32> {
    let digits: String = name.chars().filter(|ch| ch.is_ascii_digit()).collect();
    digits.parse().ok()
}

fn attr_string(element: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
    for attr in element.attributes().flatten() {
        if local_name(attr.key.as_ref()) == key {
            return Some(xmlutil::xml_text(attr.value.as_ref()));
        }
    }
    None
}

fn attr_num(element: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<u32> {
    attr_string(element, key)?.trim().parse().ok()
}

fn attr_flag(element: &quick_xml::events::BytesStart<'_>, key: &str) -> bool {
    match attr_string(element, key) {
        Some(value) => value == "1" || value.eq_ignore_ascii_case("true"),
        None => false,
    }
}

fn plain_text(xml: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    loop {
        if super::halted() {
            return None;
        }
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(text)) => out.push_str(xmlutil::xml_text(text.as_ref()).trim()),
            Ok(Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
    Some(out)
}
