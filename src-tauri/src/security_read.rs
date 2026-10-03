//! 이 PC의 보안 상태를 읽기만 한다. 프로세스를 실행하지 않고, 설정을 바꾸지 않는다.

use crate::security_judge::{
    AvFact, AvItem, AvState, CivilDate, FwProfiles, LockFact, SigState, edition_group, family_from_build, ole_to_civil, parse_stamp,
    EditionGroup, OsFamily,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OsSnapshot {
    pub product: String,
    pub edition_id: String,
    pub display: String,
    pub build_text: String,
    pub family: Option<OsFamily>,
    pub group: EditionGroup,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AvSnapshot {
    pub fact: AvList,
    pub names: Vec<String>,
    pub third_party_firewall: bool,
    pub firewall_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AvList {
    Failed,
    Empty,
    Items(Vec<AvItem>),
}

impl AvList {
    pub fn as_fact(&self) -> AvFact<'_> {
        match self {
            AvList::Failed => AvFact::ReadFailed,
            AvList::Empty => AvFact::NoneRegistered,
            AvList::Items(items) => AvFact::Listed(items),
        }
    }
}

pub fn lock_from_values(
    policy: Result<Option<u32>, ()>,
    user_secure: Result<Option<u32>, ()>,
    saver_active: Result<Option<u32>, ()>,
) -> LockFact {
    if policy.is_err() {
        return LockFact::ReadFailed;
    }
    match policy.ok().flatten() {
        Some(1) => return LockFact::PolicyOn,
        Some(0) => return LockFact::PolicyOff,
        _ => {}
    }
    if user_secure.is_err() || saver_active.is_err() {
        return LockFact::ReadFailed;
    }
    let secure = user_secure.ok().flatten();
    let active = saver_active.ok().flatten();
    if secure == Some(1) && active != Some(0) {
        LockFact::UserOn
    } else {
        LockFact::Unset
    }
}

#[cfg(windows)]
pub fn read_os() -> OsSnapshot {
    let product = read_sz(Hkey::Machine, NT_VERSION, "ProductName").ok().flatten().unwrap_or_default();
    let edition_id = read_sz(Hkey::Machine, NT_VERSION, "EditionID").ok().flatten().unwrap_or_default();
    let display = read_sz(Hkey::Machine, NT_VERSION, "DisplayVersion").ok().flatten().unwrap_or_default();
    let build_number = read_sz(Hkey::Machine, NT_VERSION, "CurrentBuild").ok().flatten().unwrap_or_default();
    let ubr = read_dword(Hkey::Machine, NT_VERSION, "UBR").ok().flatten();
    let build_text = match (build_number.trim().is_empty(), ubr) {
        (true, _) => String::new(),
        (false, Some(value)) => format!("{}.{}", build_number.trim(), value),
        (false, None) => build_number.trim().to_string(),
    };
    let family = build_number.trim().parse::<u32>().ok().map(family_from_build);
    OsSnapshot {
        group: edition_group(&edition_id),
        product,
        edition_id,
        display,
        build_text,
        family,
    }
}

#[cfg(windows)]
pub fn read_registry_install() -> Option<CivilDate> {
    let text = read_sz(Hkey::Machine, UPDATE_INSTALL, "LastSuccessTime").ok().flatten()?;
    parse_stamp(&text)
}

#[cfg(windows)]
pub fn read_agent_install() -> Option<CivilDate> {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(query_history_date());
    });
    rx.recv_timeout(Duration::from_secs(10)).ok().flatten()
}

#[cfg(windows)]
pub fn read_products() -> AvSnapshot {
    match query_products() {
        Some(snapshot) => snapshot,
        None => AvSnapshot {
            fact: AvList::Failed,
            names: Vec::new(),
            third_party_firewall: false,
            firewall_names: Vec::new(),
        },
    }
}

#[cfg(windows)]
pub fn read_firewall() -> FwProfiles {
    query_firewall().unwrap_or(FwProfiles {
        domain: None,
        private_net: None,
        public_net: None,
    })
}

