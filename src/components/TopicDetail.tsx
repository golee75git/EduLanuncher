import { useState } from "react";
import { findRelatedTopics, sourceLines } from "../services/topicService";
import { MANUAL_KIND_LABEL } from "../types/manual";
import type { Topic } from "../types/topic";
import { RelatedTopics } from "./RelatedTopics";
import { ResourceTabs } from "./ResourceTabs";
import { StatusBadge } from "./StatusBadge";
import { WorkflowView } from "./WorkflowView";

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
        </div>
        {topic.description ? <p className="mt-2 text-sm leading-6 text-desk">{topic.description}</p> : null}
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

      {topic.workflow.length > 0 ? (
        <section>
          <h3 className="desk-label">처리 절차</h3>
          <WorkflowView steps={topic.workflow} />
        </section>
      ) : null}

      <NoteBox label="주의" lines={topic.warnings} />
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
          <h3 className="desk-label">관련 자료</h3>
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
