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
  onOpen: (item: NoticeItem) => void;
}

export function NoticeList({ onAll, onAdd, onOpen }: NoticeListProps) {
  const notices = useNoticeStore((state) => state.notices);
  const visible = sortNotices(notices.filter((item) => isNoticeActive(item))).slice(0, NOTICE_HOME_LIMIT);

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
                  onOpen(item);
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
