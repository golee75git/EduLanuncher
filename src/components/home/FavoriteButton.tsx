import { Star } from "lucide-react";

interface FavoriteButtonProps {
  active: boolean;
  onToggle: () => void;
}

export function FavoriteButton({ active, onToggle }: FavoriteButtonProps) {
  const label = active ? "즐겨찾기 해제" : "즐겨찾기";
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-quiet transition-colors duration-150 hover:bg-desk/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Star className={`h-3.5 w-3.5 ${active ? "fill-ink text-ink" : ""}`} aria-hidden="true" />
    </button>
  );
}
