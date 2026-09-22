import { ArrowLeft, Plus } from "lucide-react";
import { useMemo } from "react";
import { FavoriteGrid } from "../components/FavoriteGrid";
import { toolGroupLabel } from "../data/toolGroups";
import { useSettingsStore } from "../stores/settingsStore";
import { useToolStore } from "../stores/toolStore";
import type { ToolItem, ToolType } from "../types/tool";

interface ToolGroupPageProps {
  groupType: ToolType;
  onBack: () => void;
  onLaunch: (tool: ToolItem) => void;
  onEdit: (tool?: ToolItem, createType?: ToolType) => void;
  onPcUrls?: () => void;
  onComputerTools?: () => void;
  onShortcuts?: () => void;
  onTopics?: () => void;
  onRemove?: (tool: ToolItem) => void;
}

export function ToolGroupPage({
  groupType,
  onBack,
  onLaunch,
  onEdit,
  onPcUrls,
  onComputerTools,
  onShortcuts,
  onTopics,
  onRemove,
}: ToolGroupPageProps) {
  const tools = useToolStore((state) => state.tools);
  const toggleFavorite = useToolStore((state) => state.toggleFavorite);
  const listColumns = useSettingsStore((state) => state.settings.listColumns);
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
        {groupType === "url" && onPcUrls ? (
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
            onClick={onPcUrls}
          >
            인터넷 즐겨찾기
          </button>
        ) : null}
        {groupType === "internal" && onShortcuts ? (
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
            onClick={onShortcuts}
          >
            단축키
          </button>
        ) : null}
        {groupType === "internal" && onTopics ? (
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
            onClick={onTopics}
          >
            업무자료
          </button>
        ) : null}
        {groupType === "internal" && onComputerTools ? (
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
            onClick={onComputerTools}
          >
            컴퓨터도구
          </button>
        ) : null}
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
          layout="list"
          columns={listColumns}
          emptyText="이 종류의 도구가 없습니다. + 버튼으로 추가하세요."
          onLaunch={onLaunch}
          onFavorite={(tool) => void toggleFavorite(tool.id)}
          onEdit={(tool) => onEdit(tool)}
          onDelete={(tool) => (onRemove ? onRemove(tool) : undefined)}
        />
      </div>
    </div>
  );
}
