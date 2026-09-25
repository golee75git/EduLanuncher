import type { TopicComparison, TopicDecision, TopicDetailContent, TopicFlowStep, TopicGlance, TopicMetric, WorkflowStep } from "../types/topic";

interface NotebookFlowStep {
  step_no?: number;
  step_name?: string;
  description?: string;
  required_docs?: string[];
  caveats?: string[];
}

interface NotebookOption {
  button_label?: string;
  action_method?: string;
  required_docs?: string[];
  caveats?: string[];
  next_step?: string;
}

export interface NotebookTopicPack {
  topic_id?: string;
  purpose?: string;
  easy_explanation?: string;
  source_doc?: string;
  source_page?: string;
  box_flowchart?: NotebookFlowStep[];
  conditional_options?: {
    condition_group_label?: string;
    options?: NotebookOption[];
  };
  summary_infographic?: Array<{ step_name?: string; short_desc?: string }>;
  chart_data?: { metrics?: Array<{ label?: string; value?: string }> };
  accordion_details?: {
    timeline_due_dates?: Array<{ event?: string; due_date?: string }>;
    checklist?: string[];
    required_documents?: string[];
    comparison_tables?: Array<{ title?: string; headers?: string[]; rows?: string[][] }>;
    caveats_and_audit_checks?: string[];
    overview_and_purpose?: string;
  };
  search_queries?: {
    official_term?: string;
    natural_queries?: string[];
    novice_queries?: string[];
  };
}

export interface NotebookTopicPatch {
  description: string;
  beginnerSummary: string;
  workflow: WorkflowStep[];
  queries: string[];
  detail: TopicDetailContent;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => text(item)).filter(Boolean);
}

export function mapNotebookPack(pack: NotebookTopicPack): NotebookTopicPatch | null {
  const purpose = text(pack.purpose);
  const easy = text(pack.easy_explanation);
  const steps = pack.box_flowchart ?? [];
  if (!purpose || !easy || steps.length === 0) {
    return null;
  }
  const flowchart: TopicFlowStep[] = steps
    .map((step, index) => ({
      order: Number(step.step_no) || index + 1,
      title: text(step.step_name),
      explanation: text(step.description),
      documents: list(step.required_docs),
      caveats: list(step.caveats),
    }))
    .filter((step) => step.title && step.explanation);
  const options = pack.conditional_options?.options ?? [];
  const branches = options
    .map((option) => ({
      when: text(option.button_label),
      result: text(option.action_method),
      documents: list(option.required_docs),
      caution: list(option.caveats).join(" "),
      nextStep: text(option.next_step),
    }))
    .filter((branch) => branch.when && branch.result);
  const decision: TopicDecision | undefined =
    text(pack.conditional_options?.condition_group_label) && branches.length > 0
      ? { condition: text(pack.conditional_options?.condition_group_label), branches }
      : undefined;
  const glance: TopicGlance[] = (pack.summary_infographic ?? [])
    .map((item) => ({ title: text(item.step_name), text: text(item.short_desc) }))
    .filter((item) => item.title && item.text);
  const metrics: TopicMetric[] = (pack.chart_data?.metrics ?? [])
    .map((item) => ({ label: text(item.label), value: text(item.value) }))
    .filter((item) => item.label && item.value);
  const comparisons: TopicComparison[] = (pack.accordion_details?.comparison_tables ?? [])
    .map((table) => ({
      title: text(table.title),
      headers: list(table.headers),
      rows: (table.rows ?? [])
        .filter((row) => Array.isArray(row))
        .map((row) => row.map((cell) => text(cell))),
    }))
    .filter((table) => table.title && table.headers.length >= 2 && table.rows.length > 0);
  const queries = [
    text(pack.search_queries?.official_term),
    ...list(pack.search_queries?.natural_queries),
    ...list(pack.search_queries?.novice_queries),
  ].filter(Boolean);
  const detail: TopicDetailContent = {
    externalTopicId: text(pack.topic_id),
    purpose,
    easyExplanation: easy,
    flowchart,
    ...(decision ? { decision } : {}),
    timeline: (pack.accordion_details?.timeline_due_dates ?? [])
      .map((item) => ({ label: text(item.event), text: text(item.due_date) }))
      .filter((item) => item.label && item.text),
    checklist: list(pack.accordion_details?.checklist),
    ...(comparisons.length > 0 ? { comparisons } : {}),
    ...(glance.length > 0 ? { glance } : {}),
    ...(metrics.length > 0 ? { metrics } : {}),
    guideDocuments: list(pack.accordion_details?.required_documents),
    auditNotes: list(pack.accordion_details?.caveats_and_audit_checks),
    naturalQueries: queries,
    reviewNotes: [
      "금액, 기간, 산식은 첨부 자료에 적힌 문장입니다. 편람 PDF와 다시 대조하지 않았습니다.",
      "조건에는 중복 지급, 유의사항에는 중급 지급으로 적혀 있어 어느 쪽으로도 고치지 않았습니다.",
    ],
    sourceNote: {
      title: text(pack.source_doc) || "업무 참고자료",
      pages: text(pack.source_page) || "쪽수 확인 필요",
      status: "needs-review",
    },
  };
  return {
    description: purpose,
    beginnerSummary: easy,
    workflow: flowchart.map((step) => ({ order: step.order, title: step.title })),
    queries,
    detail,
  };
}
