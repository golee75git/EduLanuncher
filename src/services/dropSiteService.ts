import { invoke } from "@tauri-apps/api/core";
import { asLocalPngIcon } from "../data/toolIcons";
import { useToolStore } from "../stores/toolStore";

export interface UrlShortcut {
  url: string;
  name: string;
  iconImage?: string;
}

export function isUrlShortcutPath(path: string): boolean {
  return /\.(url|website)$/i.test(path.trim());
}

export function extractDroppedHttpUrl(raw: string): string | null {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text || text.length > 2048) {
    return null;
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    return null;
  }
  const candidate = lines[0].split(/\s+/)[0];
  if (!/^https?:\/\//i.test(candidate)) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function extractDroppedTitle(raw: string): string | undefined {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length < 2 || !/^https?:\/\//i.test(lines[0])) {
    return undefined;
  }
  return cleanDropTitle(lines[1]);
}

export function nameFromHttpUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host || "사이트";
  } catch {
    return "사이트";
  }
}

export function cleanDropTitle(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  let name = raw.replace(/\.(url|website)$/i, "").trim();
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the original stem when it is not percent-encoded.
  }
  name = name.replace(/\s+/g, " ").trim();
  if (!name) {
    return undefined;
  }
  const compact = name.replace(/\s/g, "");
  if (/^https?:/i.test(name) || name.includes("://") || /^www\./i.test(compact)) {
    return undefined;
  }
  return name.slice(0, 80);
}

export function pickDroppedSiteName(url: string, ...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const name = cleanDropTitle(candidate);
    if (name) {
      return name;
    }
  }
  return nameFromHttpUrl(url);
}

export function sameHttpUrl(left: string, right: string): boolean {
  const a = extractDroppedHttpUrl(left);
  const b = extractDroppedHttpUrl(right);
  if (!a || !b) {
    return left.trim() === right.trim();
  }
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export function isWeakSiteName(url: string, name: string): boolean {
  const trimmed = name.trim();
  if (!cleanDropTitle(trimmed)) {
    return true;
  }
  const host = nameFromHttpUrl(url).toLowerCase();
  const lower = trimmed.toLowerCase();
  return lower === host || lower === url.toLowerCase() || /^https?:/i.test(trimmed);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&");
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function extractDroppedPngPicture(html: string): string | undefined {
  const snippet = html.trim().slice(0, 8192);
  if (!snippet) {
    return undefined;
  }
  const found = snippet.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/i);
  if (!found?.[1]) {
    return undefined;
  }
  return asLocalPngIcon(`data:image/png;base64,${found[1]}`);
}

export function extractUrlAndTitleFromHtml(html: string): { url: string; name?: string } | null {
  const snippet = html.trim().slice(0, 8192);
  if (!snippet) {
    return null;
  }
  const anchor = snippet.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (anchor) {
    const url = extractDroppedHttpUrl(decodeHtmlEntities(anchor[1] ?? ""));
    if (url) {
      return { url, name: cleanDropTitle(stripTags(anchor[2] ?? "")) };
    }
  }
  const href = snippet.match(/href\s*=\s*["'](https?:\/\/[^"']+)["']/i);
  const title = snippet.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const url = href ? extractDroppedHttpUrl(decodeHtmlEntities(href[1] ?? "")) : null;
  if (!url) {
    return null;
  }
  return { url, name: cleanDropTitle(stripTags(title?.[1] ?? "")) };
}

export function httpUrlFromDataTransfer(
  transfer: DataTransfer,
): { url: string; name?: string; iconImage?: string } | null {
  const html = transfer.types.includes("text/html") ? transfer.getData("text/html") : "";
  const fromHtml = html ? extractUrlAndTitleFromHtml(html) : null;
  const picture = html ? extractDroppedPngPicture(html) : undefined;
  const moz = transfer.getData("text/x-moz-url");
  const list = transfer.getData("text/uri-list");
  const plain = transfer.getData("text/plain");
  const url =
    fromHtml?.url ||
    (moz ? extractDroppedHttpUrl(moz) : null) ||
    (list ? extractDroppedHttpUrl(list) : null) ||
    (plain ? extractDroppedHttpUrl(plain) : null);
  if (!url) {
    return null;
  }
  const name =
    fromHtml?.name ||
    (moz ? extractDroppedTitle(moz) : undefined) ||
    (list ? extractDroppedTitle(list) : undefined) ||
    (plain ? extractDroppedTitle(plain) : undefined);
  return { url, name, ...(picture ? { iconImage: picture } : {}) };
}

export async function readUrlShortcut(path: string): Promise<UrlShortcut> {
  return invoke<UrlShortcut>("read_url_shortcut", { path });
}

let addDroppedSiteQueue: Promise<void> = Promise.resolve();

export async function addDroppedSite(
  url: string,
  name?: string,
  iconImage?: string,
): Promise<"added" | "exists" | "updated"> {
  let finish: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const previous = addDroppedSiteQueue;
  addDroppedSiteQueue = gate;
  await previous;
  try {
    return await addDroppedSiteNow(url, name, iconImage);
  } finally {
    finish();
  }
}

async function addDroppedSiteNow(
  url: string,
  name?: string,
  iconImage?: string,
): Promise<"added" | "exists" | "updated"> {
  const target = extractDroppedHttpUrl(url);
  if (!target) {
    throw new Error("http(s) 주소만 넣을 수 있습니다.");
  }
  const picture = asLocalPngIcon(iconImage);
  const incoming = cleanDropTitle(name);
  const label = pickDroppedSiteName(target, name);
  const existing = useToolStore
    .getState()
    .tools.find((tool) => tool.type === "url" && sameHttpUrl(tool.target, target));
  if (existing) {
    const next: { name?: string; keywords?: string[]; iconImage?: string } = {};
    if (incoming && isWeakSiteName(target, existing.name) && incoming !== existing.name) {
      next.name = incoming;
      next.keywords = [incoming, nameFromHttpUrl(target)];
    }
    if (picture && !asLocalPngIcon(existing.iconImage)) {
      next.iconImage = picture;
    }
    if (next.name || next.iconImage) {
      await useToolStore.getState().updateTool(existing.id, next);
      return next.name ? "updated" : "exists";
    }
    return "exists";
  }
  await useToolStore.getState().addTool({
    id: crypto.randomUUID(),
    name: label,
    type: "url",
    target,
    icon: "globe",
    ...(picture ? { iconImage: picture } : {}),
    category: "기타",
    favorite: true,
    keywords: [label, nameFromHttpUrl(target)],
    usageCount: 0,
    enabled: true,
    origin: "local",
  });
  return "added";
}

export function parseInternetShortcut(contents: string, fallbackName?: string): UrlShortcut | null {
  const text = contents.replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^URL=(.*)$/i);
    if (!match) {
      continue;
    }
    const url = extractDroppedHttpUrl(match[1] ?? "");
    if (!url) {
      continue;
    }
    const name = pickDroppedSiteName(url, fallbackName);
    return { url, name };
  }
  return null;
}