#[cfg(windows)]
pub fn read_lock() -> LockFact {
    let policy_machine = read_flag(Hkey::Machine, POLICY_DESKTOP, "ScreenSaverIsSecure");
    let policy_user = read_flag(Hkey::User, POLICY_DESKTOP, "ScreenSaverIsSecure");
    let policy = match (policy_machine, policy_user) {
        (Ok(Some(value)), _) | (Ok(None), Ok(Some(value))) => Ok(Some(value)),
        (Ok(None), Ok(None)) => Ok(None),
        (Err(()), _) | (_, Err(())) => Err(()),
    };
    let user_secure = read_flag(Hkey::User, USER_DESKTOP, "ScreenSaverIsSecure");
    let saver_active = read_flag(Hkey::User, USER_DESKTOP, "ScreenSaveActive");
    lock_from_values(policy, user_secure, saver_active)
}

#[cfg(windows)]
pub fn read_share_names() -> Option<Vec<String>> {
    query_shares()
}

#[cfg(windows)]
const NT_VERSION: &str = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
#[cfg(windows)]
const UPDATE_INSTALL: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\Results\\Install";
#[cfg(windows)]
const POLICY_DESKTOP: &str = "SOFTWARE\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop";
#[cfg(windows)]
const USER_DESKTOP: &str = "Control Panel\\Desktop";

#[cfg(windows)]
#[derive(Clone, Copy)]
enum Hkey {
    Machine,
    User,
}

#[cfg(windows)]
fn read_flag(root: Hkey, sub: &str, name: &str) -> Result<Option<u32>, ()> {
    match read_sz(root, sub, name) {
        Ok(Some(text)) => match text.trim() {
            "0" => Ok(Some(0)),
            "1" => Ok(Some(1)),
            "" => Ok(None),
            _ => Ok(None),
        },
        Ok(None) => read_dword(root, sub, name),
        Err(()) => match read_dword(root, sub, name) {
            Ok(value) => Ok(value),
            Err(()) => Err(()),
        },
    }
}

#[cfg(windows)]
fn read_sz(root: Hkey, sub: &str, name: &str) -> Result<Option<String>, ()> {
    use std::ffi::OsStr;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND};
    use windows::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let sub_wide = wide(sub);
    let name_wide = wide_os(OsStr::new(name));
    let mut buffer = [0u16; 128];
    let mut size = (buffer.len() * 2) as u32;
    let status = unsafe {
        RegGetValueW(
            root_key(root),
            windows_core::PCWSTR(sub_wide.as_ptr()),
            windows_core::PCWSTR(name_wide.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
    };
    if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
        return Ok(None);
    }
    if status.is_err() {
        return Err(());
    }
    let chars = (size as usize / 2).saturating_sub(1).min(buffer.len());
    let text = String::from_utf16_lossy(&buffer[..chars]).trim().to_string();
    if text.is_empty() {
        Ok(None)
    } else {
        Ok(Some(text.chars().take(120).collect()))
    }
}

