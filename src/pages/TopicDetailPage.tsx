import { ArrowLeft } from "lucide-react";
import { TopicDetail } from "../components/TopicDetail";
import { getTopicById } from "../services/topicService";

interface TopicDetailPageProps {
  topicId: string;
  onBack: () => void;
  onOpenRelated: (topicId: string) => void;
}

export function TopicDetailPage({ topicId, onBack, onOpenRelated }: TopicDetailPageProps) {
  const topic = getTopicById(topicId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-desk">
          {topic?.title ?? "업무자료"}
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {topic ? (
          <TopicDetail topic={topic} onOpenRelated={onOpenRelated} />
        ) : (
          <p className="text-sm text-quiet">해당 업무를 찾지 못했습니다.</p>
        )}
      </div>
    </div>
  );
}
