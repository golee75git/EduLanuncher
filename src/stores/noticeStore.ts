import { create } from "zustand";
import { noticeKindOf, sortNotices } from "../services/noticePackService";
import { loadNotices, saveNotices } from "../services/storageService";
import type { NoticeItem, NoticePack, StoredNotices } from "../types/notice";

interface NoticeState {
  packId?: string;
  packName?: string;
  importedAt?: string;
  notices: NoticeItem[];
  loaded: boolean;
  hydrate: (value: StoredNotices) => void;
  replaceFromPack: (pack: NoticePack) => Promise<number>;
}

function withKind(notices: NoticeItem[]): NoticeItem[] {
  return notices.map((item) => ({ ...item, kind: noticeKindOf(item) }));
}

export const useNoticeStore = create<NoticeState>((set, get) => ({
  notices: [],
  loaded: false,
  hydrate: (value) =>
    set({
      packId: value.packId,
      packName: value.packName,
      importedAt: value.importedAt,
      notices: withKind(value.notices),
      loaded: true,
    }),
  replaceFromPack: async (pack) => {
    const kind = pack.kind;
    const incoming = withKind(pack.notices).map((item) => ({ ...item, kind }));
    const kept = get().notices.filter((item) => noticeKindOf(item) !== kind);
    const notices = sortNotices([...incoming, ...kept]);
    const value: StoredNotices = {
      packId: pack.id,
      packName: pack.name,
      importedAt: new Date().toISOString(),
      notices,
    };
    set({
      packId: value.packId,
      packName: value.packName,
      importedAt: value.importedAt,
      notices,
    });
    await saveNotices(value);
    return incoming.length;
  },
}));

export async function hydrateNotices(): Promise<void> {
  const value = await loadNotices();
  useNoticeStore.getState().hydrate(value);
}
