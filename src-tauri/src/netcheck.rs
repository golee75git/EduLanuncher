use serde::Serialize;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

static LINK_BUSY: AtomicBool = AtomicBool::new(false);
static LINK_STOP: AtomicBool = AtomicBool::new(false);

/// 연결 확인에 쓰는 주소와 제한 시간.
/// 평문 HTTP는 다른 페이지로 넘어가는 연결인지 보기 위한 것이다.
/// 요청 본문에 문서, 계정, PC 정보를 넣지 않는다.
/// 이 주소의 성공이나 실패만으로 인터넷 장애를 정하지 않는다.
struct ConnectivityProbeConfig {
    display_name: &'static str,
    host: &'static str,
    port: u16,
    path: &'static str,
    expected: &'static str,
    step: Duration,
    overall: Duration,
}

const PROBE: ConnectivityProbeConfig = ConnectivityProbeConfig {
    display_name: "교육업무 런처",
    host: "www.msftconnecttest.com",
    port: 80,
    path: "/connecttest.txt",
    expected: "Microsoft Connect Test",
    step: Duration::from_millis(2000),
    overall: Duration::from_secs(15),
};

struct Budget {
    start: Instant,
}

impl Budget {
    fn new() -> Self {
        Self { start: Instant::now() }
    }

    fn left(&self) -> Duration {
        PROBE.overall.saturating_sub(self.start.elapsed())
    }

