import { create } from "zustand";
import { loadMemo, saveMemo } from "../services/storageService";
import { EMPTY_MEMO, type LocalMemo } from "../types/memo";

interface MemoState {
  text: string;
  loaded: boolean;
  hydrate: (memo: LocalMemo) => void;
  setText: (text: string) => void;
  persist: () => Promise<void>;
}

export const useMemoStore = create<MemoState>((set, get) => ({
  text: EMPTY_MEMO.text,
  loaded: false,
  hydrate: (memo) => set({ text: memo.text, loaded: true }),
  setText: (text) => set({ text }),
  persist: async () => {
    await saveMemo({
      text: get().text,
      updatedAt: new Date().toISOString(),
    });
  },
}));

export async function hydrateMemo(): Promise<void> {
  const memo = await loadMemo();
  useMemoStore.getState().hydrate(memo);
}
