use crate::privacy_scan::model::{ExtractedDocument, Field, Location, ReasonCode, Record, Role};
use crate::privacy_scan::read::decode;

pub fn read(kind: &str, bytes: &[u8]) -> ExtractedDocument {
    if super::halted() {
        return ExtractedDocument::failed(ReasonCode::TimedOut);
    }
    let text = match decode::decode_bytes(bytes) {
        Ok(text) => text,
        Err(()) => return ExtractedDocument::partial(ReasonCode::DecodeFailed, Vec::new()),
    };
    let mut records = Vec::new();
    for (index, line) in text.split('\n').enumerate() {
        if index % 32 == 0 && super::halted() {
            return ExtractedDocument::failed(ReasonCode::TimedOut);
        }
        let line_text = line.trim_end_matches('\r');
        if line_text.trim().is_empty() {
            continue;
        }
        let line_no = (index + 1) as u32;
        let cells = if kind == "csv" {
            split_csv(line_text)
                .into_iter()
                .map(|text| field(text, line_no))
                .collect()
        } else {
            vec![field(line_text.to_string(), line_no)]
        };
        records.push(Record {
            location: Location::Line { line: line_no },
            role: Role::Body,
            hidden: false,
            cells,
        });
    }
    ExtractedDocument::complete(records)
}

fn field(text: String, line: u32) -> Field {
    Field {
        header: None,
        text,
        location: Location::Line { line },
        hidden: false,
    }
}

fn split_csv(line: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for ch in line.chars() {
        if ch == '"' {
            quoted = !quoted;
            continue;
        }
        if ch == ',' && !quoted {
            cells.push(current.trim().to_string());
            current.clear();
            continue;
        }
        current.push(ch);
    }
    cells.push(current.trim().to_string());
    cells
}
