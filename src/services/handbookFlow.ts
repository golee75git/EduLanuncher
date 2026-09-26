export interface FlowTreeNode {
  id: string;
  label: string;
  open: boolean;
  children: FlowTreeNode[];
}

export interface HandbookStep {
  stepNo: number;
  stepId: string;
  name: string;
  description: string;
  condition: string;
  caveat: string;
  nextStep: string;
  relatedTopic: string;
}

export interface ChartArrow {
  from: string;
  to: string;
  label: string;
}

export interface ChartPicture {
  tree: FlowTreeNode | null;
  backArrows: ChartArrow[];
  nodeIds: string[];
}

export interface HandbookLink {
  nodeId: string;
  label: string;
  targetTopicId: string;
  targetStepId: string;
  topicExists: boolean;
  stepExists: boolean;
  nodeInChart: boolean;
}

export interface HandbookTopic {
  id: string;
  categoryId: string;
  categoryName: string;
  title: string;
  officialName: string;
  pages: string;
  purpose: string;
  easy: string;
  steps: HandbookStep[];
  decisionText: string;
  picture: ChartPicture;
  links: HandbookLink[];
  generalGuidance: boolean;
  shownFromExisting?: boolean;
}

export interface HandbookCategory {
  id: string;
  code: string;
  name: string;
  pages: string;
  declaredCount: number;
  declaredIds: string[];
  topics: HandbookTopic[];
  picture: ChartPicture;
  links: HandbookLink[];
}

export interface HandbookCatalog {
  categories: HandbookCategory[];
  topics: HandbookTopic[];
  repeatedStepTexts: string[];
}

const MAX_SHORT = 160;
const MAX_TEXT = 800;
const MAX_CHART = 20000;

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function splitChartStatements(chart: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  const text = chart.slice(0, MAX_CHART);
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      const trimmed = current.trim();
      if (trimmed) {
        out.push(trimmed);
      }
      current = "";
      continue;
    }
    current += char === "\n" || char === "\r" ? " " : char;
  }
  const trimmed = current.trim();
  if (trimmed) {
    out.push(trimmed);
  }
  return out;
}

interface ReadNode {
  id: string;
  label: string;
  end: number;
}

function readNode(line: string, start: number): ReadNode | null {
  let index = start;
  while (line[index] === " ") {
    index += 1;
  }
  const idMatch = /^[A-Za-z][A-Za-z0-9_]*/.exec(line.slice(index));
  if (!idMatch) {
    return null;
  }
  const id = idMatch[0];
  index += id.length;
  while (line[index] === " ") {
    index += 1;
  }
  let label = id;
  if (line.startsWith('(["', index)) {
    const end = line.indexOf('"])', index + 3);
    if (end < 0) {
      return { id, label, end: line.length };
    }
    label = line.slice(index + 3, end);
    index = end + 3;
  } else if (line.startsWith('["', index)) {
    const end = line.indexOf('"]', index + 2);
    if (end < 0) {
      return { id, label, end: line.length };
    }
    label = line.slice(index + 2, end);
    index = end + 2;
  } else if (line.startsWith('{"', index)) {
    const end = line.indexOf('"}', index + 2);
    if (end < 0) {
      return { id, label, end: line.length };
    }
    label = line.slice(index + 2, end);
    index = end + 2;
  }
  const cleaned = label.replace(/\s+/g, " ").trim();
  return { id, label: cleaned || id, end: index };
}

function readArrow(line: string, start: number): { label: string; end: number } | null {
  let index = start;
  while (line[index] === " ") {
    index += 1;
  }
  if (line.startsWith("-->", index)) {
    index += 3;
    while (line[index] === " ") {
      index += 1;
    }
    if (line[index] === "|") {
      const end = line.indexOf("|", index + 1);
      if (end < 0) {
        return { label: "", end: line.length };
      }
      return { label: line.slice(index + 1, end).trim(), end: end + 1 };
    }
    return { label: "", end: index };
  }
  if (line.startsWith("--", index)) {
    const arrow = line.indexOf("-->", index + 2);
    if (arrow < 0) {
      return null;
    }
    return { label: line.slice(index + 2, arrow).trim(), end: arrow + 3 };
  }
  return null;
}

function shortLabel(label: string): string {
  const rest = label.replace(/^TOPIC-[A-Za-z0-9-]+\s+/, "").trim();
  return rest || label;
}

