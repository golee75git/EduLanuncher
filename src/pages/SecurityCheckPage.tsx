import { AlertTriangle, ArrowLeft, Check, LoaderCircle, Pause, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  SECURITY_ROWS,
  beginSecurityCheck,
  haltSecurityCheck,
  listenSecurityCheck,
  openSecuritySetting,
  type SecurityReport,
  type SecurityRow,
  type SecurityStatus,
} from "../services/securityCheckService";

interface SecurityCheckPageProps {
  onBack: () => void;
  onOpenHelp: (cardId: string) => void;
}

const PAGE_LABEL: Record<string, string> = {
  update: "Windows 업데이트 열기",
  defender: "Windows 보안 열기",
  firewall: "방화벽 설정 열기",
  lock: "화면 잠금 설정 열기",
};

export function SecurityCheckPage({ onBack, onOpenHelp }: SecurityCheckPageProps) {
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  const [rows, setRows] = useState<SecurityRow[]>(SECURITY_ROWS);
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [techOpen, setTechOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closed = false;
    void listenSecurityCheck((note) => {
      if (closed) {
        return;
      }
      if (note.kind === "step") {
        setRows((current) =>
          current.map((row) => (row.id === note.id ? { ...row, status: asStatus(note.status), label: note.label || row.label } : row)),
        );
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
    setRows(SECURITY_ROWS.map((row, index) => (index === 0 ? { ...row, status: "checking", label: "점검 중" } : row)));
    setPhase("run");
    try {
      await beginSecurityCheck();
    } catch (error) {
      setPhase("idle");
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
        <ShieldCheck className="h-4 w-4 shrink-0 text-desk" aria-hidden="true" />
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">보안 상태 점검</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {phase === "idle" ? (
          <section className="card-surface space-y-3 p-3">
            <p className="text-sm leading-6 text-desk">이 PC의 업데이트, 백신, 방화벽 등 기본 보안 상태를 확인합니다.</p>
            <p className="text-xs leading-5 text-quiet">설정을 바꾸지 않습니다. 점검 시작을 누를 때만 이 PC에서 확인합니다.</p>
            <button type="button" className="btn-primary" onClick={() => void start()}>
              점검 시작
            </button>
          </section>
        ) : (
          <>
            <p className="text-sm text-desk">{phase === "run" ? "기본 보안 상태를 확인하고 있습니다." : report?.finding || "확인된 내용"}</p>
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.id} className="card-surface space-y-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <StatusMark status={row.status} />
                    <span className="min-w-0 flex-1 truncate text-sm text-desk">{row.title}</span>
                    <span className="shrink-0 text-xs text-quiet">{row.label}</span>
                  </div>
                  {phase === "done" && row.finding ? <p className="whitespace-pre-line text-sm leading-6 text-desk">{row.finding}</p> : null}
                  {phase === "done" && row.advice ? (
                    <>
                      <p className="text-xs font-medium text-desk">해결방법</p>
                      <p className="whitespace-pre-line text-sm leading-6 text-desk">{row.advice}</p>
                    </>
                  ) : null}
                  {phase === "done" && row.page && PAGE_LABEL[row.page] ? (
                    <button type="button" className="btn-secondary" onClick={() => void openSecuritySetting(row.page).catch(() => setNotice("설정 화면을 열 수 없습니다."))}>
                      {PAGE_LABEL[row.page]}
                    </button>
                  ) : null}
                  {phase === "done" && row.helpId ? (
                    <button type="button" className="btn-secondary" onClick={() => onOpenHelp(row.helpId)}>
                      해결방법 자세히
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {phase === "run" ? (
              <button type="button" className="btn-secondary" onClick={() => void haltSecurityCheck()}>
                점검 취소
              </button>
            ) : null}
            {report ? (
              <section className="card-surface space-y-3 p-3">
                <div className="space-y-2">
                  <button type="button" className="btn-secondary" onClick={() => void start()}>
                    다시 점검
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void copyReport()}>
                    점검결과 복사
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => onOpenHelp(report.helpId || "security-general")}>
                    해결방법 자세히
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

function asStatus(value: string): SecurityStatus {
  if (value === "checking" || value === "waiting" || value === "success" || value === "warning" || value === "error" || value === "unconfirmed" || value === "skipped") {
    return value;
  }
  return "unconfirmed";
}

function StatusMark({ status }: { status: SecurityStatus }) {
  const label = status === "success" ? "정상" : status === "error" ? "문제 발견" : status === "checking" ? "점검 중" : status === "waiting" ? "대기" : status === "unconfirmed" ? "확인 불가" : "확인 필요";
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-desk" title={label} aria-label={label}>
      {status === "success" ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "error" ? <X className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "warning" ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "unconfirmed" || status === "skipped" || status === "waiting" ? <Pause className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "checking" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
    </span>
  );
}
