import { invoke } from "@tauri-apps/api/core";
import { headerKey, type ExcelGlance } from "./excelMergeService";

const KEY_CANDIDATES = ["학교명", "학교이름", "학교"];

export interface JoinShown {
  key: string;
  column: string;
  value: string;
  kind: string;
}

export interface JoinLook {
  shown: JoinShown[];
  fillCount: number;
  keepCount: number;
  missCount: number;
  notes: string[];
  limited: boolean;
}

export interface JoinPair {
  fileIndex: number;
  source: string;
  target: string;
}

export interface JoinMade {
  name: string;
  revealId: string;
  fillCount: number;
  keepCount: number;
  missCount: number;
  notes: string[];
  limited: boolean;
}

export function uniqueHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of headers) {
    const key = headerKey(name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(name.trim());
  }
  return names;
}

/** 모든 파일에 같이 있는 제목 중 학교명을 먼저 고른다. */
export function preferredKey(headerRows: string[][]): string {
  const sets = headerRows.map((row) => new Set(uniqueHeaders(row).map((name) => headerKey(name))));
  const first = uniqueHeaders(headerRows[0] ?? []);
  if (sets.length === 0) {
    return "";
  }
  for (const name of KEY_CANDIDATES) {
    const key = headerKey(name);
    if (key && sets.every((set) => set.has(key))) {
      return first.find((item) => headerKey(item) === key) ?? name;
    }
  }
  return (
    first.find((item) => {
      const key = headerKey(item);
      return Boolean(key) && sets.every((set) => set.has(key));
    }) ?? ""
  );
}

export function glanceSheet(id: string): Promise<ExcelGlance> {
  return invoke<ExcelGlance>("sheet_glance", { id });
}

export function joinTitleFromName(name: string): string {
  const leaf = name.split(/[/\\]/).pop() || "";
  const stem = leaf.replace(/\.(xlsx|csv)$/i, "").trim();
  const clipped = Array.from(stem).slice(0, 40).join("");
  return `${clipped || "엑셀"}_병합`;
}

export function lookExcelJoin(ids: string[], key: string, pairs: JoinPair[]): Promise<JoinLook> {
  return invoke<JoinLook>("excel_join_look", { ids, key, pairs });
}

export function saveExcelJoin(ids: string[], title: string, key: string, pairs: JoinPair[]): Promise<JoinMade> {
  return invoke<JoinMade>("excel_join_save", { ids, title, key, pairs });
}