#[cfg(windows)]
fn read_dword(root: Hkey, sub: &str, name: &str) -> Result<Option<u32>, ()> {
    use std::ffi::OsStr;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND};
    use windows::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_DWORD};
    let sub_wide = wide(sub);
    let name_wide = wide_os(OsStr::new(name));
    let mut data = 0u32;
    let mut size = 4u32;
    let status = unsafe {
        RegGetValueW(
            root_key(root),
            windows_core::PCWSTR(sub_wide.as_ptr()),
            windows_core::PCWSTR(name_wide.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
        return Ok(None);
    }
    if status.is_err() {
        return Err(());
    }
    Ok(Some(data))
}

#[cfg(windows)]
fn root_key(root: Hkey) -> windows::Win32::System::Registry::HKEY {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    match root {
        Hkey::Machine => HKEY_LOCAL_MACHINE,
        Hkey::User => HKEY_CURRENT_USER,
    }
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    wide_os(OsStr::new(text))
}

#[cfg(windows)]
fn wide_os(text: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    text.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn query_history_date() -> Option<CivilDate> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::UpdateAgent::{
        IUpdateSession, UpdateSession, orcSucceeded, orcSucceededWithErrors, uoInstallation,
    };
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let session: IUpdateSession = CoCreateInstance(&UpdateSession, None, CLSCTX_INPROC_SERVER).ok()?;
        let searcher = session.CreateUpdateSearcher().ok()?;
        let total = searcher.GetTotalHistoryCount().unwrap_or(0);
        if total <= 0 {
            return None;
        }
        let count = total.min(40);
        let history = searcher.QueryHistory(0, count).ok()?;
        let rows = history.Count().unwrap_or(0).min(count);
        let mut best: Option<CivilDate> = None;
        for index in 0..rows {
            let entry = match history.get_Item(index) {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            let operation = entry.Operation().unwrap_or_default();
            let code = entry.ResultCode().unwrap_or_default();
            if operation != uoInstallation {
                continue;
            }
            if code != orcSucceeded && code != orcSucceededWithErrors {
                continue;
            }
            let Some(day) = entry.Date().ok().and_then(ole_to_civil) else {
                continue;
            };
            best = Some(match best {
                Some(previous) if previous >= day => previous,
                _ => day,
            });
        }
        best
    }
}

#[cfg(windows)]
fn query_products() -> Option<AvSnapshot> {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::SecurityCenter::{WSC_SECURITY_PROVIDER_ANTIVIRUS, WSC_SECURITY_PROVIDER_FIREWALL};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let antivirus = read_provider(WSC_SECURITY_PROVIDER_ANTIVIRUS, true)?;
        let firewall = read_provider(WSC_SECURITY_PROVIDER_FIREWALL, false).unwrap_or(ProviderRows {
            items: Vec::new(),
            names: Vec::new(),
        });
        let third_party_firewall = firewall
            .names
            .iter()
            .zip(firewall.items.iter())
            .any(|(name, item)| item.state == AvState::On && !windows_firewall_name(name));
        Some(AvSnapshot {
            fact: if antivirus.items.is_empty() { AvList::Empty } else { AvList::Items(antivirus.items) },
            names: antivirus.names,
            third_party_firewall,
            firewall_names: firewall.names,
        })
    }
}

#[cfg(windows)]
fn windows_firewall_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let windows = lower.contains("windows") || name.contains("윈도우");
    let wall = lower.contains("firewall") || lower.contains("defender") || name.contains("방화벽");
    windows && wall
}

#[cfg(windows)]
struct ProviderRows {
    items: Vec<AvItem>,
    names: Vec<String>,
}

#[cfg(windows)]
fn read_provider(provider: windows::Win32::System::SecurityCenter::WSC_SECURITY_PROVIDER, keep_state: bool) -> Option<ProviderRows> {
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::SecurityCenter::{
        IWSCProductList, WSCProductList, WSC_SECURITY_PRODUCT_STATE_OFF, WSC_SECURITY_PRODUCT_STATE_ON,
        WSC_SECURITY_PRODUCT_UP_TO_DATE,
    };
    unsafe {
        let list: IWSCProductList = CoCreateInstance(&WSCProductList, None, CLSCTX_INPROC_SERVER).ok()?;
        list.Initialize(provider).ok()?;
        let count = list.Count().ok()?.max(0).min(12);
        let mut items = Vec::new();
        let mut names = Vec::new();
        for index in 0..count as u32 {
            let Ok(product) = list.get_Item(index) else {
                continue;
            };
            let name = product.ProductName().ok().map(|value| clip_bstr(&value)).unwrap_or_default();
            names.push(name);
            if !keep_state {
                let state = product.ProductState().ok();
                items.push(AvItem {
                    state: if state == Some(WSC_SECURITY_PRODUCT_STATE_ON) {
                        AvState::On
                    } else {
                        AvState::Off
                    },
                    signature: SigState::Unknown,
                });
                continue;
            }
            let state = match product.ProductState().ok() {
                Some(value) if value == WSC_SECURITY_PRODUCT_STATE_ON => AvState::On,
                Some(value) if value == WSC_SECURITY_PRODUCT_STATE_OFF => AvState::Off,
                Some(_) => AvState::Other,
                None => AvState::Other,
            };
            let signature = match product.SignatureStatus().ok() {
                Some(value) if value == WSC_SECURITY_PRODUCT_UP_TO_DATE => SigState::Fresh,
                Some(_) => SigState::Stale,
                None => SigState::Unknown,
            };
            items.push(AvItem { state, signature });
        }
        Some(ProviderRows { items, names })
    }
}

