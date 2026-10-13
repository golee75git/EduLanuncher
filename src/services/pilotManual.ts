import { create } from "zustand";
import { searchForms } from "./keyLine";
import {
  buildPilotView,
  dedupePilotHits,
  isPilotTopicId,
  pilotHits,
  type PilotHit,
  type PilotView,
} from "./pilotManualCore";

interface PilotPack {
  standard: Parameters<typeof buildPilotView>[0];
  search: Parameters<typeof pilotHits>[1];
}

interface PilotState {
  enabled: boolean;
  ready: boolean;
  setEnabled: (enabled: boolean) => void;
  markReady: () => void;
}

let pack: PilotPack | null = null;

export const usePilotManualStore = create<PilotState>((set) => ({
  enabled: true,
  ready: false,
  setEnabled: (enabled) => {
    if (!import.meta.env.DEV) {
      return;
    }
    set({ enabled });
  },
  markReady: () => set({ ready: true }),
}));

export function pilotManualEnabled(): boolean {
  return usePilotManualStore.getState().enabled;
}

void Promise.all([
  import("../../generated/knowledge-v1/standard/family-0001.json"),
  import("../../generated/knowledge-v1/search/family-0001.json"),
]).then(([standardMod, searchMod]) => {
  pack = { standard: standardMod.default, search: searchMod.default };
  usePilotManualStore.getState().markReady();
});

export function pilotHitsForQuery(query: string, existingIds: string[]): PilotHit[] {
  if (!pilotManualEnabled() || !pack) {
    return [];
  }
  const seen = [...existingIds];
  const hits: PilotHit[] = [];
  for (const form of searchForms(query)) {
    hits.push(...pilotHits(true, pack.search, form, seen));
    for (const hit of hits) {
      if (!seen.includes(hit.id)) {
        seen.push(hit.id);
      }
    }
  }
  return dedupePilotHits(hits, existingIds);
}

export function pilotViewFor(topicId: string): PilotView | null {
  if (!pilotManualEnabled() || !pack || !isPilotTopicId(topicId)) {
    return null;
  }
  return buildPilotView(pack.standard, topicId);
}

export { isPilotTopicId };
