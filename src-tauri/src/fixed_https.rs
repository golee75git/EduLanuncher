//! 고정된 https 주소의 본문만 읽는다. 요청 본문은 없고, 응답은 길이 제한을 넘기면 버린다.

pub const LEGACY_BODY_CAP: usize = 64 * 1024;
pub const LEGACY_WAIT_MS: i32 = 5_000;

#[derive(Debug)]
pub enum ReadStop {
    Rejected,
    Failed,
    TooLarge,
}

pub fn read_https(url: &str) -> Result<String, ReadStop> {
    let bytes = read_https_bytes(url, LEGACY_BODY_CAP, LEGACY_WAIT_MS)?;
    String::from_utf8(bytes).map_err(|_| ReadStop::Failed)
}

pub fn read_https_bytes(url: &str, body_cap: usize, wait_ms: i32) -> Result<Vec<u8>, ReadStop> {
    let (host, path) = split_https(url).ok_or(ReadStop::Rejected)?;
    read_host(&host, &path, body_cap, wait_ms)
}

pub fn http_status_kept(code: u32) -> bool {
    code == 200
}

fn split_https(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("https://")?;
    if rest.is_empty() || rest.contains('@') || rest.contains(' ') {
        return None;
    }
    let (hostport, path) = match rest.split_once('/') {
        Some((hostport, path)) => (hostport, format!("/{path}")),
        None => (rest, "/".to_string()),
    };
    if hostport.is_empty() {
        return None;
    }
    let host = if let Some((host, port)) = hostport.rsplit_once(':') {
        if port != "443" {
            return None;
        }
        host
    } else {
        hostport
    };
    if host.is_empty() || host.contains(':') {
        return None;
    }
    Some((host.to_string(), path))
}

const SETUP_BODY_CAP: usize = 16 * 1024 * 1024;
const SETUP_WAIT_MS: i32 = 60_000;

pub fn read_release_setup(tag: &str) -> Result<Vec<u8>, ReadStop> {
    let path = setup_path(tag).ok_or(ReadStop::Rejected)?;
    let first = exchange("github.com", &path, SETUP_BODY_CAP, SETUP_WAIT_MS)?;
    if http_status_kept(first.status) {
        return setup_bytes(first.body);
    }
    if !matches!(first.status, 301 | 302 | 303 | 307 | 308) {
        return Err(ReadStop::Failed);
    }
    let (host, next) = asset_hop(&first.location).ok_or(ReadStop::Rejected)?;
    let second = exchange(&host, &next, SETUP_BODY_CAP, SETUP_WAIT_MS)?;
    if !http_status_kept(second.status) {
        return Err(ReadStop::Failed);
    }
    setup_bytes(second.body)
}

