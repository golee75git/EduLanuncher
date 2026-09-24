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

/** 이 PC 브라우저가 이미 저장해 둔 사이트 그림을 주소별로. 못 찾은 것은 null. */
export async function browserFaviconsFor(urls: string[]): Promise<Array<string | null>> {
  return invoke<Array<string | null>>("favicon_for_urls", { urls });
}
