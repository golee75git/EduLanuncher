use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static PRINT_BUSY: AtomicBool = AtomicBool::new(false);
static PRINT_STOP: AtomicBool = AtomicBool::new(false);
static ALLOWED_NAMES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static LAST_NAME: Mutex<String> = Mutex::new(String::new());

const DISPLAY_NAME: &str = "교육업무 런처";
const STEP_WAIT: Duration = Duration::from_secs(5);
const OVERALL: Duration = Duration::from_secs(20);

struct Budget {
    start: std::time::Instant,
}

impl Budget {
    fn new() -> Self {
        Self { start: std::time::Instant::now() }
    }

    fn left(&self) -> Duration {
        OVERALL.saturating_sub(self.start.elapsed())
    }

    fn slice(&self) -> Duration {
        self.left().min(STEP_WAIT)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ServiceMark {
    Running,
    Stopped,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ListMark {
    Some,
    None,
    TimedOut,
    Failed,
    Skipped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LinkKind {
    Usb,
    Network,
    Shared,
    Virtual,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DeviceMark {
    Offline,
    Paused,
    Fault,
    Quiet,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QueueMark {
    Empty,
    Waiting { count: u32, oldest_minutes: u32 },
    Aged { count: u32, oldest_minutes: u32 },
    Blocked { count: u32, errors: u32, oldest_minutes: u32 },
    Unknown,
}

#[derive(Clone, Debug)]
struct Chosen {
    name: String,
    is_default: bool,
    link: LinkKind,
    device: DeviceMark,
    queue: QueueMark,
    port_label: String,
    monitor_label: String,
    driver: String,
    status_bits: u32,
    work_offline: bool,
    shared_jobs: bool,
}

#[derive(Clone, Debug)]
struct PrintFacts {
    service: ServiceMark,
    list: ListMark,
    count: u32,
    chosen: Option<Chosen>,
    stopped: bool,
    timed_out: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PrintRow {
    id: String,
    title: String,
    status: String,
    label: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TechLine {
    label: String,
    value: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PrintChoice {
    name: String,
    virtual_device: bool,
    is_default: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PrintReport {
    rows: Vec<PrintRow>,
    printer_name: String,
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
struct PrintNote {
    kind: String,
    id: String,
    status: String,
    label: String,
    report: Option<PrintReport>,
    choices: Vec<PrintChoice>,
}

fn stopped() -> bool {
    PRINT_STOP.load(Ordering::SeqCst)
}

fn emit_note(app: &AppHandle, note: PrintNote) {
    let _ = app.emit("pc-print-step", note);
}

fn emit_step(app: &AppHandle, id: &str, status: &str, label: &str) {
    emit_note(
        app,
        PrintNote {
            kind: "step".into(),
            id: id.into(),
            status: status.into(),
            label: label.into(),
            report: None,
            choices: Vec::new(),
        },
    );
}

fn emit_done(app: &AppHandle, report: PrintReport) {
    emit_note(
        app,
        PrintNote {
            kind: "done".into(),
            id: "done".into(),
            status: "done".into(),
            label: String::new(),
            report: Some(report),
            choices: Vec::new(),
        },
    );
}

#[tauri::command]
pub fn halt_pc_print() {
    PRINT_STOP.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn begin_pc_print(app: AppHandle) -> Result<(), String> {
    if PRINT_BUSY.swap(true, Ordering::SeqCst) {
        return Err("이미 점검 중입니다.".into());
    }
    PRINT_STOP.store(false, Ordering::SeqCst);
    if let Ok(mut names) = ALLOWED_NAMES.lock() {
        names.clear();
    }
    thread::spawn(move || {
        let report = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_list(&app)));
        match report {
            Ok(ListOutcome::Done(report)) => emit_done(&app, report),
            Ok(ListOutcome::Choose(choices)) => emit_note(
                &app,
                PrintNote {
                    kind: "choose".into(),
                    id: "choose".into(),
                    status: "waiting".into(),
                    label: String::new(),
                    report: None,
                    choices,
                },
            ),
            Err(_) => emit_done(&app, fault_report()),
        }
        PRINT_BUSY.store(false, Ordering::SeqCst);
    });
    Ok(())
}

#[tauri::command]
pub fn carry_pc_print(app: AppHandle, name: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 220 || name.contains('\u{0}') {
        return Err("목록에 있는 프린터만 점검합니다.".into());
    }
    let allowed = ALLOWED_NAMES.lock().map_err(|_| "점검을 시작하지 못했습니다.".to_string())?;
    if !allowed.iter().any(|item| item == &name) {
        return Err("목록에 있는 프린터만 점검합니다.".into());
    }
    drop(allowed);
    if PRINT_BUSY.swap(true, Ordering::SeqCst) {
        return Err("이미 점검 중입니다.".into());
    }
    PRINT_STOP.store(false, Ordering::SeqCst);
    thread::spawn(move || {
        let report = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_detail(&app, &name)))
            .unwrap_or_else(|_| fault_report());
        if let Ok(mut last) = LAST_NAME.lock() {
            *last = report.printer_name.clone();
        }
        emit_done(&app, report);
        PRINT_BUSY.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// 특정 프린터 대기열을 여는 설정 주소가 없다.
/// 그래서 rundll32에 인자를 배열로 넘긴다. 이름은 목록에서 고른 값만 쓴다.
#[tauri::command]
pub fn open_print_view(kind: String, name: String) -> Result<(), String> {
    let kind = kind.as_str();
    if kind == "printers" {
        return open_settings();
    }
    if kind != "queue" {
        return Err("열 수 없는 화면입니다.".into());
    }
    let name = name.trim().to_string();
    let allowed = ALLOWED_NAMES.lock().map_err(|_| "대기열을 열 수 없습니다.".to_string())?;
    let last = LAST_NAME.lock().map_err(|_| "대기열을 열 수 없습니다.".to_string())?;
    if name.is_empty() || (!allowed.iter().any(|item| item == &name) && *last != name) {
        return Err("목록에 있는 프린터만 엽니다.".into());
    }
    drop(allowed);
    drop(last);
    let program = std::path::PathBuf::from(r"C:\Windows\System32\rundll32.exe");
    if !program.is_file() {
        return Err("대기열을 열 수 없습니다.".into());
    }
    std::process::Command::new(program)
        .args(["printui.dll,PrintUIEntry", "/o", "/n", &name])
        .spawn()
        .map_err(|_| "대기열을 열 수 없습니다.".to_string())?;
    Ok(())
}

fn open_settings() -> Result<(), String> {
    let explorer = std::path::PathBuf::from(r"C:\Windows\explorer.exe");
    if !explorer.is_file() {
        return Err("설정 화면을 열 수 없습니다.".into());
    }
    std::process::Command::new(explorer)
        .arg("ms-settings:printers")
        .spawn()
        .map_err(|_| "설정 화면을 열 수 없습니다.".to_string())?;
    Ok(())
}

enum ListOutcome {
    Done(PrintReport),
    Choose(Vec<PrintChoice>),
}

fn fault_report() -> PrintReport {
    let mut facts = empty_facts();
    facts.service = ServiceMark::Unknown;
    facts.list = ListMark::Failed;
    diagnose(&facts)
}

fn empty_facts() -> PrintFacts {
    PrintFacts {
        service: ServiceMark::Unknown,
        list: ListMark::Failed,
        count: 0,
        chosen: None,
        stopped: false,
        timed_out: false,
    }
}

fn run_list(app: &AppHandle) -> ListOutcome {
    let budget = Budget::new();
    let mut facts = empty_facts();
    emit_step(app, "service", "checking", "점검 중");
    if stopped() {
        facts.stopped = true;
        return ListOutcome::Done(diagnose(&facts));
    }
    facts.service = match read_service(budget.slice()) {
        Ok(ServiceMark::Running) => ServiceMark::Running,
        Ok(other) => other,
        Err(_) => {
            facts.timed_out = true;
            ServiceMark::Unknown
        }
    };
    let early = diagnose(&facts);
    if let Some(row) = early.rows.iter().find(|row| row.id == "service") {
        emit_step(app, "service", &row.status, &row.label);
    }
    if facts.service == ServiceMark::Stopped {
        facts.list = ListMark::Skipped;
        return ListOutcome::Done(diagnose(&facts));
    }
    emit_step(app, "installed", "checking", "점검 중");
    if stopped() || budget.left().is_zero() {
        facts.stopped = stopped();
        facts.timed_out = budget.left().is_zero();
        return ListOutcome::Done(diagnose(&facts));
    }
    match read_printers(budget.slice()) {
        Ok(list) => {
            facts.count = list.len() as u32;
            facts.list = if list.is_empty() { ListMark::None } else { ListMark::Some };
            if let Some(row) = diagnose(&facts).rows.iter().find(|row| row.id == "installed") {
                emit_step(app, "installed", &row.status, &row.label);
            }
            if list.is_empty() {
                return ListOutcome::Done(diagnose(&facts));
            }
            if let Ok(mut allowed) = ALLOWED_NAMES.lock() {
                *allowed = list.iter().map(|item| item.name.clone()).collect();
            }
            return ListOutcome::Choose(list);
        }
        Err(true) => {
            facts.list = ListMark::TimedOut;
            facts.timed_out = true;
        }
        Err(false) => facts.list = ListMark::Failed,
    }
    if let Some(row) = diagnose(&facts).rows.iter().find(|row| row.id == "installed") {
        emit_step(app, "installed", &row.status, &row.label);
    }
    ListOutcome::Done(diagnose(&facts))
}

fn run_detail(app: &AppHandle, name: &str) -> PrintReport {
    let budget = Budget::new();
    let mut facts = empty_facts();
    facts.service = ServiceMark::Running;
    facts.list = ListMark::Some;
    facts.count = 1;
    emit_step(app, "state", "checking", "점검 중");
    if stopped() || budget.left().is_zero() {
        facts.stopped = stopped();
        facts.timed_out = budget.left().is_zero();
        return diagnose(&facts);
    }
    let detail = read_detail(name, &budget);
    facts.chosen = detail.chosen;
    facts.timed_out = detail.timed_out;
    if stopped() {
        facts.stopped = true;
    }
    let report = diagnose(&facts);
    for id in ["state", "queue", "link"] {
        if let Some(row) = report.rows.iter().find(|row| row.id == id) {
            emit_step(app, id, &row.status, &row.label);
        }
    }
    report
}

struct DetailRead {
    chosen: Option<Chosen>,
    timed_out: bool,
}

fn row(id: &str, title: &str, status: &str, label: &str) -> PrintRow {
    PrintRow {
        id: id.into(),
        title: title.into(),
        status: status.into(),
        label: label.into(),
    }
}

fn diagnose(facts: &PrintFacts) -> PrintReport {
    let service = match facts.service {
        ServiceMark::Running => row("service", "인쇄 서비스", "success", "정상"),
        ServiceMark::Stopped => row("service", "인쇄 서비스", "error", "중지됨"),
        ServiceMark::Unknown => row("service", "인쇄 서비스", "unconfirmed", "확인 필요"),
    };
    let installed = if facts.service == ServiceMark::Stopped || facts.list == ListMark::Skipped {
        row("installed", "프린터 설치", "skipped", "확인 불가")
    } else if facts.list == ListMark::None {
        row("installed", "프린터 설치", "error", "프린터 없음")
    } else if facts.list == ListMark::Some {
        row("installed", "프린터 설치", "success", "정상")
    } else if facts.list == ListMark::TimedOut {
        row("installed", "프린터 설치", "unconfirmed", "확인 필요")
    } else {
        row("installed", "프린터 설치", "unconfirmed", "확인 필요")
    };
    let chosen = facts.chosen.as_ref();
    let blocked = installed.status != "success";
    let state = if blocked {
        row("state", "프린터 상태", "skipped", "확인 불가")
    } else if let Some(item) = chosen {
        match item.device {
            DeviceMark::Offline => row("state", "프린터 상태", "error", "오프라인"),
            DeviceMark::Paused => row("state", "프린터 상태", "warning", "일시 중지됨"),
            DeviceMark::Fault => row("state", "프린터 상태", "error", "문제 발견"),
            DeviceMark::Quiet => row("state", "프린터 상태", "unconfirmed", "Windows에서 문제 확인되지 않음"),
            DeviceMark::Unknown => row("state", "프린터 상태", "unconfirmed", "확인 필요"),
        }
    } else {
        row("state", "프린터 상태", "unconfirmed", "확인 필요")
    };
    let queue = if blocked {
        row("queue", "인쇄 대기열", "skipped", "확인 불가")
    } else if let Some(item) = chosen {
        match item.queue {
            QueueMark::Empty => row("queue", "인쇄 대기열", "success", "정상"),
            QueueMark::Waiting { count, .. } => row("queue", "인쇄 대기열", "warning", &format!("문서 {count}개 대기 중")),
            QueueMark::Aged { count, .. } => row("queue", "인쇄 대기열", "warning", &format!("문서 {count}개 오래 대기 중")),
            QueueMark::Blocked { .. } => row("queue", "인쇄 대기열", "error", "처리되지 않은 문서 있음"),
            QueueMark::Unknown => row("queue", "인쇄 대기열", "unconfirmed", "확인 필요"),
        }
    } else {
        row("queue", "인쇄 대기열", "unconfirmed", "확인 필요")
    };
    let link = if blocked {
        row("link", "프린터 연결", "skipped", "확인 불가")
    } else if let Some(item) = chosen {
        match item.link {
            LinkKind::Usb => row("link", "프린터 연결", "success", "USB 연결"),
            LinkKind::Network => row("link", "프린터 연결", "unconfirmed", "직접 연결 확인 안 함"),
            LinkKind::Shared => row("link", "프린터 연결", "warning", "공유 프린터"),
            LinkKind::Virtual => row("link", "프린터 연결", "success", "가상 프린터"),
            LinkKind::Unknown => row("link", "프린터 연결", "unconfirmed", "확인되지 않음"),
        }
    } else {
        row("link", "프린터 연결", "unconfirmed", "확인되지 않음")
    };
    let rows = vec![service, installed, state, queue, link];
    let (help, finding, advice, pages) = verdict(facts, &rows);
    let mut finding = finding;
    if facts.timed_out {
        finding = format!("확인 시간이 지나 일부만 확인했습니다.\n{finding}");
    }
    if facts.stopped {
        finding = format!("점검을 멈췄습니다.\n{finding}");
    }
    let printer_name = chosen.map(|item| item.name.clone()).unwrap_or_default();
    let technical = technical_lines(facts, chosen);
    let copy_text = copy_text(&rows, &finding);
    PrintReport {
        rows,
        printer_name,
        finding,
        advice,
        help_id: help,
        technical,
        copy_text,
        pages,
        stopped: facts.stopped,
    }
}

fn verdict(facts: &PrintFacts, rows: &[PrintRow]) -> (String, String, String, Vec<String>) {
    let status = |id: &str| rows.iter().find(|row| row.id == id).map(|row| row.status.as_str()).unwrap_or("skipped");
    let chosen = facts.chosen.as_ref();
    if facts.service == ServiceMark::Stopped {
        return (
            "printer-spooler".into(),
            "Windows의 인쇄 서비스가 실행되고 있지 않아 프린터 정보를 확인할 수 없습니다.".into(),
            "PC를 다시 시작하거나 전산담당자에게 인쇄 서비스 상태 확인을 요청해 주세요.".into(),
            Vec::new(),
        );
    }
    if facts.list == ListMark::None {
        return (
            "printer-not-installed".into(),
            "현재 PC에서 사용할 프린터를 확인하지 못했습니다.".into(),
            "Windows 프린터 설정에서 프린터가 설치되어 있는지 확인해 주세요.".into(),
            vec!["printers".into()],
        );
    }
    if facts.list != ListMark::Some || chosen.is_none() {
        return (
            "printer-general".into(),
            "프린터 목록을 확인하지 못했습니다.".into(),
            "프린터를 제공하는 PC 또는 서버의 응답이 늦을 수 있습니다.".into(),
            vec!["printers".into()],
        );
    }
    let item = chosen.unwrap();
    let pages = vec!["queue".into(), "printers".into()];
    if item.link == LinkKind::Virtual {
        return (
            "printer-general".into(),
            "선택한 프린터는 종이로 출력하지 않는 가상 프린터입니다.\n종이 출력이 필요하면 다른 프린터를 선택해 다시 점검해 주세요.".into(),
            String::new(),
            pages,
        );
    }
    if item.device == DeviceMark::Offline || item.device == DeviceMark::Paused {
        let help = if item.link == LinkKind::Usb { "printer-usb" } else { "printer-offline" };
        return (
            help.into(),
            "프린터는 PC에 설치되어 있지만 현재 Windows에서 오프라인 상태로 확인됩니다.".into(),
            "프린터 전원과 케이블 연결을 확인해 주세요.\n인쇄 대기열 창에서 오프라인으로 사용하도록 되어 있는지도 확인해 주세요.".into(),
            pages,
        );
    }
    if matches!(item.queue, QueueMark::Blocked { .. } | QueueMark::Aged { .. }) {
        return (
            "printer-queue".into(),
            "인쇄 대기열에 바로 처리되지 않은 문서가 있습니다.".into(),
            "인쇄 대기열 창에서 오래 멈춘 문서가 있는지 확인해 주세요. 이 점검이 문서를 지우지는 않습니다.".into(),
            pages,
        );
    }
    if item.link == LinkKind::Shared && status("state") == "unconfirmed" {
        return (
            "printer-shared".into(),
            "공유 프린터의 상태를 이 PC만으로 확정하지 못했습니다.".into(),
            "공유 프린터를 제공하는 PC 또는 서버의 상태도 영향을 줄 수 있습니다.".into(),
            pages,
        );
    }
    if item.link == LinkKind::Network && status("state") == "unconfirmed" {
        return (
            "printer-network".into(),
            "네트워크로 연결된 프린터에는 직접 접속하지 않아 연결을 확정하지 못했습니다.".into(),
            "프린터 전원과 같은 자리의 다른 PC에서 출력되는지를 확인해 주세요.".into(),
            pages,
        );
    }
    (
        "printer-hardware-check".into(),
        "Windows에서 확인 가능한 범위에서는 특별한 문제가 발견되지 않았습니다.\n그래도 출력되지 않는다면 프린터 본체의 용지, 토너, 오류 표시를 확인해 주세요.".into(),
        String::new(),
        pages,
    )
}

fn technical_lines(facts: &PrintFacts, chosen: Option<&Chosen>) -> Vec<TechLine> {
    let mut lines = Vec::new();
    lines.push(TechLine {
        label: "Print Spooler".into(),
        value: match facts.service {
            ServiceMark::Running => "Running".into(),
            ServiceMark::Stopped => "Stopped".into(),
            ServiceMark::Unknown => "Unknown".into(),
        },
    });
    if let Some(item) = chosen {
        lines.push(TechLine { label: "프린터 이름".into(), value: item.name.clone() });
        let link = match item.link {
            LinkKind::Usb => format!("USB ({})", join_port(&item.port_label, &item.monitor_label)),
            LinkKind::Network => "네트워크 연결".into(),
            LinkKind::Shared => "공유 프린터".into(),
            LinkKind::Virtual => "가상 프린터".into(),
            LinkKind::Unknown => "확인되지 않음".into(),
        };
        lines.push(TechLine { label: "연결 유형".into(), value: link });
        lines.push(TechLine {
            label: "기본 프린터".into(),
            value: if item.is_default { "예".into() } else { "아니요".into() },
        });
        let status_note = if item.status_bits == 0 {
            "보고된 상태 없음".to_string()
        } else {
            "보고된 상태 있음".to_string()
        };
        lines.push(TechLine {
            label: "Windows Status".into(),
            value: format!("0x{:08x} ({status_note})", item.status_bits),
        });
        lines.push(TechLine {
            label: "Attributes".into(),
            value: if item.work_offline { "Work Offline 예".into() } else { "Work Offline 아니요".into() },
        });
        lines.push(TechLine { label: "대기 작업 수".into(), value: queue_tech(&item.queue) });
        if item.shared_jobs {
            lines.push(TechLine {
                label: "공유 프린터 대기열".into(),
                value: "다른 사용자 작업 포함 가능".into(),
            });
        }
        if !item.driver.is_empty() {
            lines.push(TechLine { label: "드라이버 이름".into(), value: item.driver.clone() });
        }
    }
    lines
}

fn join_port(port: &str, monitor: &str) -> String {
    match (port.is_empty(), monitor.is_empty()) {
        (false, false) => format!("포트 {port}, 모니터 {monitor}"),
        (false, true) => format!("포트 {port}"),
        (true, false) => format!("모니터 {monitor}"),
        _ => "포트 확인 안 됨".into(),
    }
}

fn queue_tech(queue: &QueueMark) -> String {
    match *queue {
        QueueMark::Empty => "0".into(),
        QueueMark::Waiting { count, oldest_minutes } | QueueMark::Aged { count, oldest_minutes } => {
            format!("{count} (오류 0, 가장 오래된 작업 {oldest_minutes}분 전)")
        }
        QueueMark::Blocked { count, errors, oldest_minutes } => {
            format!("{count} (오류 {errors}, 가장 오래된 작업 {oldest_minutes}분 전)")
        }
        QueueMark::Unknown => "확인 안 됨".into(),
    }
}

fn copy_text(rows: &[PrintRow], finding: &str) -> String {
    let mut lines = vec![format!("[{DISPLAY_NAME} 프린터 출력 점검]"), String::new()];
    for row in rows {
        lines.push(format!("{}: {}", row.title, row.label));
    }
    lines.push(String::new());
    lines.push("진단:".into());
    lines.push(finding.to_string());
    lines.join("\n")
}

fn queue_from_counts(count: u32, errors: u32, oldest_minutes: u32) -> QueueMark {
    if count == 0 {
        QueueMark::Empty
    } else if errors > 0 {
        QueueMark::Blocked { count, errors, oldest_minutes }
    } else if oldest_minutes >= 5 {
        QueueMark::Aged { count, oldest_minutes }
    } else {
        QueueMark::Waiting { count, oldest_minutes }
    }
}

fn classify_link(name: &str, server: &str, port: &str, monitor: &str, driver: &str, network_attr: bool) -> LinkKind {
    let name_l = name.to_ascii_lowercase();
    let port_l = port.to_ascii_lowercase();
    let monitor_l = monitor.to_ascii_lowercase();
    let driver_l = driver.to_ascii_lowercase();
    let virtual_name = name_l.contains("microsoft print to pdf") || name_l.contains("microsoft xps");
    let virtual_driver = driver_l.contains("microsoft print to pdf") || driver_l.contains("microsoft xps");
    let virtual_port = port_l.starts_with("portprompt:") || port_l == "nul:" || port_l.starts_with("file:") || port_l.starts_with("shrfax:");
    if virtual_name || virtual_driver || virtual_port {
        return LinkKind::Virtual;
    }
    if !server.is_empty() || port_l.starts_with("\\\\") {
        return LinkKind::Shared;
    }
    if monitor_l.contains("standard tcp/ip") || monitor_l.contains("wsd") || port_l.contains("wsd") {
        return LinkKind::Network;
    }
    if monitor_l.contains("usb") || port_l.starts_with("usb") {
        return LinkKind::Usb;
    }
    if network_attr {
        return LinkKind::Shared;
    }
    LinkKind::Unknown
}

fn looks_like_address(port: &str) -> bool {
    port.contains('.') && port.chars().any(|ch| ch.is_ascii_digit())
}

fn name_looks_virtual(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("microsoft print to pdf") || lower.contains("microsoft xps")
}

#[cfg(windows)]
fn read_service(wait: Duration) -> Result<ServiceMark, bool> {
    within(wait, || service_now())
}

#[cfg(windows)]
fn service_now() -> ServiceMark {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Services::{
        CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatusEx, SC_MANAGER_CONNECT, SC_STATUS_PROCESS_INFO,
        SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_STATUS_PROCESS,
    };
    struct Guard(windows::Win32::System::Services::SC_HANDLE);
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseServiceHandle(self.0);
            }
        }
    }
    unsafe {
        let Ok(manager) = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CONNECT) else {
            return ServiceMark::Unknown;
        };
        let _manager = Guard(manager);
        let Ok(service) = OpenServiceW(manager, w!("Spooler"), SERVICE_QUERY_STATUS) else {
            return ServiceMark::Unknown;
        };
        let _service = Guard(service);
        let mut raw = [0u8; std::mem::size_of::<SERVICE_STATUS_PROCESS>()];
        let mut needed = 0u32;
        if QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, Some(&mut raw), &mut needed).is_err() {
            return ServiceMark::Unknown;
        }
        let status = &*(raw.as_ptr() as *const SERVICE_STATUS_PROCESS);
        if status.dwCurrentState == SERVICE_RUNNING {
            ServiceMark::Running
        } else {
            ServiceMark::Stopped
        }
    }
}

#[cfg(windows)]
fn read_printers(wait: Duration) -> Result<Vec<PrintChoice>, bool> {
    within(wait, || printer_names())
}

#[cfg(windows)]
fn printer_names() -> Vec<PrintChoice> {
    use windows::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_4W,
    };
    unsafe {
        let mut needed = 0u32;
        let mut returned = 0u32;
        let _ = EnumPrintersW(PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS, windows::core::PCWSTR::null(), 4, None, &mut needed, &mut returned);
        if needed == 0 || needed > 1_048_576 {
            return Vec::new();
        }
        let mut buffer = vec![0u8; needed as usize];
        if EnumPrintersW(
            PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
            windows::core::PCWSTR::null(),
            4,
            Some(&mut buffer),
            &mut needed,
            &mut returned,
        )
        .is_err()
        {
            return Vec::new();
        }
        let default_name = default_printer_name();
        let mut choices = Vec::new();
        let count = returned.min((buffer.len() / std::mem::size_of::<PRINTER_INFO_4W>()) as u32);
        for index in 0..count {
            let info = &*(buffer.as_ptr() as *const PRINTER_INFO_4W).add(index as usize);
            let name = clipped_pwstr(info.pPrinterName);
            if name.is_empty() {
                continue;
            }
            choices.push(PrintChoice {
                virtual_device: name_looks_virtual(&name),
                is_default: name == default_name,
                name,
            });
        }
        choices.sort_by(|left, right| left.virtual_device.cmp(&right.virtual_device).then(left.name.cmp(&right.name)));
        choices
    }
}

#[cfg(windows)]
fn default_printer_name() -> String {
    use windows::Win32::Graphics::Printing::GetDefaultPrinterW;
    unsafe {
        let mut chars = 0u32;
        let _ = GetDefaultPrinterW(None, &mut chars);
        if chars == 0 || chars > 260 {
            return String::new();
        }
        let mut buffer = vec![0u16; chars as usize];
        if GetDefaultPrinterW(Some(windows::core::PWSTR(buffer.as_mut_ptr())), &mut chars).as_bool() {
            let end = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
            String::from_utf16_lossy(&buffer[..end])
        } else {
            String::new()
        }
    }
}

#[cfg(windows)]
fn read_detail(name: &str, budget: &Budget) -> DetailRead {
    let mut timed_out = false;
    let snapshot = match within(budget.slice(), {
        let name = name.to_string();
        move || printer_snapshot(&name)
    }) {
        Ok(value) => value,
        Err(true) => {
            timed_out = true;
            None
        }
        Err(false) => None,
    };
    let Some(mut snapshot) = snapshot else {
        return DetailRead {
            chosen: Some(unknown_chosen(name)),
            timed_out,
        };
    };
    if stopped() || budget.left().is_zero() {
        return DetailRead { chosen: Some(snapshot), timed_out: timed_out || budget.left().is_zero() };
    }
    match within(budget.slice(), {
        let name = name.to_string();
        move || job_counts(&name)
    }) {
        Ok(queue) => snapshot.queue = queue,
        Err(true) => {
            timed_out = true;
            snapshot.queue = QueueMark::Unknown;
        }
        Err(false) => snapshot.queue = QueueMark::Unknown,
    }
    DetailRead { chosen: Some(snapshot), timed_out }
}

#[cfg(windows)]
fn unknown_chosen(name: &str) -> Chosen {
    Chosen {
        name: name.to_string(),
        is_default: false,
        link: LinkKind::Unknown,
        device: DeviceMark::Unknown,
        queue: QueueMark::Unknown,
        port_label: String::new(),
        monitor_label: String::new(),
        driver: String::new(),
        status_bits: 0,
        work_offline: false,
        shared_jobs: false,
    }
}

#[cfg(windows)]
fn printer_snapshot(name: &str) -> Option<Chosen> {
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, GetPrinterW, OpenPrinterW, PRINTER_ATTRIBUTE_NETWORK, PRINTER_ATTRIBUTE_WORK_OFFLINE, PRINTER_INFO_2W,
        PRINTER_STATUS_DOOR_OPEN, PRINTER_STATUS_ERROR, PRINTER_STATUS_NO_TONER, PRINTER_STATUS_OFFLINE, PRINTER_STATUS_PAPER_JAM,
        PRINTER_STATUS_PAPER_OUT, PRINTER_STATUS_PAPER_PROBLEM, PRINTER_STATUS_PAUSED, PRINTER_STATUS_USER_INTERVENTION,
    };
    struct Guard(windows::Win32::Graphics::Printing::PRINTER_HANDLE);
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                let _ = ClosePrinter(self.0);
            }
        }
    }
    let wide = wide_name(name)?;
    unsafe {
        let mut handle = windows::Win32::Graphics::Printing::PRINTER_HANDLE::default();
        if OpenPrinterW(windows::core::PCWSTR(wide.as_ptr()), &mut handle, None).is_err() {
            return None;
        }
        let _guard = Guard(handle);
        let mut needed = 0u32;
        let _ = GetPrinterW(handle, 2, None, &mut needed);
        if needed == 0 || needed > 1_048_576 {
            return None;
        }
        let mut buffer = vec![0u8; needed as usize];
        if GetPrinterW(handle, 2, Some(&mut buffer), &mut needed).is_err() {
            return None;
        }
        let info = &*(buffer.as_ptr() as *const PRINTER_INFO_2W);
        let server = clipped_pwstr(info.pServerName);
        let port = clipped_pwstr(info.pPortName);
        let driver = clipped_pwstr(info.pDriverName);
        let monitor = monitor_for_port(&port);
        let work_offline = info.Attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE != 0;
        let fault_bits = PRINTER_STATUS_ERROR
            | PRINTER_STATUS_PAPER_JAM
            | PRINTER_STATUS_PAPER_OUT
            | PRINTER_STATUS_PAPER_PROBLEM
            | PRINTER_STATUS_NO_TONER
            | PRINTER_STATUS_DOOR_OPEN
            | PRINTER_STATUS_USER_INTERVENTION;
        let device = if work_offline || info.Status & PRINTER_STATUS_OFFLINE != 0 {
            DeviceMark::Offline
        } else if info.Status & PRINTER_STATUS_PAUSED != 0 {
            DeviceMark::Paused
        } else if info.Status & fault_bits != 0 {
            DeviceMark::Fault
        } else if info.Status == 0 {
            DeviceMark::Quiet
        } else {
            DeviceMark::Unknown
        };
        let link = classify_link(name, &server, &port, &monitor, &driver, info.Attributes & PRINTER_ATTRIBUTE_NETWORK != 0);
        let hide_port = link == LinkKind::Network && looks_like_address(&port);
        Some(Chosen {
            name: name.to_string(),
            is_default: default_printer_name() == name,
            link,
            device,
            queue: QueueMark::Unknown,
            port_label: if hide_port { String::new() } else { port },
            monitor_label: monitor,
            driver,
            status_bits: info.Status,
            work_offline,
            shared_jobs: link == LinkKind::Shared,
        })
    }
}

#[cfg(windows)]
fn monitor_for_port(port: &str) -> String {
    use windows::Win32::Graphics::Printing::{EnumPortsW, PORT_INFO_2W};
    if port.is_empty() {
        return String::new();
    }
    unsafe {
        let mut needed = 0u32;
        let mut returned = 0u32;
        let _ = EnumPortsW(windows::core::PCWSTR::null(), 2, None, &mut needed, &mut returned);
        if needed == 0 || needed > 1_048_576 {
            return String::new();
        }
        let mut buffer = vec![0u8; needed as usize];
        if !EnumPortsW(windows::core::PCWSTR::null(), 2, Some(&mut buffer), &mut needed, &mut returned).as_bool() {
            return String::new();
        }
        let count = returned.min((buffer.len() / std::mem::size_of::<PORT_INFO_2W>()) as u32);
        for index in 0..count {
            let info = &*(buffer.as_ptr() as *const PORT_INFO_2W).add(index as usize);
            if clipped_pwstr(info.pPortName).eq_ignore_ascii_case(port) {
                return clipped_pwstr(info.pMonitorName);
            }
        }
        String::new()
    }
}

#[cfg(windows)]
fn job_counts(name: &str) -> QueueMark {
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, EnumJobsW, OpenPrinterW, JOB_INFO_1W, JOB_STATUS_BLOCKED_DEVQ, JOB_STATUS_ERROR, JOB_STATUS_OFFLINE,
        JOB_STATUS_PAPEROUT, JOB_STATUS_USER_INTERVENTION,
    };
    use windows::Win32::System::SystemInformation::GetLocalTime;
    struct Guard(windows::Win32::Graphics::Printing::PRINTER_HANDLE);
    impl Drop for Guard {
        fn drop(&mut self) {
            unsafe {
                let _ = ClosePrinter(self.0);
            }
        }
    }
    let Some(wide) = wide_name(name) else {
        return QueueMark::Unknown;
    };
    unsafe {
        let mut handle = windows::Win32::Graphics::Printing::PRINTER_HANDLE::default();
        if OpenPrinterW(windows::core::PCWSTR(wide.as_ptr()), &mut handle, None).is_err() {
            return QueueMark::Unknown;
        }
        let _guard = Guard(handle);
        let mut needed = 0u32;
        let mut returned = 0u32;
        let _ = EnumJobsW(handle, 0, 256, 1, None, &mut needed, &mut returned);
        if needed == 0 {
            return QueueMark::Empty;
        }
        if needed > 1_048_576 {
            return QueueMark::Unknown;
        }
        let mut buffer = vec![0u8; needed as usize];
        if EnumJobsW(handle, 0, 256, 1, Some(&mut buffer), &mut needed, &mut returned).is_err() {
            return QueueMark::Unknown;
        }
        let now = GetLocalTime();
        let count = returned.min((buffer.len() / std::mem::size_of::<JOB_INFO_1W>()) as u32);
        let mut errors = 0u32;
        let mut oldest = 0u32;
        let bad = JOB_STATUS_ERROR | JOB_STATUS_BLOCKED_DEVQ | JOB_STATUS_OFFLINE | JOB_STATUS_PAPEROUT | JOB_STATUS_USER_INTERVENTION;
        for index in 0..count {
            let job = &*(buffer.as_ptr() as *const JOB_INFO_1W).add(index as usize);
            if job.Status & bad != 0 {
                errors += 1;
            }
            if let Some(minutes) = minutes_between(job.Submitted, now) {
                oldest = oldest.max(minutes);
            }
            let _ = job.Submitted;
        }
        drop(buffer);
        queue_from_counts(count, errors, oldest)
    }
}

