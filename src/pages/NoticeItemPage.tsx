import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { localDateKey } from "../services/noticePackService";
import { useNoticeStore } from "../stores/noticeStore";
import { NOTICE_KIND_LABEL, type NoticeItem, type NoticeKind } from "../types/notice";

interface NoticeItemPageProps {
  item?: NoticeItem;
  onBack: () => void;
}

export function NoticeItemPage({ item, onBack }: NoticeItemPageProps) {
  const addNotice = useNoticeStore((state) => state.addNotice);
  const updateNotice = useNoticeStore((state) => state.updateNotice);
  const [kind, setKind] = useState<NoticeKind>(item?.kind === "alert" ? "alert" : "org");
  const [title, setTitle] = useState(item?.title ?? "");
  const [summary, setSummary] = useState(item?.summary ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [publishedAt, setPublishedAt] = useState(item?.publishedAt.slice(0, 10) ?? localDateKey());
  const [expiresAt, setExpiresAt] = useState(item?.expiresAt?.slice(0, 10) ?? "");
  const [error, setError] = useState("");

  const save = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("제목을 입력하세요.");
      return;
    }
    const nextUrl = url.trim();
    if (nextUrl && !/^https?:\/\//i.test(nextUrl)) {
      setError("원문 주소는 http:// 또는 https:// 로 시작해야 합니다.");
      return;
    }
    const payload: NoticeItem = {
      id: item?.id ?? crypto.randomUUID(),
      kind,
      title: nextTitle.slice(0, 120),
      publishedAt: publishedAt || localDateKey(),
      origin: item?.origin ?? "local",
      ...(item?.packName ? { packName: item.packName } : {}),
      ...(summary.trim() ? { summary: summary.trim().slice(0, 200) } : {}),
      ...(nextUrl ? { url: nextUrl } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
    try {
      if (item) {
        await updateNotice(item.id, payload);
      } else {
        await addNotice(payload);
      }
      onBack();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "저장하지 못했습니다.");
    }
  };

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold text-desk">{item ? "공지 수정" : "공지 넣기"}</h1>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          이 PC 목록에만 남습니다. 기관은 담당자 안내, 부서는 부서 안내입니다. 게시판을 읽어 오지 않습니다.
        </p>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">구분</span>
          <select
            className="field-input"
            value={kind}
            onChange={(event) => setKind(event.target.value === "alert" ? "alert" : "org")}
          >
            <option value="org">{NOTICE_KIND_LABEL.org} (담당자)</option>
            <option value="alert">{NOTICE_KIND_LABEL.alert}</option>
          </select>
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">제목</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="field-input" />
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">요약 (선택)</span>
          <input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className="field-input"
            maxLength={200}
          />
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">원문 주소 (선택)</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="field-input"
            placeholder="https://"
          />
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">게시일</span>
          <input
            type="date"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
            className="field-input"
          />
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">만료일 (선택)</span>
          <input
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="field-input"
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button type="button" className="btn-primary h-11" onClick={() => void save()}>
          저장
        </button>
      </div>
    </div>
  );
}
