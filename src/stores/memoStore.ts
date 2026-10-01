import { create } from "zustand";
import { loadMemo, saveMemo } from "../services/storageService";
import {
  asNoteCoord,
  asNoteHeight,
  asNoteWidth,
  EMPTY_MEMO,
  EXTRA_MEMO_LIMIT,
  EXTRA_MEMO_SIZE,
  newMemoNoteId,
  type LocalMemo,
  type MemoNote,
} from "../types/memo";

interface NotePatch {
  text?: string;
  x?: number | null;
  y?: number | null;
  width?: number;
  height?: number;
}

interface MemoState {
  text: string;
  notes: MemoNote[];
  loaded: boolean;
  openIds: string[];
  setNoteOpen: (id: string, open: boolean) => void;
  hydrate: (memo: LocalMemo) => void;
  setText: (text: string) => void;
  addNote: () => MemoNote | null;
  updateNote: (id: string, patch: NotePatch) => boolean;
  removeNote: (id: string) => void;
  persist: () => Promise<void>;
}

let persistQueue: Promise<void> = Promise.resolve();

export const useMemoStore = create<MemoState>((set, get) => ({
  text: EMPTY_MEMO.text,
  notes: [],
  loaded: false,
  openIds: [],
  setNoteOpen: (id, open) => {
    const current = get().openIds;
    if (current.includes(id) === open) {
      return;
    }
    set({ openIds: open ? [...current, id] : current.filter((item) => item !== id) });
  },
  hydrate: (memo) => set({ text: memo.text, notes: memo.notes, loaded: true }),
  setText: (text) => set({ text }),
  addNote: () => {
    const existing = get().notes;
    if (existing.length >= EXTRA_MEMO_LIMIT) {
      return null;
    }
    let id = newMemoNoteId();
    if (existing.some((note) => note.id === id)) {
      id = newMemoNoteId();
    }
    const note: MemoNote = {
      id,
      text: "",
      x: null,
      y: null,
      width: EXTRA_MEMO_SIZE.defaultWidth,
      height: EXTRA_MEMO_SIZE.defaultHeight,
      updatedAt: new Date().toISOString(),
    };
    set({ notes: [...existing, note] });
    return note;
  },
  updateNote: (id, patch) => {
    const current = get().notes.find((note) => note.id === id);
    if (!current) {
      return false;
    }
    const next: MemoNote = {
      ...current,
      text: patch.text !== undefined ? patch.text.slice(0, 2000) : current.text,
      x: patch.x !== undefined ? asNoteCoord(patch.x) : current.x,
      y: patch.y !== undefined ? asNoteCoord(patch.y) : current.y,
      width: patch.width !== undefined ? asNoteWidth(patch.width) : current.width,
      height: patch.height !== undefined ? asNoteHeight(patch.height) : current.height,
      updatedAt: new Date().toISOString(),
    };
    if (
      next.text === current.text &&
      next.x === current.x &&
      next.y === current.y &&
      next.width === current.width &&
      next.height === current.height
    ) {
      return false;
    }
    set({
      notes: get().notes.map((note) => (note.id === id ? next : note)),
    });
    return true;
  },
  removeNote: (id) => set({ notes: get().notes.filter((note) => note.id !== id) }),
  persist: () => {
    persistQueue = persistQueue
      .then(async () => {
        const state = get();
        await saveMemo({
          text: state.text,
          updatedAt: new Date().toISOString(),
          notes: state.notes,
        });
      })
      .catch(() => {
        // 저장이 실패해도 다음 저장은 이어 간다.
      });
    return persistQueue;
  },
}));

export async function hydrateMemo(): Promise<void> {
  const memo = await loadMemo();
  useMemoStore.getState().hydrate(memo);
}
