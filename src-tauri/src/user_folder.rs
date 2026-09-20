use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

const MAX_DEPTH: u32 = 3;
const MAX_VISIT: usize = 8000;
const MAX_QUERY: usize = 80;
const MIN_QUERY: usize = 2;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFolderHit {
    name: String,
    path: String,
    kind: String,
    zone: String,
}

struct Root {
    zone: &'static str,
    names: &'static [&'static str],
}

const CORE_ROOTS: &[Root] = &[
    Root {
        zone: "바탕화면",
        names: &["Desktop", "바탕 화면", "바탕화면"],
    },
    Root {
        zone: "문서",
        names: &["Documents", "문서", "My Documents"],
    },
    Root {
        zone: "다운로드",
        names: &["Downloads", "다운로드"],
    },
];

const MEDIA_ROOTS: &[Root] = &[
    Root {
        zone: "사진",
        names: &["Pictures", "사진"],
    },
    Root {
        zone: "음악",
        names: &["Music", "음악"],
    },
    Root {
        zone: "동영상",
        names: &["Videos", "동영상"],
    },
];

fn fold_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn needle_ok(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.chars().count() < MIN_QUERY {
        return Err("두 글자 이상 입력하세요.".into());
    }
    if trimmed.chars().count() > MAX_QUERY {
        return Err("검색어가 너무 깁니다.".into());
    }
    if trimmed.chars().any(|ch| matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err("파일 이름만 찾습니다.".into());
    }
    Ok(fold_name(trimmed))
}

fn profile_dir() -> Result<PathBuf, String> {
    let profile = std::env::var("USERPROFILE").map_err(|_| "사용자 폴더를 찾지 못했습니다.")?;
    if profile.is_empty() || profile.contains('\0') {
        return Err("사용자 폴더가 올바르지 않습니다.".into());
    }
    Ok(PathBuf::from(profile))
}

fn path_inside(root: &Path, candidate: &Path) -> bool {
    let strip = |value: &Path| {
        value
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .replace('/', "\\")
            .to_ascii_lowercase()
    };
    let root_s = strip(root);
    let child = strip(candidate);
    child == root_s || child.starts_with(&(root_s.clone() + "\\"))
}

fn existing_root(profile: &Path, names: &[&str]) -> Option<PathBuf> {
    for name in names {
        let candidate = profile.join(name);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

fn name_score(needle: &str, file_name: &str) -> u32 {
    let folded = fold_name(file_name);
    if folded.is_empty() || needle.is_empty() {
        return 0;
    }
    if folded == *needle {
        3
    } else if folded.starts_with(needle) {
        2
    } else if folded.contains(needle) {
        1
    } else {
        0
    }
}

fn walk(
    profile: &Path,
    dir: &Path,
    zone: &str,
    depth: u32,
    needle: &str,
    halt: &AtomicBool,
    visited: &mut usize,
    hits: &mut Vec<(u32, UserFolderHit)>,
    limit: usize,
) {
    if halt.load(Ordering::SeqCst) || hits.len() >= limit || depth > MAX_DEPTH || *visited >= MAX_VISIT {
        return;
    }
    if !path_inside(profile, dir) {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if halt.load(Ordering::SeqCst) || hits.len() >= limit || *visited >= MAX_VISIT {
            return;
        }
        *visited += 1;
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if !path_inside(profile, &path) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let score = name_score(needle, &name);
        if score > 0 {
            hits.push((
                score,
                UserFolderHit {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    kind: if meta.is_dir() { "folder".into() } else { "file".into() },
                    zone: zone.into(),
                },
            ));
        }
        if meta.is_dir() {
            walk(
                profile,
                &path,
                zone,
                depth + 1,
                needle,
                halt,
                visited,
                hits,
                limit,
            );
        }
    }
}

pub fn find_names(
    query: &str,
    include_media: bool,
    limit: usize,
    halt: &AtomicBool,
) -> Result<Vec<UserFolderHit>, String> {
    halt.store(false, Ordering::SeqCst);
    let needle = needle_ok(query)?;
    let cap = limit.clamp(1, 40);
    let profile = profile_dir()?;
    let mut roots: Vec<(&str, PathBuf)> = Vec::new();
    for root in CORE_ROOTS {
        if let Some(path) = existing_root(&profile, root.names) {
            roots.push((root.zone, path));
        }
    }
    if include_media {
        for root in MEDIA_ROOTS {
            if let Some(path) = existing_root(&profile, root.names) {
                roots.push((root.zone, path));
            }
        }
    }
    let mut ranked: Vec<(u32, UserFolderHit)> = Vec::new();
    let mut visited = 0usize;
    for (zone, dir) in roots {
        walk(
            &profile,
            &dir,
            zone,
            1,
            &needle,
            halt,
            &mut visited,
            &mut ranked,
            cap,
        );
        if halt.load(Ordering::SeqCst) || ranked.len() >= cap {
            break;
        }
    }
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    Ok(ranked.into_iter().take(cap).map(|(_, hit)| hit).collect())
}
