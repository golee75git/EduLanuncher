import { create } from "zustand";
import { loadRecentTopics, saveRecentTopics } from "../services/storageService";
import type { RecentTopicItem } from "../types/recentTopic";

const MAX_ITEMS = 20;

interface RecentTopicState {
  items: RecentTopicItem[];
  loaded: boolean;
  hydrate: (items: RecentTopicItem[]) => void;
  markUsed: (id: string) => Promise<void>;
}

export const useRecentTopicStore = create<RecentTopicState>((set, get) => ({
  items: [],
  loaded: false,
  hydrate: (items) => set({ items, loaded: true }),
  markUsed: async (id) => {
    const now = new Date().toISOString();
    const rest = get().items.filter((item) => item.id !== id);
    const items = [{ id, usedAt: now }, ...rest].slice(0, MAX_ITEMS);
    set({ items });
    await saveRecentTopics(items);
  },
}));

export async function hydrateRecentTopics(): Promise<void> {
  const items = await loadRecentTopics();
  useRecentTopicStore.getState().hydrate(items);
}
