import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { isPackPath } from "../services/applyNoticePack";
import {
  httpUrlFromDataTransfer,
  isDroppableDrag,
  isUrlShortcutPath,
  parseInternetShortcut,
  pickDroppedSiteName,
  type GrantedFile,
} from "../services/dropSiteService";
import { privacyDropHeld, takePrivacyPicture } from "../services/privacyDropGate";
import { docDropHeld, isDocPicturePath, takeDocPictures } from "../services/docDropGate";
import { isPdfPath, pdfDropHeld, takePdfFiles } from "../services/pdfDropGate";

interface DropZoneProps {
  children: ReactNode;
  onPackFile: (file: GrantedFile) => void;
  onPackText: (contents: string) => void;
  onSiteUrl: (url: string, name?: string, iconImage?: string) => void;
  onUrlShortcut: (file: GrantedFile) => void;
  onLocalPaths: (files: GrantedFile[]) => void;
  onDropUnreadable?: (formats: string[]) => void;
  holdDrops?: boolean;
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

function takeLocalFiles(files: GrantedFile[]): GrantedFile[] {
  const unique: GrantedFile[] = [];
  for (const file of files) {
    if (!file.id || unique.some((item) => item.id === file.id) || !acceptOnce(`local:${file.id}`)) {
      continue;
    }
    unique.push(file);
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
  onDropUnreadable,
  holdDrops = false,
}: DropZoneProps) {
  const [active, setActive] = useState(false);
  const holdRef = useRef(holdDrops);
  holdRef.current = holdDrops;
  const callbacks = useRef({
    onPackFile,
    onPackText,
    onSiteUrl,
    onUrlShortcut,
    onLocalPaths,
    onDropUnreadable,
  });
  callbacks.current = {
    onPackFile,
    onPackText,
    onSiteUrl,
    onUrlShortcut,
    onLocalPaths,
    onDropUnreadable,
  };

  useEffect(() => {
    const applyGranted = (file: GrantedFile): boolean => {
      if (isPackPath(file.name)) {
        if (acceptOnce(`pack:${file.id}`)) {
          callbacks.current.onPackFile(file);
        }
        return true;
      }
      if (isUrlShortcutPath(file.name)) {
        window.setTimeout(() => {
          callbacks.current.onUrlShortcut(file);
        }, 250);
        return true;
      }
      return false;
    };

    const emitLocalFiles = (files: GrantedFile[]) => {
      const unique = takeLocalFiles(files);
      if (unique.length) {
        callbacks.current.onLocalPaths(unique);
      }
    };

    const applyNativeFiles = (files: GrantedFile[]) => {
      let rest = files;
      if (takePdfFiles(rest)) {
        rest = rest.filter((file) => !isPdfPath(file.name));
        if (rest.length === 0) {
          return;
        }
      }
      if (takeDocPictures(rest)) {
        rest = rest.filter((file) => !isDocPicturePath(file.name));
        if (rest.length === 0) {
          return;
        }
      }
      const local: GrantedFile[] = [];
      for (const file of rest) {
        if (takePrivacyPicture(file)) {
          continue;
        }
        if (!applyGranted(file)) {
          local.push(file);
        }
      }
      if (local.length) {
        emitLocalFiles(local);
      }
    };

    const applyHtmlDrop = async (transfer: DataTransfer) => {
      const meta = httpUrlFromDataTransfer(transfer);
      const files = Array.from(transfer.files);
      let handledFile = false;
      for (const file of files) {
        const label = file.name;
        if (isPackPath(label)) {
          if (acceptOnce(`pack-text:${file.name}:${file.size}`)) {
            callbacks.current.onPackText(await file.text());
          }
          handledFile = true;
          continue;
        }
        if (isUrlShortcutPath(label)) {
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
              meta?.iconImage,
            );
          }
          handledFile = true;
        }
      }
      if (meta && !handledFile) {
        callbacks.current.onSiteUrl(
          meta.url,
          pickDroppedSiteName(meta.url, meta.name),
          meta.iconImage,
        );
      }
    };

    const onOver = (event: DragEvent) => {
      if (holdRef.current) {
        event.preventDefault();
        return;
      }
      if (!event.dataTransfer || !isDroppableDrag(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!privacyDropHeld() && !docDropHeld() && !pdfDropHeld()) {
        setActive(true);
      }
    };
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) {
        setActive(false);
      }
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setActive(false);
      if (holdRef.current) {
        return;
      }
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
        if (cancelled || holdRef.current) {
          setActive(false);
          return;
        }
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setActive(true);
          return;
        }
        setActive(false);
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
            if (!cancelled && !holdRef.current) {
              setActive(event.payload);
            }
          }),
        );
        unlistens.push(
          await listen<{
            type: string;
            files?: GrantedFile[];
            url?: string;
            name?: string;
            iconImage?: string;
            formats?: string[];
          }>(
            "launcher-drop",
            (event) => {
              if (cancelled || holdRef.current) {
                return;
              }
              if (event.payload.type === "unreadable") {
                callbacks.current.onDropUnreadable?.(event.payload.formats ?? []);
                return;
              }
              if (event.payload.type === "url" && event.payload.url) {
                callbacks.current.onSiteUrl(
                  event.payload.url,
                  event.payload.name,
                  event.payload.iconImage,
                );
                return;
              }
              if (event.payload.type === "files" && event.payload.files?.length) {
                applyNativeFiles(event.payload.files);
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