#[cfg(windows)]
fn minutes_between(submitted: windows::Win32::Foundation::SYSTEMTIME, now: windows::Win32::Foundation::SYSTEMTIME) -> Option<u32> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Time::SystemTimeToFileTime;
    unsafe {
        let mut left = FILETIME::default();
        let mut right = FILETIME::default();
        SystemTimeToFileTime(&submitted, &mut left).ok()?;
        SystemTimeToFileTime(&now, &mut right).ok()?;
        let earlier = ((left.dwHighDateTime as u64) << 32) | left.dwLowDateTime as u64;
        let later = ((right.dwHighDateTime as u64) << 32) | right.dwLowDateTime as u64;
        later.checked_sub(earlier).map(|ticks| (ticks / 10_000_000 / 60) as u32)
    }
}

#[cfg(windows)]
fn wide_name(name: &str) -> Option<Vec<u16>> {
    if name.is_empty() || name.len() > 220 {
        return None;
    }
    let mut wide: Vec<u16> = name.encode_utf16().collect();
    wide.push(0);
    Some(wide)
}

#[cfg(windows)]
fn clipped_pwstr(value: windows::core::PWSTR) -> String {
    if value.0.is_null() {
        return String::new();
    }
    unsafe {
        let mut len = 0usize;
        while len < 220 && *value.0.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(value.0, len))
    }
}

