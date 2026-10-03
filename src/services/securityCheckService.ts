import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type SecurityStatus = "checking" | "waiting" | "success" | "warning" | "error" | "unconfirmed" | "skipped";

export interface SecurityRow {
  id: string;
  title: string;
  status: SecurityStatus;
  label: string;
  finding: string;
  advice: string;
  helpId: string;
  page: string;
}

export interface TechLine {
  label: string;
  value: string;
}

export interface SecurityReport {
  rows: SecurityRow[];
  finding: string;
  advice: string;
  helpId: string;
  technical: TechLine[];
  copyText: string;
  pages: string[];
  stopped: boolean;
}

export interface SecurityNote {
  kind: string;
  id: string;
  status: string;
  label: string;
  report?: SecurityReport | null;
}

export const SECURITY_ROWS: SecurityRow[] = [
  { id: "support", title: "Windows 지원", status: "waiting", label: "대기", finding: "", advice: "", helpId: "security-windows-support", page: "" },
  { id: "update", title: "업데이트", status: "waiting", label: "대기", finding: "", advice: "", helpId: "security-update", page: "" },
  { id: "antivirus", title: "백신", status: "waiting", label: "대기", finding: "", advice: "", helpId: "security-antivirus", page: "" },
  { id: "firewall", title: "방화벽", status: "waiting", label: "대기", finding: "", advice: "", helpId: "security-firewall", page: "" },
  { id: "lock", title: "화면 잠금", status: "waiting", label: "대기", finding: "", advice: "", helpId: "security-screen-lock", page: "" },
  { id: "shares", title: "공유 폴더", status: "waiting", label: "대기", finding: "", advice: "", helpId: "security-shared-folder", page: "" },
];

export function listenSecurityCheck(onNote: (note: SecurityNote) => void): Promise<UnlistenFn> {
  return listen<SecurityNote>("pc-security-step", (event) => {
    onNote(event.payload);
  });
}

export async function beginSecurityCheck(): Promise<void> {
  await invoke("begin_pc_security");
}

export async function haltSecurityCheck(): Promise<void> {
  await invoke("halt_pc_security");
}

export async function openSecuritySetting(page: string): Promise<void> {
  await invoke("open_security_setting", { page });
}
