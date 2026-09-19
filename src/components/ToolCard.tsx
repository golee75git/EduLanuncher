import { MoreHorizontal, Star } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ToolGlyph } from "./ToolGlyph";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const isRow = layout === "row";
  const hint = toolTargetHint(tool);
  const origin = toolOriginLabel(tool);
  const subtitle = hint ? `${hint} · ${origin}` : origin;

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuUp(false);
      return;
    }
    const card = cardRef.current;
    if (!card) {
      return;
    }
    let parent: HTMLElement | null = card.parentElement;
    while (parent) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        break;
      }
      parent = parent.parentElement;
    }
    const bounds = (parent ?? document.documentElement).getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const menuSpace = 148;
    const overflowsBottom = cardRect.bottom + menuSpace > bounds.bottom;
    const fitsAbove = cardRect.top - menuSpace >= bounds.top;
    setMenuUp(overflowsBottom && fitsAbove);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  return (
    <div
      ref={cardRef}
      className={`group relative rounded-xl border p-2 text-left transition-all duration-150 ${
        isRow ? "p-1.5" : ""
      } ${menuOpen ? "z-30" : ""} ${
        selected
          ? "border-ink/40 bg-ink-soft shadow-card ring-1 ring-inset ring-ink/20"
          : `border-line/70 bg-card shadow-card hover:border-ink/30 hover:shadow-pop ${
              menuOpen ? "" : "hover:-translate-y-0.5"
            }`
      }`}
      onContextMenu={(event) => {
        event.preventDefault();
        const card = cardRef.current;
        if (!card) {
          return;
        }
        const rect = card.getBoundingClientRect();
        const menuWidth = 112;
        const x = Math.min(Math.max(8, event.clientX - rect.left), Math.max(8, rect.width - menuWidth));
        const y = Math.max(8, event.clientY - rect.top);
        setMenuAt({ x, y });
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        className={`flex w-full items-center gap-2 pr-12 text-left ${isRow ? "min-h-9" : ""}`}
        title={tool.target}
        onClick={() => onLaunch(tool)}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-soft text-ink transition-colors duration-150 group-hover:bg-ink group-hover:text-white">
          <ToolGlyph icon={tool.icon} iconImage={tool.iconImage} className="h-4 w-4" />
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
        className="icon-btn absolute right-6 top-0.5 p-1"
        onClick={(event) => {
          event.stopPropagation();
          onFavorite(tool);
        }}
        aria-label={tool.favorite ? "홈에서 빼기" : "홈에 두기"}
      >
        <Star
          className={`h-3.5 w-3.5 ${tool.favorite ? "fill-ink text-ink" : "text-quiet"}`}
        />
      </button>
      <button
        type="button"
        className="icon-btn absolute right-0.5 top-0.5 p-1"
        onClick={(event) => {
          event.stopPropagation();
          setMenuAt(null);
          setMenuOpen((open) => !open);
        }}
        aria-label="도구 메뉴"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menuOpen ? (
        <div
          ref={menuRef}
          className={`card-surface absolute z-20 min-w-28 overflow-hidden py-1 text-sm shadow-pop ${
            menuAt ? "" : menuUp ? "bottom-8 right-1" : "top-8 right-1"
          }`}
          style={menuAt ? { left: menuAt.x, top: menuAt.y } : undefined}
        >
          <button
            className="block w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink-soft/60"
            onClick={() => {
              setMenuOpen(false);
              onLaunch(tool);
            }}
          >
            실행
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink-soft/60"
            onClick={() => {
              setMenuOpen(false);
              onFavorite(tool);
            }}
          >
            {tool.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink-soft/60"
            onClick={() => {
              setMenuOpen(false);
              onEdit(tool);
            }}
          >
            편집
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-red-700 transition-colors duration-150 hover:bg-red-50"
            onClick={() => {
              setMenuOpen(false);
              onDelete(tool);
            }}
          >
            삭제
          </button>
        </div>
      ) : null}
    </div>
  );
}
