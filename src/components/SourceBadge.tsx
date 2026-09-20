import { RESOURCE_TYPE_LABEL, type ResourceType } from "../types/topic";

interface SourceBadgeProps {
  type: ResourceType;
}

export function SourceBadge({ type }: SourceBadgeProps) {
  return (
    <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-medium text-quiet">
      {RESOURCE_TYPE_LABEL[type]}
    </span>
  );
}
