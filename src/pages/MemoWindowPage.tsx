import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { MemoField } from "../components/MemoField";
import { useSettingsStore } from "../stores/settingsStore";
import { EXTRA_MEMO_LIMIT, memoWindowTitle } from "../types/memo";
import { asMemoHeight, asMemoWidth } from "../types/settings";

function clipMemo(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 2000);
}

const fieldClass =
  "h-full min-h-0 w-full resize-none rounded-xl border border-line bg-card px-3 py-2 text-sm text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft";

type BoardNote = { id: string; text: string };

type Board = { text: string; notes: BoardNote[]; selected: string };

function asBoard(value: unknown): Board | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const text = typeof source.text === "string" ? clipMemo(source.text) : "";
  const selected = typeof source.selected === "string" ? source.selected : "";
  const notes: BoardNote[] = [];
  if (Array.isArray(source.notes)) {
    for (const item of source.notes) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      if (!/^[a-z0-9]{4,16}$/.test(id) || notes.some((note) => note.id === id)) {
        continue;
      }
      notes.push({
        id,
        text: typeof row.text === "string" ? clipMemo(row.text) : "",
      });
      if (notes.length >= EXTRA_MEMO_LIMIT) {
        break;
      }
    }
  }
  return {
    text,
    notes,
    selected: notes.some((note) => note.id === selected) ? selected : "",
  };
}

export function MemoWindowPage() {
  const [homeText, setHomeText] = useState("");
  const [notes, setNotes] = useState<BoardNote[]>([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    let alive = true;
    void invoke<unknown>("memo_board")
      .then((value) => {
        const board = asBoard(value);
        if (alive && board) {
          setHomeText(board.text);
          setNotes(board.notes);
          setSelected(board.selected);
        }
      })
      .catch(() => {
        // 브라우저 미리보기에는 이 명령이 없다.
      });
    const unlistenBoard = listen<unknown>("memo-board", (event) => {
      const board = asBoard(event.payload);
      if (!board) {
        return;
      }
      setHomeText(board.text);
      setNotes(board.notes);
      setSelected(board.selected);
    });
    const unlistenDraft = listen<string>("memo-draft", (event) => {
      if (typeof event.payload === "string") {
        setHomeText(clipMemo(event.payload));
      }
    });
    return () => {
      alive = false;
      void unlistenBoard.then((fn) => fn());
      void unlistenDraft.then((fn) => fn());
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

  const active = notes.find((note) => note.id === selected) ?? null;
  const value = active ? active.text : homeText;
  const title = active ? memoWindowTitle(notes.findIndex((note) => note.id === active.id)) : "메모";
  const full = notes.length >= EXTRA_MEMO_LIMIT;

  return (
    <div className="flex h-full min-h-0 bg-paper">
      <aside className="flex w-[108px] shrink-0 flex-col gap-0.5 border-r border-line p-2">
        <button
          type="button"
          className="mb-1 rounded-lg px-2 py-1 text-left text-[12px] font-medium text-ink hover:bg-ink-soft disabled:opacity-40"
          disabled={full}
          title={full ? "메모는 4개까지입니다" : "메모 추가"}
          onClick={() => {
            void invoke("request_memo_note").catch(() => {
              // 브라우저 미리보기에는 이 명령이 없다.
            });
          }}
        >
          +
        </button>
        <button
          type="button"
          className={`truncate rounded-lg px-2 py-1 text-left text-[12px] ${selected === "" ? "bg-ink-soft text-desk" : "text-desk hover:bg-ink-soft"}`}
          onClick={() => setSelected("")}
        >
          메모
        </button>
        {notes.map((note, index) => (
          <div key={note.id} className="flex items-center gap-0.5">
            <button
              type="button"
              className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left text-[12px] ${selected === note.id ? "bg-ink-soft text-desk" : "text-desk hover:bg-ink-soft"}`}
              onClick={() => setSelected(note.id)}
            >
              {memoWindowTitle(index)}
            </button>
            <button
              type="button"
              className="rounded-lg px-1 py-1 text-[11px] text-quiet hover:bg-ink-soft"
              title="빼기"
              onClick={() => {
                void invoke("request_memo_remove", { id: note.id }).catch(() => {
                  // 브라우저 미리보기에는 이 명령이 없다.
                });
              }}
            >
              빼기
            </button>
          </div>
        ))}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-3 pt-3">
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-desk">{title}</h1>
        </header>
        <p className="px-3 pb-1 text-[11px] text-quiet">
          왼쪽에서 메모를 고릅니다. 제목 줄로 옮기고, 모서리로 크기를 바꿉니다.
        </p>
        <div className="min-h-0 flex-1 p-3">
          <MemoField
            key={active?.id ?? "home"}
            value={value}
            onEdit={(next) => {
              const clipped = clipMemo(next);
              if (active) {
                setNotes((rows) => rows.map((note) => (note.id === active.id ? { ...note, text: clipped } : note)));
                return;
              }
              setHomeText(clipped);
            }}
            onCommit={(next) => {
              const clipped = clipMemo(next);
              if (active) {
                setNotes((rows) => rows.map((note) => (note.id === active.id ? { ...note, text: clipped } : note)));
                void invoke("commit_memo_note", { id: active.id, text: clipped }).catch(() => {
                  // 브라우저 미리보기에는 이 명령이 없다.
                });
                return;
              }
              setHomeText(clipped);
              void invoke("set_memo_draft", { text: clipped, source: "memo-pad" }).catch(() => {
                // 브라우저 미리보기에는 이 명령이 없다.
              });
            }}
            className={fieldClass}
          />
        </div>
      </div>
    </div>
  );
}
