import { Plus, Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FavoriteGrid } from "../components/FavoriteGrid";
import { HighlightText } from "../components/HighlightText";
import { AppHeader } from "../components/home/AppHeader";
import { GlobalSearch } from "../components/home/GlobalSearch";
import { LauncherGrid, homeFavoriteColumns } from "../components/home/LauncherGrid";
import { SectionHeader } from "../components/home/SectionHeader";
import { WelcomeMessage } from "../components/home/WelcomeMessage";
import { NoticeList } from "../components/NoticeList";
import { RecentTools } from "../components/RecentTools";
import { SchoolSearchResult } from "../components/SchoolSearchResult";
import { HomeJumpButton } from "../components/HomeJumpButton";
import { SearchBar } from "../components/SearchBar";
import { TodoList } from "../components/TodoList";
import { ToolGlyph } from "../components/ToolGlyph";
import { APP_CONFIG } from "../config/app";
import { HOME_GROUP_PREVIEW, TOOL_GROUPS, favoriteEmptyText, toolGroupLabel } from "../data/toolGroups";
import { setSearchFocusHandler } from "../services/focusBus";
import { searchAll, searchTopics, scoreText, type SearchResults, type TopicSearchHit } from "../services/searchService";
import {
  HOME_TROUBLE_LIMIT,
  searchTroubleCards,
  type TroubleSearchHit,
} from "../services/troubleshootingService";
import { TROUBLE_CATEGORY_LABEL } from "../types/troubleshooting";
import { getTopicById, getTopics } from "../services/topicService";
import { TopicSearch } from "../components/TopicSearch";
import { WorkMapPreview } from "../components/WorkMapPreview";
import {
  findUserFolderNames,
  haltUserFolderFind,
  USER_FOLDER_HOME_LIMIT,
  userFolderAsTool,
  type UserFolderHit,
} from "../services/userFolderSearch";
import { hidePanel } from "../services/windowService";
import { getSchools } from "../stores/schoolStore";
import { useRecentTopicStore } from "../stores/recentTopicStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToolStore } from "../stores/toolStore";
import { homeListColumns, isPriorSkin } from "../types/settings";
import type { NoticeItem } from "../types/notice";
import type { SchoolItem } from "../types/school";
import type { ToolItem, ToolType } from "../types/tool";
import type { RecentUseItem } from "../components/RecentTools";

export type HomeAction =
  | { type: "launch"; tool: ToolItem }
  | { type: "edit"; tool?: ToolItem; createType?: ToolType }
  | { type: "group"; groupType: ToolType }
  | { type: "pc-urls" }
  | { type: "computer-tools" }
  | { type: "shortcuts" }
  | { type: "pc-folders"; query?: string }
  | { type: "topics" }
  | { type: "handbook" }
  | { type: "troubleshoot"; search?: string }
  | { type: "troubleshoot-card"; cardId: string; search?: string }
  | { type: "topic"; topicId: string; search?: string }
  | { type: "notices" }
  | { type: "notice-item"; item?: NoticeItem }
  | { type: "remove"; tool: ToolItem }
  | { type: "internal"; id: string; title: string }
  | { type: "settings" };

interface HomePageProps {
  onAction: (action: HomeAction) => void;
  search?: string;
}

type ResultItem =
  | { kind: "topic"; id: string; topicId: string }
  | { kind: "school"; id: string; school: SchoolItem }
  | { kind: "tool"; id: string; tool: ToolItem }
  | { kind: "recent"; id: string; tool: ToolItem }
  | { kind: "recent-topic"; id: string; topicId: string }
  | { kind: "pc-file"; id: string; hit: UserFolderHit }
  | { kind: "trouble"; id: string; cardId: string };

function todayLabel(): string {
  const now = new Date();
  return `${now.getMonth() + 1}월 ${now.getDate()}일`;
}

