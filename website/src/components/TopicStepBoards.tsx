import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  ClipboardList,
  Coins,
  FileText,
  GraduationCap,
  Handshake,
  HeartPulse,
  KeyRound,
  ListOrdered,
  Package,
  Search,
  ShoppingCart,
  TriangleAlert,
} from "lucide-react";
import type { TopicStep } from "../services/menuContent";

function stepIcon(title: string): LucideIcon {
  if (/요양|재해|사망|병원/.test(title)) return HeartPulse;
  if (/대학|학교|학자/.test(title)) return GraduationCap;
  if (/담당|인증|권한|열쇠/.test(title)) return KeyRound;
  if (/연금|기여|공제|대부|학자금|지급|대금|예산|보수|금액/.test(title)) return Coins;
  if (/품의|결재|기안/.test(title)) return ClipboardList;
  if (/계약|견적/.test(title)) return Handshake;
  if (/구매|구입/.test(title)) return ShoppingCart;
  if (/검수|검사/.test(title)) return Search;
  if (/물품|등록|불용|폐기/.test(title)) return Package;
  if (/일정|기한|휴가|출장|소방/.test(title)) return Calendar;
  if (/서류|문서|접수|증명/.test(title)) return FileText;
  if (/주의|감사/.test(title)) return TriangleAlert;
  return ListOrdered;
}

function lines(value: string[] | undefined): string[] {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

export function TopicStepBoards({ steps }: { steps: TopicStep[] }) {
  const [open, setOpen] = useState(0);
  const ready = steps.filter((step) => step.title.trim());
  if (ready.length === 0) return null;
  const current = ready[open] ?? ready[0];
  const documents = lines(current.documents);
  const caveats = lines(current.caveats);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-desk">업무 흐름</h2>
        <ol className="m-0 flex list-none flex-col gap-2 p-0 sm:flex-row sm:flex-wrap sm:items-stretch">
          {ready.map((step, index) => {
            const Icon = stepIcon(step.title);
            const selected = index === open;
            return (
              <li key={`${step.order}-${step.title}`} className="flex flex-col sm:flex-row sm:items-center">
                <button
                  type="button"
                  aria-pressed={selected}
                  className={`w-full rounded-xl border px-3 py-2 text-left shadow-card sm:w-auto sm:min-w-32 sm:max-w-44 sm:flex-1 ${
                    selected ? "border-ink bg-ink-soft" : "border-line bg-card"
                  }`}
                  onClick={() => setOpen(index)}
                >
                  <Icon className="mb-1 h-4 w-4 text-ink" aria-hidden />
                  <span className="block text-[11px] text-quiet">{step.order || index + 1}</span>
                  <span className="block text-sm leading-5 text-desk">{step.title}</span>
                </button>
                {index < ready.length - 1 ? (
                  <span className="py-0.5 text-center text-[11px] text-quiet sm:px-1" aria-hidden>
                    <span className="sm:hidden">↓</span>
                    <span className="hidden sm:inline">→</span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {current.note || current.pages || current.href || documents.length > 0 || caveats.length > 0 ? (
          <div className="rounded-xl border border-line bg-card px-3 py-2 text-sm leading-6 text-desk">
            <p className="text-[11px] text-quiet">
              {current.order || open + 1}. {current.title}
            </p>
            {current.note ? <p className="mt-1 whitespace-pre-wrap">{current.note}</p> : null}
            {documents.length > 0 ? (
              <div className="mt-2">
                <p className="text-[11px] text-quiet">이 단계의 서류</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {documents.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {caveats.length > 0 ? (
              <div className="mt-2">
                <p className="text-[11px] text-quiet">이 단계의 주의</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {caveats.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {current.pages ? <p className="mt-1 text-[11px] text-quiet">{current.pages}</p> : null}
            {current.href?.startsWith("/menu/handbook/") ? (
              <a className="mt-2 inline-block text-sm text-ink" href={current.href}>
                이 업무 열기
              </a>
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-desk">한눈에 보기</h2>
        <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
          {ready.map((step, index) => {
            const Icon = stepIcon(step.title);
            const selected = index === open;
            return (
              <li key={`glance-${step.order}-${step.title}`} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={selected}
                  className={`flex max-w-40 items-center gap-1 rounded-lg border px-2 py-1.5 text-left text-xs leading-4 text-desk ${
                    selected ? "border-ink bg-ink-soft" : "border-line bg-card"
                  }`}
                  onClick={() => setOpen(index)}
                >
                  <Icon className="h-4 w-4 shrink-0 text-ink" aria-hidden />
                  <span>{step.title}</span>
                </button>
                {index < ready.length - 1 ? (
                  <span className="text-[11px] text-quiet" aria-hidden>
                    →
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
