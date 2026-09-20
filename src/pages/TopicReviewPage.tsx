import { ArrowLeft } from "lucide-react";
import { TopicSearch } from "../components/TopicSearch";
import {
  listMindMapReviewNodes,
  topicsMissingFromMindMap,
  validateEducationData,
} from "../services/mindMapService";
import { getTopics, listNeedsReview } from "../services/topicService";

interface TopicReviewPageProps {
  onBack: () => void;
  onOpen: (topicId: string) => void;
}

export function TopicReviewPage({ onBack, onOpen }: TopicReviewPageProps) {
  const topics = getTopics();
  const items = listNeedsReview(topics);
  const mapIssues = validateEducationData(topics);
  const reviewNodes = listMindMapReviewNodes();
  const missing = topicsMissingFromMindMap(topics);

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
        <section className="mt-5 space-y-2">
          <h2 className="desk-label">마인드맵과 Topic JSON</h2>
          {reviewNodes.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-quiet">
              {reviewNodes.map((node) => (
                <li key={node.id}>
                  {node.id}: {node.label}
                </li>
              ))}
            </ul>
          ) : null}
          {mapIssues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-quiet">
              {mapIssues.map((issue) => (
                <li key={`${issue.id}-${issue.reason}`}>
                  {issue.id}: {issue.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-quiet">연결 오류는 없습니다. 원문 미확인 노드와 제목형 관련업무만 남습니다.</p>
          )}
          <p className="text-xs text-quiet">
            마인드맵 미포함: {missing.map((topic) => topic.id).join(", ")}
          </p>
        </section>
      </div>
    </div>
  );
}
