import type { GrantedFile } from "./dropSiteService";

let held = false;
let onPicture: ((file: GrantedFile) => void) | null = null;

export function holdPrivacyDrop(handler: (file: GrantedFile) => void): () => void {
  held = true;
  onPicture = handler;
  return () => {
    held = false;
    onPicture = null;
  };
}

export function privacyDropHeld(): boolean {
  return held;
}

export function isPrivacyPicturePath(path: string): boolean {
  return /\.(png|jpe?g)$/i.test(path.trim());
}

export function takePrivacyPicture(file: GrantedFile): boolean {
  if (!held || !onPicture || !isPrivacyPicturePath(file.name)) {
    return false;
  }
  onPicture(file);
  return true;
}
