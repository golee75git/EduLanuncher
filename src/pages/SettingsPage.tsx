import { open, save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_CONFIG } from "../config/app";
import type { LauncherPack } from "../data/educationPack";
import { applyPackFromPath } from "../services/applyNoticePack";
import { launchQuickUrl } from "../services/launcherService";
import { applyLauncherBackup, buildLauncherBackup, parseLauncherBackup } from "../services/backupService";
import { buildLauncherPack } from "../services/launcherPackService";
import { parseNoticePack, readJsonFile, writeJsonFile } from "../services/noticePackService";
import type { NoticePack } from "../types/notice";
import { useSettingsStore } from "../stores/settingsStore";
import { useToolStore } from "../stores/toolStore";
import { PANEL_SKIN_OPTIONS, type LauncherPosition, type ListColumns, type PanelSkin } from "../types/settings";

interface SettingsPageProps {
  onBack: () => void;
  onWriteNotices: () => void;
  onWriteSharePack: () => void;
  onTopicReview: () => void;
  onNoticePack: (pack: NoticePack, sitePack?: LauncherPack) => void;
}

export function SettingsPage({
  onBack,
  onWriteNotices,
  onWriteSharePack,
  onTopicReview,
  onNoticePack,
}: SettingsPageProps) {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const tools = useToolStore((state) => state.tools);
  const [packMessage, setPackMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold text-desk">설정</h1>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <SettingsCard title="시작">
          <Toggle
            label="시작 시 자동 실행"
            checked={settings.autoStart}
            onChange={(autoStart) => void update({ autoStart })}
          />
          <Toggle
            label="시작 시 창 표시"
            checked={settings.showWindowOnLaunch}
            onChange={(showWindowOnLaunch) => void update({ showWindowOnLaunch })}
          />
        </SettingsCard>

        <SettingsCard title="런처">
          <label className="block text-sm text-desk">
            런처 위치
            <select
              className="field-input"
              value={settings.launcherPosition}
              onChange={(event) =>
                void update({ launcherPosition: event.target.value as LauncherPosition })
              }
            >
              <option value="bottom-right">오른쪽 아래</option>
              <option value="center">화면 중앙</option>
            </select>
          </label>
          <ShortcutField
            value={settings.globalShortcut}
            onSave={(globalShortcut) => void update({ globalShortcut })}
          />
          <NumberField
            label="즐겨찾기 표시 개수"
            value={settings.favoriteCount}
            min={3}
            max={12}
            onChange={(favoriteCount) => void update({ favoriteCount })}
          />
          <NumberField
            label="최근 사용 표시 개수"
            value={settings.recentCount}
            min={3}
            max={10}
            onChange={(recentCount) => void update({ recentCount })}
          />
          <Toggle
            label="Todo 완료항목 표시"
            checked={settings.showCompletedTodos}
            onChange={(showCompletedTodos) => void update({ showCompletedTodos })}
          />
        </SettingsCard>

        <SettingsCard title="보기">
          <p className="text-xs leading-5 text-quiet">
            패널 안 색만 바꿉니다. 창 테두리는 Windows가 그립니다.
          </p>
          <label className="block text-sm text-desk">
            기본 스킨
            <select
              className="field-input"
              value={settings.panelSkin}
              onChange={(event) => void update({ panelSkin: event.target.value as PanelSkin })}
            >
              {PANEL_SKIN_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.hint}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-desk">
            모두 목록 열
            <select
              className="field-input"
              value={settings.listColumns}
              onChange={(event) =>
                void update({ listColumns: Number(event.target.value) as ListColumns })
              }
            >
              <option value={1}>1열</option>
              <option value={2}>2열</option>
            </select>
          </label>
          <p className="text-xs leading-5 text-quiet">
            모두 화면의 기본 열입니다. 2열을 고르고 패널을 가로로 넓히면(약 560px 이상) 3열로 보입니다. 홈
            자주 사용하는 도구도 같은 너비에서 2·3열이 바뀝니다.
          </p>
        </SettingsCard>

        <SettingsCard title="바로가기 Pack">
          <p className="text-xs leading-5 text-quiet">
            이 PC에서 넣은 바로가기를 Pack으로 나눠 줍니다. 사이트에서 그림을 받아오지 않습니다.
            같은 도구 ID면 아이콘만 바뀌고, 없는 바로가기는 추가됩니다.
            브라우저 주소나 .url 바로가기를 패널에 놓아도 넣습니다.
            처음 설치에는 사이트·프로그램·파일·폴더가 비어 있습니다. 할 일도 비어 있습니다. 업무도구에는 QR코드 넣기가 있고, 컴퓨터도구와 업무자료는 앱에 있습니다.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              void (async () => {
                try {
                  const selected = await open({
                    multiple: false,
                    filters: [{ name: "Pack", extensions: ["edupack", "json"] }],
                  });
                  if (typeof selected !== "string") {
                    return;
                  }
                  const result = await applyPackFromPath(selected);
                  if (result.mode === "notice-pick") {
                    onNoticePack(result.pack, result.sitePack);
                    return;
                  }
                  setPackMessage(result.message);
                } catch (error) {
                  setPackMessage(error instanceof Error ? error.message : "Pack을 가져오지 못했습니다.");
                }
              })();
            }}
          >
            바로가기 Pack 가져오기
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void (async () => {
                try {
                  const pack = buildLauncherPack("공통 사이트", tools);
                  const selected = await save({
                    defaultPath: "site-icon-pack.edupack",
                    filters: [
                      { name: "Pack", extensions: ["edupack"] },
                      { name: "JSON", extensions: ["json"] },
                    ],
                  });
                  if (typeof selected !== "string") {
                    return;
                  }
                  const path = /\.(edupack|json)$/i.test(selected) ? selected : `${selected}.edupack`;
                  await writeJsonFile(path, `${JSON.stringify(pack, null, 2)}\n`);
                  setPackMessage("사이트 아이콘 Pack 파일을 저장했습니다.");
                } catch (error) {
                  setPackMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
                }
              })();
            }}
          >
            사이트 아이콘 Pack 저장
          </button>
          {packMessage ? <p className="text-xs text-quiet">{packMessage}</p> : null}
        </SettingsCard>

        <SettingsCard title="공지·사이트 Pack">
          <p className="text-xs leading-5 text-quiet">
            공지와 사이트 바로가기만 한 파일로 나눠 줍니다. 저장할 때 항목을 고릅니다. 할 일·메모·설정은 넣지
            않습니다. 받는 쪽에서 공지와 사이트를 고릅니다. 백업 파일과는 다릅니다.
          </p>
          <button type="button" className="btn-primary" onClick={onWriteSharePack}>
            공지·사이트 Pack 저장
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void (async () => {
                try {
                  const selected = await open({
                    multiple: false,
                    filters: [{ name: "Pack", extensions: ["edupack", "json"] }],
                  });
                  if (typeof selected !== "string") {
                    return;
                  }
                  const result = await applyPackFromPath(selected);
                  if (result.mode === "notice-pick") {
                    onNoticePack(result.pack, result.sitePack);
                    return;
                  }
                  setShareMessage(result.message);
                } catch (error) {
                  setShareMessage(error instanceof Error ? error.message : "Pack을 가져오지 못했습니다.");
                }
              })();
            }}
          >
            공지·사이트 Pack 가져오기
          </button>
          {shareMessage ? <p className="text-xs text-quiet">{shareMessage}</p> : null}
        </SettingsCard>

        <SettingsCard title="공지">
          <p className="text-xs leading-5 text-quiet">
            홈 공지 한 칸에 기관(담당자)과 부서 안내가 함께 보입니다. Pack은 고른 항목만 더하고, 이미 있는 id는
            건너뜁니다. 이 PC에서 넣기·수정·빼기가 됩니다. 게시판을 읽어 오지 않습니다.
          </p>
          <button type="button" className="btn-primary" onClick={onWriteNotices}>
            공지 Pack 작성
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void (async () => {
                try {
                  const selected = await open({
                    multiple: false,
                    filters: [
                      { name: "공지 Pack", extensions: ["edupack", "json"] },
                    ],
                  });
                  if (typeof selected !== "string") {
                    return;
                  }
                  const parsed = JSON.parse(await readJsonFile(selected)) as unknown;
                  onNoticePack(parseNoticePack(parsed));
                } catch (error) {
                  setNoticeMessage(
                    error instanceof Error ? error.message : "Pack을 가져오지 못했습니다.",
                  );
                }
              })();
            }}
          >
            Pack 가져오기
          </button>
          {noticeMessage ? <p className="text-xs text-quiet">{noticeMessage}</p> : null}
        </SettingsCard>

        <SettingsCard title="다른 PC로 옮기기">
          <p className="text-xs leading-5 text-quiet">
            바로가기, 공지, 메모, 할 일, 표시 설정을 파일로 저장합니다. 프로그램·파일 자체는 복사하지 않습니다.
            새 PC에 런처를 설치한 뒤 이 파일을 가져오면 됩니다.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void (async () => {
                try {
                  const selected = await save({
                    defaultPath: "edulauncher-backup.json",
                    filters: [{ name: "JSON", extensions: ["json"] }],
                  });
                  if (typeof selected !== "string") {
                    return;
                  }
                  const path = /\.json$/i.test(selected) ? selected : `${selected}.json`;
                  const backup = buildLauncherBackup();
                  await writeJsonFile(path, `${JSON.stringify(backup, null, 2)}\n`);
                  setBackupMessage("백업 파일을 저장했습니다.");
                } catch (error) {
                  setBackupMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
                }
              })();
            }}
          >
            백업 저장
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void (async () => {
                try {
                  const selected = await open({
                    multiple: false,
                    filters: [{ name: "JSON", extensions: ["json"] }],
                  });
                  if (typeof selected !== "string") {
                    return;
                  }
                  const text = await readJsonFile(selected);
                  if (text.length > 512 * 1024) {
                    throw new Error("파일이 너무 큽니다.");
                  }
                  const parsed = JSON.parse(text) as unknown;
                  setBackupMessage(await applyLauncherBackup(parseLauncherBackup(parsed)));
                } catch (error) {
                  setBackupMessage(
                    error instanceof Error ? error.message : "백업을 가져오지 못했습니다.",
                  );
                }
              })();
            }}
          >
            백업 가져오기
          </button>
          {backupMessage ? <p className="text-xs text-quiet">{backupMessage}</p> : null}
        </SettingsCard>

        <SettingsCard title="업무자료">
          <p className="text-xs leading-5 text-quiet">
            홈 검색 또는 업무도구의 업무자료에서 관련 업무를 찾습니다. 검색 결과 위에 업무 그림이 나오고, 크게 보기에서 런처 옆을 조금 더 넓게 펼칩니다. 그림은 그 창을 채웁니다. 자세한 업무에서 뒤로 가면 방금 검색한 화면이 다시 나옵니다. 업무지도 탭은 목록입니다. 교육행정전자서명(EPKI) 인증서는 같은 JSON에서 검색·목록·상세가 이어집니다.
          </p>
          {import.meta.env.DEV ? (
            <button type="button" className="btn-secondary" onClick={onTopicReview}>
              검토가 필요한 업무자료
            </button>
          ) : null}
        </SettingsCard>

        <SettingsCard title="프로그램 정보">
          <p className="text-xs leading-5 text-quiet">
            설치 파일 {APP_CONFIG.setupFile}
            <br />
            날짜 복사본 {APP_CONFIG.setupFileDated}
          </p>
          <p className="mt-2 text-sm text-desk">
            {APP_CONFIG.appName} {APP_CONFIG.version}
          </p>
          <p className="mt-2 text-xs leading-5 text-quiet">
            {APP_CONFIG.appName}의 개인 설정과 바로가기 정보는 이 PC에 저장됩니다. 글꼴은 Windows 시스템 글꼴을
            씁니다. 업무도구 「QR코드 넣기」에 쓰는 QR Code는 DENSO WAVE INCORPORATED의 등록상표이며, 이 프로그램은
            그 상표를 소유하지 않습니다. 외부 구성 요소 고지는 저장소 THIRD_PARTY_NOTICES.md에 있습니다. 특허
            비침해를 보장하지 않습니다.
          </p>
        </SettingsCard>

        <SettingsCard title="사용 방법">
          <p className="text-xs leading-5 text-quiet">
            설치 파일 {APP_CONFIG.setupFile} · 날짜 복사본 {APP_CONFIG.setupFileDated} · {APP_CONFIG.version}
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-5 text-quiet">
            <li>개인 사용 PC에만 설치하세요. 공용 PC·실습실·다른 사람 계정에는 설치하지 않습니다. 목록은 설치한 컴퓨터에만 남습니다. 런처는 컴퓨터에 있는 파일이나 폴더를 삭제하지는 않습니다.</li>
            <li>설치가 끝나면 프로그램이 바로 실행되고, 처음에는 시작 시 자동 실행·시작 시 창 표시가 켜져 있습니다. 설정에서 끌 수 있습니다.</li>
            <li>설정의 보기에서 서류·밝은 화면·어두운 화면 스킨과 모두 목록 1열·2열을 고릅니다. 2열일 때 패널을 가로로 넓히면 홈·모두 목록이 3열로 바뀝니다.</li>
            <li>트레이, 작업 표시줄 아이콘 또는 Ctrl+Alt+E로 패널을 엽니다. 창을 닫아도 작업 표시줄 아이콘은 남고, 아이콘을 누르면 다시 열립니다. 컴퓨터를 켜 두면 아이콘이 있습니다. 완전히 끄려면 트레이에서 종료합니다. 창 모서리를 끌어 크기를 바꿀 수 있고, 바꾼 크기는 이 PC에 남습니다. 처음 설치는 440×650입니다. 가로로 넓히면(약 560px 이상) 자주 사용하는 도구·모두 목록이 3열로 보입니다.</li>
            <li>설정의 공지·사이트 Pack에서 나눌 공지·사이트를 고른 뒤 한 파일로 저장합니다. 받는 쪽에서 공지와 사이트를 고릅니다. 할 일·메모·설정은 넣지 않으며, 다른 PC로 옮기기(백업)와는 다릅니다.</li>
            <li>처음 설치에는 사이트·프로그램·파일·폴더와 할 일이 비어 있습니다. 홈의 자주 사용하는 도구에 끌어놓기나 + 안내가 나옵니다. 종류 이름(사이트·프로그램 등)은 구역 제목보다 한 단계 작게 두고, 모두·즐겨찾기 등 단추 글자는 그대로입니다. 종류마다 2열로 최대 6개까지 보이고, 더 있으면 모두에서 봅니다. + 또는 끌어놓기로 넣고, 설정에서 Pack으로 나눠 줍니다. 이미 쓰는 PC의 바로가기·할 일 목록은 그대로입니다. 업무도구에는 QR코드 넣기가 있고, 컴퓨터도구와 업무자료는 앱에 있습니다. Network·CCTV는 첫 설치에 넣지 않으며, 담당자용 Pack을 적용한 PC에만 목록에 생깁니다.</li>
            <li>바로가기 위에 마우스를 올리면 설명이 나옵니다. 설명이 없으면 이름이 나옵니다.</li>
            <li>카드 오른쪽 클릭 또는 점 세 개로 메뉴를 엽니다.</li>
            <li>사이트 칸의 인터넷 즐겨찾기는 이 PC Edge·Chrome 북마크와 Windows .url만 읽습니다.</li>
            <li>안쪽 화면 오른쪽 아래 처음 화면, 또는 홈에서 검색 중일 때 위쪽 처음 화면을 누르면 공지·바로가기 첫 화면으로 갑니다.</li>
            <li>홈 아래 메모의 크게는 런처 옆에 창을 엽니다. 제목 줄로 옮기고, 모서리로 크기를 바꿉니다. 바꾼 크기는 이 PC에 남습니다. 패널을 숨기면 같이 숨고, 다시 열면 옮긴 자리·크기가 있습니다. 제목 줄 X로 닫으면 다음 크게는 다시 옆에서 엽니다.</li>
            <li>홈 검색 결과는 관련 도구, 최근 사용, 이 PC 폴더, 학교, 관련 업무 순입니다. 관련 도구 줄마다 사이트·프로그램·파일·폴더·업무도구가 보입니다. 관련 업무 위에 업무 그림이 있고, 크게 보기에서 런처 옆을 조금 더 넓게 펼칩니다. 그림은 창을 채웁니다. 확대·축소 단추와 마우스 휠로 크기를 바꾸고, 끌어서 옮깁니다. 상자를 누르면 패널에 자세한 업무가 열립니다. 그 창은 제목 줄 X로 닫습니다. 패널을 숨기면 같이 숨습니다. 프로그램은 트레이 종료로 끕니다. 관련 업무를 연 뒤 위쪽 뒤로 또는 오른쪽 아래 이전화면을 누르면 검색어와 그림·목록이 그대로 있습니다. 처음 화면을 누르면 빈 홈으로 갑니다.</li>
            <li>홈 검색에 두 글자 이상 적으면 맨 아래에 이 PC 폴더가 나옵니다. 바탕화면·문서·다운로드의 이름만 보고, 내용은 읽지 않습니다. 더 보기에서 사진·음악·동영상도 고를 수 있습니다.</li>
            <li>업무도구 칸의 단축키에서 Windows·문서 단축키 20개를 봅니다. 탐색기·화면 잠금·설정·작업 관리자·화면 캡처는 실행으로 같은 화면이나 프로그램을 엽니다. 키를 대신 누르지는 않습니다.</li>
            <li>업무도구 칸의 업무자료에서 검색결과와 업무지도를 고릅니다. 검색결과 위에도 업무 그림이 있습니다. 관련 업무를 연 뒤 뒤로 가면 방금 검색한 화면이 다시 나옵니다. 업무지도 항목을 누르면 자세한 업무가 열립니다. 인증서(EPKI)는 같은 목록에서 발급·갱신·재발급·백업을 찾습니다. JSON에 주소가 있는 자료만 바깥에서 엽니다. 학교알리미·나라장터·교육시설 통합정보망은 제목이 일치하면 공식 누리집을 엽니다.</li>
            <li>업무도구 칸의 컴퓨터도구는 이 PC Windows 설정 화면을 열거나, 사설·공인 IP와 익스플로러 설정 복원 확인 화면을 엽니다. 소리·인터넷 옵션·작업 관리자 화면도 엽니다. 「이 PC 폴더 찾기」는 이 사용자 폴더의 이름만 찾습니다.</li>
            <li>업무도구의 QR코드 넣기는 이 PC 그림 오른쪽 아래에 주소 QR코드를 넣고 PNG로 저장합니다. http 또는 https만 됩니다. QR Code는 DENSO WAVE INCORPORATED의 등록상표입니다. 특허 비침해를 보장하지 않습니다.</li>
            <li>네트워크·CCTV 검색 중에는 예상 시간이 나오고 중지로 멈출 수 있습니다.</li>
            <li>주소·파일·Pack을 패널에 끌어 넣을 수 있습니다. 폴더는 Windows 탐색기(explorer.exe)로 엽니다. 파일·프로그램·사이트는 이전과 같습니다.</li>
            <li>홈 공지는 한 칸입니다. 줄마다 기관(담당자) 또는 부서를 표시합니다. 넣기·모두에서 수정·빼기가 됩니다. Pack은 고른 항목만 더하고 이미 있는 항목은 건너뜁니다. 원문 주소가 있으면 브라우저만 엽니다.</li>
            <li>홈 할 일은 오늘·내일·모레를 고른 뒤 넣습니다. 파일에는 달력 날짜만 남고, 화면에는 오늘(9.20)처럼 보입니다. 지난 날짜의 미완료는 오늘 칸에 남습니다.</li>
            <li>할 일 칸 오늘·내일·모레 줄 오른쪽의 캘린더를 누르면 구글·네이버 공식 누리집을 고릅니다. 일정은 가져오지 않습니다.</li>
            <li>최근 사용에는 실행한 바로가기와 열어 본 관련 업무만 남습니다. 검색창에 친 말은 넣지 않습니다.</li>
            <li>설정 맨 아래 소개 사이트에서 설치 안내 웹 주소를 엽니다. 소개 웹은 website 폴더만 올리고, 설치 파일은 GitHub Releases에 있습니다.</li>
            <li>QR Code는 DENSO WAVE INCORPORATED의 등록상표입니다. 이 프로그램은 그 상표를 소유하지 않습니다.</li>
          </ul>
        </SettingsCard>

        <SettingsCard title="소개 사이트">
          <p className="text-xs leading-5 text-quiet">
            설치 안내와 프로그램 설명을 웹에서 볼 수 있습니다.
            <br />
            {APP_CONFIG.siteUrl}
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void launchQuickUrl(APP_CONFIG.siteUrl)}
          >
            소개 사이트 열기
          </button>
        </SettingsCard>
      </div>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-surface space-y-3 p-3.5">
      <h2 className="text-sm font-semibold text-desk">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-desk">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
    </label>
  );
}

function ShortcutField({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <label className="block text-sm text-desk">
      글로벌 단축키
      <input
        className="field-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft.trim() && draft !== value) {
            onSave(draft.trim());
          }
        }}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm text-desk">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="field-input"
      />
    </label>
  );
}
