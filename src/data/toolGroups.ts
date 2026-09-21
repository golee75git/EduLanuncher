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

export function favoriteEmptyText(type: ToolType): string {
  if (type === "url") {
    return "즐겨찾기 사이트가 없습니다. 끌어놓기나 + 버튼으로 추가하세요.";
  }
  if (type === "app") {
    return "즐겨찾기 프로그램이 없습니다. 끌어놓기나 + 버튼으로 추가하세요.";
  }
  if (type === "file") {
    return "즐겨찾기 파일이 없습니다. 끌어놓기나 + 버튼으로 추가하세요.";
  }
  if (type === "folder") {
    return "즐겨찾기 폴더가 없습니다. 끌어놓기나 + 버튼으로 추가하세요.";
  }
  return "즐겨찾기 도구가 없습니다. + 버튼으로 추가하세요.";
}
