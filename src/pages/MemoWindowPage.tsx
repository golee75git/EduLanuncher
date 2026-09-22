import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { asMemoHeight, asMemoWidth } from "../types/settings";

function clipMemo(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 2000);
}

export function MemoWindowPage() {
  const [text, setText] = useState("");

  useEffect(() => {
    let alive = true;
    void invoke<string>("memo_draft")
      .then((value) => {
        if (alive && typeof value === "string") {
          setText(clipMemo(value));
        }
      })
      .catch(() => {
        // Command is unavailable in browser preview.
      });
    const unlisten = listen<string>("memo-draft", (event) => {
      if (typeof event.payload === "string") {
        setText(clipMemo(event.payload));
      }
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let unlisten: (() => void) | undefined;
    const wire = async () => {
      try {
        const pad = getCurrentWindow();
        if (pad.label !== "memo-pad") {
          return;
        }
        unlisten = await pad.onResized(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            void (async () => {
              if (cancelled) {
                return;
              }
              try {
                const size = await pad.innerSize();
                const scale = await pad.scaleFactor();
                const width = asMemoWidth(Math.round(size.width / scale));
                const height = asMemoHeight(Math.round(size.height / scale));
                const current = useSettingsStore.getState().settings;
                if (current.memoWidth === width && current.memoHeight === height) {
                  return;
                }
                await useSettingsStore.getState().update({ memoWidth: width, memoHeight: height });
                await invoke("set_memo_window_size", { width, height });
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
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">메모</h1>
      </header>
      <p className="px-3 pb-1 text-[11px] text-quiet">
        제목 줄로 옮기고, 모서리로 크기를 바꿉니다. 바꾼 크기는 이 PC에 남습니다. 제목 줄 X로 닫습니다.
      </p>
      <div className="min-h-0 flex-1 p-3">
        <textarea
          value={text}
          maxLength={2000}
          placeholder="이 PC에만 저장됩니다"
          onChange={(event) => {
            const next = clipMemo(event.target.value);
            setText(next);
            void invoke("set_memo_draft", { text: next }).catch(() => {
              // Command is unavailable in browser preview.
            });
          }}
          className="h-full min-h-0 w-full resize-none rounded-xl border border-line bg-card px-3 py-2 text-sm text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft"
        />
      </div>
    </div>
  );
}
