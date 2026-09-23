import { saveTools, saveTodos, saveMemo, saveNotices } from "./storageService";
import { useMemoStore } from "../stores/memoStore";
import { useNoticeStore } from "../stores/noticeStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTodoStore } from "../stores/todoStore";
import { useToolStore } from "../stores/toolStore";
import { EMPTY_MEMO, type LocalMemo } from "../types/memo";
import { EMPTY_NOTICES, type NoticeItem, type NoticeKind, type StoredNotices } from "../types/notice";
import {
  DEFAULT_SETTINGS,
  asListColumns,
  asMemoHeight,
  asMemoWidth,
  asPanelHeight,
  asPanelSkin,
  asPanelWidth,
  type AppSettings,
  type LauncherPosition,
} from "../types/settings";
import { asDueYmd } from "./todoDate";
import type { TodoItem } from "../types/todo";
import type { ToolItem, ToolOrigin, ToolType } from "../types/tool";

export const BACKUP_KIND = "edulauncher-backup";

const TOOL_TYPES: ToolType[] = ["url", "file", "folder", "app", "internal"];
const MAX_TOOLS = 400;
const MAX_TODOS = 200;
const MAX_NOTICES = 200;
const MAX_MEMO = 20000;
const MAX_TITLE = 120;

export interface LauncherBackup {
  kind: typeof BACKUP_KIND;
  version: 1;
  exportedAt: string;
  tools: ToolItem[];
  todos: TodoItem[];
  settings: AppSettings;
  memo: LocalMemo;
  notices: StoredNotices;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asToolType(value: unknown): ToolType | null {
  return TOOL_TYPES.includes(value as ToolType) ? (value as ToolType) : null;
}

function asOrigin(value: unknown): ToolOrigin {
  return value === "pack" ? "pack" : "local";
}

function asKind(value: unknown): NoticeKind {
  return value === "alert" ? "alert" : "org";
}

function isBackup(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).kind === BACKUP_KIND);
}

export function isLauncherBackup(raw: unknown): boolean {
  return isBackup(raw);
}

function parseTools(raw: unknown): ToolItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const tools: ToolItem[] = [];
  for (const item of raw) {
    if (tools.length >= MAX_TOOLS || !item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = asText(row.id);
    const name = asText(row.name);
    const type = asToolType(row.type);
    const target = asText(row.target);
    if (!id || !name || !type) {
      continue;
    }
    const origin = asOrigin(row.origin);
    tools.push({
      id,
      name,
      type,
      target,
      origin,
      ...(asText(row.description) ? { description: asText(row.description) } : {}),
      ...(asText(row.icon) ? { icon: asText(row.icon) } : {}),
      ...(asText(row.category) ? { category: asText(row.category) } : {}),
      ...(asText(row.packName) ? { packName: asText(row.packName) } : {}),
      favorite: row.favorite === true,
      enabled: row.enabled === false ? false : true,
      usageCount: typeof row.usageCount === "number" ? row.usageCount : 0,
      ...(asText(row.lastUsedAt) ? { lastUsedAt: asText(row.lastUsedAt) } : {}),
      keywords: Array.isArray(row.keywords)
        ? row.keywords.filter((word): word is string => typeof word === "string" && word.trim().length > 0)
        : undefined,
    });
  }
  return tools;
}

function parseTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const todos: TodoItem[] = [];
  for (const item of raw) {
    if (todos.length >= MAX_TODOS || !item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = asText(row.id);
    const title = asText(row.title).slice(0, MAX_TITLE);
    if (!id || !title) {
      continue;
    }
    const dueDate = asDueYmd(row.dueDate);
    todos.push({
      id,
      title,
      completed: row.completed === true,
      createdAt: asText(row.createdAt) || new Date().toISOString(),
      ...(dueDate ? { dueDate } : {}),
    });
  }
  return todos;
}

function parseNotices(raw: unknown): StoredNotices {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_NOTICES };
  }
  const source = raw as Record<string, unknown>;
  const list = Array.isArray(source.notices) ? source.notices : [];
  const notices: NoticeItem[] = [];
  for (const item of list) {
    if (notices.length >= MAX_NOTICES || !item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = asText(row.id);
    const title = asText(row.title).slice(0, MAX_TITLE);
    const publishedAt = asText(row.publishedAt);
    if (!id || !title || !publishedAt) {
      continue;
    }
    notices.push({
      id,
      kind: asKind(row.kind),
      title,
      publishedAt,
      origin: row.origin === "pack" ? "pack" : "local",
      ...(asText(row.packName) ? { packName: asText(row.packName) } : {}),
      ...(asText(row.summary) ? { summary: asText(row.summary) } : {}),
      ...(asText(row.url) ? { url: asText(row.url) } : {}),
      ...(asText(row.expiresAt) ? { expiresAt: asText(row.expiresAt) } : {}),
    });
  }
  return {
    notices,
    ...(asText(source.packId) ? { packId: asText(source.packId) } : {}),
    ...(asText(source.packName) ? { packName: asText(source.packName) } : {}),
    ...(asText(source.importedAt) ? { importedAt: asText(source.importedAt) } : {}),
  };
}

