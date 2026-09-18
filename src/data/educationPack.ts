import { TOOL_ICON_MAP } from "./toolIcons";
import type { ToolItem } from "../types/tool";

export interface LauncherPack {
  id: string;
  name: string;
  version: string;
  tools: ToolItem[];
}

/** 선언형 바로가기만. 게시판 수집·스크립트 실행 없음. */
export const EDUCATION_PACK: LauncherPack = {
  id: "pack-education",
  name: "교육 바로가기",
  version: "0.1.0",
  tools: [
    {
      id: "tool-calendar",
      name: "캘린더 바로가기",
      description: "오늘 일정 화면 열기",
      type: "url",
      target: "https://calendar.google.com/calendar/r/day",
      icon: "globe",
      category: "행정",
      favorite: true,
      keywords: ["캘린더", "일정", "오늘", "calendar"],
      usageCount: 0,
      enabled: true,
    },
    {
      id: "tool-moe",
      name: "교육부 바로가기",
      description: "교육부 누리집",
      type: "url",
      target: "https://www.moe.go.kr",
      icon: "school",
      category: "행정",
      favorite: false,
      keywords: ["교육부", "moe"],
      usageCount: 0,
      enabled: true,
    },
    {
      id: "tool-schoolinfo",
      name: "학교알리미 바로가기",
      description: "학교 정보 공시",
      type: "url",
      target: "https://www.schoolinfo.go.kr",
      icon: "globe",
      category: "학교지원",
      favorite: false,
      keywords: ["학교알리미", "공시", "학교정보"],
      usageCount: 0,
      enabled: true,
    },
  ],
};

export function mergePackTools(
  existing: ToolItem[],
  incoming: ToolItem[],
  pack?: { name: string },
): { tools: ToolItem[]; added: number; updated: number } {
  const extras = incoming
    .filter((tool) => !existing.some((item) => item.id === tool.id))
    .map((tool) =>
      pack
        ? { ...tool, origin: "pack" as const, packName: pack.name }
        : tool,
    );
  let updated = 0;
  const filled = existing.map((tool) => {
    const fromPack = incoming.find((item) => item.id === tool.id);
    if (!fromPack) {
      return tool;
    }
    let next = tool;
    if (pack && !tool.origin) {
      next = { ...next, origin: "pack", packName: pack.name };
    }
    if (!tool.target.trim() && fromPack.target.trim()) {
      next = { ...next, target: fromPack.target };
    }
    const icon = fromPack.icon?.trim();
    if (icon && icon in TOOL_ICON_MAP && icon !== tool.icon) {
      next = { ...next, icon };
      updated += 1;
    }
    return next;
  });
  return { tools: [...extras, ...filled], added: extras.length, updated };
}
