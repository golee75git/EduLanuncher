import { listen } from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WorkMapPicture } from "../components/WorkMapPicture";
import { loadEducationMindMap } from "../services/mindMapService";
import { readWorkMapRootId, revealTopicFromMap } from "../services/windowService";
import type { MindMapNode } from "../types/mindmap";

function findRoot(id: string): MindMapNode | undefined {
  return loadEducationMindMap().roots.find((node) => node.id === id);
}

const MIN_SCALE = 0.45;
const MAX_SCALE = 3;

export function WorkMapWindowPage() {
  const [rootId, setRootId] = useState("");
  const [scale, setScale] = useState(1);
  const viewRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const anchorRef = useRef<{ x: number; y: number; ratio: number } | null>(null);
  scaleRef.current = scale;

  const zoomTo = (next: number, x: number, y: number) => {
    const current = scaleRef.current;
    const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    if (target === current) {
      return;
    }
    anchorRef.current = { x, y, ratio: target / current };
    scaleRef.current = target;
    setScale(target);
  };

  const zoomFromCenter = (next: number) => {
    const view = viewRef.current;
    zoomTo(next, (view?.clientWidth ?? 0) / 2, (view?.clientHeight ?? 0) / 2);
  };

  useEffect(() => {
    let alive = true;
    void readWorkMapRootId().then((id) => {
      if (alive) {
        setRootId(id);
      }
    });
    const unlisten = listen<string>("work-map-root", (event) => {
      if (typeof event.payload === "string") {
        setRootId(event.payload);
      }
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

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
  }, []);

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

  const root = useMemo(() => (rootId ? findRoot(rootId) : undefined), [rootId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 py-2">
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-desk">
          {root?.label ?? "업무 그림"}
        </h1>
        <button type="button" className="btn-secondary w-auto px-3" onClick={() => zoomFromCenter(scaleRef.current * 1.15)}>
          확대
        </button>
        <button type="button" className="btn-secondary w-auto px-3" onClick={() => zoomFromCenter(scaleRef.current / 1.15)}>
          축소
        </button>
      </header>
      <p className="px-3 pb-1 text-[11px] text-quiet">상자를 누르면 패널에 자세한 업무가 열립니다. 마우스 휠로 확대·축소하고 스크롤바로 움직입니다.</p>
      <div ref={viewRef} className="min-h-0 flex-1 overflow-auto bg-paper">
        {root ? (
          <div
            className="p-2"
            style={{ zoom: scale }}
          >
            <WorkMapPicture root={root} compact={false} onOpen={(topicId) => void revealTopicFromMap(topicId)} />
          </div>
        ) : (
          <p className="p-3 text-sm text-quiet">그릴 업무가 없습니다.</p>
        )}
      </div>
    </div>
  );
}
