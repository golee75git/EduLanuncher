//! 미리보기는 이 함수가 돌려준 가린 문자열만 밖으로 낸다.

use crate::privacy_scan::model::FindingKind;

pub fn mask(kind: FindingKind, value: &str) -> String {
    match kind {
        FindingKind::Mobile | FindingKind::Landline => mask_phone(value),
        FindingKind::Rrn => "******-*******".to_string(),
        FindingKind::Email => mask_email(value),
        FindingKind::Account => mask_account(value),
        FindingKind::Address | FindingKind::Birth => mask_text(value),
        FindingKind::Ip => "***.***.***.***".to_string(),
    }
}

fn digits(value: &str) -> String {
    value.chars().filter(|ch| ch.is_ascii_digit()).collect()
}

fn mask_phone(value: &str) -> String {
    let head: String = digits(value).chars().take(3).collect();
    format!("{head}-****-****")
}

fn mask_account(value: &str) -> String {
    let number = digits(value);
    let head: String = number.chars().take(3).collect();
    let stars = "*".repeat(number.chars().count().saturating_sub(3));
    format!("{head}-{stars}")
}

fn mask_email(value: &str) -> String {
    let Some((local, domain)) = value.split_once('@') else {
        return "***".to_string();
    };
    let head: String = local.chars().take(2).collect();
    format!("{head}***@{domain}")
}

fn mask_text(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => format!("{first}***"),
        None => "***".to_string(),
    }
}
