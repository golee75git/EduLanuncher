//! 폴더 검사의 판정. 속성과 태그만 보고, 파일 본문은 열지 않는다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const MAX_DEPTH: u32 = 20;
pub const MAX_LISTED: usize = 50_000;
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;

const ATTR_DIRECTORY: u32 = 16;
const ATTR_HIDDEN: u32 = 2;
const ATTR_SYSTEM: u32 = 4;
const ATTR_OFFLINE: u32 = 4096;
const ATTR_REPARSE: u32 = 1024;
const ATTR_RECALL_OPEN: u32 = 262144;
const ATTR_RECALL_DATA: u32 = 4194304;
const TAG_SYMLINK: u32 = 2684354572;
const TAG_MOUNT: u32 = 2684354563;
const TAG_CLOUD: u32 = 2415919130;
const TAG_CLOUD_F: u32 = 2415980570;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirKind {
    Enter,
    Link,
    OtherLink,
    System,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileKind {
    Scan,
    CloudOnly,
    HiddenSystem,
    Link,
    Hwp,
    Image,
    Unsupported,
    TooLarge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaceAsk {
    Start,
    Slow,
    Removable,
    Network,
    System,
    Root,
    Link,
}

impl PlaceAsk {
    pub fn code(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Slow => "slow",
            Self::Removable => "removable",
            Self::Network => "network",
            Self::System => "system",
            Self::Root => "root",
            Self::Link => "link",
        }
    }

}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WalkCounts {
    pub listed: u32,
    pub scan: u32,
    pub cloud_files: u32,
    pub link_dirs: u32,
    pub other_links: u32,
    pub system_dirs: u32,
    pub hidden_system: u32,
    pub unsupported: u32,
    pub hwp: u32,
    pub images: u32,
    pub too_large: u32,
    pub truncated: bool,
    pub stopped: bool,
}

#[derive(Clone, Debug)]
pub struct SeenFile {
    pub path: PathBuf,
    pub name: String,
    pub ext: String,
    pub place: String,
    pub kind: FileKind,
}

pub fn plain_text(path: &Path) -> String {
    let text = path.to_string_lossy().replace('/', "\\");
    strip_prefix(&text).trim_end_matches('\\').to_string()
}

pub fn strip_prefix(path: &str) -> String {
    let text = path.trim();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest.trim_start_matches('\\'));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    text.to_string()
}

pub fn prefixed(plain: &str) -> PathBuf {
    let owned = strip_prefix(plain);
    let plain = owned.trim_end_matches('\\');
    if plain.starts_with(r"\\") {
        PathBuf::from(format!(r"\\?\UNC\{}", plain.trim_start_matches('\\')))
    } else {
        PathBuf::from(format!(r"\\?\{plain}"))
    }
}

pub fn display_place(folder_name: &str, relative: &str) -> String {
    let folder = folder_name.trim().trim_matches('\\');
    let relative_owned = strip_prefix(relative);
    let relative = relative_owned.trim_matches('\\');
    let joined = if relative.is_empty() {
        folder.to_string()
    } else if folder.is_empty() {
        relative.to_string()
    } else {
        format!("{folder}\\{relative}")
    };
    let joined = strip_prefix(&joined);
    shrink_middle(&joined, 80)
}

pub fn classify_dir(attrs: u32, tag: u32, name: &str, under_system: bool) -> DirKind {
    if under_system || is_system_name(name) {
        return DirKind::System;
    }
    if attrs & ATTR_REPARSE != 0 {
        if tag == TAG_SYMLINK || tag == TAG_MOUNT {
            return DirKind::Link;
        }
        if is_cloud_tag(tag) {
            return DirKind::Enter;
        }
        return DirKind::OtherLink;
    }
    DirKind::Enter
}

pub fn classify_file(attrs: u32, tag: u32, size: u64, ext: &str) -> FileKind {
    if attrs & (ATTR_RECALL_DATA | ATTR_RECALL_OPEN | ATTR_OFFLINE) != 0 {
        return FileKind::CloudOnly;
    }
    if attrs & ATTR_HIDDEN != 0 && attrs & ATTR_SYSTEM != 0 {
        return FileKind::HiddenSystem;
    }
    if attrs & ATTR_REPARSE != 0 && tag == TAG_SYMLINK {
        return FileKind::Link;
    }
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    match ext.as_str() {
        "hwp" => FileKind::Hwp,
        "jpg" | "jpeg" | "png" => FileKind::Image,
        "txt" | "csv" | "xlsx" | "docx" | "hwpx" | "pdf" if size > MAX_BYTES => FileKind::TooLarge,
        "txt" | "csv" | "xlsx" | "docx" | "hwpx" | "pdf" => FileKind::Scan,
        _ => FileKind::Unsupported,
    }
}

