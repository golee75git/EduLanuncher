import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SPEED_SITE } from "../config/speedSites";

export type LinkStatus = "checking" | "waiting" | "success" | "warning" | "error" | "unconfirmed" | "skipped";

export interface LinkRow {
  id: string;
  title: string;
  status: LinkStatus;
  label: string;
}

export interface TechLine {
  label: string;
  value: string;
}

export interface LinkReport {
  rows: LinkRow[];
  finding: string;
  advice: string;
  helpId: string;
  technical: TechLine[];
  copyText: string;
  pages: string[];
  stopped: boolean;
  showSpeed: boolean;
  qualityStatus: string;
  qualityText: string;
}

export interface LinkNote {
  kind: string;
  id: string;
  status: string;
  label: string;
  report?: LinkReport | null;
}

export const LINK_ROWS: LinkRow[] = [
  { id: "device", title: "네트워크 장치", status: "waiting", label: "대기" },
  { id: "address", title: "IP 주소", status: "waiting", label: "대기" },
  { id: "inside", title: "내부 네트워크", status: "waiting", label: "대기" },
  { id: "names", title: "인터넷 주소 확인", status: "waiting", label: "대기" },
  { id: "web", title: "웹 연결", status: "waiting", label: "대기" },
];

export function listenLinkCheck(onNote: (note: LinkNote) => void): Promise<UnlistenFn> {
  return listen<LinkNote>("pc-link-step", (event) => {
    onNote(event.payload);
  });
}

export async function beginLinkCheck(): Promise<void> {
  await invoke("begin_pc_link");
}

export async function haltLinkCheck(): Promise<void> {
  await invoke("halt_pc_link");
}

export async function openPcSetting(page: "network" | "wifi" | "proxy"): Promise<void> {
  await invoke("open_pc_setting", { page });
}

export async function openSpeedSite(): Promise<void> {
  await openUrl(SPEED_SITE);
}
