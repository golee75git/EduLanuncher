import { invoke } from "@tauri-apps/api/core";

export interface PdfGlance {
  pages: number;
  signed: boolean;
}

export interface PdfSlot {
  page: number;
  turn: number;
}

export interface PdfMade {
  paths: string[];
  pages: number;
  bytes: number;
  signed: boolean;
  stopped: boolean;
}

export function glancePdf(path: string): Promise<PdfGlance> {
  return invoke<PdfGlance>("pdf_glance", { path });
}

export function haltPdf(): Promise<void> {
  return invoke("pdf_halt");
}

export function mergePdf(paths: string[]): Promise<PdfMade> {
  return invoke<PdfMade>("pdf_merge", { paths });
}

export function extractPdf(path: string, pages: number[], each: boolean): Promise<PdfMade> {
  return invoke<PdfMade>("pdf_extract", { path, pages, each });
}

export function arrangePdf(path: string, slots: PdfSlot[]): Promise<PdfMade> {
  return invoke<PdfMade>("pdf_arrange", { path, slots });
}

export function parsePageSpec(text: string, pageCount: number): number[] {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("페이지를 입력해 주세요.");
  }
  const pages: number[] = [];
  const seen = new Set<number>();
  const push = (page: number) => {
    if (!Number.isInteger(page) || page < 1) {
      throw new Error("페이지 번호가 올바르지 않습니다.");
    }
    if (page > pageCount) {
      throw new Error(`${page}페이지는 이 문서에 존재하지 않습니다.`);
    }
    if (seen.has(page)) {
      throw new Error("같은 페이지가 두 번 있습니다.");
    }
    seen.add(page);
    pages.push(page);
  };
  for (const part of trimmed.split(/[,，]/)) {
    const token = part.trim();
    if (!token) {
      continue;
    }
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    const single = /^(\d+)$/.exec(token);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end) {
        throw new Error("페이지 번호가 올바르지 않습니다.");
      }
      for (let page = start; page <= end; page += 1) {
        push(page);
      }
    } else if (single) {
      push(Number(single[1]));
    } else {
      throw new Error("페이지 번호가 올바르지 않습니다.");
    }
  }
  if (pages.length === 0) {
    throw new Error("페이지를 입력해 주세요.");
  }
  return pages;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
