import { ArrowLeft, Plus } from "lucide-react";
import { launchQuickUrl } from "../services/launcherService";
import { isNoticeActive, noticeKindOf, sortNotices } from "../services/noticePackService";
import { useNoticeStore } from "../stores/noticeStore";
import { NOTICE_KIND_LABEL, type NoticeItem } from "../types/notice";

interface NoticeAllPageProps {
  onBack: () => void;
  onAdd: () => void;
  onEdit: (item: NoticeItem) => void;
  onRemove: (item: NoticeItem) => void;
}

export function NoticeAllPage({ onBack, onAdd, onEdit, onRemove }: NoticeAllPageProps) {
  const notices = sortNotices(useNoticeStore((state) => state.notices));

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">공지</h1>
        <button type="button" className="icon-btn" onClick={onAdd} aria-label="공지 넣기">
          <Plus className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {notices.length === 0 ? (
          <p className="text-sm text-quiet">공지가 없습니다. + 로 넣거나 Pack에서 고르세요.</p>
        ) : (
          <ul className="space-y-1">
            {notices.map((item) => {
              const active = isNoticeActive(item);
              return (
                <li key={item.id} className="card-surface flex items-start gap-2 px-2 py-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                    disabled={!item.url}
                    onClick={() => {
                      if (item.url) {
                        void launchQuickUrl(item.url);
                      }
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded-full bg-paper px-2 py-0.5 text-[10px] font-medium text-quiet">
                        {NOTICE_KIND_LABEL[noticeKindOf(item)]}
                      </span>
                      <span className={`truncate text-sm ${active ? "text-desk" : "text-quiet"}`}>
                        {item.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-quiet">
                      {item.publishedAt.slice(0, 10)}
                      {active ? "" : " · 만료"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-ink-soft"
                    onClick={() => onEdit(item)}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-ink-soft"
                    onClick={() => onRemove(item)}
                  >
                    빼기
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