export function readChart(chart: string): ChartPicture {
  const nodes = new Map<string, string>();
  const order: string[] = [];
  const arrows: ChartArrow[] = [];
  const remember = (id: string, label: string) => {
    if (!nodes.has(id)) {
      nodes.set(id, label);
      order.push(id);
      return;
    }
    if (label !== id) {
      nodes.set(id, label);
    }
  };
  for (const line of splitChartStatements(chart)) {
    if (line.startsWith("flowchart")) {
      continue;
    }
    let left = readNode(line, 0);
    if (!left) {
      continue;
    }
    remember(left.id, left.label);
    while (left) {
      const arrow = readArrow(line, left.end);
      if (!arrow) {
        break;
      }
      const right = readNode(line, arrow.end);
      if (!right) {
        break;
      }
      remember(right.id, right.label);
      arrows.push({ from: left.id, to: right.id, label: arrow.label });
      left = right;
    }
  }
  if (order.length === 0) {
    return { tree: null, backArrows: [], nodeIds: [] };
  }
  const incoming = new Map<string, number>();
  for (const id of order) {
    incoming.set(id, 0);
  }
  for (const arrow of arrows) {
    incoming.set(arrow.to, (incoming.get(arrow.to) ?? 0) + 1);
  }
  const rootId = order.find((id) => (incoming.get(id) ?? 0) === 0) ?? order[0];
  const placed = new Set<string>();
  const backArrows: ChartArrow[] = [];
  const build = (id: string): FlowTreeNode => {
    placed.add(id);
    const children: FlowTreeNode[] = [];
    for (const arrow of arrows) {
      if (arrow.from !== id) {
        continue;
      }
      if (placed.has(arrow.to)) {
        backArrows.push(arrow);
        continue;
      }
      children.push(build(arrow.to));
    }
    return {
      id,
      label: shortLabel(nodes.get(id) ?? id),
      open: false,
      children,
    };
  };
  const tree = build(rootId);
  for (const id of order) {
    if (!placed.has(id)) {
      tree.children.push(build(id));
    }
  }
  return { tree, backArrows, nodeIds: order };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readSteps(value: unknown): HandbookStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const steps: HandbookStep[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const stepNo = typeof row.step_no === "number" && Number.isFinite(row.step_no) ? Math.trunc(row.step_no) : steps.length + 1;
    if (stepNo < 1 || stepNo > 30) {
      continue;
    }
    steps.push({
      stepNo,
      stepId: `step-${stepNo}`,
      name: clip(row.step_name, MAX_SHORT),
      description: clip(row.description, MAX_TEXT),
      condition: clip(row.condition, MAX_TEXT),
      caveat: clip(row.caveat, MAX_TEXT),
      nextStep: clip(row.next_step, MAX_SHORT),
      relatedTopic: clip(row.related_topic, MAX_SHORT),
    });
  }
  return steps;
}

function readLinks(value: unknown): Array<Omit<HandbookLink, "topicExists" | "stepExists" | "nodeInChart">> {
  if (!Array.isArray(value)) {
    return [];
  }
  const links = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const nodeId = clip(row.nodeId, 40);
    if (!nodeId) {
      continue;
    }
    links.push({
      nodeId,
      label: clip(row.label, MAX_SHORT),
      targetTopicId: clip(row.targetTopicId, 80),
      targetStepId: clip(row.targetStepId, 40),
    });
  }
  return links;
}

function blank(value: string): string {
  return value.trim() ? value : "자료에 없음";
}

export function stepField(value: string): string {
  return blank(value);
}

function finishLinks(
  rawLinks: Array<Omit<HandbookLink, "topicExists" | "stepExists" | "nodeInChart">>,
  picture: ChartPicture,
  topicById: Map<string, { steps: HandbookStep[] }>,
): HandbookLink[] {
  const nodeSet = new Set(picture.nodeIds);
  return rawLinks.map((link) => {
    const topic = topicById.get(link.targetTopicId);
    const stepExists = Boolean(topic?.steps.some((step) => step.stepId === link.targetStepId));
    return {
      ...link,
      topicExists: Boolean(topic),
      stepExists,
      nodeInChart: nodeSet.has(link.nodeId),
    };
  });
}

function markOpen(tree: FlowTreeNode | null, openIds: Set<string>): FlowTreeNode | null {
  if (!tree) {
    return null;
  }
  return {
    ...tree,
    open: openIds.has(tree.id),
    children: tree.children.map((child) => markOpen(child, openIds)).filter((child): child is FlowTreeNode => Boolean(child)),
  };
}

