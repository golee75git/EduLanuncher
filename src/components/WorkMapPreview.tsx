import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pickWorkMapRoot } from "../services/workMapLayout";
import { openWorkMapWindow } from "../services/windowService";
import { WorkMapPicture } from "./WorkMapPicture";

interface WorkMapPreviewProps {
  query: string;
  hitIds: string[];
  onOpen: (topicId: string) => void;
}

const BASE_HEIGHT = 132;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function WorkMapPreview({ query, hitIds, onOpen }: WorkMapPreviewProps) {
  const root = useMemo(() => pickWorkMapRoot(query, hitIds), [query, hitIds]);
  const [scale, setScale] = useState(1);
  const viewRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const anchorRef = useRef<{ x: number; y: number; ratio: number } | null>(null);

  scaleRef.current = scale;

  const zoomTo = (next: number, x: number, y: number) => {
    const current = scaleRef.current;
    const target = clampScale(next);
    if (target === current) {
      return;
    }
    anchorRef.current = { x, y, ratio: target / current };
    scaleRef.current = target;
    setScale(target);
  };

  useEffect(() => {
    setScale(1);
  }, [root?.id]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = view.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomTo(scaleRef.current * factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  }, [root?.id]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!view || !anchor) {
      return;
    }
    view.scrollLeft = (view.scrollLeft + anchor.x) * anchor.ratio - anchor.x;
    view.scrollTop = (view.scrollTop + anchor.y) * anchor.ratio - anchor.y;
  }, [scale]);

  if (!root) {
    return null;
  }

  const zoomFromCenter = (next: number) => {
    const view = viewRef.current;
    zoomTo(next, (view?.clientWidth ?? 0) / 2, (view?.clientHeight ?? 0) / 2);
  };

  return (
    <div className="card-surface mb-2 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-quiet">업무 그림 · {root.label}</p>
        <button
          type="button"
          className="shrink-0 px-1 text-[11px] font-medium text-ink"
          aria-label="축소"
          onClick={() => zoomFromCenter(scale / 1.25)}
        >
          −
        </button>
        <button
          type="button"
          className="shrink-0 px-1 text-[11px] font-medium text-ink"
          aria-label="원래 크기"
          onClick={() => zoomFromCenter(1)}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          className="shrink-0 px-1 text-[11px] font-medium text-ink"
          aria-label="확대"
          onClick={() => zoomFromCenter(scale * 1.25)}
        >
          +
        </button>
        <button
          type="button"
          className="shrink-0 text-[11px] font-medium text-ink"
          onClick={() => void openWorkMapWindow(root.id)}
        >
          크게 보기
        </button>
      </div>
      <div ref={viewRef} className="overflow-auto" style={{ height: BASE_HEIGHT }}>
        <div style={{ width: `${scale * 100}%`, height: BASE_HEIGHT * scale }}>
          <WorkMapPicture root={root} query={query} hitIds={hitIds} compact onOpen={onOpen} fill />
        </div>
      </div>
    </div>
  );
}
