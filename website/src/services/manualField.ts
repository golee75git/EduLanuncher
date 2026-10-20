import { confirmedHandbookLinks, heldHandbookLinks } from "../data/manualLinks.ts";
import type { HandbookCategory, HandbookTopic, ManualPart, ManualTopic } from "./menuContent";

const confirmedByHandbook = new Map(confirmedHandbookLinks);
const heldByHandbook = new Map(heldHandbookLinks);
const handbookByDetail = new Map(confirmedHandbookLinks.map(([handbookId, detailId]) => [detailId, handbookId]));

const templateTitles = new Set([
  "사안 발생 & 계획 수립",
  "서류 작성 & 신청",
  "결재 & 이행",
  "대장 정리 & 서류 보존",
  "업무 계획 수립 및 신청 접수",
]);

export type FieldCardState = "review" | "preparing" | "hold";

export function detailIdForHandbook(handbookId: string): string | null {
  return confirmedByHandbook.get(handbookId) ?? null;
}

export function handbookIdForDetail(detailId: string): string | null {
  return handbookByDetail.get(detailId) ?? null;
}

export function isHeldHandbook(handbookId: string): boolean {
  return heldByHandbook.has(handbookId);
}

export function fieldCardState(handbookId: string): FieldCardState {
  if (confirmedByHandbook.has(handbookId)) return "review";
  if (heldByHandbook.has(handbookId)) return "hold";
  return "preparing";
}

export function fieldStateLabel(state: FieldCardState): string {
  if (state === "review") return "검토 필요";
  if (state === "hold") return "연결 확인 필요";
  return "상세 지침 준비 중";
}

export function isTemplateTitle(title: string): boolean {
  return templateTitles.has(title.trim());
}

export function visibleParts(parts: ManualPart[]): ManualPart[] {
  return parts.filter((part) => part.title.trim() && part.body.trim() && !isTemplateTitle(part.title));
}

export function handbookTopicInCategory(topic: HandbookTopic, categoryId: string): boolean {
  return topic.categoryId === categoryId && topic.id !== "TOPIC-EPKI-01";
}

export function foldField(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function selectHandbookTopics(
  categories: HandbookCategory[],
  topics: HandbookTopic[],
  categoryId: string,
  query: string,
): HandbookTopic[] {
  const named = new Map(categories.map((category) => [category.id, category.name]));
  return topics.filter((topic) => {
    if (topic.id === "TOPIC-EPKI-01") return false;
    if (categoryId && !handbookTopicInCategory(topic, categoryId)) return false;
    if (!categoryId && !categories.some((category) => category.topicIds.includes(topic.id))) return false;
    return handbookMatchesQuery(topic, named.get(topic.categoryId) ?? "", query);
  });
}

export function handbookMatchesQuery(topic: HandbookTopic, categoryName: string, query: string): boolean {
  const needle = foldField(query);
  if (!needle) return true;
  const hay = foldField([topic.officialName, topic.title, categoryName, topic.pages].join("\n"));
  return hay.includes(needle);
}

export function detailHref(topic: HandbookTopic): string | null {
  const detailId = detailIdForHandbook(topic.id);
  if (!detailId) return null;
  return `/menu/topic/${encodeURIComponent(detailId)}`;
}

export function manualById(topics: ManualTopic[], id: string): ManualTopic | null {
  return topics.find((topic) => topic.id === id) ?? null;
}
