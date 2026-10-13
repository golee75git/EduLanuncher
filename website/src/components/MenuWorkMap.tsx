import { useMemo, useState, type ReactNode } from "react";
import { loadEducationMindMap } from "../../../src/services/mindMapService.ts";
import { elbowPath, layoutWorkMap, pickWorkMapRoot } from "../../../src/services/workMapLayout.ts";

interface MenuWorkMapProps {
  query: string;
  hitIds: string[];
  hrefFor: (topicId: string) => string | null;
  showIdle: boolean;
  renderSide: (topicId: string | null) => ReactNode;
}

const PALE = [
  "color-mix(in srgb, var(--color-ink) 14%, white)",
  "color-mix(in srgb, var(--color-ink-soft) 80%, white)",
  "color-mix(in srgb, var(--color-ink) 8%, var(--color-paper))",
  "color-mix(in srgb, var(--color-line) 65%, white)",
];

function boxDepth(x: number, width: number): number {
  return Math.max(0, Math.round(x / Math.max(1, width + 20)));
}

export function MenuWorkMap({ query, hitIds, hrefFor, showIdle, renderSide }: MenuWorkMapProps) {
  const [wide, setWide] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const root = useMemo(() => {
    const found = pickWorkMapRoot(query, hitIds);
    if (found) {
      return found;
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
        <button
          type="button"
          className="text-sm font-medium text-ink"
          onClick={() => {
            setWide((value) => !value);
            setPicked(null);
          }}
        >
          {wide ? "작게 보기" : "크게 보기"}
        </button>
      </div>
      <p className="text-xs text-quiet">
        {wide ? "왼쪽 상자를 누르면 오른쪽 영역에 내용이 나옵니다." : "상자에 연결된 업무가 있으면 그 페이지로 이동합니다."}
      </p>
      <div className={wide ? "grid items-start gap-3 lg:grid-cols-2" : ""}>
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
              const chosen = picked !== null && picked === box.id;
              const href = box.topicId ? hrefFor(box.topicId) : null;
              const fill = chosen
                ? "color-mix(in srgb, var(--color-ink) 30%, white)"
                : PALE[boxDepth(box.x, box.w) % PALE.length];
              const shape = (
                <>
                  <title>{box.label}</title>
                  <rect
                    x={box.x}
                    y={box.y}
                    width={box.w}
                    height={box.h}
                    rx={6}
                    fill={fill}
                    stroke={chosen || marked ? "var(--color-ink)" : "var(--color-line)"}
                    strokeWidth={chosen ? 2 : 1}
                  />
                  <text x={box.x + 8} y={box.y + box.h / 2 + 4} fill="var(--color-desk)" fontSize={wide ? 12 : 10}>
                    {box.label}
                  </text>
                </>
              );
              if (wide) {
                return (
                  <g
                    key={box.id}
                    className="cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() => setPicked(box.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setPicked(box.id);
                      }
                    }}
                  >
                    {shape}
                  </g>
                );
              }
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
        {wide ? (
          <div className="max-h-[32rem] min-w-0 overflow-auto rounded-lg border border-line bg-paper p-3">
            {renderSide(picked ? (byId.get(picked)?.topicId ?? null) : null)}
          </div>
        ) : null}
      </div>
    </section>
  );
}
