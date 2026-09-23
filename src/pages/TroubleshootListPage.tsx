import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { SearchBar } from "../components/SearchBar";
import { getTroubleCards, searchTroubleCards } from "../services/troubleshootingService";
import { TROUBLE_CATEGORIES, TROUBLE_CATEGORY_LABEL, type TroubleCategory } from "../types/troubleshooting";

interface TroubleshootListPageProps {
  onBack: () => void;
  onOpen: (cardId: string, search?: string) => void;
  search?: string;
  category?: TroubleCategory | "all";
}

export function TroubleshootListPage({
  onBack,
  onOpen,
  search = "",
  category: initialCategory = "all",
}: TroubleshootListPageProps) {
  const [query, setQuery] = useState(search);
  const [category, setCategory] = useState<TroubleCategory | "all">(initialCategory);
  const cards = useMemo(() => getTroubleCards(), []);
  const filtered = useMemo(
    () => (category === "all" ? cards : cards.filter((card) => card.category === category)),
    [cards, category],
  );
  const searching = query.trim().length > 0;
  const hits = useMemo(
    () => (searching ? searchTroubleCards(query, filtered) : filtered.map((item) => ({ item, score: 0, reason: "" }))),
    [filtered, query, searching],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">PC 문제 해결</h1>
      </header>
      <SearchBar value={query} onChange={setQuery} placeholder="인터넷 안돼, 프린터 오프라인, 시작 메뉴" />
      <p className="px-3 pt-1 text-[11px] text-quiet">검색 예: 인터넷 안돼, 프린터 오프라인, 시작 메뉴, 작업 표시줄, 업데이트</p>
      <div className="mt-2 flex flex-wrap gap-1 px-3">
        <button
          type="button"
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            category === "all" ? "bg-ink-soft font-medium text-ink-strong" : "text-quiet"
          }`}
          onClick={() => setCategory("all")}
        >
          모두
        </button>
        {TROUBLE_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              category === item ? "bg-ink-soft font-medium text-ink-strong" : "text-quiet"
            }`}
            onClick={() => setCategory(item)}
          >
            {TROUBLE_CATEGORY_LABEL[item]}
          </button>
        ))}
      </div>
      <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {hits.length === 0 ? (
          <p className="text-sm text-quiet">일치하는 PC 문제가 없습니다.</p>
        ) : (
          hits.map((hit) => (
            <button
              key={hit.item.id}
              type="button"
              className="desk-row"
              onClick={() => onOpen(hit.item.id, query)}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-desk">{hit.item.title}</span>
              <span className="ml-2 shrink-0 text-xs text-quiet">{TROUBLE_CATEGORY_LABEL[hit.item.category]}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
