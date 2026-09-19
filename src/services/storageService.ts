import { Store } from "@tauri-apps/plugin-store";
import { EMPTY_MEMO, type LocalMemo } from "../types/memo";
import { EMPTY_NOTICES, type StoredNotices } from "../types/notice";
import { DEFAULT_SETTINGS, asPanelSkin, type AppSettings } from "../types/settings";
import type { TodoItem } from "../types/todo";
import type { ToolItem } from "../types/tool";

let toolsStore: Store | null = null;
let todosStore: Store | null = null;
let settingsStore: Store | null = null;
let memoStore: Store | null = null;
let noticesStore: Store | null = null;

async function getStore(path: string): Promise<Store> {
  return Store.load(path);
}

export async function initStorage(): Promise<void> {
  toolsStore = await getStore("tools.json");
  todosStore = await getStore("todos.json");
  settingsStore = await getStore("settings.json");
  memoStore = await getStore("memo.json");
  noticesStore = await getStore("notices.json");
}

export async function loadTools(): Promise<ToolItem[]> {
  if (!toolsStore) {
    await initStorage();
  }
  const items = await toolsStore?.get<ToolItem[]>("items");
  return items ?? [];
}

export async function saveTools(tools: ToolItem[]): Promise<void> {
  if (!toolsStore) {
    await initStorage();
  }
  await toolsStore?.set("items", tools);
  await toolsStore?.save();
}

export async function loadTodos(): Promise<TodoItem[]> {
  if (!todosStore) {
    await initStorage();
  }
  const items = await todosStore?.get<TodoItem[]>("items");
  return items ?? [];
}

export async function saveTodos(todos: TodoItem[]): Promise<void> {
  if (!todosStore) {
    await initStorage();
  }
  await todosStore?.set("items", todos);
  await todosStore?.save();
}

export async function loadSettings(): Promise<AppSettings> {
  if (!settingsStore) {
    await initStorage();
  }
  const stored = await settingsStore?.get<Partial<AppSettings>>("value");
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  return { ...merged, panelSkin: asPanelSkin(merged.panelSkin) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!settingsStore) {
    await initStorage();
  }
  await settingsStore?.set("value", settings);
  await settingsStore?.save();
}

export async function loadMemo(): Promise<LocalMemo> {
  if (!memoStore) {
    await initStorage();
  }
  const stored = await memoStore?.get<Partial<LocalMemo>>("value");
  return { ...EMPTY_MEMO, ...stored, text: stored?.text ?? "" };
}

export async function saveMemo(memo: LocalMemo): Promise<void> {
  if (!memoStore) {
    await initStorage();
  }
  await memoStore?.set("value", memo);
  await memoStore?.save();
}

export async function loadNotices(): Promise<StoredNotices> {
  if (!noticesStore) {
    await initStorage();
  }
  const stored = await noticesStore?.get<Partial<StoredNotices>>("value");
  return {
    ...EMPTY_NOTICES,
    ...stored,
    notices: stored?.notices ?? [],
  };
}

export async function saveNotices(value: StoredNotices): Promise<void> {
  if (!noticesStore) {
    await initStorage();
  }
  await noticesStore?.set("value", value);
  await noticesStore?.save();
}
