import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  meta?: string;
  trailing?: ReactNode;
}

export function SectionHeader({ title, meta, trailing }: SectionHeaderProps) {
  return (
    <div className="mb-2 flex items-center gap-1">
      <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-desk">{title}</h2>
      {meta ? <span className="shrink-0 text-[11px] text-quiet">{meta}</span> : null}
      {trailing}
    </div>
  );
}