    fn slice(&self) -> Duration {
        self.left().min(PROBE.step)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Media {
    Wired,
    Wireless,
    Tunnel,
    Virtual,
    Loopback,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mark {
    Yes,
    No,
    Skip,
}

enum ProbeStop {
    Failed,
    TimedOut,
}

#[derive(Clone, Debug)]
struct AdapterFact {
    media: Media,
    up: bool,
    ipv4: Vec<String>,
    global_v6: bool,
    gateway: Option<String>,
    dns: Vec<String>,
    if_index: u32,
}

#[derive(Clone, Debug)]
struct ProbeFacts {
    read_error: bool,
    adapters: Vec<AdapterFact>,
    gateway_reply: Mark,
    outside_tcp: Mark,
    name_lookup: Mark,
    web_reply: Mark,
    route_index: Option<u32>,
    stopped: bool,
    timed_out: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LinkRow {
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
struct LinkReport {
    rows: Vec<LinkRow>,
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
struct LinkNote {
    kind: String,
    id: String,
    status: String,
    label: String,
    report: Option<LinkReport>,
}

fn stopped() -> bool {
    LINK_STOP.load(Ordering::SeqCst)
}

fn emit_step(app: &AppHandle, id: &str, status: &str, label: &str) {
    let _ = app.emit(
        "pc-link-step",
        LinkNote {
            kind: "step".into(),
            id: id.into(),
            status: status.into(),
            label: label.into(),
            report: None,
        },
    );
}

fn emit_done(app: &AppHandle, report: LinkReport) {
    let _ = app.emit(
        "pc-link-step",
        LinkNote {
            kind: "done".into(),
            id: "done".into(),
            status: "done".into(),
            label: String::new(),
            report: Some(report),
        },
    );
}

#[tauri::command]
pub fn halt_pc_link() {
    LINK_STOP.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn open_pc_setting(page: String) -> Result<(), String> {
    let uri = match page.as_str() {
        "network" => "ms-settings:network",
        "wifi" => "ms-settings:network-wifi",
        "proxy" => "ms-settings:network-proxy",
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
pub fn begin_pc_link(app: AppHandle) -> Result<(), String> {
    if LINK_BUSY.swap(true, Ordering::SeqCst) {
        return Err("이미 점검 중입니다.".into());
    }
    LINK_STOP.store(false, Ordering::SeqCst);
    thread::spawn(move || {
        // 예상된 실패는 Result로 처리한다. 여기는 예기치 않은 panic만 막는다.
        let report = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_link(&app)))
            .unwrap_or_else(|_| fault_report());
        emit_done(&app, report);
        LINK_BUSY.store(false, Ordering::SeqCst);
    });
    Ok(())
}

fn fault_report() -> LinkReport {
    let mut facts = empty_facts();
    facts.read_error = true;
    judge(&facts)
}

fn empty_facts() -> ProbeFacts {
    ProbeFacts {
        read_error: false,
        adapters: Vec::new(),
        gateway_reply: Mark::Skip,
        outside_tcp: Mark::Skip,
        name_lookup: Mark::Skip,
        web_reply: Mark::Skip,
        route_index: None,
        stopped: false,
        timed_out: false,
    }
}

fn finish_early(facts: &mut ProbeFacts, budget: &Budget) -> bool {
    if stopped() {
        facts.stopped = true;
        return true;
    }
    if budget.left().is_zero() {
        facts.timed_out = true;
        return true;
    }
    false
}

fn run_link(app: &AppHandle) -> LinkReport {
    let budget = Budget::new();
    let mut facts = empty_facts();
    emit_step(app, "device", "checking", "점검 중");
    if finish_early(&mut facts, &budget) {
        return judge(&facts);
    }
    match read_adapters() {
        Ok(list) => facts.adapters = list,
        Err(()) => facts.read_error = true,
    }
    let early = judge(&facts);
    if let Some(row) = early.rows.iter().find(|row| row.id == "device") {
        emit_step(app, "device", &row.status, &row.label);
    }
    if early.rows.iter().any(|row| row.id == "device" && row.status == "error") {
        facts.gateway_reply = Mark::Skip;
        facts.name_lookup = Mark::Skip;
        facts.outside_tcp = Mark::Skip;
        facts.web_reply = Mark::Skip;
        return emit_rows(app, judge(&facts), &["address", "inside", "names", "web"]);
    }
    emit_step(app, "address", "checking", "점검 중");
    if finish_early(&mut facts, &budget) {
        return judge(&facts);
    }
    let mut resolved_v4 = None;
    match resolve_name(budget.slice()) {
        Ok(list) => {
            facts.name_lookup = Mark::Yes;
            if let Some(addr) = list.into_iter().find(SocketAddr::is_ipv4) {
                facts.route_index = route_hint(addr).ok();
                resolved_v4 = Some(addr);
            }
        }
        Err(ProbeStop::TimedOut) => {
            facts.timed_out = true;
            facts.name_lookup = Mark::Skip;
        }
        Err(ProbeStop::Failed) => facts.name_lookup = Mark::No,
    }
    let after_address = judge(&facts);
    if let Some(row) = after_address.rows.iter().find(|row| row.id == "address") {
        emit_step(app, "address", &row.status, &row.label);
    }
    let address_bad = after_address.rows.iter().any(|row| row.id == "address" && row.status == "error");
    emit_step(app, "inside", "checking", "점검 중");
    if finish_early(&mut facts, &budget) {
        return emit_rows(app, judge(&facts), &["inside", "names"]);
    }
    if address_bad {
        facts.gateway_reply = Mark::Skip;
        facts.outside_tcp = Mark::Skip;
        facts.web_reply = Mark::Skip;
        return emit_rows(app, judge(&facts), &["inside", "names", "web"]);
    }
    if let Some(gateway) = chosen(&facts.adapters, facts.route_index).and_then(|item| item.gateway.clone()) {
        facts.gateway_reply = match gateway_replies(&gateway, budget.slice()) {
            Ok(true) => Mark::Yes,
            Ok(false) => Mark::No,
            Err(ProbeStop::TimedOut) => {
                facts.timed_out = true;
                Mark::Skip
            }
            Err(ProbeStop::Failed) => Mark::No,
        };
    }
    if finish_early(&mut facts, &budget) {
        return emit_rows(app, judge(&facts), &["inside", "names"]);
    }
    if let Some(addr) = resolved_v4 {
        facts.outside_tcp = match tcp_open(addr, budget.slice()) {
            Ok(true) => Mark::Yes,
            Ok(false) => Mark::No,
            Err(ProbeStop::TimedOut) => {
                facts.timed_out = true;
                Mark::Skip
            }
            Err(ProbeStop::Failed) => Mark::No,
        };
    }
    if finish_early(&mut facts, &budget) {
        return emit_rows(app, judge(&facts), &["inside", "names"]);
    }
    emit_step(app, "web", "checking", "점검 중");
    facts.web_reply = match page_matches(budget.slice()) {
        Ok(true) => Mark::Yes,
        Ok(false) => Mark::No,
        Err(ProbeStop::TimedOut) => {
            facts.timed_out = true;
            Mark::Skip
        }
        Err(ProbeStop::Failed) => Mark::No,
    };
    emit_rows(app, judge(&facts), &["inside", "names", "web"])
}

fn emit_rows(app: &AppHandle, report: LinkReport, ids: &[&str]) -> LinkReport {
    for id in ids {
        if let Some(row) = report.rows.iter().find(|row| row.id == *id) {
            emit_step(app, id, &row.status, &row.label);
        }
    }
    report
}

fn usable_v4(text: &str) -> bool {
    let Ok(ip) = text.parse::<Ipv4Addr>() else {
        return false;
    };
    let octets = ip.octets();
    octets[0] != 0 && octets[0] != 127 && !(octets[0] == 169 && octets[1] == 254)
}

fn apipa_only(item: &AdapterFact) -> bool {
    !item.ipv4.is_empty() && item.ipv4.iter().all(|ip| {
        ip.parse::<Ipv4Addr>()
            .map(|addr| {
                let o = addr.octets();
                o[0] == 169 && o[1] == 254
            })
            .unwrap_or(false)
    }) && !item.global_v6
}

fn chosen(adapters: &[AdapterFact], route_index: Option<u32>) -> Option<&AdapterFact> {
    if let Some(index) = route_index {
        if let Some(item) = adapters.iter().find(|item| item.up && item.media != Media::Loopback && item.if_index == index) {
            return Some(item);
        }
    }
    let mut best: Option<&AdapterFact> = None;
    let mut best_key = (9u8, 9u8, 9u8);
    for item in adapters {
        if !item.up || item.media == Media::Loopback {
            continue;
        }
        let key = (
            if item.ipv4.iter().any(|ip| usable_v4(ip)) { 0 } else { 1 },
            if item.gateway.as_deref().is_some_and(usable_v4) { 0 } else { 1 },
            match item.media {
                Media::Wired => 0,
                Media::Wireless => 1,
                Media::Tunnel => 2,
                Media::Other => 3,
                Media::Virtual => 4,
                Media::Loopback => 5,
            },
        );
        if best.is_none() || key < best_key {
            best = Some(item);
            best_key = key;
        }
    }
    best
}

fn media_label(media: Media) -> &'static str {
    match media {
        Media::Wired => "유선",
        Media::Wireless => "무선",
        Media::Tunnel => "다른 연결",
        Media::Virtual => "가상 연결",
        Media::Loopback => "루프백",
        Media::Other => "기타",
    }
}

fn row(id: &str, title: &str, status: &str, label: &str) -> LinkRow {
    LinkRow {
        id: id.into(),
        title: title.into(),
        status: status.into(),
        label: label.into(),
    }
}

fn judge(facts: &ProbeFacts) -> LinkReport {
    let picked = chosen(&facts.adapters, facts.route_index);
    let physical_up = facts.adapters.iter().any(|item| {
        item.up && matches!(item.media, Media::Wired | Media::Wireless)
    });
    let other_up = facts
        .adapters
        .iter()
        .any(|item| item.up && !matches!(item.media, Media::Loopback | Media::Wired | Media::Wireless));

    let device = if facts.read_error || (!physical_up && !other_up) {
        row("device", "네트워크 장치", "error", "연결 안 됨")
    } else if physical_up {
        row("device", "네트워크 장치", "success", "정상")
    } else {
        row("device", "네트워크 장치", "warning", "확인 필요")
    };

    let address = if device.status == "error" {
        row("address", "IP 주소", "skipped", "확인 불가")
    } else if let Some(item) = picked {
        if item.ipv4.iter().any(|ip| usable_v4(ip)) {
            row("address", "IP 주소", "success", "정상")
        } else if apipa_only(item) || (item.ipv4.is_empty() && !item.global_v6) {
            row("address", "IP 주소", "error", "문제 발견")
        } else if item.global_v6 {
            row("address", "IP 주소", "warning", "확인 필요")
        } else {
            row("address", "IP 주소", "error", "문제 발견")
        }
    } else {
        row("address", "IP 주소", "error", "문제 발견")
    };

    let inside = if device.status == "error" {
        row("inside", "내부 네트워크", "skipped", "확인 불가")
    } else if address.status == "error" {
        row("inside", "내부 네트워크", "warning", "확인 필요")
    } else if picked.and_then(|item| item.gateway.as_deref()).is_some_and(usable_v4) {
        match facts.gateway_reply {
            Mark::Yes => row("inside", "내부 네트워크", "success", "정상"),
            Mark::No => row("inside", "내부 네트워크", "unconfirmed", "응답 확인 안 됨"),
            Mark::Skip => row("inside", "내부 네트워크", "unconfirmed", "확인 필요"),
        }
    } else if picked.map(|item| item.global_v6).unwrap_or(false) && facts.name_lookup == Mark::Yes {
        row("inside", "내부 네트워크", "warning", "확인 필요")
    } else {
        row("inside", "내부 네트워크", "warning", "확인 필요")
    };

    let names = if device.status == "error" || address.status == "error" || facts.name_lookup == Mark::Skip {
        row("names", "인터넷 주소 확인", "skipped", "확인 불가")
    } else if facts.name_lookup == Mark::Yes {
        row("names", "인터넷 주소 확인", "success", "정상")
    } else {
        row("names", "인터넷 주소 확인", "error", "문제 발견")
    };

    let web = if names.status == "error" && facts.web_reply != Mark::Yes {
        row("web", "웹 연결", "skipped", "확인 불가")
    } else if names.status == "skipped" && facts.web_reply != Mark::Yes {
        row("web", "웹 연결", "skipped", "확인 불가")
    } else if facts.web_reply == Mark::Yes {
        row("web", "웹 연결", "success", "정상")
    } else if facts.web_reply == Mark::No && names.status == "success" {
        row("web", "웹 연결", "warning", "확인 필요")
    } else {
        row("web", "웹 연결", "skipped", "확인 불가")
    };

    let rows = vec![device, address, inside, names, web];
    let (finding, advice, help_id, pages) = explain(&rows, facts.stopped, facts.timed_out);
    let technical = technical_lines(facts, picked);
    let copy_text = copy_text(&rows, &finding);
    LinkReport {
        rows,
        finding,
        advice,
        help_id,
        technical,
        copy_text,
        pages,
        stopped: facts.stopped,
    }
}

fn explain(rows: &[LinkRow], stopped: bool, timed_out: bool) -> (String, String, String, Vec<String>) {
    let status = |id: &str| rows.iter().find(|row| row.id == id).map(|row| row.status.as_str()).unwrap_or("skipped");
    let mut finding;
    let advice;
    let mut help;
    let pages;
    if status("device") == "error" {
        finding = "현재 연결된 네트워크 장치를 확인하지 못했습니다.".to_string();
        advice = "Wi-Fi가 꺼져 있거나 랜 케이블이 연결되지 않았는지 확인해 주세요.".to_string();
        help = "network-no-adapter".to_string();
        pages = vec!["network".into(), "wifi".into()];
    } else if status("address") == "error" {
        finding = "PC가 네트워크 주소를 정상적으로 받지 못했습니다.".to_string();
        advice = "네트워크 연결 또는 기관 네트워크의 주소 할당 상태를 확인해 주세요.".to_string();
        help = "network-ip-assignment".to_string();
        pages = vec!["network".into()];
    } else if status("names") == "error" && status("web") != "success" {
        finding = "PC는 내부 네트워크에 연결되어 있지만\n인터넷 주소를 찾는 과정에서 문제가 확인되었습니다.".to_string();
        advice = "기관 네트워크의 주소 찾기 상태를 확인해 주세요.".to_string();
        help = "network-dns".to_string();
        pages = vec!["network".into()];
    } else if status("web") == "warning" || status("web") == "error" {
        finding = "인터넷 주소는 확인되었지만\n연결 확인 응답만으로는 웹 상태를 확정하지 못했습니다.".to_string();
        advice = "기관 정책, 프록시 또는 확인 서버의 영향일 수 있습니다.".to_string();
        help = "network-web".to_string();
        pages = vec!["network".into(), "proxy".into()];
    } else if status("web") == "success" {
        if status("inside") == "unconfirmed" || status("inside") == "warning" {
            finding = "인터넷 사용은 정상적으로 확인되었습니다.\n일부 네트워크 장비는 점검 요청에 응답하지 않도록 설정될 수 있습니다.\n현재 인터넷 사용에는 문제가 확인되지 않았습니다.".to_string();
        } else {
            finding = "현재 PC에서 인터넷 연결이 정상적으로 확인되었습니다.".to_string();
        }
        advice = String::new();
        help = "network-ok".to_string();
        pages = Vec::new();
    } else {
        finding = "일부 단계는 확인되지 않았습니다.".to_string();
        advice = "기관 네트워크 상태를 전산 담당자에게 전달할 수 있습니다.".to_string();
        help = "network-general".to_string();
        pages = vec!["network".into()];
    }
    if timed_out {
        finding = format!("확인 시간이 지나 일부만 확인했습니다.\n{finding}");
    }
    if stopped {
        finding = format!("점검을 멈췄습니다.\n{finding}");
        help = "network-general".to_string();
    }
    (finding, advice, help, pages)
}

fn technical_lines(facts: &ProbeFacts, picked: Option<&AdapterFact>) -> Vec<TechLine> {
    let mut lines = Vec::new();
    if facts.read_error {
        lines.push(TechLine { label: "장치 읽기".into(), value: "읽지 못함".into() });
    }
    if let Some(item) = picked {
        lines.push(TechLine { label: "연결 유형".into(), value: media_label(item.media).into() });
        let ipv4 = item.ipv4.iter().filter(|ip| !ip.starts_with("127.")).cloned().collect::<Vec<_>>();
        lines.push(TechLine {
            label: "IPv4".into(),
            value: if ipv4.is_empty() { "없음".into() } else { ipv4.join(", ") },
        });
        if item.ipv4.iter().any(|ip| {
            ip.parse::<Ipv4Addr>().map(|addr| addr.octets()[0] == 169 && addr.octets()[1] == 254).unwrap_or(false)
        }) {
            lines.push(TechLine {
                label: "주소 상태".into(),
                value: "자동 할당 주소가 확인되었습니다. 주소 할당 또는 연결 상태 확인이 필요할 수 있습니다.".into(),
            });
        }
        lines.push(TechLine {
            label: "기본 경로".into(),
            value: item.gateway.clone().unwrap_or_else(|| "없음".into()),
        });
        lines.push(TechLine {
            label: "주소 서버".into(),
            value: if item.dns.is_empty() { "없음".into() } else { item.dns.join(", ") },
        });
    }
    lines.push(TechLine {
        label: "경로 힌트".into(),
        value: if facts.route_index.is_some() { "확인됨".into() } else { "확인 안 함".into() },
    });
    lines.push(TechLine { label: "장치".into(), value: mark_text(if facts.read_error { Mark::No } else if picked.is_some() { Mark::Yes } else { Mark::No }).into() });
    lines.push(TechLine { label: "경로 응답".into(), value: mark_text(facts.gateway_reply).into() });
    lines.push(TechLine { label: "바깥 연결".into(), value: mark_text(facts.outside_tcp).into() });
    lines.push(TechLine { label: "이름 확인".into(), value: mark_text(facts.name_lookup).into() });
    lines.push(TechLine { label: "웹 응답".into(), value: mark_text(facts.web_reply).into() });
    lines
}

fn mark_text(mark: Mark) -> &'static str {
    match mark {
        Mark::Yes => "확인됨",
        Mark::No => "확인되지 않음",
        Mark::Skip => "확인 안 함",
    }
}

fn copy_text(rows: &[LinkRow], finding: &str) -> String {
    let mut lines = vec![format!("[{} 인터넷 연결 점검]", PROBE.display_name), String::new()];
    for row in rows {
        lines.push(format!("{}: {}", row.title, row.label));
    }
    lines.push(String::new());
    lines.push("진단:".into());
    lines.push(finding.to_string());
    lines.join("\n")
}

#[cfg(test)]
fn adapter(media: Media, up: bool, ipv4: &[&str], global_v6: bool, gateway: Option<&str>, dns: &[&str]) -> AdapterFact {
    AdapterFact {
        media,
        up,
        ipv4: ipv4.iter().map(|ip| (*ip).to_string()).collect(),
        global_v6,
        gateway: gateway.map(str::to_string),
        dns: dns.iter().map(|ip| (*ip).to_string()).collect(),
        if_index: 0,
    }
}

#[cfg(windows)]
fn read_adapters() -> Result<Vec<AdapterFact>, ()> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, IP_ADAPTER_ADDRESSES_LH,
        IP_ADAPTER_DNS_SERVER_ADDRESS_XP, IP_ADAPTER_GATEWAY_ADDRESS_LH, IP_ADAPTER_UNICAST_ADDRESS_LH,
    };
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    unsafe {
        let mut size = 0u32;
        let _ = GetAdaptersAddresses(0, GAA_FLAG_INCLUDE_GATEWAYS, None, None, &mut size);
        if size == 0 {
            return Err(());
        }
        let words = (size as usize + 7) / 8 + 4;
        let mut buffer = vec![0u64; words];
        let ptr = buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
        let code = GetAdaptersAddresses(0, GAA_FLAG_INCLUDE_GATEWAYS, None, Some(ptr), &mut size);
        if code != 0 {
            return Err(());
        }
        let mut found = Vec::new();
        let mut current = ptr;
        let mut hops = 0;
        while !current.is_null() && hops < 64 {
            hops += 1;
            let item = &*current;
            let media = match item.IfType {
                6 => Media::Wired,
                71 => Media::Wireless,
                24 => Media::Loopback,
                23 | 131 => Media::Tunnel,
                53 => Media::Virtual,
                _ => Media::Other,
            };
            let mut ipv4 = Vec::new();
            let mut global_v6 = false;
            let mut address = item.FirstUnicastAddress;
            let mut address_hops = 0;
            while !address.is_null() && address_hops < 16 {
                address_hops += 1;
                let row = &*(address as *const IP_ADAPTER_UNICAST_ADDRESS_LH);
                match read_socket(&row.Address) {
                    Some(SockIp::V4(ip)) => ipv4.push(ip.to_string()),
                    Some(SockIp::V6(ip)) => {
                        if is_global_v6(ip) {
                            global_v6 = true;
                        }
                    }
                    None => {}
                }
                address = row.Next;
            }
            let mut gateway = None;
            let mut gate = item.FirstGatewayAddress;
            let mut gate_hops = 0;
            while !gate.is_null() && gate_hops < 8 {
                gate_hops += 1;
                let row = &*(gate as *const IP_ADAPTER_GATEWAY_ADDRESS_LH);
                if let Some(SockIp::V4(ip)) = read_socket(&row.Address) {
                    if usable_v4(&ip.to_string()) {
                        gateway = Some(ip.to_string());
                        break;
                    }
                }
                gate = row.Next;
            }
            let mut dns = Vec::new();
            let mut name_server = item.FirstDnsServerAddress;
            let mut dns_hops = 0;
            while !name_server.is_null() && dns_hops < 4 {
                dns_hops += 1;
                let row = &*(name_server as *const IP_ADAPTER_DNS_SERVER_ADDRESS_XP);
                match read_socket(&row.Address) {
                    Some(SockIp::V4(ip)) => dns.push(ip.to_string()),
                    Some(SockIp::V6(ip)) if is_global_v6(ip) => dns.push(ip.to_string()),
                    _ => {}
                }
                name_server = row.Next;
            }
            if media != Media::Loopback {
                found.push(AdapterFact {
                    media,
                    up: item.OperStatus == IfOperStatusUp,
                    ipv4,
                    global_v6,
                    gateway,
                    dns,
                    if_index: item.Anonymous1.Anonymous.IfIndex,
                });
            }
            current = item.Next;
        }
        Ok(found)
    }
}

#[cfg(windows)]
enum SockIp {
    V4(Ipv4Addr),
    V6(Ipv6Addr),
}

#[cfg(windows)]
fn read_socket(addr: &windows::Win32::Networking::WinSock::SOCKET_ADDRESS) -> Option<SockIp> {
    if addr.lpSockaddr.is_null() || addr.iSockaddrLength < 4 {
        return None;
    }
    unsafe {
        let raw = std::slice::from_raw_parts(addr.lpSockaddr as *const u8, addr.iSockaddrLength as usize);
        let family = u16::from_le_bytes([raw[0], raw[1]]);
        if family == 2 && raw.len() >= 8 {
            return Some(SockIp::V4(Ipv4Addr::new(raw[4], raw[5], raw[6], raw[7])));
        }
        if family == 23 && raw.len() >= 24 {
            let mut octets = [0u8; 16];
            octets.copy_from_slice(&raw[8..24]);
            return Some(SockIp::V6(Ipv6Addr::from(octets)));
        }
        None
    }
}

#[cfg(windows)]
fn is_global_v6(ip: Ipv6Addr) -> bool {
    let o = ip.octets();
    (o[0] & 0xe0) == 0x20
}

#[cfg(not(windows))]
fn read_adapters() -> Result<Vec<AdapterFact>, ()> {
    Err(())
}

fn wait_ms(wait: Duration) -> Result<u32, ProbeStop> {
    if wait.is_zero() {
        return Err(ProbeStop::TimedOut);
    }
    Ok(wait.as_millis().min(u128::from(u32::MAX)) as u32)
}

fn gateway_replies(gateway: &str, wait: Duration) -> Result<bool, ProbeStop> {
    let ms = wait_ms(wait)?;
    let ip = gateway.parse::<Ipv4Addr>().map_err(|_| ProbeStop::Failed)?;
    #[cfg(windows)]
    {
        use windows::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho};
        struct EchoGuard(windows::Win32::Foundation::HANDLE);
        impl Drop for EchoGuard {
            fn drop(&mut self) {
                unsafe {
                    let _ = IcmpCloseHandle(self.0);
                }
            }
        }
        unsafe {
            let handle = IcmpCreateFile().map_err(|_| ProbeStop::Failed)?;
            let _guard = EchoGuard(handle);
            let dest = u32::from_be_bytes(ip.octets());
            let payload = [0u8; 8];
            let mut reply = [0u8; 128];
            let count = IcmpSendEcho(
                handle,
                dest,
                payload.as_ptr() as *const _,
                payload.len() as u16,
                None,
                reply.as_mut_ptr() as *mut _,
                reply.len() as u32,
                ms,
            );
            return Ok(count > 0);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (ip, ms);
        Err(ProbeStop::Failed)
    }
}

fn resolve_name(wait: Duration) -> Result<Vec<SocketAddr>, ProbeStop> {
    let ms = wait_ms(wait)?;
    let (tx, rx) = mpsc::channel();
    let host = PROBE.host;
    thread::spawn(move || {
        let found = (host, PROBE.port).to_socket_addrs().ok().map(|iter| iter.collect::<Vec<_>>());
        let _ = tx.send(found);
    });
    match rx.recv_timeout(Duration::from_millis(u64::from(ms))) {
        Ok(Some(list)) if !list.is_empty() => Ok(list),
        Ok(_) => Err(ProbeStop::Failed),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(ProbeStop::TimedOut),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(ProbeStop::Failed),
    }
}

/// 실제 경로를 고르기 위한 보조 값이다. 성공이나 실패로 인터넷 상태를 정하지 않는다.
fn route_hint(addr: SocketAddr) -> Result<u32, ProbeStop> {
    let SocketAddr::V4(v4) = addr else {
        return Err(ProbeStop::Failed);
    };
    #[cfg(windows)]
    {
        use windows::Win32::NetworkManagement::IpHelper::GetBestInterfaceEx;
        let mut raw = [0u8; 16];
        raw[0] = 2;
        let port = v4.port().to_be_bytes();
        raw[2] = port[0];
        raw[3] = port[1];
        raw[4..8].copy_from_slice(&v4.ip().octets());
        let mut index = 0u32;
        let code = unsafe { GetBestInterfaceEx(raw.as_ptr() as *const _, &mut index) };
        if code == 0 && index != 0 {
            Ok(index)
        } else {
            Err(ProbeStop::Failed)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = v4;
        Err(ProbeStop::Failed)
    }
}

fn tcp_open(addr: SocketAddr, wait: Duration) -> Result<bool, ProbeStop> {
    let ms = wait_ms(wait)?;
    match TcpStream::connect_timeout(&addr, Duration::from_millis(u64::from(ms))) {
        Ok(stream) => {
            drop(stream);
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => Err(ProbeStop::TimedOut),
        Err(_) => Ok(false),
    }
}

fn page_matches(wait: Duration) -> Result<bool, ProbeStop> {
    let ms = wait_ms(wait)?;
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Networking::WinHttp::{
            WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpReadData,
            WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        };
        struct InetGuard(*mut core::ffi::c_void);
        impl Drop for InetGuard {
            fn drop(&mut self) {
                if !self.0.is_null() {
                    unsafe {
                        let _ = WinHttpCloseHandle(self.0);
                    }
                    self.0 = std::ptr::null_mut();
                }
            }
        }
        fn wide(text: &str) -> Vec<u16> {
            OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
        }
        unsafe {
            let agent = wide(PROBE.display_name);
            let session = InetGuard(WinHttpOpen(
                PCWSTR(agent.as_ptr()),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            ));
            if session.0.is_null() {
                return Err(ProbeStop::Failed);
            }
            let limit = i32::try_from(ms).unwrap_or(i32::MAX);
            if WinHttpSetTimeouts(session.0, limit, limit, limit, limit).is_err() {
                return Err(ProbeStop::Failed);
            }
            let host = wide(PROBE.host);
            let connect = InetGuard(WinHttpConnect(session.0, PCWSTR(host.as_ptr()), PROBE.port, 0));
            if connect.0.is_null() {
                return Err(ProbeStop::Failed);
            }
            let path = wide(PROBE.path);
            let verb = wide("GET");
            let request = InetGuard(WinHttpOpenRequest(
                connect.0,
                PCWSTR(verb.as_ptr()),
                PCWSTR(path.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                std::ptr::null(),
                windows::Win32::Networking::WinHttp::WINHTTP_OPEN_REQUEST_FLAGS(0),
            ));
            if request.0.is_null() {
                return Err(ProbeStop::Failed);
            }
            if WinHttpSendRequest(request.0, None, None, 0, 0, 0).is_err() {
                return Err(ProbeStop::Failed);
            }
            if WinHttpReceiveResponse(request.0, std::ptr::null_mut()).is_err() {
                return Err(ProbeStop::Failed);
            }
            let mut buf = [0u8; 64];
            let mut read = 0u32;
            if WinHttpReadData(request.0, buf.as_mut_ptr() as *mut _, buf.len() as u32, &mut read).is_err() {
                return Err(ProbeStop::Failed);
            }
            let text = String::from_utf8_lossy(&buf[..read as usize]);
            Ok(text.trim() == PROBE.expected)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = ms;
        Err(ProbeStop::Failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(adapters: Vec<AdapterFact>, gateway: Mark, names: Mark, web: Mark) -> ProbeFacts {
        ProbeFacts {
            read_error: false,
            adapters,
            gateway_reply: gateway,
            outside_tcp: Mark::Skip,
            name_lookup: names,
            web_reply: web,
            route_index: None,
            stopped: false,
            timed_out: false,
        }
    }

    #[test]
    fn no_adapter_asks_to_check_the_link() {
        let report = judge(&facts(Vec::new(), Mark::Skip, Mark::Skip, Mark::Skip));
        assert_eq!(report.rows[0].status, "error");
        assert!(report.rows[1..].iter().all(|row| row.status == "skipped"));
        assert!(report.finding.contains("네트워크 장치"));
        assert_eq!(report.help_id, "network-no-adapter");
        assert!(!report.copy_text.contains("169.254"));
    }

    #[test]
    fn temporary_address_is_not_called_a_normal_assignment() {
        let report = judge(&facts(
            vec![adapter(Media::Wired, true, &["169.254.8.9"], false, None, &[])],
            Mark::Skip,
            Mark::Skip,
            Mark::Skip,
        ));
        assert_eq!(report.rows[0].status, "success");
        assert_eq!(report.rows[1].status, "error");
        assert!(report.finding.contains("네트워크 주소를 정상적으로 받지 못했습니다"));
        assert_eq!(report.help_id, "network-ip-assignment");
        assert!(!report.copy_text.contains("169.254"));
    }

    #[test]
    fn name_lookup_failure_stays_on_that_step() {
        let report = judge(&facts(
            vec![adapter(Media::Wired, true, &["10.1.1.8"], false, Some("10.1.1.1"), &["10.1.1.2"])],
            Mark::Yes,
            Mark::No,
            Mark::No,
        ));
        assert_eq!(report.rows[2].status, "success");
        assert_eq!(report.rows[3].status, "error");
        assert_eq!(report.rows[4].status, "skipped");
        assert!(report.finding.contains("인터넷 주소를 찾는 과정"));
        assert_eq!(report.help_id, "network-dns");
    }

    #[test]
    fn silent_gateway_does_not_mean_the_link_is_down() {
        let report = judge(&facts(
            vec![adapter(Media::Wired, true, &["10.1.1.8"], false, Some("10.1.1.1"), &["10.1.1.2"])],
            Mark::No,
            Mark::Yes,
            Mark::Yes,
        ));
        assert_eq!(report.rows[2].status, "unconfirmed");
        assert_eq!(report.rows[3].status, "success");
        assert_eq!(report.rows[4].status, "success");
        assert!(report.finding.contains("인터넷 사용은 정상적으로 확인"));
        assert_eq!(report.help_id, "network-ok");
    }

    #[test]
    fn tunnel_beside_a_healthy_wire_is_not_the_failure() {
        let report = judge(&facts(
            vec![
                adapter(Media::Tunnel, true, &["169.254.1.1"], false, None, &[]),
                adapter(Media::Wired, true, &["10.2.2.5"], false, Some("10.2.2.1"), &["10.2.2.2"]),
            ],
            Mark::Yes,
            Mark::Yes,
            Mark::Yes,
        ));
        assert_eq!(report.rows[0].status, "success");
        assert_eq!(report.rows[1].status, "success");
        assert_eq!(report.help_id, "network-ok");
        assert!(report.technical.iter().any(|line| line.label == "IPv4" && line.value.contains("10.2.2.5")));
        assert!(report.technical.iter().all(|line| !line.value.contains("169.254.1.1")));
    }

    #[test]
    fn ipv6_only_is_not_declared_down_when_the_web_answers() {
        let report = judge(&facts(
            vec![adapter(Media::Wireless, true, &[], true, None, &[])],
            Mark::Skip,
            Mark::Yes,
            Mark::Yes,
        ));
        assert_ne!(report.rows[1].status, "error");
        assert_eq!(report.rows[4].status, "success");
        assert_eq!(report.help_id, "network-ok");
        assert!(!report.finding.contains("받지 못했습니다"));
    }

    #[test]
    fn route_hint_can_select_a_virtual_adapter() {
        let mut virtual_link = adapter(Media::Virtual, true, &["10.8.8.8"], false, Some("10.8.8.1"), &[]);
        virtual_link.if_index = 7;
        let mut wire = adapter(Media::Wired, true, &["169.254.4.4"], false, None, &[]);
        wire.if_index = 3;
        let mut sample = facts(vec![wire, virtual_link], Mark::Yes, Mark::Yes, Mark::Yes);
        sample.route_index = Some(7);
        let report = judge(&sample);
        assert_ne!(report.rows[0].status, "error");
        assert_eq!(report.rows[1].status, "success");
        assert!(report.technical.iter().any(|line| line.label == "IPv4" && line.value.contains("10.8.8.8")));
    }

    #[test]
    fn probe_mismatch_alone_is_not_an_outage() {
        let report = judge(&facts(
            vec![adapter(Media::Wired, true, &["10.1.1.8"], false, Some("10.1.1.1"), &["10.1.1.2"])],
            Mark::Yes,
            Mark::Yes,
            Mark::No,
        ));
        assert_eq!(report.rows[4].status, "warning");
        assert!(!report.finding.contains("장애"));
        assert!(report.finding.contains("확정하지 못했습니다"));
    }
}
