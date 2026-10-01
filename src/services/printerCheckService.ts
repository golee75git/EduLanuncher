import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PrintStatus = "checking" | "waiting" | "success" | "warning" | "error" | "unconfirmed" | "skipped";

export interface PrintRow {
  id: string;
  title: string;
  status: PrintStatus;
  label: string;
}

export interface TechLine {
  label: string;
  value: string;
}

export interface PrintChoice {
  name: string;
  virtualDevice: boolean;
  isDefault: boolean;
}

export interface PrintReport {
  rows: PrintRow[];
  printerName: string;
  finding: string;
  advice: string;
  helpId: string;
  technical: TechLine[];
  copyText: string;
  pages: string[];
  stopped: boolean;
}

export interface PrintNote {
  kind: string;
  id: string;
  status: string;
  label: string;
  report?: PrintReport | null;
  choices?: PrintChoice[];
}

export const PRINT_ROWS: PrintRow[] = [
  { id: "service", title: "인쇄 서비스", status: "waiting", label: "대기" },
  { id: "installed", title: "프린터 설치", status: "waiting", label: "대기" },
  { id: "state", title: "프린터 상태", status: "waiting", label: "대기" },
  { id: "queue", title: "인쇄 대기열", status: "waiting", label: "대기" },
  { id: "link", title: "프린터 연결", status: "waiting", label: "대기" },
];

export function listenPrintCheck(onNote: (note: PrintNote) => void): Promise<UnlistenFn> {
  return listen<PrintNote>("pc-print-step", (event) => {
    onNote(event.payload);
  });
}

export async function beginPrintCheck(): Promise<void> {
  await invoke("begin_pc_print");
}

export async function carryPrintCheck(name: string): Promise<void> {
  await invoke("carry_pc_print", { name });
}

export async function haltPrintCheck(): Promise<void> {
  await invoke("halt_pc_print");
}

export async function openPrintView(kind: "printers" | "queue", name = ""): Promise<void> {
  await invoke("open_print_view", { kind, name });
}
