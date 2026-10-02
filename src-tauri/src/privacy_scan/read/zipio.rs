use std::io::{Cursor, Read};

use zip::ZipArchive;

use crate::privacy_scan::model::ReasonCode;

pub fn unzip(bytes: &[u8], max_unzip: u64) -> Result<Vec<(String, Vec<u8>)>, ReasonCode> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|_| ReasonCode::Damaged)?;
    let mut listed = Vec::new();
    for index in 0..archive.len() {
        if super::halted() {
            return Err(ReasonCode::TimedOut);
        }
        let entry = archive.by_index(index).map_err(|_| ReasonCode::Damaged)?;
        let name = entry.name().replace('\\', "/");
        if name.ends_with('/') || !entry.is_file() {
            continue;
        }
        listed.push((index, name, entry.size()));
    }
    let mut used = 0u64;
    let mut out = Vec::new();
    for (index, name, declared) in listed {
        if super::halted() {
            return Err(ReasonCode::TimedOut);
        }
        if declared > 0 && used.saturating_add(declared) > max_unzip {
            return Err(ReasonCode::UnzipLimit);
        }
        let mut entry = archive.by_index(index).map_err(|_| ReasonCode::Damaged)?;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            if super::halted() {
                return Err(ReasonCode::TimedOut);
            }
            let read = entry.read(&mut chunk).map_err(|_| ReasonCode::Damaged)?;
            if read == 0 {
                break;
            }
            used = used.saturating_add(read as u64);
            if used > max_unzip {
                return Err(ReasonCode::UnzipLimit);
            }
            buf.extend_from_slice(&chunk[..read]);
        }
        out.push((name, buf));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};
    use std::sync::atomic::{AtomicBool, Ordering};

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use crate::privacy_scan::model::ReasonCode;

    #[test]
    fn zip_entry_loop_stops_when_halted() {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
            writer.start_file("가짜.txt", options).unwrap();
            writer.write_all("가짜 테스트 데이터".as_bytes()).unwrap();
            writer.finish().unwrap();
        }
        let flag = AtomicBool::new(true);
        let _guard = crate::privacy_scan::read::arm_halt(&flag);
        assert!(crate::privacy_scan::read::halted());
        assert_eq!(super::unzip(&cursor.into_inner(), 1_000_000), Err(ReasonCode::TimedOut));
        let _ = flag.load(Ordering::Relaxed);
    }
}
