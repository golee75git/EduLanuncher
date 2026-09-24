import { areaCounts, resourceGroupCounts } from "../services/topicService";
import { JURISDICTION_LABEL, type Topic } from "../types/topic";
import { MANUAL_KIND_LABEL } from "../types/manual";
import { HighlightText } from "./HighlightText";
import { workflowPreview } from "./WorkflowView";

interface TopicCardProps {
  topic: Topic;
  reason?: string;
  query?: string;
  selected?: boolean;
  onOpen: (topicId: string) => void;
}

export function TopicCard({ topic, reason, query = "", selected = false, onOpen }: TopicCardProps) {
  const countText = resourceGroupCounts(topic)
    .map((group) => `${group.label} ${group.count}`)
    .join(" · ");
  const areaText = areaCounts(topic)
    .map((item) => `${JURISDICTION_LABEL[item.jurisdiction]} ${item.count}`)
    .join(" · ");
  const kindLabel = topic.kind ? MANUAL_KIND_LABEL[topic.kind] : "";
  const pathText = [topic.category, topic.subcategory].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(topic.id)}
      className={`card-surface w-full p-3 text-left ${selected ? "ring-1 ring-ink/20" : ""}`}
    >
      <p className="text-[11px] text-quiet">
        {pathText}
        {kindLabel ? ` · ${kindLabel}` : ""}
      </p>
      <h3 className="mt-1 text-sm font-semibold text-desk">
        {query ? <HighlightText text={topic.title} query={query} /> : topic.title}
      </h3>
      <p className="mt-1 text-xs leading-5 text-quiet">
        {query ? <HighlightText text={topic.description} query={query} /> : topic.description}
      </p>
      {topic.workflow.length > 0 ? (
        <p className="mt-2 text-xs leading-5 text-desk">{workflowPreview(topic.workflow)}</p>
      ) : null}
      {countText ? <p className="mt-2 text-[11px] text-quiet">관련 자료 {countText}</p> : null}
      {areaText ? <p className="text-[11px] text-quiet">출처 {areaText}</p> : null}
      {reason ? <p className="mt-1 text-[11px] text-ink">{reason}</p> : null}
      <p className="mt-2 text-[11px] font-medium text-ink">업무 자세히 보기</p>
    </button>
  );
}
