//! 글자 패턴만 찾는다. 파일을 열지 않고, 점수를 매기지 않는다.

use crate::privacy_scan::model::FindingKind;
use crate::privacy_scan::profile::Profile;

#[derive(Clone, Debug)]
pub struct RawHit {
    pub kind: FindingKind,
    pub start: usize,
    pub end: usize,
    pub value: String,
    pub checksum_ok: bool,
}

pub fn find_patterns(text: &str, profile: &Profile) -> Vec<RawHit> {
    let chars: Vec<char> = text.chars().collect();
    let mut hits = Vec::new();
    let mut used: Vec<(usize, usize)> = Vec::new();
    for hit in scan_rrn(&chars, profile) {
        used.push((hit.start, hit.end));
        hits.push(hit);
    }
    for hit in scan_mobile(&chars, profile, &used) {
        used.push((hit.start, hit.end));
        hits.push(hit);
    }
    for hit in scan_landline(&chars, profile, &used) {
        used.push((hit.start, hit.end));
        hits.push(hit);
    }
    for hit in scan_email(&chars, &used) {
        used.push((hit.start, hit.end));
        hits.push(hit);
    }
    for hit in scan_ip(&chars, &used) {
        used.push((hit.start, hit.end));
        hits.push(hit);
    }
    for hit in scan_account(&chars, profile, &used) {
        hits.push(hit);
    }
    hits
}

pub fn checksum_digit(first12: &[u8], weights: &[i32]) -> Option<u8> {
    if first12.len() != 12 || weights.len() < 12 {
        return None;
    }
    let mut sum = 0i32;
    for index in 0..12 {
        let digit = first12[index].checked_sub(b'0')?;
        if digit > 9 {
            return None;
        }
        sum += digit as i32 * weights[index];
    }
    Some(((11 - (sum % 11)) % 10) as u8)
}

fn scan_rrn(chars: &[char], profile: &Profile) -> Vec<RawHit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if let Some(hit) = try_rrn(chars, index, profile) {
            index = hit.end;
            hits.push(hit);
        } else {
            index += 1;
        }
    }
    hits
}

fn try_rrn(chars: &[char], index: usize, profile: &Profile) -> Option<RawHit> {
    if !boundary_before(chars, index) || index + 13 > chars.len() {
        return None;
    }
    let mut digits = [0u8; 13];
    let mut cursor = index;
    for slot in 0..6 {
        digits[slot] = ascii_digit(chars.get(cursor).copied()?)?;
        cursor += 1;
    }
    if matches!(chars.get(cursor).copied(), Some('-' | ' ')) {
        cursor += 1;
    }
    for slot in 6..13 {
        digits[slot] = ascii_digit(chars.get(cursor).copied()?)?;
        cursor += 1;
    }
    if !boundary_after(chars, cursor) {
        return None;
    }
    let year = year_of(digits[0], digits[1], digits[6], profile)?;
    let month = two_digit(digits[2], digits[3])?;
    let day = two_digit(digits[4], digits[5])?;
    if !valid_date(year, month, day) {
        return None;
    }
    let check = checksum_digit(&digits[..12], profile.rrn_weights)?;
    let checksum_ok = check == digits[12] - b'0';
    let value: String = chars[index..cursor].iter().collect();
    Some(RawHit {
        kind: FindingKind::Rrn,
        start: index,
        end: cursor,
        value,
        checksum_ok,
    })
}

fn year_of(yy0: u8, yy1: u8, century_digit: u8, profile: &Profile) -> Option<i32> {
    let yy = two_digit(yy0, yy1)?;
    let base = profile
        .centuries
        .iter()
        .find(|band| band.digits.contains(&century_digit))?
        .base;
    Some(base + yy as i32)
}

fn two_digit(hi: u8, lo: u8) -> Option<u32> {
    let hi = hi.checked_sub(b'0')?;
    let lo = lo.checked_sub(b'0')?;
    if hi > 9 || lo > 9 {
        return None;
    }
    Some(hi as u32 * 10 + lo as u32)
}

fn valid_date(year: i32, month: u32, day: u32) -> bool {
    let max = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=max).contains(&day)
}

fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn scan_mobile(chars: &[char], profile: &Profile, used: &[(usize, usize)]) -> Vec<RawHit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if let Some((end, value)) = try_mobile(chars, index, profile) {
            if !overlaps(used, index, end) {
                hits.push(hit(FindingKind::Mobile, index, end, value));
                index = end;
                continue;
            }
        }
        index += 1;
    }
    hits
}

fn try_mobile(chars: &[char], index: usize, profile: &Profile) -> Option<(usize, String)> {
    if !boundary_before(chars, index) {
        return None;
    }
    let prefix = profile
        .mobile_prefixes
        .iter()
        .find(|prefix| starts_with(chars, index, prefix))?;
    let prefix_len = prefix.chars().count();
    let bodies: &[usize] = if *prefix == "010" { &[8] } else { &[8, 7] };
    if let Some(end) = separated(chars, index + prefix_len, bodies) {
        if boundary_after(chars, end) {
            return Some((end, slice(chars, index, end)));
        }
    }
    for body in bodies {
        let end = index + prefix_len + body;
        if end <= chars.len() && chars[index..end].iter().all(|c| c.is_ascii_digit()) && boundary_after(chars, end) {
            return Some((end, slice(chars, index, end)));
        }
    }
    None
}

fn scan_landline(chars: &[char], profile: &Profile, used: &[(usize, usize)]) -> Vec<RawHit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if let Some((end, value)) = try_landline(chars, index, profile).or_else(|| try_representative(chars, index)) {
            if !overlaps(used, index, end) {
                hits.push(hit(FindingKind::Landline, index, end, value));
                index = end;
                continue;
            }
        }
        index += 1;
    }
    hits
}

fn try_landline(chars: &[char], index: usize, profile: &Profile) -> Option<(usize, String)> {
    if !boundary_before(chars, index) {
        return None;
    }
    let area = profile
        .area_codes
        .iter()
        .find(|code| starts_with(chars, index, code))?;
    let area_len = area.chars().count();
    let bodies: &[usize] = if *area == "02" { &[7, 8] } else { &[7, 8] };
    if let Some(end) = separated(chars, index + area_len, bodies) {
        if boundary_after(chars, end) {
            return Some((end, slice(chars, index, end)));
        }
    }
    for body in bodies {
        let end = index + area_len + body;
        if end <= chars.len() && chars[index..end].iter().all(|c| c.is_ascii_digit()) && boundary_after(chars, end) {
            return Some((end, slice(chars, index, end)));
        }
    }
    None
}

fn try_representative(chars: &[char], index: usize) -> Option<(usize, String)> {
    if !boundary_before(chars, index) || index + 9 > chars.len() {
        return None;
    }
    if chars[index] != '1' || !matches!(chars[index + 1], '5' | '6' | '8') {
        return None;
    }
    if !chars[index + 2].is_ascii_digit() || !chars[index + 3].is_ascii_digit() || chars[index + 4] != '-' {
        return None;
    }
    if !chars[index + 5..index + 9].iter().all(|c| c.is_ascii_digit()) || !boundary_after(chars, index + 9) {
        return None;
    }
    Some((index + 9, slice(chars, index, index + 9)))
}

fn separated(chars: &[char], mut index: usize, bodies: &[usize]) -> Option<usize> {
    let sep = chars.get(index).copied()?;
    if !matches!(sep, '-' | '.' | ' ') {
        return None;
    }
    index += 1;
    for width in [4usize, 3] {
        if !bodies.iter().any(|body| *body == width + 4) {
            continue;
        }
        let Some(first) = take_digits(chars, index, width) else {
            continue;
        };
        if chars.get(first).copied() != Some(sep) {
            continue;
        }
        if let Some(second) = take_digits(chars, first + 1, 4) {
            return Some(second);
        }
    }
    None
}

fn take_digits(chars: &[char], index: usize, width: usize) -> Option<usize> {
    let end = index + width;
    if end <= chars.len() && chars[index..end].iter().all(|c| c.is_ascii_digit()) {
        Some(end)
    } else {
        None
    }
}

