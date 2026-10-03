import { invoke } from "@tauri-apps/api/core";

export type SaveKind = "pack" | "json" | "csv" | "png" | "picture";

export interface SaveCard {
  id: string;
  name: string;
}

function asError(error: unknown): Error {
  if (typeof error === "string" && error.trim()) {
    return new Error(error);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error("저장하지 못했습니다.");
}

export type OpenKind = "bookmark" | "pack" | "json" | "picture" | "pictures" | "pdf" | "pdfs";

export async function pickOpenFiles(kind: OpenKind): Promise<SaveCard[]> {
  try {
    return await invoke<SaveCard[]>("pick_open_files", { kind });
  } catch (error) {
    const message = asError(error).message;
    if (message === "cancelled") {
      return [];
    }
    throw asError(error);
  }
}

export async function pickSaveFolder(): Promise<SaveCard | null> {
  try {
    return await invoke<SaveCard>("pick_save_folder");
  } catch (error) {
    const text = asError(error);
    if (text.message.includes("cancelled")) {
      return null;
    }
    throw text;
  }
}

export async function revealMadeFile(id: string): Promise<void> {
  await invoke("reveal_made_file", { id });
}

export async function clearMadeReveals(): Promise<void> {
  await invoke("clear_made_reveals");
}

export async function forgetSaveFolder(id: string): Promise<void> {
  await invoke("forget_save_folder", { id });
}

export async function pickSaveFile(kind: SaveKind, fileName: string, picture?: "png" | "jpeg"): Promise<SaveCard | null> {
  try {
    return await invoke<SaveCard>("pick_save_file", { kind, fileName, picture: picture ?? null });
  } catch (error) {
    const text = asError(error);
    if (text.message.includes("cancelled")) {
      return null;
    }
    throw text;
  }
}
