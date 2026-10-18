import { CalendarRange, Compass, Globe, Keyboard, Plus, Printer, Settings, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FavoriteGrid } from "../components/FavoriteGrid";
import { HighlightText } from "../components/HighlightText";
import { AppHeader } from "../components/home/AppHeader";
import { HomeJumpRow } from "../components/home/HomeJumpRow";
import { GlobalSearch } from "../components/home/GlobalSearch";
import { SectionHeader } from "../components/home/SectionHeader";
import { NoticeList } from "../components/NoticeList";
import { RecentTools } from "../components/RecentTools";
import { SchoolSearchResult } from "../components/SchoolSearchResult";
import { HomeJumpButton } from "../components/HomeJumpButton";
import { SearchBar } from "../components/SearchBar";
import { TodoList } from "../components/TodoList";
import { ToolGlyph } from "../components/ToolGlyph";
import { APP_CONFIG } from "../config/app";
import { computerToolAsItem, isLinkCheckTarget, isPrintCheckTarget, isPrivacyTarget, isSecurityCheckTarget, listComputerTools, sameLocalPath } from "../data/computerTools";
import { canRunShortcut, listShortcuts, type ShortcutEntry } from "../data/shortcuts";
import { HOME_GROUP_PREVIEW, TOOL_GROUPS, favoriteEmptyText, toolGroupLabel } from "../data/toolGroups";
import { setSearchFocusHandler } from "../services/focusBus";
import { launchQuickUrl, openListed, openListedFolder } from "../services/launcherService";
import { manualIndexUnavailable, manualTopicUrl, searchManualIndex, type ManualIndexTopic } from "../services/manualIndexService";
import { freshQueries, matchingQueries, rememberQuery, type KeptQuery } from "../services/keptSearch";
import { latinLookup, searchForms } from "../services/keyLine";
import { loadKeptSearches, saveKeptSearches } from "../services/storageService";
import { searchAll, searchTopics, scoreText, type TopicSearchHit } from "../services/searchService";
import {
  HOME_TROUBLE_LIMIT,
  searchTroubleCards,
  type TroubleSearchHit,
} from "../services/troubleshootingService";
import { TROUBLE_CATEGORY_LABEL } from "../types/troubleshooting";
import { getTopicById, getTopics } from "../services/topicService";
import { isPilotTopicId, pilotHitsForQuery, usePilotManualStore } from "../services/pilotManual";
import { TopicSearch } from "../components/TopicSearch";
import { WorkMapPreview } from "../components/WorkMapPreview";
import {
  findUserFolderNames,
  haltUserFolderFind,
  USER_FOLDER_HOME_LIMIT,
  type UserFolderHit,
} from "../services/userFolderSearch";
import {
  DOC_SEARCH_HOME_LIMIT,
  queryDocuments,
  type DocHit,
} from "../services/documentSearchService";
import { clearSearchGrants, hidePanel, runShortcutAction } from "../services/windowService";
import { useRecentTopicStore } from "../stores/recentTopicStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToolStore } from "../stores/toolStore";
import { isLockedScanTool, useAdminToolStore } from "../stores/adminToolStore";
import { allListColumns, homeListColumns, isPriorSkin } from "../types/settings";
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
  | { type: "docs"; query?: string }
  | { type: "topics" }
  | { type: "handbook" }
  | { type: "pc-link"; search?: string }
  | { type: "pc-print"; search?: string }
  | { type: "pc-security"; search?: string }
  | { type: "privacy-scan"; search?: string }
  | { type: "work-handover"; search?: string }
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
  | { kind: "doc"; id: string; hit: DocHit }
  | { kind: "trouble"; id: string; cardId: string }
  | { kind: "manual"; id: string; topic: ManualIndexTopic }
  | { kind: "shortcut"; id: string; entry: ShortcutEntry };

function groupDotColor(type: ToolType): string | null {
  if (type === "app") {
    return "var(--hue-5-fg)";
  }
  if (type === "file" || type === "folder") {
    return "var(--hue-4-fg)";
  }
  return null;
}

