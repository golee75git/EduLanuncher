import { invoke } from "@tauri-apps/api/core";

export const EXCEL_MERGE_MAX_FILES = 20;

export interface ExcelGlance {
  dataRows: number;
  columns: number;
  header: string[];
  limited: boolean;
}

export interface ExcelUnmatched {
  file: string;
  column: string;
}

export interface ExcelMade {
  name: string;
  revealId: string;
  dataRows: number;
  filesUsed: number;
  skippedFiles: string[];
  unmatched: ExcelUnmatched[];
  unmatchedTotal: number;
  limited: boolean;
}

export function glanceExcel(id: string): Promise<ExcelGlance> {
  return invoke<ExcelGlance>("excel_merge_glance", { id });
}

export function mergeExcel(ids: string[], title: string, addSource: boolean): Promise<ExcelMade> {
  return invoke<ExcelMade>("excel_merge_run", { ids, title, addSource });
}

export function mergeTitleFromName(name: string): string {
  const leaf = name.split(/[/\\]/).pop() || "";
  const stem = leaf.replace(/\.(xlsx|csv)$/i, "").trim();
  const clipped = Array.from(stem).slice(0, 40).join("");
  return `${clipped || "엑셀"}_통합`;
}

/** 제목 칸을 맞출 때 쓰는 키. 공백을 하나로 줄이고 대소문자를 무시한다 (Rust 쪽 `header_key`와 같은 규칙) */
export function headerKey(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/** 첫 파일의 제목 줄에 없는 열 이름 (미리 알려 주기용) */
export function headersMissingFrom(first: string[], other: string[]): string[] {
  const known = new Set(first.map(headerKey).filter(Boolean));
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const name of other) {
    const key = headerKey(name);
    if (!key || known.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    missing.push(name.trim());
  }
  return missing;
}
