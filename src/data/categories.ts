export const TOOL_CATEGORIES = [
  "행정",
  "문서",
  "전산",
  "학교지원",
  "시설",
  "체육",
  "기타",
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];
