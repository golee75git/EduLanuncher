import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  COUNTDOWN_PRESETS,
  MAX_COUNTDOWN_MS,
  MAX_LAP_NOTE,
  countdownLapTable,
  countdownLapTableCsv,
  countdownRemaining,
  formatElapsedSeconds,
  formatStopwatch,
  formatTimerFace,
  lapTable,
  lapTableCsv,
  stopwatchElapsed,
  type Lap,
} from "../services/timerService";
import { pickSaveFile } from "../services/savePick";
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

function saveError(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "저장하지 못했습니다.";
}

async function saveLapFile(kind: "csv" | "xlsx", laps: Lap[], stem: string, countdown: boolean): Promise<string> {
  const picked = await pickSaveFile(kind, kind === "csv" ? `${stem}.csv` : `${stem}.xlsx`);
  if (!picked) {
    return "";
  }
  const rows = countdown ? countdownLapTable(laps) : lapTable(laps);
  if (kind === "csv") {
    const contents = countdown ? countdownLapTableCsv(laps) : lapTableCsv(laps);
    await invoke("write_csv_file", { id: picked.id, contents });
    return "CSV로 저장했습니다.";
  }
  await invoke("write_xlsx_file", { id: picked.id, rows });
  return "엑셀 파일로 저장했습니다.";
}

