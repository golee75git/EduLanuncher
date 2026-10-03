//! 업무자료 manifest 서명 검증. 개인키는 이 파일에 두지 않는다.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use crate::fixed_https::{read_https_bytes, ReadStop};

const HOST: &str = "edulanuncher.zeroorder.kr";
const FILE_LIMIT: usize = 8;
const FILE_BYTES: usize = 8 * 1024 * 1024;
const META_BYTES: usize = 64 * 1024;
const WAIT_MS: i32 = 12_000;
const ALLOWED: &[&str] = &[
    "catalog.json",
    "search-index.json",
    "pack/handbook.json",
    "pack/topics.json",
    "pack/master.json",
    "pack/epki.json",
];
const LINK_HOSTS: &[&str] = &[
    "edulanuncher.zeroorder.kr",
    "epki.go.kr",
    "schoolinfo.go.kr",
    "g2b.go.kr",
    "keiis.go.kr",
    "next.share.go.kr",
    "total.comwel.or.kr",
];

/// 앱에 넣는 공개키. 65바이트 비압축 점(0x04||X||Y)의 표준 base64. 최대 2개.
const PUBLIC_KEYS_B64: &[&str] = &[
    "BDgVgs/+8gtjxPhN5k9mGwDzEmgkKO4d94UKWIOEL+BZMzptJI6z940DFhzEtpvaWPM27CJZfwE6Calr6oEePMY=",
    "BC1GNmXVQuRNXi9fmmEe8br5V4d05cBhHoq95GKc0lqjBE/nY9I+JyDRKigGtPVxt9DIoN0lEH82XDgvSYgvM10=",
];

#[derive(Debug, Deserialize)]
struct ManifestDoc {
    format: u64,
    serial: u64,
    files: Vec<ManifestFile>,
}

#[derive(Debug, Deserialize)]
struct ManifestFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, serde::Serialize)]
pub struct KnowledgeView {
    pack: Option<PackView>,
    index: Option<Value>,
    #[serde(rename = "droppedLinks")]
    dropped_links: u32,
}

#[derive(Clone, serde::Serialize)]
struct PackView {
    handbook: Option<Value>,
    topics: Option<Value>,
    master: Option<Value>,
    epki: Option<Value>,
}

#[derive(Clone)]
struct CacheHit {
    serial: u64,
    view: KnowledgeView,
}

enum Judge {
    Keep,
    Store,
}

#[allow(dead_code)]
pub fn wants_launch_fetch(enabled: bool) -> bool {
    enabled
}

#[tauri::command]
pub fn verified_knowledge(app: AppHandle) -> KnowledgeView {
    cache_view(&cache_dir(&app)).map(|hit| hit.view).unwrap_or_else(empty_view)
}

#[tauri::command]
pub fn refresh_verified_knowledge(app: AppHandle) -> KnowledgeView {
    let dir = cache_dir(&app);
    let cached = cache_view(&dir);
    let _ = pull_remote(&dir, cached.as_ref().map(|hit| hit.serial), &public_points(), https_get);
    cache_view(&dir).map(|hit| hit.view).unwrap_or_else(empty_view)
}

fn empty_view() -> KnowledgeView {
    KnowledgeView { pack: None, index: None, dropped_links: 0 }
}

fn cache_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("knowledge-verified")
}

fn https_get(path: &str) -> Result<Vec<u8>, ReadStop> {
    if path != "manifest.json" && path != "manifest.json.sig" && !allowed_path(path) {
        return Err(ReadStop::Rejected);
    }
    let cap = if path.ends_with(".sig") || path == "manifest.json" {
        META_BYTES
    } else {
        FILE_BYTES
    };
    let url = format!("https://{HOST}/knowledge/{path}");
    read_https_bytes(&url, cap, WAIT_MS)
}

