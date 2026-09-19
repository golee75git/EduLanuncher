import { open, save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_CONFIG } from "../config/app";
import { applyPackFromPath } from "../services/applyNoticePack";
import { applyLauncherBackup, buildLauncherBackup, parseLauncherBackup } from "../services/backupService";
import { buildLauncherPack, describePackApply } from "../services/launcherPackService";
import { parseNoticePack, readJsonFile, writeJsonFile } from "../services/noticePackService";
import { useNoticeStore } from "../stores/noticeStore";
import { NOTICE_KIND_LABEL } from "../types/notice";
import { useSettingsStore } from "../stores/settingsStore";
import { useToolStore } from "../stores/toolStore";
import { PANEL_SKIN_OPTIONS, type LauncherPosition, type ListColumns, type PanelSkin } from "../types/settings";

interface SettingsPageProps {
  onBack: () => void;
  onWriteNotices: () => void;
}

export function SettingsPage({ onBack, onWriteNotices }: SettingsPageProps) {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  const applyEducationPack = useToolStore((state) => state.applyEducationPack);
  const tools = useToolStore((state) => state.tools);
  const replaceFromPack = useNoticeStore((state) => state.replaceFromPack);
  const [packMessage, setPackMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
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
          <p className="text-xs leading-5 text-quiet">홈 미리보기는 한 줄입니다. 모두 화면에만 적용됩니다.</p>
        </SettingsCard>

        <SettingsCard title="바로가기 Pack">
          <p className="text-xs leading-5 text-quiet">
            공개 사이트 바로가기와 아이콘을 Pack으로 나눠 줍니다. 사이트에서 그림을 받아오지 않습니다.
            같은 도구 ID면 아이콘만 바뀌고, 없는 바로가기는 추가됩니다.
            브라우저 주소나 .url 바로가기를 패널에 놓아도 넣습니다.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              void applyEducationPack().then((result) => {
                setPackMessage(describePackApply(result.added, result.updated));
              });
            }}
          >
            교육 바로가기 추가
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
                  setPackMessage(await applyPackFromPath(selected));
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

        <SettingsCard title="기관 공지·공통 알림">
          <p className="text-xs leading-5 text-quiet">
            작성 화면에서 구분을 고릅니다. 공지 Pack과 알림 Pack은 따로 저장·가져오기 되며, 한쪽을 가져와도 다른 쪽은 유지됩니다.
            메신저로 받은 .edupack 파일을 누르거나 런처에 놓아도 바로 적용됩니다.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={onWriteNotices}
          >
            공지·알림 작성
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
                  const pack = parseNoticePack(parsed);
                  const count = await replaceFromPack(pack);
                  setNoticeMessage(`${NOTICE_KIND_LABEL[pack.kind]} ${count}건을 갱신했습니다.`);
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

        <SettingsCard title="바탕화면 미니 위젯">
          <p className="text-sm text-quiet">준비 중</p>
          <p className="mt-1 text-xs leading-5 text-quiet">
            향후 오늘 업무 건수와 빠른 실행 버튼을 바탕화면에 표시할 예정입니다.
          </p>
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
            씁니다. QR Code는 DENSO WAVE INCORPORATED의 등록상표입니다. 외부 구성 요소 고지는 저장소
            THIRD_PARTY_NOTICES.md에 있습니다. 특허 비침해를 보장하지 않습니다.
          </p>
        </SettingsCard>

        <SettingsCard title="사용 방법">
          <p className="text-xs leading-5 text-quiet">
            설치 파일 {APP_CONFIG.setupFile} · 날짜 복사본 {APP_CONFIG.setupFileDated} · {APP_CONFIG.version}
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-5 text-quiet">
            <li>트레이 또는 Ctrl+Alt+E로 패널을 엽니다.</li>
            <li>설정의 보기에서 서류·밝은 화면·어두운 화면 스킨과 모두 목록 1열·2열을 고릅니다.</li>
            <li>카드의 별을 끄면 홈에서만 빠집니다. 목록에서 빼려면 빼기 확인을 거칩니다.</li>
            <li>카드 오른쪽 클릭 또는 점 세 개로 메뉴를 엽니다.</li>
            <li>사이트 칸의 인터넷 즐겨찾기는 이 PC Edge·Chrome 북마크와 Windows .url만 읽습니다.</li>
            <li>업무도구 칸의 컴퓨터도구는 이 PC Windows 설정 화면을 열거나, 사설·공인 IP와 익스플로러 설정 복원 확인 화면을 엽니다.</li>
            <li>네트워크·CCTV 검색 중에는 예상 시간이 나오고 중지로 멈출 수 있습니다.</li>
            <li>주소·파일·Pack을 패널에 끌어 넣을 수 있습니다.</li>
            <li>QR Code는 DENSO WAVE INCORPORATED의 등록상표입니다.</li>
          </ul>
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