pub fn under_known(path: &str, roots: &[String]) -> bool {
    let path = norm(path);
    roots.iter().any(|root| {
        let root = norm(root);
        !root.is_empty() && (path == root || path.starts_with(&(root + "\\")))
    })
}

pub fn is_drive_root(path: &str) -> bool {
    let path = norm(path);
    let bytes = path.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

pub fn is_unc(path: &str) -> bool {
    let path = strip_prefix(path);
    path.starts_with(r"\\") && !path.starts_with(r"\\?\")
}

fn is_system_name(name: &str) -> bool {
    let key = name.trim().to_ascii_lowercase();
    key == "$recycle.bin" || key == "system volume information"
}

fn is_cloud_tag(tag: u32) -> bool {
    tag == TAG_CLOUD || (tag > TAG_CLOUD && tag <= TAG_CLOUD_F && (tag - TAG_CLOUD) % 4096 == 0)
}

fn norm(path: &str) -> String {
    strip_prefix(path).trim().trim_end_matches('\\').to_ascii_lowercase()
}

fn shrink_middle(text: &str, max_chars: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    let head = keep / 2;
    let tail = keep - head;
    let mut out: String = chars.iter().take(head).collect();
    out.push('…');
    out.extend(chars.iter().skip(chars.len().saturating_sub(tail)));
    out
}

pub struct WalkOpts<'a> {
    pub subfolders: bool,
    pub known: &'a [String],
    pub folder_name: &'a str,
}

pub fn tally(kind: FileKind, counts: &mut WalkCounts) {
    match kind {
        FileKind::Scan => counts.scan = counts.scan.saturating_add(1),
        FileKind::CloudOnly => counts.cloud_files = counts.cloud_files.saturating_add(1),
        FileKind::HiddenSystem => counts.hidden_system = counts.hidden_system.saturating_add(1),
        FileKind::Link => counts.link_dirs = counts.link_dirs.saturating_add(1),
        FileKind::Hwp => counts.hwp = counts.hwp.saturating_add(1),
        FileKind::Image => counts.images = counts.images.saturating_add(1),
        FileKind::Unsupported => counts.unsupported = counts.unsupported.saturating_add(1),
        FileKind::TooLarge => counts.too_large = counts.too_large.saturating_add(1),
    }
}

#[cfg(windows)]
pub fn known_roots() -> Vec<String> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{
        FOLDERID_LocalAppData, FOLDERID_ProgramData, FOLDERID_ProgramFiles, FOLDERID_ProgramFilesX86,
        FOLDERID_RoamingAppData, FOLDERID_Windows, KNOWN_FOLDER_FLAG,
    };
    let ids = [
        &FOLDERID_Windows,
        &FOLDERID_ProgramFiles,
        &FOLDERID_ProgramFilesX86,
        &FOLDERID_ProgramData,
        &FOLDERID_RoamingAppData,
        &FOLDERID_LocalAppData,
    ];
    ids.iter().filter_map(|id| unsafe { known_string(id, KNOWN_FOLDER_FLAG(0), CoTaskMemFree) }).collect()
}

#[cfg(windows)]
unsafe fn known_string(
    id: &windows_core::GUID,
    flag: windows::Win32::UI::Shell::KNOWN_FOLDER_FLAG,
    free: unsafe fn(Option<*const core::ffi::c_void>),
) -> Option<String> {
    let pw = windows::Win32::UI::Shell::SHGetKnownFolderPath(id, flag, None).ok()?;
    let mut len = 0usize;
    while !pw.0.is_null() && *pw.0.add(len) != 0 {
        len += 1;
        if len > 1024 {
            break;
        }
    }
    let text = String::from_utf16_lossy(std::slice::from_raw_parts(pw.0, len));
    free(Some(pw.0 as *const core::ffi::c_void));
    Some(plain_text(Path::new(&text)))
}

