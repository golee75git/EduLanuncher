import { AlertTriangle, ArrowLeft, Check, LoaderCircle, Pause, Printer, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  beginPrintCheck,
  carryPrintCheck,
  haltPrintCheck,
  listenPrintCheck,
  openPrintView,
  PRINT_ROWS,
  type PrintChoice,
  type PrintReport,
  type PrintRow,
  type PrintStatus,
} from "../services/printerCheckService";

interface PrinterCheckPageProps {
  onBack: () => void;
  onOpenHelp: (cardId: string) => void;
}

export function PrinterCheckPage({ onBack, onOpenHelp }: PrinterCheckPageProps) {
  const [phase, setPhase] = useState<"idle" | "run" | "pick" | "done">("idle");
  const [rows, setRows] = useState<PrintRow[]>(PRINT_ROWS);
  const [report, setReport] = useState<PrintReport | null>(null);
  const [choices, setChoices] = useState<PrintChoice[]>([]);
  const [picked, setPicked] = useState("");
  const [techOpen, setTechOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closed = false;
    void listenPrintCheck((note) => {
      if (closed) {
        return;
      }
      if (note.kind === "step") {
        setRows((current) =>
          current.map((row) =>
            row.id === note.id ? { ...row, status: asStatus(note.status), label: note.label || row.label } : row,
          ),
        );
        return;
      }
      if (note.kind === "choose") {
        const list = note.choices ?? [];
        setChoices(list);
        setPicked(preferred(list));
        setPhase("pick");
        return;
      }
      if (note.kind === "done" && note.report) {
        setReport(note.report);
        setRows(note.report.rows);
        setPhase("done");
      }
    }).then((stop) => {
      if (closed) {
        stop();
        return;
      }
      unlisten = stop;
    });
    return () => {
      closed = true;
      unlisten?.();
    };
  }, []);

  const start = async () => {
    setNotice("");
    setTechOpen(false);
    setReport(null);
    setChoices([]);
    setPicked("");
    setRows(PRINT_ROWS.map((row, index) => (index === 0 ? { ...row, status: "checking", label: "점검 중" } : row)));
    setPhase("run");
    try {
      await beginPrintCheck();
    } catch (error) {
      setPhase("idle");
      setNotice(error instanceof Error ? error.message : "점검을 시작하지 못했습니다.");
    }
  };

  const carry = async () => {
    if (!picked) {
      return;
    }
    setNotice("");
    setPhase("run");
    setRows((current) =>
      current.map((row) => (row.id === "state" ? { ...row, status: "checking", label: "점검 중" } : row)),
    );
    try {
      await carryPrintCheck(picked);
    } catch (error) {
      setPhase("pick");
      setNotice(error instanceof Error ? error.message : "점검을 시작하지 못했습니다.");
    }
  };

  const copyReport = async () => {
    if (!report) {
      return;
    }
    try {
      await navigator.clipboard.writeText(report.copyText);
      setNotice("점검 결과를 복사했습니다.");
    } catch {
      setNotice("복사하지 못했습니다.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Printer className="h-4 w-4 shrink-0 text-desk" aria-hidden="true" />
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">프린터 출력 점검</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {phase === "idle" ? (
          <section className="card-surface space-y-3 p-3">
            <p className="text-sm leading-6 text-desk">프린터 출력이 안 될 때 현재 PC의 프린터 상태를 단계별로 확인합니다.</p>
            <p className="text-xs leading-5 text-quiet">설정을 바꾸지 않습니다. 점검 시작을 누를 때만 이 PC에서 확인합니다.</p>
            <button type="button" className="btn-primary" onClick={() => void start()}>
              점검 시작
            </button>
          </section>
        ) : (
          <>
            <p className="text-sm text-desk">
              {phase === "run" ? "프린터 상태를 확인하고 있습니다." : phase === "pick" ? "어떤 프린터를 점검할까요?" : "확인된 내용"}
            </p>
            {report?.printerName ? <p className="text-xs text-quiet">프린터: {report.printerName}</p> : null}
            <ul className="card-surface divide-y divide-line/70">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                  <StatusMark status={row.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-desk">{row.title}</span>
                  <span className="shrink-0 text-xs text-quiet">{row.label}</span>
                </li>
              ))}
            </ul>
            {phase === "pick" ? (
              <section className="card-surface space-y-2 p-3">
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {choices.map((item) => (
                    <label key={item.name} className="flex items-start gap-2 py-1 text-sm text-desk">
                      <input
                        type="radio"
                        name="print-choice"
                        className="mt-1"
                        checked={picked === item.name}
                        onChange={() => setPicked(item.name)}
                      />
                      <span>
                        {item.name}
                        {item.isDefault ? " (기본 프린터)" : ""}
                        {item.virtualDevice ? " (가상 프린터)" : ""}
                      </span>
                    </label>
                  ))}
                </div>
                <button type="button" className="btn-primary" disabled={!picked} onClick={() => void carry()}>
                  선택한 프린터 점검
                </button>
              </section>
            ) : null}
            {phase === "run" ? (
              <button type="button" className="btn-secondary" onClick={() => void haltPrintCheck()}>
                점검 취소
              </button>
            ) : null}
            {report ? (
              <section className="card-surface space-y-3 p-3">
                <p className="whitespace-pre-line text-sm leading-6 text-desk">{report.finding}</p>
                {report.advice ? (
                  <>
                    <p className="text-xs font-medium text-desk">해결방법</p>
                    <p className="whitespace-pre-line text-sm leading-6 text-desk">{report.advice}</p>
                  </>
                ) : null}
                <div className="space-y-2">
                  {report.pages.includes("queue") && report.printerName ? (
                    <button type="button" className="btn-secondary" onClick={() => void openPrintView("queue", report.printerName)}>
                      인쇄 대기열 열기
                    </button>
                  ) : null}
                  {report.pages.includes("printers") ? (
                    <button type="button" className="btn-secondary" onClick={() => void openPrintView("printers")}>
                      프린터 설정 열기
                    </button>
                  ) : null}
                  {report.helpId ? (
                    <button type="button" className="btn-secondary" onClick={() => onOpenHelp(report.helpId)}>
                      해결방법 자세히
                    </button>
                  ) : null}
                  <button type="button" className="btn-secondary" onClick={() => void start()}>
                    다시 점검
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void copyReport()}>
                    점검결과 복사
                  </button>
                </div>
                <button type="button" className="text-xs text-ink" onClick={() => setTechOpen((open) => !open)} aria-expanded={techOpen}>
                  {techOpen ? "기술정보 숨기기" : "기술정보 보기"}
                </button>
                {techOpen ? (
                  <dl className="space-y-2">
                    {report.technical.map((line) => (
                      <div key={`${line.label}-${line.value}`}>
                        <dt className="text-[11px] text-quiet">{line.label}</dt>
                        <dd className="break-all text-sm text-desk">{line.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </section>
            ) : null}
          </>
        )}
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
      </div>
    </div>
  );
}

function preferred(list: PrintChoice[]): string {
  const marked = list.find((item) => item.isDefault && !item.virtualDevice) ?? list.find((item) => !item.virtualDevice) ?? list[0];
  return marked?.name ?? "";
}

function asStatus(value: string): PrintStatus {
  if (
    value === "checking" ||
    value === "waiting" ||
    value === "success" ||
    value === "warning" ||
    value === "error" ||
    value === "unconfirmed" ||
    value === "skipped"
  ) {
    return value;
  }
  return "warning";
}

function StatusMark({ status }: { status: PrintStatus }) {
  const label =
    status === "success"
      ? "정상"
      : status === "error"
        ? "문제 발견"
        : status === "checking"
          ? "점검 중"
          : status === "waiting"
            ? "대기"
            : status === "skipped"
              ? "확인 불가"
              : "확인 필요";
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-desk" title={label} aria-label={label}>
      {status === "success" ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "error" ? <X className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "warning" || status === "unconfirmed" ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "skipped" || status === "waiting" ? <Pause className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "checking" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
    </span>
  );
}
