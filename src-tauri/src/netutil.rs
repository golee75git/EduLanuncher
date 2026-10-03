use serde::Serialize;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const MAX_SCAN: u32 = 256;
const WORKERS: usize = 8;
const SCAN_GAP: Duration = Duration::from_millis(40);
const ECHO_WAIT_MS: u32 = 400;

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

fn active_adapters() -> Vec<LocalAddress> {
    #[cfg(windows)]
    {
        return read_active_adapters();
    }
    #[cfg(not(windows))]
    Vec::new()
}

#[cfg(windows)]
fn read_active_adapters() -> Vec<LocalAddress> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::Networking::WinSock::{AF_INET, SOCKET_ADDRESS};
    unsafe {
        let mut size = 0u32;
        let _ = GetAdaptersAddresses(AF_INET.0 as u32, GAA_FLAG_INCLUDE_GATEWAYS, None, None, &mut size);
        if size == 0 {
            return Vec::new();
        }
        let mut buf = vec![0u8; size as usize + 256];
        let head = buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
        if GetAdaptersAddresses(AF_INET.0 as u32, GAA_FLAG_INCLUDE_GATEWAYS, None, Some(head), &mut size) != 0
        {
            return Vec::new();
        }
        let mut found = Vec::new();
        let mut cursor = head;
        while !cursor.is_null() {
            let item = &*cursor;
            if item.OperStatus == IfOperStatusUp {
                let mut uni = item.FirstUnicastAddress;
                while !uni.is_null() {
                    let row = &*uni;
                    if let Some(ip) = ipv4_socket(&row.Address) {
                        if !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified() {
                            let gateway = first_gateway(item.FirstGatewayAddress);
                            found.push(LocalAddress {
                                ip: ip.to_string(),
                                mask: Some(format_ipv4(prefix_mask(row.OnLinkPrefixLength))),
                                name: this_computer_name(),
                                gateway: gateway.map(|value| value.to_string()),
                            });
                        }
                    }
                    uni = row.Next;
                }
            }
            cursor = item.Next;
        }
        let _ = std::mem::size_of::<SOCKET_ADDRESS>();
        found
    }
}

#[cfg(windows)]
fn ipv4_socket(addr: &windows::Win32::Networking::WinSock::SOCKET_ADDRESS) -> Option<Ipv4Addr> {
    let len = addr.iSockaddrLength as usize;
    if len < 8 || addr.lpSockaddr.is_null() {
        return None;
    }
    let raw = unsafe { std::slice::from_raw_parts(addr.lpSockaddr as *const u8, len.min(16)) };
    let family = u16::from_ne_bytes([raw[0], raw[1]]);
    if family != 2 {
        return None;
    }
    Some(Ipv4Addr::new(raw[4], raw[5], raw[6], raw[7]))
}

#[cfg(windows)]
fn first_gateway(
    mut cursor: *mut windows::Win32::NetworkManagement::IpHelper::IP_ADAPTER_GATEWAY_ADDRESS_LH,
) -> Option<Ipv4Addr> {
    unsafe {
        while !cursor.is_null() {
            if let Some(ip) = ipv4_socket(&(*cursor).Address) {
                if !ip.is_unspecified() {
                    return Some(ip);
                }
            }
            cursor = (*cursor).Next;
        }
    }
    None
}

pub fn this_pc_ipv4() -> Vec<LocalAddress> {
    active_adapters()
}

fn prefix_mask(bits: u8) -> u32 {
    if bits == 0 {
        0
    } else if bits >= 32 {
        u32::MAX
    } else {
        u32::MAX << (32 - bits)
    }
}

fn in_prefix(ip: u32, base: u32, bits: u8) -> bool {
    let mask = prefix_mask(bits);
    (ip & mask) == (base & mask)
}

fn private_prefix(base: u32, bits: u8) -> bool {
    let network = base & prefix_mask(bits);
    let first = network >> 24;
    let second = (network >> 16) & 0xff;
    if first == 10 {
        return bits >= 8;
    }
    if first == 172 && (16..=31).contains(&second) {
        return bits >= 12;
    }
    first == 192 && second == 168 && bits >= 16
}

pub fn span_fits(start: u32, end: u32, nets: &[(u32, u8)]) -> Result<(), &'static str> {
    if start > end {
        return Err("시작 주소가 끝 주소보다 큽니다.");
    }
    if end - start + 1 > MAX_SCAN {
        return Err("한 번에 256개까지만 검색합니다. /24 이하 구간을 사용하세요.");
    }
    let inside = nets.iter().any(|(base, bits)| {
        private_prefix(*base, *bits) && in_prefix(start, *base, *bits) && in_prefix(end, *base, *bits)
    });
    if inside {
        Ok(())
    } else {
        Err("이 PC가 연결된 네트워크 범위 안에서만 검색할 수 있습니다.")
    }
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
    let text = crate::fixed_https::read_https(url).ok()?.trim().to_string();
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
    Err("공인 IP를 확인하지 못했습니다. 인터넷 연결을 확인하세요.".into())
}

fn wait_scan_gap(halt: &AtomicBool) -> bool {
    let end = Instant::now() + SCAN_GAP;
    while Instant::now() < end {
        if halt.load(Ordering::Relaxed) {
            return true;
        }
        thread::sleep(Duration::from_millis(10));
    }
    false
}

