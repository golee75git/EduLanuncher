import { useMemo } from "react";
import { elbowPath, layoutWorkMap } from "../services/workMapLayout";
import type { MindMapNode } from "../types/mindmap";

interface WorkMapPictureProps {
  root: MindMapNode;
  query?: string;
  hitIds?: string[];
  compact?: boolean;
  onOpen: (topicId: string) => void;
}

export function WorkMapPicture({
  root,
  query = "",
  hitIds = [],
  compact = false,
  onOpen,
}: WorkMapPictureProps) {
  const hitSet = useMemo(() => new Set(hitIds), [hitIds]);
  const layout = useMemo(
    () => layoutWorkMap(root, compact ? "compact" : "wide", hitSet, query),
    [root, compact, hitSet, query],
  );
  const byId = useMemo(() => new Map(layout.boxes.map((box) => [box.id, box])), [layout.boxes]);

  return (
    <svg
      role="img"
      aria-label={`${root.label} 업무 그림`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className={compact ? "h-[132px] w-full" : "h-full w-full"}
      preserveAspectRatio="xMinYMin meet"
    >
      {layout.links.map((link) => {
        const from = byId.get(link.from);
        const to = byId.get(link.to);
        if (!from || !to) {
          return null;
        }
        return (
          <path
            key={`${link.from}-${link.to}`}
            d={elbowPath(from, to)}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={compact ? 1 : 1.4}
          />
        );
      })}
      {layout.boxes.map((box) => {
        const marked = Boolean(box.topicId && hitSet.has(box.topicId));
        return (
          <g key={box.id}>
            <title>{box.label}</title>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={6}
              fill={marked ? "var(--color-ink-soft)" : "var(--color-card)"}
              stroke={marked ? "var(--color-ink)" : "var(--color-line)"}
              strokeWidth={1}
            />
            <text
              x={box.x + 8}
              y={box.y + box.h / 2 + 4}
              fill="var(--color-desk)"
              fontSize={compact ? 10 : 12}
            >
              {box.label}
            </text>
            {box.topicId ? (
              <rect
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                rx={6}
                className="cursor-pointer fill-transparent"
                onClick={() => onOpen(box.topicId as string)}
              >
                <title>{box.label}</title>
              </rect>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
