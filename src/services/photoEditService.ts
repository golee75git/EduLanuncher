import type { PrivacyShot } from "./privacyMaskService";

/** 사진 다듬기: 돌리기 → 자르기 → 크기 맞추기 순서로 화면(canvas)에서 처리한다. 새 라이브러리는 쓰지 않는다. */

export type Turns = 0 | 1 | 2 | 3;
export type SizeMode = "keep" | "long" | "kb";
export type OutFormat = "jpeg" | "png";

/** 돌린 뒤 그림 전체를 1로 본 비율 좌표 */
export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditState {
  turns: Turns;
  crop: CropBox | null;
  sizeMode: SizeMode;
  longEdge: number;
  targetKb: number;
  format: OutFormat;
}

export interface EditResult {
  blob: Blob;
  width: number;
  height: number;
  note: string;
}

const MIN_CROP = 0.02;
const MIN_EDGE = 16;
const MAX_EDGE = 8000;
const MIN_KB = 20;
const MAX_KB = 20000;
const MAX_OUT_PIXELS = 40_000_000;

export function emptyEdit(format: OutFormat): EditState {
  return { turns: 0, crop: null, sizeMode: "keep", longEdge: 1600, targetKb: 500, format };
}

export function clampLongEdge(value: number): number {
  if (!Number.isFinite(value)) {
    return 1600;
  }
  return Math.min(MAX_EDGE, Math.max(MIN_EDGE, Math.round(value)));
}

export function clampTargetKb(value: number): number {
  if (!Number.isFinite(value)) {
    return 500;
  }
  return Math.min(MAX_KB, Math.max(MIN_KB, Math.round(value)));
}

export function turnedSize(width: number, height: number, turns: Turns): { width: number; height: number } {
  return turns % 2 === 1 ? { width: height, height: width } : { width, height };
}

export function nextTurns(turns: Turns, step: 1 | -1): Turns {
  return ((turns + step + 4) % 4) as Turns;
}

function unit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** 끌기 시작점과 끝점으로 자를 칸을 만든다. 너무 작으면 null(자르기 없음). */
export function cropFromDrag(ax: number, ay: number, bx: number, by: number): CropBox | null {
  const left = unit(Math.min(ax, bx));
  const top = unit(Math.min(ay, by));
  const right = unit(Math.max(ax, bx));
  const bottom = unit(Math.max(ay, by));
  if (right - left < MIN_CROP || bottom - top < MIN_CROP) {
    return null;
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** 돌린 그림을 dw×dh 크기 캔버스 전체에 그린다. */
export function paintTurned(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  turns: Turns,
  dw: number,
  dh: number,
): void {
  ctx.save();
  ctx.translate(dw / 2, dh / 2);
  ctx.rotate((turns * Math.PI) / 2);
  const drawW = turns % 2 === 1 ? dh : dw;
  const drawH = turns % 2 === 1 ? dw : dh;
  ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

/** 미리보기 위에 자를 칸 바깥을 어둡게 칠한다. */
export function paintCropShade(ctx: CanvasRenderingContext2D, width: number, height: number, crop: CropBox | null): void {
  if (!crop) {
    return;
  }
  const left = crop.x * width;
  const top = crop.y * height;
  const boxW = crop.w * width;
  const boxH = crop.h * height;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, width, top);
  ctx.fillRect(0, top + boxH, width, height - top - boxH);
  ctx.fillRect(0, top, left, boxH);
  ctx.fillRect(left + boxW, top, width - left - boxW, boxH);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, Math.round(width / 300));
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(left, top, boxW, boxH);
  ctx.restore();
}

/** 돌리기와 자르기를 거친 원래 해상도의 크기 */
export function croppedSize(shot: PrivacyShot, state: EditState): { width: number; height: number } {
  const turned = turnedSize(shot.width, shot.height, state.turns);
  if (!state.crop) {
    return turned;
  }
  return {
    width: Math.max(1, Math.round(turned.width * state.crop.w)),
    height: Math.max(1, Math.round(turned.height * state.crop.h)),
  };
}

/** 크기 맞추기까지 거친 결과 크기(용량 지정은 저장할 때 줄어들 수 있다). */
export function resultSize(shot: PrivacyShot, state: EditState): { width: number; height: number } {
  const base = croppedSize(shot, state);
  if (state.sizeMode !== "long") {
    return base;
  }
  return fitLong(base.width, base.height, state.longEdge);
}

function fitLong(width: number, height: number, longEdge: number): { width: number; height: number } {
  const wish = clampLongEdge(longEdge);
  const longest = Math.max(width, height);
  if (longest <= wish) {
    return { width, height };
  }
  const scale = wish / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function renderCanvas(shot: PrivacyShot, state: EditState, width: number, height: number): HTMLCanvasElement {
  if (width * height > MAX_OUT_PIXELS) {
    throw new Error("그림이 너무 큽니다.");
  }
  const crop = state.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) {
    out.width = 0;
    out.height = 0;
    throw new Error("그림을 그리지 못했습니다.");
  }
  if (state.format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  // 돌린 그림 전체를 (width/crop.w × height/crop.h) 크기로 그리고, 자를 칸만 보이도록 옮긴다.
  const fullW = width / crop.w;
  const fullH = height / crop.h;
  ctx.save();
  ctx.translate(-crop.x * fullW, -crop.y * fullH);
  paintTurned(ctx, shot.image, state.turns, fullW, fullH);
  ctx.restore();
  return out;
}

function toBlob(canvas: HTMLCanvasElement, mime: OutFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("그림을 만들지 못했습니다."));
          return;
        }
        resolve(blob);
      },
      mime === "png" ? "image/png" : "image/jpeg",
      mime === "jpeg" ? quality : undefined,
    );
  });
}

