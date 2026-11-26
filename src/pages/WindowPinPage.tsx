import { listen } from "@tauri-apps/api/event";
import { AppWindow, ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearPinWords,
  listPinWindows,
  placePinWords,
  releaseWindowPins,
  setWindowPin,
  type PinBoard,
  type PinState,
} from "../services/windowPinService";
import { desktopShell } from "../services/windowService";

interface WindowPinPageProps {
  onBack: () => void;
}

const STATE_NOTE: Record<PinState, string> = {
  free: "",
  ours: "고정 중",
  other: "항상 위",
};

const HEAD_BUTTON =
  "rounded-full border border-line px-2.5 py-1 text-xs text-desk transition-colors duration-150 hover:border-ink/30 hover:bg-ink-soft/50 disabled:opacity-40";

export function WindowPinPage({ onBack }: WindowPinPageProps) {
  const [board, setBoard] = useState<PinBoard | null>(null);
  const [readNote, setReadNote] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  const load = useCallback(async () => {
    if (!desktopShell()) {
      setReadNote("런처 앱에서만 창 목록을 읽습니다.");
      return;
    }
    try {
      setBoard(await listPinWindows());
      setReadNote("");
      try {
        await placePinWords();
      } catch {
        // 글자를 두지 못해도 목록으로 고를 수 있다.
      }
    } catch (error) {
      setBoard(null);
      setReadNote(asMessage(error, "창 목록을 읽지 못했습니다."));
      try {
        await clearPinWords();
      } catch {
        // 목록 읽기에 실패했을 때 글자가 남아 있지 않게 한다.
      }
    }
  }, []);

  useEffect(() => {
    // 창을 바꾸는 중에 읽으면 바꾸기 전 상태가 섞일 수 있어, 끝난 뒤의 읽기에 맡긴다.
    const reload = () => {
      if (!working.current) {
        void load();
      }
    };
    reload();
    window.addEventListener("focus", reload);
    let stop = false;
    const unlistens: Array<() => void> = [];
    const keep = (done: () => void) => {
      if (stop) {
        done();
      } else {
        unlistens.push(done);
      }
    };
    if (desktopShell()) {
      void listen<string>("pin-words-changed", (event) => {
        void load().then(() => {
          setNotice(event.payload);
        });
      }).then(keep);
      void listen("panel-shown", () => {
        void load();
      }).then(keep);
    }
    return () => {
      stop = true;
      unlistens.forEach((done) => done());
      window.removeEventListener("focus", reload);
      if (desktopShell()) {
        void clearPinWords();
      }
    };
  }, [load]);

  const act = async (work: () => Promise<void>) => {
    working.current = true;
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (error) {
      setNotice(asMessage(error, "창을 바꾸지 못했습니다."));
    } finally {
      await load();
      working.current = false;
      setBusy(false);
    }
  };

  const rows = board?.rows ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">창 앞에 고정</h1>
        <button
          type="button"
          className={HEAD_BUTTON}
          disabled={busy}
          onClick={() => {
            setNotice("");
            void load();
          }}
        >
          새로 고침
        </button>
        <button
          type="button"
          className={HEAD_BUTTON}
          disabled={busy || !board?.holding}
          onClick={() => void act(releaseWindowPins)}
        >
          모두 해제
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          고른 창을 다른 창보다 앞에 둡니다. 떠 있는 창 안쪽의 고정은 주황색, 해제는 파랑색입니다. 그 글자로도
          고릅니다. 창을 옮기면 글자도 따라갑니다. 최소화된 창은 목록에서 고릅니다. 이 화면을 떠나거나 패널을 닫으면
          그 글자는 사라집니다. 런처를 종료하면 런처가 고정한 창은 해제합니다. 전체 화면 프로그램은 고정한 창을 가릴
          수 있습니다.
        </p>
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
        {readNote ? <p className="text-sm text-desk">{readNote}</p> : null}
        {board && rows.length === 0 ? <p className="text-sm text-desk">고정할 창이 없습니다.</p> : null}
        {rows.length > 0 ? (
          <ul className="card-surface divide-y divide-line/70">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                {row.iconImage ? (
                  <img src={row.iconImage} alt="" className="h-5 w-5 shrink-0" />
                ) : (
                  <AppWindow className="h-5 w-5 shrink-0 text-quiet" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-desk" title={row.title}>
                    {row.title}
                  </p>
                  <p className="truncate text-[11px] text-quiet">
                    {row.app}
                    {STATE_NOTE[row.state] ? ` · ${STATE_NOTE[row.state]}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={
                    row.state === "free"
                      ? "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-ink hover:bg-ink-soft disabled:opacity-40"
                      : "shrink-0 rounded-full bg-ink-soft px-2.5 py-1 text-xs font-medium text-ink disabled:opacity-40"
                  }
                  disabled={busy}
                  aria-label={`${row.title} ${row.state === "free" ? "고정" : "해제"}`}
                  onClick={() => void act(() => setWindowPin(row.id, row.state === "free"))}
                >
                  {row.state === "free" ? "고정" : "해제"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function asMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