#[cfg(windows)]
fn query_firewall() -> Option<FwProfiles> {
    use windows::Win32::NetworkManagement::WindowsFirewall::{
        INetFwPolicy2, NetFwPolicy2, NET_FW_PROFILE2_DOMAIN, NET_FW_PROFILE2_PRIVATE, NET_FW_PROFILE2_PUBLIC,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let policy: INetFwPolicy2 = CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER).ok()?;
        Some(FwProfiles {
            domain: policy.get_FirewallEnabled(NET_FW_PROFILE2_DOMAIN).ok().map(|value| value.as_bool()),
            private_net: policy.get_FirewallEnabled(NET_FW_PROFILE2_PRIVATE).ok().map(|value| value.as_bool()),
            public_net: policy.get_FirewallEnabled(NET_FW_PROFILE2_PUBLIC).ok().map(|value| value.as_bool()),
        })
    }
}

#[cfg(windows)]
fn query_shares() -> Option<Vec<String>> {
    use windows::Win32::NetworkManagement::NetManagement::NetApiBufferFree;
    use windows::Win32::Storage::FileSystem::{NetShareEnum, SHARE_INFO_1};
    unsafe {
        let mut names = Vec::new();
        let mut resume = 0u32;
        for _ in 0..8 {
            let mut buf: *mut u8 = std::ptr::null_mut();
            let mut read = 0u32;
            let mut total = 0u32;
            let code = NetShareEnum(
                windows_core::PCWSTR::null(),
                1,
                &mut buf,
                0xFFFF_FFFF,
                &mut read,
                &mut total,
                Some(&mut resume),
            );
            if !buf.is_null() {
                let rows = std::slice::from_raw_parts(buf as *const SHARE_INFO_1, read as usize);
                for row in rows {
                    if let Some(name) = share_name(row) {
                        names.push(name);
                    }
                }
                let _ = NetApiBufferFree(Some(buf as *const _));
            }
            if code == 0 {
                return Some(names);
            }
            if code != 234 || buf.is_null() {
                return None;
            }
        }
        Some(names)
    }
}

#[cfg(windows)]
fn share_name(row: &windows::Win32::Storage::FileSystem::SHARE_INFO_1) -> Option<String> {
    let kind = row.shi1_type.0;
    if kind & 0x8000_0000 != 0 || kind & 0x0FFF_FFFF != 0 {
        return None;
    }
    let raw = row.shi1_netname.0;
    if raw.is_null() {
        return None;
    }
    let mut len = 0usize;
    unsafe {
        while len < 80 && *raw.add(len) != 0 {
            len += 1;
        }
        let name = String::from_utf16_lossy(std::slice::from_raw_parts(raw, len)).trim().to_string();
        if name.is_empty() || name.ends_with('$') {
            return None;
        }
        let lower = name.to_ascii_lowercase();
        if lower == "print$" {
            return None;
        }
        Some(name.chars().take(80).collect())
    }
}

#[cfg(windows)]
fn clip_bstr(value: &windows_core::BSTR) -> String {
    let text = value.to_string();
    text.trim().chars().take(80).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_value_cases() {
        assert_eq!(lock_from_values(Ok(Some(1)), Ok(Some(0)), Ok(Some(0))), LockFact::PolicyOn);
        assert_eq!(lock_from_values(Ok(Some(0)), Ok(Some(1)), Ok(Some(1))), LockFact::PolicyOff);
        assert_eq!(lock_from_values(Ok(None), Ok(Some(1)), Ok(Some(1))), LockFact::UserOn);
        assert_eq!(lock_from_values(Ok(None), Ok(None), Ok(None)), LockFact::Unset);
        assert_eq!(lock_from_values(Ok(None), Ok(Some(1)), Ok(Some(0))), LockFact::Unset);
        assert_eq!(lock_from_values(Err(()), Ok(Some(1)), Ok(Some(1))), LockFact::ReadFailed);
    }

    #[test]
    fn read_module_does_not_start_a_process() {
        let source = include_str!("security_read.rs");
        let body = source.split("mod tests").next().unwrap_or(source);
        assert!(!body.contains("process::Command"));
        assert!(!body.contains("powershell"));
        assert!(!body.contains("cmd.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn this_pc_update_date_source() {
        let registry = read_registry_install();
        let agent = read_agent_install();
        eprintln!("security-update registry={registry:?} agent={agent:?}");
        let _ = (registry, agent);
    }
}
