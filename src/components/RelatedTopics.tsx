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
      <div className="space-y-1">
        {topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            className="desk-row"
            onClick={() => onOpen(topic.id)}
          >
            {topic.title}
          </button>
        ))}
      </div>
    </section>
  );
}
