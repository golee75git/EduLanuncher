import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { HandbookFlowPicture } from "../components/HandbookFlowPicture";
import { SearchBar } from "../components/SearchBar";
import {
  handbookTopicById,
  searchHandbookTopics,
  stepField,
  type HandbookCategory,
  type HandbookLink,
  type HandbookTopic,
} from "../services/handbookFlow";
import { getHandbookCatalog } from "../services/handbookFlowData";

function linkFor(links: HandbookLink[], nodeId: string): HandbookLink | undefined {
  return links.find((link) => link.nodeId === nodeId && link.nodeInChart);
}

export function HandbookCategoryListPage({
  onBack,
  onOpenCategory,
  onOpenTopic,
}: {
  onBack: () => void;
  onOpenCategory: (categoryId: string) => void;
  onOpenTopic: (topicId: string) => void;
}) {
  const catalog = useMemo(() => getHandbookCatalog(), []);
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchHandbookTopics(query, catalog.topics), [catalog.topics, query]);
  const searching = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">편람 분류</h1>
      </header>
      <p className="px-3 pt-1 text-[11px] leading-4 text-quiet">
        편람 흐름 자료 {catalog.categories.length}개 분류, 업무 {catalog.topics.length}개. 기존 업무자료와 번호가 같아도 합치지 않습니다.
      </p>
      <SearchBar value={query} onChange={setQuery} placeholder="편람 흐름 검색" />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {searching
          ? hits.map((topic) => (
              <button
                key={topic.id}
                type="button"
                className="block w-full rounded-md border border-line bg-card px-3 py-2 text-left"
                onClick={() => onOpenTopic(topic.id)}
              >
                <span className="text-[11px] text-quiet">편람 흐름 자료 · {topic.categoryName || "분류 없음"}</span>
                <span className="mt-0.5 block text-[13px] font-medium text-desk">{topic.title || topic.id}</span>
              </button>
            ))
          : catalog.categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="block w-full rounded-md border border-line bg-card px-3 py-2 text-left"
                onClick={() => onOpenCategory(category.id)}
              >
                <span className="block text-[13px] font-medium text-desk">{category.name || category.id}</span>
                <span className="mt-0.5 block text-[11px] text-quiet">
                  업무 {category.topics.length}개
                  {category.pages ? ` · 편람 쪽수(원본 표기) ${category.pages}` : ""}
                </span>
                {category.declaredCount !== category.topics.length ? (
                  <span className="mt-0.5 block text-[11px] text-quiet">
                    적힌 수는 {category.declaredCount}개인데 들어 있는 업무는 {category.topics.length}개입니다.
                  </span>
                ) : null}
              </button>
            ))}
        {searching && hits.length === 0 ? <p className="text-[12px] text-quiet">편람 흐름에서 찾지 못했습니다.</p> : null}
      </div>
    </div>
  );
}

export function HandbookCategoryPage({
  categoryId,
  onBack,
  onOpenTopic,
}: {
  categoryId: string;
  onBack: () => void;
  onOpenTopic: (topicId: string, stepId?: string) => void;
}) {
  const category = useMemo(() => getHandbookCatalog().categories.find((item) => item.id === categoryId), [categoryId]);
  if (!category) {
    return (
      <div className="flex h-full flex-col bg-paper">
        <header className="flex items-center gap-2 px-3 pt-3">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-[15px] font-semibold text-desk">편람 분류</h1>
        </header>
        <p className="px-3 pt-3 text-[12px] text-quiet">이 분류는 자료에 없습니다.</p>
      </div>
    );
  }
  return (
    <CategoryBody category={category} onBack={onBack} onOpenTopic={onOpenTopic} />
  );
}

