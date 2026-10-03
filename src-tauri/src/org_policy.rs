use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgFlags {
    pub disable_admin_tools: bool,
    pub disable_document_index: bool,
    pub disable_startup_update: bool,
    pub disable_startup_knowledge: bool,
}

impl OrgFlags {
    pub fn open() -> Self {
        Self {
            disable_admin_tools: false,
            disable_document_index: false,
            disable_startup_update: false,
            disable_startup_knowledge: false,
        }
    }
}

#[cfg(test)]
thread_local! {
    static TEST_FLAGS: std::cell::Cell<Option<OrgFlags>> = const { std::cell::Cell::new(None) };
}

pub fn dword_blocks(value: Option<u32>) -> bool {
    value == Some(1)
}

pub fn current() -> OrgFlags {
    #[cfg(test)]
    {
        if let Some(flags) = TEST_FLAGS.with(|slot| slot.get()) {
            return flags;
        }
    }
    read_machine()
}

pub fn admin_tools_blocked() -> bool {
    current().disable_admin_tools
}

pub fn document_index_blocked() -> bool {
    current().disable_document_index
}

pub fn startup_update_blocked() -> bool {
    current().disable_startup_update
}

pub fn startup_knowledge_blocked() -> bool {
    current().disable_startup_knowledge
}

#[cfg(test)]
pub fn set_test_flags(flags: Option<OrgFlags>) {
    TEST_FLAGS.with(|slot| slot.set(flags));
}

fn read_machine() -> OrgFlags {
    #[cfg(windows)]
    {
        OrgFlags {
            disable_admin_tools: dword_blocks(read_dword("DisableAdminTools")),
            disable_document_index: dword_blocks(read_dword("DisableDocumentIndex")),
            disable_startup_update: dword_blocks(read_dword("DisableStartupUpdateCheck")),
            disable_startup_knowledge: dword_blocks(read_dword("DisableStartupKnowledge")),
        }
    }
    #[cfg(not(windows))]
    OrgFlags::open()
}

#[cfg(windows)]
fn read_dword(name: &str) -> Option<u32> {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};
    let wide: Vec<u16> = OsStr::new(name).encode_wide().chain(std::iter::once(0)).collect();
    let sub: Vec<u16> = OsStr::new("SOFTWARE\\Policies\\EduLauncher")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut data = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            windows_core::PCWSTR(sub.as_ptr()),
            windows_core::PCWSTR(wide.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    if status.is_ok() {
        Some(data)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_forces_off() {
        assert!(!dword_blocks(None));
        assert!(!dword_blocks(Some(0)));
        assert!(dword_blocks(Some(1)));
        assert!(!dword_blocks(Some(2)));
    }

    #[test]
    fn missing_policy_follows_user_choice() {
        set_test_flags(None);
        let flags = OrgFlags::open();
        assert!(!flags.disable_admin_tools);
        assert!(!flags.disable_document_index);
        set_test_flags(Some(OrgFlags {
            disable_document_index: true,
            ..OrgFlags::open()
        }));
        assert!(document_index_blocked());
        assert!(!admin_tools_blocked());
        set_test_flags(None);
    }
}
