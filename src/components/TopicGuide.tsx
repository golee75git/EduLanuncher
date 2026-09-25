import { useState } from "react";
import type { TopicDetailContent } from "../types/topic";

interface TopicGuideProps {
  detail: TopicDetailContent;
}

export function TopicGuide({ detail }: TopicGuideProps) {
  const flowchart = detail.flowchart ?? [];
  const [openStep, setOpenStep] = useState(0);
  const [branch, setBranch] = useState(0);
  const [checked, setChecked] = useState<boolean[]>([]);
  const decision = detail.decision;
  const selected = decision?.branches[branch];
  const step = flowchart[openStep];

  return (
    <div className="space-y-4">
      {detail.purpose ? (
        <section>
          <h3 className="desk-label">핵심 목적</h3>
          <p className="text-sm leading-6 text-desk">{detail.purpose}</p>
        </section>
      ) : null}
      {detail.easyExplanation ? (
        <section>
          <h3 className="desk-label">이 업무는 무엇인가요</h3>
          <p className="text-sm leading-6 text-desk">{detail.easyExplanation}</p>
        </section>
      ) : null}
      {flowchart.length > 0 ? (
        <section>
          <h3 className="desk-label">업무 흐름</h3>
          <ol className="m-0 list-none space-y-1 p-0">
            {flowchart.map((item, index) => {
              const open = index === openStep;
              return (
                <li key={`${item.order}-${item.title}`}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-2.5 py-2 text-left text-sm leading-5 ${
                      open ? "border-ink/30 bg-card text-desk" : "border-line bg-card text-desk"
                    }`}
                    aria-expanded={open}
                    onClick={() => setOpenStep(index)}
                  >
                    <span className="mr-1.5 text-[11px] text-quiet">{item.order}</span>
                    {item.title}
                  </button>
                  {open && step ? (
                    <p className="px-2.5 py-2 text-xs leading-5 text-desk">{step.explanation}</p>
                  ) : null}
                  {index < flowchart.length - 1 ? (
                    <p className="py-0.5 text-center text-[11px] text-quiet" aria-hidden>
                      ↓
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      {decision && selected ? (
        <details className="rounded-lg border border-line bg-card px-2.5 py-2">
          <summary className="cursor-pointer text-sm font-medium text-desk">조건별 처리방법</summary>
          <p className="mt-2 text-sm leading-6 text-desk">{decision.condition}</p>
          <div className="mt-2 flex flex-col gap-1">
            {decision.branches.map((item, index) => (
              <button
                key={item.when}
                type="button"
                className={`rounded-lg border px-2.5 py-2 text-left text-xs leading-5 ${
                  index === branch ? "border-ink/30 text-desk" : "border-line text-quiet"
                }`}
                aria-pressed={index === branch}
                onClick={() => setBranch(index)}
              >
                {item.when}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-5 text-desk">
            <span className="text-quiet">처리방법 </span>
            {selected.result}
          </p>
          <p className="mt-1 text-[11px] text-quiet">적용 기관과 연도에 따라 원문 확인이 필요합니다.</p>
        </details>
      ) : null}
      {detail.timeline && detail.timeline.length > 0 ? (
        <details className="rounded-lg border border-line bg-card px-2.5 py-2">
          <summary className="cursor-pointer text-sm font-medium text-desk">일정</summary>
          <ol className="mt-2 list-none space-y-2 p-0">
            {detail.timeline.map((item) => (
              <li key={item.label} className="text-sm leading-6 text-desk">
                <span className="text-[11px] text-quiet">{item.label}</span>
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {detail.checklist && detail.checklist.length > 0 ? (
        <details className="rounded-lg border border-line bg-card px-2.5 py-2">
          <summary className="cursor-pointer text-sm font-medium text-desk">체크리스트</summary>
          <ul className="mt-2 space-y-1">
            {detail.checklist.map((item, index) => (
              <li key={item}>
                <label className="flex items-start gap-2 text-sm leading-6 text-desk">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked[index] === true}
                    onChange={() =>
                      setChecked((current) => {
                        const next = [...current];
                        next[index] = !next[index];
                        return next;
                      })
                    }
                  />
                  <span>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {detail.comparison ? (
        <details className="rounded-lg border border-line bg-card px-2.5 py-2">
          <summary className="cursor-pointer text-sm font-medium text-desk">{detail.comparison.title}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[16rem] border-collapse text-left text-xs leading-5 text-desk">
              <thead>
                <tr>
                  {detail.comparison.headers.map((header) => (
                    <th key={header} className="border-b border-line px-1.5 py-1 font-medium text-quiet">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.comparison.rows.map((row) => (
                  <tr key={row.join("|")}>
                    {row.map((cell) => (
                      <td key={cell} className="border-b border-line/70 px-1.5 py-1 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      {detail.guideDocuments && detail.guideDocuments.length > 0 ? (
        <details className="rounded-lg border border-line bg-card px-2.5 py-2">
          <summary className="cursor-pointer text-sm font-medium text-desk">필요한 서류</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-desk">
            {detail.guideDocuments.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {detail.auditNotes && detail.auditNotes.length > 0 ? (
        <details className="rounded-lg border border-line bg-card px-2.5 py-2">
          <summary className="cursor-pointer text-sm font-medium text-desk">주의와 감사에서 보는 점</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-desk">
            {detail.auditNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-quiet">적용 기관과 연도에 따라 원문 확인이 필요합니다.</p>
        </details>
      ) : null}
      {detail.sourceNote ? (
        <details className="rounded-lg border border-line bg-card px-2.5 py-2">
          <summary className="cursor-pointer text-sm font-medium text-desk">출처 및 근거</summary>
          <p className="mt-2 text-sm leading-6 text-desk">{detail.sourceNote.title}</p>
          <p className="text-xs leading-5 text-quiet">{detail.sourceNote.pages}</p>
          <p className="text-[11px] text-quiet">원문 확인 필요. 전국 공통 기준으로 확정하지 않았습니다.</p>
        </details>
      ) : null}
    </div>
  );
}

export function topicGuideBadges(detail: TopicDetailContent | undefined): string[] {
  if (!detail) {
    return [];
  }
  const badges: string[] = [];
  if (detail.flowchart && detail.flowchart.length > 0) {
    badges.push("처리절차");
  }
  if (detail.decision) {
    badges.push("조건판단");
  }
  if (detail.timeline && detail.timeline.length > 0) {
    badges.push("기한있음");
  }
  if (detail.checklist && detail.checklist.length > 0) {
    badges.push("체크리스트");
  }
  if (detail.auditNotes && detail.auditNotes.length > 0) {
    badges.push("주의");
  }
  return badges;
}
