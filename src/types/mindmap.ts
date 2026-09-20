export type MindMapNodeType = "category" | "subcategory" | "topic" | "process" | "resource";

export type MindMapRelationType = "contains" | "related" | "previous" | "next" | "similar";

export interface MindMapNode {
  id: string;
  label: string;
  nodeType: MindMapNodeType;
  topicId?: string;
  resourceId?: string;
  children: MindMapNode[];
  needsReview: boolean;
}

export interface MindMapRelation {
  from: string;
  to: string;
  type: MindMapRelationType;
  source: "mindmap" | "topic-json";
  needsReview: boolean;
}

export interface EducationMindMap {
  version: 1;
  roots: MindMapNode[];
  relations: MindMapRelation[];
}

export interface MindMapIssue {
  id: string;
  reason: string;
}
