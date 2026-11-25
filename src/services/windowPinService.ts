import { invoke } from "@tauri-apps/api/core";

export type PinState = "free" | "ours" | "other";

export interface PinRow {
  id: string;
  title: string;
  app: string;
  iconImage?: string;
  state: PinState;
}

export interface PinBoard {
  rows: PinRow[];
  /** 목록에 보이지 않는 창까지 포함해, 런처가 고정한 창이 남아 있는지. */
  holding: boolean;
}

export async function listPinWindows(): Promise<PinBoard> {
  return invoke<PinBoard>("list_pin_windows");
}

export async function setWindowPin(id: string, pinned: boolean): Promise<void> {
  await invoke("set_window_pin", { id, pinned });
}

export async function releaseWindowPins(): Promise<void> {
  await invoke("release_window_pins");
}
