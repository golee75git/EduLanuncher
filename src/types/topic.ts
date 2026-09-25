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

export const JURISDICTIONS = ["national", "gangwon", "other-region", "unknown"] as const;

export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  national: "전국 공통",
  gangwon: "강원 기준",
  "other-region": "타 교육청 참고",
  unknown: "지역 확인 필요",
};

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

export interface TopicDetailStep {
  workflowTitle: string;
  explanation: string;
  printPages: number[];
}

export interface TopicDetailNote {
  text: string;
  printPages: number[];
}

export interface TopicDetailDocument {
  name: string;
  condition?: string;
  printPages: number[];
}

export interface TopicDetailIssue {
  issue: string;
  printPages: number[];
}

export interface TopicFlowStep {
  order: number;
  title: string;
  explanation: string;
  documents?: string[];
  caveats?: string[];
}

export interface TopicDecisionBranch {
  when: string;
  result: string;
  documents?: string[];
  caution?: string;
  nextStep?: string;
}

export interface TopicDecision {
  condition: string;
  branches: TopicDecisionBranch[];
}

export interface TopicTimelineItem {
  label: string;
  text: string;
}

export interface TopicComparison {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface TopicGlance {
  title: string;
  text: string;
}

export interface TopicMetric {
  label: string;
  value: string;
}

export type TopicCompleteness = "source-only" | "summary" | "detailed" | "verified";

export interface TopicSourceNote {
  title: string;
  pages: string;
  status: "needs-review";
}

export interface TopicDetailContent {
  whenToUse?: string;
  steps?: TopicDetailStep[];
  checkpoints?: TopicDetailNote[];
  requiredDocuments?: TopicDetailDocument[];
  reviewIssues?: TopicDetailIssue[];
  externalTopicId?: string;
  purpose?: string;
  easyExplanation?: string;
  flowchart?: TopicFlowStep[];
  decision?: TopicDecision;
  timeline?: TopicTimelineItem[];
  checklist?: string[];
  comparison?: TopicComparison;
  comparisons?: TopicComparison[];
  glance?: TopicGlance[];
  metrics?: TopicMetric[];
  reviewNotes?: string[];
  guideDocuments?: string[];
  auditNotes?: string[];
  naturalQueries?: string[];
  sourceNote?: TopicSourceNote;
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
  printPageStart?: number;
  printPageEnd?: number;
  pdfPageStart?: number;
  pdfPageEnd?: number;
  jurisdiction: Jurisdiction;
  jurisdictionName?: string;
  status: RecordStatus;
  needsReview: boolean;
}

export interface Topic {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  description: string;
  beginnerSummary?: string;
  detail?: TopicDetailContent;
  workflow: WorkflowStep[];
  keywords: TopicKeywords;
  exampleQuestions: string[];
  resources: TopicResource[];
  relatedTopics: string[];
  warnings: string[];
  status: RecordStatus;
  needsReview: boolean;
  contentCompleteness?: TopicCompleteness;
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
