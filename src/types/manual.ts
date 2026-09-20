export const MANUAL_KINDS = [
  "category",
  "procedure",
  "information",
  "warning",
  "error",
  "exception",
  "security",
] as const;

export type ManualKind = (typeof MANUAL_KINDS)[number];

export interface ManualTrailItem {
  id: string;
  title: string;
}

export interface ManualNode {
  id: string;
  title: string;
  summary?: string;
  category?: string;
  parentId?: string;
  type?: ManualKind;
  keywords?: string[];
  aliases?: string[];
  situations?: string[];
  steps?: string[];
  warnings?: string[];
  exceptions?: string[];
  securityNotes?: string[];
  relatedNodes?: string[];
  sourceRefs?: string[];
  children?: ManualNode[];
}

export const MANUAL_KIND_LABEL: Record<ManualKind, string> = {
  category: "분류",
  procedure: "절차",
  information: "정보",
  warning: "주의",
  error: "오류",
  exception: "예외",
  security: "보안",
};
