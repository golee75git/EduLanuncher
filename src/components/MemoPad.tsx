import { invoke } from "@tauri-apps/api/core";
import { MemoField } from "./MemoField";
import { MemoPanel } from "./home/MemoPanel";
import { useMemoStore } from "../stores/memoStore";
import { useSettingsStore } from "../stores/settingsStore";
import { dismissMemoNote, openMemoNote, openMemoWindow } from "../services/windowService";
import { EXTRA_MEMO_LIMIT, memoNotePreview, memoWindowTitle, type MemoNote } from "../types/memo";
import { isPriorSkin } from "../types/settings";

function pushDraft(text: string) {
  void invoke("set_memo_draft", { text, source: "main" }).catch(() => {
    // 브라우저 미리보기에는 이 명령이 없다.
  });
}

function MemoEditor({ prior = false }: { prior?: boolean }) {
  const text = useMemoStore((state) => state.text);
  const setText = useMemoStore((state) => state.setText);
  const persist = useMemoStore((state) => state.persist);

  return (
    <MemoField
      value={text}
      rows={2}
      onEdit={setText}
      onCommit={(next) => {
        setText(next);
        pushDraft(next);
        void persist();
      }}
      className={
        prior
          ? "h-14 w-full resize-none rounded-xl border border-line bg-card px-2.5 py-1.5 text-sm text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft"
          : "h-[72px] w-full resize-none rounded-xl border border-line/80 bg-card px-3 py-2 text-[12px] text-desk outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft"
      }
    />
  );
}

function openSaved(note: MemoNote, index: number, large = false) {
  void openMemoNote(note, index, large).catch(() => {
    // 브라우저 미리보기에는 이 명령이 없다.
  });
}

async function addAndOpen() {
  const note = useMemoStore.getState().addNote();
  if (!note) {
    return;
  }
  await useMemoStore.getState().persist();
  const index = useMemoStore.getState().notes.findIndex((item) => item.id === note.id);
  await openMemoNote(note, Math.max(0, index));
}

async function removeSaved(id: string) {
  useMemoStore.getState().removeNote(id);
  await useMemoStore.getState().persist();
  await dismissMemoNote(id);
}

function AddMemoButton({ compact = false }: { compact?: boolean }) {
  const count = useMemoStore((state) => state.notes.length);
  const full = count >= EXTRA_MEMO_LIMIT;
  return (
    <button
      type="button"
      className={
        compact
          ? "rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft disabled:opacity-40"
          : "inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-40"
      }
      disabled={full}
      title={full ? "메모는 4개까지입니다" : "메모 창 추가"}
      onClick={() => void addAndOpen()}
    >
      + 추가
    </button>
  );
}

function ExtraMemoList() {
  const notes = useMemoStore((state) => state.notes);
  if (notes.length === 0) {
    return null;
  }
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5">
      {notes.map((note, index) => (
        <li key={note.id} className="flex items-center gap-1">
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded-lg px-2 py-0.5 text-left text-[12px] text-desk hover:bg-ink-soft"
            onClick={() => openSaved(note, index)}
          >
            {memoWindowTitle(index)}
            <span className="text-quiet"> · {memoNotePreview(note.text)}</span>
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-0.5 text-[12px] text-quiet hover:bg-ink-soft"
            title="빼기"
            onClick={() => void removeSaved(note.id)}
          >
            -
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MemoPad() {
  const prior = useSettingsStore((state) => isPriorSkin(state.settings.panelSkin));
  if (prior) {
    return (
      <section className="shrink-0 border-t border-line/70 bg-paper px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1">
          <h2 className="desk-label mb-0 min-w-0 flex-1">메모</h2>
          <AddMemoButton compact />
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
            onClick={() => void openMemoWindow()}
          >
            크게
          </button>
        </div>
        <MemoEditor prior />
        <ExtraMemoList />
      </section>
    );
  }
  return (
    <MemoPanel
      onExpand={() => void openMemoWindow()}
      extra={<AddMemoButton />}
    >
      <MemoEditor />
      <ExtraMemoList />
    </MemoPanel>
  );
}
