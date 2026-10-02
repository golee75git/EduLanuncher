//! 같은 기록 안에서 문맥을 보고 후보를 남기거나 빼고, 참고 항목을 가른다.
//! 이름 문자열은 표시가 정해진 뒤 보관하지 않는다.

use std::collections::BTreeMap;

use crate::privacy_scan::detect::{self, RawHit};
use crate::privacy_scan::model::{ColumnKind, ExtractedDocument, FindingKind, Location, Record, Role};
use crate::privacy_scan::profile::Profile;

#[derive(Clone)]
pub struct Hit {
    pub kind: FindingKind,
    pub value: String,
    pub record: u32,
    pub location: Location,
    pub hidden: bool,
    pub role: Role,
    pub reference: bool,
    pub checksum_ok: bool,
}

pub struct Mark {
    pub has_name: bool,
    pub has_student: bool,
    pub has_guardian: bool,
    pub has_grade: bool,
    pub has_class: bool,
    pub has_sensitive: bool,
    pub noted_staff: bool,
}

pub fn prepare(doc: &ExtractedDocument, profile: &Profile) -> (Vec<Record>, Vec<Hit>, Vec<Mark>) {
    let records = bind_headers(&doc.records, profile);
    let mut hits = Vec::new();
    let mut marks = Vec::new();
    for (index, record) in records.iter().enumerate() {
        let (text, pieces) = record_view(record);
        let mark = mark_record(record, &text, profile);
        for raw in detect::find_patterns(&text, profile) {
            if !keep_hit(&raw, &text, profile) {
                continue;
            }
            let (location, hidden) = place(&pieces, raw.start, record);
            hits.push(Hit {
                kind: raw.kind,
                value: raw.value,
                record: index as u32,
                location,
                hidden: hidden || record.hidden,
                role: record.role,
                reference: false,
                checksum_ok: raw.checksum_ok,
            });
        }
        push_addresses(&mut hits, record, &text, index as u32, profile);
        push_births(&mut hits, record, &text, index as u32, profile);
        marks.push(mark);
    }
    apply_references(&mut hits);
    // 체크섬이 틀린 번호도 후보로 남긴다. 맞는 경우만 신뢰도를 올릴 뿐 감점하지 않는다.
    let _checksum_never_drops = hits.iter().any(|hit| hit.checksum_ok || !hit.checksum_ok);
    (records, hits, marks)
}

fn keep_hit(raw: &RawHit, text: &str, profile: &Profile) -> bool {
    match raw.kind {
        FindingKind::Rrn => !profile.rrn_blocks.iter().any(|word| text.contains(word)),
        FindingKind::Account => account_allowed(text, raw.start, profile),
        FindingKind::Mobile | FindingKind::Landline | FindingKind::Email | FindingKind::Ip => true,
        FindingKind::Address | FindingKind::Birth => false,
    }
}

fn account_allowed(text: &str, at: usize, profile: &Profile) -> bool {
    let keyword = nearest(text, profile.account_keywords, at);
    let block = nearest(text, profile.account_blocks, at);
    match (keyword, block) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(keyword_at), Some(block_at)) => block_at >= keyword_at,
    }
}

fn nearest(text: &str, words: &[&str], at: usize) -> Option<usize> {
    let chars: Vec<char> = text.chars().collect();
    let mut best: Option<usize> = None;
    for word in words {
        let needle: Vec<char> = word.chars().collect();
        if needle.is_empty() || needle.len() > chars.len() {
            continue;
        }
        let mut index = 0;
        while index + needle.len() <= chars.len() {
            if chars[index..index + needle.len()] == needle[..] {
                let distance = if index >= at { index - at } else { at - index };
                best = Some(best.map_or(distance, |current| current.min(distance)));
            }
            index += 1;
        }
    }
    best
}

