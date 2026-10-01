import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { DropActionPick } from "./components/DropActionPick";
import { DropZone } from "./components/DropZone";
import { StatusBar } from "./components/home/StatusBar";
import { MemoPad } from "./components/MemoPad";
import { MissingPathDialog } from "./components/MissingPathDialog";
import { NoticePackPick } from "./components/NoticePackPick";
import { RemoveNoticeDialog } from "./components/RemoveNoticeDialog";
import { RemoveToolDialog } from "./components/RemoveToolDialog";
import { HomeJumpButton } from "./components/HomeJumpButton";
import { WelcomeOverlay } from "./components/WelcomeOverlay";
import { HomePage, type HomeAction } from "./pages/HomePage";
import { CctvToolPage } from "./pages/CctvToolPage";
import { InternalPlaceholderPage } from "./pages/InternalPlaceholderPage";
import { NetworkToolPage } from "./pages/NetworkToolPage";
import { NoticeAllPage } from "./pages/NoticeAllPage";
import { NoticeItemPage } from "./pages/NoticeItemPage";
import { NoticePackPage } from "./pages/NoticePackPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SharePackSavePage } from "./pages/SharePackSavePage";
import { ComputerToolPage } from "./pages/ComputerToolPage";
import { TroubleshootDetailPage } from "./pages/TroubleshootDetailPage";
import { TroubleshootListPage } from "./pages/TroubleshootListPage";
import { ShortcutPage } from "./pages/ShortcutPage";
import { DocSearchPage } from "./pages/DocSearchPage";
import { PcFolderFindPage } from "./pages/PcFolderFindPage";
import { ThisPcAddressPage } from "./pages/ThisPcAddressPage";
import { UrlMarkPage } from "./pages/UrlMarkPage";
import { PrivacyMaskPage } from "./pages/PrivacyMaskPage";
import { DocShrinkPage } from "./pages/DocShrinkPage";
import { PdfToolPage } from "./pages/PdfToolPage";
import { PcUrlListPage } from "./pages/PcUrlListPage";
import { ToolEditPage } from "./pages/ToolEditPage";
import { ToolGroupPage } from "./pages/ToolGroupPage";
import { HandbookCategoryListPage, HandbookCategoryPage, HandbookTopicPage } from "./pages/HandbookFlowPages";
import { TopicDetailPage } from "./pages/TopicDetailPage";
import { TopicListPage } from "./pages/TopicListPage";
import { TopicReviewPage } from "./pages/TopicReviewPage";
import { WorkMapWindowPage } from "./pages/WorkMapWindowPage";
import { MemoWindowPage } from "./pages/MemoWindowPage";
import { isDocShrinkTarget, isFolderFindTarget } from "./data/computerTools";
import { isPdfPagesTarget } from "./data/sampleTools";
import { logEducationValidation } from "./services/mindMapService";
import { logTroubleshootingValidation } from "./services/troubleshootingService";
import { LaunchError, launchQuickUrl, launchTool } from "./services/launcherService";
import { findNewerRelease } from "./services/releaseCheckService";
import { APP_CONFIG } from "./config/app";
import { applyNoticePackFromPath, applyPackFromText } from "./services/applyNoticePack";
import { splitDropActions } from "./services/dropActionPick";
import { addDroppedPaths, addDroppedSite, previewDroppedPaths, readUrlShortcut } from "./services/dropSiteService";
import { focusSearchInput } from "./services/focusBus";
import { dismissMemoNote, hidePanel, openMemoNote, showPanel } from "./services/windowService";
import { initStorage } from "./services/storageService";
import { refreshManualIndex } from "./services/manualIndexService";
import { refreshManualPack } from "./services/manualPackService";
import { hydrateSettings, useSettingsStore } from "./stores/settingsStore";
import { isPriorSkin } from "./types/settings";
import { asPanelHeight, asPanelWidth } from "./types/settings";
import { hydrateMemo, useMemoStore } from "./stores/memoStore";
import { readMemoNoteId } from "./types/memo";
import { hydrateNotices, useNoticeStore } from "./stores/noticeStore";
import { hydrateRecentTopics, useRecentTopicStore } from "./stores/recentTopicStore";
import { hydrateTodos, useTodoStore } from "./stores/todoStore";
import { hydrateTools, useToolStore } from "./stores/toolStore";
import type { NoticeItem, NoticePack } from "./types/notice";
import type { LauncherPack } from "./data/educationPack";
import type { ToolItem, ToolType } from "./types/tool";