function HomeDot({ color }: { color: string | null }) {
  if (!color) {
    return null;
  }
  return <span className="home-dot" style={{ background: color }} aria-hidden="true" />;
}

function todayLabel(): string {
  const now = new Date();
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][now.getDay()] ?? "";
  return `${now.getMonth() + 1}월${now.getDate()}일(${weekday})`;
}

function isSeparateComputerTarget(target: string): boolean {
  return isLinkCheckTarget(target) || isPrintCheckTarget(target) || isSecurityCheckTarget(target) || isPrivacyTarget(target);
}

function sameListedTool(left: ToolItem, right: ToolItem): boolean {
  if (left.type === "internal" || right.type === "internal") {
    return left.type === right.type && (left.target || left.id) === (right.target || right.id);
  }
  return Boolean(left.target) && Boolean(right.target) && sameLocalPath(left.target, right.target);
}

function catalogComputerTools(): ToolItem[] {
  return listComputerTools()
    .map((entry) => computerToolAsItem(entry))
    .filter((item) => !isSeparateComputerTarget(item.target || item.id));
}

function matchingShortcuts(query: string): ShortcutEntry[] {
  const needle = query.trim();
  if (!needle) {
    return [];
  }
  const rows = listShortcuts();
  const named = rows
    .map((entry) => ({ entry, score: scoreText(needle, entry.name) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name, "ko"));
  const keyed =
    named.length > 0
      ? []
      : rows
          .map((entry) => ({ entry, score: scoreText(needle, entry.keys) }))
          .filter((hit) => hit.score > 0)
          .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name, "ko"));
  return (named.length > 0 ? named : keyed).map((hit) => hit.entry);
}

function flattenResults(
  topicHits: TopicSearchHit[],
  pilotHits: Array<{ id: string }>,
  visibleTools: ToolItem[],
  shortcutHits: ShortcutEntry[],
  recentUse: RecentUseItem[],
  folderHits: UserFolderHit[],
  docHits: DocHit[],
  troubleHits: TroubleSearchHit[],
  manualHits: ManualIndexTopic[],
): ResultItem[] {
  const topics: ResultItem[] = [
    ...topicHits.map((hit) => ({
      kind: "topic" as const,
      id: `topic:${hit.item.id}`,
      topicId: hit.item.id,
    })),
    ...pilotHits.map((hit) => ({
      kind: "topic" as const,
      id: `topic:${hit.id}`,
      topicId: hit.id,
    })),
  ];
  const tools: ResultItem[] = visibleTools.map((tool) => ({
    kind: "tool",
    id: `tool:${tool.id}`,
    tool,
  }));
  const shortcuts: ResultItem[] = shortcutHits.map((entry) => ({
    kind: "shortcut" as const,
    id: `shortcut:${entry.id}`,
    entry,
  }));
  const recents: ResultItem[] = recentUse
    .filter((item) =>
      item.kind === "tool"
        ? !visibleTools.some((tool) => tool.id === item.tool.id)
        : !topicHits.some((hit) => hit.item.id === item.topic.id),
    )
    .map((item) =>
      item.kind === "tool"
        ? { kind: "recent" as const, id: `recent:${item.tool.id}`, tool: item.tool }
        : { kind: "recent-topic" as const, id: `recent-topic:${item.topic.id}`, topicId: item.topic.id },
    );
  const folders: ResultItem[] = folderHits.map((hit) => ({
    kind: "pc-file" as const,
    id: `pc-file:${hit.launchId}`,
    hit,
  }));
  const docs: ResultItem[] = docHits.map((hit) => ({
    kind: "doc" as const,
    id: `doc:${hit.launchId}`,
    hit,
  }));
  const troubles: ResultItem[] = troubleHits.slice(0, HOME_TROUBLE_LIMIT).map((hit) => ({
    kind: "trouble" as const,
    id: `trouble:${hit.item.id}`,
    cardId: hit.item.id,
  }));
  const manuals: ResultItem[] = manualHits.map((topic) => ({
    kind: "manual" as const,
    id: `manual:${topic.id}`,
    topic,
  }));
  return [...tools, ...shortcuts, ...recents, ...folders, ...docs, ...troubles, ...manuals, ...topics];
}

