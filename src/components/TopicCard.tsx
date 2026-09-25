import { launchQuickUrl } from "../services/launcherService";
import { areaCounts, resourceGroupCounts, topicHttpUrl } from "../services/topicService";
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
  const summary = (topic.beginnerSummary || topic.description).trim();
  const preview = topic.workflow.length > 0 ? workflowPreview(topic.workflow) : "";
  const sourceUrl = topicHttpUrl(topic);

  return (
    <article
      className={`card-surface w-full p-3 text-left ${selected ? "ring-1 ring-ink/20" : ""}`}
      onClick={() => onOpen(topic.id)}
    >
      <p className="text-[11px] text-quiet">
        {pathText}
        {kindLabel ? ` · ${kindLabel}` : ""}
      </p>
      <h3 className="mt-1 text-sm font-semibold text-desk">
        {query ? <HighlightText text={topic.title} query={query} /> : topic.title}
      </h3>
      {summary ? (
        <p className="mt-1 line-clamp-3 text-xs leading-5 text-quiet">
          {query ? <HighlightText text={summary} query={query} /> : summary}
        </p>
      ) : null}
      {preview ? (
        <p className="mt-2 text-xs leading-5 text-desk">
          <span className="text-quiet">처리 순서 </span>
          {preview}
        </p>
      ) : null}
      {countText ? <p className="mt-2 text-[11px] text-quiet">관련 자료 {countText}</p> : null}
      {areaText ? <p className="text-[11px] text-quiet">출처 {areaText}</p> : null}
      {reason ? <p className="mt-1 text-[11px] text-ink">{reason}</p> : null}
      <div className="mt-2 flex flex-wrap gap-3">
        <button
          type="button"
          className="text-[11px] font-medium text-ink"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(topic.id);
          }}
        >
          업무 자세히 보기
        </button>
        {sourceUrl ? (
          <button
            type="button"
            className="text-[11px] font-medium text-ink"
            onClick={(event) => {
              event.stopPropagation();
              void launchQuickUrl(sourceUrl);
            }}
          >
            원문 보기
          </button>
        ) : null}
      </div>
    </article>
  );
}
