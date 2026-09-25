import type { TopicDetailStep, WorkflowStep } from "../types/topic";

interface WorkflowViewProps {
  steps: WorkflowStep[];
  notes?: TopicDetailStep[];
}

function pagesLabel(pages: number[]): string {
  if (pages.length === 0) {
    return "";
  }
  return `인쇄 ${pages.join("·")}쪽`;
}

export function WorkflowView({ steps, notes = [] }: WorkflowViewProps) {
  if (steps.length === 0) {
    return null;
  }
  return (
    <ol className="m-0 list-none space-y-0 p-0">
      {steps.map((step, index) => {
        const note = notes.find((item) => item.workflowTitle === step.title);
        return (
          <li key={`${step.order}-${step.title}`} className="flex flex-col items-stretch">
            <div className="rounded-lg border border-line bg-card px-2.5 py-2 text-sm leading-5 text-desk">
              <span className="mr-1.5 text-[11px] text-quiet">{step.order}</span>
              {step.title}
              {step.description ? (
                <p className="mt-1 text-xs leading-5 text-quiet">{step.description}</p>
              ) : null}
              {note ? (
                <>
                  <p className="mt-1 text-xs leading-5 text-desk">{note.explanation}</p>
                  {note.printPages.length > 0 ? (
                    <p className="mt-1 text-[11px] text-quiet">{pagesLabel(note.printPages)}</p>
                  ) : null}
                </>
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <p className="py-1 text-center text-[11px] text-quiet" aria-hidden>
                ↓
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function workflowPreview(steps: WorkflowStep[], limit = 6): string {
  const titles = steps.slice(0, limit).map((step) => step.title);
  if (steps.length > limit) {
    titles.push("…");
  }
  return titles.join(" → ");
}