function KeptSearchList({
  items,
  prior,
  onPick,
}: {
  items: string[];
  prior: boolean;
  onPick: (text: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className={prior ? "mx-3 mt-1 space-y-0.5" : "mx-7 mt-1 space-y-0.5"} aria-label="최근 검색어">
      {items.map((text) => (
        <li key={text}>
          <button
            type="button"
            className="w-full rounded-lg border border-line bg-card px-3 py-1 text-left text-xs text-desk"
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(text);
            }}
          >
            {text}
          </button>
        </li>
      ))}
    </ul>
  );
}

function WorkToolMark({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

export function HomePage({ onAction, search = "" }: HomePageProps) {
  const storedTools = useToolStore((state) => state.tools);
  const adminOn = useAdminToolStore((state) => state.enabled);
  const tools = adminOn
    ? storedTools
    : storedTools.filter((tool) => !isLockedScanTool(tool.id, tool.target));
  const toggleFavorite = useToolStore((state) => state.toggleFavorite);
  const settings = useSettingsStore((state) => state.settings);
  const recentTopicItems = useRecentTopicStore((state) => state.items);
  const [query, setQuery] = useState(search);
  const [keptQueries, setKeptQueries] = useState<KeptQuery[]>([]);
  const [folderHits, setFolderHits] = useState<UserFolderHit[]>([]);
  const [folderBusy, setFolderBusy] = useState(false);
  const [docHits, setDocHits] = useState<DocHit[]>([]);
  const [docHint, setDocHint] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [openNote, setOpenNote] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeSchool, setActiveSchool] = useState<SchoolItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keptReady = useRef(false);
  const folderBatch = useRef("");
  const docBatch = useRef("");

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
  const showDropHint = favoriteGroups
    .filter((group) => group.type === "url" || group.type === "app" || group.type === "file" || group.type === "folder")
    .every((group) => group.shown.length === 0);
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
  const results = useMemo(() => searchAll(query, tools, []), [query, tools]);
  const searchTools = useMemo(() => {
    const needle = query.trim();
    const catalog = catalogComputerTools();
    const nameScore = (name: string) => (needle ? scoreText(needle, name) : 0);
    const textScore = (name: string, description?: string) => (needle ? scoreText(needle, name, description) : 0);
    const named = catalog
      .map((item) => ({ item, score: nameScore(item.name) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "ko"));
    const described =
      named.length > 0
        ? []
        : catalog
            .map((item) => ({ item, score: textScore(item.name, item.description) }))
            .filter((hit) => hit.score > 0)
            .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "ko"));
    const picked = (named.length > 0 ? named : described).map((hit) => hit.item);
    const catalogHits = picked;
    const storedHits = results.tools
      .filter((hit) => {
        const target = hit.item.target || hit.item.id;
        if (isSeparateComputerTarget(target)) {
          return false;
        }
        const twin = catalog.find((item) => sameListedTool(item, hit.item));
        if (!twin) {
          return true;
        }
        if (picked.some((item) => sameListedTool(item, hit.item))) {
          return false;
        }
        if (named.length > 0) {
          return nameScore(hit.item.name) > 0;
        }
        return textScore(hit.item.name, hit.item.description) > 0;
      })
      .map((hit) => hit.item);
    return [...catalogHits, ...storedHits];
  }, [query, results.tools]);
  const linkTool = useMemo(() => {
    const entry = listComputerTools().find((item) => item.id === "pc-link");
    return entry ? computerToolAsItem(entry) : null;
  }, []);
  const showLinkCheck = Boolean(
    linkTool &&
      scoreText(query, linkTool.name, linkTool.description, linkTool.category, ...(linkTool.keywords ?? [])) > 0,
  );
  const printTool = useMemo(() => {
    const entry = listComputerTools().find((item) => item.id === "pc-print");
    return entry ? computerToolAsItem(entry) : null;
  }, []);
  const showPrintCheck = Boolean(
    printTool &&
      scoreText(query, printTool.name, printTool.description, printTool.category, ...(printTool.keywords ?? [])) > 0,
  );
  const securityTool = useMemo(() => {
    const entry = listComputerTools().find((item) => item.id === "pc-security");
    return entry ? computerToolAsItem(entry) : null;
  }, []);
  const showSecurityCheck = Boolean(
    securityTool &&
      scoreText(query, securityTool.name, securityTool.description, securityTool.category, ...(securityTool.keywords ?? [])) > 0,
  );
  const privacyTool = useMemo(() => {
    const entry = listComputerTools().find((item) => item.id === "privacy-scan");
    return entry ? computerToolAsItem(entry) : null;
  }, []);
  const handoverWords = ["업무 인수인계", "인수인계", "인계", "업무 넘기기", "업무 카드", "연간 업무", "업무 달력"];
  const showHandover = handoverWords.some((word) => searchForms(query).some((form) => form.includes(word)));
  const keptMatches = useMemo(() => matchingQueries(keptQueries, query), [keptQueries, query]);
  const showPrivacy = Boolean(
    privacyTool &&
      scoreText(query, privacyTool.name, privacyTool.description, privacyTool.category, ...(privacyTool.keywords ?? [])) > 0,
  );
  const topicHits = useMemo(() => searchTopics(query, topicList), [query, topicList]);
  const pilotOn = usePilotManualStore((state) => state.enabled && state.ready);
  const listedTopicHits = useMemo(
    () => (pilotOn ? topicHits.filter((hit) => !isPilotTopicId(hit.item.id)) : topicHits),
    [pilotOn, topicHits],
  );
  const pilotHits = useMemo(
    () => (pilotOn ? pilotHitsForQuery(query, listedTopicHits.map((hit) => hit.item.id)) : []),
    [pilotOn, query, listedTopicHits],
  );
  const manualHits = useMemo(() => searchManualIndex(query), [query]);
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
  const shortcutHits = useMemo(() => matchingShortcuts(query), [query]);
  const flat = useMemo(
    () => flattenResults(listedTopicHits, pilotHits, searchTools, shortcutHits, recentUseMatched, folderHits, docHits, troubleHits, manualHits),
    [listedTopicHits, pilotHits, searchTools, shortcutHits, recentUseMatched, folderHits, docHits, troubleHits, manualHits],
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
    let live = true;
    void loadKeptSearches()
      .then((items) => {
        if (live) {
          keptReady.current = true;
          setKeptQueries(freshQueries(items));
        }
      })
      .catch(() => {
        if (live) {
          setKeptQueries([]);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (!keptReady.current || needle.length < 2) {
      return;
    }
    const timer = window.setTimeout(() => {
      setKeptQueries((current) => {
        const next = rememberQuery(current, needle);
        void saveKeptSearches(next).catch(() => undefined);
        return next;
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [query]);

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
    const needle = latinLookup(query);
    if (needle.length < 2) {
      setFolderHits([]);
      setFolderBusy(false);
      if (folderBatch.current) {
        void clearSearchGrants("user", folderBatch.current);
        folderBatch.current = "";
      }
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
            folderBatch.current = found.batch;
            setFolderHits(found.hits);
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

  useEffect(() => {
    const needle = latinLookup(query);
    if (!needle) {
      setDocHits([]);
      setDocHint("");
      setDocBusy(false);
      if (docBatch.current) {
        void clearSearchGrants("doc", docBatch.current);
        docBatch.current = "";
      }
      return;
    }
    let cancelled = false;
    setDocBusy(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await queryDocuments(needle, DOC_SEARCH_HOME_LIMIT);
          if (!cancelled) {
            docBatch.current = found.batch;
            setDocHits(found.hits);
            setDocHint(found.hint);
          }
        } catch {
          if (!cancelled) {
            setDocHits([]);
            setDocHint("");
          }
        } finally {
          if (!cancelled) {
            setDocBusy(false);
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    return () => {
      if (folderBatch.current) {
        void clearSearchGrants("user", folderBatch.current);
      }
      if (docBatch.current) {
        void clearSearchGrants("doc", docBatch.current);
      }
    };
  }, []);

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
      void openListed(item.hit.launchId).catch((error) => {
        setOpenNote(error instanceof Error ? error.message : "실행할 수 없습니다.");
      });
      return;
    }
    if (item.kind === "doc") {
      void openListed(item.hit.launchId).catch((error) => {
        setOpenNote(error instanceof Error ? error.message : "실행할 수 없습니다.");
      });
      return;
    }
    if (item.kind === "trouble") {
      onAction({ type: "troubleshoot-card", cardId: item.cardId, search: query });
      return;
    }
    if (item.kind === "manual") {
      void launchQuickUrl(manualTopicUrl(item.topic.id));
      return;
    }
    if (item.kind === "shortcut") {
      if (!canRunShortcut(item.entry) || !item.entry.runId) {
        onAction({ type: "shortcuts" });
        return;
      }
      void runShortcutAction(item.entry.runId).catch((error: unknown) => {
        setOpenNote(error instanceof Error ? error.message : "실행하지 못했습니다.");
      });
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
  const showTools = !hideEmpty || searchTools.length > 0 || shortcutHits.length > 0 || showLinkCheck || showPrintCheck || showSecurityCheck || showPrivacy;
  const showRecents = !hideEmpty || recentUseMatched.length > 0;
  const showFolders = !hideEmpty || !folderReady || folderBusy || folderHits.length > 0;
  const showDocs = !hideEmpty || !folderReady || docBusy || docHits.length > 0;
  const showTroubles = !hideEmpty || troubleHits.length > 0;
  const showTopics = !hideEmpty || listedTopicHits.length > 0 || pilotHits.length > 0;
  const showManuals = !hideEmpty || manualHits.length > 0 || Boolean(manualIndexUnavailable());
  const anySearchGroup =
    showTools || showRecents || showFolders || showDocs || showTroubles || showManuals || showTopics;

  const prior = isPriorSkin(settings.panelSkin);
  const linkClass = prior
    ? "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
    : "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium home-link transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";
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
        <div className="home-band">
          <AppHeader dateLabel={todayLabel()} extra={homeJump} onSettings={() => onAction({ type: "settings" })} onAdd={() => onAction({ type: "edit" })} />
          <GlobalSearch ref={inputRef} value={query} onChange={setQuery} onKeyDown={onKeyDown} />
          <KeptSearchList items={keptMatches} prior={false} onPick={setQuery} />
        </div>
      )}
      {prior ? (
        <SearchBar ref={inputRef} value={query} onChange={setQuery} onKeyDown={onKeyDown} placeholder="사이트·업무·파일·폴더·컴퓨터도구·PC 문제" />
      ) : null}
      {prior ? <KeptSearchList items={keptMatches} prior onPick={setQuery} /> : null}
      {prior || searching || activeSchool ? null : (
        <HomeJumpRow
          onShortcuts={() => onAction({ type: "shortcuts" })}
          onComputerTools={() => onAction({ type: "computer-tools" })}
          onGroup={(groupType) => onAction({ type: "group", groupType })}
        />
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
              {prior ? <h2 className="desk-label">자주 사용하는 도구</h2> : <SectionHeader title="자주 사용하는 도구" dot="var(--hue-1-fg)" />}
              {showDropHint ? (
                <p className="text-[12px] leading-5 text-quiet">사이트·프로그램·파일·폴더를 패널에 끌어 놓으면 추가됩니다.</p>
              ) : null}
              <div className={prior ? "space-y-3" : "space-y-4"}>
                {favoriteGroups.map((group) => (
                  <div key={group.type}>
                    <div className="mb-1.5 flex items-start gap-1">
                      <h3 className={prior ? "shrink-0 pt-0.5 text-[13px] font-medium text-desk" : "flex shrink-0 items-center gap-1 pt-2 text-[12px] font-medium text-quiet"}>
                        {prior ? null : <HomeDot color={groupDotColor(group.type)} />}
                        {group.label}
                      </h3>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1">
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
                            <WorkToolMark icon={Keyboard} />
                            단축키
                          </button>
                          <button
                            type="button"
                            className={linkClass}
                            onClick={() => onAction({ type: "topics" })}
                          >
                            <WorkToolMark icon={Compass} />
                            업무자료
                          </button>
                          <button
                            type="button"
                            className={linkClass}
                            onClick={() => onAction({ type: "computer-tools" })}
                          >
                            <WorkToolMark icon={Wrench} />
                            컴퓨터도구
                          </button>
                          <button
                            type="button"
                            className={linkClass}
                            onClick={() => onAction({ type: "work-handover" })}
                          >
                            <WorkToolMark icon={CalendarRange} />
                            업무 인수인계
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
                        className={prior ? "icon-btn p-1" : "home-plus inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"}
                        onClick={() => onAction({ type: "edit", createType: group.type })}
                        aria-label={`${group.label} 추가`}
                        title={`${group.label} 추가`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      </div>
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
                      <FavoriteGrid
                        tools={group.shown}
                        layout="list"
                        columns={allListColumns(settings.panelWidth, settings.listColumns)}
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
              <h2 className="desk-label flex items-center gap-1">
                <HomeDot color="var(--home-dot-recent)" />
                최근 사용
              </h2>
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
              {[showLinkCheck && linkTool ? (
                <div className="desk-row flex-col items-stretch gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Globe className="h-4 w-4 shrink-0 text-quiet" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-desk">
                        <HighlightText text={linkTool.name} query={query} />
                      </span>
                      <span className="block text-[11px] leading-4 text-quiet">{linkTool.description}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white"
                      onClick={() => onAction({ type: "pc-link", search: query })}
                    >
                      점검 시작
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk"
                      onClick={() => onAction({ type: "troubleshoot-card", cardId: "internet-not-working", search: query })}
                    >
                      해결방법 보기
                    </button>
                  </span>
                </div>
              ) : null,
              showPrintCheck && printTool ? (
                <div key="pc-print" className="desk-row flex-col items-stretch gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Printer className="h-4 w-4 shrink-0 text-quiet" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-desk">
                        <HighlightText text={printTool.name} query={query} />
                      </span>
                      <span className="block text-[11px] leading-4 text-quiet">{printTool.description}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white"
                      onClick={() => onAction({ type: "pc-print", search: query })}
                    >
                      점검 시작
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk"
                      onClick={() => onAction({ type: "troubleshoot-card", cardId: "printer-not-printing", search: query })}
                    >
                      해결방법 보기
                    </button>
                  </span>
                </div>
              ) : null,
              showSecurityCheck && securityTool ? (
                <div key="pc-security" className="desk-row flex-col items-stretch gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-quiet" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-desk">
                        <HighlightText text={securityTool.name} query={query} />
                      </span>
                      <span className="block text-[11px] leading-4 text-quiet">{securityTool.description}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white"
                      onClick={() => onAction({ type: "pc-security", search: query })}
                    >
                      점검 화면
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk"
                      onClick={() => onAction({ type: "troubleshoot-card", cardId: "security-general", search: query })}
                    >
                      해결방법 보기
                    </button>
                  </span>
                </div>
              ) : null,
              showHandover ? (
                <button
                  key="work-handover"
                  type="button"
                  onClick={() => onAction({ type: "work-handover", search: query })}
                  className="desk-row gap-2"
                >
                  <CalendarRange className="h-4 w-4 shrink-0 text-quiet" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-desk">업무 인수인계</span>
                    <span className="block text-[11px] leading-4 text-quiet">업무 폴더의 시기와 기한을 이 PC 안에서 정리합니다.</span>
                  </span>
                </button>
              ) : null,
              showPrivacy && privacyTool ? (
                <button
                  key="privacy-scan"
                  type="button"
                  onClick={() => onAction({ type: "privacy-scan", search: query })}
                  className="desk-row gap-2"
                >
                  <ShieldCheck className="h-4 w-4 shrink-0 text-quiet" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-desk">
                      <HighlightText text={privacyTool.name} query={query} />
                    </span>
                    <span className="block text-[11px] leading-4 text-quiet">{privacyTool.description}</span>
                  </span>
                </button>
              ) : null,
              ...searchTools.map((tool) => {
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => onAction({ type: "launch", tool })}
                    className={`desk-row gap-2 ${
                      selectedId === `tool:${tool.id}` ? "desk-row-active" : ""
                    }`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      <ToolGlyph
                        icon={tool.icon}
                        iconImage={tool.iconImage}
                        className="h-4 w-4 text-quiet"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <HighlightText text={tool.name} query={query} />
                    </span>
                    <span className="shrink-0 text-[11px] text-quiet">
                      {tool.id.startsWith("pc-sys:") ? "컴퓨터도구" : toolGroupLabel(tool.type)}
                    </span>
                  </button>
                );
              }),
              ...shortcutHits.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => activate({ kind: "shortcut", id: `shortcut:${entry.id}`, entry })}
                  className={`desk-row gap-2 ${selectedId === `shortcut:${entry.id}` ? "desk-row-active" : ""}`}
                >
                  <Keyboard className="h-4 w-4 shrink-0 text-quiet" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{entry.keys}</span>
                    <span className="text-quiet"> · </span>
                    <HighlightText text={entry.name} query={query} />
                  </span>
                  <span className="shrink-0 text-[11px] text-quiet">단축키</span>
                </button>
              )),
              ].filter((node) => node != null)}
            </ResultGroup>
            ) : null}
            {showRecents ? (
            <section className="zone-block bg-zone-recent">
              <h2 className="desk-label flex items-center gap-1">
                <HomeDot color="var(--home-dot-recent)" />
                최근 사용
              </h2>
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
            {openNote ? <p className="text-sm text-quiet">{openNote}</p> : null}
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
                    <div
                      key={hit.launchId || hit.name}
                      className={`desk-row gap-2 ${
                        selectedId === `pc-file:${hit.launchId}` ? "desk-row-active" : ""
                      }`}
                    >
                      <ToolGlyph
                        icon={hit.kind === "folder" ? "folder" : "file"}
                        className={`h-4 w-4 shrink-0 ${hit.kind === "folder" ? "text-ink" : "text-quiet"}`}
                      />
                      <button
                        type="button"
                        title={hit.place}
                        onClick={() =>
                          void openListed(hit.launchId).catch((error) => {
                            setOpenNote(error instanceof Error ? error.message : "실행할 수 없습니다.");
                          })
                        }
                        className="min-w-0 flex-1 truncate text-left"
                      >
                        <HighlightText text={hit.name} query={query} />
                      </button>
                      <button
                        type="button"
                        title={hit.place}
                        aria-label="폴더 열기"
                        onClick={() =>
                          void openListedFolder(hit.folderId).catch((error) => {
                            setOpenNote(error instanceof Error ? error.message : "실행할 수 없습니다.");
                          })
                        }
                        className="max-w-[46%] shrink-0 truncate text-xs text-quiet"
                      >
                        {hit.place}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            ) : null}
            {showDocs ? (
            <section>
              <div className="mb-1.5 flex items-center gap-1">
                <h2 className="min-w-0 flex-1 desk-label">내 문서</h2>
                {query.trim().length >= 1 ? (
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    onClick={() => onAction({ type: "docs", query: query.trim() })}
                  >
                    더 보기
                  </button>
                ) : null}
              </div>
              {!query.trim() ? (
                <p className="text-sm text-quiet">본문은 세 글자 이상으로 검색할 수 있습니다.</p>
              ) : docBusy && docHits.length === 0 ? (
                <p className="text-sm text-quiet">찾는 중...</p>
              ) : docHits.length === 0 ? (
                <p className="text-sm text-quiet">
                  {docHint || "내용이 일치하는 문서가 없습니다. 설정에서 폴더를 색인하세요."}
                </p>
              ) : (
                <div className="space-y-1">
                  {docHint ? <p className="text-sm text-quiet">{docHint}</p> : null}
                  {docHits.map((hit) => (
                    <div
                      key={hit.launchId || hit.name}
                      className={`rounded-lg px-2 py-2 ${
                        selectedId === `doc:${hit.launchId}` ? "desk-row-active" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          title={hit.place}
                          onClick={() =>
                            void openListed(hit.launchId).catch((error) => {
                              setOpenNote(error instanceof Error ? error.message : "실행할 수 없습니다.");
                            })
                          }
                          className="min-w-0 flex-1 truncate text-left text-sm"
                        >
                          <HighlightText text={hit.name} query={query} />
                        </button>
                        <button
                          type="button"
                          title={hit.place}
                          aria-label="폴더 열기"
                          onClick={() =>
                            void openListedFolder(hit.folderId).catch((error) => {
                              setOpenNote(error instanceof Error ? error.message : "실행할 수 없습니다.");
                            })
                          }
                          className="max-w-[46%] shrink-0 truncate text-xs text-quiet"
                        >
                          {hit.place}
                        </button>
                      </div>
                      {hit.note ? (
                        <p className="mt-0.5 text-xs leading-5 text-quiet">{hit.note}</p>
                      ) : hit.snippet ? (
                        <p className="mt-0.5 text-xs leading-5 text-quiet">
                          <HighlightText text={hit.snippet} query={query} />
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
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
            {searching && showManuals ? (
            <ResultGroup title="교육행정 매뉴얼" empty="일치하는 매뉴얼이 없습니다.">
              {manualHits.length > 0 ? (
                <div className="space-y-1">
                  {manualHits.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      onClick={() => void launchQuickUrl(manualTopicUrl(topic.id))}
                      className={`desk-row ${selectedId === `manual:${topic.id}` ? "desk-row-active" : ""}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          <HighlightText text={topic.title} query={query} />
                        </span>
                        {topic.line ? <span className="block truncate text-xs text-quiet">{topic.line}</span> : null}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-quiet">웹에서 보기</span>
                    </button>
                  ))}
                </div>
              ) : manualIndexUnavailable() ? (
                <p className="text-sm text-quiet">{manualIndexUnavailable()}</p>
              ) : null}
            </ResultGroup>
            ) : null}
            {showTopics ? (
            <ResultGroup title="관련 업무" empty="일치하는 업무가 없습니다.">
              {topicHits.length > 0 ? (
                <WorkMapPreview
                  query={query}
                  hitIds={topicHits.map((hit) => hit.item.id)}
                  onOpen={(topicId) => onAction({ type: "topic", topicId, search: query })}
                />
              ) : null}
              {listedTopicHits.length > 0 ? (
                <TopicSearch
                  items={listedTopicHits}
                  selectedId={selectedId?.startsWith("topic:") ? selectedId.slice("topic:".length) : undefined}
                  query={query}
                  onOpen={(topicId) => onAction({ type: "topic", topicId, search: query })}
                />
              ) : null}
              {pilotHits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  className={`card-surface w-full p-3 text-left ${selectedId === `topic:${hit.id}` ? "ring-1 ring-ink/20" : ""}`}
                  onClick={() => onAction({ type: "topic", topicId: hit.id, search: query })}
                >
                  <p className="text-[11px] text-quiet">{hit.category} · 개발용 시범</p>
                  <h3 className="mt-1 text-sm font-semibold text-desk">
                    <HighlightText text={hit.title} query={query} />
                  </h3>
                  <p className="mt-2 text-[11px] font-medium text-ink">업무 자세히 보기</p>
                </button>
              ))}
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
