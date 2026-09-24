import { LIST_THREE_COL_MIN_WIDTH } from "../../types/settings";
import type { ToolItem } from "../../types/tool";
import { LauncherCard } from "./LauncherCard";

interface LauncherGridProps {
  tools: ToolItem[];
  columns: 1 | 2 | 3;
  selectedId?: string;
  emptyText: string;
  onLaunch: (tool: ToolItem) => void;
  onFavorite: (tool: ToolItem) => void;
  onEdit: (tool: ToolItem) => void;
  onDelete: (tool: ToolItem) => void;
}

/** 최소 너비는 1열, 기본 창은 2열, 넓은 창은 3열. */
export function homeFavoriteColumns(panelWidth: number): 1 | 2 | 3 {
  if (panelWidth < 420) {
    return 1;
  }
  if (panelWidth >= LIST_THREE_COL_MIN_WIDTH) {
    return 3;
  }
  return 2;
}

export function LauncherGrid({
  tools,
  columns,
  selectedId,
  emptyText,
  onLaunch,
  onFavorite,
  onEdit,
  onDelete,
}: LauncherGridProps) {
  if (tools.length === 0) {
    return <p className="px-1 text-[12px] text-quiet">{emptyText}</p>;
  }
  const gridClass =
    columns === 1 ? "grid grid-cols-1 gap-2.5" : columns === 3 ? "grid grid-cols-3 gap-2.5" : "grid grid-cols-2 gap-2.5";
  return (
    <div className={gridClass}>
      {tools.map((tool) => (
        <LauncherCard
          key={tool.id}
          tool={tool}
          selected={tool.id === selectedId}
          onLaunch={onLaunch}
          onFavorite={onFavorite}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
