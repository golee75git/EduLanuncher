import { useState, type ReactNode } from "react";
import { purchaseChecks, purchaseConditions, purchaseGlance, purchaseRelated, purchaseSteps, PURCHASE_GUIDE_HREF } from "../data/purchaseGuide";
import { reviewFlows } from "../data/reviewFlows";
import { pictureSteps, type HandbookTopic } from "../services/menuContent";
import { ManualChecklist, PrintButton, StarButton } from "./ManualShelfUi";

const TONES = [
  { fill: "var(--guide-blue-bg)", stroke: "var(--guide-blue-ink)", text: "var(--guide-blue-ink)" },
  { fill: "var(--guide-green-bg)", stroke: "var(--guide-green-ink)", text: "var(--guide-green-ink)" },
  { fill: "var(--guide-orange-bg)", stroke: "var(--guide-orange-ink)", text: "var(--guide-orange-ink)" },
  { fill: "var(--guide-purple-bg)", stroke: "var(--guide-purple-ink)", text: "var(--guide-purple-ink)" },
  { fill: "var(--guide-red-bg)", stroke: "var(--guide-red-ink)", text: "var(--guide-red-ink)" },
  { fill: "var(--guide-teal-bg)", stroke: "var(--guide-teal-ink)", text: "var(--guide-teal-ink)" },
];

function tone(index: number) {
  return TONES[index % TONES.length];
}

