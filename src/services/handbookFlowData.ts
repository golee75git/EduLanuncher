import rawPack from "../data/handbookFlowPack.json";
import { formatUnmatchedTasks, section2TopicForHandbook } from "./knowledgeService";
import { getTopics } from "./topicService";
import {
  readHandbookPack,
  type ChartPicture,
  type FlowTreeNode,
  type HandbookCatalog,
  type HandbookLink,
  type HandbookStep,
  type HandbookTopic,
} from "./handbookFlow";

let cached: HandbookCatalog | null = null;
let packOverride: unknown | null = null;

export function replaceHandbookPack(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const record = raw as { topics?: unknown };
  if (!Array.isArray(record.topics) || record.topics.length < 5) {
    return false;
  }
  packOverride = raw;
  cached = null;
  return true;
}

function oneExistingFlow(title: string): string[] | null {
  const matches = getTopics().filter(
    (topic) => topic.subcategory.trim() === title.trim() && topic.workflow.length >= 2,
  );
  const sequences = new Set(
    matches.map((topic) => topic.workflow.map((step) => step.title.trim()).filter(Boolean).join("\n")),
  );
  if (sequences.size !== 1) {
    return null;
  }
  const titles = matches[0].workflow.map((step) => step.title.trim()).filter(Boolean);
  return titles.length >= 2 ? titles : null;
}

function flowFromTitles(topicId: string, titles: string[]): Pick<HandbookTopic, "picture" | "steps" | "links"> {
  const ids = titles.map((_, index) => `${topicId}-flow-${index + 1}`);
  let tree: FlowTreeNode | null = null;
  for (let index = titles.length - 1; index >= 0; index -= 1) {
    tree = {
      id: ids[index],
      label: titles[index],
      open: true,
      children: tree ? [tree] : [],
    };
  }
  const picture: ChartPicture = { tree, backArrows: [], nodeIds: ids };
  const steps: HandbookStep[] = titles.map((name, index) => ({
    stepNo: index + 1,
    stepId: ids[index],
    name,
    description: "",
    condition: "",
    caveat: "",
    nextStep: titles[index + 1] ?? "",
    relatedTopic: "",
    tip: "",
    reference: "",
  }));
  const links: HandbookLink[] = titles.map((label, index) => ({
    nodeId: ids[index],
    label,
    targetTopicId: topicId,
    targetStepId: ids[index],
    topicExists: true,
    stepExists: true,
    nodeInChart: true,
  }));
  return { picture, steps, links };
}

function applySection2(topic: HandbookTopic): HandbookTopic {
  const source = section2TopicForHandbook(topic.officialName, topic.title);
  if (!source || source.tasks.length === 0) {
    return topic;
  }
  const used = new Set<number>();
  let changed = false;
  const steps = topic.steps.map((step) => {
    const index = source.tasks.findIndex((task, taskIndex) => !used.has(taskIndex) && task.name === step.name);
    if (index < 0) {
      return step;
    }
    used.add(index);
    changed = true;
    const task = source.tasks[index];
    return { ...step, description: task.body, tip: task.tip, reference: task.reference };
  });
  const detailNote = formatUnmatchedTasks(source.tasks.filter((_, index) => !used.has(index)));
  if (detailNote) {
    changed = true;
  }
  if (!changed) {
    return topic;
  }
  return { ...topic, steps, detailNote: detailNote || undefined };
}

function presentTopic(topic: HandbookTopic): HandbookTopic {
  if (!topic.generalGuidance) {
    return applySection2(topic);
  }
  const titles = oneExistingFlow(topic.title);
  if (!titles) {
    return applySection2({
      ...topic,
      picture: { tree: null, backArrows: [], nodeIds: [] },
      steps: [],
      links: [],
    });
  }
  return applySection2({ ...topic, ...flowFromTitles(topic.id, titles), shownFromExisting: true });
}

export function getHandbookCatalog(): HandbookCatalog {
  if (!cached) {
    const raw = readHandbookPack(packOverride ?? rawPack);
    const topics = raw.topics.map(presentTopic);
    const byId = new Map(topics.map((topic) => [topic.id, topic]));
    cached = {
      ...raw,
      topics,
      categories: raw.categories.map((category) => ({
        ...category,
        topics: category.topics.map((topic) => byId.get(topic.id) ?? topic),
      })),
    };
  }
  return cached;
}
