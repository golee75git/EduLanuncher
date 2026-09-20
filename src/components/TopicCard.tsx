import { countResourcesByType } from "../services/topicService";
import type { Topic } from "../types/topic";
import { RESOURCE_TYPE_LABEL } from "../types/topic";
import { workflowPreview } from "./WorkflowView";

interface TopicCardProps {
  topic: Topic;
  reason?: string;
  selected?: boolean;
  onOpen: (topicId: string) => void;
}

const COUNT_ORDER = [
  "manual",
  "audit",
  "guideline",
  "law",
  "qna",
  "faq",
  "form",
  "system",
  "notice",
  "case",
] as const;

export function TopicCard({ topic, reason, selected = false, onOpen }: TopicCardProps) {
  const counts = countResourcesByType(topic);
  const countText = COUNT_ORDER.filter((type) => (counts[type] ?? 0) > 0)
    .map((type) => `${RESOURCE_TYPE_LABEL[type]} ${counts[type]}`)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(topic.id)}
      className={`card-surface w-full p-3 text-left ${selected ? "ring-1 ring-ink/20" : ""}`}
    >
      <p className="text-[11px] text-quiet">
        {topic.category}
        {topic.subcategory ? ` · ${topic.subcategory}` : ""}
      </p>
      <h3 className="mt-1 text-sm font-semibold text-desk">{topic.title}</h3>
      <p className="mt-1 text-xs leading-5 text-quiet">{topic.description}</p>
      {topic.workflow.length > 0 ? (
        <p className="mt-2 text-xs leading-5 text-desk">{workflowPreview(topic.workflow)}</p>
      ) : null}
      {countText ? <p className="mt-2 text-[11px] text-quiet">{countText}</p> : null}
      {reason ? <p className="mt-1 text-[11px] text-ink">{reason}</p> : null}
      <p className="mt-2 text-[11px] font-medium text-ink">업무 자세히 보기</p>
    </button>
  );
}
