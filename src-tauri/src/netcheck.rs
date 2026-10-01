use serde::Serialize;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static LINK_BUSY: AtomicBool = AtomicBool::new(false);
static LINK_STOP: AtomicBool = AtomicBool::new(false);

const STEP_WAIT: Duration = Duration::from_millis(2000);
const NAME_HOST: &str = "example.com";

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

#[derive(Clone, Debug)]
struct AdapterFact {
    media: Media,
    up: bool,
    ipv4: Vec<String>,
    global_v6: bool,
    gateway: Option<String>,
    dns: Vec<String>,
}

#[derive(Clone, Debug)]
struct ProbeFacts {
    read_error: bool,
    adapters: Vec<AdapterFact>,
    gateway_reply: Mark,
    outside_tcp: Mark,
    name_lookup: Mark,
    web_reply: Mark,
    stopped: bool,
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
        stopped: false,
    }
}

fn run_link(app: &AppHandle) -> LinkReport {
    let mut facts = empty_facts();
    emit_step(app, "device", "checking", "점검 중");
    if stopped() {
        facts.stopped = true;
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
    emit_step(app, "address", "checking", "점검 중");
    if stopped() {
        facts.stopped = true;
        return judge(&facts);
    }
    let after_address = judge(&facts);
    if let Some(row) = after_address.rows.iter().find(|row| row.id == "address") {
        emit_step(app, "address", &row.status, &row.label);
    }
    emit_step(app, "inside", "checking", "점검 중");
    if stopped() {
        facts.stopped = true;
        return judge(&facts);
    }
    if after_address.rows.iter().any(|row| row.id == "device" && row.status == "error")
        || after_address.rows.iter().any(|row| row.id == "address" && row.status == "error")
    {
        facts.gateway_reply = Mark::Skip;
    } else if let Some(gateway) = chosen(&facts.adapters).and_then(|item| item.gateway.clone()) {
        facts.gateway_reply = if gateway_replies(&gateway) { Mark::Yes } else { Mark::No };
    }
    let after_inside = judge(&facts);
    if let Some(row) = after_inside.rows.iter().find(|row| row.id == "inside") {
        emit_step(app, "inside", &row.status, &row.label);
    }
    emit_step(app, "names", "checking", "점검 중");
    if stopped() {
        facts.stopped = true;
        return judge(&facts);
    }
    if after_address.rows.iter().any(|row| row.id == "address" && row.status == "error")
        || after_address.rows.iter().any(|row| row.id == "device" && row.status == "error")
    {
        facts.name_lookup = Mark::Skip;
        facts.outside_tcp = Mark::Skip;
        facts.web_reply = Mark::Skip;
    } else {
        let resolved = resolve_name();
        facts.name_lookup = if resolved.as_ref().map(|list| !list.is_empty()).unwrap_or(false) {
            Mark::Yes
        } else {
            Mark::No
        };
        if stopped() {
            facts.stopped = true;
            return judge(&facts);
        }
        if let Some(list) = resolved.as_ref() {
            if let Some(addr) = list.first() {
                facts.outside_tcp = if tcp_open(*addr) { Mark::Yes } else { Mark::No };
            }
        }
        if stopped() {
            facts.stopped = true;
            return judge(&facts);
        }
        emit_step(app, "web", "checking", "점검 중");
        facts.web_reply = if web_replies() { Mark::Yes } else { Mark::No };
    }
    if facts.name_lookup == Mark::Skip {
        emit_step(app, "names", "skipped", "확인 불가");
        emit_step(app, "web", "skipped", "확인 불가");
    } else {
        let named = judge(&facts);
        if let Some(row) = named.rows.iter().find(|row| row.id == "names") {
            emit_step(app, "names", &row.status, &row.label);
        }
        if facts.web_reply == Mark::Skip {
            emit_step(app, "web", "checking", "점검 중");
        }
        let done = judge(&facts);
        if let Some(row) = done.rows.iter().find(|row| row.id == "web") {
            emit_step(app, "web", &row.status, &row.label);
        }
    }
    judge(&facts)
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

fn chosen(adapters: &[AdapterFact]) -> Option<&AdapterFact> {
    let physical_up = adapters
        .iter()
        .any(|item| item.up && matches!(item.media, Media::Wired | Media::Wireless));
    let mut best: Option<&AdapterFact> = None;
    let mut best_key = (9u8, 9u8, 9u8);
    for item in adapters {
        if !item.up || item.media == Media::Loopback {
            continue;
        }
        if physical_up && !matches!(item.media, Media::Wired | Media::Wireless) {
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
    let picked = chosen(&facts.adapters);
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
        row("web", "웹 연결", "error", "문제 발견")
    } else {
        row("web", "웹 연결", "skipped", "확인 불가")
    };

    let rows = vec![device, address, inside, names, web];
    let (finding, advice, help_id, pages) = explain(&rows, facts.stopped);
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

fn explain(rows: &[LinkRow], stopped: bool) -> (String, String, String, Vec<String>) {
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
    } else if status("web") == "error" {
        finding = "인터넷 주소는 정상적으로 확인되지만\n웹사이트 연결이 정상적으로 확인되지 않았습니다.".to_string();
        advice = "기관 네트워크, 프록시 또는 보안 환경의 영향을 받을 수 있습니다.".to_string();
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
    let mut lines = vec!["[LauncherBox 인터넷 연결 점검]".to_string(), String::new()];
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

fn gateway_replies(gateway: &str) -> bool {
    let Ok(ip) = gateway.parse::<Ipv4Addr>() else {
        return false;
    };
    #[cfg(windows)]
    {
        use windows::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho};
        unsafe {
            let Ok(handle) = IcmpCreateFile() else {
                return false;
            };
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
                STEP_WAIT.as_millis() as u32,
            );
            let _ = IcmpCloseHandle(handle);
            return count > 0;
        }
    }
    #[cfg(not(windows))]
    {
        let _ = ip;
        false
    }
}

fn resolve_name() -> Option<Vec<SocketAddr>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let found = (NAME_HOST, 443u16).to_socket_addrs().ok().map(|iter| iter.collect::<Vec<_>>());
        let _ = tx.send(found);
    });
    match rx.recv_timeout(STEP_WAIT) {
        Ok(Some(list)) if !list.is_empty() => Some(list),
        _ => None,
    }
}

