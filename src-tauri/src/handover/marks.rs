//! 파일 이름·폴더 이름·본문에서 월 단서를 모은다. 숫자는 시제품과 같게 둔다.

pub const WEIGHT_FILE: f64 = 3.0;
pub const WEIGHT_FOLDER: f64 = 2.0;
pub const WEIGHT_DEADLINE: f64 = 3.0;
pub const WEIGHT_EVENT: f64 = 2.0;
pub const WEIGHT_MENTION: f64 = 1.0;
#[allow(dead_code)]
pub const WEIGHT_MODEL: f64 = 2.5;
pub const WEIGHT_MODIFIED: f64 = 0.7;

const DEADLINE_WORDS: [&str; 6] = ["기한", "마감", "까지", "제출", "회신", "보고"];
const EVENT_WORDS: [&str; 6] = ["개최", "일시", "시행", "실시", "행사", "기간"];

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DateMark {
    pub month: u32,
    pub year: Option<u32>,
    pub day: Option<u32>,
    pub kind: MarkKind,
    pub source: MarkSource,
    pub weight: f64,
    pub snippet: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MarkKind {
    Deadline,
    Event,
    Mention,
    Name,
    Modified,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MarkSource {
    Folder,
    FileName,
    Text,
    #[allow(dead_code)]
    Model,
    Modified,
}

pub struct NameMarks {
    pub years: Vec<u32>,
    pub marks: Vec<DateMark>,
}

struct Hit {
    start: usize,
    end: usize,
    year: Option<u32>,
    month: u32,
    day: Option<u32>,
}

pub fn marks_from_name(name: &str, source: MarkSource) -> NameMarks {
    let chars: Vec<char> = name.chars().collect();
    let weight = match source {
        MarkSource::FileName => WEIGHT_FILE,
        MarkSource::Folder => WEIGHT_FOLDER,
        _ => WEIGHT_MENTION,
    };
    let mut taken = Vec::new();
    let mut years = Vec::new();
    let mut marks = Vec::new();
    for hit in full_hits(&chars).into_iter().chain(compact_hits(&chars)) {
        if !valid_day(hit.month, hit.day) {
            continue;
        }
        if let Some(year) = hit.year {
            push_year(&mut years, year);
        }
        marks.push(DateMark {
            month: hit.month,
            year: hit.year,
            day: hit.day,
            kind: MarkKind::Name,
            source,
            weight,
            snippet: name.to_string(),
        });
        taken.push((hit.start, hit.end));
    }
    for (start, year) in year_hits(&chars) {
        if !inside(start, &taken) {
            push_year(&mut years, year);
        }
    }
    for hit in month_hits(&chars) {
        if valid_month(hit.month) && !inside(hit.start, &taken) {
            marks.push(DateMark {
                month: hit.month,
                year: None,
                day: None,
                kind: MarkKind::Name,
                source,
                weight,
                snippet: name.to_string(),
            });
        }
    }
    NameMarks { years, marks }
}

pub fn marks_from_text(text: &str, default_year: Option<u32>) -> Vec<DateMark> {
    let chars: Vec<char> = text.chars().collect();
    let mut found = Vec::new();
    let mut taken = Vec::new();
    for hit in full_hits(&chars).into_iter().chain(compact_hits(&chars)) {
        let Some(year) = hit.year else { continue };
        if !valid_day(hit.month, hit.day) || !(2000..=2100).contains(&year) {
            continue;
        }
        push_text_mark(&chars, &mut found, &mut taken, hit.month, Some(year), hit.day, hit.start, hit.end);
    }
    for hit in month_day_hits(&chars) {
        if inside(hit.start, &taken) || !valid_day(hit.month, hit.day) {
            continue;
        }
        push_text_mark(&chars, &mut found, &mut taken, hit.month, default_year, hit.day, hit.start, hit.end);
    }
    for hit in month_hits(&chars) {
        if inside(hit.start, &taken) || !valid_month(hit.month) {
            continue;
        }
        let (kind, snippet) = context_kind(&chars, hit.start, hit.end);
        if kind == MarkKind::Mention {
            continue;
        }
        let weight = weight_of(kind) * 0.8;
        found.push(DateMark {
            month: hit.month,
            year: default_year,
            day: None,
            kind,
            source: MarkSource::Text,
            weight,
            snippet,
        });
    }
    keep_strongest(found)
}

pub fn tidy_title(raw: &str) -> String {
    let mut text = strip_brackets(raw);
    text = blank_hits(&text, &full_hits_owned(&text));
    text = blank_hits(&text, &compact_hits_owned(&text));
    text = blank_year_words(&text);
    text = blank_month_words(&text);
    text = blank_seasons(&text);
    text = blank_versions(&text);
    text = blank_leading_noise(&text);
    text = text.replace('_', " ").replace('-', " ");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn push_text_mark(
    chars: &[char],
    found: &mut Vec<DateMark>,
    taken: &mut Vec<(usize, usize)>,
    month: u32,
    year: Option<u32>,
    day: Option<u32>,
    start: usize,
    end: usize,
) {
    let (kind, snippet) = context_kind(chars, start, end);
    if kind == MarkKind::Mention && start > 800 {
        return;
    }
    found.push(DateMark {
        month,
        year,
        day,
        kind,
        source: MarkSource::Text,
        weight: weight_of(kind),
        snippet,
    });
    taken.push((start, end));
}

fn keep_strongest(marks: Vec<DateMark>) -> Vec<DateMark> {
    let mut best: Vec<DateMark> = Vec::new();
    for mark in marks {
        if let Some(slot) = best.iter_mut().find(|item| item.year == mark.year && item.month == mark.month && item.day == mark.day) {
            if mark.weight > slot.weight {
                *slot = mark;
            }
        } else {
            best.push(mark);
        }
    }
    best
}

fn weight_of(kind: MarkKind) -> f64 {
    match kind {
        MarkKind::Deadline => WEIGHT_DEADLINE,
        MarkKind::Event => WEIGHT_EVENT,
        MarkKind::Mention => WEIGHT_MENTION,
        MarkKind::Name => WEIGHT_MENTION,
        MarkKind::Modified => WEIGHT_MODIFIED,
    }
}

fn context_kind(chars: &[char], start: usize, end: usize) -> (MarkKind, String) {
    let mut from = start.saturating_sub(25);
    if from > 0 {
        if let Some(cut) = (from..start).find(|&index| chars[index] == ' ' || chars[index] == '\n') {
            from = cut + 1;
        }
    }
    let to = (end + 10).min(chars.len());
    let window: String = chars[from..to].iter().collect();
    let flat = window.split_whitespace().collect::<Vec<_>>().join(" ");
    if DEADLINE_WORDS.iter().any(|word| window.contains(word)) {
        return (MarkKind::Deadline, flat);
    }
    if EVENT_WORDS.iter().any(|word| window.contains(word)) {
        return (MarkKind::Event, flat);
    }
    (MarkKind::Mention, flat)
}

fn inside(start: usize, taken: &[(usize, usize)]) -> bool {
    taken.iter().any(|(from, to)| *from <= start && start < *to)
}

fn push_year(years: &mut Vec<u32>, year: u32) {
    if !years.contains(&year) {
        years.push(year);
    }
}

fn valid_month(month: u32) -> bool {
    (1..=12).contains(&month)
}

fn valid_day(month: u32, day: Option<u32>) -> bool {
    valid_month(month) && day.map(|value| (1..=31).contains(&value)).unwrap_or(true)
}

fn full_hits_owned(text: &str) -> Vec<(usize, usize)> {
    let chars: Vec<char> = text.chars().collect();
    full_hits(&chars).into_iter().map(|hit| (hit.start, hit.end)).collect()
}

fn compact_hits_owned(text: &str) -> Vec<(usize, usize)> {
    let chars: Vec<char> = text.chars().collect();
    compact_hits(&chars).into_iter().map(|hit| (hit.start, hit.end)).collect()
}

fn full_hits(chars: &[char]) -> Vec<Hit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if prev_digit(chars, index) {
            index += 1;
            continue;
        }
        let Some((year, next)) = take_year(chars, index) else {
            index += 1;
            continue;
        };
        let Some(next) = take_sep(chars, next, &['.', '-', '/', '년']) else {
            index += 1;
            continue;
        };
        let Some((month, next)) = take_number(chars, next, 2) else {
            index += 1;
            continue;
        };
        let Some(next) = take_sep(chars, next, &['.', '-', '/', '월']) else {
            index += 1;
            continue;
        };
        let Some((day, next)) = take_number(chars, next, 2) else {
            index += 1;
            continue;
        };
        if next_digit(chars, next) {
            index += 1;
            continue;
        }
        hits.push(Hit { start: index, end: next, year: Some(expand_year(year)), month, day: Some(day) });
        index = next;
    }
    hits
}

fn compact_hits(chars: &[char]) -> Vec<Hit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index + 8 <= chars.len() {
        if prev_digit(chars, index) || !is_digit(chars[index]) {
            index += 1;
            continue;
        }
        let year_text: String = chars[index..index + 4].iter().collect();
        let month_text: String = chars[index + 4..index + 6].iter().collect();
        let day_text: String = chars[index + 6..index + 8].iter().collect();
        let end = index + 8;
        if next_digit(chars, end) {
            index += 1;
            continue;
        }
        let Ok(year) = year_text.parse::<u32>() else {
            index += 1;
            continue;
        };
        let Ok(month) = month_text.parse::<u32>() else {
            index += 1;
            continue;
        };
        let Ok(day) = day_text.parse::<u32>() else {
            index += 1;
            continue;
        };
        if !(2000..2100).contains(&year) || !(1..=12).contains(&month) || day > 31 {
            index += 1;
            continue;
        }
        hits.push(Hit { start: index, end, year: Some(year), month, day: Some(day) });
        index = end;
    }
    hits
}

