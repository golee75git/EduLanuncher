export interface FlowNode {
  id: string;
  label: string;
  topicId?: string;
  pick?: string;
  children: FlowNode[];
}

export interface HandbookCategory {
  id: string;
  name: string;
  pages: string;
  topicIds: string[];
  picture: FlowNode | null;
}

export interface HandbookTopic {
  id: string;
  categoryId: string;
  title: string;
  officialName: string;
  pages: string;
  picture: FlowNode | null;
}

export interface TopicRow {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  description: string;
  beginnerSummary: string;
}

export interface Section2Task {
  name: string;
  body: string;
  tip: string;
  reference: string;
}

export interface Section2Topic {
  markdownTitle: string;
  category: string;
  tasks: Section2Task[];
}

export interface EpkiNode {
  id: string;
  title: string;
  summary?: string;
  securityNotes?: string[];
  children?: EpkiNode[];
}

export interface ManualStep {
  id: string;
  title: string;
}

export interface ManualPart {
  id: string;
  title: string;
  body: string;
}

export interface ManualTopic {
  id: string;
  title: string;
  categoryId: string;
  category: string;
  legacyLabel: string;
  steps: ManualStep[];
  parts: ManualPart[];
}

export interface ManualHit {
  topic: ManualTopic;
  score: number;
}

export interface MenuData {
  handbook: { categories: HandbookCategory[]; topics: HandbookTopic[] };
  topics: TopicRow[];
  section2: Section2Topic[];
  epki: EpkiNode;
  manual: ManualTopic[];
}

let loading: Promise<MenuData> | null = null;

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error("자료를 불러오지 못했습니다.");
  }
  return response.json() as Promise<T>;
}

export function loadMenuData(): Promise<MenuData> {
  if (!loading) {
    loading = Promise.all([
      readJson<MenuData["handbook"]>("/knowledge/handbook.json"),
      readJson<TopicRow[]>("/knowledge/topics.json"),
      readJson<{ topics: Section2Topic[] }>("/knowledge/master.json"),
      readJson<EpkiNode>("/knowledge/epki.json"),
      readJson<{ topics: ManualTopic[] }>("/knowledge/manual.json"),
    ])
      .then(([handbook, topics, master, epki, manual]) => ({
        handbook,
        topics,
        section2: master.topics ?? [],
        epki,
        manual: manual.topics ?? [],
      }))
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

export function section2ForTitle(topics: Section2Topic[], title: string): Section2Task[] {
  const folded = title.trim();
  if (!folded) return [];
  const found: Section2Task[] = [];
  for (const topic of topics) {
    if (topic.markdownTitle.trim() === folded) {
      found.push(...topic.tasks);
      continue;
    }
    for (const task of topic.tasks) {
      if (task.name.trim() === folded) found.push(task);
    }
  }
  return found;
}

export function handbookTopicTasks(data: MenuData, topic: HandbookTopic): Section2Task[] {
  return section2ForTitle(data.section2, topic.officialName);
}

function foldManual(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function searchManual(topics: ManualTopic[], query: string): ManualHit[] {
  const needle = foldManual(query);
  if (!needle) return [];
  const hits: ManualHit[] = [];
  for (const topic of topics) {
    const title = foldManual(topic.title);
    const legacy = foldManual(topic.legacyLabel);
    let score = 0;
    if (title === needle || legacy === needle) score = 100;
    else if (title.includes(needle) || needle.includes(title) || legacy.includes(needle)) score = 80;
    else if (topic.steps.some((step) => foldManual(step.title).includes(needle)) || topic.parts.some((part) => foldManual(part.title).includes(needle))) score = 60;
    else if (topic.parts.some((part) => foldManual(part.body).includes(needle)) || foldManual(topic.category).includes(needle)) score = 40;
    if (score > 0) hits.push({ topic, score });
  }
  hits.sort((a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title, "ko"));
  return hits.slice(0, 20);
}
