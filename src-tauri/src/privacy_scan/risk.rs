//! 점수와 등급. 파일 입력이 없고, 원문을 결과에 복사하지 않는다.

use crate::privacy_scan::context::{Hit, Mark};
use crate::privacy_scan::model::{
    ComboCount, ExtractStatus, ExtractedDocument, FindingKind, Grade, HIDDEN_NOTE, PARTIAL_NOTE, REFERENCE_NOTE, ScanResult, TypeCount,
};
use crate::privacy_scan::profile::{ComboId, Profile};

pub fn judge(doc: &ExtractedDocument, hits: &[Hit], marks: &[Mark], profile: &Profile) -> ScanResult {
    if doc.status == ExtractStatus::Failed {
        return ScanResult::failed(doc.reason.unwrap_or(crate::privacy_scan::model::ReasonCode::Damaged));
    }
    let staff_rows = marks.iter().filter(|mark| mark.noted_staff).count();
    let _staff_adds_no_score = staff_rows;

    let general = |hit: &Hit| !hit.reference && (hit.kind == FindingKind::Birth || profile.type_score(hit.kind) > 0);
    let mut types = Vec::new();
    for (kind, _) in profile.type_scores {
        let matched: Vec<&Hit> = hits.iter().filter(|hit| hit.kind == *kind && general(hit)).collect();
        if matched.is_empty() {
            continue;
        }
        let mut locations = Vec::new();
        for hit in matched.iter().take(profile.max_locations) {
            locations.push(hit.location.clone());
        }
        let count = matched.len() as u32;
        types.push(TypeCount {
            kind: *kind,
            count,
            hidden: matched.iter().filter(|hit| hit.hidden).count() as u32,
            overflow: count.saturating_sub(locations.len() as u32),
            locations,
        });
    }

    let mut combo_counts = Vec::new();
    for rule in profile.combos {
        let records = marks
            .iter()
            .enumerate()
            .filter(|(index, mark)| combo_in_record(rule.id, *index as u32, mark, hits))
            .count() as u32;
        if records > 0 {
            combo_counts.push(ComboCount { label: rule.label, records });
        }
    }

    let mut score = 0;
    for item in &types {
        score += profile.type_score(item.kind);
    }
    for item in &combo_counts {
        if let Some(rule) = profile.combos.iter().find(|rule| rule.label == item.label) {
            score += rule.score;
        }
    }
    let scale_records = marks
        .iter()
        .enumerate()
        .filter(|(index, _)| hits.iter().any(|hit| hit.record == *index as u32 && general(hit)))
        .count() as u32;
    let mut scale_bonus = 0;
    let mut scale_floor = 0;
    for band in profile.scale {
        if scale_records >= band.at_least && band.at_least >= scale_floor {
            scale_floor = band.at_least;
            scale_bonus = band.bonus;
        }
    }
    score += scale_bonus;

    let name_rrn = combo_records(ComboId::NameRrn, marks, hits);
    let name_account = combo_records(ComboId::NameAccount, marks, hits);
    let immediate = name_rrn >= profile.immediate_name_rrn || name_account >= profile.immediate_name_account;
    let general_exists = types.iter().any(|item| item.count > 0);
    let combo_exists = combo_counts.iter().any(|item| item.records > 0);
    let grade = if immediate || score >= profile.red_score {
        Grade::High
    } else if general_exists || combo_exists {
        Grade::Possible
    } else if doc.status == ExtractStatus::Partial {
        Grade::Incomplete
    } else {
        Grade::Clear
    };

    let reference_count = hits.iter().filter(|hit| hit.reference).count() as u32;
    ScanResult {
        status: doc.status,
        grade,
        partial_note: if doc.status == ExtractStatus::Partial { Some(PARTIAL_NOTE) } else { None },
        reason: doc.reason,
        types,
        combos: combo_counts,
        reference_count,
        reference_note: if reference_count > 0 && grade == Grade::Clear { Some(REFERENCE_NOTE) } else { None },
        hidden_notice: if hits.iter().any(|hit| hit.hidden) { Some(HIDDEN_NOTE) } else { None },
        score,
        immediate,
    }
}

fn combo_records(id: ComboId, marks: &[Mark], hits: &[Hit]) -> u32 {
    marks
        .iter()
        .enumerate()
        .filter(|(index, mark)| combo_in_record(id, *index as u32, mark, hits))
        .count() as u32
}

fn combo_in_record(id: ComboId, record: u32, mark: &Mark, hits: &[Hit]) -> bool {
    let has = |kind: FindingKind, ignore_reference: bool| {
        hits.iter().any(|hit| hit.record == record && hit.kind == kind && (ignore_reference || !hit.reference))
    };
    let contact = has(FindingKind::Mobile, false) || has(FindingKind::Landline, false) || has(FindingKind::Email, false);
    match id {
        ComboId::NameRrn => mark.has_name && has(FindingKind::Rrn, false),
        ComboId::NameAccount => mark.has_name && has(FindingKind::Account, false),
        ComboId::NameAddress => mark.has_name && has(FindingKind::Address, true),
        ComboId::NameBirth => mark.has_name && has(FindingKind::Birth, false),
        ComboId::NameBirthContact => mark.has_name && has(FindingKind::Birth, false) && contact,
        ComboId::NameMobile => mark.has_name && has(FindingKind::Mobile, false),
        ComboId::NameEmail => mark.has_name && has(FindingKind::Email, false),
        ComboId::NameMultiContact => mark.has_name && has(FindingKind::Mobile, false) && has(FindingKind::Email, false),
        ComboId::EduClass => mark.has_student && mark.has_grade && mark.has_class,
        ComboId::EduGuardian => mark.has_student && mark.has_guardian && contact,
        ComboId::EduSensitive => mark.has_student && mark.has_sensitive,
    }
}
