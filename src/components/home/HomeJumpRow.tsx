import { Folder, Globe, Keyboard, Monitor, Wrench, type LucideIcon } from "lucide-react";
import type { ToolType } from "../../types/tool";

interface JumpItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

interface HomeJumpRowProps {
  onShortcuts: () => void;
  onComputerTools: () => void;
  onGroup: (groupType: ToolType) => void;
}

export function HomeJumpRow({ onShortcuts, onComputerTools, onGroup }: HomeJumpRowProps) {
  const items: JumpItem[] = [
    { label: "사이트", icon: Globe, onClick: () => onGroup("url") },
    { label: "프로그램", icon: Monitor, onClick: () => onGroup("app") },
    { label: "폴더", icon: Folder, onClick: () => onGroup("folder") },
    { label: "단축키", icon: Keyboard, onClick: onShortcuts },
    { label: "컴퓨터도구", icon: Wrench, onClick: onComputerTools },
  ];

  return (
    <nav aria-label="바로 가기" className="mx-7 mt-3 grid grid-cols-5 gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            title={item.label}
            onClick={item.onClick}
            className="flex min-w-0 flex-col items-center gap-1 rounded-xl px-0.5 py-1 text-desk transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-ink-soft text-ink">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="w-full truncate text-center text-[11px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
