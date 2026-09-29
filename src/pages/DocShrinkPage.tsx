import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { holdDocDrop } from "../services/docDropGate";
import { sameLocalPath } from "../services/dropSiteService";
import {
  DOC_PRESETS,
  estimateSavedBytes,
  formatByteSize,
  presetById,
  readDocByteSize,
  shrinkOnePicture,
  type DocPresetId,
  type DocSaveMode,
} from "../services/docShrinkService";

interface DocShrinkPageProps {
  onBack: () => void;
}

interface DocRow {
  path: string;
  name: string;
  bytes: number;
  state: "wait" | "work" | "done" | "skip" | "fail";
  note: string;
  outBytes: number;
  outPath: string;
  detail: string;
}

const MAX_ROWS = 100;

export function DocShrinkPage({ onBack }: DocShrinkPageProps) {
  const addRef = useRef<(paths: string[]) => void>(() => {});
  const stopRef = useRef(false);
  const seenRef = useRef<string[]>([]);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [presetId, setPresetId] = useState<DocPresetId>("standard");
  const [saveMode, setSaveMode] = useState<DocSaveMode>("beside");
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [folderPath, setFolderPath] = useState("");

  useEffect(() => holdDocDrop((paths) => addRef.current(paths)), []);

  const addPaths = async (paths: string[]) => {
    if (busy) {
      return;
    }
    const incoming = paths.filter((path) => !seenRef.current.some((item) => sameLocalPath(item, path)));
    if (seenRef.current.length + incoming.length > MAX_ROWS) {
      setMessage(`한 번에 ${MAX_ROWS}장까지 넣을 수 있습니다.`);
    }
    const room = incoming.slice(0, Math.max(0, MAX_ROWS - seenRef.current.length));
    const next: DocRow[] = [];
    for (const path of room) {
      seenRef.current.push(path);
      const name = path.split(/[/\\]/).pop() || path;
      try {
        const bytes = await readDocByteSize(path);
        next.push({ path, name, bytes, state: "wait", note: "", outBytes: 0, outPath: "", detail: "" });
      } catch (error) {
        next.push({
          path,
          name,
          bytes: 0,
          state: "fail",
          note: asMessage(error, "파일을 읽을 수 없습니다."),
          outBytes: 0,
          outPath: "",
          detail: "",
        });
      }
    }
    if (next.length) {
      setRows((current) => [...current, ...next]);
      setMessage("");
      setFolderPath("");
    }
  };
  addRef.current = (paths) => {
    void addPaths(paths);
  };

  const pickFiles = async () => {
    setMessage("");
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "그림", extensions: ["png", "jpg", "jpeg"] }],
      });
      const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
      if (paths.length) {
        await addPaths(paths);
      }
    } catch (error) {
      setMessage(asMessage(error, "그림을 열지 못했습니다."));
    }
  };

  const pickFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setChosen(selected);
        setSaveMode("chosen");
      }
    } catch (error) {
      setMessage(asMessage(error, "폴더를 열지 못했습니다."));
    }
  };

  const run = async () => {
    const preset = presetById(presetId);
    if (saveMode === "chosen" && !chosen) {
      setMessage("저장 폴더를 고르세요.");
      return;
    }
    const pending = rows.filter((row) => row.state === "wait");
    if (pending.length === 0) {
      setMessage("줄일 사진을 먼저 넣으세요.");
      return;
    }
    stopRef.current = false;
    setBusy(true);
    setMessage("");
    setFolderPath("");
    let lastSaved = "";
    let index = 0;
    for (const row of rows) {
      if (row.state !== "wait") {
        continue;
      }
      if (stopRef.current) {
        break;
      }
      index += 1;
      setProgress(`사진을 줄이고 있습니다. ${index} / ${pending.length}`);
      setRows((current) => current.map((item) => (item.path === row.path ? { ...item, state: "work" } : item)));
      try {
        const result = await shrinkOnePicture(row.path, preset, saveMode, chosen);
        if (result.saved) {
          lastSaved = result.outPath;
          setRows((current) =>
            current.map((item) =>
              item.path === row.path
                ? {
                    ...item,
                    state: "done",
                    outBytes: result.outBytes,
                    outPath: result.outPath,
                    detail: `${result.beforeWidth}×${result.beforeHeight} → ${result.afterWidth}×${result.afterHeight}`,
                    note: "",
                  }
                : item,
            ),
          );
        } else {
          setRows((current) =>
            current.map((item) =>
              item.path === row.path ? { ...item, state: "skip", note: result.note, detail: "" } : item,
            ),
          );
        }
      } catch (error) {
        setRows((current) =>
          current.map((item) =>
            item.path === row.path
              ? { ...item, state: "fail", note: asMessage(error, "파일을 읽을 수 없습니다.") }
              : item,
          ),
        );
      }
    }
    setBusy(false);
    setProgress("");
    setFolderPath(lastSaved);
    setMessage(stopRef.current ? "멈췄습니다. 이미 저장된 파일은 그대로입니다." : "");
  };

  const clearRows = () => {
    if (busy) {
      return;
    }
    setRows([]);
    seenRef.current = [];
    setMessage("");
    setFolderPath("");
    setProgress("");
  };

  const preset = presetById(presetId);
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const doneBytes = rows.filter((row) => row.state === "done").reduce((sum, row) => sum + row.outBytes, 0);
  const doneCount = rows.filter((row) => row.state === "done").length;
  const failCount = rows.filter((row) => row.state === "fail").length;
  const finished = !busy && rows.length > 0 && rows.every((row) => row.state !== "wait" && row.state !== "work");
  const guess = estimateSavedBytes(totalBytes, preset);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">사진 용량 줄이기</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          고해상도 사진을 문서에 적합한 크기로 줄입니다. 원본 사진은 변경하지 않습니다. 새 파일에는 위치·카메라
          정보가 들어가지 않습니다. 특허 비침해를 보장하지 않습니다.
        </p>
        {rows.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-card px-4 py-6 text-center">
            <p className="text-sm text-desk">사진을 여기에 끌어 놓으세요</p>
            <p className="text-xs text-quiet">여러 장을 한꺼번에 넣을 수 있습니다. PNG, JPEG</p>
          </div>
        ) : (
          <div className="space-y-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk">
            <p>선택한 사진 {rows.length}장</p>
            <p>원본 전체 용량 {formatByteSize(totalBytes)}</p>
            {finished && doneCount > 0 ? (
              <>
                <p>줄인 뒤 {formatByteSize(doneBytes)}</p>
                <p>{formatByteSize(Math.max(0, totalBytes - doneBytes))} 줄었습니다.</p>
              </>
            ) : (
              <>
                <p>예상 용량 약 {formatByteSize(guess)}</p>
                <p className="text-xs text-quiet">예상값은 처리 전 어림입니다.</p>
              </>
            )}
          </div>
        )}
        <button type="button" className="btn-primary" onClick={() => void pickFiles()} disabled={busy}>
          사진 선택
        </button>
        <div className="grid grid-cols-3 gap-2">
          {DOC_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === presetId ? "btn-primary h-auto px-1 py-2 text-xs" : "btn-secondary h-auto px-1 py-2 text-xs"}
              aria-pressed={item.id === presetId}
              disabled={busy}
              onClick={() => setPresetId(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-xs leading-5 text-quiet">{preset.hint}</p>
        <div className="space-y-1 text-sm text-desk">
          <p>저장 위치</p>
          <label className="flex items-center gap-2">
            <input type="radio" name="doc-save" checked={saveMode === "beside"} disabled={busy} onChange={() => setSaveMode("beside")} />
            원본 사진 폴더
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="doc-save" checked={saveMode === "bundle"} disabled={busy} onChange={() => setSaveMode("bundle")} />
            문서용_사진 폴더
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="doc-save" checked={saveMode === "chosen"} disabled={busy} onChange={() => setSaveMode("chosen")} />
            저장 폴더 선택
          </label>
          {saveMode === "chosen" ? (
            <button type="button" className="btn-secondary" onClick={() => void pickFolder()} disabled={busy}>
              {chosen ? "폴더 다시 고르기" : "폴더 고르기"}
            </button>
          ) : null}
          {saveMode === "beside" ? (
            <p className="text-xs text-quiet">사진마다 그 사진이 있는 폴더에 새 파일을 만듭니다.</p>
          ) : null}
          {saveMode === "bundle" ? (
            <p className="text-xs text-quiet">사진마다 그 폴더 안의 문서용_사진에 모읍니다.</p>
          ) : null}
          {saveMode === "chosen" && chosen ? <p className="truncate text-xs text-quiet">{chosen}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-primary" onClick={() => void run()} disabled={busy || rows.length === 0}>
            {busy ? "줄이는 중..." : `${rows.filter((row) => row.state === "wait").length || rows.length}장 줄이기`}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              stopRef.current = true;
            }}
            disabled={!busy}
          >
            중지
          </button>
        </div>
        {progress ? <p className="text-sm text-desk">{progress}</p> : null}
        {message ? <p className="text-sm leading-6 text-desk">{message}</p> : null}
        {finished && doneCount > 0 ? (
          <p className="text-sm leading-6 text-desk">
            {doneCount}장을 문서용으로 줄였습니다.
            {failCount > 0 ? ` ${failCount}장은 실패했습니다.` : ""}
          </p>
        ) : null}
        {folderPath ? (
          <button type="button" className="btn-secondary" onClick={() => void revealItemInDir(folderPath)}>
            저장 폴더 열기
          </button>
        ) : null}
        {rows.length > 0 ? (
          <button type="button" className="btn-secondary" onClick={clearRows} disabled={busy}>
            다른 사진 줄이기
          </button>
        ) : null}
        {rows.length > 0 ? (
          <ul className="card-surface divide-y divide-line/70">
            {rows.map((row) => (
              <li key={row.path} className="px-3 py-2 text-xs leading-5 text-desk">
                <p className="truncate font-medium">{row.name}</p>
                <p className="text-quiet">
                  {row.state === "done"
                    ? `${formatByteSize(row.bytes)} → ${formatByteSize(row.outBytes)}`
                    : row.bytes > 0
                      ? formatByteSize(row.bytes)
                      : row.note}
                </p>
                {row.detail ? <p className="text-quiet">{row.detail}</p> : null}
                {row.note && row.state !== "fail" ? <p className="text-quiet">{row.note}</p> : null}
                {row.state === "fail" && row.bytes > 0 ? <p className="text-quiet">{row.note}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function asMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