function flattenResults(
  topicHits: TopicSearchHit[],
  results: SearchResults,
  recentUse: RecentUseItem[],
  folderHits: UserFolderHit[],
  troubleHits: TroubleSearchHit[],
): ResultItem[] {
  const topics: ResultItem[] = topicHits.map((hit) => ({
    kind: "topic",
    id: `topic:${hit.item.id}`,
    topicId: hit.item.id,
  }));
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
  const recents: ResultItem[] = recentUse
    .filter((item) =>
      item.kind === "tool"
        ? !results.tools.some((hit) => hit.item.id === item.tool.id)
        : !topicHits.some((hit) => hit.item.id === item.topic.id),
    )
    .map((item) =>
      item.kind === "tool"
        ? { kind: "recent" as const, id: `recent:${item.tool.id}`, tool: item.tool }
        : { kind: "recent-topic" as const, id: `recent-topic:${item.topic.id}`, topicId: item.topic.id },
    );
  const folders: ResultItem[] = folderHits.map((hit) => ({
    kind: "pc-file" as const,
    id: `pc-file:${hit.path}`,
    hit,
  }));
  const troubles: ResultItem[] = troubleHits.slice(0, HOME_TROUBLE_LIMIT).map((hit) => ({
    kind: "trouble" as const,
    id: `trouble:${hit.item.id}`,
    cardId: hit.item.id,
  }));
  return [...tools, ...recents, ...folders, ...schools, ...troubles, ...topics];
}

