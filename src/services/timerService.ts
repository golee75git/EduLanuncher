/**
 * 타이머·스톱워치 시간 계산. React와 저장소를 모른다.
 * 틱 횟수를 세지 않고, 저장해 둔 시각과 지금 시각의 차이로 계산한다.
 * 화면 갱신이 늦어져도 값은 어긋나지 않는다.
 */

export type CountdownStatus = "idle" | "running" | "paused" | "done";

export interface CountdownState {
  status: CountdownStatus;
  /** 처음 맞춘 시간(ms). 다시 시작할 때 쓴다. */
  durationMs: number;
  /** running일 때만 의미가 있다. 종료 시각(epoch ms). */
  endAt: number;
  /** paused일 때 남은 시간(ms). 초과 시간 표시가 켜져 있으면 음수일 수 있다. */
  pausedRemainingMs: number;
  /** 켜면 0을 지난 뒤에도 지난 시간을 센다. 기본은 0에서 멈춘다. */
  showOver: boolean;
  /** 이번 회차에서 0 알림을 이미 냈다. */
  rang: boolean;
  /** 최신이 앞. 값은 시작한 뒤 흐른 시간(ms). */
  laps: Lap[];
}

export interface Lap {
  /** 구간을 찍은 순서대로 커지는 번호. 메모를 붙일 구간을 가리킬 때 쓴다. */
  id: number;
  /** 스톱워치를 시작한 뒤 누적 경과(ms). */
  ms: number;
  /** 비어 있으면 화면의 N번째를 그대로 쓴다. */
  label: string;
  note: string;
}

export interface StopwatchState {
  running: boolean;
  /** running일 때 이번 구간을 시작한 시각(epoch ms). */
  startedAt: number;
  /** 이전 구간까지 누적한 시간(ms). */
  accumulatedMs: number;
  /** 최신이 앞. */
  laps: Lap[];
}

export const MAX_LAP_NOTE = 60;

/** 줄바꿈과 제어문자를 빼고 길이를 자른다. */
export function cleanLapNote(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_LAP_NOTE);
}

export interface StoredTimers {
  countdown: CountdownState;
  stopwatch: StopwatchState;
}

export const MAX_COUNTDOWN_MS = 99 * 3600_000 + 59 * 60_000 + 59_000;
export const MAX_LAPS = 50;
/** 시계가 이 값(ms)보다 크게 뒤로 가면 저장된 값이 이상한 것으로 본다. */
const CLOCK_BACK_TOLERANCE_MS = 5_000;

export const COUNTDOWN_PRESETS: { label: string; ms: number }[] = [
  { label: "1분", ms: 60_000 },
  { label: "3분", ms: 3 * 60_000 },
  { label: "5분", ms: 5 * 60_000 },
  { label: "10분", ms: 10 * 60_000 },
  { label: "30분", ms: 30 * 60_000 },
];

export const EMPTY_COUNTDOWN: CountdownState = {
  status: "idle",
  durationMs: 5 * 60_000,
  endAt: 0,
  pausedRemainingMs: 0,
  showOver: false,
  rang: false,
  laps: [],
};

export const EMPTY_STOPWATCH: StopwatchState = {
  running: false,
  startedAt: 0,
  accumulatedMs: 0,
  laps: [],
};

export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    return 0;
  }
  return Math.min(Math.floor(ms), MAX_COUNTDOWN_MS);
}

function clampSigned(ms: number): number {
  if (!Number.isFinite(ms)) {
    return 0;
  }
  return Math.max(-MAX_COUNTDOWN_MS, Math.min(MAX_COUNTDOWN_MS, Math.floor(ms)));
}

export function countdownRemaining(state: CountdownState, now: number): number {
  if (state.status === "running") {
    const delta = state.endAt - now;
    return state.showOver ? delta : Math.max(0, delta);
  }
  if (state.status === "paused") {
    return state.showOver ? state.pausedRemainingMs : Math.max(0, state.pausedRemainingMs);
  }
  if (state.status === "done") {
    return 0;
  }
  return state.durationMs;
}

/** 시작한 뒤 흐른 시간. 초과 시간은 맞춘 시간에 더한다. 시작 전에는 0이다. */
export function countdownElapsed(state: CountdownState, now: number): number {
  if (state.status === "idle") {
    return 0;
  }
  return Math.max(0, state.durationMs - countdownRemaining(state, now));
}

export function stopwatchElapsed(state: StopwatchState, now: number): number {
  if (!state.running) {
    return state.accumulatedMs;
  }
  return state.accumulatedMs + Math.max(0, now - state.startedAt);
}

/** 01:05 또는 1:02:03 꼴. 올림해서 0초는 정말 끝났을 때만 나온다. */
export function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 남은 시간은 01:05. 0을 지나면 +01:05. 자릿수가 늘지 않게 상한까지만 보여 준다. */
export function formatTimerFace(remainingMs: number): string {
  if (!(remainingMs < 0)) {
    return formatCountdown(remainingMs);
  }
  return `+${formatCountdown(Math.min(MAX_COUNTDOWN_MS, -remainingMs))}`;
}

