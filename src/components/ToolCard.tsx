import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getToolIcon } from "../data/toolIcons";
import { toolOriginLabel, toolTargetHint, type ToolItem } from "../types/tool";

interface ToolCardProps {
  tool: ToolItem;
  selected?: boolean;
  compact?: boolean;
  layout?: "tile" | "row";
  onLaunch: (tool: ToolItem) => void;
  onFavorite: (tool: ToolItem) => void;
  onEdit: (tool: ToolItem) => void;
  onDelete: (tool: ToolItem) => void;
}

export function ToolCard({
  tool,
  selected = false,
  compact = false,
  layout = "tile",
  onLaunch,
  onFavorite,
  onEdit,
  onDelete,
}: ToolCardProps) {
  const Icon = getToolIcon(tool.icon);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isRow = layout === "row";
  const hint = toolTargetHint(tool);
  const origin = toolOriginLabel(tool);
  const subtitle = hint ? `${hint} · ${origin}` : origin;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  return (
    <div
      className={`group relative rounded-xl border p-2 text-left transition-all duration-150 ${
        isRow ? "p-1.5" : ""
      } ${
        selected
          ? "border-ink/40 bg-ink-soft shadow-card ring-1 ring-inset ring-ink/20"
          : "border-line/70 bg-card shadow-card hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-pop"
      }`}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        className={`flex w-full items-center gap-2 pr-5 text-left ${isRow ? "min-h-9" : ""}`}
        title={tool.target}
        onClick={() => onLaunch(tool)}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-soft text-ink transition-colors duration-150 group-hover:bg-ink group-hover:text-white">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-desk">{tool.name}</span>
          <span className="mt-0.5 block truncate text-[10px] text-quiet">{isRow ? subtitle : origin}</span>
          {!compact && !isRow && tool.description ? (
            <span className="mt-0.5 line-clamp-1 text-[11px] text-quiet">{tool.description}</span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        className="icon-btn absolute right-0.5 top-0.5 p-1"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        aria-label="도구 메뉴"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menuOpen ? (
        <div
          ref={menuRef}
          className="card-surface absolute right-1 top-8 z-20 min-w-28 overflow-hidden py-1 text-sm shadow-pop"
        >
          <button className="block w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink-soft/60" onClick={() => onLaunch(tool)}>
            실행
          </button>
          <button className="block w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink-soft/60" onClick={() => onFavorite(tool)}>
            {tool.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
          </button>
          <button className="block w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink-soft/60" onClick={() => onEdit(tool)}>
            편집
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-red-700 transition-colors duration-150 hover:bg-red-50"
            onClick={() => onDelete(tool)}
          >
            삭제
          </button>
        </div>
      ) : null}
    </div>
  );
}
