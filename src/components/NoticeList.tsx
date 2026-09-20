import { Plus } from "lucide-react";
import { launchQuickUrl } from "../services/launcherService";
import { isNoticeActive, noticeKindOf, sortNotices } from "../services/noticePackService";
import { useNoticeStore } from "../stores/noticeStore";
import { NOTICE_HOME_LIMIT, NOTICE_KIND_LABEL } from "../types/notice";

interface NoticeListProps {
  onAll: () => void;
  onAdd: () => void;
}

export function NoticeList({ onAll, onAdd }: NoticeListProps) {
  const notices = useNoticeStore((state) => state.notices);
  const visible = sortNotices(notices.filter((item) => isNoticeActive(item))).slice(
    0,
    NOTICE_HOME_LIMIT,
  );

  return (
    <section className="zone-block bg-zone-notice">
      <div className="mb-1.5 flex items-center gap-1">
        <h2 className="min-w-0 flex-1 desk-label">공지</h2>
        <button
          type="button"
          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
          onClick={onAll}
        >
          모두
        </button>
        <button
          type="button"
          className="icon-btn p-1"
          onClick={onAdd}
          aria-label="공지 넣기"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="card-surface overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-quiet">
            공지가 없습니다. 넣거나 Pack에서 고르세요.
          </p>
        ) : (
          <ul className="divide-y divide-line/70">
            {visible.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-desk transition-colors duration-150 hover:bg-ink-soft/60 disabled:cursor-default disabled:hover:bg-transparent"
                  disabled={!item.url}
                  onClick={() => {
                    if (item.url) {
                      void launchQuickUrl(item.url);
                    }
                  }}
                >
                  <span className="shrink-0 rounded-full bg-paper px-2 py-0.5 text-[10px] font-medium text-quiet">
                    {NOTICE_KIND_LABEL[noticeKindOf(item)]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                  <span className="shrink-0 text-[10px] text-quiet">{item.publishedAt.slice(0, 10)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
