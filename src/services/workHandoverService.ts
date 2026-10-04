import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { launchResult } from "./windowService";
import { pickOpenFiles, pickSaveFile } from "./savePick";

export interface WorkDeadline {
  month: number;
  day: number;
  year?: number | null;
  file: string;
  snippet: string;
}

export interface WorkFileNote {
  rel: string;
  modified: string;
  error?: string | null;
  clues: unknown[];
}

export interface WorkCard {
  name: string;
  ai_name?: string | null;
  months: number[];
  period: string;
  confidence: string;
  years: number[];
  deadlines: WorkDeadline[];
  todos: string[];
  orgs: string[];
  files: WorkFileNote[];
  include: boolean;
}

export interface CardBatch {
  file_count: number;
  model?: string | null;
  notice?: string | null;
  reviewed_at?: string | null;
  tasks: WorkCard[];
}

export interface HandoverStep {
  read: number;
  total: number;
}

function asError(error: unknown): Error {
  if (typeof error === "string" && error.trim()) {
    return new Error(error);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error("파일을 읽지 못했습니다.");
}

export async function pickWorkFolder(): Promise<string | null> {
  try {
    return await invoke<string>("pick_work_folder");
  } catch (error) {
    const message = asError(error).message;
    if (message === "cancelled") {
      return null;
    }
    throw asError(error);
  }
}

export async function runWorkCards(id: string): Promise<CardBatch> {
  try {
    return await invoke<CardBatch>("run_work_cards", { id });
  } catch (error) {
    throw asError(error);
  }
}

export async function haltWorkCards(): Promise<void> {
  await invoke("halt_work_cards");
}

export async function watchHandover(onStep: (step: HandoverStep) => void): Promise<UnlistenFn> {
  return listen<HandoverStep>("handover-step", (event) => onStep(event.payload));
}

export async function saveWorkCards(folderId: string, batch: CardBatch): Promise<void> {
  const card = await pickSaveFile("json", "업무카드.json");
  if (!card) {
    return;
  }
  try {
    await invoke("save_work_cards", { folderId, writeId: card.id, batch });
  } catch (error) {
    throw asError(error);
  }
}

export async function loadWorkCards(): Promise<CardBatch | null> {
  const cards = await pickOpenFiles("json");
  const card = cards[0];
  if (!card) {
    return null;
  }
  try {
    return await invoke<CardBatch>("load_work_cards", { id: card.id });
  } catch (error) {
    throw asError(error);
  }
}

export async function mergeWorkCards(left: WorkCard, right: WorkCard): Promise<WorkCard> {
  try {
    return await invoke<WorkCard>("merge_work_cards", { left, right });
  } catch (error) {
    throw asError(error);
  }
}

export async function openWorkFile(folderId: string | null, rel: string): Promise<void> {
  if (!folderId) {
    throw new Error("업무 폴더를 다시 고르면 열 수 있습니다.");
  }
  try {
    const id = await invoke<string>("open_work_file", { folderId, rel });
    const opened = await launchResult(id);
    if (!opened.ok) {
      throw new Error("파일을 열지 못했습니다.");
    }
  } catch (error) {
    const message = asError(error).message;
    if (message === "업무 폴더를 다시 고르면 열 수 있습니다." || message === "파일을 열지 못했습니다.") {
      throw new Error(message);
    }
    throw new Error("파일을 열지 못했습니다.");
  }
}
