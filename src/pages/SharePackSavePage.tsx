import { save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { noticeKindOf, writeJsonFile } from "../services/noticePackService";
import { buildSharePack } from "../services/sharePackService";
import { useNoticeStore } from "../stores/noticeStore";
import { useToolStore } from "../stores/toolStore";
import { NOTICE_KIND_LABEL } from "../types/notice";

interface SharePackSavePageProps {
  onBack: () => void;
}

export function SharePackSavePage({ onBack }: SharePackSavePageProps) {
  const notices = useNoticeStore((state) => state.notices);
  const tools = useToolStore((state) => state.tools);
  const sites = useMemo(
    () => tools.filter((tool) => tool.type === "url" && tool.enabled !== false),
    [tools],
  );
  const [packName, setPackName] = useState("공지·사이트 Pack");
  const [noticePick, setNoticePick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(notices.map((item) => [item.id, true])),
  );
  const [sitePick, setSitePick] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      tools
        .filter((tool) => tool.type === "url" && tool.enabled !== false)
        .map((item) => [item.id, true]),
    ),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const chosenNotices = useMemo(
    () => notices.filter((item) => noticePick[item.id]),
    [notices, noticePick],
  );
  const chosenSites = useMemo(
    () => sites.filter((item) => sitePick[item.id]),
    [sites, sitePick],
  );
  const canSave = chosenNotices.length > 0 || chosenSites.length > 0;

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold text-desk">공지·사이트 Pack 저장</h1>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          나눌 공지와 사이트만 고릅니다. 할 일·메모·설정은 넣지 않습니다. 기본은 모두 선택입니다.
        </p>
        <label className="block text-xs text-quiet">
          Pack 이름
          <input
            className="field-input"
            value={packName}
            maxLength={80}
            onChange={(event) => setPackName(event.target.value)}
          />
        </label>

        <section className="card-surface space-y-2 p-3">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 text-sm font-medium text-desk">공지</h2>
            <button
              type="button"
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
              onClick={() =>
                setNoticePick(Object.fromEntries(notices.map((item) => [item.id, true])))
              }
            >
              모두
            </button>
            <button
              type="button"
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
              onClick={() =>
                setNoticePick(Object.fromEntries(notices.map((item) => [item.id, false])))
              }
            >
              없음
            </button>
          </div>
          {notices.length === 0 ? (
            <p className="text-xs text-quiet">이 PC에 공지가 없습니다.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {notices.map((item) => (
                <li key={item.id} className="flex items-start gap-2 rounded-lg px-1 py-1">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={Boolean(noticePick[item.id])}
                    onChange={(event) =>
                      setNoticePick((current) => ({
                        ...current,
                        [item.id]: event.target.checked,
                      }))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-desk">{item.title}</span>
                    <span className="text-[11px] text-quiet">
                      {NOTICE_KIND_LABEL[noticeKindOf(item)]} · {item.publishedAt.slice(0, 10)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-surface space-y-2 p-3">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 text-sm font-medium text-desk">사이트</h2>
            <button
              type="button"
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
              onClick={() => setSitePick(Object.fromEntries(sites.map((item) => [item.id, true])))}
            >
              모두
            </button>
            <button
              type="button"
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
              onClick={() => setSitePick(Object.fromEntries(sites.map((item) => [item.id, false])))}
            >
              없음
            </button>
          </div>
          {sites.length === 0 ? (
            <p className="text-xs text-quiet">이 PC에 사이트 바로가기가 없습니다.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {sites.map((item) => (
                <li key={item.id} className="flex items-start gap-2 rounded-lg px-1 py-1">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={Boolean(sitePick[item.id])}
                    onChange={(event) =>
                      setSitePick((current) => ({
                        ...current,
                        [item.id]: event.target.checked,
                      }))
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-desk">{item.name}</span>
                    <span className="block truncate text-[11px] text-quiet">{item.target}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error ? <p className="text-xs text-red-700">{error}</p> : null}
        {message ? <p className="text-xs text-quiet">{message}</p> : null}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !canSave}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setError("");
              setMessage("");
              try {
                const pack = buildSharePack(packName, chosenNotices, chosenSites);
                const selected = await save({
                  defaultPath: "notice-site-pack.edupack",
                  filters: [
                    { name: "Pack", extensions: ["edupack"] },
                    { name: "JSON", extensions: ["json"] },
                  ],
                });
                if (typeof selected !== "string") {
                  return;
                }
                const path = /\.(edupack|json)$/i.test(selected) ? selected : `${selected}.edupack`;
                await writeJsonFile(path, `${JSON.stringify(pack, null, 2)}\n`);
                setMessage(
                  `공지 ${pack.notices.length}건, 사이트 ${pack.tools.length}개를 저장했습니다.`,
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          고른 항목 저장
        </button>
      </div>
    </div>
  );
}
