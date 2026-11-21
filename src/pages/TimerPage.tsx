import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import {
  COUNTDOWN_PRESETS,
  MAX_COUNTDOWN_MS,
  countdownRemaining,
  formatCountdown,
  formatStopwatch,
  stopwatchElapsed,
} from "../services/timerService";
import { useTimerStore } from "../stores/timerStore";

interface TimerPageProps {
  onBack: () => void;
}

type Tab = "countdown" | "stopwatch";

/** 화면에 보이는 동안만 지금 시각을 갱신한다. 값 계산은 저장된 시각 기준이라 갱신이 늦어도 어긋나지 않는다. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) {
      return undefined;
    }
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function clampInput(value: string, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.min(n, max);
}

export function TimerPage({ onBack }: TimerPageProps) {
  const [tab, setTab] = useState<Tab>("countdown");
  const countdown = useTimerStore((s) => s.countdown);
  const stopwatch = useTimerStore((s) => s.stopwatch);
  const alarmActive = useTimerStore((s) => s.alarmActive);
  const store = useTimerStore.getState;

  const running = countdown.status === "running" || stopwatch.running;
  const now = useNow(running);

  const remaining = countdownRemaining(countdown, now);
  const elapsed = stopwatchElapsed(stopwatch, now);
  const editable = countdown.status === "idle" || countdown.status === "done";

  const totalSec = Math.floor(countdown.durationMs / 1000);
  const [minText, setMinText] = useState(String(Math.floor(totalSec / 60)));
  const [secText, setSecText] = useState(String(totalSec % 60));

  useEffect(() => {
    const sec = Math.floor(countdown.durationMs / 1000);
    setMinText(String(Math.floor(sec / 60)));
    setSecText(String(sec % 60));
  }, [countdown.durationMs]);

  const applyInputs = (minutes: string, seconds: string) => {
    const ms = (clampInput(minutes, 5999) * 60 + clampInput(seconds, 59)) * 1000;
    store().setDuration(Math.min(ms, MAX_COUNTDOWN_MS));
  };

  const startLabel = countdown.status === "paused" ? "계속" : countdown.status === "done" ? "다시 시작" : "시작";

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">타이머·스톱워치</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "countdown"}
            className={tab === "countdown" ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab("countdown")}
          >
            타이머{countdown.status === "running" ? " ●" : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stopwatch"}
            className={tab === "stopwatch" ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab("stopwatch")}
          >
            스톱워치{stopwatch.running ? " ●" : ""}
          </button>
        </div>

        {tab === "countdown" ? (
          <>
            {alarmActive ? (
              <div className="rounded-lg border border-line bg-card px-3 py-3 text-center" role="alert">
                <p className="text-sm font-semibold text-desk">시간이 다 되었습니다.</p>
                <button type="button" className="btn-secondary mt-2" onClick={() => store().dismissAlarm()}>
                  확인
                </button>
              </div>
            ) : null}
            <div className="rounded-lg border border-line bg-card px-3 py-6 text-center">
              <p
                className="text-5xl font-semibold tabular-nums text-desk"
                aria-live="off"
                aria-label={`남은 시간 ${formatCountdown(remaining)}`}
              >
                {formatCountdown(remaining)}
              </p>
              <p className="mt-2 text-xs text-quiet">
                {countdown.status === "running"
                  ? "남은 시간을 세고 있습니다. 패널을 닫아도 계속 갑니다."
                  : countdown.status === "paused"
                    ? "일시정지"
                    : countdown.status === "done"
                      ? "종료"
                      : "시간을 정하고 시작을 누르세요."}
              </p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {COUNTDOWN_PRESETS.map((preset) => (
                <button
                  key={preset.ms}
                  type="button"
                  className={
                    editable && countdown.durationMs === preset.ms
                      ? "btn-primary h-auto px-1 py-2 text-xs"
                      : "btn-secondary h-auto px-1 py-2 text-xs"
                  }
                  disabled={!editable}
                  onClick={() => store().setDuration(preset.ms)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-sm text-desk">
              <label className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={5999}
                  inputMode="numeric"
                  className="w-20 rounded-md border border-line bg-card px-2 py-1 text-right tabular-nums"
                  value={minText}
                  disabled={!editable}
                  onChange={(event) => setMinText(event.target.value)}
                  onBlur={() => applyInputs(minText, secText)}
                />
                분
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={59}
                  inputMode="numeric"
                  className="w-16 rounded-md border border-line bg-card px-2 py-1 text-right tabular-nums"
                  value={secText}
                  disabled={!editable}
                  onChange={(event) => setSecText(event.target.value)}
                  onBlur={() => applyInputs(minText, secText)}
                />
                초
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {countdown.status === "running" ? (
                <button type="button" className="btn-primary" onClick={() => store().pauseCountdown()}>
                  일시정지
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    if (editable) {
                      applyInputs(minText, secText);
                    }
                    store().startCountdown();
                  }}
                >
                  {startLabel}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={countdown.status === "idle"}
                onClick={() => store().resetCountdown()}
              >
                처음으로
              </button>
            </div>
            <p className="text-xs leading-5 text-quiet">
              끝나면 소리가 나고 패널이 자동으로 열립니다. 시계를 바꾸거나 다른 프로그램이 바빠도 정해 둔 종료 시각을
              기준으로 계산합니다.
            </p>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-line bg-card px-3 py-6 text-center">
              <p
                className="text-5xl font-semibold tabular-nums text-desk"
                aria-live="off"
                aria-label={`경과 시간 ${formatStopwatch(elapsed)}`}
              >
                {formatStopwatch(elapsed)}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {stopwatch.running ? (
                <button type="button" className="btn-primary" onClick={() => store().pauseStopwatch()}>
                  정지
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={() => store().startStopwatch()}>
                  {stopwatch.accumulatedMs > 0 ? "계속" : "시작"}
                </button>
              )}
              <button type="button" className="btn-secondary" disabled={!stopwatch.running} onClick={() => store().lapStopwatch()}>
                구간 기록
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!stopwatch.running && stopwatch.accumulatedMs === 0 && stopwatch.laps.length === 0}
                onClick={() => store().resetStopwatch()}
              >
                초기화
              </button>
            </div>
            {stopwatch.laps.length > 0 ? (
              <ol className="space-y-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk">
                {stopwatch.laps.map((lap, index) => {
                  const number = stopwatch.laps.length - index;
                  const prev = stopwatch.laps[index + 1] ?? 0;
                  return (
                    <li key={`${number}-${lap}`} className="flex justify-between tabular-nums">
                      <span className="text-quiet">{number}번째</span>
                      <span>{formatStopwatch(lap)}</span>
                      <span className="text-quiet">+{formatStopwatch(lap - prev)}</span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
