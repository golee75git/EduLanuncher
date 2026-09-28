let held = false;
let onPicture: ((path: string) => void) | null = null;

export function holdPrivacyDrop(handler: (path: string) => void): () => void {
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

export function takePrivacyPicture(path: string): boolean {
  if (!held || !onPicture || !isPrivacyPicturePath(path)) {
    return false;
  }
  onPicture(path.trim());
  return true;
}
