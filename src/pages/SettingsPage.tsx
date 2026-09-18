import { open, save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_CONFIG } from "../config/app";
import { applyPackFromPath } from "../services/applyNoticePack";
import { buildLauncherPack, describePackApply } from "../services/launcherPackService";
import { parseNoticePack, readJsonFile, writeJsonFile } from "../services/noticePackService";
import { useNoticeStore } from "../stores/noticeStore";
import { NOTICE_KIND_LABEL } from "../types/notice";
import { useSettingsStore } from "../stores/settingsStore";
import { useToolStore } from "../stores/toolStore";
import type { LauncherPosition } from "../types/settings";

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

        <SettingsCard title="프로그램 정보">
          <p className="text-sm text-desk">
            {APP_CONFIG.appName} {APP_CONFIG.version}
          </p>
          <p className="mt-2 text-xs leading-5 text-quiet">
            {APP_CONFIG.appName}의 개인 설정과 바로가기 정보는 이 PC에 저장됩니다.
          </p>
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
