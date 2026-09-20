import type { TopicSearchHit } from "../services/searchService";
import type { Topic } from "../types/topic";
import { TopicCard } from "./TopicCard";

interface TopicSearchProps {
  items: Array<Topic | TopicSearchHit>;
  selectedId?: string;
  onOpen: (topicId: string) => void;
}

function asCard(item: Topic | TopicSearchHit): { topic: Topic; reason?: string } {
  if ("item" in item && "score" in item) {
    return { topic: item.item, reason: item.reason };
  }
  return { topic: item };
}

export function TopicSearch({ items, selectedId, onOpen }: TopicSearchProps) {
  if (items.length === 0) {
    return <p className="text-sm text-quiet">일치하는 업무가 없습니다.</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const card = asCard(item);
        return (
          <TopicCard
            key={card.topic.id}
            topic={card.topic}
            reason={card.reason}
            selected={selectedId === card.topic.id}
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
}