fn scan_email(chars: &[char], used: &[(usize, usize)]) -> Vec<RawHit> {
    let mut hits = Vec::new();
    for (index, ch) in chars.iter().enumerate() {
        if *ch != '@' {
            continue;
        }
        if let Some((start, end)) = try_email(chars, index) {
            if !overlaps(used, start, end) {
                hits.push(hit(FindingKind::Email, start, end, slice(chars, start, end)));
            }
        }
    }
    hits
}

fn try_email(chars: &[char], at: usize) -> Option<(usize, usize)> {
    let mut start = at;
    while start > 0 && is_local(chars[start - 1]) {
        start -= 1;
    }
    if start == at || !boundary_before(chars, start) {
        return None;
    }
    let mut end = at + 1;
    let mut dots = 0;
    while end < chars.len() && is_domain(chars[end]) {
        if chars[end] == '.' {
            dots += 1;
        }
        end += 1;
    }
    if dots < 1 || !boundary_after(chars, end) {
        return None;
    }
    let domain: String = chars[at + 1..end].iter().collect();
    let tld = domain.rsplit('.').next().unwrap_or("");
    if tld.chars().count() < 2 || !tld.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some((start, end))
}

fn scan_ip(chars: &[char], used: &[(usize, usize)]) -> Vec<RawHit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if let Some(end) = try_ip(chars, index) {
            if !overlaps(used, index, end) {
                hits.push(hit(FindingKind::Ip, index, end, slice(chars, index, end)));
                index = end;
                continue;
            }
        }
        index += 1;
    }
    hits
}

fn try_ip(chars: &[char], index: usize) -> Option<usize> {
    if !boundary_before(chars, index) {
        return None;
    }
    let mut cursor = index;
    for part in 0..4 {
        if part > 0 {
            if chars.get(cursor).copied() != Some('.') {
                return None;
            }
            cursor += 1;
        }
        let start = cursor;
        while cursor < chars.len() && chars[cursor].is_ascii_digit() && cursor - start < 3 {
            cursor += 1;
        }
        if cursor == start {
            return None;
        }
        let token: String = chars[start..cursor].iter().collect();
        if token.len() > 1 && token.starts_with('0') {
            return None;
        }
        let value: u32 = token.parse().ok()?;
        if value > 255 {
            return None;
        }
    }
    if boundary_after(chars, cursor) { Some(cursor) } else { None }
}

fn scan_account(chars: &[char], profile: &Profile, used: &[(usize, usize)]) -> Vec<RawHit> {
    let mut hits = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if let Some((end, value)) = try_account(chars, index, profile) {
            if !overlaps(used, index, end) {
                hits.push(hit(FindingKind::Account, index, end, value));
            }
            index = end;
            continue;
        }
        index += 1;
    }
    hits
}

fn try_account(chars: &[char], index: usize, profile: &Profile) -> Option<(usize, String)> {
    if !chars.get(index).copied()?.is_ascii_digit() || !boundary_before(chars, index) {
        return None;
    }
    let mut cursor = index;
    let mut digits = 0usize;
    let mut last_sep = false;
    while cursor < chars.len() {
        let ch = chars[cursor];
        if ch.is_ascii_digit() {
            digits += 1;
            last_sep = false;
            cursor += 1;
            if digits > profile.account_max_digits {
                return None;
            }
        } else if (ch == '-' || ch == ' ') && !last_sep && digits > 0 {
            if chars.get(cursor + 1).copied().is_some_and(|next| next.is_ascii_digit()) {
                last_sep = true;
                cursor += 1;
            } else {
                break;
            }
        } else {
            break;
        }
    }
    if digits < profile.account_min_digits || !boundary_after(chars, cursor) {
        return None;
    }
    Some((cursor, slice(chars, index, cursor)))
}

fn hit(kind: FindingKind, start: usize, end: usize, value: String) -> RawHit {
    RawHit { kind, start, end, value, checksum_ok: false }
}

fn starts_with(chars: &[char], index: usize, prefix: &str) -> bool {
    let prefix: Vec<char> = prefix.chars().collect();
    index + prefix.len() <= chars.len() && chars[index..index + prefix.len()] == prefix[..]
}

fn slice(chars: &[char], start: usize, end: usize) -> String {
    chars[start..end].iter().collect()
}

fn ascii_digit(ch: char) -> Option<u8> {
    if ch.is_ascii_digit() { Some(ch as u8) } else { None }
}

