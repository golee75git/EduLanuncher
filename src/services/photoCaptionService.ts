import type { PrivacyShot } from "./privacyMaskService";

/** 이 PC에 설치된 Windows 글꼴. 글꼴 파일은 앱에 넣지 않는다. OFL 글꼴이 아니다. */
export const CAPTION_FONT = '"Segoe UI Variable", "Segoe UI", "Malgun Gothic", sans-serif';

const LETTER_LIMIT = 200;
const LINE_LIMIT = 8;
const SCALE_MIN = 0.02;
const SCALE_MAX = 0.12;
const HEX = /^#[0-9a-f]{6}$/;

export interface CaptionMark {
  letters: string;
  ink: string;
  plate: string;
  plateOn: boolean;
  x: number;
  y: number;
  scale: number;
}

export interface CaptionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function emptyCaption(): CaptionMark {
  return {
    letters: "",
    ink: "#1f2a2e",
    plate: "#ffffff",
    plateOn: true,
    x: 0.04,
    y: 0.72,
    scale: 0.05,
  };
}

export function hexColor(value: string, fallback: string): string {
  const text = value.trim().toLowerCase();
  return HEX.test(text) ? text : fallback;
}

export function clipLetters(value: string): string {
  const clean = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").slice(0, LETTER_LIMIT);
  const lines = clean.split("\n");
  if (lines.length <= LINE_LIMIT) {
    return clean;
  }
  return lines.slice(0, LINE_LIMIT).join("\n");
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.05;
  }
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function captionFileName(sourceName: string): string {
  const base = sourceName.split(/[/\\]/).pop()?.trim() || "사진";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "사진";
  return `${stem.slice(0, 80)}_글자.png`;
}

export function captionFontPx(viewWidth: number, scale: number): number {
  const width = Math.max(1, viewWidth);
  return Math.max(8, Math.round(width * clampScale(scale)));
}

export function captionBox(viewWidth: number, viewHeight: number, mark: CaptionMark, lineWidths: number[]): CaptionBox {
  const font = captionFontPx(viewWidth, mark.scale);
  const pad = Math.round(font * 0.35);
  const lineHeight = Math.round(font * 1.35);
  const textWidth = lineWidths.reduce((max, width) => Math.max(max, width), 0);
  const width = Math.max(pad * 2 + 1, textWidth + pad * 2);
  const height = Math.max(lineHeight, lineWidths.length * lineHeight) + pad * 2;
  const maxLeft = Math.max(0, viewWidth - width);
  const maxTop = Math.max(0, viewHeight - height);
  return {
    left: Math.min(Math.max(0, clampUnit(mark.x) * viewWidth), maxLeft),
    top: Math.min(Math.max(0, clampUnit(mark.y) * viewHeight), maxTop),
    width,
    height,
  };
}

export function paintCaption(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  viewWidth: number,
  viewHeight: number,
  mark: CaptionMark,
): CaptionBox | null {
  ctx.save();
  ctx.clearRect(0, 0, viewWidth, viewHeight);
  ctx.drawImage(image, 0, 0, viewWidth, viewHeight);
  const clipped = clipLetters(mark.letters);
  if (!clipped.trim()) {
    ctx.restore();
    return null;
  }
  const lines = clipped.split("\n").slice(0, LINE_LIMIT);
  const font = captionFontPx(viewWidth, mark.scale);
  ctx.font = `${font}px ${CAPTION_FONT}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const widths = lines.map((line) => ctx.measureText(line).width);
  const box = captionBox(viewWidth, viewHeight, mark, widths);
  const pad = Math.round(font * 0.35);
  const lineHeight = Math.round(font * 1.35);
  if (mark.plateOn) {
    ctx.fillStyle = hexColor(mark.plate, "#ffffff");
    ctx.fillRect(box.left, box.top, box.width, box.height);
  }
  ctx.fillStyle = hexColor(mark.ink, "#1f2a2e");
  ctx.beginPath();
  ctx.rect(0, 0, viewWidth, viewHeight);
  ctx.clip();
  lines.forEach((line, index) => {
    ctx.fillText(line, box.left + pad, box.top + pad + index * lineHeight);
  });
  ctx.restore();
  return box;
}

export async function captionPng(shot: PrivacyShot, mark: CaptionMark): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = shot.width;
  canvas.height = shot.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("그림을 그리지 못했습니다.");
  }
  try {
    paintCaption(ctx, shot.image, shot.width, shot.height, mark);
    return await canvasToBlob(canvas);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("그림을 만들지 못했습니다."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}
