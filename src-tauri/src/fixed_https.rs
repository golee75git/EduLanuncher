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

#[cfg(windows)]
fn read_host(host: &str, path: &str, body_cap: usize, wait_ms: i32) -> Result<Vec<u8>, ReadStop> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData,
        WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetOption, WinHttpSetTimeouts,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_OPTION_REDIRECT_POLICY,
        WINHTTP_OPTION_REDIRECT_POLICY_NEVER, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
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
        if !http_status_kept(status) {
            return Err(ReadStop::Failed);
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
        Ok(body)
    }
}

#[cfg(not(windows))]
fn read_host(_host: &str, _path: &str, _body_cap: usize, _wait_ms: i32) -> Result<Vec<u8>, ReadStop> {
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
    fn keeps_only_status_200() {
        assert!(super::http_status_kept(200));
        assert!(!super::http_status_kept(301));
        assert!(!super::http_status_kept(302));
        assert!(!super::http_status_kept(404));
        assert!(!super::http_status_kept(500));
    }
}
