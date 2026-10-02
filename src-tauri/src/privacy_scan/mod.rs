//! 개인정보 보호 사전 점검 엔진.
//! 파일 읽기 → 패턴 → 문맥 → 위험도. 패턴과 위험도는 파일을 다시 열지 않는다.
//! 결과는 화면 메모리용이다. 원문, 가린 문자열, 경로, 파일 이름은 넣지 않는다.
//! 화면이 쓰는 id와 경로는 file_desk가 메모리에만 둔다. 이 모듈은 경로를 명령 결과로 내보내지 않는다.

mod budget;
mod context;
mod detect;
mod mask;
mod model;
mod profile;
mod read;
mod risk;

use std::fs::OpenOptions;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

pub use budget::ReadBudget;
pub use model::{ExtractStatus, FindingKind, Grade, Location, PreviewTarget, ReasonCode, ScanResult, TypeCount};

use model::ExtractedDocument;
use profile::Profile;

pub fn scan_path(path: &Path) -> ScanResult {
    scan_path_with(path, &ReadBudget::standard())
}

pub fn scan_path_with(path: &Path, budget: &ReadBudget) -> ScanResult {
    scan_path_halt(path, budget, &AtomicBool::new(false))
}

pub fn scan_path_halt(path: &Path, budget: &ReadBudget, halt: &AtomicBool) -> ScanResult {
    let loaded = match read_file(path, budget, halt) {
        Ok(loaded) => loaded,
        Err(reason) => return ScanResult::failed(reason),
    };
    scan_bytes_halt(&loaded.0, &loaded.1, budget, halt)
}

pub fn scan_bytes(extension: &str, bytes: &[u8], budget: &ReadBudget) -> ScanResult {
    scan_bytes_halt(extension, bytes, budget, &AtomicBool::new(false))
}

pub fn scan_bytes_halt(extension: &str, bytes: &[u8], budget: &ReadBudget, halt: &AtomicBool) -> ScanResult {
    if halt.load(Ordering::Relaxed) {
        return ScanResult::failed(ReasonCode::TimedOut);
    }
    if bytes.len() as u64 > budget.max_file_bytes {
        return ScanResult::failed(ReasonCode::TooLarge);
    }
    let _guard = read::arm_halt(halt);
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        if read::halted() {
            return ScanResult::failed(ReasonCode::TimedOut);
        }
        let doc = read::read_document(extension, bytes, budget);
        if doc.reason == Some(ReasonCode::TimedOut) {
            return ScanResult::failed(ReasonCode::TimedOut);
        }
        inspect(&doc)
    }));
    match outcome {
        Ok(result) => result,
        Err(_) => ScanResult::failed(ReasonCode::ParserPanic),
    }
}

pub fn preview_path(path: &Path, targets: &[PreviewTarget]) -> Result<Vec<String>, ReasonCode> {
    preview_path_with(path, targets, &ReadBudget::standard())
}

pub fn preview_path_with(path: &Path, targets: &[PreviewTarget], budget: &ReadBudget) -> Result<Vec<String>, ReasonCode> {
    let (extension, bytes) = read_file(path, budget, &AtomicBool::new(false))?;
    preview_bytes(&extension, &bytes, targets, budget)
}

pub fn preview_bytes(extension: &str, bytes: &[u8], targets: &[PreviewTarget], budget: &ReadBudget) -> Result<Vec<String>, ReasonCode> {
    if bytes.len() as u64 > budget.max_file_bytes {
        return Err(ReasonCode::TooLarge);
    }
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let doc = read::read_document(extension, bytes, budget);
        if doc.status == model::ExtractStatus::Failed {
            return Err(doc.reason.unwrap_or(ReasonCode::Damaged));
        }
        let (_records, hits, _marks) = context::prepare(&doc, &Profile::v1());
        let mut masked = Vec::new();
        for target in targets {
            if let Some(hit) = hits.iter().find(|hit| hit.kind == target.kind && hit.location == target.location) {
                masked.push(mask::mask(hit.kind, &hit.value));
            }
        }
        Ok(masked)
    }));
    match outcome {
        Ok(result) => result,
        Err(_) => Err(ReasonCode::ParserPanic),
    }
}

pub(crate) fn inspect(doc: &ExtractedDocument) -> ScanResult {
    let profile = Profile::v1();
    if doc.status == model::ExtractStatus::Failed {
        return ScanResult::failed(doc.reason.unwrap_or(ReasonCode::Damaged));
    }
    let (_records, hits, marks) = context::prepare(doc, &profile);
    risk::judge(doc, &hits, &marks, &profile)
}

fn read_file(path: &Path, budget: &ReadBudget, halt: &AtomicBool) -> Result<(String, Vec<u8>), ReasonCode> {
    if halt.load(Ordering::Relaxed) {
        return Err(ReasonCode::TimedOut);
    }
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_string();
    let mut file = OpenOptions::new().read(true).open(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => ReasonCode::Missing,
        std::io::ErrorKind::PermissionDenied => ReasonCode::Denied,
        _ => ReasonCode::Io,
    })?;
    let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    if length > budget.max_file_bytes {
        return Err(ReasonCode::TooLarge);
    }
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 65536];
    loop {
        if halt.load(Ordering::Relaxed) {
            return Err(ReasonCode::TimedOut);
        }
        let read = file.read(&mut chunk).map_err(|_| ReasonCode::Io)?;
        if read == 0 {
            break;
        }
        if bytes.len().saturating_add(read) as u64 > budget.max_file_bytes {
            return Err(ReasonCode::TooLarge);
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
    Ok((extension, bytes))
}

#[cfg(test)]
mod tests;
