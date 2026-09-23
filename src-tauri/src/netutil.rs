use serde::Serialize;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_SCAN: u32 = 256;
const PING_WAIT_MS: &str = "400";
const WORKERS: usize = 24;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalAddress {
    pub ip: String,
    pub mask: Option<String>,
    pub name: Option<String>,
    pub gateway: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HostHit {
    pub ip: String,
    pub name: Option<String>,
    pub ms: Option<u32>,
    pub mac: Option<String>,
    pub kind: String,
    pub kind_label: String,
    pub rtsp: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RangeCheckStatus {
    pub phase: String,
    pub done: u32,
    pub total: u32,
    pub found: u32,
}

const RANGE_CHECK_EVENT: &str = "range-check-status";

fn emit_range_status(app: &AppHandle, phase: &str, done: u32, total: u32, found: u32) {
    let _ = app.emit(
        RANGE_CHECK_EVENT,
        RangeCheckStatus {
            phase: phase.to_string(),
            done,
            total,
            found,
        },
    );
}

fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetOEMCP() -> u32;
    fn GetACP() -> u32;
    fn MultiByteToWideChar(
        code_page: u32,
        flags: u32,
        raw: *const u8,
        raw_len: i32,
        wide: *mut u16,
        wide_len: i32,
    ) -> i32;
}

#[cfg(windows)]
#[link(name = "ws2_32")]
extern "system" {
    fn GetNameInfoW(
        addr: *const SockAddrIn,
        addr_len: i32,
        node: *mut u16,
        node_len: u32,
        service: *mut u16,
        service_len: u32,
        flags: i32,
    ) -> i32;
}

#[cfg(windows)]
#[repr(C)]
struct SockAddrIn {
    family: u16,
    port: u16,
    addr: [u8; 4],
    zero: [u8; 8],
}

fn decode_console_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        if !text.chars().any(|ch| ch == '\u{FFFD}') {
            return text.to_string();
        }
    }
    #[cfg(windows)]
    unsafe {
        let oem = decode_code_page(GetOEMCP(), bytes);
        if let Some(text) = oem {
            return text;
        }
        if let Some(text) = decode_code_page(GetACP(), bytes) {
            return text;
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(windows)]
fn decode_code_page(code_page: u32, bytes: &[u8]) -> Option<String> {
    unsafe {
        let needed = MultiByteToWideChar(
            code_page,
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            std::ptr::null_mut(),
            0,
        );
        if needed <= 0 {
            return None;
        }
        let mut wide = vec![0u16; needed as usize];
        let written = MultiByteToWideChar(
            code_page,
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            wide.as_mut_ptr(),
            needed,
        );
        if written <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&wide[..written as usize]))
    }
}

