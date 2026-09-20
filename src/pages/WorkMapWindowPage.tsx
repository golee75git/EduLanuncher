import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { WorkMapPicture } from "../components/WorkMapPicture";
import { loadEducationMindMap } from "../services/mindMapService";
import { readWorkMapRootId, revealTopicFromMap } from "../services/windowService";
import type { MindMapNode } from "../types/mindmap";

function findRoot(id: string): MindMapNode | undefined {
  return loadEducationMindMap().roots.find((node) => node.id === id);
}

export function WorkMapWindowPage() {
  const [rootId, setRootId] = useState("");
  const [scale, setScale] = useState(1);
  const [shift, setShift] = useState({ x: 16, y: 16 });
  const [drag, setDrag] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);

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

  const root = useMemo(() => (rootId ? findRoot(rootId) : undefined), [rootId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 py-2">
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-desk">
          {root?.label ?? "업무 그림"}
        </h1>
        <button type="button" className="btn-secondary w-auto px-3" onClick={() => setScale((value) => Math.min(2.2, value + 0.15))}>
          확대
        </button>
        <button type="button" className="btn-secondary w-auto px-3" onClick={() => setScale((value) => Math.max(0.45, value - 0.15))}>
          축소
        </button>
      </header>
      <p className="px-3 pb-1 text-[11px] text-quiet">상자를 누르면 패널에 자세한 업무가 열립니다. 빈 곳을 끌면 이동합니다.</p>
      <div
        className="min-h-0 flex-1 overflow-hidden"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget && (event.target as HTMLElement).tagName !== "svg") {
            return;
          }
          setDrag({ x: event.clientX, y: event.clientY, ox: shift.x, oy: shift.y });
        }}
        onPointerMove={(event) => {
          if (!drag) {
            return;
          }
          setShift({
            x: drag.ox + (event.clientX - drag.x),
            y: drag.oy + (event.clientY - drag.y),
          });
        }}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        {root ? (
          <div
            className="h-full w-full origin-top-left"
            style={{ transform: `translate(${shift.x}px, ${shift.y}px) scale(${scale})` }}
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
