import { useMemo } from "react";
import { pickWorkMapRoot } from "../services/workMapLayout";
import { openWorkMapWindow } from "../services/windowService";
import { WorkMapPicture } from "./WorkMapPicture";

interface WorkMapPreviewProps {
  query: string;
  hitIds: string[];
  onOpen: (topicId: string) => void;
}

export function WorkMapPreview({ query, hitIds, onOpen }: WorkMapPreviewProps) {
  const root = useMemo(() => pickWorkMapRoot(query, hitIds), [query, hitIds]);
  if (!root) {
    return null;
  }
  return (
    <div className="card-surface mb-2 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] text-quiet">업무 그림 · {root.label}</p>
        <button
          type="button"
          className="shrink-0 text-[11px] font-medium text-ink"
          onClick={() => void openWorkMapWindow(root.id)}
        >
          크게 보기
        </button>
      </div>
      <div className="overflow-x-auto">
        <WorkMapPicture root={root} query={query} hitIds={hitIds} compact onOpen={onOpen} />
      </div>
    </div>
  );
}