fn pull_remote<F>(dir: &Path, cached_serial: Option<u64>, points: &[Vec<u8>], mut fetch: F) -> Judge
where
    F: FnMut(&str) -> Result<Vec<u8>, ReadStop>,
{
    let manifest = match fetch("manifest.json") {
        Ok(bytes) => bytes,
        Err(_) => return Judge::Keep,
    };
    let signature = match fetch("manifest.json.sig") {
        Ok(bytes) => bytes,
        Err(_) => return Judge::Keep,
    };
    let Some(doc) = signed_manifest(&manifest, &signature, points) else {
        return Judge::Keep;
    };
    if doc.files.is_empty() {
        return Judge::Keep;
    }
    match cached_serial {
        Some(serial) if doc.serial <= serial => return Judge::Keep,
        _ => {}
    }
    let mut files = BTreeMap::new();
    for item in &doc.files {
        let bytes = match fetch(&item.path) {
            Ok(bytes) => bytes,
            Err(_) => return Judge::Keep,
        };
        if bytes.len() as u64 != item.size || bytes.len() > FILE_BYTES || sha256_hex(&bytes) != item.sha256 {
            return Judge::Keep;
        }
        files.insert(item.path.clone(), bytes);
    }
    if write_cache(dir, &manifest, &signature, &files).is_err() {
        return Judge::Keep;
    }
    Judge::Store
}

fn signed_manifest(manifest: &[u8], signature_text: &[u8], points: &[Vec<u8>]) -> Option<ManifestDoc> {
    let signature = decode_b64(std::str::from_utf8(signature_text).ok()?.trim())?;
    if signature.len() != 64 || points.is_empty() {
        return None;
    }
    let hash = sha256(manifest)?;
    if !points.iter().any(|point| verify_p256(&hash, &signature, point)) {
        return None;
    }
    let doc: ManifestDoc = serde_json::from_slice(manifest).ok()?;
    if doc.format != 1 || doc.serial == 0 || doc.serial > 4_102_444_800 || doc.files.len() > FILE_LIMIT {
        return None;
    }
    let mut seen = BTreeMap::new();
    for file in &doc.files {
        if !allowed_path(&file.path) || seen.insert(file.path.clone(), ()).is_some() {
            return None;
        }
        if file.size > FILE_BYTES as u64 || !is_sha256_hex(&file.sha256) {
            return None;
        }
    }
    Some(doc)
}

fn allowed_path(path: &str) -> bool {
    ALLOWED.contains(&path)
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn public_points() -> Vec<Vec<u8>> {
    PUBLIC_KEYS_B64.iter().take(2).filter_map(|text| decode_point(text)).collect()
}

fn decode_point(text: &str) -> Option<Vec<u8>> {
    let point = decode_b64(text.trim())?;
    if point.len() == 65 && point[0] == 0x04 {
        Some(point)
    } else {
        None
    }
}

fn cache_view(dir: &Path) -> Option<CacheHit> {
    let manifest = fs::read(dir.join("manifest.json")).ok()?;
    let signature = fs::read(dir.join("manifest.json.sig")).ok()?;
    let doc = signed_manifest(&manifest, &signature, &public_points())?;
    let mut files = BTreeMap::new();
    for item in &doc.files {
        let bytes = fs::read(dir.join("files").join(&item.path)).ok()?;
        if bytes.len() as u64 != item.size || sha256_hex(&bytes) != item.sha256 {
            return None;
        }
        files.insert(item.path.clone(), bytes);
    }
    Some(CacheHit { serial: doc.serial, view: view_of(&files) })
}

fn view_of(files: &BTreeMap<String, Vec<u8>>) -> KnowledgeView {
    let mut dropped = 0u32;
    let mut read = |path: &str| -> Option<Value> {
        let bytes = files.get(path)?;
        let mut value: Value = serde_json::from_slice(bytes).ok()?;
        scrub(&mut value, &mut dropped);
        Some(value)
    };
    let pack = if files.keys().any(|path| path.starts_with("pack/")) {
        Some(PackView {
            handbook: read("pack/handbook.json"),
            topics: read("pack/topics.json"),
            master: read("pack/master.json"),
            epki: read("pack/epki.json"),
        })
    } else {
        None
    };
    KnowledgeView { pack, index: read("search-index.json"), dropped_links: dropped }
}

fn scrub(value: &mut Value, dropped: &mut u32) {
    match value {
        Value::Object(map) => scrub_object(map, dropped),
        Value::Array(items) => {
            for item in items {
                scrub(item, dropped);
            }
        }
        _ => {}
    }
}

fn scrub_object(map: &mut Map<String, Value>, dropped: &mut u32) {
    let keys: Vec<String> = map.keys().cloned().collect();
    for key in keys {
        let Some(child) = map.get_mut(&key) else {
            continue;
        };
        if key == "url" || key == "sourceUrl" || key == "href" {
            if let Some(text) = child.as_str() {
                if !text.trim().is_empty() && !link_allowed(text) {
                    *dropped += 1;
                    *child = Value::String(String::new());
                }
            }
        } else {
            scrub(child, dropped);
        }
    }
}

fn link_allowed(value: &str) -> bool {
    let text = value.trim();
    let Some(rest) = text.strip_prefix("https://") else {
        return false;
    };
    if rest.is_empty() || rest.contains('@') || rest.contains(' ') || rest.contains('\\') {
        return false;
    }
    let hostport = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = hostport.rsplit_once(':').map(|(host, port)| if port == "443" { host } else { "" }).unwrap_or(hostport);
    if host.is_empty() {
        return false;
    }
    host_allowed(host)
}

fn host_allowed(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    LINK_HOSTS.iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

fn write_cache(dir: &Path, manifest: &[u8], signature: &[u8], files: &BTreeMap<String, Vec<u8>>) -> Result<(), ()> {
    let staging = PathBuf::from(format!("{}.next", dir.display()));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(staging.join("files")).map_err(|_| ())?;
    fs::write(staging.join("manifest.json"), manifest).map_err(|_| ())?;
    fs::write(staging.join("manifest.json.sig"), signature).map_err(|_| ())?;
    for (path, bytes) in files {
        let target = staging.join("files").join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|_| ())?;
        }
        fs::write(target, bytes).map_err(|_| ())?;
    }
    let _ = fs::remove_dir_all(dir);
    fs::rename(&staging, dir).map_err(|_| ())
}

