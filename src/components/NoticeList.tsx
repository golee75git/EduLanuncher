import { launchQuickUrl } from "../services/launcherService";
import { isNoticeActive, noticeKindOf, sortNotices } from "../services/noticePackService";
import { useNoticeStore } from "../stores/noticeStore";
import { NOTICE_HOME_LIMIT, NOTICE_KIND_LABEL, type NoticeKind } from "../types/notice";

interface NoticeListProps {
  kind: NoticeKind;
}

export function NoticeList({ kind }: NoticeListProps) {
  const notices = useNoticeStore((state) => state.notices);
  const visible = sortNotices(
    notices.filter((item) => noticeKindOf(item) === kind && isNoticeActive(item)),
  ).slice(0, NOTICE_HOME_LIMIT);
  const empty =
    kind === "alert"
      ? "공통 알림이 없습니다. 설정에서 알림 Pack을 가져오세요."
      : "가져온 공지가 없습니다. 설정에서 공지 Pack을 가져오세요.";

  return (
    <section className={`zone-block ${kind === "alert" ? "bg-zone-alert" : "bg-zone-notice"}`}>
      <h2 className="desk-label">{NOTICE_KIND_LABEL[kind]}</h2>
      <div className="card-surface overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-quiet">{empty}</p>
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
                  <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                  <span className="shrink-0 rounded-full bg-paper px-2 py-0.5 text-[10px] font-medium text-quiet">
                    {item.publishedAt.slice(0, 10)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