export function readHandbookPack(raw: unknown): HandbookCatalog {
  const pack = asRecord(raw);
  const categoryRows = Array.isArray(pack?.categories) ? pack.categories : [];
  const topicRows = Array.isArray(pack?.topics) ? pack.topics : [];
  const drafts: Array<Omit<HandbookTopic, "links" | "generalGuidance"> & { rawLinks: ReturnType<typeof readLinks> }> = [];
  const seenTopic = new Set<string>();
  for (const item of topicRows) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const id = clip(row.topic_id, 80);
    if (!id || seenTopic.has(id)) {
      continue;
    }
    seenTopic.add(id);
    const picture = readChart(clip(row.topic_mermaid, MAX_CHART));
    drafts.push({
      id,
      categoryId: clip(row.category_id, 40),
      categoryName: clip(row.category_name, MAX_SHORT),
      title: clip(row.title, MAX_SHORT),
      officialName: clip(row.official_code_name, MAX_SHORT),
      pages: clip(row.pages, 80),
      purpose: clip(row.purpose, MAX_TEXT),
      easy: clip(row.easy_explanation, MAX_TEXT),
      steps: readSteps(row.step_attributes),
      decisionText: clip(row.decision_tree, MAX_TEXT),
      picture,
      rawLinks: readLinks(row.nodeMapping),
    });
  }
  const topicById = new Map(drafts.map((topic) => [topic.id, topic]));
  const textUse = new Map<string, number>();
  for (const topic of drafts) {
    const seen = new Set<string>();
    for (const step of topic.steps) {
      const text = step.description.trim();
      if (!text || seen.has(text)) {
        continue;
      }
      seen.add(text);
      textUse.set(text, (textUse.get(text) ?? 0) + 1);
    }
  }
  const repeatedStepTexts = [...textUse.entries()].filter((entry) => entry[1] >= 10).map((entry) => entry[0]);
  const repeated = new Set(repeatedStepTexts);
  const topics: HandbookTopic[] = drafts.map((topic) => {
    const links = finishLinks(topic.rawLinks, topic.picture, topicById);
    const openIds = new Set(links.filter((link) => link.nodeInChart && link.topicExists).map((link) => link.nodeId));
    const descriptions = topic.steps.map((step) => step.description.trim()).filter(Boolean);
    const generalGuidance =
      topic.decisionText.trim().length === 0 &&
      descriptions.length > 0 &&
      descriptions.every((text) => repeated.has(text));
    return {
      id: topic.id,
      categoryId: topic.categoryId,
      categoryName: topic.categoryName,
      title: topic.title,
      officialName: topic.officialName,
      pages: topic.pages,
      purpose: topic.purpose,
      easy: topic.easy,
      steps: topic.steps,
      decisionText: topic.decisionText,
      picture: { ...topic.picture, tree: markOpen(topic.picture.tree, openIds) },
      links,
      generalGuidance,
    };
  });
  const topicsByCategory = new Map<string, HandbookTopic[]>();
  for (const topic of topics) {
    const list = topicsByCategory.get(topic.categoryId) ?? [];
    list.push(topic);
    topicsByCategory.set(topic.categoryId, list);
  }
  const categories: HandbookCategory[] = [];
  const seenCategory = new Set<string>();
  for (const item of categoryRows) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const id = clip(row.id, 40);
    if (!id || seenCategory.has(id)) {
      continue;
    }
    seenCategory.add(id);
    const picture = readChart(clip(row.category_mermaid, MAX_CHART));
    const links = finishLinks(readLinks(row.categoryNodeMapping), picture, topicById);
    const openIds = new Set(links.filter((link) => link.nodeInChart && link.topicExists).map((link) => link.nodeId));
    const declaredIds = Array.isArray(row.topic_ids)
      ? row.topic_ids.filter((entry): entry is string => typeof entry === "string").map((entry) => clip(entry, 80)).filter(Boolean)
      : [];
    categories.push({
      id,
      code: clip(row.code, 20),
      name: clip(row.name, MAX_SHORT),
      pages: clip(row.pages, 80),
      declaredCount: typeof row.topic_count === "number" && Number.isFinite(row.topic_count) ? Math.trunc(row.topic_count) : declaredIds.length,
      declaredIds,
      topics: topicsByCategory.get(id) ?? [],
      picture: { ...picture, tree: markOpen(picture.tree, openIds) },
      links,
    });
  }
  return { categories, topics, repeatedStepTexts };
}

export function searchHandbookTopics(query: string, topics: HandbookTopic[]): HandbookTopic[] {
  const folded = fold(query);
  if (folded.length < 1) {
    return topics;
  }
  const scored: Array<{ topic: HandbookTopic; score: number }> = [];
  for (const topic of topics) {
    const title = fold(topic.title);
    const official = fold(topic.officialName);
    const category = fold(topic.categoryName);
    const purpose = fold(topic.purpose);
    const easy = fold(topic.easy);
    let score = 0;
    if (title === folded) {
      score = 800;
    } else if (title.includes(folded)) {
      score = 700;
    } else if (official.includes(folded)) {
      score = 600;
    } else if (folded.length >= 2 && category.includes(folded)) {
      score = 500;
    } else if (folded.length >= 2 && purpose.includes(folded)) {
      score = 400;
    } else if (folded.length >= 2 && easy.includes(folded)) {
      score = 300;
    }
    if (score > 0) {
      scored.push({ topic, score });
    }
  }
  scored.sort((left, right) => right.score - left.score || left.topic.title.localeCompare(right.topic.title, "ko"));
  return scored.map((entry) => entry.topic);
}

export function handbookTopicById(catalog: HandbookCatalog, id: string): HandbookTopic | undefined {
  return catalog.topics.find((topic) => topic.id === id);
}
