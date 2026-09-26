import { cat1DetailNote, cat1StepNote } from "../data/handbookCat1Notes";
import rawPack from "../data/handbookFlowPack.json";
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

function applyCat1(topic: HandbookTopic): HandbookTopic {
  const detailNote = cat1DetailNote(topic.id);
  let changed = Boolean(detailNote);
  const steps = topic.steps.map((step) => {
    const note = cat1StepNote(topic.id, step.name);
    if (!note) {
      return step;
    }
    changed = true;
    return { ...step, description: note.body, tip: note.tip, reference: note.reference };
  });
  if (!changed) {
    return topic;
  }
  return { ...topic, steps, detailNote: detailNote || undefined };
}

function presentTopic(topic: HandbookTopic): HandbookTopic {
  if (!topic.generalGuidance) {
    return applyCat1(topic);
  }
  const titles = oneExistingFlow(topic.title);
  if (!titles) {
    return applyCat1({
      ...topic,
      picture: { tree: null, backArrows: [], nodeIds: [] },
      steps: [],
      links: [],
    });
  }
  return applyCat1({ ...topic, ...flowFromTitles(topic.id, titles), shownFromExisting: true });
}

export function getHandbookCatalog(): HandbookCatalog {
  if (!cached) {
    const raw = readHandbookPack(rawPack);
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
