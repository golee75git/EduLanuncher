import { ToolGlyph } from "../ToolGlyph";
import { toolGroupLabel } from "../../data/toolGroups";
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

function cardHint(tool: ToolItem): string {
  if (tool.lastUsedAt) {
    return "최근 실행";
  }
  const description = (tool.description ?? "").trim();
  if (description) {
    return description;
  }
  return toolGroupLabel(tool.type);
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
      className={`flex min-h-[62px] items-center gap-1 rounded-[10px] border px-3 py-2 transition-shadow duration-150 ${
        disabled ? "opacity-80" : ""
      } ${
        selected
          ? "border-ink bg-ink-soft"
          : "border-transparent bg-card hover:border-line hover:shadow-card"
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-default"
        title={hoverText}
        disabled={disabled}
        onClick={() => onLaunch(tool)}
      >
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-ink-soft text-ink">
          <ToolGlyph icon={tool.icon} iconImage={tool.iconImage} className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-medium text-desk">{tool.name}</span>
          <span className="mt-0.5 block truncate text-[11px] text-quiet">{cardHint(tool)}</span>
        </span>
      </button>
      <FavoriteButton active={tool.favorite === true} onToggle={() => onFavorite(tool)} />
      <MoreMenu onLaunch={() => onLaunch(tool)} onEdit={() => onEdit(tool)} onDelete={() => onDelete(tool)} />
    </div>
  );
}
