import type { ToolItem } from "../types/tool";
import { ToolCard } from "./ToolCard";

interface FavoriteGridProps {
  tools: ToolItem[];
  selectedId?: string;
  emptyText?: string;
  onLaunch: (tool: ToolItem) => void;
  onFavorite: (tool: ToolItem) => void;
  onEdit: (tool: ToolItem) => void;
  onDelete: (tool: ToolItem) => void;
}

export function FavoriteGrid({
  tools,
  selectedId,
  emptyText = "즐겨찾기 도구가 없습니다. + 버튼으로 추가하세요.",
  onLaunch,
  onFavorite,
  onEdit,
  onDelete,
}: FavoriteGridProps) {
  if (tools.length === 0) {
    return <p className="px-1 text-sm text-quiet">{emptyText}</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {tools.map((tool) => (
        <ToolCard
          key={tool.id}
          tool={tool}
          compact
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
