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

export function applyVerifiedIndex(file: ManualIndexFile | null | undefined): void {
  if (file && applyFile(file)) {
    return;
  }
  if (topics.length === 0) {
    unavailable = "업무 자료를 불러올 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
  }
}