fn month_day_hits(chars: &[char]) -> Vec<Hit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if prev_digit_or_dot(chars, index) || !is_digit(chars[index]) {
            index += 1;
            continue;
        }
        let Some((month, next)) = take_number(chars, index, 2) else {
            index += 1;
            continue;
        };
        let Some(next) = take_sep(chars, next, &['.', '월']) else {
            index += 1;
            continue;
        };
        let Some((day, next)) = take_number(chars, next, 2) else {
            index += 1;
            continue;
        };
        let Some(end) = take_tail(chars, next) else {
            index += 1;
            continue;
        };
        hits.push(Hit { start: index, end, year: None, month, day: Some(day) });
        index = end;
    }
    hits
}

fn month_hits(chars: &[char]) -> Vec<Hit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if prev_digit(chars, index) || !is_digit(chars[index]) {
            index += 1;
            continue;
        }
        let Some((month, next)) = take_number(chars, index, 2) else {
            index += 1;
            continue;
        };
        let after_space = skip_space(chars, next);
        if chars.get(after_space) != Some(&'월') {
            index += 1;
            continue;
        }
        let end = after_space + 1;
        if month_followed_by_digit(chars, end) {
            index += 1;
            continue;
        }
        hits.push(Hit { start: index, end, year: None, month, day: None });
        index = end;
    }
    hits
}

