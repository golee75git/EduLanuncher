import { useState } from "react";
import { findRelatedTopics, sourceLines } from "../services/topicService";
import { MANUAL_KIND_LABEL } from "../types/manual";
import type { Topic } from "../types/topic";
import { RelatedTopics } from "./RelatedTopics";
import { ResourceTabs } from "./ResourceTabs";
import { StatusBadge } from "./StatusBadge";
import { StepFlow, type VisualStep } from "./StepFlow";
import { TopicGuide, topicGuideBadges } from "./TopicGuide";

interface TopicDetailProps {
  topic: Topic;
  onOpenRelated: (topicId: string) => void;
}

function NoteBox({ label, lines }: { label: string; lines: string[] }) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <section>
      <h3 className="desk-label">{label}</h3>
      <ul className="space-y-2">
        {lines.map((line, index) => (
          <li
            key={`${index}-${line.slice(0, 16)}`}
            className="rounded-lg border border-line bg-zone-alert px-2.5 py-2 text-sm leading-6 text-desk"
          >
            <p className="text-[11px] font-medium text-ink-strong">{label}</p>
            <p className="mt-0.5">{line}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function visualSteps(topic: Topic): VisualStep[] {
  const flow = topic.detail?.flowchart ?? [];
  if (flow.length > 0) {
    return flow.map((step) => ({
      order: step.order,
      title: step.title,
      explanation: step.explanation,
    }));
  }
  return topic.workflow.map((step) => {
    const note = topic.detail?.steps?.find((item) => item.workflowTitle === step.title);
    const explanation = [step.description, note?.explanation].filter(Boolean).join("\n");
    const pages = note && note.printPages.length > 0 ? `인쇄 ${note.printPages.join("·")}쪽` : undefined;
    return {
      order: step.order,
      title: step.title,
      explanation: explanation || undefined,
      pages,
    };
  });
}

export function TopicDetail({ topic, onOpenRelated }: TopicDetailProps) {
  const related = findRelatedTopics(topic);
  const sources = sourceLines(topic);
  const trail = topic.trail ?? [];
  const situations = topic.situations ?? [];
  const exceptions = topic.exceptions ?? [];
  const securityNotes = topic.securityNotes ?? [];
  const sourceRefs = topic.sourceRefs ?? [];
  const [showRefs, setShowRefs] = useState(false);
  const kindLabel = topic.kind ? MANUAL_KIND_LABEL[topic.kind] : "";
  const detail = topic.detail;
  const badges = topicGuideBadges(detail);
  const easyFold = (detail?.easyExplanation ?? "").replace(/\s+/g, "");
  const summaryFold = (topic.beginnerSummary ?? "").replace(/\s+/g, "");
  const showEasy = Boolean(easyFold && easyFold !== summaryFold);
  const showDescription = Boolean(
    topic.description &&
      topic.description.replace(/\s+/g, "") !== (topic.beginnerSummary ?? "").replace(/\s+/g, ""),
  );
  const [plain, setPlain] = useState(true);
  const visual = visualSteps(topic);
  const checkpoints = detail?.checkpoints ?? [];
  const documents = detail?.requiredDocuments ?? [];
  const reviewIssues = detail?.reviewIssues ?? [];

  return (
    <div className="space-y-4">
      <section>
        <nav className="flex flex-wrap items-center gap-x-1 text-[11px] leading-5 text-quiet" aria-label="업무 위치">
          {topic.category ? <span>{topic.category}</span> : null}
          {trail.map((item, index) => {
            const last = index === trail.length - 1;
            return (
              <span key={item.id} className="contents">
                <span aria-hidden>›</span>
                {last ? (
                  <span className="text-desk">{item.title}</span>
                ) : (
                  <button type="button" className="text-ink" onClick={() => onOpenRelated(item.id)}>
                    {item.title}
                  </button>
                )}
              </span>
            );
          })}
          {trail.length === 0 && topic.subcategory ? (
            <>
              <span aria-hidden>›</span>
              <span>{topic.subcategory}</span>
            </>
          ) : null}
        </nav>
        <h2 className="mt-1 text-[15px] font-semibold text-desk">{topic.title}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {kindLabel ? <span className="text-[11px] text-quiet">{kindLabel}</span> : null}
          <StatusBadge status={topic.status} needsReview={topic.needsReview} />
          {(visual.length > 0 && !badges.includes("처리절차") ? ["처리절차", ...badges] : badges).map((badge) => (
            <span key={badge} className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-quiet">
              {badge}
            </span>
          ))}
        </div>
        {topic.beginnerSummary && showDescription ? (
          <div className="mt-3 flex gap-1">
            <button
              type="button"
              className={`rounded-lg border px-2 py-1 text-xs ${plain ? "border-ink bg-ink-soft text-desk" : "border-line text-quiet"}`}
              aria-pressed={plain}
              onClick={() => setPlain(true)}
            >
              쉬운 설명
            </button>
            <button
              type="button"
              className={`rounded-lg border px-2 py-1 text-xs ${plain ? "border-line text-quiet" : "border-ink bg-ink-soft text-desk"}`}
              aria-pressed={!plain}
              onClick={() => setPlain(false)}
            >
              업무 설명
            </button>
          </div>
        ) : null}
        {topic.beginnerSummary && (plain || !showDescription) ? (
          <section className="mt-3">
            <h3 className="desk-label">처음 하는 분</h3>
            <p className="text-sm leading-6 text-desk">{topic.beginnerSummary}</p>
          </section>
        ) : null}
        {showDescription && (!topic.beginnerSummary || !plain) ? (
          <section className="mt-3">
            <h3 className="desk-label">업무 설명</h3>
            <p className="text-sm leading-6 text-desk">{topic.description}</p>
          </section>
        ) : null}
        {visual.length > 0 ? (
          <div className="mt-3">
            <StepFlow steps={visual} />
          </div>
        ) : null}
        {detail &&
        (detail.purpose ||
          detail.flowchart ||
          detail.decision ||
          detail.timeline ||
          detail.checklist ||
          detail.comparison ||
          detail.guideDocuments ||
          detail.auditNotes ||
          detail.sourceNote) ? (
          <div className="mt-3">
            <TopicGuide detail={{ ...detail, easyExplanation: showEasy ? detail.easyExplanation : undefined }} />
          </div>
        ) : null}
        {detail?.whenToUse ? (
          <section className="mt-3">
            <h3 className="desk-label">어떤 때 보나요</h3>
            <p className="text-sm leading-6 text-desk">{detail.whenToUse}</p>
          </section>
        ) : null}
      </section>

      {situations.length > 0 ? (
        <section>
          <h3 className="desk-label">적용 상황</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-6 text-desk">
            {situations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : topic.exampleQuestions.length > 0 ? (
        <section>
          <h3 className="desk-label">대표 질문</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-6 text-desk">
            {topic.exampleQuestions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {checkpoints.length > 0 ? (
        <section>
          <h3 className="desk-label">확인할 사항</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-6 text-desk">
            {checkpoints.map((item) => (
              <li key={item.text}>
                {item.text}
                <span className="mt-0.5 block text-[11px] text-quiet">인쇄 {item.printPages.join("·")}쪽</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {documents.length > 0 ? (
        <section>
          <h3 className="desk-label">필요한 서류</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-6 text-desk">
            {documents.map((item) => (
              <li key={`${item.name}-${item.condition ?? ""}`}>
                {item.name}
                {item.condition ? <span className="text-quiet"> ({item.condition})</span> : null}
                <span className="mt-0.5 block text-[11px] text-quiet">인쇄 {item.printPages.join("·")}쪽</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <NoteBox label="주의하세요" lines={topic.warnings} />

      {reviewIssues.length > 0 ? (
        <section>
          <h3 className="desk-label">원문 확인이 필요한 내용</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-6 text-desk">
            {reviewIssues.map((item) => (
              <li key={item.issue}>
                {item.issue}
                <span className="mt-0.5 block text-[11px] text-quiet">인쇄 {item.printPages.join("·")}쪽</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <NoteBox label="보안" lines={securityNotes} />

      {exceptions.length > 0 ? (
        <section>
          <h3 className="desk-label">예외</h3>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-6 text-desk">
            {exceptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {topic.resources.length > 0 ? (
        <section>
          <h3 className="desk-label">근거자료</h3>
          <ResourceTabs topic={topic} />
        </section>
      ) : null}

      <RelatedTopics topics={related} onOpen={onOpenRelated} />

      {sources.length > 0 ? (
        <section>
          <h3 className="desk-label">공식 출처</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-quiet">
            {sources.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {sourceRefs.length > 0 ? (
        <section>
          <button
            type="button"
            className="text-[11px] font-medium text-ink"
            onClick={() => setShowRefs((value) => !value)}
          >
            {showRefs ? "출처 접기" : "출처 보기"}
          </button>
          {showRefs ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-quiet">
              {sourceRefs.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
