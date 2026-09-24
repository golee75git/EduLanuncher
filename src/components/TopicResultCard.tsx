import { useMemo, useState } from "react";
import type { Topic, TopicResource } from "../types/topic";
import { RESOURCE_TYPE_LABEL, RESOURCE_TYPES } from "../types/topic";
import { JurisdictionBadge } from "./JurisdictionBadge";
import { SourceBadge } from "./SourceBadge";
import { TopicCard } from "./TopicCard";

interface TopicResultCardProps {
  topic: Topic;
  reason?: string;
  query?: string;
  onOpen: (topicId: string) => void;
}

export function TopicResultCard({ topic, reason, query, onOpen }: TopicResultCardProps) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => {
    const map = new Map<string, TopicResource[]>();
    for (const type of RESOURCE_TYPES) {
      const items = topic.resources.filter((item) => item.type === type);
      if (items.length > 0) {
        map.set(type, items);
      }
    }
    return [...map.entries()];
  }, [topic.resources]);

  return (
    <article className="space-y-1">
      <TopicCard topic={topic} reason={reason} query={query} onOpen={onOpen} />
      {topic.resources.length > 0 ? (
        <button
          type="button"
          className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-ink-soft"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "자료 접기" : "자료 펼치기"}
        </button>
      ) : null}
      {open ? (
        <div className="space-y-2 pl-1">
          {grouped.length === 0 ? (
            <p className="text-xs text-quiet">연결된 자료가 없습니다.</p>
          ) : (
            grouped.map(([type, items]) => (
              <section key={type}>
                <h4 className="text-[11px] font-medium text-quiet">{RESOURCE_TYPE_LABEL[type as keyof typeof RESOURCE_TYPE_LABEL]}</h4>
                <ul className="mt-1 space-y-1">
                  {items.map((item) => (
                    <li key={item.id} className="rounded-md border border-line/60 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <SourceBadge type={item.type} />
                        <JurisdictionBadge
                          jurisdiction={item.jurisdiction}
                          jurisdictionName={item.jurisdictionName}
                        />
                      </div>
                      <p className="mt-1 text-xs text-desk">{item.title}</p>
                      {item.document ? <p className="text-[11px] text-quiet">{item.document}</p> : null}
                      {item.pages ? <p className="text-[11px] text-quiet">{item.pages}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      ) : null}
    </article>
  );
}
