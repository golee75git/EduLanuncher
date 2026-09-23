import { scoreText } from "./searchService";
import {
  TROUBLE_CATEGORIES,
  TROUBLE_CATEGORY_LABEL,
  type TroubleCard,
  type TroubleCategory,
  type TroubleQuestion,
  type TroubleRisk,
  type TroubleSolution,
  type TroubleSource,
  type TroubleSupport,
} from "../types/troubleshooting";

export { TROUBLE_CATEGORY_LABEL };

const MAX_TITLE = 160;
const MAX_TEXT = 400;
const MAX_STEP = 400;
const MAX_URL = 500;
const MAX_LIST = 20;
const MAX_QUESTIONS = 12;
const MAX_SOLUTIONS = 12;
const MAX_OPTIONS = 5;
const MAX_STEPS = 16;
const MAX_RELATED = 5;
const MAX_SOURCES = 8;
const MAX_COLLECT = 10;

const catalog = import.meta.glob("../data/troubleshooting/{network,printer,windows}/*.json", {
  eager: true,
});

export interface TroubleSearchHit {
  item: TroubleCard;
  score: number;
  reason: string;
}

export interface TroubleIssue {
  id: string;
  reason: string;
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

function asRisk(value: unknown): TroubleRisk | "" {
  if (value === "safe" || value === "caution" || value === "danger") {
    return value;
  }
  return "";
}

function asCategory(value: unknown): TroubleCategory | "" {
  if (value === "network" || value === "printer" || value === "windows") {
    return value;
  }
  return "";
}

export function isOfficialMicrosoftUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === "support.microsoft.com" || host === "www.support.microsoft.com";
  } catch {
    return false;
  }
}

function pathMeta(key: string): { category: string; stem: string } {
  const normalized = key.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const file = parts[parts.length - 1] ?? "";
  return {
    category: parts[parts.length - 2] ?? "",
    stem: file.replace(/\.json$/i, ""),
  };
}

function dangerMissingGuards(prerequisites: string[]): boolean {
  const text = prerequisites.join(" ");
  const hasBackup = text.includes("백업");
  const hasBitLocker = text.includes("BitLocker");
  const hasRecovery = text.includes("OneDrive") || text.includes("복구키");
  return !hasBackup || !hasBitLocker || !hasRecovery;
}

function parseQuestion(value: unknown): TroubleQuestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = clip(asText(row.id), 80);
  const question = clip(asText(row.question), MAX_TEXT);
  if (!id || !question || !Array.isArray(row.options)) {
    return null;
  }
  const options = [];
  for (const item of row.options) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const option = item as Record<string, unknown>;
    const label = clip(asText(option.label), 120);
    const next = clip(asText(option.next), 80);
    if (!label || !next) {
      continue;
    }
    options.push({ label, next });
    if (options.length >= MAX_OPTIONS) {
      break;
    }
  }
  if (options.length < 2) {
    return null;
  }
  return { id, question, options };
}

function parseSolution(value: unknown): TroubleSolution | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = clip(asText(row.id), 80);
  const name = clip(asText(row.name), MAX_TITLE);
  const risk = asRisk(row.risk);
  const nextIfUnresolved = clip(asText(row.nextIfUnresolved), 80);
  const steps = asStringList(row.steps, MAX_STEPS, MAX_STEP);
  if (!id || !name || !risk || !nextIfUnresolved || steps.length === 0) {
    return null;
  }
  return {
    id,
    name,
    difficulty: clip(asText(row.difficulty), 40),
    risk,
    adminRequired: asBool(row.adminRequired),
    estimatedTime: clip(asText(row.estimatedTime), 40),
    dataLossRisk: clip(asText(row.dataLossRisk), 40),
    prerequisites: asStringList(row.prerequisites, 12, 160),
    steps,
    nextIfUnresolved,
  };
}

function parseSources(value: unknown): TroubleSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: TroubleSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const url = clip(asText(row.url), MAX_URL);
    const title = clip(asText(row.title), MAX_TITLE);
    if (!title || !isOfficialMicrosoftUrl(url)) {
      continue;
    }
    out.push({
      publisher: clip(asText(row.publisher), 80) || "Microsoft",
      title,
      type: clip(asText(row.type), 40) || "official",
      url,
    });
    if (out.length >= MAX_SOURCES) {
      break;
    }
  }
  return out;
}

