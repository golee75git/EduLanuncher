import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { OrderShift } from "../components/OrderShift";
import { canRunShortcut, listShortcuts, type ShortcutEntry } from "../data/shortcuts";
import { moveId, moveIdToFront, orderedByIds } from "../services/listOrder";
import { runShortcutAction } from "../services/windowService";
import { useSettingsStore } from "../stores/settingsStore";

interface ShortcutPageProps {
  onBack: () => void;
}

export function ShortcutPage({ onBack }: ShortcutPageProps) {
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const order = useSettingsStore((state) => state.settings.shortcutOrder);
  const update = useSettingsStore((state) => state.update);
  const rows = orderedByIds(listShortcuts(), order);

  const shift = (id: string, step: -1 | 1) => {
    const ids = rows.map((entry) => entry.id);
    const next = moveId(ids, id, step);
    if (next === ids) {
      return;
    }
    void update({ shortcutOrder: next });
  };

  const shiftTop = (id: string) => {
    const ids = rows.map((entry) => entry.id);
    const next = moveIdToFront(ids, id);
    if (next === ids) {
      return;
    }
    void update({ shortcutOrder: next });
  };

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
          직장·교육기관에서 자주 쓰는 Windows·문서 단축키입니다. 이름을 누르면 이 PC에서 같은 화면이나
          프로그램을 엽니다. 누르지 않는 이름은 키로만 됩니다. 키를 대신 누르지는 않습니다.
        </p>
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
        <ul className="card-surface divide-y divide-line/70">
          {rows.map((entry, index) => (
            <li key={entry.id} className="flex items-center gap-1 px-2 py-1.5">
              {canRunShortcut(entry) ? (
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-paper disabled:opacity-50"
                  disabled={busyId === entry.id}
                  onClick={() => void run(entry)}
                >
                  <span className="block truncate text-sm font-medium text-desk">
                    <span className="text-ink">{entry.keys}</span>
                    <span className="text-quiet"> · </span>
                    {entry.name}
                  </span>
                  <span className="block truncate text-[11px] text-quiet">{entry.hint}</span>
                </button>
              ) : (
                <div className="min-w-0 flex-1 px-1 py-1">
                  <span className="block truncate text-sm font-medium text-desk">
                    <span className="text-ink">{entry.keys}</span>
                    <span className="text-quiet"> · </span>
                    {entry.name}
                  </span>
                  <span className="block truncate text-[11px] text-quiet">{entry.hint}</span>
                </div>
              )}
              <OrderShift
                first={index === 0}
                last={index === rows.length - 1}
                onTop={() => shiftTop(entry.id)}
                onUp={() => shift(entry.id, -1)}
                onDown={() => shift(entry.id, 1)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
