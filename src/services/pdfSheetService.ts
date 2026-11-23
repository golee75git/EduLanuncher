import { invoke } from "@tauri-apps/api/core";

export interface PdfSheetLook {
  dataRows: number;
  columns: number;
  header: string[];
  preview: string[][];
  limited: boolean;
}

export interface PdfSheetMade {
  name: string;
  revealId: string;
  dataRows: number;
  limited: boolean;
}

export function lookPdfSheet(id: string): Promise<PdfSheetLook> {
  return invoke<PdfSheetLook>("pdf_sheet_look", { id });
}

export function savePdfSheet(id: string, title: string): Promise<PdfSheetMade> {
  return invoke<PdfSheetMade>("pdf_sheet_save", { id, title });
}

export function pdfSheetTitleFromName(name: string): string {
  const leaf = name.split(/[/\\]/).pop() || "";
  const stem = leaf.replace(/\.pdf$/i, "").trim();
  const clipped = Array.from(stem).slice(0, 40).join("");
  return `${clipped || "문서"}_엑셀`;
}
