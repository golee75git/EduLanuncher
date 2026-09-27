import { Store } from "@tauri-apps/plugin-store";
import { APP_CONFIG } from "../config/app";
import { replaceHandbookPack } from "./handbookFlowData";
import { replaceSection2 } from "./knowledgeService";
import { replaceManualRoot } from "./manualService";
import { replaceTopicFile } from "./topicService";

const MAX_BYTES = 8_000_000;

interface ManualPack {
  revision: string;
  handbook: unknown;
  topics: unknown;
  master: unknown;
  epki: unknown;
}

function packUrl(name: string): string {
  return `${APP_CONFIG.siteUrl}knowledge/pack/${name}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    throw new Error(String(response.status));
  }
  const text = await response.text();
  if (text.length === 0 || text.length > MAX_BYTES) {
    throw new Error("size");
  }
  return JSON.parse(text) as unknown;
}

function applyPack(pack: ManualPack): boolean {
  const manualOk = replaceManualRoot(pack.epki);
  const topicOk = replaceTopicFile(pack.topics);
  const handbookOk = replaceHandbookPack(pack.handbook);
  const sectionOk = replaceSection2(pack.master);
  return manualOk && topicOk && handbookOk && sectionOk;
}

export async function refreshManualPack(): Promise<void> {
  let store: Store;
  try {
    store = await Store.load("manual-pack.json");
  } catch {
    return;
  }
  const saved = await store.get<ManualPack>("pack");
  if (saved?.revision) {
    applyPack(saved);
  }
  try {
    const catalog = await fetchJson(`${APP_CONFIG.siteUrl}knowledge/catalog.json`);
    const revision =
      catalog && typeof catalog === "object" && "generatedAt" in catalog && typeof catalog.generatedAt === "string"
        ? catalog.generatedAt
        : "";
    if (!revision || saved?.revision === revision) {
      return;
    }
    const [handbook, topics, master, epki] = await Promise.all([
      fetchJson(packUrl("handbook.json")),
      fetchJson(packUrl("topics.json")),
      fetchJson(packUrl("master.json")),
      fetchJson(packUrl("epki.json")),
    ]);
    const next: ManualPack = { revision, handbook, topics, master, epki };
    if (!applyPack(next)) {
      return;
    }
    await store.set("pack", next);
    await store.save();
  } catch {
    // 사이트에 닿지 않으면 이 PC에 저장된 매뉴얼 또는 설치본 내용을 그대로 둔다.
  }
}