function LapRows({
  laps,
  sheet,
  countdown = false,
  onLabel,
  onNote,
}: {
  laps: Lap[];
  sheet: string;
  countdown?: boolean;
  onLabel: (id: number, value: string) => void;
  onNote: (id: number, value: string) => void;
}) {
  if (laps.length === 0) {
    return null;
  }
  return (
    <ol className={`${sheet} space-y-2 rounded-lg border border-line px-3 py-2 text-sm text-desk`}>
      {laps.map((lap, index) => {
        const number = laps.length - index;
        const prev = laps[index + 1]?.ms ?? 0;
        const clock = countdown && typeof lap.markMs === "number" ? formatTimerFace(lap.markMs) : "";
        const passed = countdown ? formatElapsedSeconds(lap.ms) : "";
        return (
          <li key={lap.id} className="flex items-center gap-1.5">
            <input
              type="text"
              className="w-[4.5rem] shrink-0 rounded-md border border-line bg-paper px-1 py-1 text-xs text-desk"
              placeholder={`${number}번째`}
              maxLength={MAX_LAP_NOTE}
              aria-label={`${number}번째 이름`}
              value={lap.label}
              onChange={(event) => onLabel(lap.id, event.target.value)}
            />
            {countdown ? (
              <span className="w-[4.5rem] shrink-0 text-right tabular-nums" aria-label={`${number}번째 시계 ${clock}`}>
                {clock}
              </span>
            ) : (
              <span className="w-[4.5rem] shrink-0 text-right tabular-nums">{formatStopwatch(lap.ms)}</span>
            )}
            {countdown ? (
              <span className="w-[4.5rem] shrink-0 text-right text-quiet tabular-nums" aria-label={`${number}번째 지난 시간 ${passed}`}>
                {passed}
              </span>
            ) : (
              <span className="w-[4.5rem] shrink-0 text-right text-quiet tabular-nums">+{formatStopwatch(lap.ms - prev)}</span>
            )}
            <input
              type="text"
              className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1 text-sm text-desk"
              placeholder="메모"
              maxLength={MAX_LAP_NOTE}
              aria-label={`${number}번째 구간 메모`}
              value={lap.note}
              onChange={(event) => onNote(lap.id, event.target.value)}
            />
          </li>
        );
      })}
    </ol>
  );
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
  const [timerSaveNote, setTimerSaveNote] = useState("");
  const [watchSaveNote, setWatchSaveNote] = useState("");
  const countdown = useTimerStore((s) => s.countdown);
  const stopwatch = useTimerStore((s) => s.stopwatch);
  const store = useTimerStore.getState;

  const running = countdown.status === "running" || stopwatch.running;
  const now = useNow(running);

  const remaining = countdownRemaining(countdown, now);
  const elapsed = stopwatchElapsed(stopwatch, now);
  const editable = countdown.status === "idle" || countdown.status === "done";
  const over = remaining < 0;
  const face = formatTimerFace(remaining);

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
      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-3 ${tab === "countdown" ? "timer-sheet" : "watch-sheet"}`}>
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
            <div className={`${over ? "timer-over" : "timer-face"} rounded-lg border border-line px-3 py-6 text-center`}>
              <p
                className={`text-5xl font-semibold tabular-nums ${over ? "timer-over-num" : "text-desk"}`}
                aria-live="off"
                aria-label={over ? `초과 시간 ${face}` : `남은 시간 ${face}`}
              >
                {face}
              </p>
              <p className="mt-2 text-xs text-quiet">
                {countdown.status === "running"
                  ? over
                    ? "초과 시간을 세고 있습니다. 패널을 닫아도 계속 갑니다."
                    : "남은 시간을 세고 있습니다. 패널을 닫아도 계속 갑니다."
                  : countdown.status === "paused"
                    ? over
                      ? "초과 시간을 일시정지했습니다."
                      : "일시정지"
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
            <div className="grid grid-cols-3 gap-2">
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
                disabled={countdown.status !== "running"}
                onClick={() => store().lapCountdown()}
              >
                구간 기록
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={countdown.status === "idle" && countdown.laps.length === 0}
                onClick={() => store().resetCountdown()}
              >
                초기화
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={countdown.laps.length === 0}
                onClick={() => {
                  setTimerSaveNote("");
                  void saveLapFile("csv", countdown.laps, "타이머", true)
                    .then((text) => setTimerSaveNote(text))
                    .catch((error: unknown) => setTimerSaveNote(saveError(error)));
                }}
              >
                CSV 저장
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={countdown.laps.length === 0}
                onClick={() => {
                  setTimerSaveNote("");
                  void saveLapFile("xlsx", countdown.laps, "타이머", true)
                    .then((text) => setTimerSaveNote(text))
                    .catch((error: unknown) => setTimerSaveNote(saveError(error)));
                }}
              >
                엑셀 저장
              </button>
            </div>
            {timerSaveNote ? <p className="text-xs leading-5 text-quiet">{timerSaveNote}</p> : null}
            <LapRows
              laps={countdown.laps}
              countdown
              sheet={over ? "timer-over" : "timer-face"}
              onLabel={(id, value) => store().setCountdownLapLabel(id, value)}
              onNote={(id, value) => store().setCountdownLapNote(id, value)}
            />
            <p className="text-xs leading-5 text-quiet">
              0이 되면 소리가 한 번 나고, 창은 그대로 둔 채 +00:01처럼 지난 시간을 장미색으로 계속 셉니다. 가는 동안
              구간 기록을 남길 수 있습니다. 첫 시간은 누른 순간의 시계이고, 다음 시간은 시작부터 흐른 시간입니다. 이름과
              메모는 CSV·엑셀로 고른 파일에만 저장합니다. 시계를 바꾸거나 다른
              프로그램이 바빠도 정해 둔 종료 시각을 기준으로 계산합니다.
            </p>
          </>
        ) : (
          <>
            <div className="watch-face rounded-lg border border-line px-3 py-6 text-center">
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
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={stopwatch.laps.length === 0}
                onClick={() => {
                  setWatchSaveNote("");
                  void saveLapFile("csv", stopwatch.laps, "스톱워치", false)
                    .then((text) => setWatchSaveNote(text))
                    .catch((error: unknown) => setWatchSaveNote(saveError(error)));
                }}
              >
                CSV 저장
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={stopwatch.laps.length === 0}
                onClick={() => {
                  setWatchSaveNote("");
                  void saveLapFile("xlsx", stopwatch.laps, "스톱워치", false)
                    .then((text) => setWatchSaveNote(text))
                    .catch((error: unknown) => setWatchSaveNote(saveError(error)));
                }}
              >
                엑셀 저장
              </button>
            </div>
            {watchSaveNote ? <p className="text-xs leading-5 text-quiet">{watchSaveNote}</p> : null}
            <LapRows
              laps={stopwatch.laps}
              sheet="watch-face"
              onLabel={(id, value) => store().setLapLabel(id, value)}
              onNote={(id, value) => store().setLapNote(id, value)}
            />
          </>
        )}
      </div>
    </div>
  );
}
