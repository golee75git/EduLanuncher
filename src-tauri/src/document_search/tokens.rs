use std::collections::BTreeSet;

use crate::index_key::mac12;
use crate::privacy_scan::{find_patterns, FindingKind, Profile};

pub fn blank_secrets(text: &str) -> String {
    let profile = Profile::v1();
    let hits = find_patterns(text, &profile);
    let mut chars: Vec<char> = text.chars().collect();
    for hit in hits {
        if !matches!(
            hit.kind,
            FindingKind::Rrn | FindingKind::Mobile | FindingKind::Account | FindingKind::Email
        ) {
            continue;
        }
        let end = hit.end.min(chars.len());
        for slot in chars.iter_mut().take(end).skip(hit.start) {
            *slot = ' ';
        }
    }
    chars.into_iter().collect()
}

pub fn fold_char(ch: char) -> char {
    if ch.is_ascii_uppercase() {
        return ch.to_ascii_lowercase();
    }
    let mut lower = ch.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(one), None) => one,
        _ => ch,
    }
}

pub fn folded(text: &str) -> Vec<char> {
    text.chars().filter(|ch| *ch != '\0').map(fold_char).collect()
}

pub fn trigram_set(chars: &[char]) -> BTreeSet<String> {
    let mut set = BTreeSet::new();
    if chars.len() < 3 {
        return set;
    }
    for index in 0..=chars.len() - 3 {
        set.insert(chars[index..index + 3].iter().collect());
    }
    set
}

pub fn hashed_tokens(key: &[u8], text: &str) -> Vec<String> {
    let prepared = blank_secrets(text);
    let grams = trigram_set(&folded(&prepared));
    let mut tokens = Vec::with_capacity(grams.len());
    for gram in grams {
        if let Some(token) = mac12(key, &gram) {
            tokens.push(token);
        }
    }
    tokens
}

pub fn match_expr(key: &[u8], query: &str) -> Option<String> {
    let grams = trigram_set(&folded(query));
    if grams.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    for gram in grams {
        let token = mac12(key, &gram)?;
        parts.push(token);
    }
    Some(parts.join(" AND "))
}

pub fn contains_query(text: &str, query: &str) -> bool {
    let hay = folded(text);
    let needle = folded(query);
    if needle.is_empty() || hay.len() < needle.len() {
        return false;
    }
    hay.windows(needle.len()).any(|window| window == needle.as_slice())
}

pub fn snippet_around(text: &str, query: &str) -> String {
    let hay = folded(text);
    let needle = folded(query);
    let start = hay
        .windows(needle.len().max(1))
        .position(|window| !needle.is_empty() && window == needle.as_slice())
        .unwrap_or(0);
    let from = start.saturating_sub(24);
    let chars: Vec<char> = text.chars().filter(|ch| *ch != '\0').collect();
    let mut window: String = chars.iter().skip(from).take(90).collect();
    if from > 0 {
        window.insert(0, '…');
    }
    if chars.len() > from + 90 {
        window.push('…');
    }
    window.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_fold_and_hangul_window() {
        let chars = folded("AbC홍길동");
        assert_eq!(chars, vec!['a', 'b', 'c', '홍', '길', '동']);
        let grams = trigram_set(&folded("홍길동"));
        assert!(grams.contains("홍길동"));
        assert_eq!(grams.len(), 1);
    }

    #[test]
    fn secrets_are_blanked_before_grams() {
        let text = blank_secrets("담당 010-1234-5678 품의");
        assert!(!text.contains("010-1234-5678"));
        let grams = trigram_set(&folded(&text));
        assert!(!grams.iter().any(|gram| gram.contains('5') && gram.contains('6')));
    }
}
