//! 보안 상태 점검의 판정. 날짜와 수집 결과만 받고, PC를 읽거나 설정을 바꾸지 않는다.

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct CivilDate {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OsFamily {
    Windows10,
    Windows11,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditionGroup {
    HomePro,
    EnterpriseEducation,
    Unlisted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mark {
    Ok,
    Watch,
    Bad,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateOrigin {
    Registry,
    Agent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockFact {
    ReadFailed,
    PolicyOn,
    PolicyOff,
    UserOn,
    Unset,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AvState {
    On,
    Off,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SigState {
    Fresh,
    Stale,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AvItem {
    pub state: AvState,
    pub signature: SigState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AvFact<'a> {
    ReadFailed,
    NoneRegistered,
    Listed(&'a [AvItem]),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FwProfiles {
    pub domain: Option<bool>,
    pub private_net: Option<bool>,
    pub public_net: Option<bool>,
}

pub const UPDATE_OK_DAYS: i64 = 30;
pub const UPDATE_WATCH_DAYS: i64 = 60;
pub const SUPPORT_SOON_MONTHS: i32 = 6;

struct SupportRow {
    family: OsFamily,
    display: &'static str,
    home_end: Option<CivilDate>,
    enterprise_end: Option<CivilDate>,
}

const fn date(year: i32, month: u32, day: u32) -> CivilDate {
    CivilDate { year, month, day }
}

/// 지원 종료일. 비어 있는 칸은 확인 불가이다.
const SUPPORT_ENDS: &[SupportRow] = &[
    SupportRow {
        family: OsFamily::Windows10,
        display: "22H2",
        home_end: Some(date(2025, 10, 14)),
        enterprise_end: Some(date(2025, 10, 14)),
    },
    SupportRow {
        family: OsFamily::Windows11,
        display: "22H2",
        home_end: Some(date(2024, 10, 8)),
        enterprise_end: Some(date(2025, 10, 14)),
    },
    SupportRow {
        family: OsFamily::Windows11,
        display: "23H2",
        home_end: Some(date(2025, 11, 11)),
        enterprise_end: Some(date(2026, 11, 10)),
    },
    SupportRow {
        family: OsFamily::Windows11,
        display: "24H2",
        home_end: Some(date(2026, 10, 13)),
        enterprise_end: Some(date(2027, 10, 12)),
    },
    SupportRow {
        family: OsFamily::Windows11,
        display: "25H2",
        home_end: None,
        enterprise_end: None,
    },
];

pub fn family_from_build(build: u32) -> OsFamily {
    if build >= 22_000 {
        OsFamily::Windows11
    } else {
        OsFamily::Windows10
    }
}

pub fn edition_group(edition_id: &str) -> EditionGroup {
    let id = edition_id.trim();
    if id.is_empty() {
        return EditionGroup::Unlisted;
    }
    let lower = id.to_ascii_lowercase();
    if lower.contains("iot") || lower == "enterprises" || lower == "enterprisesn" {
        return EditionGroup::Unlisted;
    }
    const HOME_PRO: &[&str] = &[
        "core",
        "coren",
        "coresinglelanguage",
        "corecountryspecific",
        "professional",
        "professionaln",
        "professionaleducation",
        "professionaleducationn",
        "professionalworkstation",
        "professionalworkstationn",
        "cloudedition",
        "cloudeditionn",
    ];
    const ENTERPRISE: &[&str] = &[
        "enterprise",
        "enterprisen",
        "enterpriseg",
        "enterprisegn",
        "education",
        "educationn",
        "serverrdsh",
    ];
    if HOME_PRO.iter().any(|item| *item == lower) {
        EditionGroup::HomePro
    } else if ENTERPRISE.iter().any(|item| *item == lower) {
        EditionGroup::EnterpriseEducation
    } else {
        EditionGroup::Unlisted
    }
}

pub fn support_end(family: OsFamily, display: &str, group: EditionGroup) -> Option<CivilDate> {
    if group == EditionGroup::Unlisted {
        return None;
    }
    let display = display.trim();
    let row = SUPPORT_ENDS.iter().find(|row| row.family == family && row.display.eq_ignore_ascii_case(display))?;
    match group {
        EditionGroup::HomePro => row.home_end,
        EditionGroup::EnterpriseEducation => row.enterprise_end,
        EditionGroup::Unlisted => None,
    }
}

pub fn judge_support(family: OsFamily, display: &str, group: EditionGroup, today: CivilDate) -> (Mark, String) {
    let Some(end) = support_end(family, display, group) else {
        return (Mark::Unknown, "이 Windows 버전의 지원 종료일을 확인하지 못했습니다.".into());
    };
    let end_text = format!("{:04}-{:02}-{:02}", end.year, end.month, end.day);
    if today > end {
        if family == OsFamily::Windows10 {
            return (
                Mark::Watch,
                "Windows 10은 지원이 끝났습니다. 확장 보안 업데이트에 가입하지 않았다면 Windows 11로 업그레이드가 필요합니다.".into(),
            );
        }
        return (Mark::Bad, "이 Windows 버전은 보안 업데이트가 끝났습니다. 최신 버전으로 업데이트하세요.".into());
    }
    let soon = minus_months(end, SUPPORT_SOON_MONTHS);
    if today >= soon {
        return (
            Mark::Watch,
            format!("이 Windows 버전은 {end_text}에 보안 업데이트가 끝납니다. 최신 버전으로 업데이트하세요."),
        );
    }
    (Mark::Ok, "이 Windows 버전은 보안 업데이트를 받는 중입니다.".into())
}

pub fn choose_update(registry: Option<CivilDate>, agent: Option<CivilDate>) -> Option<(CivilDate, UpdateOrigin)> {
    if let Some(day) = registry {
        return Some((day, UpdateOrigin::Registry));
    }
    agent.map(|day| (day, UpdateOrigin::Agent))
}

pub fn judge_update(age_days: i64) -> (Mark, String) {
    if age_days < 0 {
        return (Mark::Unknown, "업데이트 설치일을 확인하지 못했습니다.".into());
    }
    if age_days <= UPDATE_OK_DAYS {
        return (Mark::Ok, "마지막으로 확인된 업데이트 설치일이 30일 이내입니다.".into());
    }
    if age_days <= UPDATE_WATCH_DAYS {
        return (Mark::Watch, "마지막으로 확인된 업데이트 설치일이 30일을 넘었습니다.".into());
    }
    (Mark::Bad, "마지막으로 확인된 업데이트 설치일이 60일을 넘었습니다.".into())
}

pub fn judge_lock(fact: LockFact) -> (Mark, &'static str) {
    match fact {
        LockFact::ReadFailed => (Mark::Unknown, "화면 잠금 설정을 읽지 못했습니다."),
        LockFact::PolicyOn | LockFact::UserOn => (Mark::Ok, "화면 보호기 잠금이 켜져 있습니다."),
        LockFact::PolicyOff => (Mark::Bad, "관리 정책으로 화면 보호기 잠금이 꺼져 있습니다."),
        LockFact::Unset => (
            Mark::Watch,
            "화면 보호기 잠금이 설정되어 있지 않습니다. 다른 방법으로 잠금을 쓰고 있다면 괜찮습니다. 자리를 비울 때는 Windows 키 + L로 잠그세요.",
        ),
    }
}

pub fn judge_antivirus(fact: AvFact<'_>) -> (Mark, &'static str) {
    match fact {
        AvFact::ReadFailed => (Mark::Unknown, "등록된 백신 상태를 읽지 못했습니다."),
        AvFact::NoneRegistered => (Mark::Bad, "등록된 백신이 없습니다."),
        AvFact::Listed(items) => {
            if items.is_empty() {
                return (Mark::Bad, "등록된 백신이 없습니다.");
            }
            let on: Vec<_> = items.iter().filter(|item| item.state == AvState::On).collect();
            if !on.is_empty() {
                if on.iter().any(|item| item.signature == SigState::Stale || item.signature == SigState::Unknown) {
                    return (Mark::Watch, "실시간 보호는 켜져 있습니다. 정의 업데이트 상태를 확인해 주세요.");
                }
                return (Mark::Ok, "실시간 보호가 켜져 있습니다.");
            }
            if items.iter().any(|item| item.state == AvState::Off) && items.iter().all(|item| item.state == AvState::Off) {
                return (Mark::Bad, "실시간 보호가 꺼져 있습니다.");
            }
            (Mark::Watch, "백신 상태를 확인하지 못했습니다.")
        }
    }
}

pub fn judge_firewall(profiles: FwProfiles, third_party_on: bool) -> (Mark, &'static str) {
    let values = [profiles.domain, profiles.private_net, profiles.public_net];
    if third_party_on {
        return (Mark::Ok, "다른 방화벽이 등록되어 있습니다. Windows 방화벽이 꺼져 있어도 그것만으로 문제로 보지 않습니다.");
    }
    if values.iter().any(|item| item.is_none()) {
        return (Mark::Unknown, "방화벽 상태를 읽지 못했습니다.");
    }
    let on = values.iter().filter(|item| **item == Some(true)).count();
    if on == 3 {
        return (Mark::Ok, "도메인, 개인, 공용 프로필의 방화벽이 켜져 있습니다.");
    }
    if on == 0 {
        return (Mark::Bad, "도메인, 개인, 공용 프로필의 방화벽이 모두 꺼져 있습니다.");
    }
    (Mark::Watch, "일부 네트워크 프로필의 방화벽이 꺼져 있습니다.")
}

pub fn judge_shares(count: Option<usize>) -> (Mark, String) {
    match count {
        None => (Mark::Unknown, "공유 폴더 목록을 읽지 못했습니다.".into()),
        Some(0) => (Mark::Ok, "이 PC가 공유 중인 폴더가 없습니다.".into()),
        Some(_) => (
            Mark::Watch,
            "이 PC가 공유 중인 폴더가 있습니다. 필요한 공유인지 확인하세요.".into(),
        ),
    }
}

pub fn age_days(install: CivilDate, today: CivilDate) -> Option<i64> {
    let left = civil_to_days(install)?;
    let right = civil_to_days(today)?;
    Some(right - left)
}

pub fn parse_stamp(text: &str) -> Option<CivilDate> {
    let text = text.trim();
    let head = text.get(..10).unwrap_or(text);
    let mut parts = head.split('-');
    let year = parts.next()?.parse().ok()?;
    let month = parts.next()?.parse().ok()?;
    let day = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    Some(CivilDate { year, month, day })
}

pub fn ole_to_civil(value: f64) -> Option<CivilDate> {
    if !value.is_finite() {
        return None;
    }
    let serial = value.floor() as i64;
    // 1899-12-30 이 0이고, 1970-01-01 은 25569 이다.
    let unix = serial - 25569;
    civil_from_unix(unix)
}

pub fn origin_label(origin: UpdateOrigin) -> &'static str {
    match origin {
        UpdateOrigin::Registry => "레지스트리의 마지막 설치 성공 시각",
        UpdateOrigin::Agent => "Windows 업데이트 설치 기록",
    }
}

pub fn mark_status(mark: Mark) -> (&'static str, &'static str) {
    match mark {
        Mark::Ok => ("success", "정상"),
        Mark::Watch => ("warning", "확인 필요"),
        Mark::Bad => ("error", "문제 발견"),
        Mark::Unknown => ("unconfirmed", "확인 불가"),
    }
}

pub fn copy_text(rows: &[(&str, &str, &str)]) -> String {
    let mut lines = vec!["보안 상태 점검".to_string()];
    for (title, label, finding) in rows {
        lines.push(format!("{title}: {label}"));
        lines.push(safe_copy_line(finding));
    }
    lines.join("\n")
}

fn safe_copy_line(text: &str) -> String {
    if text.contains('\\') || text.contains('$') {
        return "확인된 내용에서 경로와 공유 이름은 빼 두었습니다.".into();
    }
    text.to_string()
}

fn minus_months(date: CivilDate, months: i32) -> CivilDate {
    let mut year = date.year;
    let mut month = date.month as i32 - months;
    while month <= 0 {
        month += 12;
        year -= 1;
    }
    let month = month as u32;
    let day = date.day.min(days_in_month(year, month));
    CivilDate { year, month, day }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

fn civil_to_days(date: CivilDate) -> Option<i64> {
    if !(1..=12).contains(&date.month) || date.day == 0 || date.day > days_in_month(date.year, date.month) {
        return None;
    }
    let y = if date.month <= 2 { date.year - 1 } else { date.year } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let month = if date.month > 2 { date.month - 3 } else { date.month + 9 } as u64;
    let doy = (153 * month + 2) / 5 + date.day as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe as i64 - 719468)
}

fn civil_from_unix(unix_days: i64) -> Option<CivilDate> {
    let z = unix_days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    if year < -9999 || year > 9999 {
        return None;
    }
    Some(CivilDate {
        year: year as i32,
        month: month as u32,
        day: day as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, d: u32) -> CivilDate {
        CivilDate { year, month, day: d }
    }

    #[test]
    fn support_24h2_home_around_end() {
        let today = day(2026, 10, 3);
        let (mark, text) = judge_support(OsFamily::Windows11, "24H2", EditionGroup::HomePro, today);
        assert_eq!(mark, Mark::Watch);
        assert!(text.contains("2026-10-13"));
        let (ended, ended_text) = judge_support(OsFamily::Windows11, "24H2", EditionGroup::HomePro, day(2026, 10, 14));
        assert_eq!(ended, Mark::Bad);
        assert!(ended_text.contains("보안 업데이트가 끝났습니다"));
    }

    #[test]
    fn support_25h2_blank_is_unknown() {
        let (mark, _) = judge_support(OsFamily::Windows11, "25H2", EditionGroup::HomePro, day(2026, 10, 3));
        assert_eq!(mark, Mark::Unknown);
        let (enterprise, _) = judge_support(OsFamily::Windows11, "25H2", EditionGroup::EnterpriseEducation, day(2026, 10, 3));
        assert_eq!(enterprise, Mark::Unknown);
    }

    #[test]
    fn windows10_after_end_is_watch_not_bad() {
        let (mark, text) = judge_support(OsFamily::Windows10, "22H2", EditionGroup::HomePro, day(2026, 10, 3));
        assert_eq!(mark, Mark::Watch);
        assert!(text.contains("확장 보안 업데이트"));
        let (enterprise, _) = judge_support(OsFamily::Windows10, "22H2", EditionGroup::EnterpriseEducation, day(2026, 10, 3));
        assert_eq!(enterprise, Mark::Watch);
    }

    #[test]
    fn support_six_month_boundary() {
        let (before, _) = judge_support(OsFamily::Windows11, "24H2", EditionGroup::HomePro, day(2026, 4, 12));
        assert_eq!(before, Mark::Ok);
        let (on_edge, _) = judge_support(OsFamily::Windows11, "24H2", EditionGroup::HomePro, day(2026, 4, 13));
        assert_eq!(on_edge, Mark::Watch);
        let (last, _) = judge_support(OsFamily::Windows11, "24H2", EditionGroup::HomePro, day(2026, 10, 13));
        assert_eq!(last, Mark::Watch);
    }

    #[test]
    fn iot_and_unknown_display_are_unknown() {
        assert_eq!(edition_group("IoTEnterprise"), EditionGroup::Unlisted);
        assert_eq!(edition_group("EnterpriseS"), EditionGroup::Unlisted);
        assert_eq!(edition_group("Professional"), EditionGroup::HomePro);
        assert_eq!(edition_group("CloudEdition"), EditionGroup::HomePro);
        assert_eq!(edition_group("Education"), EditionGroup::EnterpriseEducation);
        assert_eq!(edition_group("ServerRdsh"), EditionGroup::EnterpriseEducation);
        let (mark, _) = judge_support(OsFamily::Windows11, "21H2", EditionGroup::HomePro, day(2026, 10, 3));
        assert_eq!(mark, Mark::Unknown);
    }

    #[test]
    fn update_day_boundaries() {
        for age in [0, 29, 30] {
            assert_eq!(judge_update(age).0, Mark::Ok, "{age}");
        }
        for age in [31, 59, 60] {
            assert_eq!(judge_update(age).0, Mark::Watch, "{age}");
        }
        for age in [61, 120] {
            assert_eq!(judge_update(age).0, Mark::Bad, "{age}");
        }
    }

    #[test]
    fn update_source_prefers_registry_then_agent() {
        let reg = day(2026, 9, 1);
        let agent = day(2026, 9, 20);
        assert_eq!(choose_update(Some(reg), Some(agent)), Some((reg, UpdateOrigin::Registry)));
        assert_eq!(choose_update(None, Some(agent)), Some((agent, UpdateOrigin::Agent)));
        assert_eq!(choose_update(None, None), None);
    }

    #[test]
    fn lock_facts() {
        assert_eq!(judge_lock(LockFact::PolicyOn).0, Mark::Ok);
        assert_eq!(judge_lock(LockFact::UserOn).0, Mark::Ok);
        assert_eq!(judge_lock(LockFact::PolicyOff).0, Mark::Bad);
        assert!(judge_lock(LockFact::PolicyOff).1.contains("관리 정책"));
        assert_eq!(judge_lock(LockFact::Unset).0, Mark::Watch);
        assert!(judge_lock(LockFact::Unset).1.contains("Windows 키 + L"));
        assert_eq!(judge_lock(LockFact::ReadFailed).0, Mark::Unknown);
    }

    #[test]
    fn antivirus_third_party_on_is_ok() {
        let items = [
            AvItem { state: AvState::Off, signature: SigState::Unknown },
            AvItem { state: AvState::On, signature: SigState::Fresh },
        ];
        assert_eq!(judge_antivirus(AvFact::Listed(&items)).0, Mark::Ok);
        assert_eq!(judge_antivirus(AvFact::NoneRegistered).0, Mark::Bad);
        assert_eq!(judge_antivirus(AvFact::ReadFailed).0, Mark::Unknown);
        let stale = [AvItem { state: AvState::On, signature: SigState::Stale }];
        assert_eq!(judge_antivirus(AvFact::Listed(&stale)).0, Mark::Watch);
        let off = [AvItem { state: AvState::Off, signature: SigState::Fresh }];
        assert_eq!(judge_antivirus(AvFact::Listed(&off)).0, Mark::Bad);
    }

    #[test]
    fn firewall_profiles_and_third_party() {
        let all_on = FwProfiles { domain: Some(true), private_net: Some(true), public_net: Some(true) };
        let some_off = FwProfiles { domain: Some(true), private_net: Some(false), public_net: Some(true) };
        let all_off = FwProfiles { domain: Some(false), private_net: Some(false), public_net: Some(false) };
        let missing = FwProfiles { domain: Some(true), private_net: None, public_net: Some(true) };
        assert_eq!(judge_firewall(all_on, false).0, Mark::Ok);
        assert_eq!(judge_firewall(some_off, false).0, Mark::Watch);
        assert_eq!(judge_firewall(all_off, false).0, Mark::Bad);
        assert_eq!(judge_firewall(all_off, true).0, Mark::Ok);
        assert_eq!(judge_firewall(missing, false).0, Mark::Unknown);
    }

    #[test]
    fn shares_are_not_called_a_problem() {
        assert_eq!(judge_shares(Some(0)).0, Mark::Ok);
        let (mark, text) = judge_shares(Some(2));
        assert_eq!(mark, Mark::Watch);
        assert!(text.contains("필요한 공유인지 확인하세요"));
        assert!(!text.contains('\\'));
        assert_eq!(judge_shares(None).0, Mark::Unknown);
    }

    #[test]
    fn copy_keeps_status_and_drops_paths() {
        let text = copy_text(&[
            ("공유 폴더", "확인 필요", "이 PC가 공유 중인 폴더가 있습니다. 필요한 공유인지 확인하세요."),
            ("업데이트", "정상", r"C:\Users\someone\Desktop"),
        ]);
        assert!(text.contains("공유 폴더: 확인 필요"));
        assert!(!text.contains("someone"));
        assert!(!text.contains('\\'));
        assert!(!text.contains('$'));
    }

    #[test]
    fn ole_and_stamp_dates() {
        assert_eq!(ole_to_civil(25569.0), Some(day(1970, 1, 1)));
        assert_eq!(parse_stamp("2026-10-03 09:00:00"), Some(day(2026, 10, 3)));
        assert_eq!(age_days(day(2026, 9, 3), day(2026, 10, 3)), Some(30));
    }

    #[test]
    fn one_unknown_does_not_change_another_mark() {
        assert_eq!(judge_update(-1).0, Mark::Unknown);
        assert_eq!(judge_shares(Some(0)).0, Mark::Ok);
    }
}
