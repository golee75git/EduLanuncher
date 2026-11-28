import { Download, LayoutPanelTop } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SITE_CONFIG } from "../config";
import { SITE_RELEASE_NOTES } from "../data/releases";
import { OpinionPage } from "./OpinionPage";

const FEATURES = [
  {
    title: "트레이에 두고 필요할 때만",
    body: "평소에는 작업 표시줄 알림 영역에 있습니다. 실행 중에는 작업 표시줄에도 아이콘이 있습니다. 창을 닫아도 아이콘은 남고, 누르면 설정한 자리(기본은 오른쪽 아래)에 패널이 다시 열립니다. 트레이·표시줄 아이콘 또는 Ctrl+Alt+E로도 엽니다. 처음이거나 창이 520×720이면 세로를 이 모니터 작업 영역에 맞는 최대(상한 900)로 한 번 맞춥니다. 가로는 520입니다. 그 다음 모서리로 바꾼 크기는 이 PC에 남고, 다른 저장 크기는 유지합니다.",
  },
  {
    title: "사이트·프로그램·파일·폴더",
    body: "자주 쓰는 바로가기를 종류별로 둡니다. 공통 목록은 Pack(.edupack)으로 나눠 받을 수 있습니다.",
  },
] as const;

function FeatureWord({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-desk">{children}</strong>;
}

const HOLDS: { key: string; body: ReactNode }[] = [
  {
    key: "pin",
    body: (
      <>
        <FeatureWord>창 앞에 고정</FeatureWord>으로 열려 있는 강의 창이나 파일 탐색기를 골라 다른 창보다 앞에 두기. 떠 있는 창 안쪽의 고정은 주황색, 해제는 파랑색. 창을 옮기면 그 글자가 따라감. 고정한 창 뒤에 새 일반 창이 겹치면 같은 화면의 빈 칸으로 한 번만 옮김. 런처를 종료하면 그 고정은 해제
      </>
    ),
  },
  {
    key: "excel",
    body: (
      <>
        <FeatureWord>엑셀 취합</FeatureWord>, <FeatureWord>엑셀 값 채우기</FeatureWord>. 값 채우기는 고른 칸만 기준 파일의 빈 칸에 넣고 원본은 그대로
      </>
    ),
  },
  {
    key: "pdf",
    body: (
      <>
        글자가 있는 PDF를 <FeatureWord>엑셀로 저장</FeatureWord>. <FeatureWord>PDF 도구</FeatureWord>에서 <FeatureWord>합치기</FeatureWord>·<FeatureWord>나누기</FeatureWord>·<FeatureWord>페이지 정리</FeatureWord>·<FeatureWord>회전</FeatureWord>
      </>
    ),
  },
  {
    key: "photo",
    body: (
      <>
        <FeatureWord>사진에 글자</FeatureWord>, <FeatureWord>사진 모자이크</FeatureWord>, <FeatureWord>사진 용량 줄이기</FeatureWord>. 사진 모자이크는 영역을 직접 가리거나, 이 PC 안에서 얼굴·숫자 후보를 찾아 확인한 뒤에만 새 파일로 저장
      </>
    ),
  },
  {
    key: "timer",
    body: (
      <>
        <FeatureWord>타이머·스톱워치</FeatureWord>. 0 이후도 장미색으로 계속 세고, 타이머 구간도 <FeatureWord>CSV 저장</FeatureWord>·<FeatureWord>엑셀 저장</FeatureWord>
      </>
    ),
  },
  {
    key: "shortcuts",
    body: (
      <>
        <FeatureWord>사이트</FeatureWord>, <FeatureWord>프로그램</FeatureWord>, <FeatureWord>파일</FeatureWord>, <FeatureWord>폴더</FeatureWord> 바로가기
      </>
    ),
  },
  {
    key: "notice-pack",
    body: (
      <>
        <FeatureWord>기관 공지 Pack</FeatureWord>
      </>
    ),
  },
  {
    key: "share-pack",
    body: (
      <>
        <FeatureWord>공지·사이트 Pack</FeatureWord> (공지+사이트 한 파일)
      </>
    ),
  },
  {
    key: "memo",
    body: (
      <>
        <FeatureWord>메모</FeatureWord>. 크게는 런처 옆 창, 제목 줄로 옮기고 모서리로 크기 기억. <FeatureWord>메모 2</FeatureWord>부터 별도 창을 4개까지
      </>
    ),
  },
  {
    key: "drop",
    body: <>주소·파일·바로가기를 패널에 끌어 놓기. 즐겨찾기 PNG는 바로가기 그림으로 남김 (Windows 설치본)</>,
  },
  {
    key: "bookmarks",
    body: (
      <>
        이 PC Edge·Chrome 북마크와 <FeatureWord>인터넷 즐겨찾기</FeatureWord>. Windows .url은 파일 아이콘을 같이 넣기
      </>
    ),
  },
  {
    key: "hotkeys",
    body: (
      <>
        <FeatureWord>업무도구</FeatureWord>에서 <FeatureWord>단축키</FeatureWord> 20개 보기. <FeatureWord>탐색기</FeatureWord>·<FeatureWord>화면 잠금</FeatureWord>·<FeatureWord>설정</FeatureWord>·<FeatureWord>작업 관리자</FeatureWord>·<FeatureWord>화면 캡처</FeatureWord>는 실행. 화면 캡처는 자른 그림이 클립보드에 있을 때만 <FeatureWord>작업 고르기</FeatureWord>를 염
      </>
    ),
  },
  {
    key: "pc-screens",
    body: (
      <>
        <FeatureWord>컴퓨터도구</FeatureWord>에서 <FeatureWord>컴퓨터 이름 바꾸기</FeatureWord>·<FeatureWord>이 PC IP 주소</FeatureWord>·<FeatureWord>제어판</FeatureWord>·<FeatureWord>소리</FeatureWord>·<FeatureWord>인터넷 옵션</FeatureWord>·<FeatureWord>작업 관리자</FeatureWord>·<FeatureWord>익스플로러 설정 복원</FeatureWord> 등 이 PC 화면 열기
      </>
    ),
  },
  {
    key: "folder-find",
    body: (
      <>
        홈 검색과 <FeatureWord>이 PC 폴더 찾기</FeatureWord>. 이 사용자 폴더의 이름만 찾기 (내용은 읽지 않음)
      </>
    ),
  },
  {
    key: "qr",
    body: (
      <>
        <FeatureWord>QR코드 넣기</FeatureWord>. 이 PC 그림에 QR코드를 넣어 PNG로 저장
      </>
    ),
  },
  {
    key: "topics",
    body: (
      <>
        홈 검색과 <FeatureWord>업무자료</FeatureWord>에서 행정 관련 업무 찾기
      </>
    ),
  },
  {
    key: "work-map",
    body: (
      <>
        검색 결과 위에 <FeatureWord>업무 그림</FeatureWord>. <FeatureWord>크게 보기</FeatureWord>는 런처 옆을 조금 더 넓게 펼치고 끌어서 옮기기
      </>
    ),
  },
  {
    key: "back",
    body: (
      <>
        연 업무에서 <FeatureWord>뒤로</FeatureWord> 가면 직전 검색 화면이 다시 나오기
      </>
    ),
  },
  {
    key: "mindmap",
    body: (
      <>
        <FeatureWord>업무지도</FeatureWord>에서 마인드맵 계층을 목록으로 보기
      </>
    ),
  },
  {
    key: "epki",
    body: (
      <>
        <FeatureWord>EPKI</FeatureWord> 인증서 등 매뉴얼 JSON을 검색·상세와 같은 목록으로 보기
      </>
    ),
  },
  {
    key: "docs",
    body: (
      <>
        <FeatureWord>내 문서</FeatureWord>. 설정에서 고른 폴더의 HWPX·XLSX·DOCX·PDF·TXT·MD·CSV에서 찾기. 세 글자 이상은 짧은 구절, 한두 글자는 파일 이름. 구형 HWP와 글자 없는 PDF는 읽지 않음
      </>
    ),
  },
  {
    key: "pc-check",
    body: (
      <>
        <FeatureWord>PC 문제 해결</FeatureWord>, <FeatureWord>인터넷 연결 점검</FeatureWord>, <FeatureWord>프린터 출력 점검</FeatureWord>, <FeatureWord>보안 상태 점검</FeatureWord>. 점검 시작을 누른 뒤에만 이 PC 상태를 보고, 설정을 바꾸지 않음
      </>
    ),
  },
  {
    key: "todo",
    body: (
      <>
        <FeatureWord>할 일</FeatureWord>. 오늘·내일·모레. 지난 날짜의 미완료는 오늘 칸에 남음. <FeatureWord>캘린더</FeatureWord>는 구글·네이버 공식 누리집만 염
      </>
    ),
  },
  {
    key: "photo-drop",
    body: (
      <>
        사진 한 장은 <FeatureWord>사진 다듬기</FeatureWord>(돌리기·자르기), <FeatureWord>사진에 글자</FeatureWord>, <FeatureWord>사진 모자이크</FeatureWord>, <FeatureWord>QR코드 넣기</FeatureWord>. 여러 장은 <FeatureWord>사진 용량 줄이기</FeatureWord>와 <FeatureWord>사진 PDF</FeatureWord>
      </>
    ),
  },
  {
    key: "search",
    body: (
      <>
        홈 검색은 이름 앞 <FeatureWord>초성</FeatureWord>으로도 찾음. ㄱㅅㄱ은 <FeatureWord>계산기</FeatureWord>. 영문 자판으로 친 글자가 한글로 이어지면 그 한글도 함께 비교. <FeatureWord>계산기</FeatureWord>·<FeatureWord>메모장</FeatureWord>·<FeatureWord>그림판</FeatureWord>·<FeatureWord>파일 탐색기</FeatureWord> 등 이 PC 기본 프로그램도 검색에서 염
      </>
    ),
  },
  {
    key: "backup",
    body: (
      <>
        설정의 <FeatureWord>다른 PC로 옮기기</FeatureWord>. 바로가기·공지·메모·할 일·표시 설정을 파일로 저장. 프로그램과 파일 자체는 복사하지 않음
      </>
    ),
  },
  {
    key: "handover",
    body: (
      <>
        <FeatureWord>업무 인수인계</FeatureWord>. 고른 업무 폴더만 이 PC 안에서 읽어 월별 시기와 기한을 카드로 보여 줌. 원본은 그대로 두고, 저장을 누르기 전에는 이 PC에 남기지 않음. <FeatureWord>인계 박스</FeatureWord>는 고른 카드·바로가기·메모만 .edupack으로 넘김
      </>
    ),
  },
  {
    key: "privacy",
    body: (
      <>
        <FeatureWord>개인정보 보호</FeatureWord>. 고른 파일이나 폴더만 이 PC 안에서 확인. 원본은 바꾸지 않고, 경로는 화면에 나가지 않음
      </>
    ),
  },
];

const DOES_NOT = [
  "계정 로그인이나 클라우드 동기화",
  "나이스 등 학교 시스템 자동 연결",
  "브라우저에서 프로그램·파일 실행",
  "디스크 전체 검색",
  "NotebookLM 등 외부 노트 화면 수집",
] as const;

export function IntroPage() {
  const [downloads, setDownloads] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/downloads")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { downloads?: unknown } | null) => {
        const count = data?.downloads;
        if (alive && typeof count === "number" && Number.isInteger(count) && count >= 0) {
          setDownloads(count);
        }
      })
      .catch(() => {
        // 받은 횟수가 없어도 설치 단추는 그대로다.
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <div className="max-w-2xl space-y-4">
        <p className="text-[11px] font-semibold tracking-wide text-ink">{SITE_CONFIG.appName}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          <span className="text-desk">행정 업무 효율화를 위한</span>
          <br />
          <span className="text-ink">Windows 업무 런처</span>
        </h1>
        <div className="relative">
          <img
            src="/main-img.png"
            width={1122}
            height={1402}
            alt="AI런처 안내 그림"
            className="h-auto w-full rounded-lg"
          />
          <a
            className="absolute rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            style={{ left: "30.04%", top: "89.66%", width: "39.75%", height: "4.56%" }}
            href={SITE_CONFIG.setupDownloadUrl}
            aria-label="지금 설치하기"
            rel="noreferrer"
          >
            <span className="sr-only">지금 설치하기</span>
          </a>
        </div>
        <p className="text-lg leading-relaxed text-desk">
          기능 이름을 몰라도, 하고 싶은 일을 검색하면 됩니다.
        </p>
        <p className="text-base leading-relaxed text-quiet">
          {SITE_CONFIG.displayName}는 기관 직원용 작은 패널입니다. 웹 서비스가 아니라 이 PC에 설치하는
          프로그램입니다. 평소에는 화면을 가리지 않고, 필요할 때만 엽니다.
        </p>
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm leading-relaxed text-desk">
          <strong className="font-semibold">개인 사용 PC에만 설치하세요.</strong> 이 PC에서만 동작합니다. 서버에
          로그인하지 않습니다. 공지·메모·바로가기 목록은 설치한 컴퓨터에만 저장됩니다. 공용 PC·실습실·다른 사람
          계정에는 설치하지 않습니다.
          <br />
          개발중인 버전으로 오류가 있을 수 있습니다.
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
          {downloads !== null ? (
            <>
              <br />
              설치 파일을 받은 횟수 {downloads.toLocaleString("ko-KR")}
            </>
          ) : null}
        </p>
        <img
          src="/launchermain.png"
          alt="AI런처 패널"
          className="h-auto w-full rounded-lg border border-line"
        />
        </div>
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
          <h2 className="text-sm font-semibold">주요 기능</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-quiet">
            {HOLDS.map((item) => (
              <li key={item.key}>{item.body}</li>
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

      <section className="max-w-2xl space-y-2">
        <h2 className="text-sm font-semibold">최신버전 {SITE_CONFIG.version}</h2>
        <p className="text-sm leading-relaxed text-quiet">{SITE_RELEASE_NOTES[0]?.note}</p>
      </section>

      <OpinionPage section />
    </div>
  );
}
