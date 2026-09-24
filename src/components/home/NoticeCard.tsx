import { ChevronRight, Megaphone } from "lucide-react";

interface NoticeCardProps {
  title: string;
  description: string;
  onClick: () => void;
}

export function NoticeCard({ title, description, onClick }: NoticeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-16 w-full items-center gap-2.5 rounded-xl border border-line/80 bg-card px-3 text-left transition-shadow duration-150 hover:border-line hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-ink-soft text-ink">
        <Megaphone className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-desk">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-quiet">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-quiet" aria-hidden="true" />
    </button>
  );
}
