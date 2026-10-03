import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HighlightText } from "../components/HighlightText";
import { SearchBar } from "../components/SearchBar";
import { openListed, openListedFolder } from "../services/launcherService";
import { clearSearchGrants } from "../services/windowService";
import { queryDocuments, type DocHit } from "../services/documentSearchService";

interface DocSearchPageProps {
  initialQuery?: string;
  onBack: () => void;
}

export function DocSearchPage({ initialQuery = "", onBack }: DocSearchPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<DocHit[]>([]);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openNote, setOpenNote] = useState("");
  const batch = useRef("");

  useEffect(() => {
    return () => {
      if (batch.current) {
        void clearSearchGrants("doc", batch.current);
      }
    };
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setHits([]);
      setHint("");
      setError("");
      if (batch.current) {
        void clearSearchGrants("doc", batch.current);
        batch.current = "";
      }
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void (async () => {
        try {
          const found = await queryDocuments(needle, 40);
          if (!cancelled) {
            batch.current = found.batch;
            setHits(found.hits);
            setHint(found.hint);
            setError("");
          }
        } catch (findError) {
          if (!cancelled) {
            setHits([]);
            setHint("");
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
    };
  }, [query]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">내 문서</h1>
      </header>
      <SearchBar value={query} onChange={setQuery} placeholder="문서 내용" />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          설정에서 색인한 폴더의 내용만 찾습니다. 문서 내용은 이 PC에만 있습니다.
        </p>
        {openNote ? <p className="text-sm text-quiet">{openNote}</p> : null}
        {hint ? <p className="text-xs leading-5 text-quiet">{hint}</p> : null}
        {!query.trim() ? (
          <p className="text-sm text-quiet">본문은 세 글자 이상으로 검색할 수 있습니다.</p>
        ) : busy && hits.length === 0 ? (
          <p className="text-sm text-quiet">찾는 중...</p>
        ) : error ? (
          <p className="text-sm text-quiet">{error}</p>
        ) : hits.length === 0 ? (
          <p className="text-sm text-quiet">내용이 일치하는 문서가 없습니다.</p>
        ) : (
          hits.map((hit) => (
            <div key={hit.launchId || hit.name} className="desk-row flex-col items-stretch gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title={hit.place}
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() =>
                    void openListed(hit.launchId).catch((openError) => {
                      setOpenNote(openError instanceof Error ? openError.message : "실행할 수 없습니다.");
                    })
                  }
                >
                  <HighlightText text={hit.name} query={query} />
                </button>
                <button
                  type="button"
                  title={hit.place}
                  aria-label="폴더 열기"
                  className="max-w-[46%] shrink-0 truncate text-xs text-quiet"
                  onClick={() =>
                    void openListedFolder(hit.folderId).catch((openError) => {
                      setOpenNote(openError instanceof Error ? openError.message : "실행할 수 없습니다.");
                    })
                  }
                >
                  {hit.place}
                </button>
              </div>
              {hit.note ? (
                <p className="text-xs leading-5 text-quiet">{hit.note}</p>
              ) : hit.snippet ? (
                <p className="text-xs leading-5 text-quiet">
                  <HighlightText text={hit.snippet} query={query} />
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
