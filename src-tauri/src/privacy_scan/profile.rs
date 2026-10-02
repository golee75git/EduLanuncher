//! 점수와 판정 숫자는 여기만 둔다. 탐지와 위험도 계산은 이 값을 읽기만 한다.
//! V1은 일반 규칙 위에 교육 규칙을 얹어 함께 적용한다.

use crate::privacy_scan::model::{ColumnKind, FindingKind};

#[derive(Clone, Copy, Debug)]
pub struct ComboRule {
    pub id: ComboId,
    pub label: &'static str,
    pub score: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ComboId {
    NameRrn,
    NameAccount,
    NameAddress,
    NameMobile,
    NameEmail,
    NameMultiContact,
    NameBirth,
    NameBirthContact,
    EduClass,
    EduGuardian,
    EduSensitive,
}

#[derive(Clone, Copy, Debug)]
pub struct ScaleBand {
    pub at_least: u32,
    pub bonus: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct CenturyBand {
    pub digits: &'static [u8],
    pub base: i32,
}

#[derive(Clone, Debug)]
pub struct Profile {
    pub type_scores: &'static [(FindingKind, i32)],
    pub combos: &'static [ComboRule],
    pub scale: &'static [ScaleBand],
    pub red_score: i32,
    pub immediate_name_rrn: u32,
    pub immediate_name_account: u32,
    pub account_min_digits: usize,
    pub account_max_digits: usize,
    pub max_locations: usize,
    pub rrn_weights: &'static [i32],
    pub centuries: &'static [CenturyBand],
    pub columns: &'static [(&'static str, ColumnKind)],
    pub account_keywords: &'static [&'static str],
    pub account_blocks: &'static [&'static str],
    pub rrn_blocks: &'static [&'static str],
    pub name_labels: &'static [&'static str],
    pub student_labels: &'static [&'static str],
    pub guardian_name_labels: &'static [&'static str],
    pub address_labels: &'static [&'static str],
    pub birth_labels: &'static [&'static str],
    pub birth_year_min: i32,
    pub birth_year_max: i32,
    pub birth_yy_pivot: i32,
    pub grade_labels: &'static [&'static str],
    pub class_labels: &'static [&'static str],
    pub sensitive_words: &'static [&'static str],
    pub staff_words: &'static [&'static str],
    pub mobile_prefixes: &'static [&'static str],
    pub area_codes: &'static [&'static str],
}

impl Profile {
    pub fn v1() -> Self {
        Self {
            type_scores: &TYPE_SCORES,
            combos: &COMBOS,
            scale: &SCALE,
            red_score: 80,
            immediate_name_rrn: 1,
            immediate_name_account: 3,
            account_min_digits: 10,
            account_max_digits: 14,
            max_locations: 100,
            rrn_weights: &[2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5],
            centuries: &CENTURIES,
            columns: &COLUMNS,
            account_keywords: &ACCOUNT_KEYWORDS,
            account_blocks: &ACCOUNT_BLOCKS,
            rrn_blocks: &RRN_BLOCKS,
            name_labels: &["이름"],
            student_labels: &["학생명", "성명"],
            guardian_name_labels: &["보호자명"],
            address_labels: &["주소", "주소지", "거주지"],
            birth_labels: &["생년월일", "생일", "출생일"],
            birth_year_min: 1900,
            birth_year_max: 2099,
            birth_yy_pivot: 30,
            grade_labels: &["학년"],
            class_labels: &["반"],
            sensitive_words: &["상담", "성적", "출결"],
            staff_words: &["교직원"],
            mobile_prefixes: &["010", "011", "016", "017", "018", "019"],
            area_codes: &[
                "031", "032", "033", "041", "042", "043", "044", "051", "052", "053", "054",
                "055", "061", "062", "063", "064", "070", "02",
            ],
        }
    }

    pub fn type_score(&self, kind: FindingKind) -> i32 {
        self.type_scores
            .iter()
            .find(|(item, _)| *item == kind)
            .map(|(_, score)| *score)
            .unwrap_or(0)
    }

    pub fn matches_any(&self, header: &str, labels: &[&str]) -> bool {
        let cell = header.trim();
        labels.iter().any(|label| header_matches(cell, label))
    }

    pub fn kinds_of_header(&self, header: &str) -> Vec<ColumnKind> {
        let cell = header.trim();
        let mut found = Vec::new();
        for (label, kind) in self.columns {
            if header_matches(cell, label) && !found.contains(kind) {
                found.push(*kind);
            }
        }
        found
    }
}

