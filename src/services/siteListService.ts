import { invoke } from "@tauri-apps/api/core";

export interface SiteNameUrl {
  name: string;
  url: string;
}

export interface SiteSheet {
  rows: SiteNameUrl[];
  skipped: number;
  limited: boolean;
}

export async function readSiteList(id: string): Promise<SiteSheet> {
  return invoke<SiteSheet>("read_site_list", { id });
}

export async function readFileUrls(id: string): Promise<SiteSheet> {
  return invoke<SiteSheet>("read_file_urls", { id });
}
