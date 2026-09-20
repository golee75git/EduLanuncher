import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { TopicResultCard } from "../components/TopicResultCard";
import { WorkMapList } from "../components/WorkMapList";
import { WorkMapPreview } from "../components/WorkMapPreview";
import { searchTopics } from "../services/searchService";
import { getTopics } from "../services/topicService";
import { RESOURCE_TYPE_LABEL, RESOURCE_TYPES, type ResourceType } from "../types/topic";

interface TopicListPageProps {
  onBack: () => void;
  onOpen: (topicId: string, search?: string) => void;
  search?: string;
}

type Tab = "results" | "map";

export function TopicListPage({ onBack, onOpen, search = "" }: TopicListPageProps) {
  const [tab, setTab] = useState<Tab>("results");
  const [query, setQuery] = useState(search);
  const openItem = (topicId: string) => onOpen(topicId, query);
  const [category, setCategory] = useState("all");
  const [resourceType, setResourceType] = useState<"all" | ResourceType>("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const topics = useMemo(() => getTopics(), []);
  const categories = useMemo(
    () => [...new Set(topics.map((topic) => topic.category).filter(Boolean))],
    [topics],
  );

  const filtered = useMemo(() => {
    return topics.filter((topic) => {
      if (category !== "all" && topic.category !== category) {
        return false;
      }
      if (reviewOnly && !topic.needsReview && !topic.resources.some((item) => item.needsReview)) {
        return false;
      }
      if (resourceType !== "all" && !topic.resources.some((item) => item.type === resourceType)) {
        return false;
      }
      return true;
    });
  }, [topics, category, resourceType, reviewOnly]);

  const searching = query.trim().length > 0;
  const hits = useMemo(
    () => (searching ? searchTopics(query, filtered) : filtered.map((item) => ({ item, score: 0, reason: "" }))),
    [query, searching, filtered],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const topic of filtered) {
      const key = topic.category || "기타";
      const list = map.get(key) ?? [];
      list.push(topic);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">업무자료</h1>
      </header>
      <div className="mt-2 flex gap-1 px-3">
        <button
          type="button"
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            tab === "results" ? "bg-ink-soft font-medium text-ink-strong" : "text-quiet"
          }`}
          onClick={() => setTab("results")}
        >
          검색결과
        </button>
        <button
          type="button"
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            tab === "map" ? "bg-ink-soft font-medium text-ink-strong" : "text-quiet"
          }`}
          onClick={() => setTab("map")}
        >
          업무지도
        </button>
      </div>
      {tab === "results" ? (
        <>
          <SearchBar value={query} onChange={setQuery} placeholder="궁금한 업무를 적어 보세요" />
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            <select
              className="rounded-md border border-line bg-card px-1 py-0.5 text-[11px] text-desk"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">대분류 전체</option>
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-line bg-card px-1 py-0.5 text-[11px] text-desk"
              value={resourceType}
              onChange={(event) => setResourceType(event.target.value as "all" | ResourceType)}
            >
              <option value="all">자료 유형 전체</option>
              {RESOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {RESOURCE_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-desk">
              <input
                type="checkbox"
                checked={reviewOnly}
                onChange={(event) => setReviewOnly(event.target.checked)}
              />
              검토 필요만
            </label>
          </div>
          <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
            {searching ? (
              <section>
                <h2 className="desk-label">업무 주제</h2>
                {hits.length > 0 ? (
                  <WorkMapPreview
                    query={query}
                    hitIds={hits.map((hit) => hit.item.id)}
                    onOpen={openItem}
                  />
                ) : null}
                <div className="space-y-2">
                  {hits.length === 0 ? (
                    <p className="text-sm text-quiet">일치하는 업무가 없습니다.</p>
                  ) : (
                    hits.map((hit) => (
                      <TopicResultCard
                        key={hit.item.id}
                        topic={hit.item}
                        reason={hit.reason}
                        query={query}
                        onOpen={openItem}
                      />
                    ))
                  )}
                </div>
              </section>
            ) : (
              grouped.map(([name, items]) => (
                <section key={name}>
                  <h2 className="desk-label">{name}</h2>
                  <div className="space-y-2">
                    {items.map((topic) => (
                      <TopicResultCard key={topic.id} topic={topic} onOpen={openItem} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </>
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <WorkMapList onOpen={openItem} />
        </div>
      )}
    </div>
  );
}
