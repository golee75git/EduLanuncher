import { useState } from "react";
import { reviewFlows } from "../data/reviewFlows";
import { StarButton } from "./ManualShelfUi";
import type { HandbookCategory, HandbookTopic, ManualHit, ManualPart, ManualTopic } from "../services/menuContent";
import {
  detailHref,
  detailIdForHandbook,
  fieldCardState,
  fieldStateLabel,
  handbookIdForDetail,
  selectHandbookTopics,
  visibleParts,
} from "../services/manualField";

function pageLine(pages: string): string {
  return pages.trim() ? `편람 목차 기준 ${pages.trim()}` : "편람 목차 쪽수 없음";
}

const SWATCHES = [
  { fill: "#E3F2FD", stroke: "#1565C0", text: "#0D47A1" },
  { fill: "#E8F5E9", stroke: "#2E7D32", text: "#1B5E20" },
  { fill: "#FFF3E0", stroke: "#E65100", text: "#BF360C" },
  { fill: "#F3E5F5", stroke: "#6A1B9A", text: "#4A148C" },
  { fill: "#FCE4EC", stroke: "#AD1457", text: "#880E4F" },
  { fill: "#E0F2F1", stroke: "#00695C", text: "#004D40" },
  { fill: "#FFF8E1", stroke: "#F9A825", text: "#F57F17" },
] as const;

function swatch(index: number) {
  return SWATCHES[index % SWATCHES.length];
}

const colorBox =
  "inline-flex min-h-11 max-w-full items-center rounded-xl border-2 px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";

