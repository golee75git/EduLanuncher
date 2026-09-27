export interface HandbookCategory {
  id: string;
  name: string;
  pages: string;
  topicIds: string[];
}

export interface HandbookTopic {
  id: string;
  categoryId: string;
  title: string;
  officialName: string;
  pages: string;
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

export interface MenuData {
  handbook: { categories: HandbookCategory[]; topics: HandbookTopic[] };
  topics: TopicRow[];
  section2: Section2Topic[];
  epki: EpkiNode;
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
    ])
      .then(([handbook, topics, master, epki]) => ({
        handbook,
        topics,
        section2: master.topics ?? [],
        epki,
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
