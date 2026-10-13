import { useMemo, useState } from "react";
import { loadEducationMindMap } from "../../../src/services/mindMapService.ts";
import { elbowPath, layoutWorkMap, pickWorkMapRoot } from "../../../src/services/workMapLayout.ts";

interface MenuWorkMapProps {
  query: string;
  hitIds: string[];
  hrefFor: (topicId: string) => string | null;
  showIdle: boolean;
}

export function MenuWorkMap({ query, hitIds, hrefFor, showIdle }: MenuWorkMapProps) {
  const [wide, setWide] = useState(false);
  const root = useMemo(() => {
    const picked = pickWorkMapRoot(query, hitIds);
    if (picked) {
      return picked;
    }
    if (!query.trim() && showIdle) {
      return loadEducationMindMap().roots[0] ?? null;
    }
    return null;
  }, [query, hitIds, showIdle]);
  const hitKey = hitIds.join("\n");
  const layout = useMemo(() => {
    if (!root) {
      return null;
    }
    return layoutWorkMap(root, wide ? "wide" : "compact", hitIds, query);
  }, [root, wide, hitKey, query, hitIds]);

  if (!root || !layout) {
    return null;
  }

  const hits = new Set(hitIds);
  const byId = new Map(layout.boxes.map((box) => [box.id, box]));

  return (
    <section className="space-y-2 rounded-lg border border-line bg-card p-3">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-desk">업무 그림 · {root.label}</h2>
        <button type="button" className="text-sm font-medium text-ink" onClick={() => setWide((value) => !value)}>
          {wide ? "작게 보기" : "크게 보기"}
        </button>
      </div>
      <p className="text-xs text-quiet">상자에 연결된 업무가 있으면 그 페이지로 이동합니다.</p>
      <div className={wide ? "max-h-[32rem] overflow-auto" : "h-52 overflow-auto"}>
        <svg
          role="img"
          aria-label={`${root.label} 업무 그림`}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="block h-full w-full"
          style={{ fontFamily: '"Segoe UI Variable", "Segoe UI", "Malgun Gothic", sans-serif' }}
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
                strokeWidth={wide ? 1.4 : 1}
              />
            );
          })}
          {layout.boxes.map((box) => {
            const marked = Boolean(box.topicId && hits.has(box.topicId));
            const href = box.topicId ? hrefFor(box.topicId) : null;
            const shape = (
              <>
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
                <text x={box.x + 8} y={box.y + box.h / 2 + 4} fill="var(--color-desk)" fontSize={wide ? 12 : 10}>
                  {box.label}
                </text>
              </>
            );
            return href ? (
              <a key={box.id} href={href}>
                {shape}
              </a>
            ) : (
              <g key={box.id}>{shape}</g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