#[cfg(windows)]
pub fn windows_drive() -> Option<char> {
    known_roots().into_iter().find(|path| path.len() >= 2).and_then(|path| {
        let bytes = path.as_bytes();
        bytes.first().filter(|ch| ch.is_ascii_alphabetic()).map(|ch| (*ch as char).to_ascii_uppercase())
    })
}

#[cfg(windows)]
fn drive_type(plain: &str) -> u32 {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    let root = if is_unc(plain) {
        let owned = strip_prefix(plain);
        let rest = owned.trim_start_matches('\\');
        let mut parts = rest.split('\\');
        match (parts.next(), parts.next()) {
            (Some(server), Some(share)) if !server.is_empty() && !share.is_empty() => format!(r"\\{server}\{share}\"),
            _ => return 4,
        }
    } else {
        let bytes = plain.as_bytes();
        if bytes.len() < 2 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
            return 0;
        }
        format!("{}:\\", bytes[0] as char)
    };
    let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) }
}

#[cfg(windows)]
pub fn judge(plain: &str, known: &[String]) -> PlaceAsk {
    let plain = plain_text(Path::new(plain));
    if under_known(&plain, known) {
        return PlaceAsk::System;
    }
    if root_is_blocked_link(&plain) {
        return PlaceAsk::Link;
    }
    if is_unc(&plain) || drive_type(&plain) == 4 {
        return PlaceAsk::Network;
    }
    if drive_type(&plain) == 2 {
        return PlaceAsk::Removable;
    }
    if is_drive_root(&plain) {
        let letter = plain.chars().next().unwrap_or('c').to_ascii_uppercase();
        if windows_drive() == Some(letter) {
            return PlaceAsk::Root;
        }
        return PlaceAsk::Slow;
    }
    PlaceAsk::Start
}

#[cfg(windows)]
fn root_is_blocked_link(plain: &str) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FIND_FIRST_EX_LARGE_FETCH, WIN32_FIND_DATAW,
    };
    let path = Path::new(plain);
    let Some(parent) = path.parent() else {
        return false;
    };
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if parent.as_os_str().is_empty() {
        return false;
    }
    let pattern = format!("{}\\*", plain_text(parent));
    let wide: Vec<u16> = prefixed(&pattern).as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut data = WIN32_FIND_DATAW::default();
    let handle = unsafe {
        FindFirstFileExW(
            PCWSTR(wide.as_ptr()),
            FindExInfoBasic,
            &mut data as *mut _ as *mut core::ffi::c_void,
            FindExSearchNameMatch,
            None,
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };
    let Ok(handle) = handle else {
        return false;
    };
    let mut blocked = false;
    loop {
        let found = wide_name(&data.cFileName);
        if found.eq_ignore_ascii_case(name) && data.dwFileAttributes & ATTR_REPARSE != 0 {
            let tag = data.dwReserved0;
            blocked = tag == TAG_SYMLINK || tag == TAG_MOUNT;
            break;
        }
        if find_next(handle, &mut data).is_err() {
            break;
        }
    }
    let _ = unsafe { FindClose(handle) };
    blocked
}

#[cfg(windows)]
fn find_next(
    handle: windows::Win32::Foundation::HANDLE,
    data: &mut windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW,
) -> windows_core::Result<()> {
    use windows::Win32::Storage::FileSystem::FindNextFileW;
    unsafe { FindNextFileW(handle, data) }
}

