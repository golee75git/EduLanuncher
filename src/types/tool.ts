export type ToolType = "url" | "file" | "folder" | "app" | "internal";
export type ToolOrigin = "pack" | "local";

export interface ToolItem {
  id: string;
  name: string;
  description?: string;
  type: ToolType;
  target: string;
  icon?: string;
  category?: string;
  favorite?: boolean;
  keywords?: string[];
  lastUsedAt?: string;
  usageCount?: number;
  enabled?: boolean;
  origin?: ToolOrigin;
  packName?: string;
}

export function toolOriginLabel(tool: Pick<ToolItem, "origin">): string {
  return tool.origin === "pack" ? "Pack" : "이 PC";
}

export interface LaunchResult {
  ok: boolean;
  error?: string | null;
  path?: string | null;
}
