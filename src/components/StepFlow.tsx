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

export interface VisualStep {
  order: number;
  title: string;
  explanation?: string;
  pages?: string;
  documents?: string[];
  caveats?: string[];
}

const STEP_TINT = ["bg-zone-tools", "bg-zone-notice", "bg-zone-todo", "bg-zone-recent", "bg-ink-soft"] as const;

function stepIcon(title: string): LucideIcon {
  if (/요양|재해|사망|병원/.test(title)) {
    return HeartPulse;
  }
  if (/대학|학교|학자/.test(title)) {
    return GraduationCap;
  }
  if (/담당|인증|권한|열쇠/.test(title)) {
    return KeyRound;
  }
  if (/연금|기여|공제|대부|학자금/.test(title)) {
    return Coins;
  }
  if (/지급|대금|예산|보수|금액/.test(title)) {
    return Coins;
  }
  if (/품의|결재|기안/.test(title)) {
    return ClipboardList;
  }
  if (/계약|견적/.test(title)) {
    return Handshake;
  }
  if (/구매|구입/.test(title)) {
    return ShoppingCart;
  }
  if (/검수|검사/.test(title)) {
    return Search;
  }
  if (/물품|등록|불용|폐기/.test(title)) {
    return Package;
  }
  if (/일정|기한|휴가|출장|소방/.test(title)) {
    return Calendar;
  }
  if (/서류|문서|접수|증명/.test(title)) {
    return FileText;
  }
  if (/주의|감사/.test(title)) {
    return TriangleAlert;
  }
  return ListOrdered;
}

interface StepFlowProps {
  steps: VisualStep[];
}

export function StepFlow({ steps }: StepFlowProps) {
  const [open, setOpen] = useState(0);
  if (steps.length === 0) {
    return null;
  }
  const current = steps[open] ?? steps[0];

  return (
    <div className="@container space-y-3">
      <section>
        <h3 className="desk-label">업무 흐름</h3>
        <ol className="m-0 flex list-none flex-col p-0 @min-[28rem]:flex-row @min-[28rem]:flex-wrap @min-[28rem]:items-stretch">
          {steps.map((step, index) => {
            const Icon = stepIcon(step.title);
            const selected = index === open;
            return (
              <li key={`${step.order}-${step.title}`} className="flex flex-col @min-[28rem]:flex-row @min-[28rem]:items-center">
                <button
                  type="button"
                  aria-pressed={selected}
                  className={`w-full rounded-xl border px-2.5 py-2 text-left shadow-card @min-[28rem]:w-auto @min-[28rem]:min-w-[7.5rem] @min-[28rem]:max-w-[11rem] @min-[28rem]:flex-1 ${
                    STEP_TINT[index % STEP_TINT.length]
                  } ${selected ? "border-ink" : "border-line"}`}
                  onClick={() => setOpen(index)}
                >
                  <Icon className="mb-1 h-4 w-4 text-ink" aria-hidden />
                  <span className="block text-[11px] text-quiet">{step.order}</span>
                  <span className="block text-sm leading-5 text-desk">{step.title}</span>
                </button>
                {index < steps.length - 1 ? (
                  <span className="py-0.5 text-center text-[11px] text-quiet @min-[28rem]:px-1" aria-hidden>
                    <span className="@min-[28rem]:hidden">↓</span>
                    <span className="hidden @min-[28rem]:inline">→</span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {current?.explanation || current?.pages || (current?.documents?.length ?? 0) > 0 || (current?.caveats?.length ?? 0) > 0 ? (
          <div className="mt-2 rounded-xl border border-line bg-card px-2.5 py-2 text-sm leading-6 text-desk">
            <p className="text-[11px] text-quiet">
              {current.order}. {current.title}
            </p>
            {current.explanation ? <p className="mt-1 whitespace-pre-wrap">{current.explanation}</p> : null}
            {current.documents && current.documents.length > 0 ? (
              <div className="mt-2">
                <p className="text-[11px] text-quiet">이 단계의 서류</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {current.documents.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {current.caveats && current.caveats.length > 0 ? (
              <div className="mt-2">
                <p className="text-[11px] text-quiet">이 단계의 주의</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {current.caveats.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {current.pages ? <p className="mt-1 text-[11px] text-quiet">{current.pages}</p> : null}
          </div>
        ) : null}
      </section>
      <section>
        <h3 className="desk-label">한눈에 보기</h3>
        <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0">
          {steps.map((step, index) => {
            const Icon = stepIcon(step.title);
            const selected = index === open;
            return (
              <li key={`glance-${step.order}-${step.title}`} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={selected}
                  className={`flex max-w-[8.5rem] items-center gap-1 rounded-lg border px-2 py-1.5 text-left text-xs leading-4 text-desk ${
                    selected ? "border-ink bg-ink-soft" : "border-line bg-card"
                  }`}
                  onClick={() => setOpen(index)}
                >
                  <Icon className="h-4 w-4 shrink-0 text-ink" aria-hidden />
                  <span>{step.title}</span>
                </button>
                {index < steps.length - 1 ? (
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
