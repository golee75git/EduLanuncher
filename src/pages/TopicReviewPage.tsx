import { ArrowLeft } from "lucide-react";
import { TopicSearch } from "../components/TopicSearch";
import { getTopics, listNeedsReview } from "../services/topicService";

interface TopicReviewPageProps {
  onBack: () => void;
  onOpen: (topicId: string) => void;
}

export function TopicReviewPage({ onBack, onOpen }: TopicReviewPageProps) {
  const items = listNeedsReview(getTopics());

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">업무자료 검토</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-3 text-xs leading-5 text-quiet">
          최신 여부나 지역 기준을 다시 볼 항목만 모았습니다. 원문은 이 PC에 없고, 주소가 있는 자료만 바깥에서
          엽니다.
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-quiet">검토할 항목이 없습니다.</p>
        ) : (
          <TopicSearch items={items} onOpen={onOpen} />
        )}
      </div>
    </div>
  );
}
