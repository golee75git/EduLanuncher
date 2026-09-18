import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { isPackPath } from "../services/applyNoticePack";
import {
  droppedFilePath,
  extractDroppedLocalPaths,
  httpUrlFromDataTransfer,
  isDroppableDrag,
  isUrlShortcutPath,
  normalizeLocalPathKey,
  parseInternetShortcut,
  pickDroppedSiteName,
} from "../services/dropSiteService";

interface DropZoneProps {
  children: ReactNode;
  onPackFile: (path: string) => void;
  onPackText: (contents: string) => void;
  onSiteUrl: (url: string, name?: string) => void;
  onUrlShortcut: (path: string) => void;
  onLocalPaths: (paths: string[]) => void;
}

const recentDrop = new Map<string, number>();

function acceptOnce(key: string): boolean {
  const now = Date.now();
  const previous = recentDrop.get(key) ?? 0;
  if (now - previous < 1200) {
    return false;
  }
  recentDrop.set(key, now);
  return true;
}

function takeLocalPaths(paths: string[]): string[] {
  const unique: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed) {
      continue;
    }
    const key = `local:${normalizeLocalPathKey(trimmed)}`;
    if (!acceptOnce(key)) {
      continue;
    }
    if (unique.some((item) => normalizeLocalPathKey(item) === normalizeLocalPathKey(trimmed))) {
      continue;
    }
    unique.push(trimmed);
  }
  return unique;
}

export function DropZone({
  children,
  onPackFile,
  onPackText,
  onSiteUrl,
  onUrlShortcut,
  onLocalPaths,
}: DropZoneProps) {
  const [active, setActive] = useState(false);
  const callbacks = useRef({ onPackFile, onPackText, onSiteUrl, onUrlShortcut, onLocalPaths });
  callbacks.current = { onPackFile, onPackText, onSiteUrl, onUrlShortcut, onLocalPaths };

  useEffect(() => {
    const applySpecialPath = (path: string): boolean => {
      if (/^https?:\/\//i.test(path)) {
        window.setTimeout(() => {
          callbacks.current.onSiteUrl(path);
        }, 250);
        return true;
      }
      if (isPackPath(path)) {
        if (acceptOnce(`pack:${path}`)) {
          callbacks.current.onPackFile(path);
        }
        return true;
      }
      if (isUrlShortcutPath(path)) {
        window.setTimeout(() => {
          callbacks.current.onUrlShortcut(path);
        }, 250);
        return true;
      }
      return false;
    };

    const emitLocalPaths = (paths: string[]) => {
      const unique = takeLocalPaths(paths);
      if (unique.length) {
        callbacks.current.onLocalPaths(unique);
      }
    };

    const applyNativePaths = (paths: string[]) => {
      const local: string[] = [];
      for (const path of paths) {
        if (!applySpecialPath(path)) {
          local.push(path);
        }
      }
      if (local.length) {
        emitLocalPaths(local);
      }
    };

    const applyHtmlDrop = async (transfer: DataTransfer) => {
      const meta = httpUrlFromDataTransfer(transfer);
      const files = Array.from(transfer.files);
      const localPaths: string[] = [];
      let handled = false;
      for (const file of files) {
        const path = droppedFilePath(file);
        const label = path || file.name;
        if (isPackPath(label)) {
          if (path && isPackPath(path)) {
            applySpecialPath(path);
          } else if (acceptOnce(`pack-text:${file.name}:${file.size}`)) {
            callbacks.current.onPackText(await file.text());
          }
          handled = true;
          continue;
        }
        if (isUrlShortcutPath(label)) {
          if (path && isUrlShortcutPath(path)) {
            callbacks.current.onUrlShortcut(path);
            handled = true;
            continue;
          }
          let url: string | undefined;
          let fileTitle: string | undefined;
          try {
            const parsed = parseInternetShortcut(await file.text(), file.name);
            if (parsed) {
              url = parsed.url;
              fileTitle = parsed.name;
            }
          } catch {
            // Ignore unreadable shortcut files.
          }
          if (url) {
            callbacks.current.onSiteUrl(
              url,
              pickDroppedSiteName(url, meta?.name, fileTitle, file.name),
            );
          }
          handled = true;
          continue;
        }
        if (path) {
          localPaths.push(path);
          handled = true;
        }
      }
      const listed = extractDroppedLocalPaths(
        [
          transfer.getData("text/uri-list"),
          transfer.getData("text/plain"),
          transfer.getData("text/x-moz-url"),
        ].join("\n"),
      );
      for (const listedPath of listed) {
        if (!localPaths.some((item) => normalizeLocalPathKey(item) === normalizeLocalPathKey(listedPath))) {
          localPaths.push(listedPath);
          handled = true;
        }
      }
      if (localPaths.length) {
        emitLocalPaths(localPaths);
        return;
      }
      if (!handled && meta) {
        callbacks.current.onSiteUrl(meta.url, pickDroppedSiteName(meta.url, meta.name));
        return;
      }
      if (handled && meta?.url && meta.name) {
        callbacks.current.onSiteUrl(meta.url, meta.name);
      }
    };

    const onOver = (event: DragEvent) => {
      if (!event.dataTransfer || !isDroppableDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setActive(true);
    };
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) {
        setActive(false);
      }
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setActive(false);
      if (event.dataTransfer) {
        void applyHtmlDrop(event.dataTransfer);
      }
    };

    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);

    let cancelled = false;
    const unlistens: Array<() => void> = [];
    const attachNative = async () => {
      const handle = (event: { payload: DragDropEvent }) => {
        if (cancelled) {
          return;
        }
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setActive(true);
          return;
        }
        setActive(false);
        if (event.payload.type === "drop") {
          applyNativePaths(event.payload.paths);
        }
      };
      try {
        unlistens.push(await getCurrentWindow().onDragDropEvent(handle));
      } catch {
        // Window events unavailable in browser preview.
      }
      try {
        unlistens.push(await getCurrentWebview().onDragDropEvent(handle));
      } catch {
        // Webview events unavailable in browser preview.
      }
      try {
        unlistens.push(await getCurrentWebviewWindow().onDragDropEvent(handle));
      } catch {
        // Webview window events unavailable in browser preview.
      }
    };
    void attachNative();

    const attachOleDrop = async () => {
      try {
        unlistens.push(
          await listen<boolean>("launcher-drop-hover", (event) => {
            if (!cancelled) {
              setActive(event.payload);
            }
          }),
        );
        unlistens.push(
          await listen<{ type: string; paths?: string[]; url?: string; name?: string }>(
            "launcher-drop",
            (event) => {
              if (cancelled) {
                return;
              }
              if (event.payload.type === "url" && event.payload.url) {
                callbacks.current.onSiteUrl(event.payload.url, event.payload.name);
                return;
              }
              if (event.payload.paths?.length) {
                applyNativePaths(event.payload.paths);
              }
            },
          ),
        );
      } catch {
        // Events unavailable in browser preview.
      }
    };
    void attachOleDrop();

    return () => {
      cancelled = true;
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      unlistens.forEach((unlisten) => unlisten());
    };
  }, []);

  return (
    <div
      className={`relative h-full min-h-0 transition-shadow duration-150 ${
        active ? "ring-2 ring-inset ring-ink" : ""
      }`}
    >
      {children}
      {active ? (
        <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center bg-ink-soft/95 px-6 text-center text-sm font-medium text-ink-strong backdrop-blur-[1px]">
          파일·폴더·주소·Pack을 놓으면 바로가기로 넣습니다
        </div>
      ) : null}
    </div>
  );
}