fn release_tag_ok(tag: &str) -> bool {
    let Some((ver, day)) = tag.split_once('-') else {
        return false;
    };
    if tag.matches('-').count() != 1 || day.len() != 8 || !day.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let mut parts = ver.split('.');
    let Some(major) = parts.next() else {
        return false;
    };
    let Some(minor) = parts.next() else {
        return false;
    };
    let Some(patch) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && [major, minor, patch].iter().all(|part| {
            !part.is_empty() && part.len() <= 4 && part.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn setup_path(tag: &str) -> Option<String> {
    if !release_tag_ok(tag) {
        return None;
    }
    Some(format!(
        "/golee75git/EduLanuncher/releases/download/{tag}/AILauncher_{tag}_x64-setup.exe"
    ))
}

fn asset_hop(location: &str) -> Option<(String, String)> {
    if location.len() > 2048 || location.contains('\n') || location.contains('\r') {
        return None;
    }
    let (host, path) = split_https(location)?;
    if !host.eq_ignore_ascii_case("release-assets.githubusercontent.com") || path.contains("..") || path.contains('\\') {
        return None;
    }
    Some((host, path))
}

fn setup_bytes(body: Vec<u8>) -> Result<Vec<u8>, ReadStop> {
    if body.len() < 64 * 1024 || body.len() > SETUP_BODY_CAP || body.get(..2) != Some(b"MZ".as_slice()) {
        return Err(ReadStop::Rejected);
    }
    Ok(body)
}

struct HostReply {
    status: u32,
    location: String,
    body: Vec<u8>,
}

#[cfg(windows)]
fn read_host(host: &str, path: &str, body_cap: usize, wait_ms: i32) -> Result<Vec<u8>, ReadStop> {
    let reply = exchange(host, path, body_cap, wait_ms)?;
    if !http_status_kept(reply.status) {
        return Err(ReadStop::Failed);
    }
    Ok(reply.body)
}

#[cfg(windows)]
fn exchange(host: &str, path: &str, body_cap: usize, wait_ms: i32) -> Result<HostReply, ReadStop> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData,
        WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetOption, WinHttpSetTimeouts,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_OPTION_REDIRECT_POLICY,
        WINHTTP_OPTION_REDIRECT_POLICY_NEVER, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_LOCATION,
        WINHTTP_QUERY_STATUS_CODE,
    };

    struct HandleClose(*mut core::ffi::c_void);
    impl Drop for HandleClose {
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
        let agent = wide("EduLauncher");
        let session = HandleClose(WinHttpOpen(
            PCWSTR(agent.as_ptr()),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            PCWSTR::null(),
            PCWSTR::null(),
            0,
        ));
        if session.0.is_null() {
            return Err(ReadStop::Failed);
        }
        if WinHttpSetTimeouts(session.0, wait_ms, wait_ms, wait_ms, wait_ms).is_err() {
            return Err(ReadStop::Failed);
        }
        let host_w = wide(host);
        let connect = HandleClose(WinHttpConnect(session.0, PCWSTR(host_w.as_ptr()), 443, 0));
        if connect.0.is_null() {
            return Err(ReadStop::Failed);
        }
        let verb = wide("GET");
        let path_w = wide(path);
        let request = HandleClose(WinHttpOpenRequest(
            connect.0,
            PCWSTR(verb.as_ptr()),
            PCWSTR(path_w.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            std::ptr::null(),
            WINHTTP_FLAG_SECURE,
        ));
        if request.0.is_null() {
            return Err(ReadStop::Failed);
        }
        let policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER.to_le_bytes();
        if WinHttpSetOption(
            Some(request.0.cast()),
            WINHTTP_OPTION_REDIRECT_POLICY,
            Some(&policy),
        )
        .is_err()
        {
            return Err(ReadStop::Failed);
        }
        if WinHttpSendRequest(request.0, None, None, 0, 0, 0).is_err() {
            return Err(ReadStop::Failed);
        }
        if WinHttpReceiveResponse(request.0, std::ptr::null_mut()).is_err() {
            return Err(ReadStop::Failed);
        }
        let mut status = 0u32;
        let mut status_len = std::mem::size_of::<u32>() as u32;
        let mut status_index = 0u32;
        if WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            PCWSTR::null(),
            Some((&mut status as *mut u32).cast()),
            &mut status_len,
            &mut status_index,
        )
        .is_err()
        {
            return Err(ReadStop::Failed);
        }
        let location = header_text(request.0, WINHTTP_QUERY_LOCATION);
        if !http_status_kept(status) {
            return Ok(HostReply {
                status,
                location,
                body: Vec::new(),
            });
        }
        let mut body = Vec::new();
        loop {
            let mut buf = [0u8; 4096];
            let mut read = 0u32;
            if WinHttpReadData(request.0, buf.as_mut_ptr() as *mut _, buf.len() as u32, &mut read).is_err() {
                return Err(ReadStop::Failed);
            }
            if read == 0 {
                break;
            }
            let chunk = read as usize;
            if body.len().saturating_add(chunk) > body_cap {
                return Err(ReadStop::TooLarge);
            }
            body.extend_from_slice(&buf[..chunk]);
        }
        Ok(HostReply {
            status,
            location,
            body,
        })
    }
}

#[cfg(windows)]
fn header_text(request: *mut core::ffi::c_void, query: u32) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::Networking::WinHttp::WinHttpQueryHeaders;

    let mut buf = vec![0u16; 2048];
    let mut len = (buf.len() * 2) as u32;
    let mut index = 0u32;
    let ok = unsafe {
        WinHttpQueryHeaders(
            request,
            query,
            PCWSTR::null(),
            Some(buf.as_mut_ptr().cast()),
            &mut len,
            &mut index,
        )
    };
    if ok.is_err() || len < 2 {
        return String::new();
    }
    let chars = (len as usize) / 2;
    let end = buf.iter().position(|unit| *unit == 0).unwrap_or(chars.min(buf.len()));
    String::from_utf16_lossy(&buf[..end]).trim().to_string()
}

#[cfg(not(windows))]
fn read_host(_host: &str, _path: &str, _body_cap: usize, _wait_ms: i32) -> Result<Vec<u8>, ReadStop> {
    Err(ReadStop::Failed)
}

#[cfg(not(windows))]
fn exchange(_host: &str, _path: &str, _body_cap: usize, _wait_ms: i32) -> Result<HostReply, ReadStop> {
    Err(ReadStop::Failed)
}

#[cfg(test)]
mod tests {
    use super::{read_https, ReadStop};

    #[test]
    fn rejects_non_https() {
        assert!(matches!(read_https("http://api.ipify.org"), Err(ReadStop::Rejected)));
        assert!(matches!(read_https("https://user:pass@api.ipify.org"), Err(ReadStop::Rejected)));
        assert!(matches!(read_https("https://api.ipify.org:80"), Err(ReadStop::Rejected)));
        assert!(matches!(read_https("https://"), Err(ReadStop::Rejected)));
    }

    #[test]
    fn legacy_endpoints_still_answer() {
        let release = read_https("https://api.github.com/repos/golee75git/EduLanuncher/releases/latest");
        assert!(release.is_ok(), "{release:?}");
        let ip = read_https("https://api.ipify.org");
        assert!(ip.is_ok(), "{ip:?}");
    }

    #[test]
    fn release_setup_path_stays_on_the_known_file() {
        assert_eq!(
            super::setup_path("0.1.227-20261122").as_deref(),
            Some("/golee75git/EduLanuncher/releases/download/0.1.227-20261122/AILauncher_0.1.227-20261122_x64-setup.exe")
        );
        assert!(super::setup_path("0.1.227-20261122/../other").is_none());
        assert!(super::setup_path("latest").is_none());
        assert!(super::asset_hop("https://github.com/golee75git/EduLanuncher/releases/download/0.1.227-20261122/file.exe").is_none());
        assert!(super::asset_hop("http://release-assets.githubusercontent.com/file").is_none());
        assert!(super::asset_hop("https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=abc").is_some());
        assert!(super::asset_hop("https://user@release-assets.githubusercontent.com/file").is_none());
    }

    #[test]
    fn keeps_only_status_200() {
        assert!(super::http_status_kept(200));
        assert!(!super::http_status_kept(301));
        assert!(!super::http_status_kept(302));
        assert!(!super::http_status_kept(404));
        assert!(!super::http_status_kept(500));
    }
}
