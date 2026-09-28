let held = false;
let onPictures: ((paths: string[]) => void) | null = null;

export function holdDocDrop(handler: (paths: string[]) => void): () => void {
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

export function takeDocPictures(paths: string[]): boolean {
  if (!held || !onPictures) {
    return false;
  }
  const pictures = paths.map((path) => path.trim()).filter((path) => isDocPicturePath(path));
  if (pictures.length === 0) {
    return false;
  }
  onPictures(pictures);
  return true;
}
