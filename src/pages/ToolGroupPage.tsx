import { ArrowLeft, Plus } from "lucide-react";
import { useMemo } from "react";
import { FavoriteGrid } from "../components/FavoriteGrid";
import { toolGroupLabel } from "../data/toolGroups";
import { useToolStore } from "../stores/toolStore";
import type { ToolItem, ToolType } from "../types/tool";

interface ToolGroupPageProps {
  groupType: ToolType;
  onBack: () => void;
  onLaunch: (tool: ToolItem) => void;
  onEdit: (tool?: ToolItem, createType?: ToolType) => void;
}

export function ToolGroupPage({ groupType, onBack, onLaunch, onEdit }: ToolGroupPageProps) {
  const tools = useToolStore((state) => state.tools);
  const toggleFavorite = useToolStore((state) => state.toggleFavorite);
  const removeTool = useToolStore((state) => state.removeTool);
  const items = useMemo(
    () =>
      tools
        .filter((tool) => tool.type === groupType && tool.enabled !== false)
        .sort(
          (a, b) =>
            Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, "ko"),
        ),
    [tools, groupType],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{toolGroupLabel(groupType)}</h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => onEdit(undefined, groupType)}
          aria-label={`${toolGroupLabel(groupType)} 추가`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <FavoriteGrid
          tools={items}
          emptyText="이 종류의 도구가 없습니다. + 버튼으로 추가하세요."
          onLaunch={onLaunch}
          onFavorite={(tool) => void toggleFavorite(tool.id)}
          onEdit={(tool) => onEdit(tool)}
          onDelete={(tool) => void removeTool(tool.id)}
        />
      </div>
    </div>
  );
}
