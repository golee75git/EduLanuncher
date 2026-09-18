import { Sparkles } from "lucide-react";
import { APP_CONFIG } from "../config/app";

interface WelcomeOverlayProps {
  onStart: () => void;
}

export function WelcomeOverlay({ onStart }: WelcomeOverlayProps) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-desk/40 p-6 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm px-6 py-7 text-center shadow-pop">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-ink-soft text-ink">
          <Sparkles className="h-5 w-5" />
        </span>
        <p className="mt-3 text-[11px] font-semibold tracking-wide text-ink">{APP_CONFIG.appName}</p>
        <h1 className="mt-1 text-xl font-semibold text-desk">
          {APP_CONFIG.appName}에 오신 것을 환영합니다.
        </h1>
        <p className="mt-3 text-sm leading-6 text-quiet">
          자주 사용하는 교육업무를 빠르게 실행할 수 있습니다.
        </p>
        <button type="button" onClick={onStart} className="btn-primary mt-6 h-11">
          시작하기
        </button>
      </div>
    </div>
  );
}
