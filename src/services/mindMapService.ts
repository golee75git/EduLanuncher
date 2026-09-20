import rawMindMap from "../data/education/launcherbox-education-mindmap.json";
import type {
  EducationMindMap,
  MindMapIssue,
  MindMapNode,
  MindMapNodeType,
  MindMapRelation,
  MindMapRelationType,
} from "../types/mindmap";
import { RESOURCE_TYPES, type Topic } from "../types/topic";
import { getTopics } from "./topicService";

const NODE_TYPES = new Set<MindMapNodeType>([
  "category",
  "subcategory",
  "topic",
  "process",
  "resource",
]);
const RELATION_TYPES = new Set<MindMapRelationType>([
  "contains",
  "related",
  "previous",
  "next",
  "similar",
]);

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseNode(value: unknown, seen: Set<string>, issues: MindMapIssue[]): MindMapNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const id = asText(row.id);
  const label = asText(row.label);
  const nodeType = asText(row.nodeType) as MindMapNodeType;
  if (!id || !label || !NODE_TYPES.has(nodeType)) {
    issues.push({ id: id || "(없음)", reason: "마인드맵 노드 id·이름·종류가 올바르지 않습니다." });
    return null;
  }
  if (seen.has(id)) {
    issues.push({ id, reason: "마인드맵 노드 id가 중복입니다." });
    return null;
  }
  seen.add(id);
  const children: MindMapNode[] = [];
  if (Array.isArray(row.children)) {
    for (const child of row.children) {
      const parsed = parseNode(child, seen, issues);
      if (parsed) {
        children.push(parsed);
      }
    }
  }
  return {
    id,
    label,
    nodeType,
    topicId: asText(row.topicId) || undefined,
    resourceId: asText(row.resourceId) || undefined,
    children,
    needsReview: row.needsReview === true,
  };
}

function parseRelation(value: unknown): MindMapRelation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const from = asText(row.from);
  const to = asText(row.to);
  const type = asText(row.type) as MindMapRelationType;
  const source = row.source === "topic-json" ? "topic-json" : "mindmap";
  if (!from || !to || !RELATION_TYPES.has(type)) {
    return null;
  }
  return { from, to, type, source, needsReview: row.needsReview === true };
}

function walk(nodes: MindMapNode[], visit: (node: MindMapNode, ancestors: string[]) => void, ancestors: string[] = []) {
  for (const node of nodes) {
    visit(node, ancestors);
    walk(node.children, visit, [...ancestors, node.id]);
  }
}

let cached: EducationMindMap | null = null;
let cachedIssues: MindMapIssue[] | null = null;

export function loadEducationMindMap(): EducationMindMap {
  if (cached) {
    return cached;
  }
  const issues: MindMapIssue[] = [];
  const seen = new Set<string>();
  const raw = rawMindMap as Record<string, unknown>;
  const roots: MindMapNode[] = [];
  if (Array.isArray(raw.roots)) {
    for (const item of raw.roots) {
      const node = parseNode(item, seen, issues);
      if (node) {
        roots.push(node);
      }
    }
  }
  const relations: MindMapRelation[] = [];
  if (Array.isArray(raw.relations)) {
    for (const item of raw.relations) {
      const relation = parseRelation(item);
      if (relation) {
        relations.push(relation);
      }
    }
  }
  cached = { version: 1, roots, relations };
  cachedIssues = issues;
  return cached;
}

export function flattenMindMap(map: EducationMindMap = loadEducationMindMap()): MindMapNode[] {
  const out: MindMapNode[] = [];
  walk(map.roots, (node) => {
    out.push(node);
  });
  return out;
}

export function mappedTopicIds(map: EducationMindMap = loadEducationMindMap()): Set<string> {
  const ids = new Set<string>();
  walk(map.roots, (node) => {
    if (node.topicId) {
      ids.add(node.topicId);
    }
  });
  return ids;
}

export function topicsMissingFromMindMap(topics: Topic[] = getTopics()): Topic[] {
  const mapped = mappedTopicIds();
  return topics.filter((topic) => !mapped.has(topic.id));
}

