import { parseNoticePack, readJsonFile } from "./noticePackService";
import { describePackApply, parseLauncherPack } from "./launcherPackService";
import { useNoticeStore } from "../stores/noticeStore";
import { useToolStore } from "../stores/toolStore";
import { NOTICE_KIND_LABEL } from "../types/notice";

export function isPackPath(path: string): boolean {
  return /\.(edupack|json)$/i.test(path.trim());
}

export const isNoticePackPath = isPackPath;

export async function applyNoticePackFromPath(path: string): Promise<string> {
  return applyPackFromPath(path);
}

export async function applyPackFromText(contents: string): Promise<string> {
  if (contents.length > 256 * 1024) {
    throw new Error("파일이 너무 큽니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Pack 형식이 올바르지 않습니다.");
  }
  return applyParsedPack(parsed);
}

export async function applyPackFromPath(path: string): Promise<string> {
  if (!isPackPath(path)) {
    throw new Error("Pack 파일(.edupack)만 적용할 수 있습니다.");
  }
  return applyPackFromText(await readJsonFile(path));
}

async function applyParsedPack(parsed: unknown): Promise<string> {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Pack 형식이 올바르지 않습니다.");
  }
  const source = parsed as Record<string, unknown>;
  if (Array.isArray(source.notices)) {
    const pack = parseNoticePack(parsed);
    const count = await useNoticeStore.getState().replaceFromPack(pack);
    return `${NOTICE_KIND_LABEL[pack.kind]} ${count}건을 적용했습니다.`;
  }
  if (Array.isArray(source.tools)) {
    const pack = parseLauncherPack(parsed);
    const result = await useToolStore.getState().applyLauncherPack(pack);
    return describePackApply(result.added, result.updated);
  }
  throw new Error("공지 Pack 또는 바로가기 Pack이 아닙니다.");
}
