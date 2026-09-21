import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMemoStore } from "../stores/memoStore";
import { openMemoWindow } from "../services/windowService";

function pushDraft(text: string) {
  void invoke("set_memo_draft", { text }).catch(() => {
    // Command is unavailable in browser preview.
  });
}

function MemoEditor({ large = false }: { large?: boolean }) {
  const text = useMemoStore((state) => state.text);
  const setText = useMemoStore((state) => state.setText);
  const persist = useMemoStore((state) => state.persist);
  const timer = useRef<number>(0);

  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  return (
    <textarea
      value={text}
      rows={large ? undefined : 2}
      maxLength={2000}
      placeholder="이 PC에만 저장됩니다"
      onChange={(event) => {
        setText(event.target.value);
        pushDraft(event.target.value);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          void persist();
        }, 400);
      }}
      onBlur={() => {
        window.clearTimeout(timer.current);
        void persist();
      }}
      className={
        large
          ? "h-full min-h-0 w-full resize-none rounded-xl border border-line bg-card px-3 py-2 text-sm text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft"
          : "h-14 w-full resize-none rounded-xl border border-line bg-card px-2.5 py-1.5 text-sm text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft"
      }
    />
  );
}

export function MemoPad() {
  return (
    <section className="shrink-0 border-t border-line/70 bg-paper px-3 py-2">
      <div className="mb-1.5 flex items-center gap-1">
        <h2 className="desk-label mb-0 min-w-0 flex-1">메모</h2>
        <button
          type="button"
          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
          onClick={() => void openMemoWindow()}
        >
          크게
        </button>
      </div>
      <MemoEditor />
    </section>
  );
}

export { MemoEditor };
