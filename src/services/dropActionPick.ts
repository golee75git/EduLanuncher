import { isDocPicturePath } from "./docDropGate";
import type { GrantedFile } from "./dropSiteService";
import { isPdfPath } from "./pdfDropGate";

export interface DropActionFiles {
  pictures: GrantedFile[];
  pdfs: GrantedFile[];
  rest: GrantedFile[];
}

export function splitDropActions(files: GrantedFile[]): DropActionFiles {
  const pictures: GrantedFile[] = [];
  const pdfs: GrantedFile[] = [];
  const rest: GrantedFile[] = [];
  for (const file of files) {
    if (!file.id) {
      continue;
    }
    if (isDocPicturePath(file.name)) {
      pictures.push(file);
    } else if (isPdfPath(file.name)) {
      pdfs.push(file);
    } else {
      rest.push(file);
    }
  }
  return { pictures, pdfs, rest };
}

export function dropFileLabel(path: string): string {
  const name = path.split(/[/\\]/).pop() || path;
  return name.length > 42 ? `${name.slice(0, 41)}…` : name;
}
