import { create } from "zustand";
import { loadTimers, saveTimers } from "../services/storageService";
import {
  EMPTY_COUNTDOWN,
  EMPTY_STOPWATCH,
  MAX_LAPS,
  cleanLapNote,
  clampDuration,
  countdownElapsed,
  countdownRemaining,
  normalizeStored,
  stopwatchElapsed,
  type CountdownState,
  type StopwatchState,
} from "../services/timerService";
import { showPanel } from "../services/windowService";

interface TimerState {
  countdown: CountdownState;
  stopwatch: StopwatchState;
  loaded: boolean;
  /** 종료됐고 사용자가 아직 확인하지 않았다. 화면에서 안내를 보여 준다. */
  alarmActive: boolean;
  hydrate: () => Promise<void>;
  setDuration: (ms: number) => void;
  setShowOver: (on: boolean) => void;
  startCountdown: () => void;
  pauseCountdown: () => void;
  resetCountdown: () => void;
  lapCountdown: () => void;
  setCountdownLapLabel: (id: number, label: string) => void;
  setCountdownLapNote: (id: number, note: string) => void;
  dismissAlarm: () => void;
  startStopwatch: () => void;
  pauseStopwatch: () => void;
  lapStopwatch: () => void;
  setLapLabel: (id: number, label: string) => void;
  setLapNote: (id: number, note: string) => void;
  resetStopwatch: () => void;
}

let audio: AudioContext | null = null;
let endTimeout: ReturnType<typeof setTimeout> | null = null;
let guard: ReturnType<typeof setInterval> | null = null;
let noteSave: ReturnType<typeof setTimeout> | null = null;

/** 사용자가 누른 순간(클릭)에 소리 장치를 깨워 둔다. 숨겨진 창에서도 종료음이 나게 한다. */
function primeAudio(): void {
  try {
    if (!audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        return;
      }
      audio = new Ctor();
    }
    if (audio.state === "suspended") {
      void audio.resume();
    }
  } catch {
    // 소리를 못 내도 타이머는 동작한다.
  }
}

function beep(): void {
  try {
    if (!audio) {
      return;
    }
    const ctx = audio;
    const start = ctx.currentTime + 0.05;
    // 짧은 소리 3번을 3묶음. 약 4초.
    for (let group = 0; group < 3; group += 1) {
      for (let i = 0; i < 3; i += 1) {
        const at = start + group * 1.4 + i * 0.3;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.22);
      }
    }
  } catch {
    // 소리 실패는 무시한다.
  }
}

function persist(): void {
  const { countdown, stopwatch } = useTimerStore.getState();
  void saveTimers({ countdown, stopwatch }).catch(() => {
    // 저장에 실패해도 이번 실행 중에는 계속 동작한다.
  });
}

function clearWatchers(): void {
  if (endTimeout) {
    clearTimeout(endTimeout);
    endTimeout = null;
  }
  if (guard) {
    clearInterval(guard);
    guard = null;
  }
}

/** 실행 중인 카운트다운이 있으면 종료 시점을 지키는 감시를 건다. */
function armWatchers(): void {
  clearWatchers();
  const { countdown } = useTimerStore.getState();
  if (countdown.status !== "running") {
    return;
  }
  const remaining = countdownRemaining(countdown, Date.now());
  if (remaining <= 0 && countdown.showOver && countdown.rang) {
    return;
  }
  // 정확한 시점용. 숨겨진 창에서 늦어질 수 있어 아래 점검이 한 번 더 확인한다.
  endTimeout = setTimeout(checkDone, Math.max(0, remaining) + 20);
  guard = setInterval(checkDone, 250);
}

function checkDone(): void {
  const state = useTimerStore.getState();
  if (state.countdown.status !== "running") {
    clearWatchers();
    return;
  }
  const remaining = countdownRemaining(state.countdown, Date.now());
  if (remaining > 0) {
    return;
  }
  if (state.countdown.showOver) {
    if (state.countdown.rang) {
      clearWatchers();
      return;
    }
    clearWatchers();
    useTimerStore.setState({ countdown: { ...state.countdown, rang: true }, alarmActive: true });
    persist();
    beep();
    void showPanel().catch(() => {
      // 브라우저 미리보기에는 패널이 없다.
    });
    return;
  }
  // running -> done 전환은 한 번만 일어나므로 알림도 한 번만 울린다.
  clearWatchers();
  useTimerStore.setState({ countdown: { ...state.countdown, status: "done", endAt: 0, pausedRemainingMs: 0, rang: false }, alarmActive: true });
  persist();
  beep();
  void showPanel().catch(() => {
    // 브라우저 미리보기에는 패널이 없다.
  });
}

