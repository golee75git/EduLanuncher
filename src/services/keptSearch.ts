import { searchForms } from "./keyLine";

export interface KeptQuery {
  text: string;
  at: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 7;
const STORE_LIMIT = 40;
const SHOW_LIMIT = 5;
const TEXT_LIMIT = 40;

function clip(value: string): string {
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, TEXT_LIMIT);
  return text;
}

export function freshQueries(items: KeptQuery[], now = Date.now()): KeptQuery[] {
  const cut = now - KEEP_DAYS * DAY_MS;
  const sorted = items
    .filter((item) => item && typeof item.text === "string" && typeof item.at === "number" && item.at >= cut && item.at <= now + DAY_MS)
    .map((item) => ({ text: clip(item.text), at: item.at }))
    .filter((item) => item.text.length >= 2)
    .sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const kept: KeptQuery[] = [];
  for (const item of sorted) {
    const key = item.text.toLocaleLowerCase("ko");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(item);
    if (kept.length >= STORE_LIMIT) {
      break;
    }
  }
  return kept;
}

function holdBack(text: string): boolean {
  if (text.replace(/\D/g, "").length >= 11) {
    return true;
  }
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text);
}

export function rememberQuery(items: KeptQuery[], text: string, now = Date.now()): KeptQuery[] {
  const clipped = clip(text);
  if (clipped.length < 2 || holdBack(clipped)) {
    return freshQueries(items, now);
  }
  const key = clipped.toLocaleLowerCase("ko");
  const rest = freshQueries(items, now).filter((item) => item.text.toLocaleLowerCase("ko") !== key);
  return freshQueries([{ text: clipped, at: now }, ...rest], now);
}

export function matchingQueries(items: KeptQuery[], typed: string, now = Date.now()): string[] {
  const forms = searchForms(typed).map((form) => form.toLocaleLowerCase("ko")).filter((form) => form.length > 0);
  if (forms.length === 0) {
    return [];
  }
  const exact = new Set(forms);
  return freshQueries(items, now)
    .filter((item) => {
      const text = item.text.toLocaleLowerCase("ko");
      if (exact.has(text)) {
        return false;
      }
      return forms.some((form) => text.startsWith(form));
    })
    .slice(0, SHOW_LIMIT)
    .map((item) => item.text);
}
