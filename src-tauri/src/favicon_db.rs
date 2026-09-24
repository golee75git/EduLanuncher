#![cfg(windows)]

//! 브라우저(Edge·Chrome)가 이미 저장해 둔 사이트 그림을 읽기 전용으로 찾는다.
//! SQLite 공개 파일 형식 문서만 보고 새로 쓴 최소 읽기 코드다. 사이트에 접속하지 않고
//! `icon_mapping`·`favicon_bitmaps` 두 표만 읽는다. 기록·쿠키·저장된 로그인은 열지 않는다.
//! 무엇이든 맞지 않으면 그림만 포기하고 None을 돌려준다.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PAGE_VISITS: u32 = 150_000;
const MAX_DEPTH: u32 = 24;
const MAX_OVERFLOW_PAGES: usize = 64;
const MAX_ROW_BYTES: usize = 64 * 1024;
const MAX_ICON_BYTES: usize = 24 * 1024;
const MAX_MATCHED_IDS: usize = 8;
const MAX_PROFILES: usize = 6;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

struct Cell<'a> {
    total: usize,
    local: &'a [u8],
    overflow: u32,
}

enum Flow {
    Next,
    Stop,
}

struct Db {
    file: File,
    page_size: usize,
    usable: usize,
    pages: u32,
    visits: u32,
}

/// SQLite 가변 길이 정수(1~9바이트).
fn varint(bytes: &[u8]) -> Option<(u64, usize)> {
    let mut value: u64 = 0;
    for index in 0..9 {
        let byte = *bytes.get(index)?;
        if index == 8 {
            return Some(((value << 8) | byte as u64, 9));
        }
        value = (value << 7) | (byte & 0x7f) as u64;
        if byte & 0x80 == 0 {
            return Some((value, index + 1));
        }
    }
    None
}

fn serial_len(kind: u64) -> Option<usize> {
    Some(match kind {
        0 | 8 | 9 => 0,
        1 => 1,
        2 => 2,
        3 => 3,
        4 => 4,
        5 => 6,
        6 | 7 => 8,
        10 | 11 => return None,
        even if even % 2 == 0 => usize::try_from((even - 12) / 2).ok()?,
        odd => usize::try_from((odd - 13) / 2).ok()?,
    })
}

fn as_int(kind: u64, bytes: &[u8]) -> Option<i64> {
    match kind {
        8 => Some(0),
        9 => Some(1),
        1..=6 => {
            let mut value: i64 = if bytes.first()? & 0x80 != 0 { -1 } else { 0 };
            for byte in bytes {
                value = (value << 8) | *byte as i64;
            }
            Some(value)
        }
        _ => None,
    }
}

fn as_text(kind: u64, bytes: &[u8]) -> Option<&str> {
    if kind >= 13 && kind % 2 == 1 {
        std::str::from_utf8(bytes).ok()
    } else {
        None
    }
}

struct Record<'a> {
    types: Vec<u64>,
    body: &'a [u8],
}

