import rawTopics from "../data/topics.json";
import {
  RESOURCE_TYPES,
  type RecordStatus,
  type ResourceTabId,
  type ResourceType,
  type Topic,
  type TopicResource,
  type WorkflowStep,
} from "../types/topic";

const MAX_TITLE = 160;
const MAX_TEXT = 400;
const MAX_LONG = 800;
const MAX_URL = 500;
const MAX_LIST = 40;
const MAX_STEPS = 16;
const MAX_RESOURCES = 40;

const RESOURCE_TYPE_SET = new Set<string>(RESOURCE_TYPES);

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asStatus(value: unknown): RecordStatus {
  if (value === "current" || value === "old" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function asHttpUrl(value: unknown): string {
  const raw = clip(asText(value), MAX_URL);
  if (!raw) {
    return "";
  }
  if (!/^https?:\/\//i.test(raw)) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function asStringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    const text = clip(asText(item), maxLen);
    if (!text) {
      continue;
    }
    out.push(text);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function asResourceType(value: unknown): ResourceType | null {
  const text = asText(value);
  return RESOURCE_TYPE_SET.has(text) ? (text as ResourceType) : null;
}

function firstSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const cut = trimmed.split(/(?<=다)\.\s+/)[0] ?? trimmed;
  return clip(cut.replace(/\s+/g, " "), MAX_TEXT);
}

function fallbackDescription(category: string, subcategory: string, warnings: string[]): string {
  const fromWarning = firstSentence(warnings[0] ?? "");
  if (fromWarning) {
    return fromWarning;
  }
  if (subcategory) {
    return `${category} · ${subcategory}`;
  }
  return category || "업무 안내";
}

function parseWorkflow(value: unknown): WorkflowStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const steps: WorkflowStep[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const row = item as Record<string, unknown>;
    const title = clip(asText(row.title), MAX_TITLE);
    if (!title) {
      return;
    }
    const order = typeof row.order === "number" && Number.isFinite(row.order) ? row.order : index + 1;
    steps.push({ order, title });
  });
  return steps.sort((a, b) => a.order - b.order).slice(0, MAX_STEPS);
}

function parseResource(value: unknown): TopicResource | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const type = asResourceType(row.type);
  const id = clip(asText(row.id), 80);
  const title = clip(asText(row.title), MAX_TITLE);
  if (!type || !id || !title) {
    return null;
  }
  return {
    id,
    type,
    title,
    summary: clip(asText(row.summary), MAX_TEXT),
    organization: clip(asText(row.organization), MAX_TITLE),
    document: clip(asText(row.document), MAX_TITLE),
    publishedAt: clip(asText(row.publishedAt), 80),
    pages: clip(asText(row.pages), 120),
    url: asHttpUrl(row.url),
    status: asStatus(row.status),
    needsReview: asBool(row.needsReview),
  };
}

function parseTopic(value: unknown): Topic | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = clip(asText(row.id), 80);
  const title = clip(asText(row.title), MAX_TITLE);
  if (!id || !title) {
    return null;
  }
  const category = clip(asText(row.category), 80);
  const subcategory = clip(asText(row.subcategory), 80);
  const warnings = asStringList(row.warnings, 8, MAX_LONG);
  const keywordsRaw =
    row.keywords && typeof row.keywords === "object"
      ? (row.keywords as Record<string, unknown>)
      : {};
  const resources: TopicResource[] = [];
  if (Array.isArray(row.resources)) {
    for (const item of row.resources) {
      const resource = parseResource(item);
      if (!resource) {
        continue;
      }
      resources.push(resource);
      if (resources.length >= MAX_RESOURCES) {
        break;
      }
    }
  }
  const description =
    clip(asText(row.description), MAX_TEXT) || fallbackDescription(category, subcategory, warnings);
  return {
    id,
    title,
    category,
    subcategory,
    description,
    workflow: parseWorkflow(row.workflow),
    keywords: {
      official: asStringList(keywordsRaw.official, MAX_LIST, 80),
      general: asStringList(keywordsRaw.general, MAX_LIST, 80),
      beginner: asStringList(keywordsRaw.beginner, MAX_LIST, MAX_TEXT),
      related: asStringList(keywordsRaw.related, MAX_LIST, 80),
    },
    exampleQuestions: asStringList(row.exampleQuestions, MAX_LIST, MAX_TEXT),
    resources,
    relatedTopics: asStringList(row.relatedTopics, 12, MAX_TITLE),
    warnings,
    status: asStatus(row.status),
    needsReview: asBool(row.needsReview),
  };
}

let cached: Topic[] | null = null;

export function parseTopics(raw: unknown): Topic[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const topics: Topic[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const topic = parseTopic(item);
    if (!topic || seen.has(topic.id)) {
      continue;
    }
    seen.add(topic.id);
    topics.push(topic);
  }
  return topics;
}

export function getTopics(): Topic[] {
  if (!cached) {
    cached = parseTopics(rawTopics);
  }
  return cached;
}

export async function loadTopics(): Promise<Topic[]> {
  return getTopics();
}

export function getTopicById(id: string): Topic | undefined {
  return getTopics().find((topic) => topic.id === id);
}

export function findRelatedTopics(topic: Topic): Topic[] {
  const all = getTopics();
  const found: Topic[] = [];
  const seen = new Set<string>([topic.id]);
  for (const name of topic.relatedTopics) {
    const match = all.find(
      (item) => item.id === name || item.title === name,
    );
    if (!match || seen.has(match.id)) {
      continue;
    }
    seen.add(match.id);
    found.push(match);
  }
  return found;
}

export function listNeedsReview(topics: Topic[] = getTopics()): Topic[] {
  return topics.filter(
    (topic) => topic.needsReview || topic.resources.some((item) => item.needsReview),
  );
}

export function countResourcesByType(topic: Topic): Partial<Record<ResourceType, number>> {
  const counts: Partial<Record<ResourceType, number>> = {};
  for (const resource of topic.resources) {
    counts[resource.type] = (counts[resource.type] ?? 0) + 1;
  }
  return counts;
}

export function resourcesForTab(topic: Topic, tab: ResourceTabId): TopicResource[] {
  if (tab === "all") {
    return topic.resources;
  }
  if (tab === "law-guide") {
    return topic.resources.filter((item) => item.type === "law" || item.type === "guideline");
  }
  return topic.resources.filter((item) => item.type === tab);
}

export function sourceLines(topic: Topic): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const resource of topic.resources) {
    const line = resource.document || resource.title;
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    lines.push(line);
  }
  return lines;
}
