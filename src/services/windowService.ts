import { invoke } from "@tauri-apps/api/core";
import type { LaunchResult, ToolItem, ToolType } from "../types/tool";

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

export async function launchNative(
  toolType: ToolType,
  target: string,
): Promise<LaunchResult> {
  return invoke<LaunchResult>("launch_tool", { toolType, target });
}

export async function openIeReset(): Promise<void> {
  await invoke("open_ie_reset");
}

export async function openWorkMapWindow(rootId: string): Promise<void> {
  await invoke("open_work_map_window", { rootId });
}

export async function openMemoWindow(): Promise<void> {
  await invoke("open_memo_window");
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

export function isPathTool(tool: Pick<ToolItem, "type">): boolean {
  return tool.type === "file" || tool.type === "folder" || tool.type === "app";
}