impl<'a> Record<'a> {
    fn parse(payload: &'a [u8]) -> Option<Record<'a>> {
        let (header_len, used) = varint(payload)?;
        let header_len = usize::try_from(header_len).ok()?;
        if header_len < used || header_len > payload.len() {
            return None;
        }
        let mut types = Vec::new();
        let mut at = used;
        while at < header_len {
            let (kind, size) = varint(&payload[at..header_len])?;
            types.push(kind);
            at += size;
            if types.len() > 64 {
                return None;
            }
        }
        Some(Record {
            types,
            body: &payload[header_len..],
        })
    }

    fn field(&self, index: usize) -> Option<(u64, &'a [u8])> {
        let mut offset = 0usize;
        for (position, kind) in self.types.iter().enumerate() {
            let len = serial_len(*kind)?;
            if position == index {
                let end = offset.checked_add(len)?;
                return self.body.get(offset..end).map(|bytes| (*kind, bytes));
            }
            offset = offset.checked_add(len)?;
        }
        None
    }
}

impl Db {
    fn open(path: &Path) -> Option<Db> {
        let mut file = File::open(path).ok()?;
        let len = file.metadata().ok()?.len();
        if !(512..=MAX_FILE_BYTES).contains(&len) {
            return None;
        }
        let mut head = [0u8; 100];
        file.read_exact(&mut head).ok()?;
        if &head[..16] != b"SQLite format 3\0" {
            return None;
        }
        let raw = u16::from_be_bytes([head[16], head[17]]) as usize;
        let page_size = if raw == 1 { 65536 } else { raw };
        if page_size < 512 || !page_size.is_power_of_two() {
            return None;
        }
        let reserved = head[20] as usize;
        if reserved >= page_size || page_size - reserved < 480 {
            return None;
        }
        let encoding = u32::from_be_bytes([head[56], head[57], head[58], head[59]]);
        if encoding != 1 {
            return None;
        }
        Some(Db {
            file,
            page_size,
            usable: page_size - reserved,
            pages: u32::try_from(len / page_size as u64).ok()?,
            visits: 0,
        })
    }

    fn read_page(&mut self, number: u32) -> Option<Vec<u8>> {
        if number == 0 || number > self.pages {
            return None;
        }
        self.visits += 1;
        if self.visits > MAX_PAGE_VISITS {
            return None;
        }
        let mut page = vec![0u8; self.page_size];
        self.file
            .seek(SeekFrom::Start((number as u64 - 1) * self.page_size as u64))
            .ok()?;
        self.file.read_exact(&mut page).ok()?;
        Some(page)
    }

    fn leaf_cell(usable: usize, page: &[u8], pointer: usize) -> Option<Cell<'_>> {
        let rest = page.get(pointer..)?;
        let (total, first) = varint(rest)?;
        let (_rowid, second) = varint(rest.get(first..)?)?;
        let total = usize::try_from(total).ok()?;
        let start = pointer.checked_add(first)?.checked_add(second)?;
        let max_local = usable - 35;
        let local_len = if total <= max_local {
            total
        } else {
            let min_local = ((usable - 12) * 32 / 255) - 23;
            let spill = min_local + ((total - min_local) % (usable - 4));
            if spill <= max_local {
                spill
            } else {
                min_local
            }
        };
        let end = start.checked_add(local_len)?;
        let local = page.get(start..end)?;
        let overflow = if total > local_len {
            u32::from_be_bytes(page.get(end..end.checked_add(4)?)?.try_into().ok()?)
        } else {
            0
        };
        Some(Cell {
            total,
            local,
            overflow,
        })
    }

