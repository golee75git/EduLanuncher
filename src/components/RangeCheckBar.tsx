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
}

function formatSeconds(value: number): string {
  if (value < 60) {
    return `${value}초`;
  }
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}분 ${seconds}초`;
}

export function RangeCheckBar({ active }: RangeCheckBarProps) {
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

  const total = status?.total ?? 0;
  const done = status?.done ?? 0;
  const found = status?.found ?? 0;
  const ratio = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const remain =
    done > 0 && total > done ? Math.round((elapsed / done) * (total - done)) : null;
  const phaseLabel = status?.phase === "names" ? "이름 확인" : "주소 확인";

  return (
    <div className="card-surface space-y-1.5 p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-quiet">
        <span>
          {phaseLabel} {total > 0 ? `${done}/${total}` : "준비 중"}
          {found > 0 ? ` · 찾음 ${found}` : ""}
        </span>
        <span>
          경과 {formatSeconds(elapsed)}
          {remain != null ? ` · 남음 약 ${formatSeconds(remain)}` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-ink transition-[width] duration-150" style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}
