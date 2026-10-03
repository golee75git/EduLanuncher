import { invoke } from "@tauri-apps/api/core";
import { useMemoStore } from "../stores/memoStore";
import { memoWindowTitle, type MemoNote } from "../types/memo";
import type { LaunchResult } from "../types/tool";

export async function hidePanel(): Promise<void> {
  await invoke("hide_panel");
}

export async function showPanel(): Promise<void> {
  await invoke("show_panel");
}

export async function togglePanel(): Promise<void> {
  await invoke("toggle_panel");
}

export async function setLauncherPosition(position: string): Promise<void> {
  await invoke("set_launcher_position", { position });
}

export async function registerShortcut(shortcut: string): Promise<void> {
  await invoke("register_shortcut", { shortcut });
}

export async function launchNative(id: string): Promise<LaunchResult> {
  return invoke<LaunchResult>("launch_tool", { id });
}

export async function launchResult(id: string): Promise<LaunchResult> {
  return invoke<LaunchResult>("launch_result", { id });
}

export async function openFolder(id: string): Promise<LaunchResult> {
  return invoke<LaunchResult>("open_folder_with_explorer", { id });
}

export async function clearSearchGrants(kind: "doc" | "user" | "url", batch: string): Promise<void> {
  if (!batch) {
    return;
  }
  try {
    await invoke("clear_search_grants", { kind, batch });
  } catch {
    // 화면을 떠날 때 정리하지 못해도 다음 검색이 같은 종류를 비운다.
  }
}

export async function openIeReset(): Promise<void> {
  await invoke("open_ie_reset");
}

export async function openWorkMapWindow(rootId: string): Promise<void> {
  await invoke("open_work_map_window", { rootId });
}

export async function publishMemoBoard(selected = ""): Promise<void> {
  const { text, notes } = useMemoStore.getState();
  await invoke("publish_memo_board", {
    text,
    notes: notes.map((note) => ({ id: note.id, text: note.text })),
    selected,
  });
}

export async function openMemoWindow(selected = ""): Promise<void> {
  await publishMemoBoard(selected);
  await invoke("open_memo_window");
}

export async function openMemoNote(note: MemoNote, index: number, large = false): Promise<void> {
  await invoke("open_memo_note", {
    id: note.id,
    text: note.text,
    title: memoWindowTitle(index),
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    slot: index,
    large,
  });
}

export async function dismissMemoNote(id: string): Promise<void> {
  try {
    await invoke("dismiss_memo_note", { id });
  } catch {
    // 브라우저 미리보기에는 이 명령이 없다.
  }
}

export async function runShortcutAction(actionId: string): Promise<void> {
  await invoke("run_shortcut_action", { actionId });
}

export async function readWorkMapRootId(): Promise<string> {
  try {
    return await invoke<string>("work_map_root_id");
  } catch {
    return "";
  }
}

export async function revealTopicFromMap(topicId: string): Promise<void> {
  await invoke("reveal_topic", { topicId });
}
