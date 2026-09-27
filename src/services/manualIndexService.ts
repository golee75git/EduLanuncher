import { Store } from "@tauri-apps/plugin-store";
import { APP_CONFIG } from "../config/app";

export interface ManualIndexTopic {
  id: string;
  title: string;
  category: string;
  line: string;
  text: string;
}

interface ManualIndexFile {
  updatedAt: string;
  topics: ManualIndexTopic[];
}

let topics: ManualIndexTopic[] = [];
let unavailable = "";

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function manualIndexUnavailable(): string {
  return topics.length > 0 ? "" : unavailable;
}

export function searchManualIndex(query: string): ManualIndexTopic[] {
  const needle = fold(query);
  if (!needle || topics.length === 0) return [];
  const hits: Array<{ topic: ManualIndexTopic; score: number }> = [];
  for (const topic of topics) {
    const title = fold(topic.title);
    const body = fold(topic.text);
    let score = 0;
    if (title === needle) score = 100;
    else if (title.includes(needle)) score = 80;
    else if (body.includes(needle)) score = 40;
    if (score > 0) hits.push({ topic, score });
  }
  hits.sort((a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title, "ko"));
  return hits.slice(0, 8).map((hit) => hit.topic);
}

export function manualTopicUrl(id: string): string {
  return `${APP_CONFIG.siteUrl}menu/topic/${encodeURIComponent(id)}`;
}

function applyFile(file: ManualIndexFile | null | undefined): boolean {
  if (!file || !Array.isArray(file.topics) || file.topics.length < 10) return false;
  topics = file.topics.filter((topic) => topic && typeof topic.id === "string" && typeof topic.title === "string");
  unavailable = "";
  return topics.length >= 10;
}

export async function refreshManualIndex(): Promise<void> {
  let store: Store;
  try {
    store = await Store.load("manual-index.json");
  } catch {
    unavailable = "교육행정 매뉴얼을 불러올 수 없습니다. 인터넷 연결 후 다시 시도해 주세요.";
    return;
  }
  const saved = await store.get<ManualIndexFile>("index");
  applyFile(saved);
  try {
    const response = await fetch(`${APP_CONFIG.siteUrl}knowledge/search-index.json`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(String(response.status));
    const text = await response.text();
    if (text.length === 0 || text.length > 8_000_000) throw new Error("size");
    const next = JSON.parse(text) as ManualIndexFile;
    if (saved?.updatedAt && saved.updatedAt === next.updatedAt) return;
    if (!applyFile(next)) return;
    await store.set("index", next);
    await store.save();
  } catch {
    if (topics.length === 0) {
      unavailable = "교육행정 매뉴얼을 불러올 수 없습니다. 인터넷 연결 후 다시 시도해 주세요.";
    }
  }
}
