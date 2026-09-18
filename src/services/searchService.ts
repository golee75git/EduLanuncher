import type { SchoolItem } from "../types/school";
import type { ToolItem } from "../types/tool";

export interface SearchHit<T> {
  item: T;
  score: number;
}

export interface SearchResults {
  query: string;
  schools: SearchHit<SchoolItem>[];
  tools: SearchHit<ToolItem>[];
  recents: SearchHit<ToolItem>[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function scoreText(query: string, ...fields: Array<string | undefined>): number {
  const q = normalize(query);
  if (!q) {
    return 0;
  }
  let best = 0;
  for (const field of fields) {
    if (!field) {
      continue;
    }
    const text = normalize(field);
    if (text === q) {
      best = Math.max(best, 100);
    } else if (text.startsWith(q)) {
      best = Math.max(best, 80);
    } else if (text.includes(q)) {
      best = Math.max(best, 60);
    }
  }
  return best;
}

export function searchAll(
  query: string,
  tools: ToolItem[],
  schools: SchoolItem[],
): SearchResults {
  const q = query.trim();
  if (!q) {
    return { query: q, schools: [], tools: [], recents: [] };
  }

  const enabledTools = tools.filter((tool) => tool.enabled !== false);

  const schoolHits = schools
    .map((school) => ({
      item: school,
      score: scoreText(q, school.name, school.type, school.address, ...(school.keywords ?? [])),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);

  const toolHits = enabledTools
    .map((tool) => ({
      item: tool,
      score: scoreText(
        q,
        tool.name,
        tool.description,
        tool.category,
        tool.target,
        ...(tool.keywords ?? []),
      ),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);

  const recents = enabledTools
    .filter((tool) => tool.lastUsedAt)
    .map((tool) => ({
      item: tool,
      score: scoreText(q, tool.name, tool.description, tool.target, ...(tool.keywords ?? [])),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => {
      const byTime =
        new Date(b.item.lastUsedAt ?? 0).getTime() - new Date(a.item.lastUsedAt ?? 0).getTime();
      return byTime !== 0 ? byTime : b.score - a.score;
    });

  return {
    query: q,
    schools: schoolHits,
    tools: toolHits,
    recents,
  };
}

export function highlightParts(text: string, query: string): Array<{ text: string; match: boolean }> {
  const q = query.trim();
  if (!q) {
    return [{ text, match: false }];
  }
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const index = lower.indexOf(needle);
  if (index < 0) {
    return [{ text, match: false }];
  }
  return [
    { text: text.slice(0, index), match: false },
    { text: text.slice(index, index + q.length), match: true },
    { text: text.slice(index + q.length), match: false },
  ].filter((part) => part.text.length > 0);
}