type View =
  | { name: "home"; search?: string }
  | { name: "settings" }
  | { name: "notice-edit" }
  | { name: "share-edit" }
  | { name: "notices" }
  | { name: "notice-item"; item?: NoticeItem; backTo?: View }
  | { name: "tool-group"; groupType: ToolType }
  | { name: "pc-urls" }
  | { name: "computer-tools" }
  | { name: "troubleshoot"; search?: string; backTo?: View }
  | { name: "troubleshoot-card"; cardId: string; backTo: View }
  | { name: "shortcuts" }
  | { name: "topics"; search?: string }
  | { name: "handbook" }
  | { name: "handbook-category"; categoryId: string }
  | { name: "handbook-topic"; topicId: string; stepId?: string; backTo: View }
  | { name: "topic-review" }
  | { name: "topic"; topicId: string; backTo: View }
  | { name: "pc-address" }
  | { name: "pc-folder-find"; query?: string; backTo?: View }
  | { name: "doc-search"; query?: string; backTo?: View }
  | { name: "doc-shrink"; backTo?: View; startPaths?: string[] }
  | { name: "tool-edit"; tool?: ToolItem; createType?: ToolType; backTo?: View }
  | { name: "internal"; id: string; title: string; startPaths?: string[] };

function currentWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

function clipSearch(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120).trim();
  return text || undefined;
}

interface MissingState {
  message: string;
  tool?: ToolItem;
}

interface DropHold {
  pictures: string[];
  pdfs: string[];
  places: { path: string; name: string; place: string }[];
  site: { url: string; name?: string; iconImage?: string } | null;
  urlFile: string | null;
  packPath: string | null;
  packText: string | null;
}

function blankDropHold(): DropHold {
  return {
    pictures: [],
    pdfs: [],
    places: [],
    site: null,
    urlFile: null,
    packPath: null,
    packText: null,
  };
}

