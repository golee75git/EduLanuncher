import type { MindMapNode, MindMapNodeType } from "../types/mindmap";
import {
  MANUAL_KINDS,
  type ManualKind,
  type ManualNode,
  type ManualTrailItem,
} from "../types/manual";
import type { Topic, WorkflowStep } from "../types/topic";

const MAX_ID = 80;
const MAX_TITLE = 160;
const MAX_TEXT = 400;
const MAX_LONG = 800;
const MAX_LIST = 40;
const MAX_STEPS = 16;
const MAX_DEPTH = 8;
const MAX_NODES = 200;

const KIND_SET = new Set<string>(MANUAL_KINDS);

const KIND_TO_NODE: Record<ManualKind, MindMapNodeType> = {
  category: "category",
  procedure: "process",
  information: "topic",
  warning: "process",
  error: "process",
  exception: "process",
  security: "process",
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
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

function asKind(value: unknown): ManualKind | undefined {
  const text = asText(value);
  return KIND_SET.has(text) ? (text as ManualKind) : undefined;
}

function parseNode(
  value: unknown,
  seen: Set<string>,
  parentId: string | undefined,
  depth: number,
  budget: { left: number },
): ManualNode | null {
  if (budget.left <= 0 || depth > MAX_DEPTH || !value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = clip(asText(row.id), MAX_ID);
  const title = clip(asText(row.title), MAX_TITLE);
  if (!id || !title || seen.has(id)) {
    return null;
  }
  seen.add(id);
  budget.left -= 1;
  const children: ManualNode[] = [];
  if (Array.isArray(row.children)) {
    for (const child of row.children) {
      if (budget.left <= 0) {
        break;
      }
      const parsed = parseNode(child, seen, id, depth + 1, budget);
      if (parsed) {
        children.push(parsed);
      }
    }
  }
  const kind = asKind(row.type);
  const summary = clip(asText(row.summary), MAX_TEXT);
  const category = clip(asText(row.category), 80);
  return {
    id,
    title,
    summary: summary || undefined,
    category: category || undefined,
    parentId,
    type: kind,
    keywords: asStringList(row.keywords, MAX_LIST, 80),
    aliases: asStringList(row.aliases, MAX_LIST, MAX_TEXT),
    situations: asStringList(row.situations, 12, MAX_TEXT),
    steps: asStringList(row.steps, MAX_STEPS, MAX_TITLE),
    warnings: asStringList(row.warnings, 8, MAX_LONG),
    exceptions: asStringList(row.exceptions, 8, MAX_LONG),
    securityNotes: asStringList(row.securityNotes, 8, MAX_LONG),
    relatedNodes: asStringList(row.relatedNodes, 12, MAX_ID),
    sourceRefs: asStringList(row.sourceRefs, 12, 80),
    children,
  };
}

const catalog = import.meta.glob("../data/manuals/*.json", { eager: true });

function loadRoots(): ManualNode[] {
  const seen = new Set<string>();
  const roots: ManualNode[] = [];
  const budget = { left: MAX_NODES };
  for (const mod of Object.values(catalog)) {
    const raw =
      mod && typeof mod === "object" && "default" in mod
        ? (mod as { default: unknown }).default
        : mod;
    const node = parseNode(raw, seen, undefined, 0, budget);
    if (node) {
      roots.push(node);
    }
  }
  return roots;
}

let cachedRoots: ManualNode[] | null = null;
let cachedTopics: Topic[] | null = null;
let cachedMind: MindMapNode[] | null = null;

export function getManualRoots(): ManualNode[] {
  if (!cachedRoots) {
    cachedRoots = loadRoots();
  }
  return cachedRoots;
}

function toSteps(lines: string[]): WorkflowStep[] {
  return lines.map((title, index) => ({ order: index + 1, title }));
}

function toTopic(
  node: ManualNode,
  category: string,
  trail: ManualTrailItem[],
): Topic {
  const parentTitle = trail.length > 1 ? trail[trail.length - 2]?.title ?? "" : "";
  return {
    id: node.id,
    title: node.title,
    category,
    subcategory: parentTitle,
    description: node.summary || (parentTitle ? `${category} · ${parentTitle}` : category),
    workflow: toSteps(node.steps ?? []),
    keywords: {
      official: node.keywords ?? [],
      general: node.aliases ?? [],
      beginner: node.situations ?? [],
      related: [],
    },
    exampleQuestions: [],
    resources: [],
    relatedTopics: node.relatedNodes ?? [],
    warnings: node.warnings ?? [],
    status: "current",
    needsReview: false,
    trail,
    situations: node.situations ?? [],
    exceptions: node.exceptions ?? [],
    sourceRefs: node.sourceRefs ?? [],
    kind: node.type,
    securityNotes: node.securityNotes ?? [],
  };
}

function walkTopics(nodes: ManualNode[], category: string, ancestors: ManualTrailItem[], out: Topic[]) {
  for (const node of nodes) {
    const nextCategory = node.category || category;
    const trail = [...ancestors, { id: node.id, title: node.title }];
    out.push(toTopic(node, nextCategory, trail));
    if (node.children && node.children.length > 0) {
      walkTopics(node.children, nextCategory, trail, out);
    }
  }
}

export function getManualTopics(): Topic[] {
  if (!cachedTopics) {
    const topics: Topic[] = [];
    walkTopics(getManualRoots(), "교육행정", [], topics);
    cachedTopics = topics;
  }
  return cachedTopics;
}

function toMind(node: ManualNode): MindMapNode {
  const kind = node.type ?? "information";
  return {
    id: node.id,
    label: node.title,
    nodeType: KIND_TO_NODE[kind],
    topicId: node.id,
    children: (node.children ?? []).map(toMind),
    needsReview: false,
    kind,
  };
}

export function getManualMindRoots(): MindMapNode[] {
  if (!cachedMind) {
    cachedMind = getManualRoots().map(toMind);
  }
  return cachedMind;
}