fn tcp_open(addr: SocketAddr) -> bool {
    TcpStream::connect_timeout(&addr, STEP_WAIT).is_ok()
}

fn web_replies() -> bool {
    #[cfg(windows)]
    {
        use windows::core::{w, PCWSTR};
        use windows::Win32::Networking::WinHttp::{
            WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders,
            WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            WINHTTP_FLAG_SECURE, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
        };
        unsafe {
            let session = WinHttpOpen(
                w!("EduLauncher"),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            );
            if session.is_null() {
                return false;
            }
            let _ = WinHttpSetTimeouts(session, 2000, 2000, 2000, 2000);
            let connect = WinHttpConnect(session, w!("example.com"), 443, 0);
            if connect.is_null() {
                let _ = WinHttpCloseHandle(session);
                return false;
            }
            let request = WinHttpOpenRequest(
                connect,
                w!("GET"),
                w!("/"),
                PCWSTR::null(),
                PCWSTR::null(),
                std::ptr::null(),
                WINHTTP_FLAG_SECURE,
            );
            if request.is_null() {
                let _ = WinHttpCloseHandle(connect);
                let _ = WinHttpCloseHandle(session);
                return false;
            }
            let sent = WinHttpSendRequest(request, None, None, 0, 0, 0);
            let received = sent.is_ok() && WinHttpReceiveResponse(request, std::ptr::null_mut()).is_ok();
            let mut code = 0u32;
            let mut len = std::mem::size_of::<u32>() as u32;
            let mut index = 0u32;
            let queried = received
                && WinHttpQueryHeaders(
                    request,
                    WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                    PCWSTR::null(),
                    Some(&mut code as *mut u32 as *mut _),
                    &mut len,
                    &mut index,
                )
                .is_ok();
            let _ = WinHttpCloseHandle(request);
            let _ = WinHttpCloseHandle(connect);
            let _ = WinHttpCloseHandle(session);
            return queried && (200..400).contains(&code);
        }
    }
    #[cfg(not(windows))]
    {
        false
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
            stopped: false,
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
}
