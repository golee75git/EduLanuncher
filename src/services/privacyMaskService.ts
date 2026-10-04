import { invoke } from "@tauri-apps/api/core";

export type CoverKind = "solid" | "block" | "soft";
export type CoverLevel = "light" | "mid" | "heavy";
export type JpegGrade = "best" | "high" | "small";
export type RegionKind = "face" | "number" | "plate" | "text" | "manual";
export type FaceCover = "block" | "soft";

export interface CoverBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RegionKind;
  on: boolean;
}

export interface FindCaps {
  face: boolean;
  text: boolean;
  debug: boolean;
}

export interface StageMark {
  stage: "full" | "grid2" | "grid3";
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FoundRegion {
  kind: "face" | "number" | "plate" | "text";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FindOutcome {
  regions: FoundRegion[];
  stages: StageMark[];
  faceCount: number;
  numberCount: number;
  plateCount: number;
  textCount: number;
  faceAvailable: boolean;
  textAvailable: boolean;
  partial: boolean;
  partialReason: string;
  elapsedMs: number;
}

export interface PrivacyShot {
  readId: string;
  mime: string;
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
}

const LEVEL_RATE: Record<CoverLevel, number> = {
  light: 0.02,
  mid: 0.04,
  heavy: 0.07,
};

const JPEG_QUALITY: Record<JpegGrade, number> = {
  best: 0.95,
  high: 0.9,
  small: 0.75,
};

const MAX_PIXELS = 40_000_000;

export function coverRate(level: CoverLevel): number {
  return LEVEL_RATE[level];
}

export function jpegQuality(grade: JpegGrade): number {
  return JPEG_QUALITY[grade];
}

export function privacySaveName(sourcePath: string, mime: string): string {
  const base = sourcePath.split(/[/\\]/).pop()?.trim() || "사진";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = mime === "image/png" ? ".png" : ".jpg";
  return `${stem}_privacy${ext}`;
}

export async function loadPrivacyShot(id: string): Promise<PrivacyShot> {
  const file = await invoke<{ id: string; mime: string; data: string }>("read_privacy_picture", { id });
  if (file.mime !== "image/png" && file.mime !== "image/jpeg") {
    throw new Error("PNG 또는 JPEG 그림만 고를 수 있습니다.");
  }
  const bytes = bytesFromBase64(file.data);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: file.mime,
  });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width < 2 || height < 2) {
      throw new Error("그림 크기를 알 수 없습니다.");
    }
    if (width * height > MAX_PIXELS) {
      throw new Error("그림이 너무 큽니다. 더 작은 그림을 고르세요.");
    }
    return { readId: file.id, mime: file.mime, url, image, width, height };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function writePrivacyFile(readId: string, writeId: string, blob: Blob): Promise<void> {
  const data = await blobToBase64(blob);
  await invoke("write_privacy_picture", { readId, writeId, data });
}

export async function privacyFindCaps(): Promise<FindCaps> {
  return invoke<FindCaps>("privacy_find_caps");
}

export async function findPrivacyRegions(
  readId: string,
  wish: { face: boolean; number: boolean; plate: boolean; text: boolean },
  options?: { fullOnly?: boolean; diag?: boolean },
): Promise<FindOutcome> {
  return invoke<FindOutcome>("find_privacy_regions", {
    readId,
    ...wish,
    fullOnly: options?.fullOnly ?? false,
    diag: options?.diag ?? false,
  });
}

export async function stopPrivacyFind(): Promise<void> {
  await invoke("stop_privacy_find");
}