export function HomePage({ onAction, search = "" }: HomePageProps) {
  const tools = useToolStore((state) => state.tools);
  const toggleFavorite = useToolStore((state) => state.toggleFavorite);
  const settings = useSettingsStore((state) => state.settings);
  const recentTopicItems = useRecentTopicStore((state) => state.items);
  const [query, setQuery] = useState(search);
  const [folderHits, setFolderHits] = useState<UserFolderHit[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSchool, setActiveSchool] = useState<SchoolItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const schools = useMemo(() => getSchools(), []);
  const topicList = useMemo(() => getTopics(), []);
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
  const recentUseAll = useMemo(() => {
    const fromTools: RecentUseItem[] = tools
      .filter((tool) => tool.lastUsedAt && tool.enabled !== false)
      .map((tool) => ({
        kind: "tool" as const,
        id: tool.id,
        usedAt: tool.lastUsedAt ?? "",
        tool,
      }));
    const fromTopics: RecentUseItem[] = [];
    for (const row of recentTopicItems) {
      const topic = getTopicById(row.id);
      if (!topic) {
        continue;
      }
      fromTopics.push({ kind: "topic", id: topic.id, usedAt: row.usedAt, topic });
    }
    return [...fromTools, ...fromTopics].sort(
      (a, b) => new Date(b.usedAt).getTime() - new Date(a.usedAt).getTime(),
    );
  }, [tools, recentTopicItems]);
  const recentUse = useMemo(
    () => recentUseAll.slice(0, settings.recentCount),
    [recentUseAll, settings.recentCount],
  );
  const results = useMemo(() => searchAll(query, tools, schools), [query, tools, schools]);
  const topicHits = useMemo(() => searchTopics(query, topicList), [query, topicList]);
  const troubleHits = useMemo(() => searchTroubleCards(query), [query]);
  const recentUseMatched = useMemo(() => {
    const q = query.trim();
    if (!q) {
      return recentUse;
    }
    return recentUseAll
      .filter((item) => {
        if (item.kind === "tool") {
          return (
            scoreText(
              q,
              item.tool.name,
              item.tool.description,
              item.tool.category,
              item.tool.target,
              ...(item.tool.keywords ?? []),
            ) > 0
          );
        }
        return searchTopics(q, [item.topic]).length > 0;
      })
      .slice(0, settings.recentCount);
  }, [query, recentUse, recentUseAll, settings.recentCount]);
  const flat = useMemo(
    () => flattenResults(topicHits, results, recentUseMatched, folderHits, troubleHits),
    [topicHits, results, recentUseMatched, folderHits, troubleHits],
  );
  const idleItems: ResultItem[] = useMemo(
    () => [
      ...favorites.map((tool) => ({ kind: "tool" as const, id: `fav:${tool.id}`, tool })),
      ...recentUse.map((item) =>
        item.kind === "tool"
          ? { kind: "recent" as const, id: `idle-recent:${item.tool.id}`, tool: item.tool }
          : {
              kind: "recent-topic" as const,
              id: `idle-recent-topic:${item.topic.id}`,
              topicId: item.topic.id,
            },
      ),
    ],
    [favorites, recentUse],
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
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== "k") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLTextAreaElement) {
        return;
      }
      if (target instanceof HTMLInputElement && target !== inputRef.current) {
        return;
      }
      event.preventDefault();
      setActiveSchool(null);
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
    if (!query.trim()) {
      setActiveSchool(null);
    }
  }, [query]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setFolderHits([]);
      setFolderBusy(false);
      void haltUserFolderFind();
      return;
    }
    let cancelled = false;
    setFolderBusy(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await findUserFolderNames(needle, false, USER_FOLDER_HOME_LIMIT);
          if (!cancelled) {
            setFolderHits(found);
          }
        } catch {
          if (!cancelled) {
            setFolderHits([]);
          }
        } finally {
          if (!cancelled) {
            setFolderBusy(false);
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      void haltUserFolderFind();
    };
  }, [query]);

  const activate = (item: ResultItem | undefined) => {
    if (!item) {
      return;
    }
    if (item.kind === "school") {
      setActiveSchool(item.school);
      return;
    }
    if (item.kind === "topic" || item.kind === "recent-topic") {
      onAction({ type: "topic", topicId: item.topicId, search: query });
      return;
    }
    if (item.kind === "pc-file") {
      onAction({ type: "launch", tool: userFolderAsTool(item.hit) });
      return;
    }
    if (item.kind === "trouble") {
      onAction({ type: "troubleshoot-card", cardId: item.cardId, search: query });
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
  const hideEmpty = settings.hideEmptySearchGroups;
  const folderReady = query.trim().length >= 2;
  const showTools = !hideEmpty || results.tools.length > 0;
  const showRecents = !hideEmpty || recentUseMatched.length > 0;
  const showFolders = !hideEmpty || !folderReady || folderBusy || folderHits.length > 0;
  const showSchools = !hideEmpty || results.schools.length > 0;
  const showTroubles = !hideEmpty || troubleHits.length > 0;
  const showTopics = !hideEmpty || topicHits.length > 0;
  const anySearchGroup =
    showTools || showRecents || showFolders || showSchools || showTroubles || showTopics;

  const prior = isPriorSkin(settings.panelSkin);
  const cardColumns = homeFavoriteColumns(settings.panelWidth);
  const linkClass = prior
    ? "rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
    : "inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";
  const homeJump = searching || activeSchool ? (
    <HomeJumpButton
      onClick={() => {
        setQuery("");
        setActiveSchool(null);
      }}
    />
  ) : null;

  return (
    <div className={prior ? "flex h-full min-h-0 flex-col bg-paper" : "mx-auto flex h-full min-h-0 w-full max-w-[600px] flex-col bg-paper"}>
      {prior ? (
        <header className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-ink shadow-[0_0_0_3px] shadow-ink-soft" />
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-ink">{APP_CONFIG.appName}</p>
              <h1 className="text-[15px] font-semibold text-desk">{APP_CONFIG.displayName}</h1>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {homeJump}
            <span className="mr-1 text-xs text-quiet">{todayLabel()}</span>
            <button type="button" className="icon-btn" onClick={() => onAction({ type: "settings" })} aria-label="설정">
              <Settings className="h-4 w-4" />
            </button>
            <button type="button" className="icon-btn" onClick={() => onAction({ type: "edit" })} aria-label="도구 추가">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </header>
      ) : (
        <AppHeader dateLabel={todayLabel()} extra={homeJump} onSettings={() => onAction({ type: "settings" })} onAdd={() => onAction({ type: "edit" })} />
      )}
      {prior || searching || activeSchool ? null : <WelcomeMessage />}
      {prior ? (
        <SearchBar ref={inputRef} value={query} onChange={setQuery} onKeyDown={onKeyDown} placeholder="학교·업무·도구·이 PC 폴더·PC 문제" />
      ) : (
        <GlobalSearch ref={inputRef} value={query} onChange={setQuery} onKeyDown={onKeyDown} />
      )}

      <div className={prior ? "mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3" : "mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-7 pb-3"}>
        {activeSchool ? (
          <SchoolSearchResult
            school={activeSchool}
            query={query}
            onOpenInternal={(id, title) => onAction({ type: "internal", id, title })}
          />
        ) : null}

        {!searching && !activeSchool ? (
          <>
            <NoticeList
              variant={prior ? "rows" : "card"}
              onAll={() => onAction({ type: "notices" })}
              onAdd={() => onAction({ type: "notice-item" })}
              onOpen={(item) => onAction({ type: "notice-item", item })}
            />
            <section className={prior ? "zone-block bg-zone-tools" : undefined}>
              {prior ? <h2 className="desk-label">자주 사용하는 도구</h2> : <SectionHeader title="자주 사용하는 도구" />}
              <div className={prior ? "space-y-3" : "space-y-4"}>
                {favoriteGroups.map((group) => (
                  <div key={group.type}>
                    <div className="mb-1.5 flex items-center gap-1">
                      <h3 className={prior ? "min-w-0 flex-1 text-[13px] font-medium text-desk" : "min-w-0 flex-1 text-[12px] font-medium text-quiet"}>{group.label}</h3>
                      {group.type === "url" ? (
                        <button
                          type="button"
                          className={linkClass}
                          onClick={() => onAction({ type: "pc-urls" })}
                        >
                          인터넷 즐겨찾기
                        </button>
                      ) : null}
                      {group.type === "internal" ? (
                        <>
                          <button
                            type="button"
                            className={linkClass}
                            onClick={() => onAction({ type: "shortcuts" })}
                          >
                            단축키
                          </button>
                          <button
                            type="button"
                            className={linkClass}
                            onClick={() => onAction({ type: "topics" })}
                          >
                            업무자료
                          </button>
                          <button
                            type="button"
                            className={linkClass}
                            onClick={() => onAction({ type: "handbook" })}
                          >
                            편람 분류
                          </button>
                          <button
                            type="button"
                            className={linkClass}
                            onClick={() => onAction({ type: "computer-tools" })}
                          >
                            컴퓨터도구
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className={linkClass}
                        onClick={() => onAction({ type: "group", groupType: group.type })}
                      >
                        모두
                      </button>
                      <button
                        type="button"
                        className={prior ? "icon-btn p-1" : "inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"}
                        onClick={() => onAction({ type: "edit", createType: group.type })}
                        aria-label={`${group.label} 추가`}
                        title={`${group.label} 추가`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {prior ? (
                      <FavoriteGrid
                        tools={group.shown}
                        layout="list"
                        columns={homeListColumns(settings.panelWidth)}
                        emptyText={favoriteEmptyText(group.type)}
                        selectedId={selectedId?.startsWith("fav:") ? selectedId.slice(4) : undefined}
                        onLaunch={(tool) => onAction({ type: "launch", tool })}
                        onFavorite={(tool) => void toggleFavorite(tool.id)}
                        onEdit={(tool) => onAction({ type: "edit", tool })}
                        onDelete={(tool) => onAction({ type: "remove", tool })}
                      />
                    ) : (
                      <LauncherGrid
                        tools={group.shown}
                        columns={cardColumns}
                        emptyText={favoriteEmptyText(group.type)}
                        selectedId={selectedId?.startsWith("fav:") ? selectedId.slice(4) : undefined}
                        onLaunch={(tool) => onAction({ type: "launch", tool })}
                        onFavorite={(tool) => void toggleFavorite(tool.id)}
                        onEdit={(tool) => onAction({ type: "edit", tool })}
                        onDelete={(tool) => onAction({ type: "remove", tool })}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
            <TodoList />
            <section className="zone-block bg-zone-recent">
              <h2 className="desk-label">최근 사용</h2>
              <RecentTools
                items={recentUse}
                selectedId={
                  selectedId?.startsWith("idle-recent-topic:")
                    ? selectedId.slice("idle-recent-topic:".length)
                    : selectedId?.startsWith("idle-recent:")
                      ? selectedId.slice("idle-recent:".length)
                      : undefined
                }
                onLaunch={(tool) => onAction({ type: "launch", tool })}
                onOpenTopic={(topicId) => onAction({ type: "topic", topicId, search: query })}
              />
            </section>
          </>
        ) : null}

        {searching && !activeSchool ? (
          <>
            {showTools ? (
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
                    <span className="shrink-0 text-[11px] text-quiet">
                      {toolGroupLabel(hit.item.type)}
                    </span>
                  </button>
                );
              })}
            </ResultGroup>
            ) : null}
            {showRecents ? (
            <section className="zone-block bg-zone-recent">
              <h2 className="desk-label">최근 사용</h2>
              <RecentTools
                items={recentUseMatched}
                query={query}
                selectedId={
                  selectedId?.startsWith("recent-topic:")
                    ? selectedId.slice("recent-topic:".length)
                    : selectedId?.startsWith("recent:")
                      ? selectedId.slice("recent:".length)
                      : undefined
                }
                onLaunch={(tool) => onAction({ type: "launch", tool })}
                onOpenTopic={(topicId) => onAction({ type: "topic", topicId, search: query })}
              />
            </section>
            ) : null}
            {showFolders ? (
            <section>
              <div className="mb-1.5 flex items-center gap-1">
                <h2 className="min-w-0 flex-1 desk-label">이 PC 폴더</h2>
                {query.trim().length >= 2 ? (
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    onClick={() => onAction({ type: "pc-folders", query: query.trim() })}
                  >
                    더 보기
                  </button>
                ) : null}
              </div>
              {query.trim().length < 2 ? (
                <p className="text-sm text-quiet">두 글자 이상이면 바탕화면·문서·다운로드에서 이름을 찾습니다.</p>
              ) : folderBusy && folderHits.length === 0 ? (
                <p className="text-sm text-quiet">찾는 중...</p>
              ) : folderHits.length === 0 ? (
                <p className="text-sm text-quiet">이름이 일치하는 항목이 없습니다.</p>
              ) : (
                <div className="space-y-1">
                  {folderHits.map((hit) => (
                    <button
                      key={hit.path}
                      type="button"
                      title={hit.path}
                      onClick={() => onAction({ type: "launch", tool: userFolderAsTool(hit) })}
                      className={`desk-row ${
                        selectedId === `pc-file:${hit.path}` ? "desk-row-active" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <HighlightText text={hit.name} query={query} />
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-quiet">
                        {hit.zone} · {hit.kind === "folder" ? "폴더" : "파일"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            ) : null}
            {showSchools ? (
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
            ) : null}
            {showTroubles ? (
            <section>
              <div className="mb-1.5 flex items-center gap-1">
                <h2 className="min-w-0 flex-1 desk-label">PC 문제 해결</h2>
                {troubleHits.length > 0 ? (
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    onClick={() => onAction({ type: "troubleshoot", search: query })}
                  >
                    더 보기
                  </button>
                ) : null}
              </div>
              {troubleHits.length === 0 ? (
                <p className="text-sm text-quiet">일치하는 PC 문제가 없습니다.</p>
              ) : (
                <div className="space-y-1">
                  {troubleHits.slice(0, HOME_TROUBLE_LIMIT).map((hit) => (
                    <button
                      key={hit.item.id}
                      type="button"
                      onClick={() => onAction({ type: "troubleshoot-card", cardId: hit.item.id, search: query })}
                      className={`desk-row ${
                        selectedId === `trouble:${hit.item.id}` ? "desk-row-active" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <HighlightText text={hit.item.title} query={query} />
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-quiet">
                        {TROUBLE_CATEGORY_LABEL[hit.item.category]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            ) : null}
            {showTopics ? (
            <ResultGroup title="관련 업무" empty="일치하는 업무가 없습니다.">
              {topicHits.length > 0 ? (
                <>
                  <WorkMapPreview
                    query={query}
                    hitIds={topicHits.map((hit) => hit.item.id)}
                    onOpen={(topicId) => onAction({ type: "topic", topicId, search: query })}
                  />
                  <TopicSearch
                    items={topicHits}
                    selectedId={selectedId?.startsWith("topic:") ? selectedId.slice("topic:".length) : undefined}
                    query={query}
                    onOpen={(topicId) => onAction({ type: "topic", topicId, search: query })}
                  />
                </>
              ) : null}
            </ResultGroup>
            ) : null}
            {hideEmpty && !anySearchGroup ? (
              <p className="text-sm text-quiet">일치하는 항목이 없습니다.</p>
            ) : null}
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
