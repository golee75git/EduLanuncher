import { Plus, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { APP_CONFIG } from "../../config/app";

interface AppHeaderProps {
  dateLabel: string;
  extra?: ReactNode;
  onSettings: () => void;
  onAdd: () => void;
}

export function AppHeader({ dateLabel, extra, onSettings, onAdd }: AppHeaderProps) {
  return (
    <header className="flex h-[82px] shrink-0 items-center justify-between gap-3 px-7">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-ink text-[18px] font-bold text-white"
          aria-hidden="true"
        >
          교
        </span>
        <h1 className="truncate text-[20px] font-bold leading-tight text-desk">{APP_CONFIG.displayName}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {extra}
        <span className="text-[11px] text-quiet">{dateLabel}</span>
        <button
          type="button"
          className="inline-flex h-8 min-w-8 items-center gap-1 rounded-lg bg-ink-soft px-2 text-[12px] font-medium text-desk transition-colors duration-150 hover:bg-ink-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          onClick={onSettings}
          aria-label="설정"
          title="설정"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
          설정
        </button>
        <button
          type="button"
          className="inline-flex h-8 min-w-8 items-center gap-1 rounded-lg bg-ink px-2.5 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          onClick={onAdd}
          aria-label="추가"
          title="추가"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          추가
        </button>
      </div>
    </header>
  );
}
