import { invoke } from "@tauri-apps/api/core";
import { listIpv4Inclusive } from "./ipv4Math";

export interface LocalAddress {
  ip: string;
  mask?: string | null;
  name?: string | null;
  gateway?: string | null;
}

export interface HostHit {
  ip: string;
  name?: string | null;
  ms?: number | null;
  mac?: string | null;
  kind: string;
  kindLabel: string;
  rtsp?: boolean;
}

export async function loadThisPcIpv4(): Promise<LocalAddress[]> {
  return invoke<LocalAddress[]>("this_pc_ipv4");
}

export async function lookupPublicIpv4(): Promise<string> {
  return invoke<string>("lookup_public_ipv4");
}

export async function scanIpv4Range(start: string, end: string): Promise<HostHit[]> {
  return invoke<HostHit[]>("scan_ipv4_range", { start, end });
}

export async function scanCctvRange(start: string, end: string): Promise<HostHit[]> {
  return invoke<HostHit[]>("scan_cctv_range", { start, end });
}

export async function writeCsvFile(path: string, contents: string): Promise<void> {
  await invoke("write_csv_file", { path, contents });
}

export function hostsToCsv(hits: HostHit[], firstHost?: string, lastHost?: string): string {
  const header = ["종류", "이름", "IP", "MAC", "응답(ms)", "상태"];
  const byIp = new Map(hits.map((hit) => [hit.ip, hit]));
  const addresses = (firstHost && lastHost ? listIpv4Inclusive(firstHost, lastHost) : null) ?? hits.map((hit) => hit.ip);
  const rows = addresses.map((ip) => {
    const hit = byIp.get(ip);
    if (!hit) {
      return ["", "", ip, "", "", "미연결"];
    }
    return [
      hit.kindLabel,
      hit.name?.trim() || "",
      hit.ip,
      hit.mac || "",
      hit.ms != null ? String(hit.ms) : "",
      "연결됨",
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.split("\"").join("\"\"")}"`;
  }
  return value;
}