fn header_matches(cell: &str, label: &str) -> bool {
    if cell == label {
        return true;
    }
    // 반, 번호, 성명, 이름, 학년, 주소처럼 짧은 말은 칸 전체와 같을 때만 맞춘다.
    if label.chars().count() <= 2 {
        return false;
    }
    cell.contains(label)
}

const TYPE_SCORES: [(FindingKind, i32); 8] = [
    (FindingKind::Rrn, 40),
    (FindingKind::Account, 20),
    (FindingKind::Mobile, 10),
    (FindingKind::Email, 5),
    (FindingKind::Landline, 3),
    (FindingKind::Address, 0),
    (FindingKind::Birth, 0),
    (FindingKind::Ip, 0),
];

const COMBOS: [ComboRule; 11] = [
    ComboRule { id: ComboId::NameRrn, label: "이름+주민등록번호", score: 40 },
    ComboRule { id: ComboId::NameAccount, label: "이름+계좌번호", score: 30 },
    ComboRule { id: ComboId::NameAddress, label: "이름+주소", score: 20 },
    ComboRule { id: ComboId::NameBirth, label: "이름+생년월일", score: 20 },
    ComboRule { id: ComboId::NameBirthContact, label: "이름+생년월일+연락처", score: 30 },
    ComboRule { id: ComboId::NameMobile, label: "이름+휴대전화", score: 15 },
    ComboRule { id: ComboId::NameEmail, label: "이름+이메일", score: 15 },
    ComboRule { id: ComboId::NameMultiContact, label: "이름+연락처 여러 종류", score: 20 },
    ComboRule { id: ComboId::EduClass, label: "학생명+학년+반", score: 15 },
    ComboRule { id: ComboId::EduGuardian, label: "학생명+보호자+연락처", score: 25 },
    ComboRule { id: ComboId::EduSensitive, label: "학생명+상담/성적/출결", score: 25 },
];

/// 높은 구간만 한 번 더한다. 10명 가산과 50명 가산을 겹치지 않는다.
const SCALE: [ScaleBand; 2] = [
    ScaleBand { at_least: 50, bonus: 40 },
    ScaleBand { at_least: 10, bonus: 20 },
];

const CENTURIES: [CenturyBand; 3] = [
    CenturyBand { digits: &[b'1', b'2', b'5', b'6'], base: 1900 },
    CenturyBand { digits: &[b'3', b'4', b'7', b'8'], base: 2000 },
    CenturyBand { digits: &[b'9', b'0'], base: 1800 },
];

const COLUMNS: [(&str, ColumnKind); 25] = [
    ("보호자 휴대전화", ColumnKind::Phone),
    ("보호자 전화", ColumnKind::Phone),
    ("휴대전화", ColumnKind::Phone),
    ("휴대폰", ColumnKind::Phone),
    ("전화번호", ColumnKind::Phone),
    ("연락처", ColumnKind::Phone),
    ("이메일", ColumnKind::Email),
    ("학생명", ColumnKind::StudentName),
    ("보호자명", ColumnKind::GuardianName),
    ("보호자", ColumnKind::Guardian),
    ("교직원", ColumnKind::Staff),
    ("성명", ColumnKind::Name),
    ("이름", ColumnKind::Name),
    ("학년", ColumnKind::Grade),
    ("주소지", ColumnKind::Address),
    ("거주지", ColumnKind::Address),
    ("주소", ColumnKind::Address),
    ("생년월일", ColumnKind::Birth),
    ("출생일", ColumnKind::Birth),
    ("생일", ColumnKind::Birth),
    ("상담", ColumnKind::Sensitive),
    ("성적", ColumnKind::Sensitive),
    ("출결", ColumnKind::Sensitive),
    ("반", ColumnKind::Class),
    ("번호", ColumnKind::Roster),
];

const ACCOUNT_KEYWORDS: [&str; 9] = [
    "입금계좌", "급여계좌", "환불계좌", "계좌번호", "예금주", "계좌", "은행", "입금", "송금",
];

const ACCOUNT_BLOCKS: [&str; 14] = [
    "사업자등록번호",
    "법인등록번호",
    "문서번호",
    "주문번호",
    "계약번호",
    "접수번호",
    "제품번호",
    "일련번호",
    "거래번호",
    "승인번호",
    "우편번호",
    "법인번호",
    "금액",
    "버전",
];

const RRN_BLOCKS: [&str; 2] = ["법인등록번호", "법인번호"];
