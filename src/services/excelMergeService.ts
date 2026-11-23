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

export interface ExcelFileResult {
  name: string;
  used: boolean;
  reason: string;
  headerLine: number;
  dataRows: number;
  firstRow: number;
  lastRow: number;
  unmatchedColumns: number;
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
  files: ExcelFileResult[];
}

/** 파일 하나의 결과를 한 줄로 설명한다. */
export function describeFileResult(file: ExcelFileResult): string {
  const parts: string[] = [];
  if (file.dataRows > 0) {
    parts.push(`제목 ${file.headerLine}째 줄`);
    parts.push(`${file.dataRows.toLocaleString("ko-KR")}줄`);
    parts.push(file.firstRow === file.lastRow ? `결과 ${file.firstRow}째 줄` : `결과 ${file.firstRow}~${file.lastRow}째 줄`);
  }
  if (file.unmatchedColumns > 0) {
    parts.push(`못 담은 열 ${file.unmatchedColumns}개`);
  }
  if (file.reason) {
    parts.push(file.reason);
  }
  return parts.join(" · ");
}

export function glanceExcel(id: string): Promise<ExcelGlance> {
  return invoke<ExcelGlance>("excel_merge_glance", { id });
}

export interface ExcelReview {
  id: string;
  headerLine: number;
  dataRows: number;
  missing: string[];
}

/** 고른 순서대로 파일마다 제목 줄 위치와 첫 파일에 없는 열을 미리 본다 */
export function reviewExcel(ids: string[]): Promise<ExcelReview[]> {
  return invoke<ExcelReview[]>("excel_merge_review", { ids });
}

export function mergeExcel(ids: string[], title: string, addSource: boolean): Promise<ExcelMade> {
  return invoke<ExcelMade>("excel_merge_run", { ids, title, addSource });
}

export function mergeTitleFromName(name: string): string {
  const leaf = name.split(/[/\\]/).pop() || "";
  const stem = leaf.replace(/\.(xlsx|csv)$/i, "").trim();
  const clipped = Array.from(stem).slice(0, 40).join("");
  return `${clipped || "엑셀"}_취합`;
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
