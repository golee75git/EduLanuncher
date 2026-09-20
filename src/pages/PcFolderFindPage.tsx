import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { HighlightText } from "../components/HighlightText";
import { launchTool } from "../services/launcherService";
import {
  findUserFolderNames,
  haltUserFolderFind,
  userFolderAsTool,
  type UserFolderHit,
} from "../services/userFolderSearch";

interface PcFolderFindPageProps {
  initialQuery?: string;
  onBack: () => void;
}

export function PcFolderFindPage({ initialQuery = "", onBack }: PcFolderFindPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [hits, setHits] = useState<UserFolderHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      setError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void (async () => {
        try {
          const found = await findUserFolderNames(needle, includeMedia, 40);
          if (!cancelled) {
            setHits(found);
            setError("");
          }
        } catch (findError) {
          if (!cancelled) {
            setHits([]);
            setError(findError instanceof Error ? findError.message : "찾지 못했습니다.");
          }
        } finally {
          if (!cancelled) {
            setBusy(false);
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      void haltUserFolderFind();
    };
  }, [query, includeMedia]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">이 PC 폴더 찾기</h1>
      </header>
      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder="파일·폴더 이름"
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          이 사용자 폴더의 이름만 봅니다. 문서 내용은 읽지 않습니다. 기본은 바탕화면·문서·다운로드입니다.
        </p>
        <label className="flex items-center gap-2 text-sm text-desk">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={includeMedia}
            onChange={(event) => setIncludeMedia(event.target.checked)}
          />
          사진·음악·동영상도 보기
        </label>
        {busy ? (
          <button type="button" className="btn-secondary" onClick={() => void haltUserFolderFind()}>
            중지
          </button>
        ) : null}
        {error ? <p className="text-sm text-desk">{error}</p> : null}
        {!busy && query.trim().length >= 2 && hits.length === 0 && !error ? (
          <p className="text-sm text-quiet">이름이 일치하는 항목이 없습니다.</p>
        ) : null}
        <ul className="card-surface divide-y divide-line/70">
          {hits.map((hit) => (
            <li key={hit.path}>
              <button
                type="button"
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-ink-soft/60"
                title={hit.path}
                onClick={() => void launchTool(userFolderAsTool(hit))}
              >
                <span className="truncate text-sm text-desk">
                  <HighlightText text={hit.name} query={query} />
                </span>
                <span className="text-[11px] text-quiet">
                  {hit.zone} · {hit.kind === "folder" ? "폴더" : "파일"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
