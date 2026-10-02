use crate::privacy_scan::budget::ReadBudget;
use crate::privacy_scan::model::{ExtractedDocument, ReasonCode};
use crate::privacy_scan::read::flow;
use crate::privacy_scan::read::zipio;
use crate::privacy_scan::model::Role;

pub fn read(bytes: &[u8], budget: &ReadBudget) -> ExtractedDocument {
    let files = match zipio::unzip(bytes, budget.max_unzip_bytes) {
        Ok(files) => files,
        Err(reason) => return ExtractedDocument::failed(reason),
    };
    let mut records = Vec::new();
    let mut table_base = 0u32;
    let mut saw_object = false;
    let mut saw_section = false;
    let mut broken = false;
    for (name, body) in &files {
        if super::halted() {
            return ExtractedDocument::failed(ReasonCode::TimedOut);
        }
        let lower = name.to_ascii_lowercase();
        if !lower.ends_with(".xml") {
            continue;
        }
        let (role, hidden) = if lower.contains("footer") {
            (Role::Footer, true)
        } else if lower.contains("header") {
            (Role::Header, true)
        } else if lower.contains("section") || lower.starts_with("contents/") {
            saw_section = true;
            (Role::Body, false)
        } else {
            continue;
        };
        let xml = String::from_utf8_lossy(body);
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
    if !saw_section && records.is_empty() {
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
