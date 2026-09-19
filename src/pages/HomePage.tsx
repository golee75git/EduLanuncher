import { Plus, Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FavoriteGrid } from "../components/FavoriteGrid";
import { HighlightText } from "../components/HighlightText";
import { NoticeList } from "../components/NoticeList";
import { RecentTools } from "../components/RecentTools";
import { SchoolSearchResult } from "../components/SchoolSearchResult";
import { SearchBar } from "../components/SearchBar";
import { TodoList } from "../components/TodoList";
import { ToolGlyph } from "../components/ToolGlyph";
import { APP_CONFIG } from "../config/app";
import { HOME_GROUP_PREVIEW, TOOL_GROUPS } from "../data/toolGroups";
import { setSearchFocusHandler } from "../services/focusBus";
import { searchAll, type SearchResults } from "../services/searchService";
import { hidePanel } from "../services/windowService";
import { getSchools } from "../stores/schoolStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToolStore } from "../stores/toolStore";
import type { SchoolItem } from "../types/school";
import type { ToolItem, ToolType } from "../types/tool";

export type HomeAction =
  | { type: "launch"; tool: ToolItem }
  | { type: "edit"; tool?: ToolItem; createType?: ToolType }
  | { type: "group"; groupType: ToolType }
  | { type: "pc-urls" }
  | { type: "computer-tools" }
  | { type: "remove"; tool: ToolItem }
  | { type: "internal"; id: string; title: string }
  | { type: "settings" };

interface HomePageProps {
  onAction: (action: HomeAction) => void;
}

type ResultItem =
  | { kind: "school"; id: string; school: SchoolItem }
  | { kind: "tool"; id: string; tool: ToolItem }
  | { kind: "recent"; id: string; tool: ToolItem };

function todayLabel(): string {
  const now = new Date();
  return `${now.getMonth() + 1}월 ${now.getDate()}일`;
}

function flattenResults(results: SearchResults): ResultItem[] {
  const schools: ResultItem[] = results.schools.map((hit) => ({
    kind: "school",
    id: `school:${hit.item.id}`,
    school: hit.item,
  }));
  const tools: ResultItem[] = results.tools.map((hit) => ({
    kind: "tool",
    id: `tool:${hit.item.id}`,
    tool: hit.item,
  }));
  const recents: ResultItem[] = results.recents
    .filter((hit) => !results.tools.some((tool) => tool.item.id === hit.item.id))
    .map((hit) => ({
      kind: "recent" as const,
      id: `recent:${hit.item.id}`,
      tool: hit.item,
    }));
  return [...schools, ...tools, ...recents];
}

