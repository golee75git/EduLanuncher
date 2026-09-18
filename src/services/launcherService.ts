import { openUrl } from "@tauri-apps/plugin-opener";
import type { ToolItem } from "../types/tool";
import { isPathTool, launchNative } from "./windowService";
import { useToolStore } from "../stores/toolStore";

export class LaunchError extends Error {
  path?: string;
  code: string;
  tool?: ToolItem;

  constructor(code: string, message: string, path?: string, tool?: ToolItem) {
    super(message);
    this.code = code;
    this.path = path;
    this.tool = tool;
  }
}

function normalizeUrl(target: string): string {
  const trimmed = target.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export async function launchTool(tool: ToolItem): Promise<"internal" | "launched"> {
  if (tool.enabled === false) {
    throw new LaunchError("disabled", "비활성화된 도구입니다.", undefined, tool);
  }

  if (tool.type === "internal") {
    await useToolStore.getState().markUsed(tool.id);
    return "internal";
  }

  const target = tool.target.trim();
  if (!target) {
    throw new LaunchError(
      "empty",
      "실행 대상이 아직 설정되지 않았습니다. 도구를 편집해 URL 또는 경로를 지정하세요.",
      undefined,
      tool,
    );
  }

  if (tool.type === "url") {
    try {
      await openUrl(normalizeUrl(target));
      await useToolStore.getState().markUsed(tool.id);
      return "launched";
    } catch (error) {
      throw new LaunchError(
        "failed",
        error instanceof Error ? error.message : "URL을 열 수 없습니다.",
        target,
        tool,
      );
    }
  }

  if (isPathTool(tool)) {
    const result = await launchNative(tool.type, target);
    if (!result.ok) {
      const code = result.error === "not_found" ? "not_found" : "failed";
      const message =
        code === "not_found"
          ? "등록된 파일을 찾을 수 없습니다."
          : (result.error ?? "실행할 수 없습니다.");
      throw new LaunchError(code, message, result.path ?? target, tool);
    }
    await useToolStore.getState().markUsed(tool.id);
    return "launched";
  }

  throw new LaunchError("unknown", "알 수 없는 도구 유형입니다.", target, tool);
}

export async function launchQuickUrl(url: string): Promise<void> {
  if (!url.trim()) {
    throw new LaunchError("empty", "URL이 설정되지 않았습니다.");
  }
  await openUrl(normalizeUrl(url));
}