export function isDroppableDrag(transfer: DataTransfer): boolean {
  const types = Array.from(transfer.types);
  return (
    types.includes("Files") ||
    types.includes("text/uri-list") ||
    types.includes("text/x-moz-url") ||
    types.includes("text/html") ||
    types.includes("text/plain")
  );
}

export function droppedFilePath(file: File): string {
  const path = (file as File & { path?: string }).path;
  return typeof path === "string" ? path.trim() : "";
}

export function normalizeLocalPathKey(path: string): string {
  return path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function sameLocalPath(left: string, right: string): boolean {
  return normalizeLocalPathKey(left) === normalizeLocalPathKey(right);
}

export function extractDroppedLocalPath(raw: string): string | null {
  const text = raw.replace(/^\uFEFF/, "").trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!text || text.length > 4096 || /^https?:\/\//i.test(text)) {
    return null;
  }
  if (/^file:/i.test(text)) {
    try {
      const parsed = new URL(text);
      let pathname = decodeURIComponent(parsed.pathname);
      if (/^\/[a-zA-Z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname.replace(/\//g, "\\");
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("\\\\")) {
    return text.replace(/\//g, "\\");
  }
  return null;
}

export function extractDroppedLocalPaths(raw: string): string[] {
  const paths: string[] = [];
  for (const line of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const path = extractDroppedLocalPath(line);
    if (path && !paths.some((item) => sameLocalPath(item, path))) {
      paths.push(path);
    }
  }
  return paths;
}

export const DROP_PATH_LIMIT = 10;

export interface DroppedPathSummary {
  added: number;
  exists: number;
  missing: number;
  skipped: number;
}

interface DroppedPathInfo {
  path: string;
  exists: boolean;
  kind: "file" | "folder" | "app";
  name: string;
  iconImage?: string;
}

function iconForLocalType(type: "file" | "folder" | "app"): string {
  if (type === "folder") {
    return "folder";
  }
  if (type === "app") {
    return "monitor";
  }
  return "file";
}

let addDroppedPathQueue: Promise<void> = Promise.resolve();

export async function addDroppedPaths(paths: string[]): Promise<DroppedPathSummary> {
  let finish: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const previous = addDroppedPathQueue;
  addDroppedPathQueue = gate;
  await previous;
  try {
    return await addDroppedPathsNow(paths);
  } finally {
    finish();
  }
}

async function addDroppedPathsNow(paths: string[]): Promise<DroppedPathSummary> {
  const unique: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed || unique.some((item) => sameLocalPath(item, trimmed))) {
      continue;
    }
    unique.push(trimmed);
  }
  const skipped = Math.max(0, unique.length - DROP_PATH_LIMIT);
  const limited = unique.slice(0, DROP_PATH_LIMIT);
  const summary: DroppedPathSummary = { added: 0, exists: 0, missing: 0, skipped };
  for (const path of limited) {
    const result = await addDroppedPathNow(path);
    summary[result] += 1;
  }
  return summary;
}

async function addDroppedPathNow(path: string): Promise<"added" | "exists" | "missing"> {
  const info = await invoke<DroppedPathInfo>("dropped_path_info", { path });
  if (!info.exists) {
    return "missing";
  }
  const type = info.kind === "folder" || info.kind === "app" ? info.kind : "file";
  const existing = useToolStore
    .getState()
    .tools.find(
      (tool) =>
        (tool.type === "file" || tool.type === "folder" || tool.type === "app") &&
        sameLocalPath(tool.target, info.path),
    );
  if (existing) {
    return "exists";
  }
  const name = info.name.trim() || "바로가기";
  const picture = asLocalPngIcon(info.iconImage);
  await useToolStore.getState().addTool({
    id: crypto.randomUUID(),
    name,
    type,
    target: info.path,
    icon: iconForLocalType(type),
    ...(picture ? { iconImage: picture } : {}),
    category: "기타",
    favorite: true,
    keywords: [name],
    usageCount: 0,
    enabled: true,
    origin: "local",
  });
  return "added";
}
