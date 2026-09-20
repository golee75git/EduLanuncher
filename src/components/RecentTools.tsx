import { Clock, FileText } from "lucide-react";
import type { Topic } from "../types/topic";
import type { ToolItem } from "../types/tool";
import { HighlightText } from "./HighlightText";
import { ToolGlyph } from "./ToolGlyph";

export type RecentUseItem =
  | { kind: "tool"; id: string; usedAt: string; tool: ToolItem }
  | { kind: "topic"; id: string; usedAt: string; topic: Topic };

interface RecentToolsProps {
  items: RecentUseItem[];
  query?: string;
  selectedId?: string;
  onLaunch: (tool: ToolItem) => void;
  onOpenTopic: (topicId: string) => void;
}

export function RecentTools({
  items,
  query = "",
  selectedId,
  onLaunch,
  onOpenTopic,
}: RecentToolsProps) {
  if (items.length === 0) {
    return <p className="text-sm text-quiet">최근 사용한 항목이 없습니다.</p>;
  }

  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const selected = item.id === selectedId;
        if (item.kind === "topic") {
          return (
            <li key={`topic:${item.id}`}>
              <button
                type="button"
                onClick={() => onOpenTopic(item.topic.id)}
                className={`desk-row gap-2 ${selected ? "desk-row-active" : ""}`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <FileText className="h-4 w-4 text-quiet" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <HighlightText text={item.topic.title} query={query} />
                </span>
                <Clock className="h-3.5 w-3.5 shrink-0 text-quiet" />
              </button>
            </li>
          );
        }
        return (
          <li key={`tool:${item.id}`}>
            <button
              type="button"
              onClick={() => onLaunch(item.tool)}
              className={`desk-row gap-2 ${selected ? "desk-row-active" : ""}`}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <ToolGlyph
                  icon={item.tool.icon}
                  iconImage={item.tool.iconImage}
                  className="h-4 w-4 text-quiet"
                />
              </span>
              <span className="min-w-0 flex-1 truncate">
                <HighlightText text={item.tool.name} query={query} />
              </span>
              <Clock className="h-3.5 w-3.5 shrink-0 text-quiet" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