fn this_computer_name() -> Option<String> {
    std::env::var("COMPUTERNAME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn usable_host_name(name: &str, ip: &str) -> Option<String> {
    let cleaned = name.trim().trim_end_matches('.').trim();
    if cleaned.is_empty() || cleaned == ip || is_ipv4(cleaned) {
        return None;
    }
    Some(cleaned.to_string())
}

fn reverse_dns_name(ip: &str) -> Option<String> {
    #[cfg(windows)]
    {
        let addr = ip.parse::<Ipv4Addr>().ok()?;
        let sa = SockAddrIn {
            family: 2,
            port: 0,
            addr: addr.octets(),
            zero: [0; 8],
        };
        let mut host = [0u16; 256];
        let status = unsafe {
            GetNameInfoW(
                &sa,
                std::mem::size_of::<SockAddrIn>() as i32,
                host.as_mut_ptr(),
                host.len() as u32,
                std::ptr::null_mut(),
                0,
                0,
            )
        };
        if status != 0 {
            return None;
        }
        let len = host.iter().position(|ch| *ch == 0).unwrap_or(host.len());
        return usable_host_name(&String::from_utf16_lossy(&host[..len]), ip);
    }
    #[cfg(not(windows))]
    {
        let _ = ip;
        None
    }
}

fn is_ipv4(text: &str) -> bool {
    text.parse::<Ipv4Addr>().is_ok()
}

fn parse_ipv4(text: &str) -> Option<u32> {
    text.parse::<Ipv4Addr>().ok().map(u32::from)
}

fn format_ipv4(value: u32) -> String {
    Ipv4Addr::from(value).to_string()
}

fn first_ipv4_in(line: &str) -> Option<String> {
    for token in line.split(|ch: char| !ch.is_ascii_digit() && ch != '.') {
        if is_ipv4(token) && token != "0.0.0.0" {
            return Some(token.to_string());
        }
    }
    None
}

fn looks_like_mask(text: &str) -> bool {
    let Ok(mask) = text.parse::<Ipv4Addr>() else {
        return false;
    };
    let value = u32::from(mask);
    if value == 0 {
        return true;
    }
    let inverted = !value;
    inverted & inverted.wrapping_add(1) == 0
}

pub fn this_pc_ipv4() -> Vec<LocalAddress> {
    let mut found = Vec::new();
    if let Ok(output) = hidden_command("ipconfig").output() {
        let text = decode_console_bytes(&output.stdout);
        let mut pending: Option<LocalAddress> = None;
        for line in text.lines() {
            let lower = line.to_ascii_lowercase();
            if lower.contains("ipv4") {
                if let Some(current) = pending.take() {
                    found.push(current);
                }
                if let Some(ip) = first_ipv4_in(line) {
                    if !ip.starts_with("127.") {
                        pending = Some(LocalAddress {
                            ip,
                            mask: None,
                            name: this_computer_name(),
                            gateway: None,
                        });
                    }
                }
                continue;
            }
            if let Some(item) = pending.as_mut() {
                if item.mask.is_none() {
                    if let Some(mask) = first_ipv4_in(line) {
                        if looks_like_mask(&mask) {
                            item.mask = Some(mask);
                        }
                    }
                } else if item.gateway.is_none() {
                    if let Some(gateway) = first_ipv4_in(line) {
                        if !looks_like_mask(&gateway) && gateway != item.ip {
                            item.gateway = Some(gateway);
                        }
                    }
                }
            }
        }
        if let Some(current) = pending {
            found.push(current);
        }
    }

    if found.is_empty() {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            let _ = socket.set_read_timeout(Some(Duration::from_millis(200)));
            if socket.connect("8.8.8.8:80").is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    if let std::net::IpAddr::V4(ip) = addr.ip() {
                        if !ip.is_loopback() {
                            found.push(LocalAddress {
                                ip: ip.to_string(),
                                mask: Some("255.255.255.0".into()),
                                name: this_computer_name(),
                                gateway: None,
                            });
                        }
                    }
                }
            }
        }
    }

    found
}

fn fetch_public_text(url: &str) -> Option<String> {
    let text = fetch_url_text(url)?;
    if is_ipv4(&text) {
        Some(text)
    } else {
        None
    }
}

