import { Download } from "lucide-react";
import { SITE_CONFIG } from "../config";

const REQUIREMENTS = [
  "Windows 10 또는 11, 64비트(x64)",
  "현재 사용자 폴더에 설치 (관리자 권한 불필요)",
  "Microsoft Edge WebView2 Runtime",
] as const;

const STEPS = [
  "아래 버튼으로 GitHub Releases의 최신 설치 파일을 받습니다.",
  `${SITE_CONFIG.setupFile} 또는 ${SITE_CONFIG.setupFileDated} 를 실행합니다. 현재 사용자 폴더에 설치됩니다.`,
  "설치가 끝나면 프로그램이 바로 실행되고 패널이 열립니다. 시작 시 자동 실행·창 표시는 기본으로 켜져 있으며 설정에서 바꿀 수 있습니다.",
  "이미 설치되어 있으면 이전 버전을 교체한 뒤 다시 실행합니다.",
] as const;

export function DownloadPage() {
  return (
    <div className="space-y-8">
      <section className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold text-desk">데스크톱 다운로드</h1>
        <p className="text-sm leading-relaxed text-quiet">
          {SITE_CONFIG.displayName}는 이 PC에 설치하는 Windows 프로그램입니다. 설치 파일은 이 사이트에 두지 않고
          GitHub Releases에서 받습니다. 용량이 큰 설치본을 웹 호스팅에 올리지 않기 위함입니다.
        </p>
      </section>

      <section className="card-surface flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{SITE_CONFIG.displayName} · Windows</p>
          <p className="mt-1 text-sm text-quiet">
            {SITE_CONFIG.setupFile}
            <br />
            {SITE_CONFIG.setupFileDated}
          </p>
          <p className="mt-1 text-sm text-quiet">x64 · 현재 사용자 설치 · WebView2 필요</p>
        </div>
        <a className="btn-primary w-full sm:w-auto" href={SITE_CONFIG.setupDownloadUrl} rel="noreferrer" target="_blank">
          <Download className="h-4 w-4" />
          최신 설치 파일
        </a>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <article>
          <h2 className="text-sm font-semibold">설치 조건</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-quiet">
            {REQUIREMENTS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
        <article>
          <h2 className="text-sm font-semibold">설치 순서</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-quiet">
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>
      </section>

      <p className="text-sm leading-relaxed text-quiet">
        릴리스가 아직 없으면 GitHub에 파일이 보이지 않습니다. 그때는 저장소에서 직접 확인할 수 있습니다.
        {" "}
        <a className="font-medium text-ink hover:text-ink-strong" href={SITE_CONFIG.githubRepo} rel="noreferrer" target="_blank">
          저장소
        </a>
      </p>
    </div>
  );
}
