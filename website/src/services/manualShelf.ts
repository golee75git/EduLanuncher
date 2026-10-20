import { detailIdForHandbook, handbookIdForDetail } from "./manualField.ts";

export const FAVORITES_KEY = "ailauncher.manual.favorites";
export const RECENT_KEY = "ailauncher.manual.recent";
export const CHECKS_KEY = "ailauncher.manual.checks";
export const RECENT_LIMIT = 12;
export const SHELF_SAVE_WARNING = "이 브라우저에서는 즐겨찾기가 영구 저장되지 않습니다.";

export interface RecentRow {
  id: string;
  openedAt: number;
}

export interface CheckItem {
  id: string;
  label: string;
}

interface ShelfData {
  favorites: string[];
  recent: RecentRow[];
  checks: Record<string, string[]>;
}

const listeners = new Set<() => void>();
let cache: ShelfData | null = null;
let persistFailed = false;

export function canonicalWorkId(id: string): string {
  return handbookIdForDetail(id) ?? id;
}

export function checklistToShow(items: CheckItem[] | null | undefined): CheckItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item.id.trim() && item.label.trim());
}

export function normalizeFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const key = canonicalWorkId(item.trim());
    if (!ids.includes(key)) ids.push(key);
  }
  return ids.slice(0, 200);
}

export function normalizeRecent(value: unknown): RecentRow[] {
  if (!Array.isArray(value)) return [];
  const rows: RecentRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { id?: unknown; openedAt?: unknown };
    if (typeof raw.id !== "string" || !raw.id.trim()) continue;
    const openedAt = typeof raw.openedAt === "number" && Number.isFinite(raw.openedAt) ? raw.openedAt : 0;
    const key = canonicalWorkId(raw.id.trim());
    if (rows.some((row) => row.id === key)) continue;
    rows.push({ id: key, openedAt });
  }
  rows.sort((left, right) => right.openedAt - left.openedAt);
  return rows.slice(0, RECENT_LIMIT);
}

export function normalizeChecks(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const checks: Record<string, string[]> = {};
  for (const [workId, items] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(items)) continue;
    const ids = [
      ...new Set(
        items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()),
      ),
    ];
    if (ids.length > 0) checks[canonicalWorkId(workId)] = ids;
  }
  return checks;
}

export function shelfTarget(id: string): string | null {
  const key = canonicalWorkId(id);
  if (key === "TOPIC-EPKI-01") return null;
  if (key.startsWith("TOPIC-")) {
    const detailId = detailIdForHandbook(key);
    if (detailId) return `/menu/topic/${encodeURIComponent(detailId)}`;
    return `/menu/handbook/${encodeURIComponent(key)}`;
  }
  if (key.startsWith("topic-")) return `/menu/topic/${encodeURIComponent(key)}`;
  return null;
}

export function toggleFavoriteIds(ids: string[], id: string): string[] {
  const key = canonicalWorkId(id);
  const current = normalizeFavorites(ids);
  if (current.includes(key)) return current.filter((item) => item !== key);
  return [key, ...current].slice(0, 200);
}

export function rememberRecent(rows: RecentRow[], id: string, openedAt: number): RecentRow[] {
  const key = canonicalWorkId(id);
  return normalizeRecent([{ id: key, openedAt }, ...rows.filter((row) => canonicalWorkId(row.id) !== key)]);
}

export function toggleCheckIds(checks: Record<string, string[]>, workId: string, itemId: string): Record<string, string[]> {
  const key = canonicalWorkId(workId);
  const current = checks[key] ?? [];
  const next = current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId];
  return { ...checks, [key]: next };
}

function emptyShelf(): ShelfData {
  return { favorites: [], recent: [], checks: {} };
}

function browserStore(): Storage | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    const probe = "ailauncher.manual.probe";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

function readStored(): ShelfData {
  const store = browserStore();
  if (!store) {
    persistFailed = true;
    return emptyShelf();
  }
  try {
    return {
      favorites: normalizeFavorites(JSON.parse(store.getItem(FAVORITES_KEY) || "[]")),
      recent: normalizeRecent(JSON.parse(store.getItem(RECENT_KEY) || "[]")),
      checks: normalizeChecks(JSON.parse(store.getItem(CHECKS_KEY) || "{}")),
    };
  } catch {
    persistFailed = true;
    return emptyShelf();
  }
}

function load(): ShelfData {
  if (!cache) cache = readStored();
  return cache;
}

function save(next: ShelfData) {
  cache = next;
  const store = browserStore();
  if (!store) {
    persistFailed = true;
    return;
  }
  try {
    store.setItem(FAVORITES_KEY, JSON.stringify(next.favorites));
    store.setItem(RECENT_KEY, JSON.stringify(next.recent));
    store.setItem(CHECKS_KEY, JSON.stringify(next.checks));
  } catch {
    persistFailed = true;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeShelf(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function shelfWarning(): string {
  load();
  return persistFailed ? SHELF_SAVE_WARNING : "";
}

export function favoriteIds(): string[] {
  return load().favorites;
}

export function recentRows(): RecentRow[] {
  return load().recent;
}

export function checkedIds(workId: string): string[] {
  return load().checks[canonicalWorkId(workId)] ?? [];
}

export function checkMap(): Record<string, string[]> {
  return load().checks;
}

export function isFavorite(id: string): boolean {
  return load().favorites.includes(canonicalWorkId(id));
}

export function toggleFavorite(id: string) {
  const current = load();
  save({ ...current, favorites: toggleFavoriteIds(current.favorites, id) });
  emit();
}

export function clearFavorites() {
  const current = load();
  save({ ...current, favorites: [] });
  emit();
}

export function noteVisit(id: string, openedAt = Date.now()) {
  if (!id.trim()) return;
  const current = load();
  save({ ...current, recent: rememberRecent(current.recent, id, openedAt) });
  emit();
}

export function removeRecent(id: string) {
  const key = canonicalWorkId(id);
  const current = load();
  save({ ...current, recent: current.recent.filter((row) => row.id !== key) });
  emit();
}

export function clearRecent() {
  const current = load();
  save({ ...current, recent: [] });
  emit();
}

export function toggleCheck(workId: string, itemId: string) {
  const current = load();
  save({ ...current, checks: toggleCheckIds(current.checks, workId, itemId) });
  emit();
}

export function resetChecks(workId: string) {
  const current = load();
  const checks = { ...current.checks };
  delete checks[canonicalWorkId(workId)];
  save({ ...current, checks });
  emit();
}

export function resetShelfCacheForTests() {
  cache = null;
  persistFailed = false;
}
