import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MemoField } from "../components/MemoField";
import { useSettingsStore } from "../stores/settingsStore";
import { asMemoHeight, asMemoWidth } from "../types/settings";

function clipMemo(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 2000);
}

const fieldClass =
  "h-full min-h-0 w-full resize-none rounded-xl border border-line bg-card px-3 py-2 text-sm text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft";

function HomeMemoWindow() {
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
        // 브라우저 미리보기에는 이 명령이 없다.
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
                // 브라우저 미리보기에는 창 API가 없다.
              }
            })();
          }, 400);
        });
      } catch {
        // 브라우저 미리보기에는 창 API가 없다.
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
    <MemoShell title="메모">
      <MemoField
        value={text}
        onEdit={setText}
        onCommit={(next) => {
          const clipped = clipMemo(next);
          setText(clipped);
          void invoke("set_memo_draft", { text: clipped, source: "memo-pad" }).catch(() => {
            // 브라우저 미리보기에는 이 명령이 없다.
          });
        }}
        className={fieldClass}
      />
    </MemoShell>
  );
}

function ExtraMemoWindow({ noteId }: { noteId: string }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("메모");
  const textRef = useRef("");

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    let alive = true;
    void invoke<{ text?: string; title?: string }>("memo_note_text", { id: noteId })
      .then((value) => {
        if (!alive || !value) {
          return;
        }
        if (typeof value.text === "string") {
          setText(clipMemo(value.text));
        }
        if (typeof value.title === "string" && value.title.startsWith("메모")) {
          setTitle(value.title);
        }
      })
      .catch(() => {
        // 브라우저 미리보기에는 이 명령이 없다.
      });
    return () => {
      alive = false;
    };
  }, [noteId]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    const report = (pad: ReturnType<typeof getCurrentWindow>) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void (async () => {
          if (cancelled) {
            return;
          }
          try {
            const pos = await pad.outerPosition();
            const size = await pad.innerSize();
            const scale = await pad.scaleFactor();
            await invoke("place_memo_note", {
              id: noteId,
              x: pos.x / scale,
              y: pos.y / scale,
              width: size.width / scale,
              height: size.height / scale,
            });
          } catch {
            // 브라우저 미리보기에는 창 API가 없다.
          }
        })();
      }, 400);
    };
    const wire = async () => {
      try {
        const pad = getCurrentWindow();
        unlistenResize = await pad.onResized(() => report(pad));
        unlistenMove = await pad.onMoved(() => report(pad));
        unlistenClose = await pad.onCloseRequested(async (event) => {
          event.preventDefault();
          if (cancelled) {
            return;
          }
          cancelled = true;
          try {
            await invoke("update_memo_note", { id: noteId, text: textRef.current });
            const pos = await pad.outerPosition();
            const size = await pad.innerSize();
            const scale = await pad.scaleFactor();
            await invoke("place_memo_note", {
              id: noteId,
              x: pos.x / scale,
              y: pos.y / scale,
              width: size.width / scale,
              height: size.height / scale,
            });
          } catch {
            // 브라우저 미리보기에는 창 API가 없다.
          }
          await invoke("dismiss_memo_note", { id: noteId }).catch(() => {
            // 닫기 명령이 없으면 그대로 둔다.
          });
        });
      } catch {
        // 브라우저 미리보기에는 창 API가 없다.
      }
    };
    void wire();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unlistenResize?.();
      unlistenMove?.();
      unlistenClose?.();
    };
  }, [noteId]);

  return (
    <MemoShell title={title}>
      <MemoField
        value={text}
        onEdit={(next) => {
          const clipped = clipMemo(next);
          textRef.current = clipped;
          setText(clipped);
        }}
        onCommit={(next) => {
          const clipped = clipMemo(next);
          textRef.current = clipped;
          setText(clipped);
          void invoke("update_memo_note", { id: noteId, text: clipped }).catch(() => {
            // 브라우저 미리보기에는 이 명령이 없다.
          });
        }}
        className={fieldClass}
      />
    </MemoShell>
  );
}

function MemoShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{title}</h1>
      </header>
      <p className="px-3 pb-1 text-[11px] text-quiet">
        제목 줄로 옮기고, 모서리로 크기를 바꿉니다. 바꾼 크기는 이 PC에 남습니다. 제목 줄 X로 닫습니다.
      </p>
      <div className="min-h-0 flex-1 p-3">{children}</div>
    </div>
  );
}

export function MemoWindowPage({ noteId }: { noteId: string | null }) {
  if (noteId) {
    return <ExtraMemoWindow noteId={noteId} />;
  }
  return <HomeMemoWindow />;
}
