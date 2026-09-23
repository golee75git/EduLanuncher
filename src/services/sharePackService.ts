import type { LauncherPack } from "../data/educationPack";
import type { NoticeItem, NoticeKind, NoticePack } from "../types/notice";
import type { ToolItem } from "../types/tool";
import { buildLauncherPack, parseLauncherPack } from "./launcherPackService";
import { NOTICE_KIND_LABEL } from "../types/notice";

export const SHARE_KIND = "edulauncher-share" as const;

export interface SharePack {
  kind: typeof SHARE_KIND;
  version: 1;
  name: string;
  exportedAt: string;
  notices: NoticeItem[];
  tools: ToolItem[];
}

const MAX_SUMMARY = 200;
const MAX_TITLE = 120;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asKind(value: unknown): NoticeKind {
  return value === "alert" ? "alert" : "org";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function isSharePack(raw: unknown): boolean {
  return Boolean(
    raw &&
      typeof raw === "object" &&
      (raw as Record<string, unknown>).kind === SHARE_KIND,
  );
}

function parseShareNotices(raw: unknown): NoticeItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const notices: NoticeItem[] = [];
  for (const item of raw) {
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
    const kind = asKind(row.kind);
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
  return notices;
}

export function parseSharePack(raw: unknown): SharePack {
  if (!isSharePack(raw)) {
    throw new Error("공지·사이트 Pack이 아닙니다.");
  }
  const source = raw as Record<string, unknown>;
  const notices = parseShareNotices(source.notices);
  let tools: ToolItem[] = [];
  if (Array.isArray(source.tools) && source.tools.length > 0) {
    const launcher = parseLauncherPack({
      id: asText(source.id) || "pack-share-sites",
      name: asText(source.name) || "공지·사이트 Pack",
      version: "0.1.0",
      tools: source.tools,
    });
    tools = launcher.tools.filter((tool) => tool.type === "url");
  }
  if (notices.length === 0 && tools.length === 0) {
    throw new Error("공지 또는 사이트 바로가기가 필요합니다.");
  }
  return {
    kind: SHARE_KIND,
    version: 1,
    name: asText(source.name) || "공지·사이트 Pack",
    exportedAt: asText(source.exportedAt) || new Date().toISOString(),
    notices,
    tools,
  };
}

export function shareNoticePack(share: SharePack): NoticePack {
  const kind = share.notices[0]?.kind === "alert" ? "alert" : "org";
  return {
    id: "pack-share-notices",
    name: share.name,
    version: "0.1.0",
    kind,
    notices: share.notices,
  };
}

export function shareLauncherPack(share: SharePack): LauncherPack | null {
  if (share.tools.length === 0) {
    return null;
  }
  return {
    id: "pack-share-sites",
    name: share.name,
    version: "0.1.0",
    tools: share.tools.map((tool) => ({
      ...tool,
      type: "url" as const,
      origin: "pack",
      packName: share.name,
    })),
  };
}

export function buildSharePack(
  name: string,
  notices: NoticeItem[],
  tools: ToolItem[],
): SharePack {
  const sites = buildLauncherPack(name.trim() || "공지·사이트 Pack", tools).tools;
  const clipped = parseShareNotices(notices);
  if (clipped.length === 0 && sites.length === 0) {
    throw new Error("저장할 공지 또는 사이트 바로가기가 없습니다.");
  }
  return {
    kind: SHARE_KIND,
    version: 1,
    name: name.trim() || "공지·사이트 Pack",
    exportedAt: new Date().toISOString(),
    notices: clipped,
    tools: sites,
  };
}

export function describeShareContents(share: SharePack): string {
  const parts: string[] = [];
  if (share.notices.length > 0) {
    const kinds = new Set(share.notices.map((item) => NOTICE_KIND_LABEL[item.kind]));
    parts.push(`공지 ${share.notices.length}건(${[...kinds].join("·")})`);
  }
  if (share.tools.length > 0) {
    parts.push(`사이트 ${share.tools.length}개`);
  }
  return parts.join(", ");
}