#[cfg(windows)]
fn within<T: Send + 'static>(wait: Duration, work: impl FnOnce() -> T + Send + 'static) -> Result<T, bool> {
    if wait.is_zero() {
        return Err(true);
    }
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(work());
    });
    match rx.recv_timeout(wait) {
        Ok(value) => Ok(value),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(true),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(false),
    }
}

#[cfg(not(windows))]
fn read_service(_wait: Duration) -> Result<ServiceMark, bool> {
    Err(false)
}

#[cfg(not(windows))]
fn read_printers(_wait: Duration) -> Result<Vec<PrintChoice>, bool> {
    Err(false)
}

#[cfg(not(windows))]
fn read_detail(name: &str, _budget: &Budget) -> DetailRead {
    DetailRead {
        chosen: Some(Chosen {
            name: name.to_string(),
            is_default: false,
            link: LinkKind::Unknown,
            device: DeviceMark::Unknown,
            queue: QueueMark::Unknown,
            port_label: String::new(),
            monitor_label: String::new(),
            driver: String::new(),
            status_bits: 0,
            work_offline: false,
            shared_jobs: false,
        }),
        timed_out: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chosen(link: LinkKind, device: DeviceMark, queue: QueueMark) -> Chosen {
        Chosen {
            name: "교무실 복합기".into(),
            is_default: true,
            link,
            device,
            queue,
            port_label: "USB001".into(),
            monitor_label: "USB Monitor".into(),
            driver: "일반 드라이버".into(),
            status_bits: 0,
            work_offline: device == DeviceMark::Offline,
            shared_jobs: link == LinkKind::Shared,
        }
    }

    fn ready(item: Chosen) -> PrintFacts {
        PrintFacts {
            service: ServiceMark::Running,
            list: ListMark::Some,
            count: 1,
            chosen: Some(item),
            stopped: false,
            timed_out: false,
        }
    }

    #[test]
    fn stopped_service_is_not_called_missing() {
        let report = diagnose(&PrintFacts {
            service: ServiceMark::Stopped,
            list: ListMark::Skipped,
            count: 0,
            chosen: None,
            stopped: false,
            timed_out: false,
        });
        assert_eq!(report.help_id, "printer-spooler");
        assert_eq!(report.rows[1].status, "skipped");
        assert!(!report.finding.contains("없습니다") || report.finding.contains("인쇄 서비스"));
        assert_ne!(report.help_id, "printer-not-installed");
    }

    #[test]
    fn no_printer_when_the_service_is_running() {
        let report = diagnose(&PrintFacts {
            service: ServiceMark::Running,
            list: ListMark::None,
            count: 0,
            chosen: None,
            stopped: false,
            timed_out: false,
        });
        assert_eq!(report.help_id, "printer-not-installed");
        assert_eq!(report.rows[1].label, "프린터 없음");
    }

    #[test]
    fn quiet_status_is_not_called_healthy() {
        let report = diagnose(&ready(chosen(LinkKind::Usb, DeviceMark::Quiet, QueueMark::Empty)));
        assert_eq!(report.help_id, "printer-hardware-check");
        assert_eq!(report.rows[2].status, "unconfirmed");
        assert!(!report.finding.contains("문제가 없습니다"));
    }

    #[test]
    fn offline_flag_points_at_the_offline_help() {
        let mut item = chosen(LinkKind::Usb, DeviceMark::Offline, QueueMark::Waiting { count: 2, oldest_minutes: 1 });
        item.work_offline = true;
        let report = diagnose(&ready(item));
        assert_eq!(report.help_id, "printer-usb");
        assert_eq!(report.rows[2].label, "오프라인");
    }

    #[test]
    fn paused_is_a_warning_in_the_offline_family() {
        let report = diagnose(&ready(chosen(LinkKind::Network, DeviceMark::Paused, QueueMark::Empty)));
        assert_eq!(report.help_id, "printer-offline");
        assert_eq!(report.rows[2].status, "warning");
    }

    #[test]
    fn short_queue_is_not_a_queue_problem() {
        let report = diagnose(&ready(chosen(
            LinkKind::Usb,
            DeviceMark::Quiet,
            QueueMark::Waiting { count: 2, oldest_minutes: 1 },
        )));
        assert_eq!(report.rows[3].status, "warning");
        assert_ne!(report.help_id, "printer-queue");
    }

    #[test]
    fn blocked_job_is_a_queue_problem() {
        let report = diagnose(&ready(chosen(
            LinkKind::Usb,
            DeviceMark::Quiet,
            QueueMark::Blocked { count: 1, errors: 1, oldest_minutes: 1 },
        )));
        assert_eq!(report.help_id, "printer-queue");
    }

    #[test]
    fn old_job_is_a_queue_problem() {
        let report = diagnose(&ready(chosen(
            LinkKind::Usb,
            DeviceMark::Quiet,
            QueueMark::Aged { count: 1, oldest_minutes: 10 },
        )));
        assert_eq!(report.help_id, "printer-queue");
        assert!(report.rows[3].label.contains("오래 대기"));
    }

    #[test]
    fn shared_timeout_is_not_a_local_fault() {
        let report = diagnose(&ready(chosen(LinkKind::Shared, DeviceMark::Unknown, QueueMark::Unknown)));
        assert_eq!(report.help_id, "printer-shared");
        assert!(report.advice.contains("서버"));
    }

    #[test]
    fn virtual_printer_is_not_a_link_failure() {
        let report = diagnose(&ready(chosen(LinkKind::Virtual, DeviceMark::Quiet, QueueMark::Empty)));
        assert_eq!(report.help_id, "printer-general");
        assert_eq!(report.rows[4].label, "가상 프린터");
        assert!(!report.finding.contains("연결") || report.finding.contains("가상"));
    }

    #[test]
    fn not_being_default_is_not_an_error() {
        let mut item = chosen(LinkKind::Usb, DeviceMark::Quiet, QueueMark::Empty);
        item.is_default = false;
        let report = diagnose(&ready(item));
        assert_ne!(report.rows[0].status, "error");
        assert_ne!(report.rows[1].status, "error");
        assert_ne!(report.help_id, "printer-offline");
    }

    #[test]
    fn copy_text_has_no_document_or_user() {
        let report = diagnose(&ready(chosen(LinkKind::Usb, DeviceMark::Quiet, QueueMark::Empty)));
        let blob = format!("{:?} {}", report.finding, report.copy_text);
        assert!(!blob.contains("기밀문서"));
        assert!(!blob.contains("사용자명"));
        assert!(report.copy_text.starts_with("[교육업무 런처 프린터 출력 점검]"));
    }

    #[test]
    fn usb_port_is_usb_and_pdf_name_is_virtual() {
        assert_eq!(classify_link("교무실", "", "USB001", "USB Monitor", "일반", false), LinkKind::Usb);
        assert_eq!(
            classify_link("Microsoft Print to PDF", "", "PORTPROMPT:", "", "Microsoft Print To PDF", false),
            LinkKind::Virtual
        );
        assert_eq!(classify_link("행정실", "\\\\office", "", "", "", false), LinkKind::Shared);
    }
}
