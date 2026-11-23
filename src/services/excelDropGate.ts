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

export function isJoinPath(path: string): boolean {
  return /\.(xlsx|csv|pdf)$/i.test(path.trim());
}

let joinHeld = false;
let onJoinFiles: ((files: GrantedFile[]) => void) | null = null;

export function holdJoinDrop(handler: (files: GrantedFile[]) => void): () => void {
  joinHeld = true;
  onJoinFiles = handler;
  return () => {
    joinHeld = false;
    onJoinFiles = null;
  };
}

export function takeJoinFiles(files: GrantedFile[]): boolean {
  if (!joinHeld || !onJoinFiles) {
    return false;
  }
  const picked = files.filter((file) => file.id && isJoinPath(file.name));
  if (picked.length === 0) {
    return false;
  }
  onJoinFiles(picked);
  return true;
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
