import { create } from "zustand";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import {
  DEFAULT_SETTINGS,
  asListColumns,
  asMemoHeight,
  asMemoWidth,
  asPanelHeight,
  asPanelSkin,
  asPanelWidth,
  asIdList,
  type AppSettings,
  type PanelSkin,
} from "../types/settings";
import { loadSettings, saveSettings } from "../services/storageService";
import { registerShortcut, setLauncherPosition } from "../services/windowService";

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  shortcutNote: string;
  hydrate: (settings: AppSettings) => void;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

function paintSkin(skin: PanelSkin): void {
  const next = asPanelSkin(skin);
  document.documentElement.dataset.skin = next === "prior" ? "paper" : next;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  shortcutNote: "",
  hydrate: (settings) => {
    const next = {
      ...settings,
      panelSkin: asPanelSkin(settings.panelSkin),
      listColumns: asListColumns(settings.listColumns),
      panelWidth: asPanelWidth(settings.panelWidth),
      panelHeight: asPanelHeight(settings.panelHeight),
      memoWidth: asMemoWidth(settings.memoWidth),
      memoHeight: asMemoHeight(settings.memoHeight),
      shortcutOrder: asIdList(settings.shortcutOrder),
      computerToolOrder: asIdList(settings.computerToolOrder),
    };
    paintSkin(next.panelSkin);
    set({ settings: next, loaded: true });
  },
  update: async (patch) => {
    const settings = {
      ...get().settings,
      ...patch,
      panelSkin: asPanelSkin(patch.panelSkin ?? get().settings.panelSkin),
      listColumns: asListColumns(patch.listColumns ?? get().settings.listColumns),
      panelWidth: asPanelWidth(patch.panelWidth ?? get().settings.panelWidth),
      panelHeight: asPanelHeight(patch.panelHeight ?? get().settings.panelHeight),
      memoWidth: asMemoWidth(patch.memoWidth ?? get().settings.memoWidth),
      memoHeight: asMemoHeight(patch.memoHeight ?? get().settings.memoHeight),
      shortcutOrder: asIdList(patch.shortcutOrder ?? get().settings.shortcutOrder),
      computerToolOrder: asIdList(patch.computerToolOrder ?? get().settings.computerToolOrder),
    };
    set({ settings });
    await saveSettings(settings);
    if (patch.panelSkin) {
      paintSkin(settings.panelSkin);
    }

    if (patch.launcherPosition) {
      await setLauncherPosition(settings.launcherPosition);
    }
    if (patch.globalShortcut) {
      try {
        await registerShortcut(settings.globalShortcut);
        set({ shortcutNote: "" });
      } catch (error) {
        set({
          shortcutNote:
            error instanceof Error
              ? error.message
              : "이 단축키는 쓸 수 없습니다. 수정키와 일반 키를 다시 지정하세요.",
        });
      }
    }
    if (patch.autoStart !== undefined) {
      try {
        if (patch.autoStart) {
          if (!import.meta.env.DEV) {
            await enable();
          }
        } else {
          await disable();
        }
      } catch {
        // Autostart plugin may be unavailable in some environments.
      }
    }
  },
  completeOnboarding: async () => {
    const settings = { ...get().settings, onboarded: true };
    set({ settings });
    await saveSettings(settings);
  },
}));

export async function hydrateSettings(): Promise<AppSettings> {
  const settings = await loadSettings();
  useSettingsStore.getState().hydrate(settings);
  await setLauncherPosition(settings.launcherPosition);
  try {
    await registerShortcut(settings.globalShortcut);
    useSettingsStore.setState({ shortcutNote: "" });
  } catch (error) {
    useSettingsStore.setState({
      shortcutNote:
        error instanceof Error
          ? error.message
          : "이 단축키는 쓸 수 없습니다. 수정키와 일반 키를 다시 지정하세요.",
    });
  }
  try {
    if (settings.autoStart) {
      if (!import.meta.env.DEV) {
        await enable();
      }
    } else {
      await disable();
    }
  } catch {
    // Autostart is also applied from Rust setup; ignore frontend sync errors.
  }
  return settings;
}
