import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { TopicSearch } from "../components/TopicSearch";
import { searchTopics } from "../services/searchService";
import { getTopics } from "../services/topicService";

interface TopicListPageProps {
  onBack: () => void;
  onOpen: (topicId: string) => void;
}

export function TopicListPage({ onBack, onOpen }: TopicListPageProps) {
  const [query, setQuery] = useState("");
  const topics = useMemo(() => getTopics(), []);
  const searching = query.trim().length > 0;
  const hits = useMemo(() => (searching ? searchTopics(query, topics) : []), [query, searching, topics]);
  const grouped = useMemo(() => {
    const map = new Map<string, typeof topics>();
    for (const topic of topics) {
      const key = topic.category || "기타";
      const list = map.get(key) ?? [];
      list.push(topic);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [topics]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">업무자료</h1>
      </header>
      <SearchBar value={query} onChange={setQuery} placeholder="궁금한 업무를 적어 보세요" />
      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {searching ? (
          <section>
            <h2 className="desk-label">업무 주제</h2>
            <TopicSearch items={hits} onOpen={onOpen} />
          </section>
        ) : (
          grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="desk-label">{category}</h2>
              <TopicSearch items={items} onOpen={onOpen} />
            </section>
          ))
        )}
      </div>
    </div>
  );
}
