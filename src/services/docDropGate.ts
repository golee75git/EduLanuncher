import type { GrantedFile } from "./dropSiteService";

let held = false;
let onPictures: ((files: GrantedFile[]) => void) | null = null;

export function holdDocDrop(handler: (files: GrantedFile[]) => void): () => void {
  held = true;
  onPictures = handler;
  return () => {
    held = false;
    onPictures = null;
  };
}

export function docDropHeld(): boolean {
  return held;
}

export function isDocPicturePath(path: string): boolean {
  return /\.(png|jpe?g)$/i.test(path.trim());
}

export function takeDocPictures(files: GrantedFile[]): boolean {
  if (!held || !onPictures) {
    return false;
  }
  const pictures = files.filter((file) => isDocPicturePath(file.name));
  if (pictures.length === 0) {
    return false;
  }
  onPictures(pictures);
  return true;
}
