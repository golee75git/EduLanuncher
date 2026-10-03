import { invoke } from "@tauri-apps/api/core";

export type DocPresetId = "high" | "standard" | "compact";
export type DocSaveMode = "beside" | "bundle" | "chosen";

export interface DocPreset {
  id: DocPresetId;
  label: string;
  hint: string;
  maxLongEdge: number;
  jpegQuality: number;
  estimateRate: number;
}

export const DOC_PRESETS: DocPreset[] = [
  {
    id: "high",
    label: "고화질",
    hint: "사진이 중요한 보고서나 인쇄에 맞습니다.",
    maxLongEdge: 2560,
    jpegQuality: 0.9,
    estimateRate: 0.4,
  },
  {
    id: "standard",
    label: "일반 문서용",
    hint: "한글, 워드, 대부분의 보고서에 맞습니다.",
    maxLongEdge: 1920,
    jpegQuality: 0.85,
    estimateRate: 0.2,
  },
  {
    id: "compact",
    label: "용량 최소화",
    hint: "메일이나 첨부처럼 크기를 더 줄일 때 맞습니다.",
    maxLongEdge: 1280,
    jpegQuality: 0.78,
    estimateRate: 0.12,
  },
];

const MAX_PIXELS = 40_000_000;

export function presetById(id: DocPresetId): DocPreset {
  return DOC_PRESETS.find((preset) => preset.id === id) ?? DOC_PRESETS[1];
}

export function estimateSavedBytes(totalBytes: number, preset: DocPreset): number {
  return Math.max(1, Math.round(totalBytes * preset.estimateRate));
}

export function fittedEdge(width: number, height: number, maxLongEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { width, height };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${bytes} B`;
}

export async function readDocByteSize(id: string): Promise<number> {
  return invoke<number>("doc_picture_bytes", { id });
}

export async function planDocSave(id: string, mode: DocSaveMode, chosen: string): Promise<string> {
  return invoke<string>("plan_doc_save", { id, mode, chosen });
}

export async function shrinkOnePicture(
  sourceId: string,
  preset: DocPreset,
  mode: DocSaveMode,
  chosen: string,
): Promise<{
  saved: boolean;
  outPath: string;
  outBytes: number;
  beforeWidth: number;
  beforeHeight: number;
  afterWidth: number;
  afterHeight: number;
  note: string;
}> {
  const file = await invoke<{ mime: string; data: string }>("read_privacy_picture", { id: sourceId });
  const sourceBytes = await readDocByteSize(sourceId);
  const bytes = bytesFromBase64(file.data);
  const blob = new Blob([copyBuffer(bytes)], { type: file.mime });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const beforeWidth = image.naturalWidth;
    const beforeHeight = image.naturalHeight;
    if (beforeWidth < 2 || beforeHeight < 2) {
      throw new Error("그림 크기를 알 수 없습니다.");
    }
    if (beforeWidth * beforeHeight > MAX_PIXELS) {
      throw new Error("그림이 너무 큽니다.");
    }
    const next = fittedEdge(beforeWidth, beforeHeight, preset.maxLongEdge);
    const mime = file.mime === "image/png" ? "image/png" : "image/jpeg";
    const output = await drawBlob(image, next.width, next.height, mime, preset.jpegQuality);
    if (output.size >= sourceBytes) {
      return {
        saved: false,
        outPath: "",
        outBytes: sourceBytes,
        beforeWidth,
        beforeHeight,
        afterWidth: beforeWidth,
        afterHeight: beforeHeight,
        note: "용량이 줄지 않아 새 파일을 만들지 않았습니다.",
      };
    }
    const outPath = await planDocSave(sourceId, mode, chosen);
    const written = await invoke<number>("write_new_picture", {
      path: outPath,
      sourceId,
      data: await blobToBase64(output),
    });
    return {
      saved: true,
      outPath,
      outBytes: written,
      beforeWidth,
      beforeHeight,
      afterWidth: next.width,
      afterHeight: next.height,
      note: "",
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawBlob(
  image: HTMLImageElement,
  width: number,
  height: number,
  mime: string,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.width = 0;
    canvas.height = 0;
    return Promise.reject(new Error("그림을 그리지 못했습니다."));
  }
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) {
          reject(new Error("그림을 만들지 못했습니다."));
          return;
        }
        resolve(blob);
      },
      mime,
      mime === "image/jpeg" ? quality : undefined,
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
  const binary = atob(data.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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
