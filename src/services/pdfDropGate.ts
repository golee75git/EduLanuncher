let held = false;
let onFiles: ((paths: string[]) => void) | null = null;

export function holdPdfDrop(handler: (paths: string[]) => void): () => void {
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

export function takePdfFiles(paths: string[]): boolean {
  if (!held || !onFiles) {
    return false;
  }
  const files = paths.map((path) => path.trim()).filter((path) => isPdfPath(path));
  if (files.length === 0) {
    return false;
  }
  onFiles(files);
  return true;
}