export function ReviewFlowNote({ handbookId }: { handbookId: string }) {
  const steps = reviewFlows[handbookId];
  if (!steps || steps.length < 2) return null;
  return (
    <section className="no-print space-y-2" aria-label="검토 중 참고">
      <h2 className="text-sm font-medium text-desk">검토 중 참고</h2>
      <p className="text-xs text-quiet">검토 중이며 처리기준이 아닙니다.</p>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {steps.map((step, index) => {
          const tone = swatch(index);
          return (
            <li key={`${handbookId}-${index}`} className="flex flex-col gap-1">
              <span
                className="rounded-xl border-2 px-3 py-2 text-sm font-medium"
                style={{ background: tone.fill, borderColor: tone.stroke, color: tone.text }}
              >
                {step}
              </span>
              {index < steps.length - 1 ? (
                <span className="text-center text-[11px] text-quiet" aria-hidden>
                  ↓
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function FieldColorIndex({ categories }: { categories: HandbookCategory[] }) {
  return (
    <section className="space-y-2" aria-label="분야 한눈에 보기">
      <h2 className="text-sm font-medium text-desk">분야 한눈에 보기</h2>
      <p className="text-xs text-quiet">편람 목차입니다. 업무 절차가 아닙니다.</p>
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
        {categories.map((category, index) => {
          const tone = swatch(index);
          return (
            <li key={category.id}>
              <a
                href={`/menu/handbook/${encodeURIComponent(category.id)}`}
                className={colorBox}
                style={{ background: tone.fill, borderColor: tone.stroke, color: tone.text }}
              >
                {category.name}
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function FieldTaskMap({ category, topics }: { category: HandbookCategory; topics: HandbookTopic[] }) {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const rows = category.topicIds
    .map((id) => byId.get(id))
    .filter((topic): topic is HandbookTopic => {
      return topic !== undefined && topic.id !== "TOPIC-EPKI-01";
    });
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="이 분야의 업무">
      <h2 className="text-sm font-medium text-desk">이 분야의 업무</h2>
      <p className="text-xs text-quiet">편람 목차입니다. 상자를 누르면 해당 업무로 이동합니다. 업무 절차가 아닙니다.</p>
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
        {rows.map((topic, index) => {
          const tone = swatch(index);
          const href = detailHref(topic) ?? `/menu/handbook/${encodeURIComponent(topic.id)}`;
          const title = topic.officialName || topic.title;
          return (
            <li key={topic.id}>
              <a
                href={href}
                className="inline-flex min-h-11 max-w-56 flex-col items-start justify-center rounded-xl border-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                style={{ background: tone.fill, borderColor: tone.stroke, color: tone.text }}
              >
                <span className="text-sm font-medium">{title}</span>
                <span className="text-[11px]">{fieldStateLabel(fieldCardState(topic.id))}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FieldLinks({ categories, activeId }: { categories: HandbookCategory[]; activeId: string }) {
  return (
    <ul className="space-y-1">
      {categories.map((category) => {
        const current = category.id === activeId;
        return (
          <li key={category.id}>
            <a
              href={`/menu/handbook/${encodeURIComponent(category.id)}`}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-lg px-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                current ? "bg-ink-soft font-medium" : "hover:bg-paper"
              }`}
            >
              {category.name}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function FieldNav({
  categories,
  activeId,
}: {
  categories: HandbookCategory[];
  activeId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <details className="no-print rounded-lg border border-line bg-card md:hidden" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary aria-expanded={open} className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">분야</summary>
        <div className="border-t border-line px-2 py-2">
          <FieldLinks categories={categories} activeId={activeId} />
        </div>
      </details>
      <nav aria-label="분야" className="hidden md:block">
        <FieldLinks categories={categories} activeId={activeId} />
      </nav>
    </div>
  );
}

export function HandbookWorkCard({
  topic,
  categoryName,
}: {
  topic: HandbookTopic;
  categoryName: string;
}) {
  const state = fieldCardState(topic.id);
  const href = detailHref(topic);
  const title = topic.officialName || topic.title;
  return (
    <article className="card-surface min-w-0 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="break-words text-sm font-medium text-desk">{title}</h3>
        <StarButton id={topic.id} title={title} />
      </div>
      <p className="mt-1 break-words text-xs text-quiet">{categoryName}</p>
      <p className="mt-1 text-xs text-quiet">{pageLine(topic.pages)}</p>
      <p className="mt-2 text-sm text-desk">{fieldStateLabel(state)}</p>
      {href ? (
        <a className="mt-2 inline-flex min-h-11 items-center text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink" href={href}>
          상세 지침 보기
        </a>
      ) : (
        <a
          className="mt-2 inline-flex min-h-11 items-center text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          href={`/menu/handbook/${encodeURIComponent(topic.id)}`}
        >
          편람 항목 보기
        </a>
      )}
    </article>
  );
}

export function HandbookCardList({
  categories,
  topics,
  categoryId,
  query,
}: {
  categories: HandbookCategory[];
  topics: HandbookTopic[];
  categoryId: string;
  query: string;
}) {
  const named = new Map(categories.map((category) => [category.id, category.name]));
  const rows = selectHandbookTopics(categories, topics, categoryId, query);
  if (rows.length === 0) {
    return <p className="text-sm text-quiet">해당하는 업무가 없습니다.</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((topic) => (
        <li key={topic.id}>
          <HandbookWorkCard topic={topic} categoryName={named.get(topic.categoryId) ?? ""} />
        </li>
      ))}
    </ul>
  );
}

const FOLD_TONES = ["", "guide-fold-green", "guide-fold-purple", "guide-fold-orange", "guide-fold-rose", "guide-fold-teal"];

function PartFold({
  part,
  open,
  toneName,
  onOpen,
}: {
  part: ManualPart;
  open: boolean;
  toneName: string;
  onOpen: (id: string, next: boolean) => void;
}) {
  return (
    <details
      id={`manual-part-${part.id}`}
      open={open}
      className={`guide-fold ${toneName}`}
      onToggle={(event) => onOpen(part.id, event.currentTarget.open)}
    >
      <summary
        aria-expanded={open}
        className="flex min-h-11 cursor-pointer items-center break-words text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        {part.title}
      </summary>
      <p className="guide-fold-body whitespace-pre-wrap break-words text-sm leading-6 text-desk">{part.body}</p>
    </details>
  );
}

function PartGlance({
  parts,
  openId,
  onPick,
}: {
  parts: ManualPart[];
  openId: string;
  onPick: (id: string) => void;
}) {
  return (
    <section className="no-print space-y-2" aria-label="한눈에 보기">
      <h2 className="text-sm font-medium text-desk">한눈에 보기</h2>
      <p className="text-xs text-quiet">이 본문의 소제목입니다.</p>
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
        {parts.map((part, index) => {
          const tone = swatch(index);
          const selected = openId === part.id;
          return (
            <li key={part.id} className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={selected}
                className="max-w-48 rounded-lg border-2 px-2 py-1.5 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                style={{
                  background: selected ? tone.stroke : tone.fill,
                  borderColor: tone.stroke,
                  color: selected ? "#ffffff" : tone.text,
                }}
                onClick={() => onPick(part.id)}
              >
                {part.title}
              </button>
              {index < parts.length - 1 ? (
                <span className="text-[11px] text-quiet" aria-hidden>
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PrintParts({ parts }: { parts: ManualPart[] }) {
  return (
    <div className="print-only space-y-4">
      {parts.map((part) => (
        <article key={part.id} className="space-y-2">
          <h3 className="text-base font-semibold text-desk">{part.title}</h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-desk">{part.body}</p>
        </article>
      ))}
    </div>
  );
}

export function ManualPartList({ parts }: { parts: ManualPart[] }) {
  const ready = visibleParts(parts);
  const [openIds, setOpenIds] = useState<string[]>([]);
  if (ready.length === 0) {
    return <p className="text-sm text-quiet">이 주소의 세부 본문이 없습니다.</p>;
  }
  if (ready.length === 1) {
    const part = ready[0];
    return (
      <article className="guide-fold">
        <h3 className="break-words px-3.5 py-3 text-base font-semibold">{part.title}</h3>
        <p className="guide-fold-body whitespace-pre-wrap break-words text-sm leading-6 text-desk">{part.body}</p>
      </article>
    );
  }
  function pick(id: string) {
    setOpenIds((current) => (current.includes(id) ? current : [...current, id]));
    document.getElementById(`manual-part-${id}`)?.scrollIntoView({ block: "nearest" });
  }
  return (
    <div className="space-y-3">
      <PartGlance parts={ready} openId={openIds[openIds.length - 1] ?? ""} onPick={pick} />
      <div className="no-print space-y-2">
        {ready.map((part, index) => (
          <PartFold
            key={part.id}
            part={part}
            toneName={FOLD_TONES[index % FOLD_TONES.length]}
            open={openIds.includes(part.id)}
            onOpen={(id, next) =>
              setOpenIds((current) => (next ? [...new Set([...current, id])] : current.filter((item) => item !== id)))
            }
          />
        ))}
      </div>
      <PrintParts parts={ready} />
    </div>
  );
}

export function FieldQuery({
  id,
  value,
  onChange,
  scope,
  count,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  scope: string;
  count: number | null;
}) {
  return (
    <div className="no-print space-y-2">
      <form role="search" className="flex items-center gap-2" onSubmit={(event) => event.preventDefault()}>
        <label className="sr-only" htmlFor={id}>
          업무 검색
        </label>
        <input
          id={id}
          className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-card px-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          value={value}
          placeholder="어떤 업무를 찾으시나요?"
          onChange={(event) => onChange(event.target.value)}
        />
        {value.trim() ? (
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line bg-card px-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            onClick={() => onChange("")}
          >
            검색어 지우기
          </button>
        ) : null}
      </form>
      {scope ? <p className="text-sm text-quiet">{scope}</p> : null}
      {count !== null ? (
        <p className="text-sm text-desk" aria-live="polite">
          {count === 0 ? "해당하는 업무가 없습니다." : `검색 결과 ${count}건`}
        </p>
      ) : null}
    </div>
  );
}

export function GroupedHandbookResults({
  categories,
  topics,
  categoryId,
  query,
  outside,
}: {
  categories: HandbookCategory[];
  topics: HandbookTopic[];
  categoryId: string;
  query: string;
  outside: ManualHit[];
}) {
  const named = new Map(categories.map((category) => [category.id, category.name]));
  const rows = selectHandbookTopics(categories, topics, categoryId, query);
  const groups = [
    { key: "review", title: "상세 지침 연결 가능", rows: rows.filter((topic) => fieldCardState(topic.id) === "review") },
    { key: "preparing", title: "상세 지침 준비 중", rows: rows.filter((topic) => fieldCardState(topic.id) === "preparing") },
    { key: "hold", title: "연결 확인 필요", rows: rows.filter((topic) => fieldCardState(topic.id) === "hold") },
  ] as const;
  const extra = categoryId ? [] : outside.filter((hit) => !handbookIdForDetail(hit.topic.id));
  return (
    <div className="space-y-4">
      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <section key={group.key} className="space-y-2" aria-label={group.title}>
            <h2 className="text-sm font-medium text-desk">{group.title}</h2>
            <ul className="space-y-2">
              {group.rows.map((topic) => (
                <li key={topic.id}>
                  <HandbookWorkCard topic={topic} categoryName={named.get(topic.categoryId) ?? ""} />
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      {extra.length > 0 ? (
        <section className="space-y-2" aria-label="분야 카드에 없는 기존 본문">
          <h2 className="text-sm font-medium text-desk">분야 카드에 없는 기존 본문</h2>
          <ul className="space-y-2">
            {extra.map((hit) => {
              const title = hit.topic.legacyLabel || hit.topic.title;
              return (
                <li key={hit.topic.id}>
                  <article className="card-surface min-w-0 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="break-words text-sm font-medium text-desk">{title}</h3>
                      <StarButton id={hit.topic.id} title={title} />
                    </div>
                    <p className="mt-1 text-sm text-desk">분야 카드에 없는 기존 본문</p>
                    <p className="mt-1 text-sm text-desk">검토 필요</p>
                    <a
                      className="mt-2 inline-flex min-h-11 items-center text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      href={`/menu/topic/${encodeURIComponent(hit.topic.id)}`}
                    >
                      상세 지침 보기
                    </a>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function linkedManual(topics: ManualTopic[], handbookId: string): ManualTopic | null {
  const detailId = detailIdForHandbook(handbookId);
  if (!detailId) return null;
  return topics.find((topic) => topic.id === detailId) ?? null;
}
