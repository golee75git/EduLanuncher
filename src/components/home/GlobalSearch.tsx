import { Search } from "lucide-react";
import { forwardRef } from "react";

interface GlobalSearchProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
}

export const GlobalSearch = forwardRef<HTMLInputElement, GlobalSearchProps>(function GlobalSearch(
  { value, onChange, onKeyDown, placeholder = "사이트·업무·파일·폴더·컴퓨터도구·PC 문제" },
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
        className="h-14 w-full rounded-[14px] border border-line bg-card pl-11 pr-4 text-[14px] text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft"
      />
    </label>
  );
});
