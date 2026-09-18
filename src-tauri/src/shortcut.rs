use std::path::{Path, PathBuf};

pub fn is_shortcut(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"))
}

pub fn is_exe(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
}

pub fn display_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| name.chars().take(80).collect())
        .or_else(|| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.chars().take(80).collect())
        })
        .unwrap_or_else(|| "바로가기".into())
}

pub fn resolve_shortcut_target(path: &Path) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        resolve_shortcut_target_windows(path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

#[cfg(windows)]
fn resolve_shortcut_target_windows(path: &Path) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, IPersistFile,
        STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistFile = link.cast().ok()?;
        persist.Load(PCWSTR(wide.as_ptr()), STGM_READ).ok()?;
        let mut buffer = [0u16; 32768];
        let mut find_data = WIN32_FIND_DATAW::default();
        link.GetPath(&mut buffer, &mut find_data, 0).ok()?;
        let end = buffer.iter().position(|&ch| ch == 0).unwrap_or(buffer.len());
        if end == 0 {
            return None;
        }
        let target = String::from_utf16_lossy(&buffer[..end]);
        let trimmed = target.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    }
}