function dropHoldOpen(hold: DropHold): boolean {
  return (
    hold.pictures.length > 0 ||
    hold.pdfs.length > 0 ||
    hold.places.length > 0 ||
    hold.site !== null ||
    hold.urlFile !== null ||
    hold.packPath !== null ||
    hold.packText !== null
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ name: "home" });
  const [missing, setMissing] = useState<MissingState | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ToolItem | null>(null);
  const [removeNotice, setRemoveNotice] = useState<NoticeItem | null>(null);
  const [packPick, setPackPick] = useState<{ pack: NoticePack; sitePack?: LauncherPack } | null>(null);
  const [notice, setNotice] = useState("");
  const [dropPick, setDropPick] = useState<DropHold | null>(null);
  const [releaseNotice, setReleaseNotice] = useState<string | null>(null);
  const onboarded = useSettingsStore((state) => state.settings.onboarded);
  const priorSkin = useSettingsStore((state) => isPriorSkin(state.settings.panelSkin));
  const windowLabel = currentWindowLabel();
  const mapWindow = windowLabel === "work-map";
  const memoNoteId = readMemoNoteId(windowLabel);
  const memoWindow = windowLabel === "memo-pad" || memoNoteId !== null;

  const toast = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const applyPackPath = useCallback(
    async (path: string) => {
      try {
        const result = await applyNoticePackFromPath(path);
        if (result.mode === "notice-pick") {
          setPackPick({ pack: result.pack, sitePack: result.sitePack });
        } else {
          toast(result.message);
        }
        setView({ name: "home" });
        await showPanel();
      } catch (error) {
        toast(error instanceof Error ? error.message : "Pack을 적용하지 못했습니다.");
        await showPanel();
      }
    },
    [toast],
  );

  const applyPackText = useCallback(
    async (contents: string) => {
      try {
        const result = await applyPackFromText(contents);
        if (result.mode === "notice-pick") {
          setPackPick({ pack: result.pack, sitePack: result.sitePack });
        } else {
          toast(result.message);
        }
        setView({ name: "home" });
        await showPanel();
      } catch (error) {
        toast(error instanceof Error ? error.message : "Pack을 적용하지 못했습니다.");
        await showPanel();
      }
    },
    [toast],
  );

  const addSiteUrl = useCallback(
    async (url: string, name?: string, iconImage?: string) => {
      try {
        const result = await addDroppedSite(url, name, iconImage);
        if (result === "updated") {
          toast("바로가기 이름을 페이지 제목으로 바꿨습니다.");
        } else {
          toast(result === "added" ? "사이트 바로가기를 넣었습니다." : "이미 있는 주소입니다.");
        }
        setView({ name: "home" });
        await showPanel();
      } catch (error) {
        toast(error instanceof Error ? error.message : "주소를 넣지 못했습니다.");
        await showPanel();
      }
    },
    [toast],
  );

  const addUrlShortcut = useCallback(
    async (path: string) => {
      try {
        const shortcut = await readUrlShortcut(path);
        await addSiteUrl(shortcut.url, shortcut.name, shortcut.iconImage);
      } catch (error) {
        toast(error instanceof Error ? error.message : "바로가기를 읽지 못했습니다.");
        await showPanel();
      }
    },
    [addSiteUrl, toast],
  );

  const saveDroppedShortcuts = useCallback(
    async (paths: string[]) => {
      try {
        const result = await addDroppedPaths(paths);
        const parts: string[] = [];
        if (result.added === 1) {
          parts.push("바로가기를 넣었습니다.");
        } else if (result.added > 1) {
          parts.push(`바로가기 ${result.added}개를 넣었습니다.`);
        }
        if (result.exists) {
          parts.push(
            result.added ? `${result.exists}개는 이미 있습니다.` : "이미 있는 경로입니다.",
          );
        }
        if (result.missing && !result.added) {
          parts.push("파일을 찾을 수 없습니다.");
        }
        if (result.skipped) {
          parts.push("한 번에 10개까지 넣습니다.");
        }
        toast(parts.join(" ") || "바로가기를 넣지 못했습니다.");
        setView({ name: "home" });
        await showPanel();
      } catch (error) {
        toast(error instanceof Error ? error.message : "바로가기를 넣지 못했습니다.");
        await showPanel();
      }
    },
    [toast],
  );

  const revealDropHold = useCallback(async () => {
    setView({ name: "home" });
    await showPanel();
  }, []);

  const addLocalPaths = useCallback(
    async (paths: string[]) => {
      const split = splitDropActions(paths);
      let places: DropHold["places"] = [];
      if (split.rest.length > 0) {
        try {
          places = await previewDroppedPaths(split.rest);
        } catch (error) {
          toast(error instanceof Error ? error.message : "넣을 곳을 확인하지 못했습니다.");
          await showPanel();
          return;
        }
      }
      setDropPick((current) => {
        const next: DropHold = {
          ...(current ?? blankDropHold()),
          pictures: split.pictures,
          pdfs: split.pdfs,
          places,
        };
        return dropHoldOpen(next) ? next : null;
      });
      await revealDropHold();
    },
    [revealDropHold, toast],
  );

  const queuePackPath = useCallback(
    (path: string) => {
      setDropPick((current) => ({ ...(current ?? blankDropHold()), packPath: path }));
      void revealDropHold();
    },
    [revealDropHold],
  );

  const queuePackText = useCallback(
    (contents: string) => {
      setDropPick((current) => ({ ...(current ?? blankDropHold()), packText: contents }));
      void revealDropHold();
    },
    [revealDropHold],
  );

  const queueSite = useCallback(
    (url: string, name?: string, iconImage?: string) => {
      setDropPick((current) => ({ ...(current ?? blankDropHold()), site: { url, name, iconImage } }));
      void revealDropHold();
    },
    [revealDropHold],
  );

  const queueUrlFile = useCallback(
    (path: string) => {
      setDropPick((current) => ({ ...(current ?? blankDropHold()), urlFile: path }));
      void revealDropHold();
    },
    [revealDropHold],
  );

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const bootstrap = async () => {
      if (mapWindow || memoWindow) {
        if (mapWindow) {
          await refreshManualPack();
        }
        if (!cancelled) {
          setReady(true);
        }
        return;
      }
      try {
        await initStorage();
        await refreshManualPack();
        await refreshManualIndex();
        const settings = await hydrateSettings();
        await hydrateTools();
        await hydrateTodos();
        await hydrateMemo();
        await hydrateNotices();
        await hydrateRecentTopics();
        try {
          await invoke("set_memo_draft", { text: useMemoStore.getState().text, source: "main" });
        } catch {
          // Command is unavailable in browser preview.
        }
        logEducationValidation();
        logTroubleshootingValidation();
        if (cancelled) {
          return;
        }
        void findNewerRelease().then((tag) => {
          if (!cancelled && tag) {
            setReleaseNotice(tag);
          }
        });
        if (settings.showWindowOnLaunch || !settings.onboarded) {
          await showPanel();
        } else {
          await hidePanel();
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }

      const listeners = [
        await listen("focus-search", () => {
          setView({ name: "home" });
          window.setTimeout(() => focusSearchInput(), 30);
        }),
        await listen("open-settings", () => {
          setView({ name: "settings" });
          void showPanel();
        }),
        await listen<string>("launch-tool-id", (event) => {
          const tool = useToolStore.getState().getById(event.payload);
          if (tool) {
            void handleLaunch(tool);
          }
        }),
        await listen<string>("open-topic", (event) => {
          const topicId = event.payload;
          if (!topicId) {
            return;
          }
          void useRecentTopicStore.getState().markUsed(topicId);
          setView({ name: "topic", topicId, backTo: { name: "home" } });
        }),
        await listen<string>("apply-notice-pack", (event) => {
          void applyPackPath(event.payload);
        }),
        await listen<string>("apply-url-shortcut", (event) => {
          void addUrlShortcut(event.payload);
        }),
        await listen<string>("memo-draft", (event) => {
          if (typeof event.payload !== "string") {
            return;
          }
          const next = event.payload;
          const store = useMemoStore.getState();
          if (store.text === next) {
            return;
          }
          store.setText(next);
          void store.persist();
        }),
        await listen<{ id?: string; text?: string }>("memo-note-changed", (event) => {
          const id = event.payload?.id;
          const text = event.payload?.text;
          if (typeof id !== "string" || typeof text !== "string") {
            return;
          }
          if (useMemoStore.getState().updateNote(id, { text })) {
            void useMemoStore.getState().persist();
          }
        }),
        await listen<{ id?: string; x?: number; y?: number; width?: number; height?: number }>(
          "memo-note-placed",
          (event) => {
            const payload = event.payload;
            if (!payload || typeof payload.id !== "string") {
              return;
            }
            if (
              typeof payload.x !== "number" ||
              typeof payload.y !== "number" ||
              typeof payload.width !== "number" ||
              typeof payload.height !== "number"
            ) {
              return;
            }
            if (
              useMemoStore.getState().updateNote(payload.id, {
                x: payload.x,
                y: payload.y,
                width: payload.width,
                height: payload.height,
              })
            ) {
              void useMemoStore.getState().persist();
            }
          },
        ),
        await listen("memo-add-request", () => {
          const note = useMemoStore.getState().addNote();
          if (!note) {
            return;
          }
          const index = useMemoStore.getState().notes.findIndex((item) => item.id === note.id);
          void (async () => {
            await useMemoStore.getState().persist();
            await openMemoNote(note, Math.max(0, index)).catch(() => {
              // 브라우저 미리보기에는 이 명령이 없다.
            });
          })();
        }),
        await listen<string>("memo-remove-request", (event) => {
          if (typeof event.payload !== "string" || !event.payload) {
            return;
          }
          useMemoStore.getState().removeNote(event.payload);
          void (async () => {
            await useMemoStore.getState().persist();
            await dismissMemoNote(event.payload);
          })();
        }),
      ];
      if (cancelled) {
        listeners.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...listeners);
      try {
        if (windowLabel === "main") {
          const pending = await invoke<string[]>("take_startup_pack_paths");
          for (const path of pending) {
            void applyPackPath(path);
          }
          const pendingUrls = await invoke<string[]>("take_startup_url_paths");
          for (const path of pendingUrls) {
            void addUrlShortcut(path);
          }
        }
      } catch {
        // Command is unavailable in browser preview.
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (mapWindow || memoWindow) {
      return;
    }
    let cancelled = false;
    let timer = 0;
    let unlisten: (() => void) | undefined;
    const wire = async () => {
      try {
        const panel = getCurrentWindow();
        if (panel.label !== "main") {
          return;
        }
        unlisten = await panel.onResized(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            void (async () => {
              if (cancelled) {
                return;
              }
              try {
                const size = await panel.innerSize();
                const scale = await panel.scaleFactor();
                const width = asPanelWidth(Math.round(size.width / scale));
                const height = asPanelHeight(Math.round(size.height / scale));
                const current = useSettingsStore.getState().settings;
                if (current.panelWidth === width && current.panelHeight === height) {
                  return;
                }
                await useSettingsStore.getState().update({ panelWidth: width, panelHeight: height });
              } catch {
                // Window API unavailable in browser preview.
              }
            })();
          }, 400);
        });
      } catch {
        // Window API unavailable in browser preview.
      }
    };
    void wire();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unlisten?.();
    };
  }, [mapWindow, memoWindow]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (missing) {
        setMissing(null);
        return;
      }
      if (view.name === "topic") {
        setView(view.backTo);
        return;
      }
      if (view.name !== "home") {
        setView({ name: "home" });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [missing, view]);

  const handleLaunch = async (tool: ToolItem) => {
    try {
      if (tool.type === "internal" && isFolderFindTarget(tool.target || tool.id)) {
        setView({ name: "pc-folder-find", backTo: { name: "home" } });
        return;
      }
      if (tool.type === "internal") {
        const result = await launchTool(tool);
        if (result === "internal") {
          setView({ name: "internal", id: tool.target || tool.id, title: tool.name });
        }
        return;
      }
      const result = await launchTool(tool);
      if (result === "internal") {
        setView({ name: "internal", id: tool.target || tool.id, title: tool.name });
      }
    } catch (error) {
      if (error instanceof LaunchError) {
        setMissing({ message: error.message, tool: error.tool });
        return;
      }
      setMissing({
        message: error instanceof Error ? error.message : "실행 중 오류가 발생했습니다.",
        tool,
      });
    }
  };

  const openTopic = (topicId: string, backTo: View) => {
    void useRecentTopicStore.getState().markUsed(topicId);
    setView({ name: "topic", topicId, backTo });
  };

  const handleAction = (action: HomeAction) => {
    if (action.type === "launch") {
      void handleLaunch(action.tool);
      return;
    }
    if (action.type === "edit") {
      setView({ name: "tool-edit", tool: action.tool, createType: action.createType });
      return;
    }
    if (action.type === "group") {
      setView({ name: "tool-group", groupType: action.groupType });
      return;
    }
    if (action.type === "pc-urls") {
      setView({ name: "pc-urls" });
      return;
    }
    if (action.type === "computer-tools") {
      setView({ name: "computer-tools" });
      return;
    }
    if (action.type === "troubleshoot") {
      setView({
        name: "troubleshoot",
        search: clipSearch(action.search),
        backTo: { name: "home", search: clipSearch(action.search) },
      });
      return;
    }
    if (action.type === "troubleshoot-card") {
      setView({
        name: "troubleshoot-card",
        cardId: action.cardId,
        backTo: { name: "home", search: clipSearch(action.search) },
      });
      return;
    }
    if (action.type === "shortcuts") {
      setView({ name: "shortcuts" });
      return;
    }
    if (action.type === "pc-folders") {
      setView({ name: "pc-folder-find", query: action.query, backTo: { name: "home" } });
      return;
    }
    if (action.type === "docs") {
      setView({ name: "doc-search", query: action.query, backTo: { name: "home", search: clipSearch(action.query) } });
      return;
    }
    if (action.type === "topics") {
      setView({ name: "topics" });
      return;
    }
    if (action.type === "handbook") {
      setView({ name: "handbook" });
      return;
    }
    if (action.type === "topic") {
      openTopic(action.topicId, { name: "home", search: clipSearch(action.search) });
      return;
    }
    if (action.type === "notices") {
      setView({ name: "notices" });
      return;
    }
    if (action.type === "notice-item") {
      setView({ name: "notice-item", item: action.item, backTo: { name: "home" } });
      return;
    }
    if (action.type === "remove") {
      setRemoveTarget(action.tool);
      return;
    }
    if (action.type === "internal") {
      setView({ name: "internal", id: action.id, title: action.title });
      return;
    }
    setView({ name: "settings" });
  };

  const start = async () => {
    await useToolStore.getState().seedIfEmpty();
    await useTodoStore.getState().seedIfEmpty();
    await useSettingsStore.getState().completeOnboarding();
    window.setTimeout(() => focusSearchInput(), 30);
  };

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-paper text-sm text-quiet">
        불러오는 중...
      </div>
    );
  }

  if (mapWindow) {
    return <WorkMapWindowPage />;
  }

  if (memoWindow) {
    return <MemoWindowPage noteId={memoNoteId} />;
  }

  return (
    <DropZone
      onPackFile={queuePackPath}
      onPackText={queuePackText}
      onSiteUrl={queueSite}
      onUrlShortcut={queueUrlFile}
      onLocalPaths={addLocalPaths}
      onDropUnreadable={(formats) =>
        toast(
          formats.length
            ? `끌어온 항목에서 주소를 읽지 못했습니다. (${formats.slice(0, 6).join(", ")})`
            : "끌어온 항목에서 주소를 읽지 못했습니다.",
        )
      }
    >
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          {view.name === "home" ? <HomePage onAction={handleAction} search={view.search} /> : null}
          {view.name === "settings" ? (
            <SettingsPage
              onBack={() => setView({ name: "home" })}
              onWriteNotices={() => setView({ name: "notice-edit" })}
              onWriteSharePack={() => setView({ name: "share-edit" })}
              onTopicReview={() => setView({ name: "topic-review" })}
              onHandbook={() => setView({ name: "handbook" })}
              onNoticePack={(pack, sitePack) => {
                setPackPick({ pack, sitePack });
                setView({ name: "home" });
              }}
            />
          ) : null}
          {view.name === "notice-edit" ? (
            <NoticePackPage onBack={() => setView({ name: "settings" })} />
          ) : null}
          {view.name === "share-edit" ? (
            <SharePackSavePage onBack={() => setView({ name: "settings" })} />
          ) : null}
          {view.name === "notices" ? (
            <NoticeAllPage
              onBack={() => setView({ name: "home" })}
              onAdd={() => setView({ name: "notice-item", backTo: { name: "notices" } })}
              onEdit={(item) => setView({ name: "notice-item", item, backTo: { name: "notices" } })}
              onRemove={setRemoveNotice}
            />
          ) : null}
          {view.name === "notice-item" ? (
            <NoticeItemPage item={view.item} onBack={() => setView(view.backTo ?? { name: "home" })} />
          ) : null}
          {view.name === "tool-group" ? (
            <ToolGroupPage
              groupType={view.groupType}
              onBack={() => setView({ name: "home" })}
              onLaunch={(tool) => void handleLaunch(tool)}
              onPcUrls={() => setView({ name: "pc-urls" })}
              onComputerTools={() => setView({ name: "computer-tools" })}
              onShortcuts={() => setView({ name: "shortcuts" })}
              onTopics={() => setView({ name: "topics" })}
              onRemove={(tool) => setRemoveTarget(tool)}
              onEdit={(tool, createType) =>
                setView({
                  name: "tool-edit",
                  tool,
                  createType,
                  backTo: { name: "tool-group", groupType: view.groupType },
                })
              }
            />
          ) : null}
          {view.name === "pc-urls" ? <PcUrlListPage onBack={() => setView({ name: "home" })} /> : null}
          {view.name === "computer-tools" ? (
            <ComputerToolPage
              onBack={() => setView({ name: "home" })}
              onLaunch={(tool) => void handleLaunch(tool)}
              onShowAddress={() => setView({ name: "pc-address" })}
              onShowFolderFind={() =>
                setView({ name: "pc-folder-find", backTo: { name: "computer-tools" } })
              }
              onShowDocShrink={() => setView({ name: "doc-shrink", backTo: { name: "computer-tools" } })}
              onShowTroubleshoot={() =>
                setView({ name: "troubleshoot", backTo: { name: "computer-tools" } })
              }
            />
          ) : null}
          {view.name === "troubleshoot" ? (
            <TroubleshootListPage
              search={view.search}
              onBack={() => setView(view.backTo ?? { name: "home" })}
              onOpen={(cardId, search) =>
                setView({
                  name: "troubleshoot-card",
                  cardId,
                  backTo: { name: "troubleshoot", search: clipSearch(search), backTo: view.backTo },
                })
              }
            />
          ) : null}
          {view.name === "troubleshoot-card" ? (
            <TroubleshootDetailPage
              key={view.cardId}
              cardId={view.cardId}
              onBack={() => setView(view.backTo)}
              onList={() =>
                setView(
                  view.backTo.name === "troubleshoot"
                    ? view.backTo
                    : { name: "troubleshoot", backTo: view.backTo },
                )
              }
              onOpenCard={(cardId) => setView({ ...view, cardId })}
            />
          ) : null}
          {view.name === "shortcuts" ? <ShortcutPage onBack={() => setView({ name: "home" })} /> : null}
          {view.name === "handbook" ? (
            <HandbookCategoryListPage
              onBack={() => setView({ name: "home" })}
              onOpenCategory={(categoryId) => setView({ name: "handbook-category", categoryId })}
              onOpenTopic={(topicId) =>
                setView({ name: "handbook-topic", topicId, backTo: { name: "handbook" } })
              }
            />
          ) : null}
          {view.name === "handbook-category" ? (
            <HandbookCategoryPage
              categoryId={view.categoryId}
              onBack={() => setView({ name: "handbook" })}
              onOpenTopic={(topicId, stepId) =>
                setView({
                  name: "handbook-topic",
                  topicId,
                  stepId,
                  backTo: { name: "handbook-category", categoryId: view.categoryId },
                })
              }
            />
          ) : null}
          {view.name === "handbook-topic" ? (
            <HandbookTopicPage
              topicId={view.topicId}
              stepId={view.stepId}
              onBack={() => setView(view.backTo)}
              onOpenTopic={(topicId, stepId) =>
                setView({ name: "handbook-topic", topicId, stepId, backTo: view.backTo })
              }
            />
          ) : null}
          {view.name === "topics" ? (
            <TopicListPage
              search={view.search}
              onBack={() => setView({ name: "home" })}
              onOpen={(topicId, search) =>
                openTopic(topicId, { name: "topics", search: clipSearch(search) })
              }
            />
          ) : null}
          {view.name === "topic-review" ? (
            <TopicReviewPage
              onBack={() => setView({ name: "settings" })}
              onOpen={(topicId) => openTopic(topicId, { name: "topic-review" })}
            />
          ) : null}
          {view.name === "topic" ? (
            <TopicDetailPage
              topicId={view.topicId}
              onBack={() => setView(view.backTo)}
              onOpenRelated={(topicId) => openTopic(topicId, view.backTo)}
            />
          ) : null}
          {view.name === "pc-address" ? (
            <ThisPcAddressPage onBack={() => setView({ name: "computer-tools" })} />
          ) : null}
          {view.name === "pc-folder-find" ? (
            <PcFolderFindPage
              initialQuery={view.query ?? ""}
              onBack={() => setView(view.backTo ?? { name: "home" })}
            />
          ) : null}
          {view.name === "doc-search" ? (
            <DocSearchPage
              initialQuery={view.query ?? ""}
              onBack={() => setView(view.backTo ?? { name: "home" })}
            />
          ) : null}
          {view.name === "doc-shrink" ? (
            <DocShrinkPage
              startPaths={view.startPaths}
              onBack={() => setView(view.backTo ?? { name: "computer-tools" })}
            />
          ) : null}
          {view.name === "tool-edit" ? (
            <ToolEditPage
              tool={view.tool}
              createType={view.createType}
              onBack={() => setView(view.backTo ?? { name: "home" })}
            />
          ) : null}
          {view.name === "internal" && (view.id === "pc-address" || view.id === "pc-sys:pc-address") ? (
            <ThisPcAddressPage title={view.title} onBack={() => setView({ name: "home" })} />
          ) : null}
          {view.name === "internal" && (view.id === "network" || view.id === "tool-network") ? (
            <NetworkToolPage title={view.title} onBack={() => setView({ name: "home" })} />
          ) : null}
          {view.name === "internal" && (view.id === "cctv" || view.id === "tool-cctv") ? (
            <CctvToolPage title={view.title} onBack={() => setView({ name: "home" })} />
          ) : null}
          {view.name === "internal" && (view.id === "url-mark" || view.id === "tool-url-mark") ? (
            <UrlMarkPage
              title={view.title}
              startPath={view.startPaths?.[0]}
              onBack={() => setView({ name: "home" })}
            />
          ) : null}
          {view.name === "internal" && (view.id === "privacy-mask" || view.id === "tool-privacy-mask") ? (
            <PrivacyMaskPage
              title={view.title}
              startPath={view.startPaths?.[0]}
              onBack={() => setView({ name: "home" })}
            />
          ) : null}
          {view.name === "internal" && isDocShrinkTarget(view.id) ? (
            <DocShrinkPage startPaths={view.startPaths} onBack={() => setView({ name: "home" })} />
          ) : null}
          {view.name === "internal" && isPdfPagesTarget(view.id) ? (
            <PdfToolPage startPaths={view.startPaths} onBack={() => setView({ name: "home" })} />
          ) : null}
          {view.name === "internal" && isFolderFindTarget(view.id) ? (
            <PcFolderFindPage onBack={() => setView({ name: "home" })} />
          ) : null}
          {view.name === "internal" &&
          view.id !== "network" &&
          view.id !== "tool-network" &&
          view.id !== "cctv" &&
          view.id !== "tool-cctv" &&
          view.id !== "pc-address" &&
          view.id !== "pc-sys:pc-address" &&
          view.id !== "ie-reset" &&
          view.id !== "pc-sys:ie-reset" &&
          view.id !== "url-mark" &&
          view.id !== "tool-url-mark" &&
          view.id !== "privacy-mask" &&
          view.id !== "tool-privacy-mask" &&
          !isDocShrinkTarget(view.id) &&
          !isPdfPagesTarget(view.id) &&
          !isFolderFindTarget(view.id) ? (
            <InternalPlaceholderPage
              title={view.title}
              onBack={() => setView({ name: "home" })}
            />
          ) : null}
        </div>
        {view.name === "home" ? (
          <>
            <MemoPad />
            {priorSkin ? null : <StatusBar />}
          </>
        ) : null}
        {view.name !== "home" ? (
          <div className="absolute bottom-3 right-3 z-40 flex items-center gap-1">
            {view.name === "topic" ? (
              <HomeJumpButton label="이전화면" onClick={() => setView(view.backTo)} />
            ) : null}
            <HomeJumpButton
              onClick={() => {
                setMissing(null);
                setRemoveTarget(null);
                setRemoveNotice(null);
                setPackPick(null);
                setView({ name: "home" });
              }}
            />
          </div>
        ) : null}
        {!onboarded ? <WelcomeOverlay onStart={() => void start()} /> : null}
        {missing ? (
          <MissingPathDialog
            message={missing.message}
            tool={missing.tool}
            onRetarget={() => {
              const tool = missing.tool;
              setMissing(null);
              setView({ name: "tool-edit", tool });
            }}
            onDelete={() => {
              if (missing.tool) {
                setRemoveTarget(missing.tool);
              }
              setMissing(null);
            }}
            onClose={() => setMissing(null)}
          />
        ) : null}
        {removeTarget ? (
          <RemoveToolDialog
            tool={removeTarget}
            onConfirm={() => {
              void useToolStore.getState().removeTool(removeTarget.id);
              setRemoveTarget(null);
            }}
            onClose={() => setRemoveTarget(null)}
          />
        ) : null}
        {removeNotice ? (
          <RemoveNoticeDialog
            item={removeNotice}
            onConfirm={() => {
              void useNoticeStore.getState().removeNotice(removeNotice.id);
              setRemoveNotice(null);
            }}
            onClose={() => setRemoveNotice(null)}
          />
        ) : null}
        {packPick ? (
          <NoticePackPick
            pack={packPick.pack}
            sitePack={packPick.sitePack}
            onClose={() => setPackPick(null)}
            onAdded={(message) => {
              setPackPick(null);
              toast(message);
            }}
          />
        ) : null}
        {releaseNotice ? (
          <div className="absolute bottom-12 left-1/2 z-50 w-[min(100%-1.5rem,22rem)] -translate-x-1/2 rounded-lg bg-desk px-3 py-2 text-xs leading-5 text-white">
            <p>
              이 PC 버전 {APP_CONFIG.version} · 새 버전 {releaseNotice}가 있습니다. 소개 사이트에서 받아 이
              프로그램을 교체하세요. 자동으로 설치하지는 않습니다.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <button
                type="button"
                className="rounded-full bg-white/15 px-2 py-0.5 font-medium"
                onClick={() => void launchQuickUrl(APP_CONFIG.siteUrl)}
              >
                설치 안내 열기
              </button>
              <button type="button" className="rounded-full px-2 py-0.5" onClick={() => setReleaseNotice(null)}>
                닫기
              </button>
            </div>
          </div>
        ) : null}
        {dropPick ? (
          <DropActionPick
            pictures={dropPick.pictures}
            pdfs={dropPick.pdfs}
            places={dropPick.places}
            siteLabel={[
              dropPick.site ? dropPick.site.name || dropPick.site.url : "",
              dropPick.urlFile ? dropPick.urlFile.split(/[/\\]/).pop() || "사이트" : "",
            ]
              .filter(Boolean)
              .join(", ")}
            packLabel={
              dropPick.packPath
                ? dropPick.packPath.split(/[/\\]/).pop() || "Pack"
                : dropPick.packText
                  ? "Pack"
                  : ""
            }
            onMosaic={() => {
              const path = dropPick.pictures[0];
              if (!path) {
                return;
              }
              setDropPick(null);
              setView({ name: "internal", id: "privacy-mask", title: "사진 모자이크", startPaths: [path] });
            }}
            onShrink={() => {
              const paths = dropPick.pictures;
              setDropPick(null);
              setView({ name: "doc-shrink", backTo: { name: "home" }, startPaths: paths });
            }}
            onQr={() => {
              const path = dropPick.pictures[0];
              if (!path) {
                return;
              }
              setDropPick(null);
              setView({ name: "internal", id: "url-mark", title: "QR코드 넣기", startPaths: [path] });
            }}
            onPdf={() => {
              const paths = dropPick.pdfs;
              setDropPick(null);
              setView({ name: "internal", id: "pdf-pages", title: "PDF 도구", startPaths: paths });
            }}
            onShortcut={() => {
              const paths = [...dropPick.pictures, ...dropPick.pdfs];
              setDropPick((current) => {
                if (!current) {
                  return null;
                }
                const next = { ...current, pictures: [], pdfs: [] };
                return dropHoldOpen(next) ? next : null;
              });
              void saveDroppedShortcuts(paths);
            }}
            onPlaces={() => {
              const paths = dropPick.places.map((line) => line.path);
              setDropPick((current) => {
                if (!current) {
                  return null;
                }
                const next = { ...current, places: [] };
                return dropHoldOpen(next) ? next : null;
              });
              void saveDroppedShortcuts(paths);
            }}
            onSite={() => {
              const site = dropPick.site;
              const urlFile = dropPick.urlFile;
              setDropPick((current) => {
                if (!current) {
                  return null;
                }
                const next = { ...current, site: null, urlFile: null };
                return dropHoldOpen(next) ? next : null;
              });
              void (async () => {
                if (site) {
                  await addSiteUrl(site.url, site.name, site.iconImage);
                }
                if (urlFile) {
                  await addUrlShortcut(urlFile);
                }
              })();
            }}
            onPack={() => {
              const path = dropPick.packPath;
              const text = dropPick.packText;
              setDropPick((current) => {
                if (!current) {
                  return null;
                }
                const next = { ...current, packPath: null, packText: null };
                return dropHoldOpen(next) ? next : null;
              });
              void (async () => {
                if (path) {
                  await applyPackPath(path);
                }
                if (text) {
                  await applyPackText(text);
                }
              })();
            }}
            onClose={() => setDropPick(null)}
          />
        ) : null}
        {notice ? (
          <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-desk px-3 py-2 text-xs text-white">
            {notice}
          </div>
        ) : null}
      </div>
    </DropZone>
  );
}
