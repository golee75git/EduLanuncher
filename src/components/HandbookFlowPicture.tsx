import { useMemo, useState } from "react";
import { elbowPath, layoutWorkMap } from "../services/workMapLayout";
import type { FlowTreeNode } from "../services/handbookFlow";
import type { MindMapNode } from "../types/mindmap";

interface HandbookFlowPictureProps {
  root: FlowTreeNode;
  activeId?: string;
  onPick: (nodeId: string) => void;
}

function asMind(node: FlowTreeNode): MindMapNode {
  return {
    id: node.id,
    label: node.label,
    nodeType: "process",
    topicId: node.open ? node.id : undefined,
    children: node.children.map(asMind),
    needsReview: true,
  };
}

export function HandbookFlowPicture({ root, activeId, onPick }: HandbookFlowPictureProps) {
  const [scale, setScale] = useState(1);
  const mind = useMemo(() => asMind(root), [root]);
  const layout = useMemo(() => layoutWorkMap(mind, "wide"), [mind]);
  const byId = useMemo(() => new Map(layout.boxes.map((box) => [box.id, box])), [layout.boxes]);

  return (
    <div>
      <div className="mb-1 flex gap-1">
        <button type="button" className="rounded-full px-2 py-0.5 text-[11px] text-quiet" onClick={() => setScale((value) => Math.max(0.7, value - 0.15))}>
          작게
        </button>
        <button type="button" className="rounded-full px-2 py-0.5 text-[11px] text-quiet" onClick={() => setScale((value) => Math.min(1.8, value + 0.15))}>
          크게
        </button>
      </div>
      <div className="max-h-64 overflow-auto rounded-md border border-line bg-paper">
        <svg
          role="img"
          aria-label="편람 흐름 그림"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ width: layout.width * scale, height: layout.height * scale }}
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
                strokeWidth={1.4}
              />
            );
          })}
          {layout.boxes.map((box) => {
            const active = box.id === activeId;
            return (
              <g key={box.id}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  rx={6}
                  fill={active ? "var(--color-ink-soft)" : "var(--color-card)"}
                  stroke={active ? "var(--color-ink)" : "var(--color-line)"}
                  strokeWidth={1}
                />
                <text x={box.x + 8} y={box.y + box.h / 2 + 4} fill="var(--color-desk)" fontSize={12}>
                  {box.label}
                </text>
                {box.topicId ? (
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.w}
                    height={box.h}
                    rx={6}
                    role="button"
                    tabIndex={0}
                    aria-label={box.label}
                    className="cursor-pointer fill-transparent"
                    onClick={() => onPick(box.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onPick(box.id);
                      }
                    }}
                  >
                    <title>{box.label}</title>
                  </rect>
                ) : (
                  <title>{box.label}</title>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