#[cfg(windows)]
pub fn walk(root: &Path, opts: &WalkOpts<'_>, stop: &AtomicBool, mut on_listed: impl FnMut(u32)) -> (Vec<SeenFile>, WalkCounts) {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW, FIND_FIRST_EX_LARGE_FETCH,
        WIN32_FIND_DATAW,
    };
    let mut counts = WalkCounts::default();
    let mut files = Vec::new();
    let mut stack = vec![(plain_text(root), 0u32, String::new())];
    while let Some((dir, depth, relative)) = stack.pop() {
        if stop.load(Ordering::Relaxed) {
            counts.stopped = true;
            break;
        }
        let pattern = format!("{dir}\\*");
        let wide: Vec<u16> = prefixed(&pattern).as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut data = WIN32_FIND_DATAW::default();
        let handle = unsafe {
            FindFirstFileExW(
                PCWSTR(wide.as_ptr()),
                FindExInfoBasic,
                &mut data as *mut _ as *mut core::ffi::c_void,
                FindExSearchNameMatch,
                None,
                FIND_FIRST_EX_LARGE_FETCH,
            )
        };
        let Ok(handle) = handle else {
            continue;
        };
        loop {
            if stop.load(Ordering::Relaxed) {
                counts.stopped = true;
                break;
            }
            let name = wide_name(&data.cFileName);
            if name != "." && name != ".." && !name.is_empty() {
                let child = format!("{dir}\\{name}");
                let child_rel = if relative.is_empty() { name.clone() } else { format!("{relative}\\{name}") };
                let attrs = data.dwFileAttributes;
                let tag = if attrs & ATTR_REPARSE != 0 { data.dwReserved0 } else { 0 };
                if attrs & ATTR_DIRECTORY != 0 {
                    match classify_dir(attrs, tag, &name, under_known(&child, opts.known)) {
                        DirKind::Enter if opts.subfolders && depth < MAX_DEPTH => stack.push((child, depth + 1, child_rel)),
                        DirKind::Enter => {}
                        DirKind::Link => counts.link_dirs = counts.link_dirs.saturating_add(1),
                        DirKind::OtherLink => counts.other_links = counts.other_links.saturating_add(1),
                        DirKind::System => counts.system_dirs = counts.system_dirs.saturating_add(1),
                    }
                } else {
                    counts.listed = counts.listed.saturating_add(1);
                    if counts.listed as usize > MAX_LISTED {
                        counts.truncated = true;
                        counts.listed = MAX_LISTED as u32;
                        break;
                    }
                    let size = ((data.nFileSizeHigh as u64) << 32) | data.nFileSizeLow as u64;
                    let ext = Path::new(&name).extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
                    let kind = classify_file(attrs, tag, size, &ext);
                    tally(kind, &mut counts);
                    if matches!(kind, FileKind::Scan | FileKind::Hwp | FileKind::Image | FileKind::TooLarge) {
                        files.push(SeenFile {
                            path: PathBuf::from(&child),
                            name: name.chars().take(120).collect(),
                            ext,
                            place: display_place(opts.folder_name, &child_rel),
                            kind,
                        });
                    }
                    if counts.listed % 32 == 0 {
                        on_listed(counts.listed);
                    }
                }
            }
            if unsafe { FindNextFileW(handle, &mut data) }.is_err() {
                break;
            }
        }
        let _ = unsafe { FindClose(handle) };
        if counts.truncated || counts.stopped {
            break;
        }
    }
    (files, counts)
}