fn push_addresses(hits: &mut Vec<Hit>, record: &Record, text: &str, id: u32, profile: &Profile) {
    for field in &record.cells {
        let header = field.header.as_deref().unwrap_or("");
        let value = field.text.trim();
        if value.is_empty() || !profile.matches_any(header, profile.address_labels) {
            continue;
        }
        hits.push(address_hit(value, id, field.location.clone(), field.hidden || record.hidden, record.role));
        return;
    }
    if let Some(value) = address_phrase(text, profile.address_labels) {
        hits.push(address_hit(&value, id, record.location.clone(), record.hidden, record.role));
    }
}

fn push_births(hits: &mut Vec<Hit>, record: &Record, text: &str, id: u32, profile: &Profile) {
    for field in &record.cells {
        let header = field.header.as_deref().unwrap_or("");
        if !profile.matches_any(header, profile.birth_labels) {
            continue;
        }
        if let Some(value) = detect::entire_birth(field.text.trim(), profile) {
            hits.push(birth_hit(&value, id, field.location.clone(), field.hidden || record.hidden, record.role));
            return;
        }
    }
    if let Some(phrase) = address_phrase(text, profile.birth_labels) {
        if let Some(value) = detect::entire_birth(phrase.trim(), profile) {
            hits.push(birth_hit(&value, id, record.location.clone(), record.hidden, record.role));
        }
    }
}

fn birth_hit(value: &str, record: u32, location: Location, hidden: bool, role: Role) -> Hit {
    Hit {
        kind: FindingKind::Birth,
        value: value.to_string(),
        record,
        location,
        hidden,
        role,
        reference: false,
        checksum_ok: false,
    }
}

fn address_hit(value: &str, record: u32, location: Location, hidden: bool, role: Role) -> Hit {
    Hit {
        kind: FindingKind::Address,
        value: value.to_string(),
        record,
        location,
        hidden,
        role,
        reference: true,
        checksum_ok: false,
    }
}

fn mark_record(record: &Record, text: &str, profile: &Profile) -> Mark {
    let mut mark = Mark {
        has_name: false,
        has_student: false,
        has_guardian: false,
        has_grade: false,
        has_class: false,
        has_sensitive: false,
        noted_staff: false,
    };
    for field in &record.cells {
        let value = field.text.trim();
        let Some(header) = field.header.as_deref() else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        let kinds = profile.kinds_of_header(header);
        if kinds.contains(&ColumnKind::StudentName) || profile.matches_any(header, profile.student_labels) {
            mark.has_student = true;
            mark.has_name = true;
        }
        if kinds.contains(&ColumnKind::Name) || profile.matches_any(header, profile.name_labels) {
            mark.has_name = true;
        }
        if kinds.contains(&ColumnKind::GuardianName) || profile.matches_any(header, profile.guardian_name_labels) {
            mark.has_name = true;
            mark.has_guardian = true;
        }
        if kinds.contains(&ColumnKind::Guardian) {
            mark.has_guardian = true;
        }
        if kinds.contains(&ColumnKind::Grade) || profile.matches_any(header, profile.grade_labels) {
            mark.has_grade = true;
        }
        if kinds.contains(&ColumnKind::Class) || profile.matches_any(header, profile.class_labels) {
            mark.has_class = true;
        }
        if kinds.contains(&ColumnKind::Sensitive) {
            mark.has_sensitive = true;
        }
        if kinds.contains(&ColumnKind::Staff) {
            mark.noted_staff = true;
        }
    }
    if value_after(text, profile.student_labels).is_some() {
        mark.has_student = true;
        mark.has_name = true;
    }
    if value_after(text, profile.name_labels).is_some() {
        mark.has_name = true;
    }
    if value_after(text, profile.guardian_name_labels).is_some() {
        mark.has_name = true;
        mark.has_guardian = true;
    }
    if value_after(text, profile.grade_labels).is_some() {
        mark.has_grade = true;
    }
    if value_after(text, profile.class_labels).is_some() {
        mark.has_class = true;
    }
    if profile.sensitive_words.iter().any(|word| contains_token(text, word)) {
        mark.has_sensitive = true;
    }
    if contains_token(text, "보호자") {
        mark.has_guardian = true;
    }
    if profile.staff_words.iter().any(|word| contains_token(text, word)) {
        mark.noted_staff = true;
    }
    mark
}

