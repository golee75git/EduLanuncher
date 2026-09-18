import { Clock } from "lucide-react";
import { getToolIcon } from "../data/toolIcons";
import type { ToolItem } from "../types/tool";
import { HighlightText } from "./HighlightText";

interface RecentToolsProps {
  tools: ToolItem[];
  query?: string;
  selectedId?: string;
  onLaunch: (tool: ToolItem) => void;
}

export function RecentTools({ tools, query = "", selectedId, onLaunch }: RecentToolsProps) {
  if (tools.length === 0) {
    return <p className="text-sm text-quiet">최근 사용한 항목이 없습니다.</p>;
  }

  return (
    <ul className="space-y-1">
      {tools.map((tool) => {
        const Icon = getToolIcon(tool.icon);
        const selected = tool.id === selectedId;
        return (
          <li key={tool.id}>
            <button
              type="button"
              onClick={() => onLaunch(tool)}
              className={`desk-row gap-2 ${selected ? "desk-row-active" : ""}`}
            >
              <Icon className="h-4 w-4 shrink-0 text-quiet" />
              <span className="min-w-0 flex-1 truncate">
                <HighlightText text={tool.name} query={query} />
              </span>
              <Clock className="h-3.5 w-3.5 shrink-0 text-quiet" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
