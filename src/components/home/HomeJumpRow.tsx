import { Briefcase, Folder, Globe, Keyboard, Monitor, Wrench, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ToolType } from "../../types/tool";
import { HOME_JUMPS, DEFAULT_HOME_JUMPS, type HomeJumpId } from "../../types/settings";

interface JumpItem {
  id: HomeJumpId;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

interface HomeJumpRowProps {
  ids: HomeJumpId[];
  onChange: (ids: HomeJumpId[]) => void;
  onShortcuts: () => void;
  onComputerTools: () => void;
  onGroup: (groupType: ToolType) => void;
}

const LABELS: Record<HomeJumpId, string> = {
  url: "사이트",
  app: "프로그램",
  folder: "폴더",
  shortcuts: "단축키",
  computer: "컴퓨터도구",
  work: "업무도구",
};

export function HomeJumpRow({ ids, onChange, onShortcuts, onComputerTools, onGroup }: HomeJumpRowProps) {
  const [editing, setEditing] = useState(false);
  const items = ids.map((id) => jumpItem(id, onShortcuts, onComputerTools, onGroup));

  const keep = (next: HomeJumpId[]) => {
    onChange(next.length === 0 ? [...DEFAULT_HOME_JUMPS] : next);
  };

  return (
    <div className="mx-7 mt-3">
      <nav
        aria-label="바로 가기"
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          const hue = index + 1;
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              onClick={item.onClick}
              className="flex min-w-0 flex-col items-center gap-1 rounded-xl px-0.5 py-1 text-desk transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span
                className="mark-tile flex h-9 w-9 items-center justify-center rounded-[10px] bg-ink-soft text-ink"
                style={{ ["--mark-bg" as string]: `var(--hue-${hue}-bg)`, ["--mark-fg" as string]: `var(--hue-${hue}-fg)` }}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="w-full truncate text-center text-[11px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="mt-1 flex justify-end">
        <button type="button" className="text-[11px] text-quiet" onClick={() => setEditing((open) => !open)}>
          {editing ? "닫기" : "바로가기 고치기"}
        </button>
      </div>
      {editing ? (
        <ul className="mt-1 space-y-1 rounded-lg border border-line bg-card px-2 py-2 text-xs text-desk">
          {HOME_JUMPS.map((id) => {
            const index = ids.indexOf(id);
            const shown = index >= 0;
            return (
              <li key={id} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate">{LABELS[id]}</span>
                {shown ? (
                  <>
                    <button type="button" className="btn-secondary h-7 w-auto px-2" disabled={index === 0} onClick={() => keep(move(ids, index, -1))}>
                      앞
                    </button>
                    <button
                      type="button"
                      className="btn-secondary h-7 w-auto px-2"
                      disabled={index === ids.length - 1}
                      onClick={() => keep(move(ids, index, 1))}
                    >
                      뒤
                    </button>
                    <button type="button" className="btn-secondary h-7 w-auto px-2" onClick={() => keep(ids.filter((item) => item !== id))}>
                      빼기
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-secondary h-7 w-auto px-2" onClick={() => keep([...ids, id])}>
                    넣기
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function move(ids: HomeJumpId[], index: number, delta: number): HomeJumpId[] {
  const target = index + delta;
  if (target < 0 || target >= ids.length) {
    return ids;
  }
  const next = [...ids];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function jumpItem(
  id: HomeJumpId,
  onShortcuts: () => void,
  onComputerTools: () => void,
  onGroup: (groupType: ToolType) => void,
): JumpItem {
  if (id === "url") {
    return { id, label: LABELS.url, icon: Globe, onClick: () => onGroup("url") };
  }
  if (id === "app") {
    return { id, label: LABELS.app, icon: Monitor, onClick: () => onGroup("app") };
  }
  if (id === "folder") {
    return { id, label: LABELS.folder, icon: Folder, onClick: () => onGroup("folder") };
  }
  if (id === "shortcuts") {
    return { id, label: LABELS.shortcuts, icon: Keyboard, onClick: onShortcuts };
  }
  if (id === "computer") {
    return { id, label: LABELS.computer, icon: Wrench, onClick: onComputerTools };
  }
  return { id, label: LABELS.work, icon: Briefcase, onClick: () => onGroup("internal") };
}
