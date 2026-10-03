use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "admin-tools.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedFlag {
    enabled: bool,
}

pub fn policy_blocks(_dir: &Path) -> bool {
    false
}

pub fn allowed(dir: &Path) -> bool {
    if policy_blocks(dir) {
        return false;
    }
    saved_enabled(dir)
}

pub fn saved_enabled(dir: &Path) -> bool {
    let text = match fs::read_to_string(dir.join(FILE_NAME)) {
        Ok(text) => text,
        Err(_) => return false,
    };
    match serde_json::from_str::<SavedFlag>(&text) {
        Ok(flag) => flag.enabled,
        Err(_) => false,
    }
}

pub fn write_enabled(dir: &Path, enabled: bool) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|_| "관리자 도구 설정을 저장하지 못했습니다.".to_string())?;
    let body = serde_json::to_string(&SavedFlag { enabled })
        .map_err(|_| "관리자 도구 설정을 저장하지 못했습니다.".to_string())?;
    fs::write(dir.join(FILE_NAME), body)
        .map_err(|_| "관리자 도구 설정을 저장하지 못했습니다.".to_string())
}

pub fn caller_result(label: &str, dir: &Path) -> Result<(), &'static str> {
    if label != "main" {
        return Err("denied");
    }
    if !allowed(dir) {
        return Err("disabled");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_broken_file_stays_off() {
        let dir = std::env::temp_dir().join(format!("edulauncher-admin-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(!allowed(&dir));
        fs::write(dir.join(FILE_NAME), "{").unwrap();
        assert!(!allowed(&dir));
        fs::write(dir.join(FILE_NAME), "{\"enabled\":false}").unwrap();
        assert!(!allowed(&dir));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn other_window_is_denied_even_when_on() {
        let dir = std::env::temp_dir().join(format!("edulauncher-admin-win-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        write_enabled(&dir, true).unwrap();
        assert_eq!(caller_result("work-map", &dir), Err("denied"));
        assert_eq!(caller_result("main", &dir), Ok(()));
        write_enabled(&dir, false).unwrap();
        assert_eq!(caller_result("main", &dir), Err("disabled"));
        let _ = fs::remove_dir_all(&dir);
    }
}