export function InteractiveWorkflow({
  steps,
  caption,
}: {
  steps: ReadonlyArray<{ id: string; label: string; note?: string }>;
  caption: string;
}) {
  const [index, setIndex] = useState(0);
  const current = steps[index] ?? steps[0];
  if (!current || steps.length < 2) return null;
  return (
    <section id="guide-flow" className="guide-box guide-green space-y-3" aria-label="업무 흐름">
      <h2 className="text-sm font-medium text-desk">업무 흐름</h2>
      <p className="text-xs text-quiet">{caption}</p>
      <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
        {steps.map((step, stepIndex) => {
          const color = tone(stepIndex);
          const selected = stepIndex === index;
          return (
            <li key={step.id}>
              <button
                type="button"
                aria-pressed={selected}
                className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-3 text-center text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                style={{
                  background: color.fill,
                  borderColor: color.stroke,
                  color: color.text,
                  outline: selected ? `3px solid ${color.stroke}` : undefined,
                  outlineOffset: selected ? "2px" : undefined,
                }}
                onClick={() => setIndex(stepIndex)}
              >
                <span>{stepIndex + 1}</span>
                <span className="break-words">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="rounded-xl border border-line bg-white/70 px-3 py-2 text-sm leading-6 text-desk" aria-live="polite">
        <span className="font-medium">{index + 1}단계 · {current.label}</span>
        <br />
        {current.note?.trim() ? current.note : "상세 지침 검토 중"}
      </p>
    </section>
  );
}

export function HandbookFlowBoard({ handbook }: { handbook: HandbookTopic | undefined }) {
  if (!handbook || handbook.id === "TOPIC-EPKI-01") return null;
  const pictured = handbook.picture ? pictureSteps(handbook.picture) : [];
  if (pictured.length >= 2) {
    return (
      <InteractiveWorkflow
        steps={pictured.map((step) => ({ id: `${handbook.id}-${step.order}`, label: step.title }))}
        caption="편람에 적힌 단계입니다. 처리기준으로 확정하지 않았습니다."
      />
    );
  }
  const review = reviewFlows[handbook.id];
  if (!review || review.length < 2) return null;
  return (
    <section className="no-print">
      <InteractiveWorkflow
        steps={review.map((label, stepIndex) => ({ id: `${handbook.id}-review-${stepIndex}`, label }))}
        caption="검토 중이며 처리기준이 아닙니다."
      />
    </section>
  );
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function PurchaseGuide() {
  const [conditionId, setConditionId] = useState<string | null>(null);
  const condition = purchaseConditions.find((item) => item.id === conditionId);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="no-print space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
        <div>
          <p className="text-sm font-semibold text-desk">AI런처</p>
          <p className="text-xs text-quiet">학교행정 업무 지식베이스 · 시범</p>
        </div>
        <a className="inline-flex min-h-11 items-center text-sm text-ink" href="/menu">매뉴얼</a>
        <nav aria-label="물품구매 관련 업무" className="space-y-1">
          <p className="rounded-xl border-2 border-ink bg-ink-soft px-3 py-3 text-sm font-medium text-desk">물품구매 시범</p>
          {purchaseRelated.map((item) => (
            <a
              key={item.id}
              className="block rounded-xl border border-line bg-card px-3 py-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              href={`/menu/handbook/${encodeURIComponent(item.id)}`}
            >
              <span className="block font-medium">{item.title}</span>
              <span className="text-xs text-quiet">{item.note}</span>
            </a>
          ))}
        </nav>
      </aside>
      <div className="space-y-3">
        <header className="guide-box guide-head flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-desk">물품구매</h1>
            <p className="mt-1 text-xs text-quiet">계약 · 물품 · 시범 화면</p>
            <p className="mt-1 text-sm text-desk">시범이며 공식 처리기준이 아닙니다.</p>
          </div>
          <PrintButton />
        </header>
        <nav aria-label="빠른 이동" className="no-print flex flex-wrap gap-2">
          {[
            ["guide-flow", "처리절차", "guide-pill-green"],
            ["guide-condition", "조건판단", "guide-pill-purple"],
            ["guide-glance", "한눈에 보기", "guide-pill-blue"],
            ["guide-checks", "체크리스트", "guide-pill-rose"],
            ["guide-docs", "필요 서류", "guide-pill-teal"],
          ].map(([id, label, toneName]) => (
            <button
              key={id}
              type="button"
              className={`guide-pill ${toneName} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink`}
              onClick={() => scrollToId(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <section className="guide-box guide-blue" aria-label="업무 개요">
          <h2 className="text-sm font-medium">이 업무는 무엇인가요?</h2>
          <p className="mt-2 text-sm leading-6 text-desk">
            학교 예산으로 물품을 살 때 예산 확인부터 품의, 견적, 계약, 검수, 물품등록, 대금지급까지 살펴보는 시범 화면입니다. 실제 계약 방식과 필요 서류는 금액, 물품 종류, 적용 지침에 따라 달라질 수 있습니다. 편람의 물품계약과 물품 관리 항목으로 이어집니다.
          </p>
        </section>
        <InteractiveWorkflow
          steps={purchaseSteps.map((step) => ({ ...step }))}
          caption="시범 순서입니다. 공식 업무 절차로 확정하지 않았습니다."
        />
        <section id="guide-condition" className="guide-box guide-purple space-y-2" aria-label="조건별 처리방법">
          <h2 className="text-sm font-medium">조건별 처리방법</h2>
          <p className="text-xs text-quiet">조건별 처리기준 확인 필요. 금액 기준은 적지 않습니다.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {purchaseConditions.map((item, itemIndex) => {
              const color = tone(itemIndex + 1);
              const selected = conditionId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  className="min-h-11 rounded-xl border-2 px-3 py-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  style={{ background: color.fill, borderColor: color.stroke, color: color.text }}
                  onClick={() => setConditionId(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="rounded-xl border border-dashed border-line bg-card px-3 py-2 text-sm leading-6 text-desk">
            {condition ? condition.note : "구매 상황을 고르면 확인할 말이 표시됩니다. 실제 금액별 계약기준은 공식 지침 확인 후 반영해야 합니다."}
          </p>
        </section>
        <section id="guide-glance" className="guide-box guide-blue space-y-2" aria-label="한눈에 보기">
          <h2 className="text-sm font-medium">한눈에 보기</h2>
          <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-5">
            {purchaseGlance.map((label, index) => {
              const color = tone(index);
              return (
                <li
                  key={label}
                  className="rounded-xl border-2 px-2 py-3 text-center text-sm font-medium"
                  style={{ background: color.fill, borderColor: color.stroke, color: color.text }}
                >
                  {index + 1}. {label}
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-quiet">화면의 흐름은 시범 구성입니다. 순서와 적용 조건은 공식 원문 검증 전입니다.</p>
        </section>
        <div id="guide-checks" className="guide-box guide-rose">
          <ManualChecklist workId="guide-purchase" items={purchaseChecks.map((item) => ({ ...item }))} />
          <p className="text-xs text-quiet">체크 항목은 시범입니다. 공식 점검표가 아닙니다.</p>
        </div>
        <section id="guide-docs" className="guide-box guide-teal space-y-2">
          <h2 className="text-sm font-medium">필요 서류</h2>
          <p className="text-xs text-quiet">예시 목록입니다. 정확한 서류 요건은 공식 지침 대조가 필요합니다.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-desk">
            <li>품의 관련 문서</li>
            <li>견적 관련 문서</li>
            <li>적용 방식에 따른 계약 서류</li>
            <li>검수 확인 자료</li>
            <li>물품등록 관련 자료</li>
            <li>지출 증빙 자료</li>
          </ul>
        </section>
        <section className="guide-box guide-teal space-y-2" aria-label="관련 업무">
          <h2 className="text-sm font-medium">관련 업무</h2>
          <ul className="space-y-1">
            {purchaseRelated.map((item) => (
              <li key={item.id}>
                <a className="block rounded-lg bg-white/70 px-3 py-2 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink" href={`/menu/handbook/${encodeURIComponent(item.id)}`}>{item.title}</a>
              </li>
            ))}
          </ul>
        </section>
        <p className="guide-box guide-slate text-xs text-quiet">출처는 이용자가 가져온 물품구매 시범 화면입니다. 7단계는 시안이며 법령과 금액은 대조하지 않았습니다.</p>
      </div>
    </div>
  );
}

function clipText(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= 280) return flat;
  return `${flat.slice(0, 280)}…`;
}

export function HandbookWorkGuide({
  topic,
  categoryName,
  siblings,
  stateLabel,
  overview,
  body,
  starId,
}: {
  topic: HandbookTopic;
  categoryName: string;
  siblings: HandbookTopic[];
  stateLabel: string;
  overview: string;
  body: ReactNode;
  starId: string;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim();
  const listed = siblings.filter((item) => {
    if (!needle) return true;
    return `${item.officialName}\n${item.title}`.includes(needle);
  });
  const pictured = topic.picture ? pictureSteps(topic.picture) : [];
  const glance = (pictured.length >= 2 ? pictured.map((step) => step.title) : reviewFlows[topic.id] ?? []).slice(0, 7);
  const glanceCaption = pictured.length >= 2
    ? "편람에 적힌 단계입니다. 처리기준으로 확정하지 않았습니다."
    : "검토 중이며 처리기준이 아닙니다.";
  const purchaseLink = topic.id === "TOPIC-12-03" || topic.id === "TOPIC-12-04" || topic.id === "TOPIC-12-06" || topic.id === "TOPIC-15-01";
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="no-print space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
        <div>
          <p className="text-sm font-semibold text-desk">AI런처</p>
          <p className="text-xs text-quiet">학교행정 업무 지식베이스</p>
        </div>
        <a className="inline-flex min-h-11 items-center text-sm text-ink" href={`/menu/handbook/${encodeURIComponent(topic.categoryId)}`}>
          {categoryName || "편람 분류"}
        </a>
        <input
          className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          value={query}
          placeholder="이 분야 업무 검색"
          aria-label="이 분야 업무 검색"
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav aria-label="이 분야 업무" className="space-y-1">
          {listed.map((item) => {
            const current = item.id === topic.id;
            return (
              <a
                key={item.id}
                aria-current={current ? "page" : undefined}
                className={`block rounded-xl border px-3 py-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${current ? "border-ink bg-ink-soft" : "border-line bg-card"}`}
                href={`/menu/handbook/${encodeURIComponent(item.id)}`}
              >
                <span className="block font-medium">{item.officialName || item.title}</span>
                {item.pages ? <span className="text-xs text-quiet">편람 목차 기준 {item.pages}</span> : null}
              </a>
            );
          })}
          {listed.length === 0 ? <p className="text-sm text-quiet">이 분야에서 해당하는 업무가 없습니다.</p> : null}
        </nav>
      </aside>
      <div className="space-y-3">
        <header className="guide-box guide-head flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="break-words text-2xl font-semibold text-desk">{topic.officialName || topic.title}</h1>
            <p className="mt-1 text-xs text-quiet">{[categoryName, topic.pages ? `편람 목차 기준 ${topic.pages}` : ""].filter(Boolean).join(" · ")}</p>
            <p className="mt-1 text-sm text-desk">{stateLabel}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <PrintButton />
            <StarButton id={starId} title={topic.officialName || topic.title} />
          </div>
        </header>
        <nav aria-label="빠른 이동" className="no-print flex flex-wrap gap-2">
          {[
            ["guide-flow", "처리절차", "guide-pill-green"],
            ["guide-condition", "조건판단", "guide-pill-purple"],
            ["guide-glance", "한눈에 보기", "guide-pill-blue"],
            ["guide-checks", "체크리스트", "guide-pill-rose"],
            ["guide-docs", "필요 서류", "guide-pill-teal"],
          ].map(([id, label, toneName]) => (
            <button
              key={id}
              type="button"
              className={`guide-pill ${toneName} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink`}
              onClick={() => scrollToId(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <section className="guide-box guide-blue" aria-label="업무 개요">
          <h2 className="text-sm font-medium">이 업무는 무엇인가요?</h2>
          <p className="mt-2 text-sm leading-6 text-desk">{overview}</p>
        </section>
        <div>
          <HandbookFlowBoard handbook={topic} />
          {pictured.length < 2 && (reviewFlows[topic.id]?.length ?? 0) < 2 ? (
            <p className="guide-box guide-green text-sm text-desk">상세 지침 검토 중</p>
          ) : null}
        </div>
        <section id="guide-condition" className="guide-box guide-purple space-y-2" aria-label="조건별 처리방법">
          <h2 className="text-sm font-medium">조건별 처리방법</h2>
          <p className="rounded-xl border border-dashed border-line bg-white/70 px-3 py-2 text-sm leading-6 text-desk">조건별 처리기준 확인 필요</p>
        </section>
        <section id="guide-glance" className={pictured.length >= 2 ? "guide-box guide-blue space-y-2" : "guide-box guide-blue no-print space-y-2"} aria-label="한눈에 보기">
          <h2 className="text-sm font-medium">한눈에 보기</h2>
          {glance.length >= 2 ? (
            <>
              <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-5">
                {glance.map((label, index) => {
                  const color = tone(index);
                  return (
                    <li
                      key={`${topic.id}-glance-${index}`}
                      className="rounded-xl border-2 px-2 py-3 text-center text-sm font-medium"
                      style={{ background: color.fill, borderColor: color.stroke, color: color.text }}
                    >
                      {index + 1}. {label}
                    </li>
                  );
                })}
              </ol>
              <p className="text-xs text-quiet">{glanceCaption}</p>
            </>
          ) : (
            <p className="text-sm text-desk">상세 지침 검토 중</p>
          )}
        </section>
        <section id="guide-checks" className="guide-box guide-rose space-y-2" aria-label="체크리스트">
          <h2 className="text-sm font-medium">체크리스트</h2>
          <p className="text-sm text-desk">상세 지침 검토 중</p>
        </section>
        <section id="guide-docs" className="guide-box guide-teal space-y-2" aria-label="필요 서류">
          <h2 className="text-sm font-medium">필요 서류</h2>
          <p className="text-sm text-desk">상세 지침 검토 중</p>
        </section>
        {body}
        {purchaseLink ? <PurchaseGuideLink /> : null}
        <section className="guide-box guide-teal space-y-2" aria-label="관련 업무">
          <h2 className="text-sm font-medium">관련 업무</h2>
          <ul className="space-y-1">
            {siblings.filter((item) => item.id !== topic.id).map((item) => (
              <li key={item.id}>
                <a className="block rounded-lg bg-white/70 px-3 py-2 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink" href={`/menu/handbook/${encodeURIComponent(item.id)}`}>{item.officialName || item.title}</a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function handbookOverview(body: string, fallback: string): string {
  const clipped = clipText(body);
  return clipped || fallback;
}

export function PurchaseGuideLink() {
  return (
    <p className="no-print text-sm">
      <a className="text-ink" href={PURCHASE_GUIDE_HREF}>물품구매 시범 화면</a>
      <span className="text-quiet"> · 공식 처리기준이 아닙니다.</span>
    </p>
  );
}
