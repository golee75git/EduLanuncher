import { isDocPicturePath } from "./docDropGate";
import { isPdfPath } from "./pdfDropGate";

export interface DropActionFiles {
  pictures: string[];
  pdfs: string[];
  rest: string[];
}

export function splitDropActions(paths: string[]): DropActionFiles {
  const pictures: string[] = [];
  const pdfs: string[] = [];
  const rest: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed) {
      continue;
    }
    if (isDocPicturePath(trimmed)) {
      pictures.push(trimmed);
    } else if (isPdfPath(trimmed)) {
      pdfs.push(trimmed);
    } else {
      rest.push(trimmed);
    }
  }
  return { pictures, pdfs, rest };
}

export function dropFileLabel(path: string): string {
  const name = path.split(/[/\\]/).pop() || path;
  return name.length > 42 ? `${name.slice(0, 41)}…` : name;
}
