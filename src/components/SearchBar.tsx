import { Search } from "lucide-react";
import { forwardRef } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar({ value, onChange, onKeyDown }, ref) {
    return (
      <label className="relative mx-3 mt-2 flex items-center">
        <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-quiet" />
        <input
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="학교·업무·도구 검색"
          className="h-10 w-full rounded-full border border-line bg-card pl-10 pr-3 text-[14px] text-desk shadow-card outline-none transition-shadow duration-150 placeholder:text-quiet/70 focus:border-ink focus:ring-2 focus:ring-ink-soft"
        />
      </label>
    );
  },
);
