import { ChevronDown, Download, LayoutPanelTop } from "lucide-react";
import { SITE_CONFIG } from "../config";
import { SITE_RELEASE_NOTES } from "../data/releases";
import { OpinionPage } from "./OpinionPage";

const FEATURES = [
  {
    title: "트레이에 두고 필요할 때만",
    body: "평소에는 작업 표시줄 알림 영역에 있습니다. 실행 중에는 작업 표시줄에도 아이콘이 있습니다. 창을 닫아도 아이콘은 남고, 누르면 설정한 자리(기본은 오른쪽 아래)에 패널이 다시 열립니다. 트레이·표시줄 아이콘 또는 Ctrl+Alt+E로도 엽니다. 처음은 440×650이고, 모서리로 크기를 바꾼 값은 이 PC에 남습니다.",
  },
  {
    title: "사이트·프로그램·파일·폴더",
    body: "자주 쓰는 바로가기를 종류별로 둡니다. 공통 목록은 Pack(.edupack)으로 나눠 받을 수 있습니다.",
  },
] as const;

const HOLDS = [
  "사이트, 프로그램, 파일, 폴더 바로가기",
  "기관 공지 Pack",
  "공지·사이트 Pack (공지+사이트 한 파일)",
  "한 장의 메모 (크게는 런처 옆 창, 제목 줄로 옮기고 모서리로 크기 기억)",
  "주소·파일·바로가기를 패널에 끌어 놓기. 즐겨찾기 PNG는 바로가기 그림으로 남김 (Windows 설치본)",
  "이 PC Edge·Chrome 북마크와 Windows 즐겨찾기 바로가기 보기. Windows .url은 파일 아이콘을 같이 넣기",
  "업무도구에서 단축키 20개 보기 (탐색기·잠금·설정·작업 관리자·캡처는 실행)",
  "업무도구에서 컴퓨터 이름·이 PC IP 주소·제어판·소리·인터넷 옵션·작업 관리자·익스플로러 설정 복원 등 이 PC 화면 열기",
  "홈 검색과 컴퓨터도구에서 이 사용자 폴더의 이름만 찾기 (내용은 읽지 않음)",
  "업무도구에서 이 PC 그림에 QR코드를 넣어 PNG로 저장",
  "홈 검색과 업무자료에서 교육행정 관련 업무 찾기",
  "검색 결과 위에 업무 그림을 두고, 크게 보기는 런처 옆을 조금 더 넓게 펼치고 끌어서 옮기기",
  "연 업무에서 뒤로 가면 직전 검색 화면이 다시 나오기",
  "업무자료 업무지도에서 마인드맵 계층을 목록으로 보기",
  "EPKI 인증서 등 매뉴얼 JSON을 검색·상세와 같은 목록으로 보기",
] as const;

const DOES_NOT = [
  "계정 로그인이나 클라우드 동기화",
  "나이스·교육청 등 학교 시스템 자동 연결",
  "브라우저에서 프로그램·파일 실행",
  "디스크 전체 검색이나 파일 내용 색인",
  "NotebookLM 등 외부 노트 화면 수집",
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
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm leading-relaxed text-desk">
          <strong className="font-semibold">개인 사용 PC에만 설치하세요.</strong> 공용 PC·실습실·다른 사람
          계정에는 설치하지 않습니다. 목록은 설치한 컴퓨터에만 남습니다.
          <br />
          런처는 컴퓨터에 있는 파일이나 폴더를 삭제하지는 않습니다.
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

      <section className="grid gap-4 sm:grid-cols-2">
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

      <section className="max-w-2xl">
        <details className="card-surface group">
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-desk [&::-webkit-details-marker]:hidden">
            <span>버전 {SITE_CONFIG.version}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-quiet group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-line/70 px-4 py-3">
            <p className="text-sm leading-relaxed text-quiet">
              지금 받을 수 있는 설치 파일은 {SITE_CONFIG.version}입니다. 아래는 주요 수정·개선입니다. 설치 파일은
              GitHub Releases에서 받습니다.
            </p>
            <ol className="divide-y divide-line/70">
              {SITE_RELEASE_NOTES.map((item) => (
                <li key={item.version} className="py-3">
                  <p className="text-sm font-medium text-desk">{item.version}</p>
                  <p className="mt-1 text-sm leading-relaxed text-quiet">{item.note}</p>
                </li>
              ))}
            </ol>
            <p className="text-sm leading-relaxed text-quiet">
              이전 설치 파일은{" "}
              <a
                className="font-medium text-ink hover:text-ink-strong"
                href={SITE_CONFIG.releasesUrl}
                rel="noreferrer"
                target="_blank"
              >
                GitHub Releases
              </a>
              에서 볼 수 있습니다.
            </p>
          </div>
        </details>
      </section>

      <OpinionPage section />

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
      <p className="text-sm leading-relaxed text-quiet">
        사용 의견은 <a className="underline decoration-line underline-offset-2 hover:text-desk" href="/opinion">의견</a>
        에 이름과 글을 남깁니다. 계정은 없습니다.
      </p>
      <p className="text-sm leading-relaxed text-quiet">
        <span className="font-semibold text-desk">이 PC에서만 동작.</span> 서버에 로그인하지 않습니다. 공지·메모·바로가기
        목록은 설치한 컴퓨터에만 저장됩니다. 개인 사용 PC에만 설치하세요.
      </p>
    </div>
  );
}
