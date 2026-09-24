import { useMemo, useState } from "react";
import { resourcesForTab } from "../services/topicService";
import {
  JURISDICTION_LABEL,
  RESOURCE_TAB_IDS,
  RESOURCE_TAB_LABEL,
  type Jurisdiction,
  type ResourceTabId,
  type Topic,
} from "../types/topic";
import { ResourceCard } from "./ResourceCard";

const AREA_FILTERS = ["all", "gangwon", "national", "other-region", "unknown"] as const;

type AreaFilter = (typeof AREA_FILTERS)[number];

const AREA_FILTER_LABEL: Record<AreaFilter, string> = {
  all: "전체 출처",
  gangwon: JURISDICTION_LABEL.gangwon,
  national: JURISDICTION_LABEL.national,
  "other-region": JURISDICTION_LABEL["other-region"],
  unknown: JURISDICTION_LABEL.unknown,
};

interface ResourceTabsProps {
  topic: Topic;
}

export function ResourceTabs({ topic }: ResourceTabsProps) {
  const [tab, setTab] = useState<ResourceTabId>("all");
  const [area, setArea] = useState<AreaFilter>("all");
  const items = useMemo(() => {
    const listed = resourcesForTab(topic, tab);
    if (area === "all") {
      return listed;
    }
    return listed.filter((item) => item.jurisdiction === (area as Jurisdiction));
  }, [topic, tab, area]);

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
      <div className="mt-1 flex flex-wrap gap-1">
        {AREA_FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              area === id ? "bg-ink-soft font-medium text-ink-strong" : "text-quiet hover:bg-ink-soft/60"
            }`}
            onClick={() => setArea(id)}
          >
            {AREA_FILTER_LABEL[id]}
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