fn boundary_before(chars: &[char], index: usize) -> bool {
    index == 0 || !chars[index - 1].is_ascii_alphanumeric()
}

fn boundary_after(chars: &[char], index: usize) -> bool {
    index >= chars.len() || !chars[index].is_ascii_alphanumeric()
}

fn overlaps(used: &[(usize, usize)], start: usize, end: usize) -> bool {
    used.iter().any(|&(left, right)| start < right && end > left)
}

fn is_local(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '%' | '+' | '-')
}

fn is_domain(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-')
}

/// 칸이나 키워드 뒤 값 전체가 달력 날짜일 때만 생년월일로 본다.
pub fn entire_birth(text: &str, profile: &Profile) -> Option<String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 24 {
        return None;
    }
    let (year, month, day) = korean_birth(text).or_else(|| numeric_birth(text, profile))?;
    if year < profile.birth_year_min || year > profile.birth_year_max || !valid_date(year, month, day) {
        return None;
    }
    Some(text.to_string())
}

fn korean_birth(text: &str) -> Option<(i32, u32, u32)> {
    let chars: Vec<char> = text.chars().collect();
    let year_end = chars.iter().position(|ch| *ch == '년')?;
    if year_end != 4 {
        return None;
    }
    let year = number_at(&chars, 0, 4)? as i32;
    let mut index = year_end + 1;
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    let month_start = index;
    while index < chars.len() && chars[index].is_ascii_digit() {
        index += 1;
    }
    if index == month_start || index - month_start > 2 || chars.get(index).copied() != Some('월') {
        return None;
    }
    let month = number_at(&chars, month_start, index - month_start)?;
    index += 1;
    while index < chars.len() && chars[index].is_whitespace() {
        index += 1;
    }
    let day_start = index;
    while index < chars.len() && chars[index].is_ascii_digit() {
        index += 1;
    }
    if index == day_start || index - day_start > 2 || chars.get(index).copied() != Some('일') {
        return None;
    }
    let day = number_at(&chars, day_start, index - day_start)?;
    if index + 1 != chars.len() {
        return None;
    }
    Some((year, month, day))
}

fn numeric_birth(text: &str, profile: &Profile) -> Option<(i32, u32, u32)> {
    let chars: Vec<char> = text.chars().collect();
    if chars.iter().all(|ch| ch.is_ascii_digit()) {
        return match chars.len() {
            8 => Some((
                number_at(&chars, 0, 4)? as i32,
                number_at(&chars, 4, 2)?,
                number_at(&chars, 6, 2)?,
            )),
            6 => {
                let yy = number_at(&chars, 0, 2)?;
                let year = if yy <= profile.birth_yy_pivot as u32 {
                    2000 + yy as i32
                } else {
                    1900 + yy as i32
                };
                Some((year, number_at(&chars, 2, 2)?, number_at(&chars, 4, 2)?))
            }
            _ => None,
        };
    }
    let year = number_at(&chars, 0, 4)? as i32;
    let mut index = 4;
    if !is_date_sep(chars.get(index).copied()?) {
        return None;
    }
    index += 1;
    let month_start = index;
    while index < chars.len() && chars[index].is_ascii_digit() && index - month_start < 2 {
        index += 1;
    }
    if index == month_start || !is_date_sep(chars.get(index).copied()?) {
        return None;
    }
    let month = number_at(&chars, month_start, index - month_start)?;
    index += 1;
    let day_start = index;
    while index < chars.len() && chars[index].is_ascii_digit() && index - day_start < 2 {
        index += 1;
    }
    if index == day_start || index != chars.len() {
        return None;
    }
    Some((year, month, number_at(&chars, day_start, index - day_start)?))
}

fn number_at(chars: &[char], start: usize, width: usize) -> Option<u32> {
    if start + width > chars.len() {
        return None;
    }
    let mut value = 0u32;
    for ch in &chars[start..start + width] {
        let digit = ch.to_digit(10)?;
        value = value.checked_mul(10)?.checked_add(digit)?;
    }
    Some(value)
}

fn is_date_sep(ch: char) -> bool {
    matches!(ch, '-' | '.' | '/' | ' ')
}