/** 1번째가 첫 줄. 열은 순서, 누적, 구간, 메모. */
export function lapTable(laps: Lap[]): string[][] {
  const ordered = [...laps].reverse();
  const rows: string[][] = [["순서", "누적", "구간", "메모"]];
  for (let i = 0; i < ordered.length; i += 1) {
    const prev = i === 0 ? 0 : ordered[i - 1].ms;
    const name = cleanLapNote(ordered[i].label);
    rows.push([
      name || `${i + 1}번째`,
      formatStopwatch(ordered[i].ms),
      formatStopwatch(Math.max(0, ordered[i].ms - prev)),
      cleanLapNote(ordered[i].note),
    ]);
  }
  return rows;
}

/** 엑셀에서 식으로 열리지 않게, 식처럼 보이는 칸 앞에 따옴표를 붙인다. */
function csvCell(value: string): string {
  let text = value;
  const head = text.charAt(0);
  if (head === "=" || head === "+" || head === "-" || head === "@") {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.split("\"").join("\"\"")}"`;
  }
  return text;
}

export function lapTableCsv(laps: Lap[]): string {
  return lapTable(laps).map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** 00:12.34 또는 1:02:03.45 꼴. 내림해서 실제 경과보다 앞서 보이지 않게 한다. */
export function formatStopwatch(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const cs = Math.floor((total % 1000) / 10);
  const totalSec = Math.floor(total / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const cc = String(cs).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}.${cc}` : `${mm}:${ss}.${cc}`;
}

function readStoredLaps(raw: unknown): Lap[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const laps: Lap[] = [];
  const total = Math.min(raw.length, MAX_LAPS);
  for (let i = 0; i < total; i += 1) {
    const item: unknown = raw[i];
    if (typeof item === "number") {
      if (Number.isFinite(item) && item >= 0) {
        laps.push({ id: total - i, ms: item, label: "", note: "" });
      }
    } else if (item && typeof item === "object") {
      const entry = item as Record<string, unknown>;
      const ms = asNumber(entry.ms, -1);
      if (ms >= 0) {
        laps.push({
          id: asNumber(entry.id, total - i),
          ms,
          label: cleanLapNote(entry.label),
          note: cleanLapNote(entry.note),
        });
      }
    }
  }
  return laps;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 저장된 값을 믿지 않고 다시 다듬는다.
 * 재시작했을 때 이미 지난 타이머는 done으로 바꾼다(놓친 알림은 화면에서 한 번 보여 준다).
 */
export function normalizeStored(raw: unknown, now: number): StoredTimers {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const c = (value.countdown && typeof value.countdown === "object" ? value.countdown : {}) as Record<string, unknown>;
  const s = (value.stopwatch && typeof value.stopwatch === "object" ? value.stopwatch : {}) as Record<string, unknown>;

  const durationMs = clampDuration(asNumber(c.durationMs, EMPTY_COUNTDOWN.durationMs)) || EMPTY_COUNTDOWN.durationMs;
  const showOver = c.showOver === true;
  let countdown: CountdownState = { ...EMPTY_COUNTDOWN, durationMs, showOver, laps: readStoredLaps(c.laps) };
  if (c.status === "running") {
    const endAt = asNumber(c.endAt);
    if (endAt > 0) {
      // 시계가 크게 뒤로 가서 남은 시간이 처음보다 길어졌으면 처음 시간까지만 인정한다.
      const capped = Math.min(endAt, now + durationMs + CLOCK_BACK_TOLERANCE_MS);
      if (capped <= now && showOver) {
        countdown = { ...countdown, status: "running", endAt: capped, rang: c.rang === true };
      } else if (capped <= now) {
        countdown = { ...countdown, status: "done" };
      } else {
        countdown = { ...countdown, status: "running", endAt: capped };
      }
    }
  } else if (c.status === "paused") {
    if (showOver) {
      const rest = clampSigned(asNumber(c.pausedRemainingMs));
      if (rest !== 0 || c.rang === true) {
        countdown = { ...countdown, status: "paused", pausedRemainingMs: rest, rang: rest < 0 || c.rang === true };
      }
    } else {
      const rest = clampDuration(asNumber(c.pausedRemainingMs));
      if (rest > 0) {
        countdown = { ...countdown, status: "paused", pausedRemainingMs: rest };
      }
    }
  } else if (c.status === "done") {
    countdown = { ...countdown, status: "done" };
  }

  const accumulatedMs = Math.max(0, asNumber(s.accumulatedMs));
  // 예전 스톱워치는 숫자만 저장했다. 숫자도 받아서 메모 없는 구간으로 바꾼다.
  let stopwatch: StopwatchState = { ...EMPTY_STOPWATCH, accumulatedMs, laps: readStoredLaps(s.laps) };
  if (s.running === true) {
    const startedAt = asNumber(s.startedAt);
    // 시작 시각이 미래이면(시계가 뒤로 갔을 때) 지금으로 맞춘다.
    if (startedAt > 0) {
      stopwatch = { ...stopwatch, running: true, startedAt: Math.min(startedAt, now) };
    }
  }
  return { countdown, stopwatch };
}
