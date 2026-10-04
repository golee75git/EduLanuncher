//! 이 PC의 127.0.0.1 로만 HTTP 요청을 보낸다. 본문과 응답은 로그에 남기지 않는다.

pub const REPLY_CAP: usize = 256 * 1024;
pub const ASK_CAP: usize = 64 * 1024;
pub const DEFAULT_PORT: u16 = 11434;
pub const DEFAULT_WAIT_MS: i32 = 90_000;

const HOST: &str = "127.0.0.1";

#[derive(Debug, PartialEq, Eq)]
pub enum LoopStop {
    Rejected,
    Failed,
    TimedOut,
    Redirected,
    TooLarge,
}

pub fn host_allowed(host: &str) -> bool {
    host == HOST
}

pub fn exchange(host: &str, port: u16, method: &str, path: &str, body: &[u8], reply_cap: usize, wait_ms: i32) -> Result<Vec<u8>, LoopStop> {
    if !host_allowed(host) || host.contains('@') || host.contains(' ') {
        return Err(LoopStop::Rejected);
    }
    if port == 0 || wait_ms <= 0 {
        return Err(LoopStop::Rejected);
    }
    if !path_allowed(path) || method != "GET" && method != "POST" {
        return Err(LoopStop::Rejected);
    }
    if body.len() > ASK_CAP {
        return Err(LoopStop::TooLarge);
    }
    #[cfg(windows)]
    {
        post_winhttp(port, method, path, body, reply_cap, wait_ms)
    }
    #[cfg(not(windows))]
    {
        let _ = (port, method, path, body, reply_cap, wait_ms);
        Err(LoopStop::Failed)
    }
}

fn path_allowed(path: &str) -> bool {
    path == "/v1/chat/completions" || path == "/api/tags"
}

#[cfg(windows)]
fn post_winhttp(port: u16, method: &str, path: &str, body: &[u8], reply_cap: usize, wait_ms: i32) -> Result<Vec<u8>, LoopStop> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use windows::core::PCWSTR;
    use windows::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData,
        WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetOption, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_NO_PROXY,
        WINHTTP_OPTION_RECEIVE_TIMEOUT, WINHTTP_OPTION_REDIRECT_POLICY, WINHTTP_OPTION_REDIRECT_POLICY_NEVER, WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_QUERY_STATUS_CODE,
    };

    struct HandleClose {
        ptr: *mut core::ffi::c_void,
        closed: Arc<AtomicBool>,
    }
    impl Drop for HandleClose {
        fn drop(&mut self) {
            if self.ptr.is_null() {
                return;
            }
            if !self.closed.swap(true, Ordering::AcqRel) {
                unsafe {
                    let _ = WinHttpCloseHandle(self.ptr);
                }
            }
            self.ptr = std::ptr::null_mut();
        }
    }
    struct Finish(Option<mpsc::Sender<()>>);
    impl Drop for Finish {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let agent = wide("EduLauncher");
        let session = HandleClose {
            ptr: WinHttpOpen(PCWSTR(agent.as_ptr()), WINHTTP_ACCESS_TYPE_NO_PROXY, PCWSTR::null(), PCWSTR::null(), 0),
            closed: Arc::new(AtomicBool::new(false)),
        };
        if session.ptr.is_null() {
            return Err(LoopStop::Failed);
        }
        if WinHttpSetTimeouts(session.ptr, 0, wait_ms, wait_ms, wait_ms).is_err() {
            return Err(LoopStop::Failed);
        }
        let host_w = wide(HOST);
        let connect = HandleClose {
            ptr: WinHttpConnect(session.ptr, PCWSTR(host_w.as_ptr()), port, 0),
            closed: Arc::new(AtomicBool::new(false)),
        };
        if connect.ptr.is_null() {
            return Err(map_wait());
        }
        let verb = wide(method);
        let path_w = wide(path);
        let closed = Arc::new(AtomicBool::new(false));
        let request = HandleClose {
            ptr: WinHttpOpenRequest(
                connect.ptr,
                PCWSTR(verb.as_ptr()),
                PCWSTR(path_w.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                std::ptr::null(),
                windows::Win32::Networking::WinHttp::WINHTTP_OPEN_REQUEST_FLAGS(0),
            ),
            closed: closed.clone(),
        };
        if request.ptr.is_null() {
            return Err(LoopStop::Failed);
        }
        if WinHttpSetTimeouts(request.ptr, 0, wait_ms, wait_ms, wait_ms).is_err() {
            return Err(LoopStop::Failed);
        }
        let wait_bytes = wait_ms.to_le_bytes();
        if WinHttpSetOption(Some(request.ptr.cast()), WINHTTP_OPTION_RECEIVE_TIMEOUT, Some(&wait_bytes)).is_err() {
            return Err(LoopStop::Failed);
        }
        let started = Instant::now();
        let slot = Arc::new(AtomicPtr::new(request.ptr));
        let (done_tx, done_rx) = mpsc::channel();
        let watch = slot.clone();
        let _slot = slot;
        let watch_closed = closed.clone();
        let wait = wait_ms.max(0) as u64;
        std::thread::spawn(move || {
            if done_rx.recv_timeout(Duration::from_millis(wait)) == Err(RecvTimeoutError::Timeout) && !watch_closed.swap(true, Ordering::AcqRel) {
                let ptr = watch.load(Ordering::Acquire);
                if !ptr.is_null() {
                    let _ = WinHttpCloseHandle(ptr);
                }
            }
        });
        let _finish = Finish(Some(done_tx));
        let policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER.to_le_bytes();
        if WinHttpSetOption(Some(request.ptr.cast()), WINHTTP_OPTION_REDIRECT_POLICY, Some(&policy)).is_err() {
            return Err(stop_or_time(&closed, started, wait_ms));
        }
        let headers: Vec<u16> = OsStr::new("Content-Type: application/json\r\n").encode_wide().collect();
        let sent = if body.is_empty() {
            WinHttpSendRequest(request.ptr, Some(&headers), None, 0, 0, 0)
        } else {
            WinHttpSendRequest(
                request.ptr,
                Some(&headers),
                Some(body.as_ptr().cast()),
                body.len() as u32,
                body.len() as u32,
                0,
            )
        };
        if sent.is_err() {
            return Err(stop_or_time(&closed, started, wait_ms));
        }
        if WinHttpReceiveResponse(request.ptr, std::ptr::null_mut()).is_err() {
            return Err(stop_or_time(&closed, started, wait_ms));
        }
        let mut status = 0u32;
        let mut status_len = std::mem::size_of::<u32>() as u32;
        let mut status_index = 0u32;
        if WinHttpQueryHeaders(
            request.ptr,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            PCWSTR::null(),
            Some((&mut status as *mut u32).cast()),
            &mut status_len,
            &mut status_index,
        )
        .is_err()
        {
            return Err(LoopStop::Failed);
        }
        if (300..400).contains(&status) {
            return Err(LoopStop::Redirected);
        }
        if status != 200 {
            return Err(LoopStop::Failed);
        }
        let mut reply = Vec::new();
        loop {
            let mut buf = [0u8; 4096];
            let mut read = 0u32;
            if WinHttpReadData(request.ptr, buf.as_mut_ptr().cast(), buf.len() as u32, &mut read).is_err() {
                return Err(stop_or_time(&closed, started, wait_ms));
            }
            if read == 0 {
                break;
            }
            let chunk = read as usize;
            if reply.len().saturating_add(chunk) > reply_cap {
                return Err(LoopStop::TooLarge);
            }
            reply.extend_from_slice(&buf[..chunk]);
        }
        Ok(reply)
    }
}

