import type { GrantedFile } from "./dropSiteService";

let held = false;
let onFiles: ((files: GrantedFile[]) => void) | null = null;

export function holdPdfDrop(handler: (files: GrantedFile[]) => void): () => void {
  held = true;
  onFiles = handler;
  return () => {
    held = false;
    onFiles = null;
  };
}

export function pdfDropHeld(): boolean {
  return held;
}

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path.trim());
}

export function takePdfFiles(files: GrantedFile[]): boolean {
  if (!held || !onFiles) {
    return false;
  }
  const picked = files.filter((file) => isPdfPath(file.name));
  if (picked.length === 0) {
    return false;
  }
  onFiles(picked);
  return true;
}
