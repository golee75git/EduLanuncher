import type { RecordStatus } from "../types/topic";

interface StatusBadgeProps {
  status: RecordStatus;
  needsReview?: boolean;
}

export function StatusBadge({ status, needsReview = false }: StatusBadgeProps) {
  if (status === "old") {
    return <span className="text-[11px] text-quiet">이전 자료</span>;
  }
  if (status === "unknown") {
    return <span className="text-[11px] text-quiet">최신 여부 확인 필요</span>;
  }
  if (needsReview) {
    return <span className="text-[11px] text-quiet">검토 필요</span>;
  }
  return null;
}
