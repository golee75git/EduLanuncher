import { ToolGlyph } from "../ToolGlyph";
import type { ToolItem } from "../../types/tool";
import { FavoriteButton } from "./FavoriteButton";
import { MoreMenu } from "./MoreMenu";

interface LauncherCardProps {
  tool: ToolItem;
  selected?: boolean;
  onLaunch: (tool: ToolItem) => void;
  onFavorite: (tool: ToolItem) => void;
  onEdit: (tool: ToolItem) => void;
  onDelete: (tool: ToolItem) => void;
}

export function LauncherCard({
  tool,
  selected = false,
  onLaunch,
  onFavorite,
  onEdit,
  onDelete,
}: LauncherCardProps) {
  const disabled = tool.enabled === false;
  const hoverText = (tool.description ?? "").trim() || tool.name;
  return (
    <div
      className={`flex items-start gap-2 rounded-[10px] border px-2.5 py-2 transition-shadow duration-150 ${
        disabled ? "opacity-80" : ""
      } ${
        selected
          ? "border-ink bg-ink-soft"
          : "border-transparent bg-card hover:border-line hover:shadow-card"
      }`}
    >
      <span className="mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-ink-soft text-ink">
        <ToolGlyph icon={tool.icon} iconImage={tool.iconImage} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block w-full truncate text-left text-[13px] font-medium text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-default"
          title={hoverText}
          disabled={disabled}
          onClick={() => onLaunch(tool)}
        >
          {tool.name}
        </button>
        <div className="flex justify-end">
          <FavoriteButton active={tool.favorite === true} onToggle={() => onFavorite(tool)} />
          <MoreMenu onLaunch={() => onLaunch(tool)} onEdit={() => onEdit(tool)} onDelete={() => onDelete(tool)} />
        </div>
      </div>
    </div>
  );
}
