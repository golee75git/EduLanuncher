import type { SchoolItem } from "../types/school";
import type { Topic } from "../types/topic";
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

export function scoreText(query: string, ...fields: Array<string | undefined>): number {
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

export interface TopicSearchHit {
  item: Topic;
  score: number;
  reason: string;
}

const TOPIC_SCORE = {
  titleExact: 800,
  titlePartial: 700,
  official: 600,
  general: 500,
  beginner: 400,
  example: 300,
  resourceTitle: 200,
  resourceBody: 100,
} as const;

const QUERY_SKIP = new Set(["하면", "어떻게", "되나", "부터", "해야", "무엇", "있나", "있는지"]);

function withStem(piece: string): string[] {
  const stem = piece.replace(/(을|를|은|는|이|가|의|와|과|도|만)$/u, "");
  if (stem && stem !== piece && stem.length >= 2) {
    return [piece, stem];
  }
  return [piece];
}

function queryPieces(query: string): string[] {
  const folded = normalize(query);
  const parts = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) => normalize(part))
    .filter((part) => part.length >= 2 && !QUERY_SKIP.has(part))
    .flatMap(withStem)
    .filter((part) => part.length >= 2 && !QUERY_SKIP.has(part));
  const unique = new Set<string>([folded, ...parts]);
  return [...unique];
}

function containsFold(haystack: string, needle: string): boolean {
  if (!haystack || !needle) {
    return false;
  }
  return normalize(haystack).includes(normalize(needle));
}

function bestKeywordMatch(pieces: string[], keywords: string[]): string {
  let best = "";
  for (const keyword of keywords) {
    const folded = normalize(keyword);
    if (!folded) {
      continue;
    }
    if (pieces.some((piece) => piece.includes(folded) || folded.includes(piece))) {
      if (folded.length > normalize(best).length) {
        best = keyword;
      }
    }
  }
  return best;
}

function topicTitleScore(query: string, title: string): number {
  const q = normalize(query);
  const text = normalize(title);
  if (!q || !text) {
    return 0;
  }
  if (text === q) {
    return TOPIC_SCORE.titleExact;
  }
  if (text.includes(q) || q.includes(text)) {
    return TOPIC_SCORE.titlePartial;
  }
  return 0;
}

export function searchTopics(query: string, topics: Topic[]): TopicSearchHit[] {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const pieces = queryPieces(q);
  const hits: TopicSearchHit[] = [];

  for (const topic of topics) {
    const titleScore = topicTitleScore(q, topic.title);
    if (titleScore === TOPIC_SCORE.titleExact) {
      hits.push({ item: topic, score: titleScore, reason: "제목 완전일치" });
      continue;
    }
    if (titleScore === TOPIC_SCORE.titlePartial) {
      hits.push({ item: topic, score: titleScore, reason: "제목 부분일치" });
      continue;
    }

    const flowHit = topic.workflow.find((step) =>
      pieces.some((piece) => containsFold(step.title, piece) || containsFold(piece, step.title)),
    );
    if (flowHit) {
      hits.push({
        item: topic,
        score: TOPIC_SCORE.official,
        reason: `"${flowHit.title}" 키워드 일치`,
      });
      continue;
    }

    const official = bestKeywordMatch(pieces, topic.keywords.official);
    if (official) {
      hits.push({ item: topic, score: TOPIC_SCORE.official, reason: `"${official}" 키워드 일치` });
      continue;
    }

    const general = bestKeywordMatch(pieces, topic.keywords.general);
    if (general) {
      hits.push({ item: topic, score: TOPIC_SCORE.general, reason: `"${general}" 키워드 일치` });
      continue;
    }

    const beginner = bestKeywordMatch(pieces, topic.keywords.beginner);
    if (beginner) {
      hits.push({ item: topic, score: TOPIC_SCORE.beginner, reason: `"${beginner}" 키워드 일치` });
      continue;
    }

    const related = bestKeywordMatch(pieces, topic.keywords.related);
    if (related) {
      hits.push({ item: topic, score: TOPIC_SCORE.beginner - 20, reason: `"${related}" 키워드 일치` });
      continue;
    }

    if (pieces.some((piece) => containsFold(topic.description, piece))) {
      hits.push({ item: topic, score: TOPIC_SCORE.example + 20, reason: "설명 일치" });
      continue;
    }

    const example = topic.exampleQuestions.find((question) =>
      pieces.some((piece) => containsFold(question, piece) || containsFold(piece, question)),
    );
    if (example) {
      hits.push({
        item: topic,
        score: TOPIC_SCORE.example,
        reason: `"${q}" 관련 질문 일치`,
      });
      continue;
    }

    const resourceTitle = topic.resources.find((resource) =>
      pieces.some((piece) => containsFold(resource.title, piece)),
    );
    if (resourceTitle) {
      hits.push({
        item: topic,
        score: TOPIC_SCORE.resourceTitle,
        reason: "자료 제목 일치",
      });
      continue;
    }

    const resourceBody = topic.resources.find((resource) =>
      pieces.some(
        (piece) =>
          containsFold(resource.summary, piece) ||
          containsFold(resource.document, piece) ||
          containsFold(resource.pages, piece),
      ),
    );
    if (resourceBody) {
      hits.push({
        item: topic,
        score: TOPIC_SCORE.resourceBody,
        reason: "자료 본문 일치",
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "ko"));
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
