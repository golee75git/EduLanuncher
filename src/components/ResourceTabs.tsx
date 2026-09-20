import { useMemo, useState } from "react";
import { resourcesForTab } from "../services/topicService";
import {
  RESOURCE_TAB_IDS,
  RESOURCE_TAB_LABEL,
  type ResourceTabId,
  type Topic,
} from "../types/topic";
import { ResourceCard } from "./ResourceCard";

interface ResourceTabsProps {
  topic: Topic;
}

export function ResourceTabs({ topic }: ResourceTabsProps) {
  const [tab, setTab] = useState<ResourceTabId>("all");
  const items = useMemo(() => resourcesForTab(topic, tab), [topic, tab]);

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {RESOURCE_TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              tab === id ? "bg-ink-soft font-medium text-ink-strong" : "text-quiet hover:bg-ink-soft/60"
            }`}
            onClick={() => setTab(id)}
          >
            {RESOURCE_TAB_LABEL[id]}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-quiet">이 유형의 자료가 없습니다.</p>
        ) : (
          items.map((resource) => <ResourceCard key={resource.id} resource={resource} />)
        )}
      </div>
    </div>
  );
}
