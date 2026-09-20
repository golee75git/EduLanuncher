import { Download } from "lucide-react";
import { LauncherMock } from "../components/LauncherMock";

const CAN = [
  "패널 크기(440×650)와 구역 배치를 눈으로 확인",
  "공지·바로가기 그룹이 어떻게 보이는지 샘플로 확인",
] as const;

const CANNOT = [
  "트레이와 Ctrl+Alt+E",
  "프로그램·파일·폴더 실행, 탐색기 끌어놓기",
  "공지 팩·바로가기 팩 적용과 자동 시작",
  "IP·CCTV 스캔 같은 이 PC 네트워크 도구",
] as const;

export function PreviewPage() {
  return (
    <div className="space-y-8">
      <section className="max-w-2xl space-y-3">
        <p className="text-[11px] font-semibold tracking-wide text-ink">모양 확인용</p>
        <h1 className="text-2xl font-semibold text-desk">웹 미리보기</h1>
        <p className="text-sm leading-relaxed text-quiet">
          이 페이지는 Windows 런처를 브라우저에서 실행하는 것이 아닙니다. 패널이 어떻게 생겼는지만 보여 줍니다.
          아래 화면은 샘플이며, 클릭해도 사이트나 프로그램이 열리지 않습니다.
        </p>
      </section>

      <div className="overflow-x-auto pb-2">
        <LauncherMock />
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
          <p className="mt-1 text-sm text-quiet">바로가기 실행, Pack 적용, 끌어놓기는 Windows 앱에서만 됩니다.</p>
        </div>
        <a className="btn-primary w-full sm:w-auto" href="/download">
          <Download className="h-4 w-4" />
          Windows 설치 파일
        </a>
      </section>
    </div>
  );
}