function parseSupport(value: unknown): TroubleSupport | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const message = clip(asText(row.message), MAX_TEXT);
  if (!message) {
    return null;
  }
  return {
    message,
    collect: asStringList(row.collect, MAX_COLLECT, 160),
  };
}

function parseCard(raw: unknown, fileCategory: string, stem: string): { card?: TroubleCard; issue?: string } {
  if (!raw || typeof raw !== "object") {
    return { issue: "JSON 형식이 아닙니다." };
  }
  const row = raw as Record<string, unknown>;
  const id = clip(asText(row.id), 80);
  const category = asCategory(row.category);
  const title = clip(asText(row.title), MAX_TITLE);
  const organizationNotice = clip(asText(row.organizationNotice), MAX_TEXT);
  const risk = asRisk(row.risk);
  const support = parseSupport(row.support);
  if (!id || !category || !title || !risk || !organizationNotice || !support) {
    return { issue: "필수 항목이 없습니다." };
  }
  if (id !== stem || category !== fileCategory) {
    return { issue: "경로와 id·분류가 다릅니다." };
  }
  const aliases = asStringList(row.aliases, MAX_LIST, 80);
  if (aliases.length < 5) {
    return { issue: "검색 표현이 부족합니다." };
  }
  const environment = asStringList(row.environment, 4, 40);
  if (!environment.includes("personal") || !environment.includes("organization")) {
    return { issue: "기관 안내 환경이 없습니다." };
  }
  if (!Array.isArray(row.errorMessages) || row.errorMessages.length !== 0) {
    return { issue: "확인하지 않은 오류 메시지가 있습니다." };
  }
  const questions: TroubleQuestion[] = [];
  const questionIds = new Set<string>();
  if (Array.isArray(row.questions)) {
    for (const item of row.questions) {
      const question = parseQuestion(item);
      if (!question || questionIds.has(question.id)) {
        continue;
      }
      questionIds.add(question.id);
      questions.push(question);
      if (questions.length >= MAX_QUESTIONS) {
        break;
      }
    }
  }
  const solutions: TroubleSolution[] = [];
  const solutionIds = new Set<string>();
  if (Array.isArray(row.solutions)) {
    for (const item of row.solutions) {
      const solution = parseSolution(item);
      if (!solution || solutionIds.has(solution.id)) {
        continue;
      }
      if (solution.risk === "danger" && dangerMissingGuards(solution.prerequisites)) {
        return { issue: "위험 단계 사전 확인이 없습니다." };
      }
      solutionIds.add(solution.id);
      solutions.push(solution);
      if (solutions.length >= MAX_SOLUTIONS) {
        break;
      }
    }
  }
  if (questions.length === 0 || solutions.length === 0) {
    return { issue: "진단 카드가 없습니다." };
  }
  const sources = parseSources(row.sources);
  if (sources.length === 0) {
    return { issue: "공식 출처가 없습니다." };
  }
  return {
    card: {
      id,
      category,
      title,
      aliases,
      keywords: asStringList(row.keywords, MAX_LIST, 80),
      symptoms: asStringList(row.symptoms, MAX_LIST, 160),
      errorMessages: [],
      windowsVersion: clip(asText(row.windowsVersion), 40),
      environment,
      risk,
      adminRequired: asBool(row.adminRequired),
      actionType: clip(asText(row.actionType), 40),
      organizationNotice,
      questions,
      solutions,
      related: asStringList(row.related, MAX_RELATED, 80),
      sources,
      support,
    },
  };
}

function localTargets(card: TroubleCard): Set<string> {
  return new Set([...card.questions.map((item) => item.id), ...card.solutions.map((item) => item.id), "support"]);
}

