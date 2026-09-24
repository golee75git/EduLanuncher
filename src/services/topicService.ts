import rawTopics from "../data/topics.json";
import { MANUAL_KINDS, type ManualKind, type ManualTrailItem } from "../types/manual";
import {
  JURISDICTIONS,
  RESOURCE_TYPES,
  type Jurisdiction,
  type RecordStatus,
  type ResourceTabId,
  type ResourceType,
  type Topic,
  type TopicResource,
  type WorkflowStep,
} from "../types/topic";
import { resolveJurisdiction } from "./jurisdictionService";
import { getManualTopics } from "./manualService";

const MAX_TITLE = 160;
const MAX_TEXT = 400;
const MAX_LONG = 800;
const MAX_URL = 500;
const MAX_LIST = 40;
const MAX_STEPS = 16;
const MAX_RESOURCES = 40;

const RESOURCE_TYPE_SET = new Set<string>(RESOURCE_TYPES);
const JURISDICTION_SET = new Set<string>(JURISDICTIONS);

const AREA_RANK: Record<Jurisdiction, number> = {
  gangwon: 0,
  national: 1,
  unknown: 2,
  "other-region": 3,
};

function warnDev(message: string): void {
  if (import.meta.env.DEV) {
    console.warn(message);
  }
}

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

const KNOWN_SITE_URL: Record<string, string> = {
  "학교알리미(schoolinfo.go.kr)": "https://www.schoolinfo.go.kr/",
  "지정정보처리장치(G2B, S2B)": "https://www.g2b.go.kr/",
  "교육시설 통합정보망(keiis.kr)": "https://www.keiis.go.kr/",
};

function officialUrl(title: string, rawUrl: unknown): string {
  const fromFile = asHttpUrl(rawUrl);
  if (fromFile) {
    return fromFile;
  }
  const known = KNOWN_SITE_URL[title];
  if (known) {
    return asHttpUrl(known);
  }
  return "";
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
    const description = clip(asText(row.description), MAX_TEXT);
    steps.push(description ? { order, title, description } : { order, title });
  });
  return steps.sort((a, b) => a.order - b.order).slice(0, MAX_STEPS);
}

function clearDateValue(value: string): number | null {
  const text = value.trim();
  if (/^(19|20)\d{2}$/.test(text) || /^(19|20)\d{2}년$/.test(text)) {
    return Number(text.slice(0, 4));
  }
  if (/^(19|20)\d{2}-\d{2}-\d{2}$/.test(text)) {
    const parsed = Date.parse(`${text}T00:00:00Z`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
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
    warnDev("업무자료 Resource를 건너뜀: id 또는 제목 또는 자료 유형이 없습니다.");
    return null;
  }
  const writtenArea = asText(row.jurisdiction);
  if (writtenArea && !JURISDICTION_SET.has(writtenArea)) {
    warnDev(`업무자료 ${id}: jurisdiction 값이 올바르지 않아 다시 판정합니다.`);
  }
  const writtenStatus = asText(row.status);
  if (writtenStatus && writtenStatus !== "current" && writtenStatus !== "old" && writtenStatus !== "unknown") {
    warnDev(`업무자료 ${id}: status 값이 올바르지 않아 unknown으로 읽습니다.`);
  }
  const area = resolveJurisdiction({
    organization: asText(row.organization),
    document: asText(row.document),
    title,
    summary: asText(row.summary),
    jurisdiction: writtenArea,
    jurisdictionName: asText(row.jurisdictionName),
  });
  const reviewRaw = row.needsReview;
  const needsReview =
    reviewRaw === true || reviewRaw === false
      ? reviewRaw
      : area.jurisdiction === "unknown";
  return {
    id,
    type,
    title,
    summary: clip(asText(row.summary), MAX_TEXT),
    organization: clip(asText(row.organization), MAX_TITLE),
    document: clip(asText(row.document), MAX_TITLE),
    publishedAt: clip(asText(row.publishedAt), 80),
    pages: clip(asText(row.pages), 120),
    url: officialUrl(title, row.url ?? row.sourceUrl),
    jurisdiction: area.jurisdiction,
    jurisdictionName: area.jurisdictionName,
    status: asStatus(row.status),
    needsReview,
  };
}

const KIND_SET = new Set<string>(MANUAL_KINDS);

function parseTrail(value: unknown): ManualTrailItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ManualTrailItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = clip(asText(row.id), 80);
    const title = clip(asText(row.title), MAX_TITLE);
    if (!id || !title) {
      continue;
    }
    out.push({ id, title });
    if (out.length >= 12) {
      break;
    }
  }
  return out;
}