export const useTimerStore = create<TimerState>((set, get) => ({
  countdown: EMPTY_COUNTDOWN,
  stopwatch: EMPTY_STOPWATCH,
  loaded: false,
  alarmActive: false,
  hydrate: async () => {
    let raw: unknown;
    try {
      raw = await loadTimers();
    } catch {
      raw = undefined;
    }
    const now = Date.now();
    const next = normalizeStored(raw, now);
    const stored = (raw as { countdown?: { status?: unknown; rang?: unknown } } | undefined)?.countdown;
    const storedStatus = stored?.status;
    // 앱이 꺼져 있는 동안 끝난 타이머는 소리 없이 안내만 한다.
    const missed = storedStatus === "running" && next.countdown.status === "done";
    const missedOver =
      storedStatus === "running" &&
      next.countdown.status === "running" &&
      next.countdown.showOver &&
      next.countdown.endAt > 0 &&
      next.countdown.endAt <= now &&
      stored?.rang !== true;
    const countdown = missedOver ? { ...next.countdown, rang: true } : next.countdown;
    set({ countdown, stopwatch: next.stopwatch, loaded: true, alarmActive: missed || missedOver });
    armWatchers();
    if (missed || missedOver) {
      persist();
    }
  },
  setDuration: (ms) => {
    const { countdown } = get();
    if (countdown.status === "running" || countdown.status === "paused") {
      return;
    }
    const durationMs = clampDuration(ms);
    if (durationMs <= 0) {
      return;
    }
    set({
      countdown: { ...EMPTY_COUNTDOWN, durationMs, showOver: countdown.showOver, laps: countdown.laps },
      alarmActive: false,
    });
    persist();
  },
  setShowOver: (on) => {
    const { countdown } = get();
    if (countdown.status === "running" || countdown.status === "paused" || countdown.showOver === on) {
      return;
    }
    set({ countdown: { ...countdown, showOver: on, rang: false } });
    persist();
  },
  startCountdown: () => {
    primeAudio();
    const { countdown } = get();
    const now = Date.now();
    if (countdown.status === "running") {
      return;
    }
    const fromPause = countdown.status === "paused";
    const remaining = fromPause ? countdown.pausedRemainingMs : countdown.durationMs;
    if (remaining <= 0 && !(countdown.showOver && fromPause)) {
      return;
    }
    const rang = fromPause && remaining <= 0 ? countdown.rang : false;
    if (!fromPause && noteSave) {
      clearTimeout(noteSave);
      noteSave = null;
    }
    set({
      countdown: {
        ...countdown,
        status: "running",
        endAt: now + remaining,
        pausedRemainingMs: 0,
        rang,
        laps: fromPause ? countdown.laps : [],
      },
      alarmActive: false,
    });
    persist();
    if (remaining > 0 || !rang) {
      armWatchers();
    }
  },
  pauseCountdown: () => {
    const { countdown } = get();
    if (countdown.status !== "running") {
      return;
    }
    const rest = countdownRemaining(countdown, Date.now());
    clearWatchers();
    if (countdown.showOver) {
      set({ countdown: { ...countdown, status: "paused", endAt: 0, pausedRemainingMs: rest } });
    } else {
      set({
        countdown: {
          ...countdown,
          status: rest > 0 ? "paused" : "done",
          endAt: 0,
          pausedRemainingMs: rest,
          rang: false,
        },
      });
    }
    persist();
  },
  resetCountdown: () => {
    clearWatchers();
    if (noteSave) {
      clearTimeout(noteSave);
      noteSave = null;
    }
    const { countdown } = get();
    set({
      countdown: { ...EMPTY_COUNTDOWN, durationMs: countdown.durationMs, showOver: countdown.showOver },
      alarmActive: false,
    });
    persist();
  },
  lapCountdown: () => {
    const { countdown } = get();
    if (countdown.status !== "running") {
      return;
    }
    const now = Date.now();
    const id = Math.max(now, (countdown.laps[0]?.id ?? 0) + 1);
    const laps = [{ id, ms: countdownElapsed(countdown, now), label: "", note: "" }, ...countdown.laps].slice(0, MAX_LAPS);
    set({ countdown: { ...countdown, laps } });
    persist();
  },
  setCountdownLapLabel: (id, label) => {
    const { countdown } = get();
    if (!countdown.laps.some((lap) => lap.id === id)) {
      return;
    }
    const clean = cleanLapNote(label);
    const laps = countdown.laps.map((lap) => (lap.id === id ? { ...lap, label: clean } : lap));
    set({ countdown: { ...countdown, laps } });
    if (noteSave) {
      clearTimeout(noteSave);
    }
    noteSave = setTimeout(() => {
      noteSave = null;
      persist();
    }, 400);
  },
  setCountdownLapNote: (id, note) => {
    const { countdown } = get();
    if (!countdown.laps.some((lap) => lap.id === id)) {
      return;
    }
    const clean = cleanLapNote(note);
    const laps = countdown.laps.map((lap) => (lap.id === id ? { ...lap, note: clean } : lap));
    set({ countdown: { ...countdown, laps } });
    if (noteSave) {
      clearTimeout(noteSave);
    }
    noteSave = setTimeout(() => {
      noteSave = null;
      persist();
    }, 400);
  },
  dismissAlarm: () => {
    set({ alarmActive: false });
  },
  startStopwatch: () => {
    const { stopwatch } = get();
    if (stopwatch.running) {
      return;
    }
    set({ stopwatch: { ...stopwatch, running: true, startedAt: Date.now() } });
    persist();
  },
  pauseStopwatch: () => {
    const { stopwatch } = get();
    if (!stopwatch.running) {
      return;
    }
    const now = Date.now();
    set({
      stopwatch: { ...stopwatch, running: false, startedAt: 0, accumulatedMs: stopwatchElapsed(stopwatch, now) },
    });
    persist();
  },
  lapStopwatch: () => {
    const { stopwatch } = get();
    if (!stopwatch.running) {
      return;
    }
    const now = Date.now();
    // 번호는 항상 앞선 구간보다 크게 해서 메모를 붙일 구간이 바뀌지 않게 한다.
    const id = Math.max(now, (stopwatch.laps[0]?.id ?? 0) + 1);
    const laps = [{ id, ms: stopwatchElapsed(stopwatch, now), label: "", note: "" }, ...stopwatch.laps].slice(0, MAX_LAPS);
    set({ stopwatch: { ...stopwatch, laps } });
    persist();
  },
  setLapLabel: (id, label) => {
    const { stopwatch } = get();
    if (!stopwatch.laps.some((lap) => lap.id === id)) {
      return;
    }
    const clean = cleanLapNote(label);
    const laps = stopwatch.laps.map((lap) => (lap.id === id ? { ...lap, label: clean } : lap));
    set({ stopwatch: { ...stopwatch, laps } });
    if (noteSave) {
      clearTimeout(noteSave);
    }
    noteSave = setTimeout(() => {
      noteSave = null;
      persist();
    }, 400);
  },
  setLapNote: (id, note) => {
    const { stopwatch } = get();
    if (!stopwatch.laps.some((lap) => lap.id === id)) {
      return;
    }
    const clean = cleanLapNote(note);
    const laps = stopwatch.laps.map((lap) => (lap.id === id ? { ...lap, note: clean } : lap));
    set({ stopwatch: { ...stopwatch, laps } });
    // 글자를 칠 때마다 저장하지 않고 잠깐 멈추면 한 번만 저장한다.
    if (noteSave) {
      clearTimeout(noteSave);
    }
    noteSave = setTimeout(() => {
      noteSave = null;
      persist();
    }, 400);
  },
  resetStopwatch: () => {
    if (noteSave) {
      clearTimeout(noteSave);
      noteSave = null;
    }
    set({ stopwatch: EMPTY_STOPWATCH });
    persist();
  },
}));

export async function hydrateTimers(): Promise<void> {
  await useTimerStore.getState().hydrate();
}