fn fetch_url_text(url: &str) -> Option<String> {
    let output = hidden_command("curl")
        .args([
            "-sS",
            "-4",
            "--max-time",
            "8",
            "--ssl-no-revoke",
            "-A",
            "EduLauncher",
            url,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

pub fn latest_release_tag() -> Result<String, String> {
    const URL: &str = "https://api.github.com/repos/golee75git/EduLanuncher/releases/latest";
    let body = fetch_url_text(URL).ok_or_else(|| "최신 버전을 확인하지 못했습니다.".to_string())?;
    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|_| "최신 버전을 확인하지 못했습니다.".to_string())?;
    parsed
        .get("tag_name")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "최신 버전을 확인하지 못했습니다.".to_string())
}

pub fn lookup_public_ipv4() -> Result<String, String> {
    const URLS: [&str; 3] = [
        "https://api.ipify.org",
        "https://ipv4.icanhazip.com",
        "https://checkip.amazonaws.com",
    ];
    for url in URLS {
        if let Some(ip) = fetch_public_text(url) {
            return Ok(ip);
        }
    }
    if let Some(ip) = fetch_public_powershell() {
        return Ok(ip);
    }
    Err("공인 IP를 확인하지 못했습니다. 인터넷 연결을 확인하세요.".into())
}

fn fetch_public_powershell() -> Option<String> {
    let script = "(Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri 'https://api.ipify.org').Content.Trim()";
    let output = hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if is_ipv4(&text) {
        Some(text)
    } else {
        None
    }
}

fn parse_ping_ms(text: &str) -> Option<u32> {
    for marker in ["시간=", "시간<", "time=", "time<", "Time=", "Time<"] {
        if let Some(rest) = text.split(marker).nth(1) {
            let digits: String = rest.chars().take_while(|ch| ch.is_ascii_digit()).collect();
            if digits.is_empty() {
                return Some(1);
            }
            return digits.parse().ok();
        }
    }
    None
}

fn parse_ping_name(text: &str, ip: &str) -> Option<String> {
    for line in text.lines().take(6) {
        let Some(start) = line.find('[') else {
            continue;
        };
        let mut name = line[..start].trim().to_string();
        const PREFIXES: [&str; 6] = [
            "Pinging ",
            "pinging ",
            "Ping하는 중 ",
            "다음 호스트로 ping하는 중 ",
            "다음 호스트로 ping 하는 중 ",
            "Ping ",
        ];
        for prefix in PREFIXES {
            if let Some(rest) = name.strip_prefix(prefix) {
                name = rest.trim().to_string();
                break;
            }
        }
        if name.as_bytes().len() >= 5
            && name.as_bytes()[..4].eq_ignore_ascii_case(b"ping")
            && name.as_bytes()[4] == b' '
        {
            name = name[5..].trim().to_string();
        }
        if let Some(cleaned) = usable_host_name(&name, ip) {
            return Some(cleaned);
        }
    }
    None
}

fn ping_one(ip: &str) -> Option<HostHit> {
    let output = hidden_command("ping")
        .args(["-a", "-n", "1", "-w", PING_WAIT_MS, ip])
        .output()
        .ok()?;
    let text = decode_console_bytes(&output.stdout);
    let lower = text.to_ascii_lowercase();
    if lower.contains("unreachable") || text.contains("도달할 수 없습니다") {
        return None;
    }
    if !text.contains("TTL=") && !text.contains("ttl=") && !text.contains("Ttl=") {
        return None;
    }
    Some(HostHit {
        ip: ip.to_string(),
        name: parse_ping_name(&text, ip),
        ms: parse_ping_ms(&text),
        mac: None,
        kind: "other".into(),
        kind_label: "기타 장비".into(),
        rtsp: false,
    })
}

fn load_arp_table() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(output) = hidden_command("arp").arg("-a").output() else {
        return map;
    };
    let text = decode_console_bytes(&output.stdout);
    for line in text.lines() {
        let mut ip = None;
        let mut mac = None;
        for token in line.split_whitespace() {
            if ip.is_none() && is_ipv4(token) {
                ip = Some(token.to_string());
            } else if mac.is_none()
                && token.len() >= 17
                && token.chars().filter(|ch| *ch == '-' || *ch == ':').count() == 5
            {
                mac = Some(token.to_ascii_lowercase());
            }
        }
        if let (Some(ip), Some(mac)) = (ip, mac) {
            map.insert(ip, mac);
        }
    }
    map
}

fn parse_netbios_name(text: &str) -> Option<String> {
    for line in text.lines() {
        let upper = line.to_ascii_uppercase();
        if !line.contains("<00>") {
            continue;
        }
        if upper.contains("GROUP") || line.contains("그룹") || line.contains("__MSBROWSE__") {
            continue;
        }
        let name = line.split('<').next().unwrap_or("").trim();
        if let Some(cleaned) = usable_host_name(name, "") {
            if upper.contains("UNIQUE") || line.contains("고유") || !upper.contains("GROUP") {
                return Some(cleaned);
            }
        }
    }
    None
}

fn netbios_name(ip: &str) -> Option<String> {
    let output = hidden_command("nbtstat").args(["-A", ip]).output().ok()?;
    parse_netbios_name(&decode_console_bytes(&output.stdout))
}

