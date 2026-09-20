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
      <p className="px-3 pb-1 text-[11px] text-quiet">상자를 누르면 패널에 자세한 업무가 열립니다. 확대·축소와 스크롤로 봅니다.</p>
      <div className="min-h-0 flex-1 overflow-auto bg-paper">
        {root ? (
          <div
            className="origin-top-left p-2"
            style={{ transform: `scale(${scale})` }}
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
