import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { DropZone } from "./components/DropZone";
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
import { MemoPage } from "./pages/MemoPage";
import { NetworkToolPage } from "./pages/NetworkToolPage";
import { NoticeAllPage } from "./pages/NoticeAllPage";
import { NoticeItemPage } from "./pages/NoticeItemPage";
import { NoticePackPage } from "./pages/NoticePackPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ComputerToolPage } from "./pages/ComputerToolPage";
import { PcFolderFindPage } from "./pages/PcFolderFindPage";
import { ThisPcAddressPage } from "./pages/ThisPcAddressPage";
import { UrlMarkPage } from "./pages/UrlMarkPage";
import { PcUrlListPage } from "./pages/PcUrlListPage";
import { ToolEditPage } from "./pages/ToolEditPage";
import { ToolGroupPage } from "./pages/ToolGroupPage";
import { TopicDetailPage } from "./pages/TopicDetailPage";
import { TopicListPage } from "./pages/TopicListPage";
import { TopicReviewPage } from "./pages/TopicReviewPage";
import { DeskMiniPage } from "./pages/DeskMiniPage";
import { WorkMapWindowPage } from "./pages/WorkMapWindowPage";
import { isFolderFindTarget } from "./data/computerTools";
import { logEducationValidation } from "./services/mindMapService";
import { LaunchError, launchTool } from "./services/launcherService";
import { applyNoticePackFromPath, applyPackFromText } from "./services/applyNoticePack";
import { addDroppedPaths, addDroppedSite, readUrlShortcut } from "./services/dropSiteService";
import { focusSearchInput } from "./services/focusBus";
import { showPanel, setDeskMiniVisible } from "./services/windowService";
import { initStorage, emitTodosChanged } from "./services/storageService";
import { hydrateSettings, useSettingsStore } from "./stores/settingsStore";
import { hydrateMemo } from "./stores/memoStore";
import { hydrateNotices, useNoticeStore } from "./stores/noticeStore";
import { hydrateRecentTopics, useRecentTopicStore } from "./stores/recentTopicStore";
import { hydrateTodos, useTodoStore } from "./stores/todoStore";
import { hydrateTools, useToolStore } from "./stores/toolStore";
import type { NoticeItem, NoticePack } from "./types/notice";
import type { ToolItem, ToolType } from "./types/tool";

type View =
  | { name: "home"; search?: string }
  | { name: "settings" }
  | { name: "notice-edit" }
  | { name: "notices" }
  | { name: "notice-item"; item?: NoticeItem; backTo?: View }
  | { name: "tool-group"; groupType: ToolType }
  | { name: "pc-urls" }
  | { name: "computer-tools" }
  | { name: "topics"; search?: string }
  | { name: "topic-review" }
  | { name: "topic"; topicId: string; backTo: View }
  | { name: "pc-address" }
  | { name: "pc-folder-find"; query?: string; backTo?: View }
  | { name: "tool-edit"; tool?: ToolItem; createType?: ToolType; backTo?: View }
  | { name: "memo" }
  | { name: "internal"; id: string; title: string };

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

export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ name: "home" });
  const [missing, setMissing] = useState<MissingState | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ToolItem | null>(null);
  const [removeNotice, setRemoveNotice] = useState<NoticeItem | null>(null);
  const [packPick, setPackPick] = useState<NoticePack | null>(null);
  const [notice, setNotice] = useState("");
  const onboarded = useSettingsStore((state) => state.settings.onboarded);
  const mapWindow = currentWindowLabel() === "work-map";
  const deskMini = currentWindowLabel() === "desk-mini";

  const toast = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const applyPackPath = useCallback(
    async (path: string) => {
      try {
        const result = await applyNoticePackFromPath(path);
        if (result.mode === "notice-pick") {
          setPackPick(result.pack);
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
          setPackPick(result.pack);
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

  const addLocalPaths = useCallback(
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

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const bootstrap = async () => {
      if (mapWindow) {
        if (!cancelled) {
          setReady(true);
        }
        return;
      }
      if (deskMini) {
        if (!cancelled) {
          setReady(true);
        }
        return;
      }
      let openMini = false;
      try {
        await initStorage();
        const settings = await hydrateSettings();
        await hydrateTools();
        await hydrateTodos();
        await hydrateMemo();
        await hydrateNotices();
        await hydrateRecentTopics();
        logEducationValidation();
        if (cancelled) {
          return;
        }
        if (settings.showWindowOnLaunch || !settings.onboarded) {
          await showPanel();
        }
        openMini = settings.showDeskMini;
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }

      const listeners = [
        await listen("desk-mini-ready", () => {
          void emitTodosChanged(useTodoStore.getState().todos);
        }),
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
      ];
      if (cancelled) {
        listeners.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...listeners);
      if (openMini) {
        void setDeskMiniVisible(true).catch(() => {
          // Command is unavailable in browser preview.
        });
      }
      try {
        if (currentWindowLabel() === "main") {
          const pending = await invoke<string[]>("take_startup_pack_paths");
          for (const path of pending) {
            void applyPackPath(path);
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
    if (action.type === "pc-folders") {
      setView({ name: "pc-folder-find", query: action.query, backTo: { name: "home" } });
      return;
    }
    if (action.type === "topics") {
      setView({ name: "topics" });
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

  if (deskMini) {
    return <DeskMiniPage />;
  }

  return (
    <DropZone
      onPackFile={applyPackPath}
      onPackText={applyPackText}
      onSiteUrl={addSiteUrl}
      onUrlShortcut={addUrlShortcut}
      onLocalPaths={addLocalPaths}
    >
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          {view.name === "home" ? <HomePage onAction={handleAction} search={view.search} /> : null}
          {view.name === "settings" ? (
            <SettingsPage
              onBack={() => setView({ name: "home" })}
              onWriteNotices={() => setView({ name: "notice-edit" })}
              onTopicReview={() => setView({ name: "topic-review" })}
              onNoticePack={(pack) => {
                setPackPick(pack);
                setView({ name: "home" });
              }}
            />
          ) : null}
          {view.name === "notice-edit" ? (
            <NoticePackPage onBack={() => setView({ name: "settings" })} />
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
          {view.name === "tool-edit" ? (
            <ToolEditPage
              tool={view.tool}
              createType={view.createType}
              onBack={() => setView(view.backTo ?? { name: "home" })}
            />
          ) : null}
          {view.name === "memo" ? <MemoPage onBack={() => setView({ name: "home" })} /> : null}
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
            <UrlMarkPage title={view.title} onBack={() => setView({ name: "home" })} />
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
          !isFolderFindTarget(view.id) ? (
            <InternalPlaceholderPage
              title={view.title}
              onBack={() => setView({ name: "home" })}
            />
          ) : null}
        </div>
        {view.name === "home" ? <MemoPad onOpen={() => setView({ name: "memo" })} /> : null}
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
            pack={packPick}
            onClose={() => setPackPick(null)}
            onAdded={(count) => {
              setPackPick(null);
              toast(count > 0 ? `공지 ${count}건을 넣었습니다.` : "넣을 항목이 없습니다.");
            }}
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