fn fill_missing_names(app: &AppHandle, halt: &Arc<AtomicBool>, hits: &mut [HostHit], found: u32) {
    if halt.load(Ordering::Relaxed) {
        return;
    }
    let local_names: HashMap<String, String> = this_pc_ipv4()
        .into_iter()
        .filter_map(|item| item.name.map(|name| (item.ip, name)))
        .collect();
    for hit in hits.iter_mut() {
        if hit.name.is_none() {
            hit.name = local_names.get(&hit.ip).cloned();
        }
    }

    let unnamed: Vec<String> = hits
        .iter()
        .filter(|hit| hit.name.is_none())
        .map(|hit| hit.ip.clone())
        .collect();
    if unnamed.is_empty() {
        return;
    }

    let total = unnamed.len() as u32;
    emit_range_status(app, "names", 0, total, found);
    let resolved = Arc::new(Mutex::new(HashMap::<String, String>::new()));
    let queue = Arc::new(Mutex::new(unnamed));
    let done = Arc::new(AtomicU32::new(0));
    let mut handles = Vec::new();
    for _ in 0..8 {
        let queue = Arc::clone(&queue);
        let resolved = Arc::clone(&resolved);
        let done = Arc::clone(&done);
        let halt = Arc::clone(halt);
        let app = app.clone();
        handles.push(thread::spawn(move || loop {
            if halt.load(Ordering::Relaxed) {
                break;
            }
            let ip = {
                let mut locked = match queue.lock() {
                    Ok(value) => value,
                    Err(poisoned) => poisoned.into_inner(),
                };
                locked.pop()
            };
            let Some(ip) = ip else {
                break;
            };
            if halt.load(Ordering::Relaxed) {
                break;
            }
            if let Some(name) = reverse_dns_name(&ip).or_else(|| netbios_name(&ip)) {
                let mut map = match resolved.lock() {
                    Ok(value) => value,
                    Err(poisoned) => poisoned.into_inner(),
                };
                map.insert(ip, name);
            }
            let checked = done.fetch_add(1, Ordering::Relaxed) + 1;
            emit_range_status(&app, "names", checked, total, found);
        }));
    }
    for handle in handles {
        let _ = handle.join();
    }
    let names = match resolved.lock() {
        Ok(value) => value.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    for hit in hits.iter_mut() {
        if hit.name.is_none() {
            hit.name = names.get(&hit.ip).cloned();
        }
    }
}

pub fn scan_ipv4_range(
    app: &AppHandle,
    halt: &Arc<AtomicBool>,
    start: &str,
    end: &str,
) -> Result<Vec<HostHit>, String> {
    let start_n = parse_ipv4(start).ok_or("시작 주소가 올바르지 않습니다.")?;
    let end_n = parse_ipv4(end).ok_or("끝 주소가 올바르지 않습니다.")?;
    if start_n > end_n {
        return Err("시작 주소가 끝 주소보다 큽니다.".into());
    }
    let count = end_n.saturating_sub(start_n).saturating_add(1);
    if count > MAX_SCAN {
        return Err("한 번에 256개까지만 검색합니다. /24 이하 구간을 사용하세요.".into());
    }

    let total = count;
    emit_range_status(app, "host", 0, total, 0);
    let queue = Arc::new(Mutex::new((start_n..=end_n).collect::<Vec<u32>>()));
    let (tx, rx) = std::sync::mpsc::channel();
    let workers = WORKERS.min(count as usize).max(1);
    let done = Arc::new(AtomicU32::new(0));
    let found = Arc::new(AtomicU32::new(0));
    let mut handles = Vec::with_capacity(workers);

    for _ in 0..workers {
        let queue = Arc::clone(&queue);
        let tx = tx.clone();
        let done = Arc::clone(&done);
        let found = Arc::clone(&found);
        let halt = Arc::clone(halt);
        let app = app.clone();
        handles.push(thread::spawn(move || loop {
            if halt.load(Ordering::Relaxed) {
                break;
            }
            let next = {
                let mut locked = match queue.lock() {
                    Ok(value) => value,
                    Err(poisoned) => poisoned.into_inner(),
                };
                locked.pop()
            };
            let Some(value) = next else {
                break;
            };
            if halt.load(Ordering::Relaxed) {
                break;
            }
            let ip = format_ipv4(value);
            let hit = ping_one(&ip);
            if let Some(hit) = hit {
                found.fetch_add(1, Ordering::Relaxed);
                let _ = tx.send(hit);
            }
            let checked = done.fetch_add(1, Ordering::Relaxed) + 1;
            emit_range_status(&app, "host", checked, total, found.load(Ordering::Relaxed));
        }));
    }
    drop(tx);

    let mut hits: Vec<HostHit> = rx.iter().collect();
    for handle in handles {
        let _ = handle.join();
    }

    let arp = load_arp_table();
    for hit in &mut hits {
        if hit.mac.is_none() {
            hit.mac = arp.get(&hit.ip).cloned();
        }
    }
    let found_n = hits.len() as u32;
    fill_missing_names(app, halt, &mut hits, found_n);
    classify_hits(&mut hits);
    hits.sort_by(|left, right| parse_ipv4(&left.ip).cmp(&parse_ipv4(&right.ip)));
    Ok(hits)
}

fn looks_like_printer(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    const MARKERS: [&str; 22] = [
        "printer",
        "print",
        "프린터",
        "복합기",
        "laserjet",
        "deskjet",
        "officejet",
        "brother",
        "mfc-",
        "dcp-",
        "hl-",
        "canon",
        "pixma",
        "epson",
        "xerox",
        "ricoh",
        "kyocera",
        "lexmark",
        "sindoh",
        "pantum",
        "scx-",
        "clx-",
    ];
    MARKERS.iter().any(|marker| lower.contains(marker) || name.contains(marker))
}

fn classify_hits(hits: &mut [HostHit]) {
    let adapters = this_pc_ipv4();
    let local_ips: Vec<String> = adapters.iter().map(|item| item.ip.clone()).collect();
    let gateways: Vec<String> = adapters
        .iter()
        .filter_map(|item| item.gateway.clone())
        .collect();

    for hit in hits.iter_mut() {
        let (kind, label) = if local_ips.iter().any(|ip| ip == &hit.ip) {
            ("thisPc", "이 PC")
        } else if gateways.iter().any(|ip| ip == &hit.ip) {
            ("router", "공유기")
        } else if hit
            .name
            .as_deref()
            .is_some_and(looks_like_printer)
        {
            ("printer", "프린터")
        } else if hit.name.as_deref().is_some_and(looks_like_cctv) {
            ("cctv", "CCTV")
        } else if hit.name.as_deref().is_some_and(|name| !name.trim().is_empty()) {
            ("pc", "PC")
        } else {
            ("other", "기타 장비")
        };
        hit.kind = kind.into();
        hit.kind_label = label.into();
    }
}

fn looks_like_cctv(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    const MARKERS: [&str; 18] = [
        "cctv",
        "camera",
        "cam-",
        "ipc",
        "nvr",
        "dvr",
        "hikvision",
        "dahua",
        "hanwha",
        "wisenet",
        "idis",
        "uniview",
        "axis",
        "ds-2",
        "ipc-",
        "카메라",
        "씨씨티비",
        "폐쇄회로",
    ];
    MARKERS
        .iter()
        .any(|marker| lower.contains(marker) || name.contains(marker))
}

fn rtsp_open(ip: &str) -> bool {
    let Ok(addr) = format!("{ip}:554").parse::<SocketAddr>() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn cctv_hit(ip: String, ping: Option<HostHit>, rtsp: bool) -> Option<HostHit> {
    let mut hit = ping.unwrap_or(HostHit {
        ip: ip.clone(),
        name: reverse_dns_name(&ip),
        ms: None,
        mac: None,
        kind: "cctv".into(),
        kind_label: "CCTV".into(),
        rtsp,
    });
    hit.rtsp = rtsp;
    if hit.name.is_none() {
        hit.name = reverse_dns_name(&hit.ip);
    }
    let named = hit.name.as_deref().is_some_and(looks_like_cctv);
    if named || rtsp {
        hit.kind = "cctv".into();
        hit.kind_label = "CCTV".into();
        Some(hit)
    } else {
        None
    }
}

pub fn scan_cctv_range(
    app: &AppHandle,
    halt: &Arc<AtomicBool>,
    start: &str,
    end: &str,
) -> Result<Vec<HostHit>, String> {
    let start_n = parse_ipv4(start).ok_or("시작 주소가 올바르지 않습니다.")?;
    let end_n = parse_ipv4(end).ok_or("끝 주소가 올바르지 않습니다.")?;
    if start_n > end_n {
        return Err("시작 주소가 끝 주소보다 큽니다.".into());
    }
    let count = end_n.saturating_sub(start_n).saturating_add(1);
    if count > MAX_SCAN {
        return Err("한 번에 256개까지만 검색합니다. /24 이하 구간을 사용하세요.".into());
    }

    let adapters = this_pc_ipv4();
    let skip: Vec<String> = adapters
        .iter()
        .flat_map(|item| {
            let mut ids = vec![item.ip.clone()];
            if let Some(gateway) = &item.gateway {
                ids.push(gateway.clone());
            }
            ids
        })
        .collect();

    let total = count;
    emit_range_status(app, "host", 0, total, 0);
    let queue = Arc::new(Mutex::new((start_n..=end_n).collect::<Vec<u32>>()));
    let (tx, rx) = std::sync::mpsc::channel();
    let workers = WORKERS.min(count as usize).max(1);
    let done = Arc::new(AtomicU32::new(0));
    let found = Arc::new(AtomicU32::new(0));
    let mut handles = Vec::with_capacity(workers);

    for _ in 0..workers {
        let queue = Arc::clone(&queue);
        let tx = tx.clone();
        let skip = skip.clone();
        let done = Arc::clone(&done);
        let found = Arc::clone(&found);
        let halt = Arc::clone(halt);
        let app = app.clone();
        handles.push(thread::spawn(move || loop {
            if halt.load(Ordering::Relaxed) {
                break;
            }
            let next = {
                let mut locked = match queue.lock() {
                    Ok(value) => value,
                    Err(poisoned) => poisoned.into_inner(),
                };
                locked.pop()
            };
            let Some(value) = next else {
                break;
            };
            if halt.load(Ordering::Relaxed) {
                break;
            }
            let ip = format_ipv4(value);
            if skip.iter().any(|item| item == &ip) {
                let checked = done.fetch_add(1, Ordering::Relaxed) + 1;
                emit_range_status(&app, "host", checked, total, found.load(Ordering::Relaxed));
                continue;
            }
            let ping = ping_one(&ip);
            let rtsp = rtsp_open(&ip);
            if let Some(hit) = cctv_hit(ip, ping, rtsp) {
                found.fetch_add(1, Ordering::Relaxed);
                let _ = tx.send(hit);
            }
            let checked = done.fetch_add(1, Ordering::Relaxed) + 1;
            emit_range_status(&app, "host", checked, total, found.load(Ordering::Relaxed));
        }));
    }
    drop(tx);

    let mut hits: Vec<HostHit> = rx.iter().collect();
    for handle in handles {
        let _ = handle.join();
    }

    let arp = load_arp_table();
    for hit in &mut hits {
        if hit.mac.is_none() {
            hit.mac = arp.get(&hit.ip).cloned();
        }
    }
    let found_n = hits.len() as u32;
    fill_missing_names(app, halt, &mut hits, found_n);
    hits.retain(|hit| hit.name.as_deref().is_some_and(looks_like_cctv) || hit.rtsp);
    for hit in &mut hits {
        hit.kind = "cctv".into();
        hit.kind_label = "CCTV".into();
    }
    hits.sort_by(|left, right| parse_ipv4(&left.ip).cmp(&parse_ipv4(&right.ip)));
    Ok(hits)
}
