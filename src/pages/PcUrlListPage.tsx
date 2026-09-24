import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ToolGlyph } from "../components/ToolGlyph";
import { asLocalPngIcon } from "../data/toolIcons";
import { readBookmarkHtmlFile } from "../services/bookmarkHtmlService";
import { addDroppedSite, readUrlShortcut } from "../services/dropSiteService";
import { launchQuickUrl } from "../services/launcherService";
import { browserFaviconsFor, listPcUrlShortcuts, type PcUrlItem } from "../services/pcUrlListService";

interface PcUrlListPageProps {
  onBack: () => void;
}

export function PcUrlListPage({ onBack }: PcUrlListPageProps) {
  const [items, setItems] = useState<PcUrlItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [icons, setIcons] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 목록 앞 그림: 내보낸 파일의 그림 → .url 파일 자체 그림 → 브라우저가 이 PC에 저장해 둔 그림
  useEffect(() => {
    const fresh = items.filter(
      (item) => !item.iconImage && !requested.current.has(`${item.path ?? ""}|${item.url}`),
    );
    if (fresh.length === 0) {
      return;
    }
    for (const item of fresh) {
      requested.current.add(`${item.path ?? ""}|${item.url}`);
    }
    const byBrowser = [...new Set(fresh.filter((item) => !item.path).map((item) => item.url))];
    const byFile = fresh.filter((item) => item.path);
    const keep = (found: Record<string, string>) => {
      if (mounted.current && Object.keys(found).length > 0) {
        setIcons((current) => ({ ...current, ...found }));
      }
    };
    void (async () => {
      if (byBrowser.length > 0) {
        try {
          const found = await browserFaviconsFor(byBrowser);
          const picked: Record<string, string> = {};
          byBrowser.forEach((url, index) => {
            const picture = asLocalPngIcon(found[index] ?? undefined);
            if (picture) {
              picked[url] = picture;
            }
          });
          keep(picked);
        } catch {
          // 그림을 못 찾으면 기본 그림으로 둔다.
        }
      }
      for (const item of byFile.slice(0, 200)) {
        if (!mounted.current || !item.path) {
          return;
        }
        try {
          const picture = asLocalPngIcon((await readUrlShortcut(item.path)).iconImage);
          if (picture) {
            keep({ [item.url]: picture });
          }
        } catch {
          // 읽지 못한 파일은 기본 그림으로 둔다.
        }
      }
    })();
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const found = await listPcUrlShortcuts();
        if (!cancelled) {
          setItems(found);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "목록을 읽지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, PcUrlItem[]>();
    for (const item of items) {
      const key = item.folder || "바로가기";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [items]);

  const loadExportedFile = async () => {
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "내보낸 즐겨찾기(HTML)", extensions: ["html", "htm"] }],
      });
      if (typeof picked !== "string") {
        return;
      }
      const loaded = await readBookmarkHtmlFile(picked);
      if (loaded.length === 0) {
        setNotice("주소를 찾지 못했습니다. Edge에서 내보낸 즐겨찾기 파일인지 확인하세요.");
        return;
      }
      const withIcon = loaded.filter((item) => item.iconImage).length;
      const urls = new Set(loaded.map((item) => item.url));
      setItems((current) => [...current.filter((item) => !urls.has(item.url)), ...loaded]);
      setNotice(`파일에서 ${loaded.length}개를 불러왔습니다. (그림 ${withIcon}개)`);
    } catch (loadError) {
      setNotice(loadError instanceof Error ? loadError.message : "파일을 읽지 못했습니다.");
    }
  };

  const addToLauncher = async (item: PcUrlItem) => {
    try {
      const fromFile = item.path ? await readUrlShortcut(item.path) : null;
      const result = await addDroppedSite(
        fromFile?.url ?? item.url,
        fromFile?.name ?? item.name,
        fromFile?.iconImage ?? item.iconImage ?? icons[item.url],
      );
      setNotice(
        result === "added" ? "런처에 넣었습니다." : result === "updated" ? "이름을 갱신했습니다." : "이미 있는 주소입니다.",
      );
    } catch (addError) {
      setNotice(addError instanceof Error ? addError.message : "넣지 못했습니다.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">인터넷 즐겨찾기</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          이 PC의 Edge·Chrome 북마크 파일과 Windows 즐겨찾기 폴더의 인터넷 바로가기(.url)를 보여 줍니다. Windows
          .url을 넣으면 그 파일 아이콘을 같이 남깁니다. Edge·Chrome이 이 PC에 이미 저장해 둔 사이트 그림이 있으면
          같이 남깁니다. 사이트에서 그림을 받아오지 않습니다. 로그인 정보·방문 기록은 읽지 않습니다.
        </p>
        <div className="space-y-1">
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-ink-soft"
            onClick={() => void loadExportedFile()}
          >
            내보낸 즐겨찾기 파일 불러오기
          </button>
          <p className="text-[11px] leading-4 text-quiet">
            Edge 주소창에 edge://favorites를 넣고 ⋯ → 즐겨찾기 내보내기로 만든 HTML 파일을 고르면 사이트 그림도
            같이 넣을 수 있습니다.
          </p>
        </div>
        {loading ? <p className="text-sm text-quiet">읽는 중...</p> : null}
        {error ? <p className="text-sm text-desk">{error}</p> : null}
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
        {!loading && !error && items.length === 0 ? (
          <p className="text-sm text-quiet">주소를 찾지 못했습니다. Edge나 Chrome에 즐겨찾기가 있는지 확인하세요.</p>
        ) : null}
        {groups.map(([folder, rows]) => (
          <section key={folder} className="space-y-1">
            <h2 className="text-[11px] font-semibold text-quiet">{folder}</h2>
            <ul className="card-surface divide-y divide-line/70">
              {rows.map((item) => (
                <li key={`${item.folder}:${item.url}:${item.name}`} className="flex items-center gap-1 px-2 py-1.5">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-paper"
                    onClick={() => void launchQuickUrl(item.url)}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink-soft p-1 text-ink">
                      <ToolGlyph
                        icon="globe"
                        iconImage={item.iconImage ?? icons[item.url]}
                        className="h-4 w-4"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-desk">{item.name}</span>
                      <span className="block truncate text-[11px] text-quiet">{item.url}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-ink hover:bg-ink-soft"
                    onClick={() => void addToLauncher(item)}
                  >
                    넣기
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