function parseMemo(raw: unknown): LocalMemo {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_MEMO };
  }
  const source = raw as Record<string, unknown>;
  return {
    text: typeof source.text === "string" ? source.text.slice(0, MAX_MEMO) : "",
    updatedAt: asText(source.updatedAt),
  };
}

function parseSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  const source = raw as Record<string, unknown>;
  const position: LauncherPosition =
    source.launcherPosition === "center" ? "center" : DEFAULT_SETTINGS.launcherPosition;
  const favoriteCount =
    typeof source.favoriteCount === "number"
      ? Math.min(12, Math.max(3, Math.round(source.favoriteCount)))
      : DEFAULT_SETTINGS.favoriteCount;
  const recentCount =
    typeof source.recentCount === "number"
      ? Math.min(10, Math.max(3, Math.round(source.recentCount)))
      : DEFAULT_SETTINGS.recentCount;
  return {
    autoStart: source.autoStart === false ? false : DEFAULT_SETTINGS.autoStart,
    showWindowOnLaunch: source.showWindowOnLaunch === false ? false : DEFAULT_SETTINGS.showWindowOnLaunch,
    launcherPosition: position,
    globalShortcut: asText(source.globalShortcut) || DEFAULT_SETTINGS.globalShortcut,
    favoriteCount,
    recentCount,
    showCompletedTodos: source.showCompletedTodos === true,
    hideEmptySearchGroups: source.hideEmptySearchGroups === true,
    onboarded: source.onboarded !== false,
    panelSkin: asPanelSkin(source.panelSkin),
    listColumns: asListColumns(source.listColumns),
    panelWidth: asPanelWidth(source.panelWidth),
    panelHeight: asPanelHeight(source.panelHeight),
    memoWidth: asMemoWidth(source.memoWidth),
    memoHeight: asMemoHeight(source.memoHeight),
  };
}

export function parseLauncherBackup(raw: unknown): LauncherBackup {
  if (!isBackup(raw)) {
    throw new Error("런처 백업 파일이 아닙니다.");
  }
  return {
    kind: BACKUP_KIND,
    version: 1,
    exportedAt: asText(raw.exportedAt) || new Date().toISOString(),
    tools: parseTools(raw.tools),
    todos: parseTodos(raw.todos),
    settings: parseSettings(raw.settings),
    memo: parseMemo(raw.memo),
    notices: parseNotices(raw.notices),
  };
}

export function buildLauncherBackup(): LauncherBackup {
  const noticesState = useNoticeStore.getState();
  return {
    kind: BACKUP_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    tools: useToolStore.getState().tools.map(({ iconImage: _iconImage, ...tool }) => tool),
    todos: useTodoStore.getState().todos,
    settings: useSettingsStore.getState().settings,
    memo: {
      text: useMemoStore.getState().text,
      updatedAt: new Date().toISOString(),
    },
    notices: {
      packId: noticesState.packId,
      packName: noticesState.packName,
      importedAt: noticesState.importedAt,
      notices: noticesState.notices,
    },
  };
}

function localPathCount(tools: ToolItem[]): number {
  return tools.filter((tool) => tool.type === "file" || tool.type === "folder" || tool.type === "app").length;
}

export function describeBackupApply(backup: LauncherBackup): string {
  const local = localPathCount(backup.tools);
  const parts = [
    `바로가기 ${backup.tools.length}개`,
    `공지·알림 ${backup.notices.notices.length}건`,
    `할 일 ${backup.todos.length}건`,
  ];
  let message = `${parts.join(", ")}을 가져왔습니다.`;
  if (local > 0) {
    message += ` 프로그램·파일·폴더 ${local}개는 이 PC 경로가 다를 수 있습니다.`;
  }
  return message;
}

export async function applyLauncherBackup(backup: LauncherBackup): Promise<string> {
  useToolStore.getState().hydrate(backup.tools);
  await saveTools(useToolStore.getState().tools);

  useTodoStore.getState().hydrate(backup.todos);
  await saveTodos(backup.todos);

  useMemoStore.getState().hydrate(backup.memo);
  await saveMemo(backup.memo);

  useNoticeStore.getState().hydrate(backup.notices);
  await saveNotices({
    packId: backup.notices.packId,
    packName: backup.notices.packName,
    importedAt: backup.notices.importedAt,
    notices: useNoticeStore.getState().notices,
  });

  await useSettingsStore.getState().update(backup.settings);
  return describeBackupApply(backup);
}