#[cfg(windows)]
fn wide_name(raw: &[u16]) -> String {
    let end = raw.iter().position(|unit| *unit == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn dir_and_file_rules() {
        assert_eq!(classify_dir(ATTR_REPARSE, TAG_SYMLINK, "link", false), DirKind::Link);
        assert_eq!(classify_dir(ATTR_REPARSE, TAG_MOUNT, "junction", false), DirKind::Link);
        assert_eq!(classify_dir(ATTR_REPARSE, TAG_CLOUD, "OneDrive", false), DirKind::Enter);
        assert_eq!(classify_dir(ATTR_REPARSE, 1, "other", false), DirKind::OtherLink);
        assert_eq!(classify_dir(0, 0, "$Recycle.Bin", false), DirKind::System);
        assert_eq!(classify_file(ATTR_RECALL_DATA, TAG_CLOUD, 10, "xlsx"), FileKind::CloudOnly);
        assert_eq!(classify_file(ATTR_RECALL_OPEN, 0, 10, "pdf"), FileKind::CloudOnly);
        assert_eq!(classify_file(ATTR_OFFLINE, 0, 10, "docx"), FileKind::CloudOnly);
        assert_eq!(classify_file(ATTR_REPARSE, TAG_CLOUD, 10, "xlsx"), FileKind::Scan);
        assert_eq!(classify_file(ATTR_HIDDEN | ATTR_SYSTEM, 0, 10, "txt"), FileKind::HiddenSystem);
        assert_eq!(classify_file(ATTR_REPARSE, TAG_SYMLINK, 10, "txt"), FileKind::Link);
        assert_eq!(classify_file(0, 0, 10, "dat"), FileKind::Unsupported);
        assert_eq!(classify_file(0, 0, 10, "hwp"), FileKind::Hwp);
        assert_eq!(classify_file(0, 0, MAX_BYTES + 1, "pdf"), FileKind::TooLarge);
    }

    #[test]
    fn known_folder_and_prefix() {
        let roots = vec![r"D:\Windows".to_string()];
        assert!(under_known(r"D:\Windows\System32\a.txt", &roots));
        assert!(!under_known(r"D:\Windows.old\a.txt", &roots));
        assert!(is_drive_root(r"C:\"));
        assert!(!is_drive_root(r"C:\Users"));
        assert_eq!(strip_prefix(r"\\?\C:\temp\a.txt"), r"C:\temp\a.txt");
        assert_eq!(strip_prefix(r"\\?\UNC\server\share\a.txt"), r"\\server\share\a.txt");
        let shown = display_place("학생지원", r"2026\명단.xlsx");
        assert_eq!(shown, r"학생지원\2026\명단.xlsx");
        assert!(!shown.contains(r"\\?\"));
        let long = display_place("폴더", &"가".repeat(200));
        assert!(long.chars().count() <= 80);
        assert!(!long.contains(r"\\?\"));
    }

    #[cfg(windows)]
    #[test]
    fn long_path_is_listed_without_prefix_and_system_child_is_skipped() {
        let root = std::env::temp_dir().join(format!("privacy-long-{}", std::process::id()));
        let _ = fs::remove_dir_all(prefixed(&plain_text(&root)));
        fs::create_dir_all(&root).unwrap();
        let mut deep = root.clone();
        while plain_text(&deep).len() < 280 {
            deep.push("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
            fs::create_dir_all(prefixed(&plain_text(&deep))).unwrap();
        }
        let file = deep.join("가짜.txt");
        fs::write(prefixed(&plain_text(&file)), "가짜 테스트 데이터").unwrap();
        let stop = AtomicBool::new(false);
        let opts = WalkOpts { subfolders: true, known: &[], folder_name: "긴폴더" };
        let (files, counts) = walk(&root, &opts, &stop, |_| {});
        assert!(counts.scan >= 1, "listed {}", counts.listed);
        assert!(files.iter().any(|item| item.kind == FileKind::Scan && !item.place.contains(r"\\?\")));
        let sys = root.join("System");
        fs::create_dir_all(sys.join("nested")).unwrap();
        fs::write(sys.join("nested").join("skip.txt"), "가짜").unwrap();
        let known = vec![plain_text(&sys)];
        let opts = WalkOpts { subfolders: true, known: &known, folder_name: "긴폴더" };
        let (files, counts) = walk(&root, &opts, &stop, |_| {});
        assert!(counts.system_dirs >= 1);
        assert!(files.iter().all(|item| !item.path.starts_with(&sys)));
        let _ = fs::remove_dir_all(prefixed(&plain_text(&root)));
    }

    #[cfg(windows)]
    #[test]
    fn mixed_tree_counts_and_junction_is_not_walked() {
        let root = std::env::temp_dir().join(format!("privacy-tree-{}", std::process::id()));
        let _ = fs::remove_dir_all(prefixed(&plain_text(&root)));
        let leaf = root.join("a").join("b").join("c");
        fs::create_dir_all(&leaf).unwrap();
        fs::write(root.join("note.txt"), "가짜 테스트 데이터").unwrap();
        fs::write(leaf.join("row.csv"), "이름\n가짜\n").unwrap();
        fs::write(root.join("old.hwp"), "가짜 테스트 데이터").unwrap();
        fs::write(root.join("skip.dat"), "가짜 테스트 데이터").unwrap();
        let outside = std::env::temp_dir().join(format!("privacy-junction-target-{}", std::process::id()));
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("hidden.txt"), "가짜 테스트 데이터").unwrap();
        let link = root.join("joined");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link.display().to_string(), &outside.display().to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        let stop = AtomicBool::new(false);
        let opts = WalkOpts { subfolders: true, known: &[], folder_name: "가짜폴더" };
        let (files, counts) = walk(&root, &opts, &stop, |_| {});
        assert_eq!(counts.scan, 2);
        assert_eq!(counts.hwp, 1);
        assert_eq!(counts.unsupported, 1);
        if made {
            assert!(counts.link_dirs >= 1, "junction counted");
            assert!(files.iter().all(|item| item.name != "hidden.txt"));
        } else {
            eprintln!("junction skipped");
        }
        let _ = fs::remove_dir_all(prefixed(&plain_text(&root)));
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn depth_and_count_constants_differ_from_document_search() {
        assert_eq!(MAX_DEPTH, 20);
        assert_eq!(MAX_LISTED, 50_000);
    }
}
