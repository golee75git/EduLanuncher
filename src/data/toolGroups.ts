import type { ToolType } from "../types/tool";

export const HOME_GROUP_PREVIEW = 3;

export const TOOL_GROUPS: Array<{ type: ToolType; label: string }> = [
  { type: "url", label: "사이트" },
  { type: "app", label: "프로그램" },
  { type: "file", label: "파일" },
  { type: "folder", label: "폴더" },
  { type: "internal", label: "업무도구" },
];

export function toolGroupLabel(type: ToolType): string {
  return TOOL_GROUPS.find((group) => group.type === type)?.label ?? "도구";
}
