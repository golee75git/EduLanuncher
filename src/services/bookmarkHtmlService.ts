import { invoke } from "@tauri-apps/api/core";
import { asLocalPngIcon } from "../data/toolIcons";
import { cleanDropTitle, extractDroppedHttpUrl, nameFromHttpUrl } from "./dropSiteService";
import type { PcUrlItem } from "./pcUrlListService";

const MAX_ITEMS = 2000;
const MAX_FOLDER_DEPTH = 8;

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function attr(tag: string, name: string): string | undefined {
  const found = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "i"));
  return found?.[1];
}

function plainText(value: string): string {
  return decodeAttr(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * 브라우저가 내보낸 즐겨찾기 HTML(<A HREF ICON>, <H3> 폴더)을 목록으로 읽는다.
 * http(s) 주소만 받고, 그림은 PNG 자료(ICON="data:image/png;base64,...")만 남긴다.
 */
export function parseBookmarkHtml(html: string): PcUrlItem[] {
  const items: PcUrlItem[] = [];
  const stack: string[] = [];
  let pending: string | null = null;
  const token = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s([^>]*)>([\s\S]*?)<\/A>|<DL[^>]*>|<\/DL>/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html)) !== null && items.length < MAX_ITEMS) {
    const whole = match[0].toUpperCase();
    if (whole.startsWith("<H3")) {
      pending = plainText(match[1] ?? "");
    } else if (whole.startsWith("<A")) {
      const url = extractDroppedHttpUrl(decodeAttr(attr(match[2] ?? "", "HREF") ?? ""));
      if (!url) {
        continue;
      }
      const picture = asLocalPngIcon(attr(match[2] ?? "", "ICON"));
      items.push({
        name: cleanDropTitle(plainText(match[3] ?? "")) ?? nameFromHttpUrl(url),
        url,
        folder: stack.filter(Boolean).join(" / "),
        ...(picture ? { iconImage: picture } : {}),
      });
    } else if (whole.startsWith("<DL")) {
      if (stack.length < MAX_FOLDER_DEPTH) {
        stack.push(pending ?? "");
      }
      pending = null;
    } else {
      stack.pop();
    }
  }
  return items;
}

export async function readBookmarkHtmlFile(path: string): Promise<PcUrlItem[]> {
  const html = await invoke<string>("read_bookmark_html", { path });
  return parseBookmarkHtml(html);
}