function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export async function makeEdited(shot: PrivacyShot, state: EditState): Promise<EditResult> {
  const base = croppedSize(shot, state);
  if (state.sizeMode !== "kb" || state.format !== "jpeg") {
    const size = resultSize(shot, state);
    const canvas = renderCanvas(shot, state, size.width, size.height);
    try {
      const blob = await toBlob(canvas, state.format, 0.9);
      return { blob, width: size.width, height: size.height, note: "" };
    } finally {
      release(canvas);
    }
  }
  // 용량 지정: JPEG 품질을 먼저 낮추고, 그래도 크면 크기를 조금씩 줄인다.
  const limit = clampTargetKb(state.targetKb) * 1024;
  let scale = 1;
  let smallest: EditResult | null = null;
  for (let round = 0; round < 7; round += 1) {
    const width = Math.max(MIN_EDGE, Math.round(base.width * scale));
    const height = Math.max(MIN_EDGE, Math.round(base.height * scale));
    const canvas = renderCanvas(shot, state, width, height);
    try {
      let low = 0.5;
      let high = 0.92;
      let fit: Blob | null = null;
      const top = await toBlob(canvas, "jpeg", high);
      if (top.size <= limit) {
        fit = top;
      } else {
        for (let step = 0; step < 5; step += 1) {
          const mid = (low + high) / 2;
          const blob = await toBlob(canvas, "jpeg", mid);
          if (blob.size <= limit) {
            fit = blob;
            low = mid;
          } else {
            high = mid;
          }
        }
      }
      if (fit) {
        return {
          blob: fit,
          width,
          height,
          note: scale < 1 ? "용량을 맞추려고 그림 크기도 조금 줄였습니다." : "",
        };
      }
      const last = await toBlob(canvas, "jpeg", 0.5);
      if (!smallest || last.size < smallest.blob.size) {
        smallest = { blob: last, width, height, note: "" };
      }
    } finally {
      release(canvas);
    }
    scale *= 0.85;
  }
  if (!smallest) {
    throw new Error("그림을 만들지 못했습니다.");
  }
  return { ...smallest, note: "목표 용량까지 줄이지 못했습니다. 가장 작게 만든 파일입니다." };
}

export function editFileName(sourceName: string, format: OutFormat): string {
  const base = sourceName.split(/[/\\]/).pop()?.trim() || "사진";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "사진";
  return `${stem.slice(0, 80)}_다듬기.${format === "png" ? "png" : "jpg"}`;
}
