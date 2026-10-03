use std::fs;
use std::path::Path;
#[cfg(not(windows))]
use std::path::PathBuf;

const FILE_NAME: &str = "doc-index.key";
const KEY_LEN: usize = 32;

pub struct IndexKey {
    bytes: [u8; KEY_LEN],
}

impl IndexKey {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

impl Drop for IndexKey {
    fn drop(&mut self) {
        for byte in &mut self.bytes {
            *byte = 0;
        }
    }
}

pub enum OpenedKey {
    Same(IndexKey),
    Rebuilt(IndexKey),
}

pub fn read_dir(dir: &Path) -> Option<IndexKey> {
    unseal(&dir.join(FILE_NAME))
}

pub fn open_dir(dir: &Path) -> Result<OpenedKey, String> {
    fs::create_dir_all(dir).map_err(|_| "색인 키를 준비하지 못했습니다.".to_string())?;
    let path = dir.join(FILE_NAME);
    if path.is_file() {
        if let Some(key) = unseal(&path) {
            return Ok(OpenedKey::Same(key));
        }
        let _ = fs::remove_file(&path);
    }
    let key = seal_new(&path)?;
    Ok(OpenedKey::Rebuilt(key))
}

fn seal_new(path: &Path) -> Result<IndexKey, String> {
    let raw = random_key()?;
    let sealed = protect(&raw)?;
    fs::write(path, sealed).map_err(|_| "색인 키를 준비하지 못했습니다.".to_string())?;
    Ok(IndexKey { bytes: raw })
}

fn unseal(path: &Path) -> Option<IndexKey> {
    let sealed = fs::read(path).ok()?;
    let raw = unprotect(&sealed)?;
    if raw.len() != KEY_LEN {
        return None;
    }
    let mut bytes = [0u8; KEY_LEN];
    bytes.copy_from_slice(&raw);
    Some(IndexKey { bytes })
}

fn random_key() -> Result<[u8; KEY_LEN], String> {
    let mut bytes = [0u8; KEY_LEN];
    #[cfg(windows)]
    {
        use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
        let status = unsafe { BCryptGenRandom(None, &mut bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
        if status.is_err() {
            return Err("색인 키를 준비하지 못했습니다.".to_string());
        }
        return Ok(bytes);
    }
    #[cfg(not(windows))]
    {
        let _ = path_unused();
        Err("색인 키를 준비하지 못했습니다.".to_string())
    }
}

#[cfg(not(windows))]
fn path_unused() -> PathBuf {
    PathBuf::new()
}

#[cfg(windows)]
fn protect(raw: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: raw.len() as u32,
            pbData: raw.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .map_err(|_| "색인 키를 준비하지 못했습니다.".to_string())?;
        if output.pbData.is_null() || output.cbData == 0 {
            return Err("색인 키를 준비하지 못했습니다.".to_string());
        }
        let sealed = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(output.pbData as *mut _)));
        Ok(sealed)
    }
}

#[cfg(windows)]
fn unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: sealed.len() as u32,
            pbData: sealed.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output).ok()?;
        if output.pbData.is_null() || output.cbData == 0 {
            return None;
        }
        let raw = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(output.pbData as *mut _)));
        Some(raw)
    }
}

pub fn mac12(key: &[u8], text: &str) -> Option<String> {
    let full = hmac_sha256(key, text.as_bytes())?;
    Some(hex_prefix(&full[..12]))
}

pub fn mac_hex(key: &[u8], text: &str) -> Option<String> {
    let full = hmac_sha256(key, text.as_bytes())?;
    Some(hex_prefix(&full))
}

fn hex_prefix(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Option<[u8; 32]> {
    #[cfg(windows)]
    {
        use windows::Win32::Security::Cryptography::{
            BCryptCloseAlgorithmProvider, BCryptCreateHash, BCryptDestroyHash, BCryptFinishHash, BCryptHashData,
            BCryptOpenAlgorithmProvider, BCRYPT_ALG_HANDLE_HMAC_FLAG, BCRYPT_SHA256_ALGORITHM,
        };
        unsafe {
            let mut alg = Default::default();
            if BCryptOpenAlgorithmProvider(&mut alg, BCRYPT_SHA256_ALGORITHM, None, BCRYPT_ALG_HANDLE_HMAC_FLAG).is_err()
            {
                return None;
            }
            let mut hash = Default::default();
            if BCryptCreateHash(alg, &mut hash, None, Some(key), 0).is_err() {
                let _ = BCryptCloseAlgorithmProvider(alg, 0);
                return None;
            }
            let mut payload = data.to_vec();
            let hashed = BCryptHashData(hash, &mut payload, 0);
            let mut out = [0u8; 32];
            let finished = hashed.is_ok() && BCryptFinishHash(hash, &mut out, 0).is_ok();
            let _ = BCryptDestroyHash(hash);
            let _ = BCryptCloseAlgorithmProvider(alg, 0);
            if finished {
                Some(out)
            } else {
                None
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (key, data);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn damaged_key_file_is_replaced() {
        let dir = std::env::temp_dir().join(format!("edul-key-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let first = match open_dir(&dir).unwrap() {
            OpenedKey::Rebuilt(key) | OpenedKey::Same(key) => key.bytes().to_vec(),
        };
        fs::write(dir.join(FILE_NAME), b"damaged").unwrap();
        let second = match open_dir(&dir).unwrap() {
            OpenedKey::Rebuilt(key) => key.bytes().to_vec(),
            OpenedKey::Same(_) => panic!("damaged key was accepted"),
        };
        assert_ne!(first, second);
        assert_eq!(second.len(), KEY_LEN);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mac_changes_with_key() {
        let left = mac12(b"0123456789abcdef0123456789abcdef", "홍길").unwrap();
        let right = mac12(b"abcdef0123456789abcdef0123456789", "홍길").unwrap();
        assert_ne!(left, right);
        assert_eq!(left.len(), 24);
        assert!(!left.contains('홍'));
    }
}
