interface MindMapReviewBadgeProps {
  show: boolean;
}

export function MindMapReviewBadge({ show }: MindMapReviewBadgeProps) {
  if (!show) {
    return null;
  }
  return <span className="text-[11px] text-quiet">마인드맵 요약 - 원문 확인 필요</span>;
}
