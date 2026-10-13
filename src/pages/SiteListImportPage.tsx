import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { asLocalPngIcon } from "../data/toolIcons";
import {
  extractDroppedHttpUrl,
  nameFromHttpUrl,
  pickDroppedSiteName,
  sameHttpUrl,
} from "../services/dropSiteService";
import { browserFaviconsFor } from "../services/pcUrlListService";
import { pickOpenFiles } from "../services/savePick";
import { readSiteList, type SiteNameUrl } from "../services/siteListService";
import { useToolStore } from "../stores/toolStore";

interface SiteListImportPageProps {
  onBack: () => void;
  initialRows?: SiteNameUrl[];
}

function pickState(rows: SiteNameUrl[], tools: { type: string; target: string }[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const row of rows) {
    next[row.url] = !tools.some((tool) => tool.type === "url" && sameHttpUrl(tool.target, row.url));
  }
  return next;
}

export function SiteListImportPage({ onBack, initialRows = [] }: SiteListImportPageProps) {
  const tools = useToolStore((state) => state.tools);
  const addTools = useToolStore((state) => state.addTools);
  const [rows, setRows] = useState<SiteNameUrl[]>(initialRows);
  const [picked, setPicked] = useState<Record<string, boolean>>(() => pickState(initialRows, tools));
  const [notice, setNotice] = useState(
    initialRows.length > 0 ? `문서에서 ${initialRows.length}개 주소를 찾았습니다.` : "",
  );
  const [busy, setBusy] = useState(false);

  const known = (url: string) => tools.some((tool) => tool.type === "url" && sameHttpUrl(tool.target, url));

  const chosen = useMemo(
    () => rows.filter((row) => picked[row.url] && !known(row.url)),
    [rows, picked, tools],
  );

  const loadFile = async () => {
    try {
      const files = await pickOpenFiles("sitelist");
      const file = files[0];
      if (!file) {
        return;
      }
      const sheet = await readSiteList(file.id);
      const nextPick: Record<string, boolean> = {};
      for (const row of sheet.rows) {
        nextPick[row.url] = !tools.some((tool) => tool.type === "url" && sameHttpUrl(tool.target, row.url));
      }
      setRows(sheet.rows);
      setPicked(nextPick);
      const notes: string[] = [];
      if (sheet.rows.length === 0) {
        notes.push("넣을 주소가 없습니다. 첫 줄은 사이트명과 url이어야 합니다.");
      } else {
        notes.push(`${sheet.rows.length}개를 읽었습니다.`);
      }
      if (sheet.skipped > 0) {
        notes.push(`주소가 아니거나 같은 주소 ${sheet.skipped}줄은 건너뛰었습니다.`);
      }
      if (sheet.limited) {
        notes.push("300줄까지만 읽었습니다.");
      }
      setNotice(notes.join(" "));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "엑셀 파일을 읽지 못했습니다.");
    }
  };

  const toggle = (url: string) => {
    if (known(url)) {
      return;
    }
    setPicked((current) => ({ ...current, [url]: !current[url] }));
  };

  const save = async () => {
    const fresh = chosen
      .map((row) => {
        const url = extractDroppedHttpUrl(row.url);
        if (!url || known(url)) {
          return null;
        }
        return { ...row, url };
      })
      .filter((row): row is SiteNameUrl => row !== null);
    if (fresh.length === 0) {
      setNotice("넣을 주소가 없습니다.");
      return;
    }
    setBusy(true);
    try {
      let pictures: Array<string | null> = [];
      try {
        pictures = await browserFaviconsFor(fresh.map((row) => row.url));
      } catch {
        pictures = [];
      }
      await addTools(
        fresh.map((row, index) => {
          const name = pickDroppedSiteName(row.url, row.name);
          const picture = asLocalPngIcon(pictures[index] ?? undefined);
          return {
            id: crypto.randomUUID(),
            name,
            type: "url" as const,
            target: row.url,
            icon: "globe",
            ...(picture ? { iconImage: picture } : {}),
            category: "기타",
            favorite: true,
            keywords: [name, nameFromHttpUrl(row.url)],
            usageCount: 0,
            enabled: true,
            origin: "local" as const,
          };
        }),
      );
      setNotice(`${fresh.length}개를 넣었습니다.`);
      setRows([]);
      setPicked({});
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "넣지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">사이트 목록</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          엑셀 첫 시트의 첫 번째 열을 사이트명으로 보여 줍니다. url 칸의 주소만 읽습니다. http와 https만 됩니다. 넣기를 누르기 전에는 저장하지 않습니다.
          이미 있는 주소는 건너뜁니다. 사이트에 접속하지 않습니다.
        </p>
        <button
          type="button"
          className="rounded-full px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-ink-soft"
          onClick={() => void loadFile()}
        >
          엑셀 파일 고르기
        </button>
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
        {rows.length > 0 ? (
          <ul className="card-surface divide-y divide-line/70">
            {rows.map((row) => {
              const exists = known(row.url);
              return (
                <li key={row.url} className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 rounded border-line"
                    checked={!exists && Boolean(picked[row.url])}
                    disabled={exists}
                    onChange={() => toggle(row.url)}
                    aria-label={row.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-desk">{row.name}</span>
                    <span className="block truncate text-[11px] text-quiet">{row.url}</span>
                  </span>
                  {exists ? <span className="shrink-0 text-[11px] text-quiet">이미 있음</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {rows.length > 0 ? (
          <button type="button" className="btn-primary h-11 font-medium" disabled={busy || chosen.length === 0} onClick={() => void save()}>
            {chosen.length > 0 ? `${chosen.length}개 넣기` : "넣기"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