    /// 표의 모든 행을 차례로 본다. `Some(true)`는 중간에 멈춤, `None`은 읽기 오류.
    fn walk<F>(&mut self, root: u32, depth: u32, visit: &mut F) -> Option<bool>
    where
        F: FnMut(&mut Db, &Cell<'_>) -> Flow,
    {
        if depth > MAX_DEPTH {
            return None;
        }
        let page = self.read_page(root)?;
        let base = if root == 1 { 100 } else { 0 };
        let kind = *page.get(base)?;
        let count = u16::from_be_bytes([*page.get(base + 3)?, *page.get(base + 4)?]) as usize;
        match kind {
            0x0d => {
                let array = base + 8;
                for index in 0..count {
                    let at = array + index * 2;
                    let pointer = u16::from_be_bytes([*page.get(at)?, *page.get(at + 1)?]) as usize;
                    let cell = Db::leaf_cell(self.usable, &page, pointer)?;
                    if let Flow::Stop = visit(self, &cell) {
                        return Some(true);
                    }
                }
                Some(false)
            }
            0x05 => {
                let array = base + 12;
                for index in 0..count {
                    let at = array + index * 2;
                    let pointer = u16::from_be_bytes([*page.get(at)?, *page.get(at + 1)?]) as usize;
                    let child = u32::from_be_bytes(page.get(pointer..pointer + 4)?.try_into().ok()?);
                    if self.walk(child, depth + 1, visit)? {
                        return Some(true);
                    }
                }
                let right = u32::from_be_bytes(page.get(base + 8..base + 12)?.try_into().ok()?);
                self.walk(right, depth + 1, visit)
            }
            _ => None,
        }
    }

    /// 넘침 페이지까지 이어 붙인 행 전체.
    fn full_payload(&mut self, cell: &Cell<'_>) -> Option<Vec<u8>> {
        if cell.total > MAX_ROW_BYTES {
            return None;
        }
        let mut out = Vec::with_capacity(cell.total);
        out.extend_from_slice(cell.local);
        let mut next = cell.overflow;
        let mut hops = 0;
        while out.len() < cell.total {
            hops += 1;
            if next == 0 || hops > MAX_OVERFLOW_PAGES {
                return None;
            }
            let page = self.read_page(next)?;
            next = u32::from_be_bytes(page.get(0..4)?.try_into().ok()?);
            let take = (cell.total - out.len()).min(self.usable - 4);
            out.extend_from_slice(page.get(4..4 + take)?);
        }
        Some(out)
    }

    /// 표 이름으로 뿌리 페이지를 찾고, 앞쪽 열 이름이 기대와 같을 때만 쓴다.
    fn table_root(&mut self, name: &str, columns: &[&str]) -> Option<u32> {
        let mut found: Option<u32> = None;
        self.walk(1, 0, &mut |_, cell| {
            if cell.total != cell.local.len() {
                return Flow::Next;
            }
            let Some(record) = Record::parse(cell.local) else {
                return Flow::Next;
            };
            let (Some((k0, b0)), Some((k1, b1)), Some((k3, b3)), Some((k4, b4))) =
                (record.field(0), record.field(1), record.field(3), record.field(4))
            else {
                return Flow::Next;
            };
            if as_text(k0, b0) == Some("table")
                && as_text(k1, b1) == Some(name)
                && as_text(k4, b4).is_some_and(|sql| columns_match(sql, columns))
            {
                if let Some(root) = as_int(k3, b3).and_then(|value| u32::try_from(value).ok()) {
                    found = Some(root);
                    return Flow::Stop;
                }
            }
            Flow::Next
        })?;
        found
    }

    fn find_png(&mut self, page_url: &str, host: &str) -> Option<Vec<u8>> {
        let mapping = self.table_root("icon_mapping", &["id", "page_url", "icon_id"])?;
        let bitmaps = self.table_root(
            "favicon_bitmaps",
            &["id", "icon_id", "last_updated", "image_data", "width", "height"],
        )?;
        let wanted = trim_url(page_url);
        let mut exact: Vec<i64> = Vec::new();
        let mut same_host: Vec<i64> = Vec::new();
        self.walk(mapping, 0, &mut |_, cell| {
            let Some(record) = Record::parse(cell.local) else {
                return Flow::Next;
            };
            let (Some((kind_url, bytes_url)), Some((kind_icon, bytes_icon))) =
                (record.field(1), record.field(2))
            else {
                return Flow::Next;
            };
            let (Some(url), Some(icon)) = (as_text(kind_url, bytes_url), as_int(kind_icon, bytes_icon))
            else {
                return Flow::Next;
            };
            if trim_url(url) == wanted {
                if exact.len() < MAX_MATCHED_IDS {
                    exact.push(icon);
                }
            } else if same_host.len() < MAX_MATCHED_IDS && host_of(url).as_deref() == Some(host) {
                same_host.push(icon);
            }
            Flow::Next
        })?;
        let ids = if exact.is_empty() { same_host } else { exact };
        if ids.is_empty() {
            return None;
        }
        let mut best: Option<(i64, Vec<u8>)> = None;
        self.walk(bitmaps, 0, &mut |db, cell| {
            let Some(record) = Record::parse(cell.local) else {
                return Flow::Next;
            };
            let Some((kind_icon, bytes_icon)) = record.field(1) else {
                return Flow::Next;
            };
            if !as_int(kind_icon, bytes_icon).is_some_and(|icon| ids.contains(&icon)) {
                return Flow::Next;
            }
            let Some(blob_kind) = record.types.get(3).copied() else {
                return Flow::Next;
            };
            if blob_kind < 12
                || blob_kind % 2 == 1
                || ((blob_kind - 12) / 2) as usize > MAX_ICON_BYTES
            {
                return Flow::Next;
            }
            let Some(full) = db.full_payload(cell) else {
                return Flow::Next;
            };
            let Some(row) = Record::parse(&full) else {
                return Flow::Next;
            };
            let (Some((_, blob)), Some((kind_width, bytes_width))) = (row.field(3), row.field(4))
            else {
                return Flow::Next;
            };
            let Some(width) = as_int(kind_width, bytes_width) else {
                return Flow::Next;
            };
            if !blob.starts_with(&PNG_SIGNATURE) || !(16..=128).contains(&width) {
                return Flow::Next;
            }
            let score = (width - 32).abs();
            if best.as_ref().map_or(true, |(current, _)| score < *current) {
                best = Some((score, blob.to_vec()));
            }
            Flow::Next
        })?;
        best.map(|(_, png)| png)
    }
}

fn columns_match(sql: &str, expected: &[&str]) -> bool {
    let Some(open) = sql.find('(') else {
        return false;
    };
    let names: Vec<&str> = sql[open + 1..]
        .split(',')
        .map(|part| part.split_whitespace().next().unwrap_or(""))
        .collect();
    names.len() >= expected.len()
        && names
            .iter()
            .zip(expected)
            .all(|(found, want)| found.eq_ignore_ascii_case(want))
}

/// 주소 비교용: 조각(#)·끝 슬래시를 없애고 스킴·호스트만 소문자로 맞춘다.
fn trim_url(raw: &str) -> String {
    let url = raw.split('#').next().unwrap_or(raw).trim();
    let (head, tail) = match url.find("://") {
        Some(scheme_end) => match url[scheme_end + 3..].find('/') {
            Some(slash) => url.split_at(scheme_end + 3 + slash),
            None => (url, ""),
        },
        None => (url, ""),
    };
    format!("{}{}", head.to_ascii_lowercase(), tail)
        .trim_end_matches('/')
        .to_string()
}

fn host_of(raw: &str) -> Option<String> {
    let rest = raw.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?.to_ascii_lowercase();
    let host = host.trim_start_matches("www.").to_string();
    (!host.is_empty()).then_some(host)
}

fn favicon_files() -> Vec<PathBuf> {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return Vec::new();
    };
    let local = PathBuf::from(local);
    let mut files = Vec::new();
    for base in [
        local.join("Microsoft").join("Edge").join("User Data"),
        local.join("Google").join("Chrome").join("User Data"),
    ] {
        let Ok(entries) = std::fs::read_dir(&base) else {
            continue;
        };
        let mut profiles: Vec<PathBuf> = entries
            .flatten()
            .filter(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                name == "Default" || name.starts_with("Profile ")
            })
            .map(|entry| entry.path())
            .collect();
        profiles.sort();
        profiles.truncate(MAX_PROFILES);
        for profile in profiles {
            let file = profile.join("Favicons");
            if file.is_file() {
                files.push(file);
            }
        }
    }
    files
}

/// 이 PC 브라우저가 이미 가진 그 주소의 그림(PNG)을 data 주소로. 없으면 None.
pub fn icon_data_url(page_url: &str) -> Option<String> {
    let host = host_of(page_url)?;
    for file in favicon_files() {
        if let Some(png) = Db::open(&file).and_then(|mut db| db.find_png(page_url, &host)) {
            return Some(format!(
                "data:image/png;base64,{}",
                crate::shell_icon::base64_encode(&png)
            ));
        }
    }
    None
}
