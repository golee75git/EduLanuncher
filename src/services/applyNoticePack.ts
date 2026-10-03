import { applyLauncherBackup, isLauncherBackup, parseLauncherBackup } from "./backupService";
import { parseNoticePack, readJsonFile } from "./noticePackService";
import { describePackApply, parseLauncherPack } from "./launcherPackService";
import {
  isSharePack,
  parseSharePack,
  shareLauncherPack,
  shareNoticePack,
} from "./sharePackService";
import { useToolStore } from "../stores/toolStore";
import type { LauncherPack } from "../data/educationPack";
import type { NoticePack } from "../types/notice";

export function isPackPath(path: string): boolean {
  return /\.(edupack|json)$/i.test(path.trim());
}

export const isNoticePackPath = isPackPath;

export type PackOpenResult =
  | { mode: "done"; message: string }
  | { mode: "notice-pick"; pack: NoticePack; sitePack?: LauncherPack };

export async function applyNoticePackFromPath(path: string): Promise<PackOpenResult> {
  return openPackFromPath(path);
}

export async function applyPackFromText(contents: string): Promise<PackOpenResult> {
  return openPackFromText(contents);
}

export async function applyPackFromPath(path: string): Promise<PackOpenResult> {
  return openPackFromPath(path);
}

export async function openPackFromPath(id: string): Promise<PackOpenResult> {
  return openPackFromText(await readJsonFile(id));
}

export async function openPackFromText(contents: string): Promise<PackOpenResult> {
  if (contents.length > 256 * 1024) {
    throw new Error("파일이 너무 큽니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Pack 형식이 올바르지 않습니다.");
  }
  return openParsedPack(parsed);
}

async function openParsedPack(parsed: unknown): Promise<PackOpenResult> {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Pack 형식이 올바르지 않습니다.");
  }
  if (isLauncherBackup(parsed)) {
    const message = await applyLauncherBackup(parseLauncherBackup(parsed));
    return { mode: "done", message };
  }
  if (isSharePack(parsed)) {
    const share = parseSharePack(parsed);
    return {
      mode: "notice-pick",
      pack: shareNoticePack(share),
      sitePack: shareLauncherPack(share) ?? undefined,
    };
  }
  const source = parsed as Record<string, unknown>;
  if (Array.isArray(source.notices)) {
    return { mode: "notice-pick", pack: parseNoticePack(parsed) };
  }
  if (Array.isArray(source.tools)) {
    const pack = parseLauncherPack(parsed);
    const result = await useToolStore.getState().applyLauncherPack(pack);
    return {
      mode: "done",
      message: `${describePackApply(result.added, result.updated)}${result.skipped > 0 ? ` 관리자 도구가 꺼져 있어 ${result.skipped}개 항목을 건너뛰었습니다.` : ""}`,
    };
  }
  throw new Error("공지 Pack 또는 바로가기 Pack이 아닙니다.");
}
