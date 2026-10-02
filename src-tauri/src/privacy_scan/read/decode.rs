#[cfg(windows)]
pub fn decode_bytes(bytes: &[u8]) -> Result<String, ()> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(text.to_string());
    }
    decode_cp949(bytes)
}

#[cfg(not(windows))]
pub fn decode_bytes(bytes: &[u8]) -> Result<String, ()> {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    std::str::from_utf8(bytes).map(|text| text.to_string()).map_err(|_| ())
}

#[cfg(windows)]
fn decode_cp949(bytes: &[u8]) -> Result<String, ()> {
    use windows::Win32::Globalization::{MultiByteToWideChar, MB_ERR_INVALID_CHARS};
    if bytes.is_empty() {
        return Ok(String::new());
    }
    unsafe {
        let needed = MultiByteToWideChar(949, MB_ERR_INVALID_CHARS, bytes, None);
        if needed <= 0 {
            return Err(());
        }
        let mut wide = vec![0u16; needed as usize];
        let wrote = MultiByteToWideChar(949, MB_ERR_INVALID_CHARS, bytes, Some(&mut wide));
        if wrote <= 0 {
            return Err(());
        }
        wide.truncate(wrote as usize);
        String::from_utf16(&wide).map_err(|_| ())
    }
}
