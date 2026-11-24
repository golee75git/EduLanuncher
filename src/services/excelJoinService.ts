import { invoke } from "@tauri-apps/api/core";
import { headerKey, type ExcelGlance } from "./excelMergeService";

export const KEY_CANDIDATES = ["대상학교", "학교명", "학교이름", "학교"];

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
  /** 이 파일에서 맞출 열 이름. 비우면 기준 파일의 맞출 열 이름을 쓴다. */
  key?: string;
  keyAt?: number | null;
  sourceAt?: number | null;
  targetAt?: number | null;
  dataFrom?: number | null;
  dataTo?: number | null;
}

export interface JoinAnchor {
  keyAt: number | null;
  dataFrom: number | null;
  dataTo: number | null;
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

/** 파일의 앞부분을 본다. xlsx에 시트가 여럿이면 `sheet` 이름의 시트를 본다. */
export function glanceSheet(id: string, sheet?: string): Promise<ExcelGlance> {
  return invoke<ExcelGlance>("sheet_glance", { id, sheet: sheet || null });
}

export function joinTitleFromName(name: string): string {
  const leaf = name.split(/[/\\]/).pop() || "";
  const stem = leaf.replace(/\.(xlsx|csv)$/i, "").trim();
  const clipped = Array.from(stem).slice(0, 40).join("");
  return `${clipped || "엑셀"}_병합`;
}

/** `sheets`는 `ids`와 같은 차례로 파일마다 읽을 시트 이름이다. 빈 글자는 첫 시트다. */
export function lookExcelJoin(ids: string[], key: string, pairs: JoinPair[], anchor: JoinAnchor, sheets: string[]): Promise<JoinLook> {
  return invoke<JoinLook>("excel_join_look", { ids, key, pairs, anchor, sheets });
}

export function saveExcelJoin(
  ids: string[],
  title: string,
  key: string,
  pairs: JoinPair[],
  anchor: JoinAnchor,
  sheets: string[],
): Promise<JoinMade> {
  return invoke<JoinMade>("excel_join_save", { ids, title, key, pairs, anchor, sheets });
}