function parseKind(value: unknown): ManualKind | undefined {
  const text = asText(value);
  return KIND_SET.has(text) ? (text as ManualKind) : undefined;
}

function parseTopic(value: unknown): Topic | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = clip(asText(row.id), 80);
  const title = clip(asText(row.title), MAX_TITLE);
  if (!id || !title) {
    warnDev("업무자료 Topic을 건너뜀: id 또는 제목이 없습니다.");
    return null;
  }
  const writtenStatus = asText(row.status);
  if (writtenStatus && writtenStatus !== "current" && writtenStatus !== "old" && writtenStatus !== "unknown") {
    warnDev(`업무자료 ${id}: Topic status 값이 올바르지 않아 unknown으로 읽습니다.`);
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
    trail: parseTrail(row.trail),
    situations: asStringList(row.situations, 12, MAX_TEXT),
    exceptions: asStringList(row.exceptions, 8, MAX_LONG),
    sourceRefs: asStringList(row.sourceRefs, 12, 80),
    kind: parseKind(row.kind ?? row.type),
    securityNotes: asStringList(row.securityNotes, 8, MAX_LONG),
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
    const fromFile = parseTopics(rawTopics);
    const fromManuals = getManualTopics();
    const seen = new Set(fromFile.map((topic) => topic.id));
    const extra = fromManuals.filter((topic) => !seen.has(topic.id));
    cached = [...fromFile, ...extra];
  }
  return cached;
}

export async function loadTopics(): Promise<Topic[]> {
  return getTopics();
}

export function getTopicById(id: string): Topic | undefined {
  return getTopics().find((topic) => topic.id === id);
}

export function getResourcesByTopic(id: string): TopicResource[] {
  return getTopicById(id)?.resources ?? [];
}

export function sortResources(resources: TopicResource[]): TopicResource[] {
  return [...resources].sort((a, b) => {
    const rank = AREA_RANK[a.jurisdiction] - AREA_RANK[b.jurisdiction];
    if (rank !== 0) {
      return rank;
    }
    const aDate = clearDateValue(a.publishedAt);
    const bDate = clearDateValue(b.publishedAt);
    if (aDate !== null && bDate !== null && aDate !== bDate) {
      return bDate - aDate;
    }
    return 0;
  });
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

const RESOURCE_GROUPS: Array<{ label: string; types: ResourceType[] }> = [
  { label: "매뉴얼", types: ["manual"] },
  { label: "법령/지침", types: ["law", "guideline", "notice"] },
  { label: "감사사례", types: ["audit", "case"] },
  { label: "질의회신", types: ["qna"] },
  { label: "FAQ", types: ["faq"] },
  { label: "서식", types: ["form"] },
  { label: "업무시스템", types: ["system"] },
];

export function resourceGroupCounts(topic: Topic): Array<{ label: string; count: number }> {
  return RESOURCE_GROUPS.map((group) => ({
    label: group.label,
    count: topic.resources.filter((item) => group.types.includes(item.type)).length,
  })).filter((group) => group.count > 0);
}

export function areaCounts(topic: Topic): Array<{ jurisdiction: Jurisdiction; count: number }> {
  const order: Jurisdiction[] = ["gangwon", "national", "other-region", "unknown"];
  return order
    .map((jurisdiction) => ({
      jurisdiction,
      count: topic.resources.filter((item) => item.jurisdiction === jurisdiction).length,
    }))
    .filter((item) => item.count > 0);
}

export function resourcesForTab(topic: Topic, tab: ResourceTabId): TopicResource[] {
  let items = topic.resources;
  if (tab === "law-guide") {
    items = items.filter((item) => item.type === "law" || item.type === "guideline" || item.type === "notice");
  } else if (tab === "audit") {
    items = items.filter((item) => item.type === "audit" || item.type === "case");
  } else if (tab !== "all") {
    items = items.filter((item) => item.type === tab);
  }
  return sortResources(items);
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