export function paintCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  boxes: CoverBox[],
  kind: CoverKind,
  level: CoverLevel,
  faceCover: FaceCover,
): void {
  const base = document.createElement("canvas");
  base.width = width;
  base.height = height;
  const baseCtx = base.getContext("2d");
  if (!baseCtx) {
    throw new Error("그림을 그리지 못했습니다.");
  }
  baseCtx.drawImage(source, 0, 0, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(base, 0, 0);
  const short = Math.min(width, height);
  for (const box of boxes) {
    if (!box.on) {
      continue;
    }
    const cover = coverFor(box.kind, kind, level, faceCover);
    const rate = coverRate(cover.level);
    const x = Math.round(box.x * width);
    const y = Math.round(box.y * height);
    const w = Math.max(1, Math.round(box.w * width));
    const h = Math.max(1, Math.round(box.h * height));
    if (cover.kind === "solid") {
      ctx.fillStyle = "#141414";
      ctx.fillRect(x, y, w, h);
      continue;
    }
    if (cover.kind === "block") {
      const cell = Math.max(2, Math.round(short * rate));
      const sw = Math.max(1, Math.ceil(w / cell));
      const sh = Math.max(1, Math.ceil(h / cell));
      const chip = document.createElement("canvas");
      chip.width = sw;
      chip.height = sh;
      const chipCtx = chip.getContext("2d");
      if (!chipCtx) {
        continue;
      }
      chipCtx.imageSmoothingEnabled = false;
      chipCtx.drawImage(base, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(chip, 0, 0, sw, sh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
      chip.width = 0;
      chip.height = 0;
      continue;
    }
    if (cover.kind !== "soft") {
      continue;
    }
    const radius = Math.max(1, Math.round(short * rate));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(base, 0, 0);
    ctx.filter = "none";
    ctx.restore();
  }
  base.width = 0;
  base.height = 0;
}

const STAGE_COLOR: Record<StageMark["stage"], string> = {
  full: "#1d4ed8",
  grid2: "#b45309",
  grid3: "#15803d",
};

export function paintStages(ctx: CanvasRenderingContext2D, width: number, height: number, stages: StageMark[]): void {
  for (const mark of stages) {
    ctx.save();
    ctx.strokeStyle = STAGE_COLOR[mark.stage] ?? "#64748b";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(mark.x * width, mark.y * height, Math.max(1, mark.w * width), Math.max(1, mark.h * height));
    ctx.restore();
  }
}

export function paintMarks(ctx: CanvasRenderingContext2D, width: number, height: number, boxes: CoverBox[]): void {
  for (const box of boxes) {
    const x = box.x * width;
    const y = box.y * height;
    const w = box.w * width;
    const h = box.h * height;
    ctx.save();
    ctx.strokeStyle = markColor(box.kind);
    ctx.lineWidth = box.on ? 2 : 1;
    ctx.setLineDash(box.on ? [] : [4, 3]);
    ctx.strokeRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
    ctx.restore();
  }
}

export async function exportCover(
  shot: PrivacyShot,
  boxes: CoverBox[],
  kind: CoverKind,
  level: CoverLevel,
  grade: JpegGrade,
  faceCover: FaceCover,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = shot.width;
  canvas.height = shot.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("그림을 그리지 못했습니다.");
  }
  try {
    paintCover(ctx, shot.image, shot.width, shot.height, boxes, kind, level, faceCover);
    const mime = shot.mime === "image/png" ? "image/png" : "image/jpeg";
    const quality = mime === "image/jpeg" ? jpegQuality(grade) : undefined;
    return await canvasToBlob(canvas, mime, quality);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function coverFor(region: RegionKind, manualKind: CoverKind, manualLevel: CoverLevel, faceCover: FaceCover): { kind: CoverKind; level: CoverLevel } {
  if (region === "face") {
    return { kind: faceCover, level: "heavy" };
  }
  if (region === "number" || region === "plate" || region === "text") {
    return { kind: "solid", level: "heavy" };
  }
  return { kind: manualKind, level: manualLevel };
}

function markColor(kind: RegionKind): string {
  if (kind === "face") return "#c2410c";
  if (kind === "number") return "#1d4ed8";
  if (kind === "plate") return "#15803d";
  if (kind === "text") return "#7c3aed";
  return "#111827";
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("그림을 만들지 못했습니다."));
          return;
        }
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("그림을 열지 못했습니다."));
    image.src = src;
  });
}

function bytesFromBase64(data: string): Uint8Array {
  const clean = data.replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const comma = text.indexOf(",");
      if (!text.startsWith("data:") || comma < 0) {
        reject(new Error("저장할 그림을 만들지 못했습니다."));
        return;
      }
      resolve(text.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("저장할 그림을 만들지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}
