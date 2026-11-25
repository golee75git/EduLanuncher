import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

interface AdminToolState {
  enabled: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
}

export const useAdminToolStore = create<AdminToolState>((set) => ({
  enabled: false,
  loaded: false,
  refresh: async () => {
    try {
      const enabled = await invoke<boolean>("admin_tools_query");
      if (enabled) {
        await invoke("admin_tools_disable");
      }
    } catch {
      // 미리보기이거나 저장이 거절되어도 화면에서는 끈다.
    }
    set({ enabled: false, loaded: true });
  },
  turnOn: async () => {
    await invoke("admin_tools_enable");
    set({ enabled: false, loaded: true });
  },
  turnOff: async () => {
    await invoke("admin_tools_disable");
    set({ enabled: false, loaded: true });
  },
}));

export function isLockedScanTool(id: string, target?: string): boolean {
  return (
    id === "tool-network" ||
    id === "tool-cctv" ||
    target === "network" ||
    target === "cctv"
  );
}
