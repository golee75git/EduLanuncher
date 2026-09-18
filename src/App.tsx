import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { DropZone } from "./components/DropZone";
import { MemoPad } from "./components/MemoPad";
import { MissingPathDialog } from "./components/MissingPathDialog";
import { WelcomeOverlay } from "./components/WelcomeOverlay";
import { HomePage, type HomeAction } from "./pages/HomePage";
import { CctvToolPage } from "./pages/CctvToolPage";
import { InternalPlaceholderPage } from "./pages/InternalPlaceholderPage";
import { MemoPage } from "./pages/MemoPage";
import { NetworkToolPage } from "./pages/NetworkToolPage";
import { NoticePackPage } from "./pages/NoticePackPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PcUrlListPage } from "./pages/PcUrlListPage";
import { ToolEditPage } from "./pages/ToolEditPage";
import { ToolGroupPage } from "./pages/ToolGroupPage";
import { LaunchError, launchTool } from "./services/launcherService";
import { applyNoticePackFromPath, applyPackFromText } from "./services/applyNoticePack";
import { addDroppedPaths, addDroppedSite, readUrlShortcut } from "./services/dropSiteService";
import { focusSearchInput } from "./services/focusBus";
import { showPanel } from "./services/windowService";
import { initStorage } from "./services/storageService";
import { hydrateSettings, useSettingsStore } from "./stores/settingsStore";
import { hydrateMemo } from "./stores/memoStore";
import { hydrateNotices } from "./stores/noticeStore";
import { hydrateTodos, useTodoStore } from "./stores/todoStore";
import { hydrateTools, useToolStore } from "./stores/toolStore";
import type { ToolItem, ToolType } from "./types/tool";

type View =
  | { name: "home" }
  | { name: "settings" }
  | { name: "notice-edit" }
  | { name: "tool-group"; groupType: ToolType }
  | { name: "pc-urls" }
  | { name: "tool-edit"; tool?: ToolItem; createType?: ToolType; backTo?: View }
  | { name: "memo" }
  | { name: "internal"; id: string; title: string };

interface MissingState {
  message: string;
  tool?: ToolItem;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ name: "home" });
  const [missing, setMissing] = useState<MissingState | null>(null);
  const [notice, setNotice] = useState("");
  const onboarded = useSettingsStore((state) => state.settings.onboarded);

  const toast = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const applyPackPath = useCallback(
    async (path: string) => {
      try {
        toast(await applyNoticePackFromPath(path));
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
        toast(await applyPackFromText(contents));
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
      try {
        await initStorage();
        const settings = await hydrateSettings();
        await hydrateTools();
        await hydrateTodos();
        await hydrateMemo();
        await hydrateNotices();
        if (cancelled) {
          return;
        }
        if (settings.showWindowOnLaunch || !settings.onboarded) {
          await showPanel();
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
        await listen<string>("apply-notice-pack", (event) => {
          void applyPackPath(event.payload);
        }),
      ];
      if (cancelled) {
        listeners.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...listeners);
      try {
        const pending = await invoke<string[]>("take_startup_pack_paths");
        for (const path of pending) {
          void applyPackPath(path);
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
      if (view.name !== "home") {
        setView({ name: "home" });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [missing, view.name]);

  const handleLaunch = async (tool: ToolItem) => {
    try {
      if (tool.type === "internal") {
        setView({ name: "internal", id: tool.target || tool.id, title: tool.name });
        try {
          await launchTool(tool);
        } catch {
          // 내부 화면은 이미 열었으므로 사용 기록 저장 실패는 무시합니다.
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
          {view.name === "home" ? <HomePage onAction={handleAction} /> : null}
          {view.name === "settings" ? (
            <SettingsPage
              onBack={() => setView({ name: "home" })}
              onWriteNotices={() => setView({ name: "notice-edit" })}
            />
          ) : null}
          {view.name === "notice-edit" ? (
            <NoticePackPage onBack={() => setView({ name: "settings" })} />
          ) : null}
          {view.name === "tool-group" ? (
            <ToolGroupPage
              groupType={view.groupType}
              onBack={() => setView({ name: "home" })}
              onLaunch={(tool) => void handleLaunch(tool)}
              onPcUrls={() => setView({ name: "pc-urls" })}
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
          {view.name === "tool-edit" ? (
            <ToolEditPage
              tool={view.tool}
              createType={view.createType}
              onBack={() => setView(view.backTo ?? { name: "home" })}
            />
          ) : null}
          {view.name === "memo" ? <MemoPage onBack={() => setView({ name: "home" })} /> : null}
          {view.name === "internal" && (view.id === "network" || view.id === "tool-network") ? (
            <NetworkToolPage title={view.title} onBack={() => setView({ name: "home" })} />
          ) : null}
          {view.name === "internal" && (view.id === "cctv" || view.id === "tool-cctv") ? (
            <CctvToolPage title={view.title} onBack={() => setView({ name: "home" })} />
          ) : null}
          {view.name === "internal" &&
          view.id !== "network" &&
          view.id !== "tool-network" &&
          view.id !== "cctv" &&
          view.id !== "tool-cctv" ? (
            <InternalPlaceholderPage
              title={view.title}
              onBack={() => setView({ name: "home" })}
            />
          ) : null}
        </div>
        {view.name === "home" ? <MemoPad onOpen={() => setView({ name: "memo" })} /> : null}
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
                void useToolStore.getState().removeTool(missing.tool.id);
              }
              setMissing(null);
            }}
            onClose={() => setMissing(null)}
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
