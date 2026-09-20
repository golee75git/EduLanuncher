import type { WorkflowStep } from "../types/topic";

interface WorkflowViewProps {
  steps: WorkflowStep[];
}

export function WorkflowView({ steps }: WorkflowViewProps) {
  if (steps.length === 0) {
    return null;
  }
  return (
    <p className="text-sm leading-6 text-desk">
      {steps.map((step, index) => (
        <span key={`${step.order}-${step.title}`}>
          {step.title}
          {index < steps.length - 1 ? <span className="text-quiet"> → </span> : null}
        </span>
      ))}
    </p>
  );
}

export function workflowPreview(steps: WorkflowStep[], limit = 6): string {
  const titles = steps.slice(0, limit).map((step) => step.title);
  if (steps.length > limit) {
    titles.push("…");
  }
  return titles.join(" → ");
}
