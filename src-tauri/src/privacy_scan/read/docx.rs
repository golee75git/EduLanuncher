use crate::privacy_scan::budget::ReadBudget;
use crate::privacy_scan::model::{ExtractedDocument, Field, Location, ReasonCode, Record, Role};
use crate::privacy_scan::read::flow;
use crate::privacy_scan::read::zipio;

pub fn read(bytes: &[u8], budget: &ReadBudget) -> ExtractedDocument {
    let files = match zipio::unzip(bytes, budget.max_unzip_bytes) {
        Ok(files) => files,
        Err(reason) => return ExtractedDocument::failed(reason),
    };
    let mut records = Vec::new();
    let mut table_base = 0u32;
    let mut saw_object = false;
    let mut saw_main = false;
    let mut broken = false;
    for (name, body) in &files {
        if super::halted() {
            return ExtractedDocument::failed(ReasonCode::TimedOut);
        }
        let lower = name.to_ascii_lowercase();
        let xml = String::from_utf8_lossy(body);
        let (role, hidden, main) = match part_role(&lower) {
            Some(part) => part,
            None => continue,
        };
        saw_main |= main;
        if role == Role::Property {
            if let Some(text) = property_text(&xml) {
                records.push(property_record(text));
            }
            continue;
        }
        match flow::read_flow(&xml, role, hidden, table_base) {
            Some(flow) => {
                table_base = table_base.saturating_add(32);
                saw_object |= flow.saw_object;
                records.extend(flow.records);
            }
            None if super::halted() => return ExtractedDocument::failed(ReasonCode::TimedOut),
            None => broken = true,
        }
    }
    if !saw_main && records.is_empty() {
        return ExtractedDocument::failed(ReasonCode::Damaged);
    }
    if broken && records.is_empty() {
        return ExtractedDocument::failed(ReasonCode::Damaged);
    }
    if saw_object || broken {
        ExtractedDocument::partial(ReasonCode::WeakPdf, records)
    } else {
        ExtractedDocument::complete(records)
    }
}

fn part_role(name: &str) -> Option<(Role, bool, bool)> {
    if name == "word/document.xml" {
        Some((Role::Body, false, true))
    } else if name.starts_with("word/header") {
        Some((Role::Header, true, false))
    } else if name.starts_with("word/footer") {
        Some((Role::Footer, true, false))
    } else if name.starts_with("word/comments") || name.starts_with("word/footnotes") || name.starts_with("word/endnotes") {
        Some((Role::Comment, true, false))
    } else if name.starts_with("docprops/") {
        Some((Role::Property, true, false))
    } else {
        None
    }
}

fn property_text(xml: &str) -> Option<String> {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Text(text)) => {
                let piece = crate::privacy_scan::read::xmlutil::xml_text(text.as_ref());
                let piece = piece.trim();
                if !piece.is_empty() {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(piece);
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
    if out.is_empty() { None } else { Some(out) }
}

fn property_record(text: String) -> Record {
    Record {
        location: Location::Paragraph { index: 1 },
        role: Role::Property,
        hidden: true,
        cells: vec![Field {
            header: None,
            text,
            location: Location::Paragraph { index: 1 },
            hidden: true,
        }],
    }
}
