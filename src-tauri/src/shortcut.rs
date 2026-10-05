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

const SEND_TO_LINK_NAME: &str = "AILauncher.lnk";
const OLD_SEND_TO_LINK_NAME: &str = "교육업무 런처.lnk";

pub fn write_send_to_link(exe: &Path) -> Option<()> {
    #[cfg(windows)]
    {
        write_send_to_link_windows(exe)
    }
    #[cfg(not(windows))]
    {
        let _ = exe;
        None
    }
}

#[cfg(windows)]
fn write_send_to_link_windows(exe: &Path) -> Option<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, IPersistFile,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    if !exe.is_file() {
        return None;
    }
    let appdata = std::env::var_os("APPDATA")?;
    if appdata.is_empty() || appdata.to_string_lossy().contains('\0') {
        return None;
    }
    let folder = PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("SendTo");
    if !folder.is_dir() {
        return None;
    }
    let dest = folder.join(SEND_TO_LINK_NAME);
    if dest.file_name()?.to_str()? != SEND_TO_LINK_NAME {
        return None;
    }
    let parent = dest.parent()?;
    if parent != folder {
        return None;
    }
    let exe_wide: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let dest_wide: Vec<u16> = dest.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        link.SetPath(PCWSTR(exe_wide.as_ptr())).ok()?;
        let _ = link.SetIconLocation(PCWSTR(exe_wide.as_ptr()), 0);
        let persist: IPersistFile = link.cast().ok()?;
        persist.Save(PCWSTR(dest_wide.as_ptr()), true).ok()?;
    }
    let old = folder.join(OLD_SEND_TO_LINK_NAME);
    if old.is_file() && link_points_at_launcher(&old) {
        let _ = std::fs::remove_file(old);
    }
    Some(())
}

pub fn retire_old_launcher_links() {
    #[cfg(windows)]
    {
        let mut paths = Vec::new();
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            paths.push(PathBuf::from(profile).join("Desktop").join("EduLauncher.lnk"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let menu = PathBuf::from(&appdata).join("Microsoft").join("Windows").join("Start Menu").join("Programs");
            paths.push(menu.join("EduLauncher.lnk"));
            paths.push(menu.join("Startup").join("EduLauncher.lnk"));
            paths.push(
                PathBuf::from(appdata)
                    .join("Microsoft")
                    .join("Windows")
                    .join("SendTo")
                    .join(OLD_SEND_TO_LINK_NAME),
            );
        }
        for path in paths {
            if path.is_file() && link_points_at_launcher(&path) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn link_points_at_launcher(path: &Path) -> bool {
    resolve_shortcut_target(path)
        .and_then(|target| target.file_name().map(|name| name.to_string_lossy().eq_ignore_ascii_case("edulauncher.exe")))
        .unwrap_or(false)
}