#[cfg(windows)]
fn stop_or_time(closed: &std::sync::atomic::AtomicBool, started: std::time::Instant, wait_ms: i32) -> LoopStop {
    use std::sync::atomic::Ordering;
    use std::time::Duration;
    if closed.load(Ordering::Acquire) || started.elapsed() >= Duration::from_millis(wait_ms.max(0) as u64) {
        LoopStop::TimedOut
    } else {
        map_wait()
    }
}

#[cfg(windows)]
fn map_wait() -> LoopStop {
    use windows::Win32::Foundation::GetLastError;
    use windows::Win32::Networking::WinHttp::ERROR_WINHTTP_TIMEOUT;
    let code = unsafe { GetLastError() };
    if code.0 == ERROR_WINHTTP_TIMEOUT {
        LoopStop::TimedOut
    } else {
        LoopStop::Failed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    fn serve(reply: &'static [u8]) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let _ = sock.read(&mut buf);
            let _ = sock.write_all(reply);
        });
        port
    }

    #[test]
    fn default_port_matches_the_usual_local_model_port() {
        assert_eq!(DEFAULT_PORT, 11434);
        assert_eq!(DEFAULT_WAIT_MS, 90_000);
        assert_eq!(REPLY_CAP, 256 * 1024);
    }

    #[test]
    fn rejects_other_hosts() {
        for host in ["localhost", "10.0.0.8", "8.8.8.8", "user@127.0.0.1", "127.0.0.1:11434"] {
            let result = exchange(host, 9, "GET", "/api/tags", b"", 32, 500);
            assert!(matches!(result, Err(LoopStop::Rejected)), "{host} {result:?}");
        }
    }

    #[test]
    fn reads_a_local_json_reply() {
        let port = serve(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
        let body = exchange(HOST, port, "POST", "/v1/chat/completions", b"{}", REPLY_CAP, 3_000).unwrap();
        assert_eq!(body, b"{}");
    }

    #[test]
    fn refuses_a_redirect() {
        let port = serve(b"HTTP/1.1 302 Found\r\nLocation: http://10.1.1.1/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let result = exchange(HOST, port, "GET", "/api/tags", b"", REPLY_CAP, 3_000);
        assert!(matches!(result, Err(LoopStop::Redirected)), "{result:?}");
    }

    #[test]
    fn stops_when_the_reply_is_too_large() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf);
            let _ = sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 400000\r\nConnection: close\r\n\r\n");
            let chunk = vec![b'a'; 8192];
            for _ in 0..40 {
                if sock.write_all(&chunk).is_err() {
                    break;
                }
            }
        });
        let result = exchange(HOST, port, "GET", "/api/tags", b"", 1024, 3_000);
        assert!(matches!(result, Err(LoopStop::TooLarge)), "{result:?}");
    }

    #[test]
    fn times_out_when_the_peer_stays_quiet() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_secs(3));
            let _ = sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        });
        let result = exchange(HOST, port, "GET", "/api/tags", b"", REPLY_CAP, 400);
        assert!(matches!(result, Err(LoopStop::TimedOut)), "{result:?}");
    }
}
