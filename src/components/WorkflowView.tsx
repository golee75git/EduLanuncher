import type { WorkflowStep } from "../types/topic";

interface WorkflowViewProps {
  steps: WorkflowStep[];
}

export function WorkflowView({ steps }: WorkflowViewProps) {
  if (steps.length === 0) {
    return null;
  }
  return (
    <ol className="m-0 list-none space-y-0 p-0">
      {steps.map((step, index) => (
        <li key={`${step.order}-${step.title}`} className="flex flex-col items-stretch">
          <div className="rounded-lg border border-line bg-card px-2.5 py-2 text-sm leading-5 text-desk">
            <span className="mr-1.5 text-[11px] text-quiet">{step.order}</span>
            {step.title}
          </div>
          {index < steps.length - 1 ? (
            <p className="py-1 text-center text-[11px] text-quiet" aria-hidden>
              ↓
            </p>
          ) : null}
        </li>
      ))}
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
