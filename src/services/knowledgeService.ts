import master from "../data/knowledge/master.json";

export interface Section2Task {
  name: string;
  body: string;
  tip: string;
  reference: string;
  matchedTopicIds: string[];
}

export interface Section2Topic {
  markdownTitle: string;
  category: string;
  tasks: Section2Task[];
  matchedTopicIds: string[];
}

let topics = master.topics as Section2Topic[];

export function replaceSection2(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || !("topics" in raw) || !Array.isArray(raw.topics)) {
    return false;
  }
  if (raw.topics.length === 0) {
    return false;
  }
  topics = raw.topics as Section2Topic[];
  return true;
}

function sameName(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

export function section2TopicForHandbook(officialName: string, title: string): Section2Topic | null {
  return (
    topics.find((topic) => sameName(topic.markdownTitle, officialName) || sameName(topic.markdownTitle, title)) ?? null
  );
}

export function section2TasksForTitle(title: string): Array<Section2Task & { parentTitle: string }> {
  const found: Array<Section2Task & { parentTitle: string }> = [];
  const folded = title.trim();
  if (!folded) {
    return found;
  }
  for (const topic of topics) {
    if (sameName(topic.markdownTitle, folded)) {
      for (const task of topic.tasks) {
        found.push({ ...task, parentTitle: topic.markdownTitle });
      }
      continue;
    }
    for (const task of topic.tasks) {
      if (sameName(task.name, folded)) {
        found.push({ ...task, parentTitle: topic.markdownTitle });
      }
    }
  }
  return found;
}

export function formatUnmatchedTasks(tasks: Section2Task[]): string {
  return tasks
    .map((task) => {
      const parts = [task.name, task.body];
      if (task.tip.trim()) {
        parts.push(`팁\n${task.tip.trim()}`);
      }
      if (task.reference.trim()) {
        parts.push(`참고\n${task.reference.trim()}`);
      }
      return parts.filter((part) => part.trim()).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}