function hasCycle(card: TroubleCard, extraIds: Set<string>): boolean {
  const questions = new Map(card.questions.map((item) => [item.id, item]));
  const solutions = new Map(card.solutions.map((item) => [item.id, item]));
  const start = card.questions[0]?.id;
  if (!start) {
    return true;
  }
  const walk = (target: string, seen: Set<string>): boolean => {
    if (target === "support" || extraIds.has(target)) {
      return false;
    }
    if (seen.has(target)) {
      return true;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(target);
    const question = questions.get(target);
    if (question) {
      return question.options.some((option) => walk(option.next, nextSeen));
    }
    const solution = solutions.get(target);
    if (solution) {
      return walk(solution.nextIfUnresolved, nextSeen);
    }
    return true;
  };
  return walk(start, new Set());
}

function loadCatalog(): { cards: TroubleCard[]; issues: TroubleIssue[] } {
  const parsed: TroubleCard[] = [];
  const issues: TroubleIssue[] = [];
  const seen = new Set<string>();
  for (const [key, mod] of Object.entries(catalog)) {
    const raw =
      mod && typeof mod === "object" && "default" in mod
        ? (mod as { default: unknown }).default
        : mod;
    const meta = pathMeta(key);
    const result = parseCard(raw, meta.category, meta.stem);
    if (!result.card) {
      issues.push({ id: meta.stem || key, reason: result.issue ?? "카드를 건너뛰었습니다." });
      continue;
    }
    if (seen.has(result.card.id)) {
      issues.push({ id: result.card.id, reason: "중복 ID입니다." });
      continue;
    }
    seen.add(result.card.id);
    parsed.push(result.card);
  }

  const allIds = new Set(parsed.map((card) => card.id));
  const kept: TroubleCard[] = [];
  for (const card of parsed) {
    const allowed = new Set([...localTargets(card), ...allIds]);
    const badNext = card.questions.some((question) =>
      question.options.some((option) => !allowed.has(option.next)),
    );
    const badFollow = card.solutions.some((solution) => !allowed.has(solution.nextIfUnresolved));
    const badRelated = card.related.some((id) => !allIds.has(id) || id === card.id);
    if (badNext || badFollow || badRelated || hasCycle(card, allIds)) {
      issues.push({ id: card.id, reason: "연결·관련 카드 또는 순환 경로 오류입니다." });
      continue;
    }
    kept.push({
      ...card,
      related: card.related.filter((id) => allIds.has(id) && id !== card.id),
    });
  }

  for (const category of TROUBLE_CATEGORIES) {
    const count = kept.filter((card) => card.category === category).length;
    if (count !== 10) {
      issues.push({ id: category, reason: `카드 ${count}개입니다. 10개여야 합니다.` });
    }
  }

  kept.sort((a, b) => a.title.localeCompare(b.title, "ko"));
  return { cards: kept, issues };
}

let cached: { cards: TroubleCard[]; issues: TroubleIssue[] } | null = null;

function catalogOnce(): { cards: TroubleCard[]; issues: TroubleIssue[] } {
  if (!cached) {
    cached = loadCatalog();
  }
  return cached;
}

export function getTroubleCards(): TroubleCard[] {
  return catalogOnce().cards;
}

export function getTroubleCard(id: string): TroubleCard | undefined {
  return catalogOnce().cards.find((card) => card.id === id);
}

export function getTroubleIssues(): TroubleIssue[] {
  return catalogOnce().issues;
}

export function logTroubleshootingValidation(): TroubleIssue[] {
  const issues = getTroubleIssues();
  for (const issue of issues) {
    console.warn(`[PC 문제 해결] ${issue.id}: ${issue.reason}`);
  }
  return issues;
}

export function firstQuestion(card: TroubleCard): TroubleQuestion | undefined {
  return card.questions[0];
}

export function getQuestion(card: TroubleCard, id: string): TroubleQuestion | undefined {
  return card.questions.find((item) => item.id === id);
}

export function getSolution(card: TroubleCard, id: string): TroubleSolution | undefined {
  return card.solutions.find((item) => item.id === id);
}

export function searchTroubleCards(
  query: string,
  cards: TroubleCard[] = getTroubleCards(),
): TroubleSearchHit[] {
  const q = query.trim();
  if (!q) {
    return [];
  }
  return cards
    .map((item) => {
      const score = scoreText(
        q,
        item.title,
        item.category,
        TROUBLE_CATEGORY_LABEL[item.category],
        ...item.aliases,
        ...item.keywords,
        ...item.symptoms,
        ...item.errorMessages,
      );
      return { item, score, reason: score >= 80 ? "제목·별칭" : "증상" };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "ko"));
}

export const HOME_TROUBLE_LIMIT = 5;