export function HomePage({ onAction }: HomePageProps) {
  const tools = useToolStore((state) => state.tools);
  const toggleFavorite = useToolStore((state) => state.toggleFavorite);
  const settings = useSettingsStore((state) => state.settings);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSchool, setActiveSchool] = useState<SchoolItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const schools = useMemo(() => getSchools(), []);
  const favoriteGroups = useMemo(
    () =>
      TOOL_GROUPS.map((group) => {
        const all = tools.filter(
          (tool) => tool.type === group.type && tool.favorite && tool.enabled !== false,
        );
        return { ...group, shown: all.slice(0, HOME_GROUP_PREVIEW) };
      }),
    [tools],
  );
  const favorites = useMemo(
    () => favoriteGroups.flatMap((group) => group.shown),
    [favoriteGroups],
  );
  const recents = useMemo(
    () =>
      tools
        .filter((tool) => tool.lastUsedAt && tool.enabled !== false)
        .sort((a, b) => new Date(b.lastUsedAt ?? 0).getTime() - new Date(a.lastUsedAt ?? 0).getTime())
        .slice(0, settings.recentCount),
    [tools, settings.recentCount],
  );
  const results = useMemo(() => searchAll(query, tools, schools), [query, tools, schools]);
  const flat = useMemo(() => flattenResults(results), [results]);
  const idleItems: ResultItem[] = useMemo(
    () => [
      ...favorites.map((tool) => ({ kind: "tool" as const, id: `fav:${tool.id}`, tool })),
      ...recents.map((tool) => ({ kind: "recent" as const, id: `idle-recent:${tool.id}`, tool })),
    ],
    [favorites, recents],
  );
  const navigable = query.trim() ? flat : idleItems;

  useEffect(() => {
    setSearchFocusHandler(() => {
      setActiveSchool(null);
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    inputRef.current?.focus();
    return () => setSearchFocusHandler(null);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
    if (!query.trim()) {
      setActiveSchool(null);
    }
  }, [query]);

  const activate = (item: ResultItem | undefined) => {
    if (!item) {
      return;
    }
    if (item.kind === "school") {
      setActiveSchool(item.school);
      return;
    }
    onAction({ type: "launch", tool: item.tool });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (activeSchool) {
        setActiveSchool(null);
        return;
      }
      if (query) {
        setQuery("");
        return;
      }
      void hidePanel();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(navigable.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activate(navigable[selectedIndex]);
    }
  };

  const selectedId = navigable[selectedIndex]?.id;
  const searching = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ink shadow-[0_0_0_3px] shadow-ink-soft" />
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-ink">{APP_CONFIG.appName}</p>
            <h1 className="text-[15px] font-semibold text-desk">{APP_CONFIG.displayName}</h1>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-quiet">{todayLabel()}</span>
          <button type="button" className="icon-btn" onClick={() => onAction({ type: "settings" })} aria-label="설정">
            <Settings className="h-4 w-4" />
          </button>
          <button type="button" className="icon-btn" onClick={() => onAction({ type: "edit" })} aria-label="도구 추가">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </header>

      <SearchBar ref={inputRef} value={query} onChange={setQuery} onKeyDown={onKeyDown} />

      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {activeSchool ? (
          <SchoolSearchResult
            school={activeSchool}
            query={query}
            onOpenInternal={(id, title) => onAction({ type: "internal", id, title })}
          />
        ) : null}

        {!searching && !activeSchool ? (
          <>
            <NoticeList kind="org" />
            <NoticeList kind="alert" />
            <section className="zone-block bg-zone-tools">
              <h2 className="desk-label">자주 사용하는 도구</h2>
              <div className="space-y-3">
                {favoriteGroups.map((group) => (
                  <div key={group.type}>
                    <div className="mb-1.5 flex items-center gap-1">
                      <h3 className="min-w-0 flex-1 text-[11px] text-quiet">{group.label}</h3>
                      {group.type === "url" ? (
                        <button
                          type="button"
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
                          onClick={() => onAction({ type: "pc-urls" })}
                        >
                          인터넷 즐겨찾기
                        </button>
                      ) : null}
                      {group.type === "internal" ? (
                        <button
                          type="button"
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
                          onClick={() => onAction({ type: "computer-tools" })}
                        >
                          컴퓨터도구
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
                        onClick={() => onAction({ type: "group", groupType: group.type })}
                      >
                        모두
                      </button>
                      <button
                        type="button"
                        className="icon-btn p-1"
                        onClick={() => onAction({ type: "edit", createType: group.type })}
                        aria-label={`${group.label} 추가`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <FavoriteGrid
                      tools={group.shown}
                      layout={group.type === "url" ? "grid" : "list"}
                      selectedId={selectedId?.startsWith("fav:") ? selectedId.slice(4) : undefined}
                      onLaunch={(tool) => onAction({ type: "launch", tool })}
                      onFavorite={(tool) => void toggleFavorite(tool.id)}
                      onEdit={(tool) => onAction({ type: "edit", tool })}
                      onDelete={(tool) => onAction({ type: "remove", tool })}
                    />
                  </div>
                ))}
              </div>
            </section>
            <TodoList />
            <section className="zone-block bg-zone-recent">
              <h2 className="desk-label">최근 사용</h2>
              <RecentTools
                tools={recents}
                selectedId={
                  selectedId?.startsWith("idle-recent:") ? selectedId.slice("idle-recent:".length) : undefined
                }
                onLaunch={(tool) => onAction({ type: "launch", tool })}
              />
            </section>
          </>
        ) : null}

        {searching && !activeSchool ? (
          <>
            <ResultGroup title="학교" empty="일치하는 학교가 없습니다.">
              {results.schools.map((hit) => (
                <button
                  key={hit.item.id}
                  type="button"
                  onClick={() => setActiveSchool(hit.item)}
                  className={`desk-row ${
                    selectedId === `school:${hit.item.id}` ? "desk-row-active" : ""
                  }`}
                >
                  <HighlightText text={hit.item.name} query={query} />
                  <span className="ml-2 text-xs text-quiet">{hit.item.type}</span>
                </button>
              ))}
            </ResultGroup>
            <ResultGroup title="관련 도구" empty="일치하는 도구가 없습니다.">
              {results.tools.map((hit) => {
                return (
                  <button
                    key={hit.item.id}
                    type="button"
                    onClick={() => onAction({ type: "launch", tool: hit.item })}
                    className={`desk-row gap-2 ${
                      selectedId === `tool:${hit.item.id}` ? "desk-row-active" : ""
                    }`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      <ToolGlyph
                        icon={hit.item.icon}
                        iconImage={hit.item.iconImage}
                        className="h-4 w-4 text-quiet"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <HighlightText text={hit.item.name} query={query} />
                    </span>
                  </button>
                );
              })}
            </ResultGroup>
            <section className="zone-block bg-zone-recent">
              <h2 className="desk-label">최근 사용</h2>
              <RecentTools
                tools={results.recents.map((hit) => hit.item)}
                query={query}
                selectedId={
                  selectedId?.startsWith("recent:") ? selectedId.slice("recent:".length) : undefined
                }
                onLaunch={(tool) => onAction({ type: "launch", tool })}
              />
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ResultGroup({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  return (
    <section>
      <h2 className="desk-label">{title}</h2>
      {count === 0 ? <p className="text-sm text-quiet">{empty}</p> : <div className="space-y-1">{children}</div>}
    </section>
  );
}
