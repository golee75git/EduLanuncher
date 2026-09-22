import { create } from "zustand";
import { noticeKindOf, sortNotices } from "../services/noticePackService";
import { loadNotices, saveNotices } from "../services/storageService";
import {
  NOTICE_MAX,
  type NoticeItem,
  type NoticePack,
  type StoredNotices,
} from "../types/notice";

interface NoticeState {
  packId?: string;
  packName?: string;
  importedAt?: string;
  notices: NoticeItem[];
  loaded: boolean;
  hydrate: (value: StoredNotices) => void;
  addNotice: (item: NoticeItem) => Promise<void>;
  updateNotice: (id: string, patch: Partial<NoticeItem>) => Promise<void>;
  removeNotice: (id: string) => Promise<void>;
  addFromPack: (pack: NoticePack, ids: string[]) => Promise<number>;
}

function withKind(notices: NoticeItem[]): NoticeItem[] {
  return notices.map((item) => ({
    ...item,
    kind: noticeKindOf(item),
    origin: item.origin === "pack" ? "pack" : "local",
  }));
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
  addNotice: async (item) => {
    const current = get().notices;
    if (current.some((row) => row.id === item.id)) {
      return;
    }
    if (current.length >= NOTICE_MAX) {
      throw new Error("공지 목록이 가득 찼습니다.");
    }
    const notices = sortNotices(
      withKind([{ ...item, origin: item.origin ?? "local" }, ...current]),
    );
    await persist(set, get, { notices });
  },
  updateNotice: async (id, patch) => {
    const notices = sortNotices(
      withKind(
        get().notices.map((item) =>
          item.id === id
            ? {
                id: item.id,
                kind: patch.kind ?? item.kind,
                title: patch.title ?? item.title,
                publishedAt: patch.publishedAt ?? item.publishedAt,
                origin: item.origin === "pack" ? "pack" : (patch.origin ?? item.origin ?? "local"),
                ...(patch.packName ?? item.packName ? { packName: patch.packName ?? item.packName } : {}),
                ...(patch.summary ? { summary: patch.summary } : {}),
                ...(patch.url ? { url: patch.url } : {}),
                ...(patch.expiresAt ? { expiresAt: patch.expiresAt } : {}),
              }
            : item,
        ),
      ),
    );
    await persist(set, get, { notices });
  },
  removeNotice: async (id) => {
    const notices = get().notices.filter((item) => item.id !== id);
    await persist(set, get, { notices });
  },
  addFromPack: async (pack, ids) => {
    const chosen = new Set(ids);
    const existing = new Set(get().notices.map((item) => item.id));
    const room = Math.max(0, NOTICE_MAX - get().notices.length);
    const incoming = withKind(pack.notices)
      .filter((item) => chosen.has(item.id) && !existing.has(item.id))
      .slice(0, room)
      .map((item) => ({
        ...item,
        kind: noticeKindOf(item),
        origin: "pack" as const,
        packName: pack.name,
      }));
    if (incoming.length === 0) {
      return 0;
    }
    const notices = sortNotices([...incoming, ...get().notices]);
    await persist(set, get, {
      packId: pack.id,
      packName: pack.name,
      importedAt: new Date().toISOString(),
      notices,
    });
    return incoming.length;
  },
}));

async function persist(
  set: (partial: Partial<NoticeState>) => void,
  get: () => NoticeState,
  next: Pick<NoticeState, "notices"> & Partial<Pick<NoticeState, "packId" | "packName" | "importedAt">>,
): Promise<void> {
  const packId = next.packId ?? get().packId;
  const packName = next.packName ?? get().packName;
  const importedAt = next.importedAt ?? get().importedAt;
  const value: StoredNotices = {
    notices: next.notices,
    ...(packId ? { packId } : {}),
    ...(packName ? { packName } : {}),
    ...(importedAt ? { importedAt } : {}),
  };
  set({
    packId,
    packName,
    importedAt,
    notices: next.notices,
  });
  await saveNotices(value);
}

export async function hydrateNotices(): Promise<void> {
  const value = await loadNotices();
  useNoticeStore.getState().hydrate(value);
}
