import { invoke } from "@tauri-apps/api/core";
import {
  NOTICE_KIND_LABEL,
  type NoticeItem,
  type NoticeKind,
  type NoticePack,
} from "../types/notice";

const MAX_SUMMARY = 200;
const MAX_TITLE = 120;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asKind(value: unknown): NoticeKind {
  return value === "alert" ? "alert" : "org";
}

export function noticeKindOf(item: Pick<NoticeItem, "kind"> | undefined): NoticeKind {
  return item?.kind === "alert" ? "alert" : "org";
}

export function parseNoticePack(raw: unknown): NoticePack {
  if (!raw || typeof raw !== "object") {
    throw new Error("공지 Pack 형식이 올바르지 않습니다.");
  }
  const source = raw as Record<string, unknown>;
  const noticesRaw = source.notices;
  if (!Array.isArray(noticesRaw)) {
    throw new Error("notices 배열이 필요합니다.");
  }
  const packKind = asKind(source.kind);

  const notices: NoticeItem[] = [];
  for (const item of noticesRaw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = asText(row.id);
    const title = asText(row.title).slice(0, MAX_TITLE);
    const publishedAt = asText(row.publishedAt);
    if (!id || !title || !publishedAt) {
      continue;
    }
    const url = asText(row.url);
    if (url && !isHttpUrl(url)) {
      continue;
    }
    const summary = asText(row.summary).slice(0, MAX_SUMMARY);
    const expiresAt = asText(row.expiresAt);
    const kind = row.kind === undefined ? packKind : asKind(row.kind);
    notices.push({
      id,
      kind,
      title,
      publishedAt,
      ...(summary ? { summary } : {}),
      ...(url ? { url } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  if (notices.length === 0) {
    throw new Error("가져올 항목이 없습니다. id, title, publishedAt이 필요합니다.");
  }

  return {
    id: asText(source.id) || (packKind === "alert" ? "pack-common-alerts" : "pack-org-notices"),
    name: asText(source.name) || NOTICE_KIND_LABEL[packKind],
    version: asText(source.version) || "0.1.0",
    kind: packKind,
    notices: notices.map((item) => ({ ...item, kind: packKind })),
  };
}

export function isNoticeActive(notice: NoticeItem, now = new Date()): boolean {
  if (!notice.expiresAt) {
    return true;
  }
  const expiresKey = notice.expiresAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresKey)) {
    return true;
  }
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return expiresKey >= today;
}

export function sortNotices(notices: NoticeItem[]): NoticeItem[] {
  return [...notices].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.title.localeCompare(b.title, "ko"),
  );
}

export async function readJsonFile(path: string): Promise<string> {
  return invoke<string>("read_json_file", { path });
}

export async function writeJsonFile(path: string, contents: string): Promise<void> {
  await invoke("write_json_file", { path, contents });
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildNoticePack(name: string, notices: NoticeItem[], kind: NoticeKind): NoticePack {
  const labeled = notices.map((item) => ({ ...item, kind }));
  return parseNoticePack({
    id: kind === "alert" ? "pack-common-alerts" : "pack-org-notices",
    name: name.trim() || NOTICE_KIND_LABEL[kind],
    version: "0.1.0",
    kind,
    notices: labeled,
  });
}
