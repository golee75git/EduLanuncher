import type { ManualKind, ManualTrailItem } from "./manual";

export const RESOURCE_TYPES = [
  "manual",
  "law",
  "guideline",
  "audit",
  "qna",
  "faq",
  "form",
  "notice",
  "system",
  "case",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type RecordStatus = "current" | "old" | "unknown";

export interface TopicKeywords {
  official: string[];
  general: string[];
  beginner: string[];
  related: string[];
}

export interface WorkflowStep {
  order: number;
  title: string;
  description?: string;
}

export interface TopicResource {
  id: string;
  type: ResourceType;
  title: string;
  summary: string;
  organization: string;
  document: string;
  publishedAt: string;
  pages: string;
  url: string;
  status: RecordStatus;
  needsReview: boolean;
}

export interface Topic {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  description: string;
  workflow: WorkflowStep[];
  keywords: TopicKeywords;
  exampleQuestions: string[];
  resources: TopicResource[];
  relatedTopics: string[];
  warnings: string[];
  status: RecordStatus;
  needsReview: boolean;
  trail?: ManualTrailItem[];
  situations?: string[];
  exceptions?: string[];
  sourceRefs?: string[];
  kind?: ManualKind;
  securityNotes?: string[];
}

export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  manual: "매뉴얼",
  law: "법령",
  guideline: "지침",
  audit: "감사사례",
  qna: "질의회신",
  faq: "FAQ",
  form: "서식",
  notice: "공지",
  system: "업무시스템",
  case: "사례",
};

export const RESOURCE_TAB_IDS = [
  "all",
  "manual",
  "law-guide",
  "audit",
  "qna",
  "faq",
  "form",
  "system",
] as const;

export type ResourceTabId = (typeof RESOURCE_TAB_IDS)[number];

export const RESOURCE_TAB_LABEL: Record<ResourceTabId, string> = {
  all: "전체",
  manual: "매뉴얼",
  "law-guide": "법령/지침",
  audit: "감사사례",
  qna: "질의회신",
  faq: "FAQ",
  form: "서식",
  system: "업무시스템",
};
