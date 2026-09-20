import { Download, LayoutPanelTop, Monitor } from "lucide-react";
import { SITE_CONFIG } from "../config";

const FEATURES = [
  {
    title: "트레이에 두고 필요할 때만",
    body: "평소에는 작업 표시줄 알림 영역에만 있습니다. 트레이를 클릭하거나 Ctrl+Alt+E를 누르면 440×650 패널이 열립니다.",
  },
  {
    title: "사이트·프로그램·파일·폴더",
    body: "자주 쓰는 바로가기를 종류별로 둡니다. 공통 목록은 Pack(.edupack)으로 나눠 받을 수 있습니다.",
  },
  {
    title: "이 PC에서만 동작",
    body: "서버에 로그인하지 않습니다. 공지·메모·바로가기 목록은 설치한 컴퓨터에만 저장됩니다.",
  },
] as const;

const HOLDS = [
  "사이트, 프로그램, 파일, 폴더 바로가기",
  "기관 공지 Pack",
  "한 장의 메모",
  "주소·파일·바로가기를 패널에 끌어 놓기 (Windows 설치본)",
  "이 PC Edge·Chrome 북마크와 Windows 즐겨찾기 바로가기 보기",
  "업무도구에서 컴퓨터 이름·이 PC IP 주소·제어판·익스플로러 설정 복원 등 이 PC 화면 열기",
  "업무도구에서 이 PC 그림에 주소 무늬를 넣어 PNG로 저장",
  "홈 검색과 업무자료에서 교육행정 업무주제 찾기",
] as const;

const DOES_NOT = [
  "계정 로그인이나 클라우드 동기화",
  "나이스·교육청 등 학교 시스템 자동 연결",
  "브라우저에서 프로그램·파일 실행",
] as const;

export function IntroPage() {
  return (
    <div className="space-y-12">
      <section className="max-w-2xl space-y-4">
        <p className="text-[11px] font-semibold tracking-wide text-ink">{SITE_CONFIG.appName}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-desk sm:text-4xl">
          학교 사무를 위한
          <br />
          Windows 업무 런처
        </h1>
        <p className="text-base leading-relaxed text-quiet">
          {SITE_CONFIG.displayName}는 교육기관 직원용 작은 패널입니다. 웹 서비스가 아니라 이 PC에 설치하는
          프로그램입니다. 평소에는 화면을 가리지 않고, 필요할 때만 엽니다.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <a className="btn-primary" href={SITE_CONFIG.setupDownloadUrl} rel="noreferrer" target="_blank">
            <Download className="h-4 w-4" />
            설치 파일 받기
          </a>
          <a className="btn-secondary" href="/download">
            설치 안내
          </a>
          <a className="btn-secondary" href="/preview">
            <LayoutPanelTop className="h-4 w-4" />
            웹에서 화면 보기
          </a>
        </div>
        <p className="text-sm leading-relaxed text-quiet">
          설치 파일 {SITE_CONFIG.setupFile}
          <br />
          날짜 복사본 {SITE_CONFIG.setupFileDated}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((item) => (
          <article key={item.title} className="card-surface p-5">
            <h2 className="text-sm font-semibold text-desk">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-quiet">{item.body}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="card-surface p-5">
          <h2 className="text-sm font-semibold">넣는 것</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-quiet">
            {HOLDS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
        <article className="card-surface p-5">
          <h2 className="text-sm font-semibold">하지 않는 것</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-quiet">
            {DOES_NOT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="max-w-2xl space-y-3">
        <h2 className="text-sm font-semibold">여는 방법</h2>
        <p className="text-sm leading-relaxed text-quiet">
          설치 후 트레이 아이콘을 클릭하거나, 어디서든 <kbd className="rounded border border-line bg-card px-1.5 py-0.5 text-desk">Ctrl</kbd>
          {" + "}
          <kbd className="rounded border border-line bg-card px-1.5 py-0.5 text-desk">Alt</kbd>
          {" + "}
          <kbd className="rounded border border-line bg-card px-1.5 py-0.5 text-desk">E</kbd>
          로 패널을 엽니다. 창을 닫으면 종료되지 않고 트레이로 돌아갑니다.
        </p>
      </section>

      <section className="card-surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-ink" />
          <div>
            <h2 className="text-sm font-semibold">Windows 전용</h2>
            <p className="mt-1 text-sm text-quiet">
              웹 미리보기는 모양만 보여 줍니다. 실행·끌어놓기·팩 적용은 설치본에서만 됩니다.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <a className="btn-secondary w-full sm:w-auto" href="/preview">
            웹 미리보기
          </a>
          <a className="btn-primary w-full sm:w-auto" href="/download">
            데스크톱 받기
          </a>
        </div>
      </section>
    </div>
  );
}
