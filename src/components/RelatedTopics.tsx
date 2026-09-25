import type { Topic } from "../types/topic";

interface RelatedTopicsProps {
  topics: Topic[];
  onOpen: (topicId: string) => void;
}

export function RelatedTopics({ topics, onOpen }: RelatedTopicsProps) {
  if (topics.length === 0) {
    return null;
  }
  return (
    <section>
      <h2 className="desk-label">관련 업무</h2>
      <div className="flex flex-col">
        {topics.map((topic, index) => (
          <div key={topic.id} className="flex flex-col">
            <button type="button" className="desk-row" onClick={() => onOpen(topic.id)}>
              {topic.title}
            </button>
            {index < topics.length - 1 ? (
              <span className="py-0.5 text-center text-[11px] text-quiet" aria-hidden>
                ↓
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