fn echo_once(ip: &str) -> Option<u32> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_IO_PENDING, WAIT_OBJECT_0};
        use windows::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho2, ICMP_ECHO_REPLY};
        use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
        let addr = ip.parse::<Ipv4Addr>().ok()?;
        let dest = u32::from_ne_bytes(addr.octets());
        unsafe {
            let handle = IcmpCreateFile().ok()?;
            let event = CreateEventW(None, true, false, None).ok();
            let Some(event) = event else {
                let _ = IcmpCloseHandle(handle);
                return None;
            };
            let payload = [0u8; 8];
            let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + 16];
            let code = IcmpSendEcho2(
                handle,
                Some(event),
                None,
                None,
                dest,
                payload.as_ptr() as *const _,
                payload.len() as u16,
                None,
                reply.as_mut_ptr() as *mut _,
                reply.len() as u32,
                ECHO_WAIT_MS,
            );
            let pending = code == 0 && GetLastError() == ERROR_IO_PENDING;
            let ready = code > 0 || (pending && WaitForSingleObject(event, ECHO_WAIT_MS) == WAIT_OBJECT_0);
            let _ = CloseHandle(event);
            let _ = IcmpCloseHandle(handle);
            if !ready || reply.len() < 12 {
                return None;
            }
            let status = u32::from_ne_bytes([reply[4], reply[5], reply[6], reply[7]]);
            let rtt = u32::from_ne_bytes([reply[8], reply[9], reply[10], reply[11]]);
            if status == 0 {
                Some(rtt)
            } else {
                None
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = ip;
        None
    }
}

fn ping_one(ip: &str) -> Option<HostHit> {
    let ms = echo_once(ip)?;
    Some(HostHit {
        ip: ip.to_string(),
        name: None,
        ms: Some(ms),
        mac: None,
        kind: "other".into(),
        kind_label: "기타 장비".into(),
        rtsp: false,
    })
}

fn load_neighbor_table() -> HashMap<String, String> {
    let mut map = HashMap::new();
    #[cfg(windows)]
    {
        use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIpNetTable2, MIB_IPNET_ROW2, MIB_IPNET_TABLE2};
        use windows::Win32::Networking::WinSock::AF_INET;
        unsafe {
            let mut table = std::ptr::null_mut();
            if GetIpNetTable2(AF_INET, &mut table).is_err() || table.is_null() {
                return map;
            }
            let count = (*table).NumEntries as usize;
            let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), count);
            for row in rows {
                if let Some((ip, mac)) = neighbor_pair(row) {
                    map.insert(ip, mac);
                }
            }
            FreeMibTable(table as *const _);
            let _ = std::mem::size_of::<MIB_IPNET_TABLE2>();
            let _ = std::mem::size_of::<MIB_IPNET_ROW2>();
        }
    }
    map
}

#[cfg(windows)]
fn neighbor_pair(row: &windows::Win32::NetworkManagement::IpHelper::MIB_IPNET_ROW2) -> Option<(String, String)> {
    let v4 = unsafe { row.Address.Ipv4 };
    if v4.sin_family.0 != 2 {
        return None;
    }
    let raw = unsafe { v4.sin_addr.S_un.S_addr }.to_ne_bytes();
    let ip = Ipv4Addr::new(raw[0], raw[1], raw[2], raw[3]).to_string();
    let len = row.PhysicalAddressLength as usize;
    if len < 6 {
        return None;
    }
    let mac = row.PhysicalAddress[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join("-");
    Some((ip, mac))
}

fn active_prefixes() -> Vec<(u32, u8)> {
    active_adapters()
        .into_iter()
        .filter_map(|item| {
            let ip = parse_ipv4(&item.ip)?;
            let bits = item.mask.as_deref().and_then(mask_bits)?;
            Some((ip, bits))
        })
        .collect()
}

fn mask_bits(mask: &str) -> Option<u8> {
    let value = parse_ipv4(mask)?;
    if value == 0 || value.leading_zeros() + value.count_ones() != 32 {
        return None;
    }
    Some(value.count_ones() as u8)
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
            if let Some(name) = reverse_dns_name(&ip) {
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
    span_fits(start_n, end_n, &active_prefixes()).map_err(|msg| msg.to_string())?;
    let count = end_n - start_n + 1;

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
            if halt.load(Ordering::Relaxed) || wait_scan_gap(&halt) {
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

    let arp = load_neighbor_table();
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
    span_fits(start_n, end_n, &active_prefixes()).map_err(|msg| msg.to_string())?;
    let count = end_n - start_n + 1;

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
            if halt.load(Ordering::Relaxed) || wait_scan_gap(&halt) {
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

    let arp = load_neighbor_table();
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> u32 {
        parse_ipv4(text).unwrap()
    }

    #[test]
    fn same_private_prefix_is_accepted() {
        let nets = [(ip("192.168.1.20"), 24)];
        assert!(span_fits(ip("192.168.1.1"), ip("192.168.1.40"), &nets).is_ok());
    }

    #[test]
    fn other_private_public_and_wide_ranges_are_rejected() {
        let nets = [(ip("192.168.1.20"), 24)];
        assert!(span_fits(ip("10.0.0.1"), ip("10.0.0.8"), &nets).is_err());
        assert!(span_fits(ip("8.8.8.1"), ip("8.8.8.4"), &nets).is_err());
        assert!(span_fits(ip("192.168.1.0"), ip("192.168.2.0"), &nets).is_err());
        assert!(span_fits(ip("1.1.1.1"), ip("1.1.1.2"), &[(ip("1.1.1.10"), 24)]).is_err());
    }
}
