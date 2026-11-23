import type { GrantedFile } from "./dropSiteService";

let held = false;
let onFiles: ((files: GrantedFile[]) => void) | null = null;

export function holdExcelDrop(handler: (files: GrantedFile[]) => void): () => void {
  held = true;
  onFiles = handler;
  return () => {
    held = false;
    onFiles = null;
  };
}

export function excelDropHeld(): boolean {
  return held;
}

export function isExcelPath(path: string): boolean {
  return /\.(xlsx|csv)$/i.test(path.trim());
}

export function takeExcelFiles(files: GrantedFile[]): boolean {
  if (!held || !onFiles) {
    return false;
  }
  const picked = files.filter((file) => isExcelPath(file.name));
  if (picked.length === 0) {
    return false;
  }
  onFiles(picked);
  return true;
}
