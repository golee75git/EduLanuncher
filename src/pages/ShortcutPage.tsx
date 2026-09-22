import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { canRunShortcut, listShortcuts, type ShortcutEntry } from "../data/shortcuts";
import { runShortcutAction } from "../services/windowService";

interface ShortcutPageProps {
  onBack: () => void;
}

export function ShortcutPage({ onBack }: ShortcutPageProps) {
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const run = async (entry: ShortcutEntry) => {
    if (!entry.runId || busyId) {
      return;
    }
    setBusyId(entry.id);
    setNotice("");
    try {
      await runShortcutAction(entry.runId);
      setNotice(`${entry.name}을(를) 열었습니다.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "실행하지 못했습니다.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">단축키</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          직장·교육기관에서 자주 쓰는 Windows·문서 단축키입니다. 실행이 있는 항목은 이 PC에서 같은 화면이나
          프로그램을 엽니다. 키를 대신 누르지는 않습니다.
        </p>
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
        <ul className="card-surface divide-y divide-line/70">
          {listShortcuts().map((entry) => (
            <li key={entry.id} className="flex items-center gap-1 px-2 py-1.5">
              <div className="min-w-0 flex-1 px-1 py-1">
                <span className="block truncate text-sm font-medium text-desk">
                  <span className="text-ink">{entry.keys}</span>
                  <span className="text-quiet"> · </span>
                  {entry.name}
                </span>
                <span className="block truncate text-[11px] text-quiet">{entry.hint}</span>
              </div>
              {canRunShortcut(entry) ? (
                <button
                  type="button"
                  className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-ink hover:bg-ink-soft disabled:opacity-50"
                  disabled={busyId === entry.id}
                  onClick={() => void run(entry)}
                >
                  실행
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
