import { openUrl } from "@tauri-apps/plugin-opener";
import { isIeResetTarget } from "../data/computerTools";
import type { ToolItem } from "../types/tool";
import { launchNative, launchResult, openFolder, openIeReset } from "./windowService";
import { useToolStore } from "../stores/toolStore";

export class LaunchError extends Error {
  code: string;
  tool?: ToolItem;

  constructor(code: string, message: string, tool?: ToolItem) {
    super(message);
    this.code = code;
    this.tool = tool;
  }
}

function launchMessage(code: string | null | undefined): string {
  switch (code) {
    case "missing":
      return "등록된 파일을 찾을 수 없습니다.";
    case "denied":
      return "이 대상은 열 수 없습니다.";
    case "unsupported":
      return "알 수 없는 도구 유형입니다.";
    case "disabled":
      return "비활성화된 도구입니다.";
    default:
      return "실행할 수 없습니다.";
  }
}

async function finishLaunch(result: { ok: boolean; error?: string | null }, tool?: ToolItem): Promise<void> {
  if (result.ok) {
    return;
  }
  throw new LaunchError(result.error ?? "failed", launchMessage(result.error), tool);
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
    throw new LaunchError("disabled", "비활성화된 도구입니다.", tool);
  }

  if (tool.type === "internal") {
    if (isIeResetTarget(tool.target) || isIeResetTarget(tool.id)) {
      try {
        await openIeReset();
        await useToolStore.getState().markUsed(tool.id);
        return "launched";
      } catch {
        throw new LaunchError("failed", "복원 화면을 열 수 없습니다.", tool);
      }
    }
    await useToolStore.getState().markUsed(tool.id);
    return "internal";
  }

  const target = tool.target.trim();
  if (!target) {
    throw new LaunchError(
      "empty",
      "실행 대상이 아직 설정되지 않았습니다. 도구를 편집해 URL 또는 경로를 지정하세요.",
      tool,
    );
  }

  await finishLaunch(await launchNative(tool.id), tool);
  await useToolStore.getState().markUsed(tool.id);
  return "launched";
}

export async function openListed(id: string): Promise<void> {
  await finishLaunch(await launchResult(id));
}

export async function openListedFolder(id: string): Promise<void> {
  await finishLaunch(await openFolder(id));
}

export async function launchQuickUrl(url: string): Promise<void> {
  if (!url.trim()) {
    throw new LaunchError("empty", "URL이 설정되지 않았습니다.");
  }
  await openUrl(normalizeUrl(url));
}
