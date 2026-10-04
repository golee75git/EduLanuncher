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
  from_model?: boolean;
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
  ai_open?: boolean;
  months: number[];
  period: string;
  confidence: string;
  years: number[];
  deadlines: WorkDeadline[];
  todos: string[];
  todo_open?: boolean[];
  orgs: string[];
  org_open?: boolean[];
  files: WorkFileNote[];
  include: boolean;
  successor_note?: string;
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
  phase?: string;
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

export async function listLocalModels(port: number): Promise<string[]> {
  try {
    return await invoke<string[]>("list_local_models", { port });
  } catch (error) {
    throw asError(error);
  }
}

export async function checkLocalModel(port: number, model: string): Promise<number> {
  try {
    return await invoke<number>("check_local_model", { port, model });
  } catch (error) {
    throw asError(error);
  }
}

export async function assistWorkCards(folderId: string, batch: CardBatch, port: number, model: string): Promise<CardBatch> {
  try {
    return await invoke<CardBatch>("assist_work_cards", { folderId, batch, port, model });
  } catch (error) {
    throw asError(error);
  }
}

export interface BoxDeadline {
  month: number;
  day: number;
  file: string;
  snippet: string;
  from_model?: boolean;
}

export interface BoxFile {
  name: string;
  rel: string;
  hash: string;
}

export interface BoxLink {
  name: string;
  type: string;
  target: string;
}

export interface BoxFolder {
  name: string;
  path: string;
}

export interface BoxCard {
  name: string;
  months: number[];
  period: string;
  confidence: string;
  deadlines: BoxDeadline[];
  todos: string[];
  todo_open?: boolean[];
  orgs: string[];
  org_open?: boolean[];
  ai_open?: boolean;
  note?: string;
  files: BoxFile[];
}

export interface HandoverBox {
  kind: string;
  format: number;
  made_at: string;
  model?: string | null;
  note?: string;
  cards: BoxCard[];
  shortcuts?: BoxLink[];
  folder?: BoxFolder | null;
  memos?: string[];
  content_hash?: string;
}

export interface PrivacySpot {
  key: string;
  label: string;
  kind: string;
}

export interface ExportDraft {
  folder_id: string;
  include_folder: boolean;
  note: string;
  batch: CardBatch;
  shortcuts: BoxLink[];
  memos: string[];
  keep: string[];
}

export async function handoverBoxName(folderId: string): Promise<string> {
  try {
    return await invoke<string>("handover_box_name", { folderId });
  } catch (error) {
    throw asError(error);
  }
}

export async function handoverPrivacySpots(draft: ExportDraft): Promise<PrivacySpot[]> {
  try {
    return await invoke<PrivacySpot[]>("handover_privacy_spots", { draft });
  } catch (error) {
    throw asError(error);
  }
}

export async function writeHandoverBox(writeId: string, draft: ExportDraft): Promise<void> {
  try {
    await invoke("write_handover_box", { writeId, draft });
  } catch (error) {
    throw asError(error);
  }
}

export async function readHandoverBox(): Promise<HandoverBox | null> {
  const files = await pickOpenFiles("pack");
  const file = files[0];
  if (!file) {
    return null;
  }
  try {
    return await invoke<HandoverBox>("read_handover_box", { id: file.id });
  } catch (error) {
    throw asError(error);
  }
}

export async function parseHandoverText(text: string): Promise<HandoverBox> {
  try {
    return await invoke<HandoverBox>("parse_handover_box", { text });
  } catch (error) {
    throw asError(error);
  }
}

export async function checkHandoverFile(folderId: string, rel: string, hash: string): Promise<string> {
  try {
    return await invoke<string>("check_handover_file", { folderId, rel, hash });
  } catch (error) {
    throw asError(error);
  }
}

export interface PathCarry {
  note: string;
  paths: string[];
}

export interface AskPiece {
  title: string;
  excerpt: string;
  rel: string;
  changed: boolean;
}

export interface AskReply {
  kind: string;
  text: string;
  pieces: AskPiece[];
  warning: string;
}

export async function expandHandoverPath(path: string): Promise<string> {
  try {
    return await invoke<string>("expand_handover_path", { path });
  } catch {
    return path;
  }
}

export async function handoverOutsidePaths(draft: ExportDraft): Promise<PathCarry> {
  try {
    return await invoke<PathCarry>("handover_outside_paths", { draft });
  } catch {
    return { note: "", paths: [] };
  }
}

export async function askHandover(body: {
  question: string;
  folderId: string;
  packed: HandoverBox;
  notes: string[];
  port: number;
  model: string;
  useModel: boolean;
}): Promise<AskReply> {
  try {
    return await invoke<AskReply>("ask_handover", { draft: body });
  } catch (error) {
    throw asError(error);
  }
}

export async function localTargetPresent(target: string): Promise<boolean> {
  try {
    return await invoke<boolean>("local_target_present", { target });
  } catch {
    return false;
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