fn year_hits(chars: &[char]) -> Vec<(usize, u32)> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index + 4 <= chars.len() {
        if prev_digit(chars, index) {
            index += 1;
            continue;
        }
        let text: String = chars[index..index + 4].iter().collect();
        let end = index + 4;
        if let Ok(year) = text.parse::<u32>() {
            if (2000..2100).contains(&year) && !next_digit(chars, end) {
                hits.push((index, year));
                index = end;
                continue;
            }
        }
        index += 1;
    }
    hits
}

fn take_year(chars: &[char], index: usize) -> Option<(u32, usize)> {
    if index + 4 <= chars.len() {
        let text: String = chars[index..index + 4].iter().collect();
        if let Ok(year) = text.parse::<u32>() {
            if (2000..2100).contains(&year) {
                return Some((year, index + 4));
            }
        }
    }
    if index + 2 <= chars.len() {
        let text: String = chars[index..index + 2].iter().collect();
        if let Ok(year) = text.parse::<u32>() {
            if chars[index].is_ascii_digit() && chars[index + 1].is_ascii_digit() {
                return Some((year, index + 2));
            }
        }
    }
    None
}

fn take_number(chars: &[char], index: usize, max_len: usize) -> Option<(u32, usize)> {
    let start = skip_space(chars, index);
    if start >= chars.len() || !chars[start].is_ascii_digit() {
        return None;
    }
    let mut end = start;
    while end < chars.len() && end - start < max_len && chars[end].is_ascii_digit() {
        end += 1;
    }
    if end == start {
        return None;
    }
    let text: String = chars[start..end].iter().collect();
    text.parse::<u32>().ok().map(|value| (value, end))
}

fn take_sep(chars: &[char], index: usize, kinds: &[char]) -> Option<usize> {
    let start = skip_space(chars, index);
    let ch = *chars.get(start)?;
    if kinds.contains(&ch) {
        Some(skip_space(chars, start + 1))
    } else {
        None
    }
}

fn take_tail(chars: &[char], index: usize) -> Option<usize> {
    let start = skip_space(chars, index);
    match chars.get(start) {
        Some('.') | Some('일') => Some(start + 1),
        _ => None,
    }
}

fn month_followed_by_digit(chars: &[char], index: usize) -> bool {
    let start = skip_space(chars, index);
    chars.get(start).map(|ch| ch.is_ascii_digit()).unwrap_or(false)
}

fn skip_space(chars: &[char], mut index: usize) -> usize {
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    index
}

fn expand_year(year: u32) -> u32 {
    if year < 100 { year + 2000 } else { year }
}

fn prev_digit(chars: &[char], index: usize) -> bool {
    index > 0 && chars[index - 1].is_ascii_digit()
}

fn prev_digit_or_dot(chars: &[char], index: usize) -> bool {
    index > 0 && (chars[index - 1].is_ascii_digit() || chars[index - 1] == '.')
}