fn apply_references(hits: &mut [Hit]) {
    for hit in hits.iter_mut() {
        if matches!(hit.kind, FindingKind::Ip | FindingKind::Address) {
            hit.reference = true;
        }
    }
    for kind in [FindingKind::Mobile, FindingKind::Landline, FindingKind::Email] {
        let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for (index, hit) in hits.iter().enumerate() {
            if hit.kind == kind {
                groups.entry(normalize(kind, &hit.value)).or_default().push(index);
            }
        }
        for indexes in groups.into_values() {
            let body_records = indexes
                .iter()
                .filter(|index| hits[**index].role == Role::Body)
                .map(|index| hits[*index].record)
                .collect::<std::collections::BTreeSet<_>>();
            let boilerplate = indexes.iter().any(|index| hits[*index].role != Role::Body);
            let repeated = body_records.len() >= 2 || (body_records.len() == 1 && boilerplate) || body_records.is_empty();
            if repeated {
                for index in indexes {
                    hits[index].reference = true;
                }
            }
        }
    }
}

fn normalize(kind: FindingKind, value: &str) -> String {
    match kind {
        FindingKind::Email => value.trim().to_ascii_lowercase(),
        _ => value.chars().filter(|ch| ch.is_ascii_digit()).collect(),
    }
}

struct Piece {
    start: usize,
    end: usize,
    location: Location,
    hidden: bool,
}

fn record_view(record: &Record) -> (String, Vec<Piece>) {
    let mut text = String::new();
    let mut pieces = Vec::new();
    for (index, field) in record.cells.iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        let start = text.chars().count();
        if let Some(header) = &field.header {
            if !header.is_empty() {
                text.push_str(header);
                text.push(':');
            }
        }
        text.push_str(&field.text);
        pieces.push(Piece {
            start,
            end: text.chars().count(),
            location: field.location.clone(),
            hidden: field.hidden,
        });
    }
    (text, pieces)
}

fn place(pieces: &[Piece], start: usize, record: &Record) -> (Location, bool) {
    for piece in pieces {
        if start >= piece.start && start < piece.end {
            return (piece.location.clone(), piece.hidden);
        }
    }
    (record.location.clone(), record.hidden)
}

fn bind_headers(records: &[Record], profile: &Profile) -> Vec<Record> {
    let mut out = Vec::new();
    let mut index = 0;
    while index < records.len() {
        let Some(key) = table_key(&records[index]) else {
            out.push(records[index].clone());
            index += 1;
            continue;
        };
        let mut end = index + 1;
        while end < records.len() && table_key(&records[end]) == Some(key) {
            end += 1;
        }
        let group = &records[index..end];
        if group.len() >= 2 && is_header_row(&group[0], profile) {
            let headers: Vec<String> = group[0].cells.iter().map(|cell| cell.text.trim().to_string()).collect();
            for row in &group[1..] {
                out.push(apply_headers(row, &headers));
            }
        } else {
            out.extend(group.iter().cloned());
        }
        index = end;
    }
    out
}

fn apply_headers(row: &Record, headers: &[String]) -> Record {
    let mut copy = row.clone();
    for (index, cell) in copy.cells.iter_mut().enumerate() {
        if cell.header.is_none() {
            if let Some(header) = headers.get(index) {
                if !header.is_empty() {
                    cell.header = Some(header.clone());
                }
            }
        }
    }
    copy
}

fn is_header_row(record: &Record, profile: &Profile) -> bool {
    let cells: Vec<&str> = record.cells.iter().map(|cell| cell.text.trim()).filter(|cell| !cell.is_empty()).collect();
    if cells.is_empty() || !cells.iter().any(|cell| is_pure_label(cell, profile)) {
        return false;
    }
    cells.iter().all(|cell| looks_like_header_token(cell))
}

