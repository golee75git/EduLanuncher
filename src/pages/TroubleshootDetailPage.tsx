import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { launchQuickUrl } from "../services/launcherService";
import {
  firstQuestion,
  getQuestion,
  getSolution,
  getTroubleCard,
  isOfficialMicrosoftUrl,
} from "../services/troubleshootingService";
import { TROUBLE_CATEGORY_LABEL, type TroubleCard, type TroubleSolution } from "../types/troubleshooting";

type StepKind = "question" | "confirm" | "solution" | "support" | "done";

interface FlowStep {
  kind: StepKind;
  target?: string;
}

interface TroubleshootDetailPageProps {
  cardId: string;
  onBack: () => void;
  onList: () => void;
  onOpenCard: (cardId: string) => void;
}

function needsConfirm(solution: TroubleSolution): boolean {
  return solution.risk === "caution" || solution.risk === "danger";
}

function resolveTarget(card: TroubleCard, next: string): FlowStep | { kind: "card"; target: string } {
  if (next === "support") {
    return { kind: "support" };
  }
  if (getQuestion(card, next)) {
    return { kind: "question", target: next };
  }
  const solution = getSolution(card, next);
  if (solution) {
    if (solution.risk === "danger" && !solution.prerequisites.some((item) => item.includes("백업"))) {
      return { kind: "support" };
    }
    if (needsConfirm(solution)) {
      return { kind: "confirm", target: next };
    }
    return { kind: "solution", target: next };
  }
  return { kind: "card", target: next };
}

export function TroubleshootDetailPage({ cardId, onBack, onList, onOpenCard }: TroubleshootDetailPageProps) {
  const card = getTroubleCard(cardId);
  const start = useMemo<FlowStep>(
    () => ({ kind: "question", target: card ? firstQuestion(card)?.id : undefined }),
    [card],
  );
  const [history, setHistory] = useState<FlowStep[]>([]);
  const [current, setCurrent] = useState<FlowStep>(start);

  const go = (step: FlowStep) => {
    setHistory((prev) => [...prev, current]);
    setCurrent(step);
  };

  const goBack = () => {
    const prev = history[history.length - 1];
    if (!prev) {
      onBack();
      return;
    }
    setHistory((items) => items.slice(0, -1));
    setCurrent(prev);
  };

  const restart = () => {
    setHistory([]);
    setCurrent(start);
  };

  const follow = (next: string) => {
    if (!card) {
      return;
    }
    const nextStep = resolveTarget(card, next);
    if (nextStep.kind === "card") {
      onOpenCard(nextStep.target);
      return;
    }
    go(nextStep);
  };

  const openSource = (url: string) => {
    if (!isOfficialMicrosoftUrl(url)) {
      return;
    }
    void launchQuickUrl(url);
  };

  if (!card) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper">
        <header className="flex items-center gap-2 px-3 pt-3">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">PC 문제 해결</h1>
        </header>
        <p className="px-3 py-3 text-sm text-quiet">해당 안내를 찾지 못했습니다.</p>
      </div>
    );
  }

  const question = current.kind === "question" && current.target ? getQuestion(card, current.target) : undefined;
  const solutionId = current.kind === "confirm" || current.kind === "solution" ? current.target : undefined;
  const solution = solutionId ? getSolution(card, solutionId) : undefined;
  const related = card.related.map((id) => getTroubleCard(id)).filter((item): item is TroubleCard => Boolean(item));

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={goBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-desk">{card.title}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <p className="text-[11px] text-quiet">{TROUBLE_CATEGORY_LABEL[card.category]}</p>
        <p className="rounded-md bg-ink-soft/60 px-2 py-1.5 text-xs leading-5 text-desk">{card.organizationNotice}</p>

        {current.kind === "question" && question ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-desk">{question.question}</h2>
            <div className="space-y-1">
              {question.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="desk-row"
                  onClick={() => follow(option.next)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {current.kind === "confirm" && solution ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-desk">{solution.name}</h2>
            <p className="text-xs leading-5 text-desk">
              {solution.risk === "danger"
                ? "이 단계는 데이터가 손상될 수 있습니다. 사전 확인을 읽고 진행하세요."
                : "이 단계는 주의가 필요합니다. 사전 확인을 읽고 진행하세요."}
            </p>
            {solution.prerequisites.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-desk">
                {solution.prerequisites.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            <p className="text-[11px] text-quiet">
              예상 시간 {solution.estimatedTime || "—"} · 자료 손실 {solution.dataLossRisk || "—"}
            </p>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="rounded-full bg-ink-soft px-2 py-1 text-[11px] font-medium text-ink"
                onClick={() => go({ kind: "solution", target: solution.id })}
              >
                확인했습니다
              </button>
              <button type="button" className="rounded-full px-2 py-1 text-[11px] text-quiet" onClick={goBack}>
                뒤로
              </button>
            </div>
          </section>
        ) : null}

        {current.kind === "solution" && solution ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-desk">{solution.name}</h2>
            <p className="text-[11px] text-quiet">
              {solution.difficulty}
              {solution.estimatedTime ? ` · ${solution.estimatedTime}` : ""}
              {solution.adminRequired ? " · 관리자 권한이 필요할 수 있습니다" : ""}
            </p>
            <ol className="list-decimal space-y-1.5 pl-4 text-sm leading-5 text-desk">
              {solution.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="rounded-full bg-ink-soft px-2 py-1 text-[11px] font-medium text-ink"
                onClick={() => go({ kind: "done" })}
              >
                해결됐어요
              </button>
              <button
                type="button"
                className="rounded-full px-2 py-1 text-[11px] text-quiet"
                onClick={() => follow(solution.nextIfUnresolved)}
              >
                아직 안 돼요
              </button>
            </div>
          </section>
        ) : null}

        {current.kind === "support" ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-desk">지원 안내</h2>
            <p className="text-sm leading-5 text-desk">{card.support.message}</p>
            {card.support.collect.length > 0 ? (
              <>
                <p className="text-xs font-medium text-desk">담당자에게 알려 주면 좋은 정보</p>
                <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-desk">
                  {card.support.collect.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {current.kind === "done" ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-desk">안내를 마칩니다</h2>
            <p className="text-sm leading-5 text-desk">문제가 해결된 것으로 안내합니다. 같은 증상이 다시 나면 처음부터 볼 수 있습니다.</p>
          </section>
        ) : null}

        {related.length > 0 ? (
          <section className="space-y-1">
            <h2 className="desk-label">관련 안내</h2>
            {related.map((item) => (
              <button key={item.id} type="button" className="desk-row" onClick={() => onOpenCard(item.id)}>
                {item.title}
              </button>
            ))}
          </section>
        ) : null}

        {card.sources.length > 0 ? (
          <section className="space-y-1">
            <h2 className="desk-label">공식 안내</h2>
            {card.sources.map((source) => (
              <button
                key={source.url}
                type="button"
                className="desk-row text-left"
                onClick={() => openSource(source.url)}
              >
                <span className="min-w-0 flex-1 truncate">{source.title}</span>
                <span className="ml-2 shrink-0 text-[11px] text-quiet">{source.publisher}</span>
              </button>
            ))}
          </section>
        ) : null}

        <div className="flex flex-wrap gap-1 pt-1">
          <button type="button" className="rounded-full px-2 py-1 text-[11px] text-quiet" onClick={onList}>
            목록
          </button>
          <button type="button" className="rounded-full px-2 py-1 text-[11px] text-quiet" onClick={restart}>
            처음부터
          </button>
        </div>
      </div>
    </div>
  );
}
