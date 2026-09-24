import { Search } from "lucide-react";
import { forwardRef } from "react";

interface GlobalSearchProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
}

export const GlobalSearch = forwardRef<HTMLInputElement, GlobalSearchProps>(function GlobalSearch(
  { value, onChange, onKeyDown, placeholder = "학교·업무·도구·공지·이 PC 폴더" },
  ref,
) {
  return (
    <label className="relative mx-7 mt-3 flex items-center">
      <Search className="pointer-events-none absolute left-4 h-4 w-4 text-quiet" aria-hidden="true" />
      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="검색"
        aria-keyshortcuts="Control+K"
        className="h-14 w-full rounded-[14px] border border-line bg-card pl-11 pr-16 text-[14px] text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft"
      />
      <span
        className="pointer-events-none absolute right-3 rounded-md border border-line bg-paper px-1.5 py-0.5 text-[10px] font-medium text-quiet"
        aria-hidden="true"
      >
        Ctrl K
      </span>
    </label>
  );
});
