import { create } from "zustand";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import { DEFAULT_SETTINGS, asListColumns, asPanelSkin, type AppSettings, type PanelSkin } from "../types/settings";
import { loadSettings, saveSettings, emitTodosChanged } from "../services/storageService";
import { registerShortcut, setDeskMiniVisible, setLauncherPosition } from "../services/windowService";
import { useTodoStore } from "./todoStore";

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  hydrate: (settings: AppSettings) => void;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

function paintSkin(skin: PanelSkin): void {
  document.documentElement.dataset.skin = asPanelSkin(skin);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  hydrate: (settings) => {
    const next = {
      ...settings,
      panelSkin: asPanelSkin(settings.panelSkin),
      listColumns: asListColumns(settings.listColumns),
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
      await registerShortcut(settings.globalShortcut);
    }
    if (patch.showDeskMini !== undefined) {
      try {
        await setDeskMiniVisible(settings.showDeskMini);
        if (settings.showDeskMini) {
          await emitTodosChanged(useTodoStore.getState().todos);
        }
      } catch {
        // Command is unavailable in browser preview.
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
  } catch {
    // Shortcut may already be registered by Rust defaults.
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
