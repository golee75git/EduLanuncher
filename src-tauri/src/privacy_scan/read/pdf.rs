use lopdf::Document;

use crate::privacy_scan::budget::ReadBudget;
use crate::privacy_scan::model::{ExtractedDocument, Field, Location, ReasonCode, Record, Role};

pub fn read(bytes: &[u8], budget: &ReadBudget) -> ExtractedDocument {
    let document = match Document::load_mem(bytes) {
        Ok(document) => document,
        Err(_) => return ExtractedDocument::failed(ReasonCode::Damaged),
    };
    if document.is_encrypted() || document.was_encrypted() {
        return ExtractedDocument::failed(ReasonCode::Encrypted);
    }
    let mut pages: Vec<u32> = document.get_pages().keys().copied().collect();
    pages.sort_unstable();
    if pages.is_empty() {
        return ExtractedDocument::failed(ReasonCode::ScannedPdf);
    }
    let truncated = pages.len() > budget.max_pages;
    if truncated {
        pages.truncate(budget.max_pages);
    }
    let mut records = Vec::new();
    let mut errors = 0usize;
    let mut chars = 0usize;
    let mut line_no = 0u32;
    for &page in &pages {
        if super::halted() {
            return ExtractedDocument::failed(ReasonCode::TimedOut);
        }
        let chunks = document.extract_text_chunks_with_limit(&[page], budget.max_pdf_page_bytes);
        let chunk = chunks.into_iter().next();
        match chunk {
            Some(Ok(text)) => {
                chars += text.trim().chars().count();
                for line in text.split('\n') {
                    let line = line.trim_end_matches('\r').trim();
                    if line.is_empty() {
                        continue;
                    }
                    line_no = line_no.saturating_add(1);
                    records.push(Record {
                        location: Location::Page { page, line: line_no },
                        role: Role::Body,
                        hidden: false,
                        cells: vec![Field {
                            header: None,
                            text: line.to_string(),
                            location: Location::Page { page, line: line_no },
                            hidden: false,
                        }],
                    });
                }
            }
            Some(Err(_)) => errors += 1,
            None => {}
        }
    }
    if errors > 0 && chars == 0 {
        return ExtractedDocument::failed(ReasonCode::Damaged);
    }
    if chars < budget.min_pdf_chars && errors == 0 {
        return ExtractedDocument::failed(ReasonCode::ScannedPdf);
    }
    let thin = pages.len() >= 2 && chars < pages.len().saturating_mul(12);
    if errors > 0 || truncated || thin {
        ExtractedDocument::partial(ReasonCode::WeakPdf, records)
    } else {
        ExtractedDocument::complete(records)
    }
}