fn next_digit(chars: &[char], index: usize) -> bool {
    chars.get(index).map(|ch| ch.is_ascii_digit()).unwrap_or(false)
}

fn is_digit(ch: char) -> bool {
    ch.is_ascii_digit()
}

fn strip_brackets(raw: &str) -> String {
    let chars: Vec<char> = raw.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '(' || chars[index] == '[' {
            let close = if chars[index] == '(' { ')' } else { ']' };
            let mut next = index + 1;
            let mut found = None;
            while next < chars.len() && chars[next] != '\n' {
                if chars[next] == close {
                    found = Some(next);
                    break;
                }
                next += 1;
            }
            if let Some(end) = found {
                out.push(' ');
                index = end + 1;
                continue;
            }
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

fn blank_hits(text: &str, hits: &[(usize, usize)]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        if let Some((_, end)) = hits.iter().find(|(start, _)| *start == index) {
            out.push(' ');
            index = *end;
            continue;
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

fn blank_year_words(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        if !prev_digit(&chars, index) && year_twenty(&chars, index) {
            let end = index + 4;
            let tail = eat_word(&chars, end, &["학년도", "년도", "년"]);
            out.push(' ');
            index = tail;
            continue;
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

fn year_twenty(chars: &[char], index: usize) -> bool {
    if index + 4 > chars.len() || chars[index..index + 2] != ['2', '0'] {
        return false;
    }
    chars[index + 2].is_ascii_digit() && chars[index + 3].is_ascii_digit() && !next_digit(chars, index + 4)
}

fn blank_month_words(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < chars.len() {
        if !prev_digit(&chars, index) {
            if let Some((_month, next)) = take_number(&chars, index, 2) {
                let after = skip_space(&chars, next);
                if chars.get(after) == Some(&'월') {
                    out.push(' ');
                    index = after + 1;
                    continue;
                }
            }
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

fn blank_seasons(text: &str) -> String {
    let mut out = text.to_string();
    for word in ["상반기", "하반기"] {
        out = out.replace(word, " ");
    }
    let chars: Vec<char> = out.chars().collect();
    let mut next = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index].is_ascii_digit() {
            let after = skip_space(&chars, index + 1);
            if eat_exact(&chars, after, "학기") || eat_exact(&chars, after, "분기") {
                let word = if eat_exact(&chars, after, "학기") { 2 } else { 2 };
                next.push(' ');
                index = after + word;
                continue;
            }
        }
        next.push(chars[index]);
        index += 1;
    }
    next
}

fn blank_versions(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut skip = vec![false; chars.len()];
    let mut index = 0;
    while index < chars.len() {
        if let Some(end) = version_at(&chars, index) {
            for slot in &mut skip[index..end] {
                *slot = true;
            }
            index = end;
            continue;
        }
        index += 1;
    }
    chars.iter().enumerate().map(|(index, ch)| if skip[index] { ' ' } else { *ch }).collect()
}

fn version_at(chars: &[char], index: usize) -> Option<usize> {
    for word in ["최종", "복사본", "수정본", "수정", "사본"] {
        if eat_exact(chars, index, word) {
            return Some(index + word.chars().count());
        }
    }
    let folded: String = chars[index..].iter().collect::<String>().to_lowercase();
    if folded.starts_with("copy") {
        return Some(index + 4);
    }
    let head = chars.get(index)?.to_ascii_lowercase();
    if head != 'v' {
        return None;
    }
    let mut next = index + 1;
    if chars.get(next).map(|ch| ch.is_ascii_digit()) != Some(true) {
        return None;
    }
    while next < chars.len() && chars[next].is_ascii_digit() {
        next += 1;
    }
    while next < chars.len() && chars[next] == '.' {
        let after = next + 1;
        if chars.get(after).map(|ch| ch.is_ascii_digit()) != Some(true) {
            break;
        }
        next = after;
        while next < chars.len() && chars[next].is_ascii_digit() {
            next += 1;
        }
    }
    Some(next)
}

fn blank_leading_noise(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut index = 0;
    while index < chars.len() && (chars[index].is_ascii_digit() || chars[index].is_whitespace() || chars[index] == '.' || chars[index] == '_' || chars[index] == '-') {
        index += 1;
    }
    chars[index..].iter().collect()
}

fn eat_word(chars: &[char], index: usize, words: &[&str]) -> usize {
    let start = skip_space(chars, index);
    for word in words {
        if eat_exact(chars, start, word) {
            return start + word.chars().count();
        }
    }
    index
}

fn eat_exact(chars: &[char], index: usize, word: &str) -> bool {
    let needle: Vec<char> = word.chars().collect();
    index + needle.len() <= chars.len() && chars[index..index + needle.len()] == needle[..]
}
