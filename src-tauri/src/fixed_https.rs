//! 고정된 https 주소의 본문만 읽는다. 요청 본문은 없고, 응답은 길이 제한을 넘기면 버린다.

const BODY_CAP: usize = 64 * 1024;
const WAIT_MS: i32 = 5_000;

#[derive(Debug)]
pub enum ReadStop {
    Rejected,
    Failed,
    TooLarge,
}

pub fn read_https(url: &str) -> Result<String, ReadStop> {
    let (host, path) = split_https(url).ok_or(ReadStop::Rejected)?;
    read_host(&host, &path)
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
fn read_host(host: &str, path: &str) -> Result<String, ReadStop> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpReadData, WinHttpReceiveResponse,
        WinHttpSendRequest, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE,
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
        if WinHttpSetTimeouts(session.0, WAIT_MS, WAIT_MS, WAIT_MS, WAIT_MS).is_err() {
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
        if WinHttpSendRequest(request.0, None, None, 0, 0, 0).is_err() {
            return Err(ReadStop::Failed);
        }
        if WinHttpReceiveResponse(request.0, std::ptr::null_mut()).is_err() {
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
            if body.len().saturating_add(chunk) > BODY_CAP {
                return Err(ReadStop::TooLarge);
            }
            body.extend_from_slice(&buf[..chunk]);
        }
        String::from_utf8(body).map_err(|_| ReadStop::Failed)
    }
}

#[cfg(not(windows))]
fn read_host(_host: &str, _path: &str) -> Result<String, ReadStop> {
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
}
