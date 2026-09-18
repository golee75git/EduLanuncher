import type { LauncherPack } from "../data/educationPack";
import { TOOL_ICON_MAP } from "../data/toolIcons";
import type { ToolItem, ToolType } from "../types/tool";

const TOOL_TYPES: ToolType[] = ["url", "file", "folder", "app", "internal"];

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asToolType(value: unknown): ToolType | null {
  return TOOL_TYPES.includes(value as ToolType) ? (value as ToolType) : null;
}

function asIcon(value: unknown): string | undefined {
  const icon = asText(value);
  if (!icon || !(icon in TOOL_ICON_MAP)) {
    return undefined;
  }
  return icon;
}

export function parseLauncherPack(raw: unknown): LauncherPack {
  if (!raw || typeof raw !== "object") {
    throw new Error("바로가기 Pack 형식이 올바르지 않습니다.");
  }
  const source = raw as Record<string, unknown>;
  const toolsRaw = source.tools;
  if (!Array.isArray(toolsRaw)) {
    throw new Error("tools 배열이 필요합니다.");
  }

  const tools: ToolItem[] = [];
  for (const item of toolsRaw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = asText(row.id);
    const name = asText(row.name);
    const type = asToolType(row.type);
    const target = asText(row.target);
    if (!id || !name || !type) {
      continue;
    }
    const icon = asIcon(row.icon);
    tools.push({
      id,
      name,
      type,
      target,
      ...(icon ? { icon } : {}),
      ...(asText(row.description) ? { description: asText(row.description) } : {}),
      ...(asText(row.category) ? { category: asText(row.category) } : {}),
      favorite: row.favorite === true,
      keywords: Array.isArray(row.keywords)
        ? row.keywords.filter((word): word is string => typeof word === "string" && word.trim().length > 0)
        : undefined,
      usageCount: 0,
      enabled: row.enabled === false ? false : true,
      origin: "pack",
      packName: asText(source.name) || "바로가기 Pack",
    });
  }

  if (tools.length === 0) {
    throw new Error("가져올 바로가기가 없습니다. id, name, type이 필요합니다.");
  }

  return {
    id: asText(source.id) || "pack-shortcuts",
    name: asText(source.name) || "바로가기 Pack",
    version: asText(source.version) || "0.1.0",
    tools,
  };
}

export function buildLauncherPack(name: string, tools: ToolItem[]): LauncherPack {
  const sites = tools.filter((tool) => tool.type === "url" && tool.enabled !== false);
  return parseLauncherPack({
    id: "pack-shortcuts",
    name: name.trim() || "공통 사이트",
    version: "0.1.0",
    tools: sites.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      type: tool.type,
      target: tool.target,
      icon: tool.icon,
      category: tool.category,
      favorite: tool.favorite,
      keywords: tool.keywords,
      enabled: true,
    })),
  });
}

export function describePackApply(added: number, updated: number): string {
  const parts: string[] = [];
  if (added > 0) {
    parts.push(`바로가기 ${added}개 추가`);
  }
  if (updated > 0) {
    parts.push(`아이콘 ${updated}개 갱신`);
  }
  return parts.length > 0 ? `${parts.join(", ")}했습니다.` : "이미 같은 내용입니다.";
}
