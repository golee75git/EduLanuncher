import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

interface RangeCheckStatus {
  phase: string;
  done: number;
  total: number;
  found: number;
}

interface RangeCheckBarProps {
  active: boolean;
  waitMs?: number;
  plannedTotal?: number;
}

function formatSeconds(value: number): string {
  const safe = Math.max(0, Math.round(value));
  if (safe < 60) {
    return `${safe}초`;
  }
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}분 ${seconds}초`;
}

function remainSeconds(
  total: number,
  done: number,
  elapsed: number,
  phase: string,
  waitMs: number,
): number {
  const left = Math.max(0, total - done);
  if (left === 0) {
    return 0;
  }
  if (done > 0 && elapsed > 0) {
    return Math.max(1, Math.round((elapsed / done) * left));
  }
  const workers = phase === "names" ? 8 : 24;
  const ms = phase === "names" ? 600 : waitMs;
  const rounds = Math.ceil(left / workers);
  return Math.max(1, Math.ceil((rounds * ms) / 1000));
}

export function RangeCheckBar({ active, waitMs = 400, plannedTotal = 0 }: RangeCheckBarProps) {
  const [status, setStatus] = useState<RangeCheckStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatus(null);
      setElapsed(0);
      return;
    }
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<RangeCheckStatus>("range-check-status", (event) => {
      setStatus(event.payload);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      stop = unlisten;
    });
    return () => {
      disposed = true;
      window.clearInterval(timer);
      stop?.();
    };
  }, [active]);

  if (!active) {
    return null;
  }

  const total = status?.total || plannedTotal || 0;
  const done = status?.done ?? 0;
  const found = status?.found ?? 0;
  const ratio = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const phase = status?.phase === "names" ? "names" : "host";
  const remain = total > 0 ? remainSeconds(total, done, elapsed, phase, waitMs) : null;
  const expected = remain != null ? elapsed + remain : null;
  const phaseLabel = phase === "names" ? "이름 확인" : "주소 확인";

  return (
    <div className="card-surface space-y-1.5 p-3">
      <div className="space-y-0.5 text-xs text-quiet">
        <p>
          {phaseLabel} {total > 0 ? `${done}/${total}` : "준비 중"}
          {found > 0 ? ` · 찾음 ${found}` : ""}
        </p>
        <p>예상 {expected != null ? `약 ${formatSeconds(expected)}` : "계산 중"}</p>
        <p>
          경과 {formatSeconds(elapsed)}
          {remain != null ? ` · 남음 약 ${formatSeconds(remain)}` : ""}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-ink transition-[width] duration-150" style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}
