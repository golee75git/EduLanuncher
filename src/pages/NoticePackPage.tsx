import { save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { buildNoticePack, localDateKey, noticeKindOf, writeJsonFile } from "../services/noticePackService";
import { useNoticeStore } from "../stores/noticeStore";
import {
  NOTICE_KIND_FILE,
  NOTICE_KIND_LABEL,
  type NoticeItem,
  type NoticeKind,
} from "../types/notice";

interface NoticePackPageProps {
  onBack: () => void;
}

export function NoticePackPage({ onBack }: NoticePackPageProps) {
  const storedNotices = useNoticeStore((state) => state.notices);
  const replaceFromPack = useNoticeStore((state) => state.replaceFromPack);
  const [kind, setKind] = useState<NoticeKind>("org");
  const [packName, setPackName] = useState(NOTICE_KIND_LABEL.org);
  const [notices, setNotices] = useState<NoticeItem[]>(
    storedNotices.map((item) => ({ ...item, kind: noticeKindOf(item) })),
  );
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [url, setUrl] = useState("");
  const [publishedAt, setPublishedAt] = useState(localDateKey());
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const visible = useMemo(
    () => notices.filter((item) => noticeKindOf(item) === kind),
    [notices, kind],
  );

  const resetForm = () => {
    setTitle("");
    setSummary("");
    setUrl("");
    setPublishedAt(localDateKey());
    setExpiresAt("");
  };

  const addNotice = () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("제목을 입력하세요.");
      return;
    }
    const nextUrl = url.trim();
    if (nextUrl && !/^https?:\/\//i.test(nextUrl)) {
      setError("원문 주소는 https:// 로 시작해야 합니다.");
      return;
    }
    setNotices((current) => [
      {
        id: crypto.randomUUID(),
        kind,
        title: nextTitle,
        publishedAt: publishedAt || localDateKey(),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(nextUrl ? { url: nextUrl } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      },
      ...current,
    ]);
    setError("");
    setMessage("목록에 넣었습니다.");
    resetForm();
  };

  const savePack = async (alsoApply: boolean) => {
    try {
      const pack = buildNoticePack(packName, visible, kind);
      const selected = await save({
        defaultPath: NOTICE_KIND_FILE[kind],
        filters: [
          { name: "공지 Pack", extensions: ["edupack"] },
          { name: "JSON", extensions: ["json"] },
        ],
      });
      if (typeof selected !== "string") {
        return;
      }
      const path = /\.(edupack|json)$/i.test(selected) ? selected : `${selected}.edupack`;
      await writeJsonFile(path, `${JSON.stringify(pack, null, 2)}\n`);
      if (alsoApply) {
        await replaceFromPack(pack);
      }
      setError("");
      setMessage(
        alsoApply
          ? `${NOTICE_KIND_LABEL[kind]} Pack을 저장하고 이 PC에 적용했습니다.`
          : `${NOTICE_KIND_LABEL[kind]} Pack 파일을 저장했습니다.`,
      );
    } catch (saveError) {
      setMessage("");
      setError(saveError instanceof Error ? saveError.message : "저장하지 못했습니다.");
    }
  };

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold text-desk">공지·알림 작성</h1>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          기관 공지와 공통 알림은 따로 저장됩니다. .edupack 파일을 메신저로 보내면 직원이 눌러 바로 적용할 수 있습니다.
        </p>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">구분</span>
          <select
            className="field-input"
            value={kind}
            onChange={(event) => {
              const next = event.target.value === "alert" ? "alert" : "org";
              setKind(next);
              setPackName(NOTICE_KIND_LABEL[next]);
              setMessage("");
            }}
          >
            <option value="org">기관 공지</option>
            <option value="alert">공통 알림</option>
          </select>
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">Pack 이름</span>
          <input value={packName} onChange={(event) => setPackName(event.target.value)} className="field-input" />
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">제목</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="field-input" />
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">요약</span>
          <input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            className="field-input"
            maxLength={200}
          />
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">원문 주소{kind === "alert" ? " (선택)" : ""}</span>
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
        <button type="button" className="btn-secondary" onClick={addNotice}>
          목록에 추가
        </button>
        <section>
          <h2 className="desk-label">
            작성한 {NOTICE_KIND_LABEL[kind]} {visible.length}건
          </h2>
          {visible.length === 0 ? (
            <p className="text-sm text-quiet">아직 없습니다. 위에서 추가하세요.</p>
          ) : (
            <ul className="space-y-1">
              {visible.map((item) => (
                <li key={item.id} className="card-surface flex items-start gap-2 px-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-desk">{item.title}</span>
                    <span className="text-[11px] text-quiet">{item.publishedAt.slice(0, 10)}</span>
                  </span>
                  <button
                    type="button"
                    className="text-xs text-red-700 hover:underline"
                    onClick={() => setNotices((current) => current.filter((notice) => notice.id !== item.id))}
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {message ? <p className="text-xs text-quiet">{message}</p> : null}
        <button type="button" className="btn-primary h-11" onClick={() => void savePack(false)}>
          Pack 파일로 저장
        </button>
        <button type="button" className="btn-secondary" onClick={() => void savePack(true)}>
          저장하고 이 PC에 적용
        </button>
      </div>
    </div>
  );
}