export function relatedTopicIds(nodeId: string, map: EducationMindMap = loadEducationMindMap()): string[] {
  const nodes = flattenMindMap(map);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const relation of map.relations) {
    if (relation.type !== "related") {
      continue;
    }
    const other = relation.from === nodeId ? relation.to : relation.to === nodeId ? relation.from : "";
    if (!other) {
      continue;
    }
    const target = byId.get(other);
    const topicId = target?.topicId;
    if (topicId && !seen.has(topicId)) {
      seen.add(topicId);
      ids.push(topicId);
    }
  }
  return ids;
}

export function validateEducationData(topics: Topic[] = getTopics()): MindMapIssue[] {
  const map = loadEducationMindMap();
  const issues: MindMapIssue[] = [...(cachedIssues ?? [])];
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const resourceById = new Map<string, { topicId: string; pages: string }>();
  const topicSeen = new Set<string>();
  const resourceSeen = new Set<string>();
  const typeSet = new Set<string>(RESOURCE_TYPES);

  for (const topic of topics) {
    if (topicSeen.has(topic.id)) {
      issues.push({ id: topic.id, reason: "Topic id가 중복입니다." });
    }
    topicSeen.add(topic.id);
    for (const resource of topic.resources) {
      if (resourceSeen.has(resource.id)) {
        issues.push({ id: resource.id, reason: "Resource id가 중복입니다." });
      }
      resourceSeen.add(resource.id);
      resourceById.set(resource.id, { topicId: topic.id, pages: resource.pages });
      if (!typeSet.has(resource.type)) {
        issues.push({ id: resource.id, reason: `허용되지 않은 Resource type: ${resource.type}` });
      }
      if (resource.status !== "current" && resource.status !== "old" && resource.status !== "unknown") {
        issues.push({ id: resource.id, reason: `허용되지 않은 status: ${resource.status}` });
      }
    }
    if (topic.status !== "current" && topic.status !== "old" && topic.status !== "unknown") {
      issues.push({ id: topic.id, reason: `허용되지 않은 status: ${topic.status}` });
    }
  }

  const nodeIds = new Set<string>();
  walk(map.roots, (node, ancestors) => {
    nodeIds.add(node.id);
    if (ancestors.includes(node.id)) {
      issues.push({ id: node.id, reason: "마인드맵 순환 참조입니다." });
    }
    if (node.topicId && !topicById.has(node.topicId)) {
      issues.push({ id: node.id, reason: `topicId ${node.topicId} 가 Topic 목록에 없습니다.` });
    }
    if (node.resourceId && !resourceById.has(node.resourceId)) {
      issues.push({ id: node.id, reason: `resourceId ${node.resourceId} 가 Resource 목록에 없습니다.` });
    }
  });

  for (const relation of map.relations) {
    const fromOk = nodeIds.has(relation.from) || topicById.has(relation.from);
    const toOk = nodeIds.has(relation.to) || topicById.has(relation.to);
    if (!fromOk || !toOk) {
      issues.push({
        id: `${relation.from}→${relation.to}`,
        reason:
          relation.source === "topic-json"
            ? "Topic JSON relatedTopics가 Topic id와 맞지 않습니다."
            : "관계의 한쪽 노드를 찾지 못했습니다.",
      });
    }
  }

  return issues;
}

export function listMindMapReviewNodes(map: EducationMindMap = loadEducationMindMap()): MindMapNode[] {
  return flattenMindMap(map).filter((node) => node.needsReview);
}

export function logEducationValidation(): MindMapIssue[] {
  const issues = validateEducationData();
  for (const issue of issues) {
    console.warn(`[업무자료] ${issue.id}: ${issue.reason}`);
  }
  return issues;
}

export function resourcesMissingUrl(topics: Topic[] = getTopics()): Array<{ topicId: string; resourceId: string; title: string }> {
  const missing: Array<{ topicId: string; resourceId: string; title: string }> = [];
  for (const topic of topics) {
    for (const resource of topic.resources) {
      if (!resource.url) {
        missing.push({ topicId: topic.id, resourceId: resource.id, title: resource.title });
      }
    }
  }
  return missing;
}
