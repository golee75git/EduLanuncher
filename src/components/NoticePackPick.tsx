import { NOTICE_KIND_LABEL, type NoticePack } from "../types/notice";
import type { LauncherPack } from "../data/educationPack";
import { noticeKindOf } from "../services/noticePackService";
import { describePackApply } from "../services/launcherPackService";
import { useNoticeStore } from "../stores/noticeStore";
import { useToolStore } from "../stores/toolStore";
import { useMemo, useState } from "react";

interface NoticePackPickProps {
  pack: NoticePack;
  sitePack?: LauncherPack;
  onClose: () => void;
  onAdded: (message: string) => void;
}

export function NoticePackPick({ pack, sitePack, onClose, onAdded }: NoticePackPickProps) {
  const existing = useNoticeStore((state) => state.notices);
  const addFromPack = useNoticeStore((state) => state.addFromPack);
  const already = useMemo(() => new Set(existing.map((item) => item.id)), [existing]);
  const fresh = pack.notices.filter((item) => !already.has(item.id));
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(fresh.map((item) => [item.id, true])),
  );
  const [busy, setBusy] = useState(false);

  const selectedIds = fresh.filter((item) => picked[item.id]).map((item) => item.id);
  const siteCount = sitePack?.tools.length ?? 0;
  const canApply = selectedIds.length > 0 || siteCount > 0;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-desk/40 p-4 backdrop-blur-sm">
      <div className="card-surface flex max-h-[90%] w-full max-w-sm flex-col p-4 shadow-pop">
        <h3 className="text-base font-semibold text-desk">
          {siteCount > 0 ? "공지·사이트 Pack에서 고르기" : "공지 Pack에서 고르기"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-quiet">
          {pack.name}
          {siteCount > 0 ? "" : ` · ${NOTICE_KIND_LABEL[pack.kind]}`}. 이미 있는 공지는 건너뜁니다.
          {siteCount > 0
            ? ` 넣기를 누르면 고른 공지와 사이트 ${siteCount}개를 함께 넣습니다.`
            : " 원문 사이트는 가져오지 않습니다."}
        </p>
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {pack.notices.map((item) => {
            const kept = already.has(item.id);
            return (
              <li key={item.id} className="flex items-start gap-2 rounded-lg px-1 py-1">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  disabled={kept}
                  checked={kept ? true : Boolean(picked[item.id])}
                  onChange={(event) =>
                    setPicked((current) => ({ ...current, [item.id]: event.target.checked }))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-desk">{item.title}</span>
                  <span className="text-[11px] text-quiet">
                    {NOTICE_KIND_LABEL[noticeKindOf(item)]} · {item.publishedAt.slice(0, 10)}
                    {kept ? " · 이미 있음" : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm text-desk transition-colors duration-150 hover:bg-paper"
            onClick={onClose}
          >
            닫기
          </button>
          <button
            type="button"
            className="rounded-lg bg-ink px-3 py-2 text-sm text-white transition-colors duration-150 hover:bg-ink-strong disabled:opacity-60"
            disabled={busy || !canApply}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  const parts: string[] = [];
                  if (selectedIds.length > 0) {
                    const count = await addFromPack(pack, selectedIds);
                    parts.push(count > 0 ? `공지 ${count}건` : "공지 없음");
                  }
                  if (sitePack && sitePack.tools.length > 0) {
                    const result = await useToolStore.getState().applyLauncherPack(sitePack);
                    parts.push(describePackApply(result.added, result.updated));
                  }
                  onAdded(parts.filter(Boolean).join(". ") || "넣을 항목이 없습니다.");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            넣기
          </button>
        </div>
      </div>
    </div>
  );
}
