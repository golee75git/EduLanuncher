import { invoke } from "@tauri-apps/api/core";

export interface PcUrlItem {
  name: string;
  url: string;
  folder: string;
  path?: string;
  iconImage?: string;
}

export async function listPcUrlShortcuts(): Promise<PcUrlItem[]> {
  return invoke<PcUrlItem[]>("list_pc_url_shortcuts");
}
