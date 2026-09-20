import { findRelatedTopics, sourceLines } from "../services/topicService";
import type { Topic } from "../types/topic";
import { RelatedTopics } from "./RelatedTopics";
import { ResourceTabs } from "./ResourceTabs";
import { StatusBadge } from "./StatusBadge";
import { WorkflowView } from "./WorkflowView";

interface TopicDetailProps {
  topic: Topic;
  onOpenRelated: (topicId: string) => void;
}

export function TopicDetail({ topic, onOpenRelated }: TopicDetailProps) {
  const related = findRelatedTopics(topic);
  const sources = sourceLines(topic);

  return (
    <div className="space-y-4">
      <section>
        <p className="text-[11px] text-quiet">
          {topic.category}
          {topic.subcategory ? ` · ${topic.subcategory}` : ""}
        </p>
        <h2 className="mt-1 text-[15px] font-semibold text-desk">{topic.title}</h2>
        <div className="mt-1">
          <StatusBadge status={topic.status} needsReview={topic.needsReview} />
        </div>
        <p className="mt-2 text-sm leading-6 text-desk">{topic.description}</p>
      </section>

      {topic.workflow.length > 0 ? (
        <section>
          <h3 className="desk-label">처리 흐름</h3>
          <WorkflowView steps={topic.workflow} />
        </section>
      ) : null}

      {topic.warnings.length > 0 ? (
        <section>
          <h3 className="desk-label">중요 주의사항</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-6 text-desk">
            {topic.warnings.map((line, index) => (
              <li key={`${index}-${line.slice(0, 16)}`}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="desk-label">관련 자료</h3>
        <ResourceTabs topic={topic} />
      </section>

      <RelatedTopics topics={related} onOpen={onOpenRelated} />

      {sources.length > 0 ? (
        <section>
          <h3 className="desk-label">공식 출처</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-quiet">
            {sources.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
