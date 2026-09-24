import { Plus } from "lucide-react";
import { launchQuickUrl } from "../services/launcherService";
import { isNoticeActive, noticeKindOf, sortNotices } from "../services/noticePackService";
import { useNoticeStore } from "../stores/noticeStore";
import { NOTICE_HOME_LIMIT, NOTICE_KIND_LABEL, type NoticeItem } from "../types/notice";
import { NoticeCard } from "./home/NoticeCard";
import { SectionHeader } from "./home/SectionHeader";

interface NoticeListProps {
  onAll: () => void;
  onAdd: () => void;
  onOpen?: (item: NoticeItem) => void;
  variant?: "card" | "rows";
}

export function NoticeList({ onAll, onAdd, onOpen, variant = "card" }: NoticeListProps) {
  const notices = useNoticeStore((state) => state.notices);
  const visible = sortNotices(notices.filter((item) => isNoticeActive(item))).slice(0, NOTICE_HOME_LIMIT);

  if (variant === "rows") {
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
          <button type="button" className="icon-btn p-1" onClick={onAdd} aria-label="공지 넣기">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="card-surface overflow-hidden">
          {visible.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-quiet">공지가 없습니다. 넣거나 Pack에서 고르세요.</p>
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

  return (
    <section>
      <SectionHeader
        title="공지"
        trailing={
          <>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              onClick={onAll}
            >
              전체 보기
            </button>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-0.5 rounded-lg px-2 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              onClick={onAdd}
              aria-label="공지 추가"
              title="공지 추가"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              추가
            </button>
          </>
        }
      />
      {visible.length === 0 ? (
        <NoticeCard
          title="공지가 없습니다"
          description="‘+ 추가’로 새로운 공지를 등록해 보세요."
          onClick={onAdd}
        />
      ) : (
        <div className="space-y-2">
          {visible.map((item) => {
            const kind = NOTICE_KIND_LABEL[noticeKindOf(item)];
            const summary = (item.summary ?? "").trim();
            return (
              <NoticeCard
                key={item.id}
                title={item.title}
                description={summary ? `${kind} · ${summary}` : kind}
                onClick={() => {
                  if (item.url) {
                    void launchQuickUrl(item.url);
                    return;
                  }
                  onOpen?.(item);
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