fn sha256_hex(bytes: &[u8]) -> String {
    sha256(bytes).map(hex32).unwrap_or_default()
}

fn hex32(bytes: [u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn decode_b64(text: &str) -> Option<Vec<u8>> {
    fn val(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes = text.as_bytes();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::new();
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().filter(|byte| **byte == b'=').count();
        if pad > 2 {
            return None;
        }
        let a = val(chunk[0])?;
        let b = val(chunk[1])?;
        let c = if chunk[2] == b'=' { 0 } else { val(chunk[2])? };
        let d = if chunk[3] == b'=' { 0 } else { val(chunk[3])? };
        out.push((a << 2) | (b >> 4));
        if chunk[2] != b'=' {
            out.push((b << 4) | (c >> 2));
        }
        if chunk[3] != b'=' {
            out.push((c << 6) | d);
        }
    }
    Some(out)
}

#[cfg(windows)]
fn sha256(bytes: &[u8]) -> Option<[u8; 32]> {
    use windows::Win32::Security::Cryptography::{
        BCryptCloseAlgorithmProvider, BCryptHash, BCryptOpenAlgorithmProvider, BCRYPT_ALG_HANDLE, BCRYPT_SHA256_ALGORITHM,
    };
    unsafe {
        let mut alg = BCRYPT_ALG_HANDLE::default();
        if BCryptOpenAlgorithmProvider(&mut alg, BCRYPT_SHA256_ALGORITHM, None, Default::default()).is_err() {
            return None;
        }
        let mut out = [0u8; 32];
        let status = BCryptHash(alg, None, bytes, &mut out);
        let _ = BCryptCloseAlgorithmProvider(alg, 0);
        if status.is_err() {
            None
        } else {
            Some(out)
        }
    }
}

#[cfg(not(windows))]
fn sha256(_bytes: &[u8]) -> Option<[u8; 32]> {
    None
}

#[cfg(windows)]
fn verify_p256(hash: &[u8; 32], signature: &[u8], point: &[u8]) -> bool {
    use windows::Win32::Security::Cryptography::{
        BCryptCloseAlgorithmProvider, BCryptDestroyKey, BCryptImportKeyPair, BCryptOpenAlgorithmProvider,
        BCryptVerifySignature, BCRYPT_ALG_HANDLE, BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_P256_ALGORITHM,
        BCRYPT_ECDSA_PUBLIC_P256_MAGIC, BCRYPT_KEY_HANDLE,
    };
    if point.len() != 65 || point[0] != 0x04 || signature.len() != 64 {
        return false;
    }
    let mut blob = Vec::with_capacity(8 + 64);
    blob.extend_from_slice(&BCRYPT_ECDSA_PUBLIC_P256_MAGIC.to_le_bytes());
    blob.extend_from_slice(&32u32.to_le_bytes());
    blob.extend_from_slice(&point[1..]);
    unsafe {
        let mut alg = BCRYPT_ALG_HANDLE::default();
        if BCryptOpenAlgorithmProvider(&mut alg, BCRYPT_ECDSA_P256_ALGORITHM, None, Default::default()).is_err() {
            return false;
        }
        let mut key = BCRYPT_KEY_HANDLE::default();
        let imported = BCryptImportKeyPair(alg, None, BCRYPT_ECCPUBLIC_BLOB, &mut key, &blob, 0);
        let ok = imported.is_ok() && BCryptVerifySignature(key, None, hash, signature, Default::default()).is_ok();
        if !key.is_invalid() {
            let _ = BCryptDestroyKey(key);
        }
        let _ = BCryptCloseAlgorithmProvider(alg, 0);
        ok
    }
}

#[cfg(not(windows))]
fn verify_p256(_hash: &[u8; 32], _signature: &[u8], _point: &[u8]) -> bool {
    false
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("edulauncher-knowledge-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct Pair {
        point: Vec<u8>,
        sign: Box<dyn Fn(&[u8]) -> Vec<u8>>,
    }

    fn pair() -> Pair {
        use windows::Win32::Security::Cryptography::{
            BCryptExportKey, BCryptFinalizeKeyPair, BCryptGenerateKeyPair,
            BCryptOpenAlgorithmProvider, BCryptSignHash, BCRYPT_ALG_HANDLE, BCRYPT_ECCPUBLIC_BLOB, BCRYPT_ECDSA_P256_ALGORITHM,
            BCRYPT_KEY_HANDLE,
        };
        unsafe {
            let mut alg = BCRYPT_ALG_HANDLE::default();
            assert!(BCryptOpenAlgorithmProvider(&mut alg, BCRYPT_ECDSA_P256_ALGORITHM, None, Default::default()).is_ok());
            let mut key = BCRYPT_KEY_HANDLE::default();
            assert!(BCryptGenerateKeyPair(alg, &mut key, 256, 0).is_ok());
            assert!(BCryptFinalizeKeyPair(key, 0).is_ok());
            let mut size = 0u32;
            assert!(BCryptExportKey(key, None, BCRYPT_ECCPUBLIC_BLOB, None, &mut size, 0).is_ok());
            let mut blob = vec![0u8; size as usize];
            assert!(BCryptExportKey(key, None, BCRYPT_ECCPUBLIC_BLOB, Some(&mut blob), &mut size, 0).is_ok());
            let mut point = vec![0x04];
            point.extend_from_slice(&blob[8..]);
            let key_keep = key;
            Pair {
                point,
                sign: Box::new(move |message| {
                    let _alg = &alg;
                    let hash = sha256(message).unwrap();
                    let mut sig = vec![0u8; 64];
                    let mut wrote = 0u32;
                    assert!(BCryptSignHash(key_keep, None, &hash, Some(&mut sig), &mut wrote, Default::default()).is_ok());
                    sig.truncate(wrote as usize);
                    sig
                }),
            }
        }
    }

    fn manifest(serial: u64, files: &[(&str, &[u8])]) -> (Vec<u8>, Vec<u8>, Pair) {
        let keys = pair();
        let list: Vec<String> = files
            .iter()
            .map(|(path, bytes)| {
                format!(
                    "{{\"path\":\"{path}\",\"size\":{},\"sha256\":\"{}\"}}",
                    bytes.len(),
                    sha256_hex(bytes)
                )
            })
            .collect();
        let body = format!(
            "{{\"format\":1,\"serial\":{serial},\"generatedAt\":\"2026-10-03T00:00:00Z\",\"files\":[{}]}}",
            list.join(",")
        );
        let bytes = body.into_bytes();
        let sig = (keys.sign)(&bytes);
        (bytes, sig, keys)
    }

    fn b64(bytes: &[u8]) -> String {
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        let mut i = 0;
        while i + 3 <= bytes.len() {
            let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | bytes[i + 2] as u32;
            out.push(T[((n >> 18) & 63) as usize] as char);
            out.push(T[((n >> 12) & 63) as usize] as char);
            out.push(T[((n >> 6) & 63) as usize] as char);
            out.push(T[(n & 63) as usize] as char);
            i += 3;
        }
        if bytes.len() - i == 1 {
            let n = (bytes[i] as u32) << 16;
            out.push(T[((n >> 18) & 63) as usize] as char);
            out.push(T[((n >> 12) & 63) as usize] as char);
            out.push('=');
            out.push('=');
        } else if bytes.len() - i == 2 {
            let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
            out.push(T[((n >> 18) & 63) as usize] as char);
            out.push(T[((n >> 12) & 63) as usize] as char);
            out.push(T[((n >> 6) & 63) as usize] as char);
            out.push('=');
        }
        out
    }

    fn judge_with(dir: &Path, point: &[u8], manifest: &[u8], sig: &[u8], files: &[(&str, &[u8])], cached: Option<u64>) -> (Judge, usize) {
        let mut calls = 0usize;
        let sig_text = b64(sig).into_bytes();
        let map: BTreeMap<String, Vec<u8>> = files.iter().map(|(path, bytes)| ((*path).to_string(), bytes.to_vec())).collect();
        let manifest = manifest.to_vec();
        let points = vec![point.to_vec()];
        let judge = pull_remote(dir, cached, &points, |path| {
            calls += 1;
            if path == "manifest.json" {
                Ok(manifest.clone())
            } else if path == "manifest.json.sig" {
                Ok(sig_text.clone())
            } else if let Some(bytes) = map.get(path) {
                Ok(bytes.clone())
            } else {
                Err(ReadStop::Failed)
            }
        });
        (judge, calls)
    }

    #[test]
    fn accepts_a_valid_signature() {
        let body = br#"{"format":1,"serial":10,"generatedAt":"t","files":[]}"#;
        let keys = pair();
        let sig = (keys.sign)(body);
        assert!(signed_manifest(body, b64(&sig).as_bytes(), &[keys.point]).is_some());
    }

    #[test]
    fn accepts_an_empty_manifest_without_replacing_cache() {
        let dir = temp_dir("empty");
        fs::write(dir.join("kept.txt"), b"stay").unwrap();
        let (manifest, sig, keys) = manifest(20, &[]);
        let doc = signed_manifest(&manifest, b64(&sig).as_bytes(), &[keys.point]);
        assert!(doc.unwrap().files.is_empty());
        assert_eq!(fs::read(dir.join("kept.txt")).unwrap(), b"stay");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_changed_manifest_byte() {
        let body = br#"{"format":1,"serial":10,"generatedAt":"t","files":[]}"#;
        let keys = pair();
        let sig = (keys.sign)(body);
        let mut changed = body.to_vec();
        changed[12] ^= 1;
        assert!(signed_manifest(&changed, b64(&sig).as_bytes(), &[keys.point]).is_none());
    }

    #[test]
    fn rejects_a_hash_or_size_mismatch() {
        let payload = br#"{"topics":[]}"#;
        let (manifest, sig, keys) = manifest(30, &[("pack/topics.json", payload)]);
        let doc = signed_manifest(&manifest, b64(&sig).as_bytes(), &[keys.point]).unwrap();
        let wrong = b"{}".to_vec();
        assert_ne!(wrong.len() as u64, doc.files[0].size);
        assert_ne!(sha256_hex(&wrong), doc.files[0].sha256);
    }

    #[test]
    fn rejects_a_file_that_is_not_listed() {
        assert!(!allowed_path("../catalog.json"));
        assert!(!allowed_path("pack/other.json"));
        assert!(!allowed_path("/catalog.json"));
        assert!(!allowed_path("catalog.json?x=1"));
    }

    #[test]
    fn rejects_a_missing_or_short_signature() {
        let body = br#"{"format":1,"serial":10,"generatedAt":"t","files":[]}"#;
        let keys = pair();
        assert!(signed_manifest(body, b"", &[keys.point.clone()]).is_none());
        assert!(signed_manifest(body, b"YQ==", &[keys.point]).is_none());
    }

    #[test]
    fn rejects_a_lower_serial_and_skips_an_equal_one() {
        let (manifest, sig, keys) = manifest(5, &[("catalog.json", br#"{"generatedAt":"t"}"#)]);
        let dir = temp_dir("serial");
        let sample: &[(&str, &[u8])] = &[("catalog.json", br#"{"generatedAt":"t"}"#)];
        let (lower, calls) = judge_with(&dir, &keys.point, &manifest, &sig, sample, Some(6));
        assert!(matches!(lower, Judge::Keep));
        assert_eq!(calls, 2);
        let (same, same_calls) = judge_with(&dir, &keys.point, &manifest, &sig, sample, Some(5));
        assert!(matches!(same, Judge::Keep));
        assert_eq!(same_calls, 2);
        let (newer, fetched) = judge_with(&dir, &keys.point, &manifest, &sig, sample, Some(4));
        assert!(matches!(newer, Judge::Store));
        assert_eq!(fetched, 3);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_the_second_public_key() {
        let body = br#"{"format":1,"serial":11,"generatedAt":"t","files":[]}"#;
        let first = pair();
        let second = pair();
        let sig = (second.sign)(body);
        assert!(signed_manifest(body, b64(&sig).as_bytes(), &[first.point, second.point]).is_some());
    }

    #[test]
    fn drops_links_outside_the_allow_list() {
        assert!(link_allowed("https://www.epki.go.kr/"));
        assert!(link_allowed("https://a.schoolinfo.go.kr/path"));
        assert!(!link_allowed("https://evilgo.kr/"));
        assert!(!link_allowed("https://notepki.go.kr/"));
        assert!(!link_allowed("http://www.epki.go.kr/"));
        assert!(!link_allowed("file:///C:/Windows/notepad.exe"));
        assert!(!link_allowed("ms-settings:network"));
        let mut value = serde_json::json!({"url":"https://evil.example/phish","note":"그대로"});
        let mut dropped = 0;
        scrub(&mut value, &mut dropped);
        assert_eq!(dropped, 1);
        assert_eq!(value["url"], "");
        assert_eq!(value["note"], "그대로");
    }

    #[test]
    fn rejects_a_tampered_cache_and_keeps_running() {
        let dir = temp_dir("tamper");
        let payload = br#"{"topics":[1]}"#;
        let (manifest, sig, keys) = manifest(40, &[("catalog.json", payload)]);
        let mut files = BTreeMap::new();
        files.insert("catalog.json".to_string(), payload.to_vec());
        assert!(write_cache(&dir, &manifest, b64(&sig).as_bytes(), &files).is_ok());
        let saved = cache_view_with(&dir, &[keys.point.clone()]).unwrap();
        assert_eq!(saved.serial, 40);
        let mut flipped = fs::read(dir.join("files").join("catalog.json")).unwrap();
        flipped[0] ^= 1;
        fs::write(dir.join("files").join("catalog.json"), flipped).unwrap();
        assert!(cache_view_with(&dir, &[keys.point]).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    fn cache_view_with(dir: &Path, points: &[Vec<u8>]) -> Option<CacheHit> {
        let manifest = fs::read(dir.join("manifest.json")).ok()?;
        let signature = fs::read(dir.join("manifest.json.sig")).ok()?;
        let doc = signed_manifest(&manifest, &signature, points)?;
        let mut files = BTreeMap::new();
        for item in &doc.files {
            let bytes = fs::read(dir.join("files").join(&item.path)).ok()?;
            if bytes.len() as u64 != item.size || sha256_hex(&bytes) != item.sha256 {
                return None;
            }
            files.insert(item.path.clone(), bytes);
        }
        Some(CacheHit { serial: doc.serial, view: view_of(&files) })
    }

    #[test]
    fn treats_redirect_and_http_errors_as_keep() {
        assert!(matches!(pull_remote(Path::new("unused"), None, &[], |_| Err(ReadStop::Failed)), Judge::Keep));
        assert!(matches!(pull_remote(Path::new("unused"), Some(3), &[], |_| Err(ReadStop::TooLarge)), Judge::Keep));
    }

    #[test]
    fn refuses_a_body_over_eight_megabytes() {
        assert!(FILE_BYTES == 8 * 1024 * 1024);
        let huge = vec![b'a'; FILE_BYTES + 1];
        let (manifest, sig, keys) = manifest(50, &[("catalog.json", &huge)]);
        assert!(signed_manifest(&manifest, b64(&sig).as_bytes(), &[keys.point]).is_none());
    }

    #[test]
    fn launch_flag_skips_the_request() {
        assert!(!wants_launch_fetch(false));
        assert!(wants_launch_fetch(true));
    }

    #[test]
    fn keeps_at_most_two_public_keys() {
        assert!(PUBLIC_KEYS_B64.len() <= 2);
    }

    #[test]
    fn embedded_public_keys_are_uncompressed_points() {
        assert_eq!(PUBLIC_KEYS_B64.len(), 2);
        for text in PUBLIC_KEYS_B64 {
            let point = decode_point(text).expect("공개점");
            assert_eq!(point.len(), 65);
            assert_eq!(point[0], 0x04);
        }
    }
}
