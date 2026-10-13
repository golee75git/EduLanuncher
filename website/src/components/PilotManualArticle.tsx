import { useEffect, useState } from "react";
import { buildPilotView, isPilotTopicId, type PilotView } from "../../../src/services/pilotManualCore.ts";

const PILOT_NAMES: Record<string, string> = {
  "gwe-2026-p053": "병가",
  "gwe-work-0001": "질병휴직",
};

export function PilotManualArticle({ topicId }: { topicId: string }) {
  const [view, setView] = useState<PilotView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    if (!isPilotTopicId(topicId)) {
      setMissing(true);
      return;
    }
    void fetch("/knowledge/pilot-standard.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error("자료를 불러오지 못했습니다.");
        }
        return response.json();
      })
      .then((body) => {
        if (stop) return;
        const next = buildPilotView(body, topicId);
        setView(next);
        setMissing(!next);
      })
      .catch(() => {
        if (!stop) setMissing(true);
      });
    return () => {
      stop = true;
    };
  }, [topicId]);

  if (missing) {
    return <p className="text-sm text-desk">시범 매뉴얼을 찾지 못했습니다.</p>;
  }
  if (!view) {
    return <p className="text-sm text-quiet">시범 매뉴얼을 불러오는 중입니다.</p>;
  }
  const nodeLabel = new Map(view.nodes.map((node) => [node.nodeId, node.label]));
  return (
    <div className="space-y-4">
      <a className="text-sm text-ink" href="/menu/pilot">
        시범 매뉴얼
      </a>
      <p className="rounded-lg bg-ink-soft px-3 py-2 text-sm leading-6 text-desk">{view.banner}</p>
      <header>
        <p className="text-xs text-quiet">{view.topic.categoryName} · 개발용 시범</p>
        <h1 className="mt-1 text-2xl font-semibold text-desk">{view.topic.title}</h1>
        <p className="mt-2 text-sm leading-6 text-desk">
          아래 본문은 편람 문장이다. 현행 법령과 다른 부분은 단계마다 따로 적는다. 미확인 내용은 현행 기준으로 확정하지 않는다.
        </p>
      </header>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-desk">상세 매뉴얼</h2>
        {view.prose.map((section) => (
          <article key={section.sectionId}>
            <h3 className="text-sm font-medium text-desk">{section.title}</h3>
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
              </div>
            ))}
          </article>
        ))}
      </section>
      <section>
        <h2 className="text-sm font-semibold text-desk">업무 흐름도</h2>
        <p className="mt-1 text-xs leading-5 text-quiet">검증된 출처가 있는 단계만 잇습니다. 개발용 시범입니다.</p>
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
        <h2 className="text-sm font-semibold text-desk">관련 업무</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {view.relations.map((relation) => (
            <a key={relation.topicId} className="btn-secondary" href={`/menu/pilot/${encodeURIComponent(relation.topicId)}`}>
              {PILOT_NAMES[relation.topicId] ?? relation.topicId}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
