import { Download } from "lucide-react";

const PANEL_SRC = import.meta.env.DEV ? "http://localhost:1420/" : "/panel/index.html";

const CAN = [
  "홈 배치, 스킨, 검색",
  "공지, 할 일, 메모 글을 넣고 이 브라우저에 남기기",
  "앱에 들어 있는 업무자료, 편람, PC 문제 해결 안내 보기",
] as const;

const CANNOT = [
  "트레이, Ctrl+Alt+E, 시작 시 자동 실행, 창 위치. Windows가 창을 다룹니다.",
  "프로그램, 파일, 폴더, Windows 설정 화면 열기. 사이트 바로가기도 설치본의 실행 명령을 탑니다.",
  "탐색기에서 끌어다 놓기, 파일 선택 창, Edge·Chrome 즐겨찾기와 아이콘. 이 PC의 파일과 브라우저 저장을 읽습니다.",
  "Pack 적용, 백업 파일 저장, 다른 PC로 옮기기. 파일을 고르고 쓰는 단계가 Windows에 있습니다.",
  "PDF, 사진 용량, 사진 글자, 사진 모자이크, QR코드. 원본 옆에 새 파일을 만듭니다.",
  "개인정보 검사, 내 문서 검색, 이 PC 폴더 이름, 업무 인수인계. 고른 폴더를 이 PC에서 읽습니다.",
  "인터넷·프린터·보안 점검, IP·CCTV 확인. 이 PC의 상태를 봅니다.",
  "메모 크게 보기와 업무 그림 크게 보기. 런처 옆의 별도 창입니다.",
  "시작할 때 받아 오는 업무자료 묶음. 그 묶음이 없으면 교육행정 매뉴얼은 불러오지 못했다고 나옵니다. 앱에 들어 있는 관련 업무 검색은 그대로 됩니다.",
] as const;

export function PreviewPage() {
  return (
    <div className="space-y-8">
      <section className="max-w-2xl space-y-3">
        <p className="text-[11px] font-semibold tracking-wide text-ink">화면 확인</p>
        <h1 className="text-2xl font-semibold text-desk">웹 미리보기</h1>
        <p className="text-sm leading-relaxed text-quiet">
          아래는 설치본과 같은 패널입니다. 검색, 공지, 할 일, 메모, 업무자료 화면은 눌러 볼 수 있습니다.
          목록은 이 브라우저에만 남고, 설치본 데이터와는 섞이지 않습니다. 이 PC의 파일과 프로그램을 다루는
          기능은 여기서 실행되지 않습니다.
        </p>
        {import.meta.env.DEV ? (
          <p className="text-sm leading-relaxed text-quiet">
            이 개발 화면은 이 PC의 런처 개발 서버(1420)를 보여 줍니다. 그 서버가 꺼져 있으면 칸이 비어 있습니다.
          </p>
        ) : null}
      </section>

      <div className="overflow-x-auto pb-2">
        <iframe
          title="AI런처 패널"
          src={PANEL_SRC}
          className="h-[720px] w-[520px] max-w-none rounded-lg border border-line bg-card"
          referrerPolicy="no-referrer"
        />
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="card-surface p-5">
          <h2 className="text-sm font-semibold">웹에서 되는 일</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-quiet">
            {CAN.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
        <article className="card-surface p-5">
          <h2 className="text-sm font-semibold">웹에서 안 되는 일</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-quiet">
            {CANNOT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="card-surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">실제 사용은 설치본에서</h2>
          <p className="mt-1 text-sm text-quiet">
            프로그램·파일 실행, Pack, 탐색기 끌어놓기, 이 PC 점검은 Windows 설치본에서만 됩니다.
          </p>
        </div>
        <a className="btn-primary w-full sm:w-auto" href="/download">
          <Download className="h-4 w-4" />
          Windows 설치 파일
        </a>
      </section>
    </div>
  );
}
