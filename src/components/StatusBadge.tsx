import type { RecordStatus } from "../types/topic";

interface StatusBadgeProps {
  status: RecordStatus;
  needsReview?: boolean;
}

export function StatusBadge({ status, needsReview = false }: StatusBadgeProps) {
  return (
    <span className="inline-flex flex-wrap gap-2">
      {status === "old" ? <span className="text-[11px] text-quiet">이전 자료</span> : null}
      {status === "unknown" ? <span className="text-[11px] text-quiet">최신 여부 확인 필요</span> : null}
      {needsReview ? <span className="text-[11px] text-quiet">검토 필요</span> : null}
    </span>
  );
}
