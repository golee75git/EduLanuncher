export const PILOT_TOPIC_IDS = ["gwe-2026-p053", "gwe-work-0001"];
export const PILOT_BANNER =
  "개발용 시범 업무매뉴얼입니다. 일부 내용은 현행 법령 검증 중이며 실제 업무 처리 기준으로 사용하지 마세요.";

export interface PilotHit {
  id: string;
  title: string;
  category: string;
  line: string;
}

interface PilotSearchFile {
  withheldQueries?: string[];
  topics?: Array<{ id: string; title?: string; category?: string; line?: string; queries?: string[] }>;
}

interface PilotStep {
  stepId: string;
  title?: string;
  actor?: string | null;
  method?: string | null;
  inputs?: string[];
  occupation?: { occupationId?: string; name?: string };
  sourceIds?: string[];
  verification?: { currency?: string };
  lawCheck?: { status?: string; note?: string; lawSourceIds?: string[] } | null;
}

interface PilotStandard {
  topics?: Array<{
    topicId: string;
    title?: string;
    categoryName?: string;
    sectionIds?: string[];
    relations?: Array<{ topicId: string; kind: string }>;
  }>;
  sections?: Array<{ sectionId: string; title?: string; markdown?: string; role?: string }>;
  workflow?: PilotStep[];
  sources?: Array<{ sourceId: string; documentTitle?: string; printedPage?: number | null; pdfPage?: number | null }>;
  lawSources?: Array<{
    lawSourceId: string;
    title?: string;
    articles?: string[];
    effectiveDate?: string;
    url?: string;
    retrievedAt?: string;
  }>;
  verifiedFlow?: {
    nodes?: Array<{ nodeId: string; label: string; stepId: string; occupationId?: string }>;
    edges?: Array<{ from: string; to: string; condition?: string }>;
    mermaidPromoted?: boolean;
    release?: string;
  };
}

export interface PilotStepView extends PilotStep {
  lawStatusLabel: string;
  currencyLabel: string;
  confirmedCurrent: boolean;
  laws: NonNullable<PilotStandard["lawSources"]>;
  sources: NonNullable<PilotStandard["sources"]>;
}

export interface PilotView {
  banner: string;
  topic: NonNullable<PilotStandard["topics"]>[number];
  prose: NonNullable<PilotStandard["sections"]>;
  notes: NonNullable<PilotStandard["sections"]>;
  occupations: Array<{ occupationId: string; name: string; steps: PilotStepView[] }>;
  nodes: NonNullable<NonNullable<PilotStandard["verifiedFlow"]>["nodes"]>;
  edges: NonNullable<NonNullable<PilotStandard["verifiedFlow"]>["edges"]>;
  mermaidPromoted: boolean;
  flowRelease: string;
  relations: Array<{ topicId: string; kind: string }>;
}

export function foldQuery(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function isPilotTopicId(topicId: string): boolean {
  return PILOT_TOPIC_IDS.includes(topicId);
}

export function searchPilotTopics(searchFile: PilotSearchFile | null | undefined, query: string): PilotHit[] {
  const needle = foldQuery(query);
  if (!needle || !searchFile) {
    return [];
  }
  const withheld = new Set((searchFile.withheldQueries ?? []).map(foldQuery));
  if (withheld.has(needle)) {
    return [];
  }
  const hits: PilotHit[] = [];
  for (const topic of searchFile.topics ?? []) {
    if (!isPilotTopicId(topic.id)) {
      continue;
    }
    const title = foldQuery(topic.title ?? "");
    const queries = (topic.queries ?? []).map(foldQuery);
    const matched =
      title === needle ||
      queries.some((item) => item === needle || (needle.length >= 2 && item.startsWith(needle)));
    if (!matched) {
      continue;
    }
    hits.push({
      id: topic.id,
      title: topic.title ?? "",
      category: topic.category ?? "",
      line: topic.line ?? "",
    });
  }
  return hits;
}

export function pilotHits(
  enabled: boolean,
  searchFile: PilotSearchFile | null | undefined,
  query: string,
  existingIds: string[],
): PilotHit[] {
  if (!enabled) {
    return [];
  }
  return dedupePilotHits(searchPilotTopics(searchFile, query), existingIds);
}

export function dedupePilotHits(hits: PilotHit[], existingIds: string[]): PilotHit[] {
  const seen = new Set(existingIds ?? []);
  return hits.filter((hit) => {
    if (seen.has(hit.id)) {
      return false;
    }
    seen.add(hit.id);
    return true;
  });
}

function stepsForTopic(topicId: string, workflow: PilotStep[] | undefined): PilotStep[] {
  return (workflow ?? []).filter((step) => {
    if (topicId === "gwe-work-0001") {
      return String(step.stepId).includes("-ill-");
    }
    if (topicId === "gwe-2026-p053") {
      return !String(step.stepId).includes("-ill-");
    }
    return false;
  });
}

export function lawStatusLabel(status: string | undefined): string {
  if (status === "differs") {
    return "편람과 다름";
  }
  if (status === "partial") {
    return "일부만 확인";
  }
  if (status === "matched") {
    return "조문과 맞음";
  }
  return "미확인";
}

export function currencyLabel(currency: string | undefined): string {
  if (currency === "current_checked") {
    return "현행 확인";
  }
  return "현행 기준으로 확정하지 않음";
}

export function buildPilotView(standard: PilotStandard | null | undefined, topicId: string): PilotView | null {
  if (!standard || !isPilotTopicId(topicId)) {
    return null;
  }
  const topic = (standard.topics ?? []).find((item) => item.topicId === topicId);
  if (!topic) {
    return null;
  }
  const sectionIds = new Set(topic.sectionIds ?? []);
  const sections = (standard.sections ?? []).filter((section) => sectionIds.has(section.sectionId));
  const prose = sections.filter((section) => section.role !== "verification-note");
  const notes = sections.filter((section) => section.role === "verification-note");
  const steps = stepsForTopic(topicId, standard.workflow);
  const stepIds = new Set(steps.map((step) => step.stepId));
  const flow = standard.verifiedFlow ?? { nodes: [], edges: [], mermaidPromoted: false };
  const nodes = (flow.nodes ?? []).filter((node) => stepIds.has(node.stepId));
  const edges = (flow.edges ?? []).filter((edge) => stepIds.has(edge.from) && stepIds.has(edge.to));
  const sourceById = new Map((standard.sources ?? []).map((source) => [source.sourceId, source]));
  const lawById = new Map((standard.lawSources ?? []).map((source) => [source.lawSourceId, source]));
  const occupations: PilotView["occupations"] = [];
  for (const step of steps) {
    const name = step.occupation?.name ?? "직종 미기재";
    let group = occupations.find((item) => item.name === name);
    if (!group) {
      group = { occupationId: step.occupation?.occupationId ?? "", name, steps: [] };
      occupations.push(group);
    }
    const lawIds = step.lawCheck?.lawSourceIds ?? [];
    group.steps.push({
      ...step,
      lawStatusLabel: lawStatusLabel(step.lawCheck?.status),
      currencyLabel: currencyLabel(step.verification?.currency),
      confirmedCurrent: step.verification?.currency === "current_checked" && step.lawCheck?.status === "matched",
      laws: lawIds.map((id) => lawById.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
      sources: (step.sourceIds ?? [])
        .map((id) => sourceById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    });
  }
  return {
    banner: PILOT_BANNER,
    topic,
    prose,
    notes,
    occupations,
    nodes,
    edges,
    mermaidPromoted: flow.mermaidPromoted === true,
    flowRelease: flow.release ?? "blocked",
    relations: topic.relations ?? [],
  };
}
