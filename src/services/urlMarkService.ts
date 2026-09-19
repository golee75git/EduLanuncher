import { invoke } from "@tauri-apps/api/core";

export interface UrlMarkGrid {
  side: number;
  cells: number[];
}

export interface PictureFile {
  mime: string;
  data: string;
}

export async function buildUrlMark(url: string): Promise<UrlMarkGrid> {
  return invoke<UrlMarkGrid>("build_url_mark", { url });
}

export async function readPictureFile(path: string): Promise<PictureFile> {
  return invoke<PictureFile>("read_picture_file", { path });
}

export async function writePngFile(path: string, data: string): Promise<void> {
  await invoke("write_png_file", { path, data });
}

export function pictureSrc(file: PictureFile): string {
  return `data:${file.mime};base64,${file.data}`;
}

export function drawUrlMark(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  grid: UrlMarkGrid,
): void {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width < 16 || height < 16 || grid.side < 8) {
    throw new Error("그림 또는 무늬 크기가 작습니다.");
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("그림을 그리지 못했습니다.");
  }
  ctx.drawImage(image, 0, 0);
  const short = Math.min(width, height);
  const box = Math.max(64, Math.floor(short / 4));
  const gap = Math.max(8, Math.floor(short / 40));
  const left = width - gap - box;
  const top = height - gap - box;
  const rim = Math.max(2, Math.floor(box / (grid.side + 8)));
  const inner = box - rim * 2;
  const cell = inner / grid.side;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(left, top, box, box);
  ctx.fillStyle = "#111111";
  for (let row = 0; row < grid.side; row += 1) {
    for (let col = 0; col < grid.side; col += 1) {
      if (!grid.cells[row * grid.side + col]) {
        continue;
      }
      ctx.fillRect(left + rim + col * cell, top + rim + row * cell, cell, cell);
    }
  }
}

export function canvasPngBase64(canvas: HTMLCanvasElement): string {
  const prefix = "data:image/png;base64,";
  const dataUrl = canvas.toDataURL("image/png");
  if (!dataUrl.startsWith(prefix)) {
    throw new Error("PNG로 만들지 못했습니다.");
  }
  return dataUrl.slice(prefix.length);
}
