use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::privacy_scan::budget::ReadBudget;
use crate::privacy_scan::model::{ExtractedDocument, ReasonCode};

thread_local! {
    static HALT_PTR: Cell<*const AtomicBool> = const { Cell::new(std::ptr::null()) };
}

pub struct HaltGuard;

impl Drop for HaltGuard {
    fn drop(&mut self) {
        HALT_PTR.with(|cell| cell.set(std::ptr::null()));
    }
}

pub fn arm_halt(flag: &AtomicBool) -> HaltGuard {
    HALT_PTR.with(|cell| cell.set(flag as *const AtomicBool));
    HaltGuard
}

pub fn halted() -> bool {
    HALT_PTR.with(|cell| {
        let ptr = cell.get();
        !ptr.is_null() && unsafe { (*ptr).load(Ordering::Relaxed) }
    })
}

pub(crate) mod decode;
mod docx;
mod flow;
mod hwpx;
mod pdf;
mod plain;
mod xlsx;
mod xmlutil;
mod zipio;

pub fn read_document(extension: &str, bytes: &[u8], budget: &ReadBudget) -> ExtractedDocument {
    let ext = extension.trim().trim_start_matches('.').to_ascii_lowercase();
    match ext.as_str() {
        "txt" | "md" => plain::read("txt", bytes),
        "csv" => plain::read("csv", bytes),
        "xlsx" => xlsx::read(bytes, budget),
        "docx" => docx::read(bytes, budget),
        "hwpx" => hwpx::read(bytes, budget),
        "pdf" => pdf::read(bytes, budget),
        "hwp" | "jpg" | "jpeg" | "png" => ExtractedDocument::failed(ReasonCode::Unsupported),
        _ => ExtractedDocument::failed(ReasonCode::Unsupported),
    }
}
