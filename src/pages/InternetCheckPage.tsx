import { AlertTriangle, ArrowLeft, Check, LoaderCircle, Pause, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SpeedSiteDialog } from "../components/SpeedSiteDialog";
import {
  beginLinkCheck,
  haltLinkCheck,
  LINK_ROWS,
  listenLinkCheck,
  openPcSetting,
  type LinkReport,
  type LinkRow,
  type LinkStatus,
} from "../services/internetCheckService";

interface InternetCheckPageProps {
  onBack: () => void;
  onOpenHelp: (cardId: string) => void;
}

const PAGE_LABEL: Record<string, string> = {
  network: "네트워크 설정 열기",
  wifi: "Wi-Fi 설정 열기",
  proxy: "프록시 설정 열기",
};

export function InternetCheckPage({ onBack, onOpenHelp }: InternetCheckPageProps) {
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  const [rows, setRows] = useState<LinkRow[]>(LINK_ROWS);
  const [report, setReport] = useState<LinkReport | null>(null);
  const [techOpen, setTechOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [speedOpen, setSpeedOpen] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closed = false;
    void listenLinkCheck((note) => {
      if (closed) {
        return;
      }
      if (note.kind === "step") {
        setRows((current) =>
          current.map((row) =>
            row.id === note.id
              ? { ...row, status: asStatus(note.status), label: note.label || row.label }
              : row,
          ),
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
    setSpeedOpen(false);
    setReport(null);
    setRows(LINK_ROWS.map((row, index) => (index === 0 ? { ...row, status: "checking", label: "점검 중" } : row)));
    setPhase("run");
    try {
      await beginLinkCheck();
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

  const showQuality = report?.qualityStatus === "warning" || report?.qualityStatus === "bad";

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">인터넷 연결 점검</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {phase === "idle" ? (
          <section className="card-surface space-y-3 p-3">
            <p className="text-sm leading-6 text-desk">인터넷이 안 될 때 현재 PC의 연결 상태를 단계별로 확인합니다.</p>
            <p className="text-xs leading-5 text-quiet">설정을 바꾸지 않습니다. 점검 시작을 누를 때만 이 PC에서 확인합니다.</p>
            <button type="button" className="btn-primary" onClick={() => void start()}>
              점검 시작
            </button>
          </section>
        ) : (
          <>
            <p className="text-sm text-desk">
              {phase === "run" ? "인터넷 연결 상태를 확인하고 있습니다." : "확인된 내용"}
            </p>
            <ul className="card-surface divide-y divide-line/70">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                  <StatusMark status={row.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-desk">{row.title}</span>
                  <span className="shrink-0 text-xs text-quiet">{row.label}</span>
                </li>
              ))}
            </ul>
            {showQuality && report ? (
              <section className="card-surface space-y-2 p-3">
                <p className="text-sm font-medium text-desk">네트워크 품질</p>
                <div className="flex items-center gap-2">
                  <QualityMark status={report.qualityStatus} />
                  <span className="text-sm text-desk">{qualityLabel(report.qualityStatus)}</span>
                </div>
                <p className="whitespace-pre-line text-sm leading-6 text-desk">{report.qualityText}</p>
                {report.showSpeed ? (
                  <button type="button" className="btn-secondary" onClick={() => setSpeedOpen(true)}>
                    인터넷 속도 측정하기
                  </button>
                ) : null}
              </section>
            ) : null}
            {phase === "run" ? (
              <button type="button" className="btn-secondary" onClick={() => void haltLinkCheck()}>
                점검 취소
              </button>
            ) : null}
            {report ? (
              <section className="card-surface space-y-3 p-3">
                {showQuality ? null : <p className="whitespace-pre-line text-sm leading-6 text-desk">{report.finding}</p>}
                {report.advice ? (
                  <>
                    <p className="text-xs font-medium text-desk">해결방법</p>
                    <p className="text-sm leading-6 text-desk">{report.advice}</p>
                  </>
                ) : null}
                <div className="space-y-2">
                  {report.pages.map((page) => (
                    <button
                      key={page}
                      type="button"
                      className="btn-secondary"
                      onClick={() => void openPcSetting(page === "wifi" || page === "proxy" ? page : "network")}
                    >
                      {PAGE_LABEL[page] ?? "네트워크 설정 열기"}
                    </button>
                  ))}
                  {report.helpId && report.helpId !== "network-ok" ? (
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
                <button
                  type="button"
                  className="text-xs text-ink"
                  onClick={() => setTechOpen((open) => !open)}
                  aria-expanded={techOpen}
                >
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
      {speedOpen ? <SpeedSiteDialog onClose={() => setSpeedOpen(false)} /> : null}
    </div>
  );
}

function qualityLabel(status: string): string {
  if (status === "bad") {
    return "불안정";
  }
  if (status === "warning") {
    return "주의";
  }
  if (status === "unknown") {
    return "측정 불가";
  }
  return "정상";
}

function QualityMark({ status }: { status: string }) {
  const label = qualityLabel(status);
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-desk" title={label} aria-label={label}>
      {status === "good" ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "bad" ? <X className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "warning" ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : null}
      {status === "unknown" ? <Pause className="h-4 w-4" aria-hidden="true" /> : null}
    </span>
  );
}

function asStatus(value: string): LinkStatus {
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

function StatusMark({ status }: { status: LinkStatus }) {
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
