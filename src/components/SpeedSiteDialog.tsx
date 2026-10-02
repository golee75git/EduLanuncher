import { useState } from "react";
import { openSpeedSite } from "../services/internetCheckService";

interface SpeedSiteDialogProps {
  onClose: () => void;
}

export function SpeedSiteDialog({ onClose }: SpeedSiteDialogProps) {
  const [notice, setNotice] = useState("");

  const openSite = async () => {
    setNotice("");
    try {
      await openSpeedSite();
      onClose();
    } catch {
      setNotice("측정 사이트를 열지 못했습니다.");
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-desk/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm space-y-3 p-4 shadow-pop" role="dialog" aria-labelledby="speed-site-title">
        <h3 id="speed-site-title" className="text-base font-semibold text-desk">
          인터넷 속도 측정
        </h3>
        <p className="text-sm leading-6 text-desk">
          인터넷 속도는 외부 측정 사이트에서 확인할 수 있습니다. 측정 중에는 회선을 많이 사용하므로 같은 네트워크를 쓰는 다른 사용자에게 잠시 영향을 줄 수 있습니다.
        </p>
        <button
          type="button"
          className="w-full rounded-lg bg-ink px-3 py-2 text-left text-white shadow-card transition-colors duration-150 hover:bg-ink-strong"
          onClick={() => void openSite()}
        >
          <span className="block text-sm font-medium">NIA 인터넷 품질측정 열기</span>
          <span className="mt-1 block text-xs leading-5 text-white/80">
            공공기관(한국지능정보사회진흥원) 운영. 측정 프로그램 설치가 필요할 수 있습니다. 통신사 품질 문의 시 참고 자료로 활용할 수 있습니다.
          </span>
        </button>
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm text-desk transition-colors duration-150 hover:bg-paper"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