function CategoryBody({
  category,
  onBack,
  onOpenTopic,
}: {
  category: HandbookCategory;
  onBack: () => void;
  onOpenTopic: (topicId: string, stepId?: string) => void;
}) {
  const pick = (nodeId: string) => {
    const link = linkFor(category.links, nodeId);
    if (!link?.topicExists) {
      return;
    }
    onOpenTopic(link.targetTopicId, link.stepExists ? link.targetStepId : undefined);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{category.name || category.id}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <p className="text-[11px] text-quiet">업무 {category.topics.length}개. 목록이 그림 대신 쓸 수 있는 경로입니다.</p>
        {category.picture.tree ? (
          <HandbookFlowPicture root={category.picture.tree} onPick={pick} />
        ) : (
          <p className="text-[12px] text-quiet">이 분류 그림은 풀지 못했습니다. 아래 목록을 씁니다.</p>
        )}
        {category.picture.backArrows.length > 0 ? (
          <p className="text-[11px] text-quiet">되돌아가는 연결 {category.picture.backArrows.length}개는 그림에 넣지 않았습니다.</p>
        ) : null}
        <ul className="space-y-2">
          {category.topics.map((topic) => (
            <li key={topic.id}>
              <button type="button" className="block w-full rounded-md border border-line bg-card px-3 py-2 text-left" onClick={() => onOpenTopic(topic.id)}>
                <span className="block text-[13px] font-medium text-desk">{topic.title || topic.id}</span>
                {topic.officialName ? <span className="mt-0.5 block text-[11px] text-quiet">{topic.officialName}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function HandbookTopicPage({
  topicId,
  stepId,
  onBack,
  onOpenTopic,
}: {
  topicId: string;
  stepId?: string;
  onBack: () => void;
  onOpenTopic: (topicId: string, stepId?: string) => void;
}) {
  const topic = useMemo(() => handbookTopicById(getHandbookCatalog(), topicId), [topicId]);
  if (!topic) {
    return (
      <div className="flex h-full flex-col bg-paper">
        <header className="flex items-center gap-2 px-3 pt-3">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-[15px] font-semibold text-desk">편람 업무</h1>
        </header>
        <p className="px-3 pt-3 text-[12px] text-quiet">이 업무는 자료에 없습니다.</p>
      </div>
    );
  }
  return (
    <TopicBody key={`${topic.id}:${stepId ?? ""}`} topic={topic} initialStep={stepId ?? ""} onBack={onBack} onOpenTopic={onOpenTopic} />
  );
}

function TopicBody({
  topic,
  initialStep,
  onBack,
  onOpenTopic,
}: {
  topic: HandbookTopic;
  initialStep: string;
  onBack: () => void;
  onOpenTopic: (topicId: string, stepId?: string) => void;
}) {
  const [stepId, setStepId] = useState(initialStep);
  const step = topic.steps.find((item) => item.stepId === stepId);
  const catalog = getHandbookCatalog();
  const pick = (nodeId: string) => {
    const link = linkFor(topic.links, nodeId);
    if (!link?.topicExists) {
      return;
    }
    if (link.targetTopicId !== topic.id) {
      onOpenTopic(link.targetTopicId, link.stepExists ? link.targetStepId : undefined);
      return;
    }
    const next = link.stepExists ? link.targetStepId : "";
    setStepId(next);
  };
  const activeNode = topic.links.find((link) => link.targetStepId === stepId && link.nodeInChart && link.targetTopicId === topic.id)?.nodeId;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{topic.title || topic.id}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <p className="text-[11px] text-quiet">편람 흐름 자료. 기존 업무자료와 다른 목록입니다.</p>
        {topic.officialName ? <p className="text-[12px] text-desk">{topic.officialName}</p> : null}
        {topic.generalGuidance ? null : topic.purpose ? <p className="text-[12px] leading-5 text-desk">{topic.purpose}</p> : null}
        {topic.generalGuidance ? null : topic.easy ? <p className="text-[12px] leading-5 text-quiet">{topic.easy}</p> : null}
        <p className="text-[11px] text-quiet">편람 쪽수(원본 표기) {topic.pages || "자료에 없음"}</p>
        {topic.generalGuidance && !topic.detailNote && topic.steps.every((item) => !item.description) ? (
          <p className="rounded-md border border-line bg-card px-2 py-1 text-[12px] leading-5 text-desk">
            구체적인 기한·서류·기준은 이 데이터에서 확인되지 않음
          </p>
        ) : null}
        {topic.detailNote ? (
          <section className="space-y-1 rounded-md border border-line bg-card px-3 py-2 text-[12px] leading-5 text-desk">
            <h2 className="font-medium">주요내용</h2>
            <p>{topic.detailNote}</p>
          </section>
        ) : null}
        {topic.picture.tree ? (
          <HandbookFlowPicture root={topic.picture.tree} activeId={activeNode} onPick={pick} />
        ) : topic.generalGuidance && topic.steps.length === 0 && !topic.detailNote ? (
          <p className="text-[12px] text-quiet">이 업무만의 순서는 이 자료에서 확인되지 않습니다.</p>
        ) : topic.steps.length > 0 ? (
          <p className="text-[12px] text-quiet">이 업무 그림은 풀지 못했습니다. 아래 단계 목록을 씁니다.</p>
        ) : null}
        {topic.picture.backArrows.length > 0 ? (
          <p className="text-[11px] text-quiet">되돌아가는 연결 {topic.picture.backArrows.length}개는 그림에 넣지 않고 단계 목록에서 봅니다.</p>
        ) : null}
        <div className="flex flex-col gap-1">
          {topic.steps.map((item) => (
            <button
              key={item.stepId}
              type="button"
              className={`rounded-md border px-2 py-1 text-left text-[12px] ${
                item.stepId === stepId ? "border-ink bg-ink-soft text-ink-strong" : "border-line bg-card text-desk"
              }`}
              onClick={() => setStepId(item.stepId)}
            >
              {item.stepNo}. {item.name || "자료에 없음"}
            </button>
          ))}
        </div>
        {step?.description ? (
          <section className="space-y-1 rounded-md border border-line bg-card px-3 py-2 text-[12px] leading-5 text-desk">
            <h2 className="font-medium">주요내용</h2>
            <p className="text-[11px] text-quiet">{step.name}</p>
            <p>{step.description}</p>
          </section>
        ) : step ? (
          <section className="space-y-1 rounded-md border border-line bg-card px-3 py-2 text-[12px] leading-5 text-desk">
            <h2 className="font-medium">{step.name || "자료에 없음"}</h2>
            <p>설명 {stepField(step.description)}</p>
            <p>조건 {stepField(step.condition)}</p>
            <p>주의 {stepField(step.caveat)}</p>
            <p>다음 {stepField(step.nextStep)}</p>
            <p>
              관련{" "}
              {step.relatedTopic && catalog.topics.some((item) => item.id === step.relatedTopic) ? (
                <button type="button" className="underline" onClick={() => onOpenTopic(step.relatedTopic)}>
                  {catalog.topics.find((item) => item.id === step.relatedTopic)?.title || step.relatedTopic}
                </button>
              ) : (
                stepField(step.relatedTopic)
              )}
            </p>
          </section>
        ) : topic.steps.length === 0 ? null : (
          <p className="text-[12px] text-quiet">단계를 누르면 그 칸의 문장을 봅니다.</p>
        )}
        {topic.id === "TOPIC-01-01" && step && (step.tip || step.reference) ? (
          <section className="space-y-2 rounded-md border border-line bg-card px-3 py-2 text-[12px] leading-5 text-desk">
            {step.tip ? (
              <div>
                <h2 className="font-medium">팁</h2>
                <p>{step.tip}</p>
              </div>
            ) : null}
            {step.reference ? (
              <div>
                <h2 className="font-medium">참고</h2>
                <p>{step.reference}</p>
              </div>
            ) : null}
          </section>
        ) : null}
        {topic.decisionText.trim() ? (
          <section className="rounded-md border border-line bg-card px-3 py-2 text-[12px] leading-5 text-desk">
            <h2 className="font-medium">판단 문장</h2>
            <p>{topic.decisionText}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