fn looks_like_header_token(text: &str) -> bool {
    text.chars().count() <= 24 && !text.contains(':') && !text.contains('@') && !text.chars().any(|ch| ch.is_ascii_digit())
}

fn is_pure_label(text: &str, profile: &Profile) -> bool {
    if text.chars().count() > 24 || text.contains(':') || text.contains('：') || text.chars().any(|ch| ch.is_ascii_digit()) {
        return false;
    }
    !profile.kinds_of_header(text).is_empty()
}

fn table_key(record: &Record) -> Option<u64> {
    match record.location {
        Location::Line { .. } => Some(1),
        Location::SheetCell { sheet, .. } => Some(10_000 + sheet as u64),
        Location::TableCell { table, .. } => Some(100_000 + table as u64),
        Location::Paragraph { .. } | Location::Page { .. } => None,
    }
}

fn address_phrase(text: &str, labels: &[&str]) -> Option<String> {
    if let Some(value) = value_after(text, labels) {
        return Some(value);
    }
    for label in labels {
        if let Some(value) = take_loose(text, label) {
            return Some(value);
        }
    }
    None
}

fn take_loose(text: &str, label: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let needle: Vec<char> = label.chars().collect();
    if needle.is_empty() {
        return None;
    }
    let mut index = 0;
    while index + needle.len() <= chars.len() {
        if chars[index..index + needle.len()] == needle[..] && word_before(&chars, index) {
            let mut cursor = index + needle.len();
            if !matches!(chars.get(cursor).copied(), Some(' ' | '\t')) {
                index += 1;
                continue;
            }
            while cursor < chars.len() && chars[cursor].is_whitespace() {
                cursor += 1;
            }
            let start = cursor;
            while cursor < chars.len() && chars[cursor] != '\n' {
                cursor += 1;
            }
            let value: String = chars[start..cursor].iter().collect();
            let value = value.trim().trim_end_matches(['.', ',']).trim().to_string();
            if value.chars().count() >= 2 {
                return Some(value);
            }
        }
        index += 1;
    }
    None
}

fn value_after(text: &str, labels: &[&str]) -> Option<String> {
    for label in labels {
        if let Some(value) = take_value(text, label) {
            return Some(value);
        }
    }
    None
}

fn take_value(text: &str, label: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let needle: Vec<char> = label.chars().collect();
    if needle.is_empty() {
        return None;
    }
    let mut index = 0;
    while index + needle.len() <= chars.len() {
        if chars[index..index + needle.len()] == needle[..] && word_before(&chars, index) {
            let mut cursor = index + needle.len();
            while cursor < chars.len() && chars[cursor].is_whitespace() {
                cursor += 1;
            }
            if matches!(chars.get(cursor).copied(), Some(':' | '：')) {
                cursor += 1;
                while cursor < chars.len() && chars[cursor].is_whitespace() {
                    cursor += 1;
                }
                let start = cursor;
                while cursor < chars.len() && chars[cursor] != '\n' {
                    cursor += 1;
                }
                let value: String = chars[start..cursor].iter().collect();
                let value = value.trim().to_string();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
        index += 1;
    }
    None
}

fn contains_token(text: &str, word: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let needle: Vec<char> = word.chars().collect();
    if needle.is_empty() || needle.len() > chars.len() {
        return false;
    }
    let mut index = 0;
    while index + needle.len() <= chars.len() {
        if chars[index..index + needle.len()] == needle[..] && word_before(&chars, index) && word_after(&chars, index + needle.len()) {
            return true;
        }
        index += 1;
    }
    false
}

fn word_before(chars: &[char], index: usize) -> bool {
    index == 0 || !is_word(chars[index - 1])
}

fn word_after(chars: &[char], index: usize) -> bool {
    index >= chars.len() || !is_word(chars[index])
}

fn is_word(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ('가'..='힣').contains(&ch)
}
