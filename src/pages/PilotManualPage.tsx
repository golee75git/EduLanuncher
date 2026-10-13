import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { pilotViewFor, usePilotManualStore } from "../services/pilotManual";
import { getTopicById } from "../services/topicService";

interface PilotManualPageProps {
  topicId: string;
  onBack: () => void;
  onOpenRelated: (topicId: string) => void;
}

export function PilotManualPage({ topicId, onBack, onOpenRelated }: PilotManualPageProps) {
  const ready = usePilotManualStore((state) => state.ready);
  const view = useMemo(() => pilotViewFor(topicId), [topicId, ready]);
  const nodeLabel = new Map((view?.nodes ?? []).map((node) => [node.nodeId, node.label]));

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-desk">
          {view?.topic.title ?? "시범 업무매뉴얼"}
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {view ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-ink-soft px-3 py-2 text-xs leading-5 text-desk">{view.banner}</p>
            <section>
              <p className="text-[11px] text-quiet">{view.topic.categoryName} · 개발용 시범</p>
              <h2 className="mt-1 text-sm font-semibold text-desk">{view.topic.title}</h2>
              <p className="mt-2 text-sm leading-6 text-desk">
                아래 본문은 편람 문장이다. 현행 법령과 다른 부분은 단계마다 따로 적는다. 미확인 내용은 현행 기준으로 확정하지 않는다.
              </p>
            </section>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-desk">상세 매뉴얼</h2>
              {view.prose.map((section) => (
                <article key={section.sectionId}>
                  <h3 className="text-sm font-medium text-desk">
                    {section.title}
                  </h3>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-6 text-desk">{section.markdown}</pre>
                </article>
              ))}
            </section>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-desk">직종별 처리 단계</h2>
              {view.occupations.map((group) => (
                <article key={group.name} className="space-y-2">
                  <h3 className="text-sm font-medium text-desk">{group.name}</h3>
                  {group.steps.map((step) => (
                    <div key={step.stepId} className="card-surface px-3 py-2">
                      <p className="text-sm font-medium text-desk">{step.title}</p>
                      <p className="mt-1 text-xs text-quiet">
                        담당 {step.actor || "미기재"}
                        {(step.inputs ?? []).length > 0 ? ` · 서류 ${(step.inputs ?? []).join(", ")}` : ""}
                      </p>
                      <p className="mt-2 text-xs text-quiet">편람 원문</p>
                      <p className="text-sm leading-6 text-desk">{step.method}</p>
                      <p className="mt-2 text-xs text-quiet">확인된 법령 조문</p>
                      {step.laws.length > 0 ? (
                        <ul className="text-sm leading-6 text-desk">
                          {step.laws.map((law) => (
                            <li key={law.lawSourceId}>
                              {law.title} {(law.articles ?? []).join(", ")} · 시행 {law.effectiveDate} · 조회 {law.retrievedAt}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-desk">이 단계에서 연 조문이 없다.</p>
                      )}
                      {step.lawCheck?.note ? <p className="mt-1 text-sm leading-6 text-desk">{step.lawCheck.note}</p> : null}
                      <p className="mt-2 text-xs text-quiet">
                        검증 상태 {step.lawStatusLabel} · {step.currencyLabel}
                        {step.confirmedCurrent ? " · 현행 기준" : ""}
                      </p>
                      {step.sources.length > 0 ? (
                        <p className="mt-1 text-xs text-quiet">
                          편람 출처{" "}
                          {step.sources
                            .map((source) => `${source.documentTitle ?? source.sourceId} 인쇄 ${source.printedPage ?? "-"}쪽`)
                            .join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </article>
              ))}
            </section>
            <section>
              <h2 className="text-sm font-semibold text-desk">업무 흐름도</h2>
              <p className="mt-1 text-xs leading-5 text-quiet">
                검증된 출처가 있는 단계만 잇는다. 상태는 초안이고 공개는 {view.flowRelease}다.
                {view.mermaidPromoted ? " 검토 중 그림을 확정 흐름도로 올렸다." : " 검토 중 Mermaid는 확정 흐름도로 올리지 않았다."}
              </p>
              <ul className="mt-2 space-y-1">
                {view.nodes.map((node) => (
                  <li key={node.nodeId} className="text-sm text-desk">
                    {node.label}
                  </li>
                ))}
              </ul>
              <ul className="mt-2 space-y-1">
                {view.edges.map((edge) => (
                  <li key={`${edge.from}-${edge.to}`} className="text-xs text-quiet">
                    {nodeLabel.get(edge.from) ?? edge.from} → {nodeLabel.get(edge.to) ?? edge.to}
                    {edge.condition ? ` · ${edge.condition}` : ""}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="text-sm font-semibold text-desk">검증 기록</h2>
              {view.notes.map((section) => (
                <article key={section.sectionId} className="mt-2">
                  <h3 className="text-sm font-medium text-desk">{section.title}</h3>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-6 text-desk">{section.markdown}</pre>
                </article>
              ))}
            </section>
            <section>
              <h2 className="text-sm font-semibold text-desk">관련 업무</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {view.relations.map((relation) => {
                  const known = getTopicById(relation.topicId);
                  const label = known?.title ?? (relation.topicId === "gwe-work-0001" ? "질병휴직" : relation.topicId === "gwe-2026-p053" ? "병가" : relation.topicId);
                  return (
                    <button
                      key={relation.topicId}
                      type="button"
                      className="btn-secondary"
                      onClick={() => onOpenRelated(relation.topicId)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          <p className="text-sm text-quiet">시범 업무매뉴얼을 찾지 못했습니다.</p>
        )}
      </div>
    </div>
  );
}
