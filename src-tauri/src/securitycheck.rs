use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use tauri::{AppHandle, Emitter};

use crate::org_policy;
use crate::security_judge::{
    age_days, choose_update, copy_text, judge_antivirus, judge_firewall, judge_lock, judge_shares, judge_support, judge_update,
    mark_status, origin_label, CivilDate, Mark,
};

static BUSY: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SecRow {
    id: String,
    title: String,
    status: String,
    label: String,
    finding: String,
    advice: String,
    help_id: String,
    page: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TechLine {
    label: String,
    value: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SecReport {
    rows: Vec<SecRow>,
    finding: String,
    advice: String,
    help_id: String,
    technical: Vec<TechLine>,
    copy_text: String,
    pages: Vec<String>,
    stopped: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SecNote {
    kind: String,
    id: String,
    status: String,
    label: String,
    report: Option<SecReport>,
}

fn emit_step(app: &AppHandle, id: &str, status: &str, label: &str) {
    let _ = app.emit(
        "pc-security-step",
        SecNote {
            kind: "step".into(),
            id: id.into(),
            status: status.into(),
            label: label.into(),
            report: None,
        },
    );
}

fn emit_done(app: &AppHandle, report: SecReport) {
    let _ = app.emit(
        "pc-security-step",
        SecNote {
            kind: "done".into(),
            id: "done".into(),
            status: "done".into(),
            label: String::new(),
            report: Some(report),
        },
    );
}

#[tauri::command]
pub fn halt_pc_security() {
    STOP.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn open_security_setting(page: String) -> Result<(), String> {
    let uri = match page.as_str() {
        "update" => "ms-settings:windowsupdate",
        "defender" => "windowsdefender:",
        "firewall" => "ms-settings:windowsdefender-firewall",
        "lock" => "ms-settings:lockscreen",
        _ => return Err("열 수 없는 화면입니다.".into()),
    };
    let explorer = std::path::PathBuf::from(r"C:\Windows\explorer.exe");
    if !explorer.is_file() {
        return Err("설정 화면을 열 수 없습니다.".into());
    }
    std::process::Command::new(explorer)
        .arg(uri)
        .spawn()
        .map_err(|_| "설정 화면을 열 수 없습니다.".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn begin_pc_security(app: AppHandle) -> Result<(), String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("이미 점검 중입니다.".into());
    }
    STOP.store(false, Ordering::SeqCst);
    thread::spawn(move || {
        let report = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_check(&app))).unwrap_or_else(|_| fault_report());
        emit_done(&app, report);
        BUSY.store(false, Ordering::SeqCst);
    });
    Ok(())
}

fn fault_report() -> SecReport {
    let rows = vec![row(
        "support",
        "Windows 지원",
        Mark::Unknown,
        "점검을 마치지 못했습니다.",
        "다시 점검해 주세요.",
        "security-general",
        "",
    )];
    finish(rows, Vec::new(), false)
}

fn run_check(app: &AppHandle) -> SecReport {
    let today = local_today();
    let mut rows = Vec::new();
    let mut technical = Vec::new();

    emit_step(app, "support", "checking", "점검 중");
    if halted() {
        return stopped_report(rows);
    }
    let support = read_support(today);
    technical.extend(support.technical);
    rows.push(support.row);

    emit_step(app, "update", "checking", "점검 중");
    if halted() {
        return stopped_report(rows);
    }
    let update = read_update(today);
    technical.extend(update.technical);
    rows.push(update.row);

    emit_step(app, "antivirus", "checking", "점검 중");
    if halted() {
        return stopped_report(rows);
    }
    let products = crate::security_read::read_products();
    let (av_mark, av_text) = judge_antivirus(products.fact.as_fact());
    technical.push(line("백신", join_names(&products.names)));
    rows.push(row(
        "antivirus",
        "백신",
        av_mark,
        av_text,
        "Windows 보안에서 바이러스 및 위협 방지를 확인하세요. 이 앱은 설정을 바꾸지 않습니다.",
        "security-antivirus",
        "defender",
    ));

    emit_step(app, "firewall", "checking", "점검 중");
    if halted() {
        return stopped_report(rows);
    }
    let profiles = crate::security_read::read_firewall();
    let (fw_mark, fw_text) = judge_firewall(profiles, products.third_party_firewall);
    technical.push(line("방화벽 도메인", on_off(profiles.domain)));
    technical.push(line("방화벽 개인", on_off(profiles.private_net)));
    technical.push(line("방화벽 공용", on_off(profiles.public_net)));
    if !products.firewall_names.is_empty() {
        technical.push(line("방화벽 제품", join_names(&products.firewall_names)));
    }
    rows.push(row(
        "firewall",
        "방화벽",
        fw_mark,
        fw_text,
        "Windows 보안의 방화벽 화면에서 프로필을 확인하세요. 이 앱은 설정을 바꾸지 않습니다.",
        "security-firewall",
        "firewall",
    ));

    emit_step(app, "lock", "checking", "점검 중");
    if halted() {
        return stopped_report(rows);
    }
    let (lock_mark, lock_text) = judge_lock(crate::security_read::read_lock());
    rows.push(row(
        "lock",
        "화면 잠금",
        lock_mark,
        lock_text,
        "설정에서 잠금 화면을 확인하세요. 자리를 비울 때는 Windows 키와 L을 누르세요.",
        "security-screen-lock",
        "lock",
    ));

    emit_step(app, "shares", "checking", "점검 중");
    if halted() {
        return stopped_report(rows);
    }
    let shares = crate::security_read::read_share_names();
    let count = shares.as_ref().map(|names| names.len());
    let (share_mark, share_text) = judge_shares(count);
    technical.push(line(
        "공유 이름",
        shares.map(|names| join_names(&names)).unwrap_or_else(|| "확인 불가".into()),
    ));
    rows.push(row(
        "shares",
        "공유 폴더",
        share_mark,
        &share_text,
        "필요하지 않은 공유는 폴더 속성에서 해제할 수 있습니다. 이 앱은 공유를 바꾸지 않습니다.",
        "security-shared-folder",
        "",
    ));

    if let Some(policy) = policy_line() {
        technical.push(line("정책", policy));
    }
    finish(rows, technical, false)
}

struct Piece {
    row: SecRow,
    technical: Vec<TechLine>,
}

fn read_support(today: CivilDate) -> Piece {
    let os = crate::security_read::read_os();
    let mut technical = vec![
        line("제품", fallback(&os.product)),
        line("버전", fallback(&os.display)),
        line("빌드", fallback(&os.build_text)),
        line("에디션", fallback(&os.edition_id)),
    ];
    let (mark, text) = match os.family {
        Some(family) => judge_support(family, &os.display, os.group, today),
        None => (Mark::Unknown, "Windows 버전을 읽지 못했습니다.".into()),
    };
    let _ = &mut technical;
    Piece {
        row: row(
            "support",
            "Windows 지원",
            mark,
            &text,
            "설정에서 Windows 업데이트를 열어 최신 버전을 확인하세요. 이 앱은 업데이트를 설치하지 않습니다.",
            "security-windows-support",
            "update",
        ),
        technical,
    }
}

fn read_update(today: CivilDate) -> Piece {
    let registry = crate::security_read::read_registry_install();
    let agent = if registry.is_some() {
        None
    } else {
        crate::security_read::read_agent_install()
    };
    let chosen = choose_update(registry, agent);
    let (mark, text, source) = match chosen {
        Some((day, origin)) => {
            let age = age_days(day, today);
            let (mark, base) = match age {
                Some(days) => judge_update(days),
                None => (Mark::Unknown, "업데이트 설치일을 확인하지 못했습니다.".into()),
            };
            let stamped = format!(
                "{base} 마지막으로 확인된 업데이트 설치일: {:04}-{:02}-{:02}.",
                day.year, day.month, day.day
            );
            (mark, stamped, origin_label(origin).to_string())
        }
        None => (Mark::Unknown, "업데이트 설치일을 확인하지 못했습니다.".into(), "확인하지 못함".into()),
    };
    Piece {
        row: row(
            "update",
            "업데이트",
            mark,
            &text,
            "설정에서 Windows 업데이트를 열어 설치 기록을 확인하세요. 이 앱은 업데이트를 설치하지 않습니다.",
            "security-update",
            "update",
        ),
        technical: vec![line("업데이트 날짜 출처", source)],
    }
}

fn stopped_report(mut rows: Vec<SecRow>) -> SecReport {
    for id in ["support", "update", "antivirus", "firewall", "lock", "shares"] {
        if rows.iter().any(|row| row.id == id) {
            continue;
        }
        rows.push(row(id, title_of(id), Mark::Unknown, "점검을 멈췄습니다.", "", "security-general", ""));
    }
    finish(rows, Vec::new(), true)
}

fn finish(rows: Vec<SecRow>, technical: Vec<TechLine>, stopped: bool) -> SecReport {
    let copy_rows: Vec<(&str, &str, &str)> = rows.iter().map(|row| (row.title.as_str(), row.label.as_str(), row.finding.as_str())).collect();
    let copy_text = copy_text(&copy_rows);
    let finding = summary(&rows);
    SecReport {
        advice: String::new(),
        help_id: "security-general".into(),
        pages: rows.iter().map(|row| row.page.clone()).filter(|page| !page.is_empty()).collect(),
        rows,
        finding,
        technical,
        copy_text,
        stopped,
    }
}

fn summary(rows: &[SecRow]) -> String {
    if rows.iter().any(|row| row.status == "error") {
        return "확인이 필요한 항목이 있습니다. 문제 발견으로 표시된 항목을 먼저 보세요.".into();
    }
    if rows.iter().any(|row| row.status == "warning" || row.status == "unconfirmed") {
        return "일부 항목은 확인이 필요합니다.".into();
    }
    "확인한 기본 보안 상태는 정상입니다.".into()
}

fn policy_line() -> Option<String> {
    let flags = org_policy::current();
    let mut names = Vec::new();
    if flags.disable_admin_tools {
        names.push("관리자 도구");
    }
    if flags.disable_document_index {
        names.push("문서 색인");
    }
    if flags.disable_startup_update {
        names.push("시작 시 버전 확인");
    }
    if flags.disable_startup_knowledge {
        names.push("시작 시 업무자료 받기");
    }
    if names.is_empty() {
        None
    } else {
        Some(format!("관리자가 설정한 정책: {}", names.join(", ")))
    }
}

fn row(id: &str, title: &str, mark: Mark, finding: &str, advice: &str, help_id: &str, page: &str) -> SecRow {
    let (status, label) = mark_status(mark);
    SecRow {
        id: id.into(),
        title: title.into(),
        status: status.into(),
        label: label.into(),
        finding: finding.into(),
        advice: advice.into(),
        help_id: help_id.into(),
        page: page.into(),
    }
}

fn line(label: &str, value: String) -> TechLine {
    TechLine { label: label.into(), value }
}

fn fallback(text: &str) -> String {
    let text = text.trim();
    if text.is_empty() { "확인 불가".into() } else { text.chars().take(120).collect() }
}

fn join_names(names: &[String]) -> String {
    let kept: Vec<&str> = names.iter().map(|name| name.trim()).filter(|name| !name.is_empty()).take(8).collect();
    if kept.is_empty() { "없음".into() } else { kept.join(", ") }
}

fn on_off(value: Option<bool>) -> String {
    match value {
        Some(true) => "켜짐".into(),
        Some(false) => "꺼짐".into(),
        None => "확인 불가".into(),
    }
}

fn title_of(id: &str) -> &'static str {
    match id {
        "support" => "Windows 지원",
        "update" => "업데이트",
        "antivirus" => "백신",
        "firewall" => "방화벽",
        "lock" => "화면 잠금",
        _ => "공유 폴더",
    }
}

fn halted() -> bool {
    STOP.load(Ordering::SeqCst)
}

fn local_today() -> CivilDate {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let now = unsafe { GetLocalTime() };
    CivilDate {
        year: now.wYear as i32,
        month: now.wMonth as u32,
        day: now.wDay as u32,
    }
}
