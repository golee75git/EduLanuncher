import { invoke } from "@tauri-apps/api/core";
import { applyVerifiedIndex, type ManualIndexTopic } from "./manualIndexService";
import { applyVerifiedPack, type VerifiedPack } from "./manualPackService";
import { wantsLaunchKnowledge } from "./startupNetwork";

interface KnowledgeView {
  pack: VerifiedPack | null;
  index: { updatedAt: string; topics: ManualIndexTopic[] } | null;
}

export async function loadVerifiedKnowledge(): Promise<void> {
  try {
    const view = await invoke<KnowledgeView>("verified_knowledge");
    applyVerifiedPack(view.pack);
    applyVerifiedIndex(view.index);
  } catch {
    applyVerifiedIndex(null);
  }
}

export async function refreshVerifiedKnowledge(): Promise<void> {
  try {
    const view = await invoke<KnowledgeView>("refresh_verified_knowledge");
    applyVerifiedPack(view.pack);
    applyVerifiedIndex(view.index);
  } catch {
    applyVerifiedIndex(null);
  }
}

export async function startupKnowledge(fetchOnLaunch: boolean | undefined): Promise<void> {
  await loadVerifiedKnowledge();
  if (wantsLaunchKnowledge(fetchOnLaunch)) {
    await refreshVerifiedKnowledge();
  }
}
