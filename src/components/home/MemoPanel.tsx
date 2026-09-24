import type { ReactNode } from "react";
import { SectionHeader } from "./SectionHeader";

interface MemoPanelProps {
  onExpand: () => void;
  children: ReactNode;
}

export function MemoPanel({ onExpand, children }: MemoPanelProps) {
  return (
    <section className="mx-auto w-full max-w-[600px] shrink-0 border-t border-line/70 bg-paper px-7 py-3">
      <SectionHeader
        title="메모"
        trailing={
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            onClick={onExpand}
          >
            크게 보기
          </button>
        }
      />
      {children}
    </section>
  );
}
