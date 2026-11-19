import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { holdPrivacyDrop } from "../services/privacyDropGate";
import { loadPrivacyShot, writePrivacyFile, type PrivacyShot } from "../services/privacyMaskService";
import {
  clampLongEdge,
  clampTargetKb,
  cropFromDrag,
  editFileName,
  emptyEdit,
  makeEdited,
  nextTurns,
  paintCropShade,
  paintTurned,
  resultSize,
  turnedSize,
  type EditState,
  type OutFormat,
  type SizeMode,
} from "../services/photoEditService";
import type { GrantedFile } from "../services/dropSiteService";
import { pickOpenFiles, pickSaveFile } from "../services/savePick";

interface PhotoEditPageProps {
  title: string;
  onBack: () => void;
  startFile?: GrantedFile;
}

const PREVIEW_W = 480;
const PREVIEW_H = 280;

export function PhotoEditPage({ title, onBack, startFile }: PhotoEditPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<PrivacyShot | null>(null);
  const openRef = useRef<(file: GrantedFile) => void>(() => {});
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [shot, setShot] = useState<PrivacyShot | null>(null);
  const [edit, setEdit] = useState<EditState>(emptyEdit("jpeg"));
  const [sourceName, setSourceName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  shotRef.current = shot;

  useEffect(() => holdPrivacyDrop((file) => openRef.current(file)), []);

  useEffect(() => {
    if (startFile) {
      openRef.current(startFile);
    }
  }, [startFile]);

  useEffect(() => {
    return () => {
      const current = shotRef.current;
      if (current) {
        URL.revokeObjectURL(current.url);
      }
    };
  }, []);

  const turned = shot ? turnedSize(shot.width, shot.height, edit.turns) : null;
  const fitted = turned ? fitBox(turned.width, turned.height, PREVIEW_W, PREVIEW_H) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shot || !fitted) {
      return;
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(fitted.width * ratio));
    canvas.height = Math.max(1, Math.round(fitted.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintTurned(ctx, shot.image, edit.turns, canvas.width, canvas.height);
    paintCropShade(ctx, canvas.width, canvas.height, edit.crop);
  }, [shot, edit.turns, edit.crop, fitted?.width, fitted?.height]);

  const openPicture = async (file: GrantedFile) => {
    setBusy(true);
    setMessage("");
    try {
      const next = await loadPrivacyShot(file.id);
      const previous = shotRef.current;
      if (previous && previous.url !== next.url) {
        URL.revokeObjectURL(previous.url);
      }
      shotRef.current = next;
      setShot(next);
      setSourceName(file.name);
      setEdit(emptyEdit(next.mime === "image/png" ? "png" : "jpeg"));
    } catch (error) {
      setMessage(asMessage(error, "사진을 열지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  openRef.current = (file) => {
    void openPicture(file);
  };

  const pickPicture = async () => {
    try {
      const files = await pickOpenFiles("picture");
      const file = files[0];
      if (file) {
        await openPicture(file);
      }
    } catch (error) {
      setMessage(asMessage(error, "사진을 열지 못했습니다."));
    }
  };

  const unitPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1))),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1))),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!shot) {
      return;
    }
    dragRef.current = unitPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = dragRef.current;
    if (!start) {
      return;
    }
    const now = unitPoint(event);
    setEdit((prev) => ({ ...prev, crop: cropFromDrag(start.x, start.y, now.x, now.y) }));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const turn = (step: 1 | -1) => {
    // 돌리면 자를 칸의 기준이 달라지므로 자르기는 풀어 둔다.
    setEdit((prev) => ({ ...prev, turns: nextTurns(prev.turns, step), crop: null }));
  };

  const setMode = (sizeMode: SizeMode) => {
    setEdit((prev) => ({ ...prev, sizeMode, format: sizeMode === "kb" ? "jpeg" : prev.format }));
  };

  const setFormat = (format: OutFormat) => {
    setEdit((prev) => ({ ...prev, format, sizeMode: format === "png" && prev.sizeMode === "kb" ? "keep" : prev.sizeMode }));
  };

  const save = async () => {
    const current = shotRef.current;
    if (!current) {
      setMessage("사진을 먼저 넣으세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const picked = await pickSaveFile("picture", editFileName(sourceName, edit.format), edit.format);
      if (!picked) {
        return;
      }
      const result = await makeEdited(current, edit);
      await writePrivacyFile(current.readId, picked.id, result.blob);
      setMessage(
        `새 파일로 저장했습니다. ${result.width}×${result.height}, ${formatKb(result.blob.size)}. 원본 사진은 그대로입니다.${
          result.note ? ` ${result.note}` : ""
        }`,
      );
    } catch (error) {
      setMessage(asMessage(error, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const after = shot ? resultSize(shot, edit) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{title || "사진 다듬기"}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          사진을 돌리고, 필요한 부분만 자르고, 크기나 용량을 맞춥니다. 원본은 바꾸지 않고 새 파일로 저장합니다. 새
          파일에는 위치·카메라 정보가 들어가지 않습니다.
        </p>
        <button type="button" className="btn-primary" onClick={() => void pickPicture()} disabled={busy}>
          사진 선택
        </button>
        {shot && fitted ? (
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            <canvas
              ref={canvasRef}
              className="mx-auto block cursor-crosshair touch-none"
              style={{ width: fitted.width, height: fitted.height }}
              aria-label="사진 미리보기. 끌어서 남길 부분을 고릅니다."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
        ) : (
          <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-card px-4 py-6 text-center">
            <p className="text-sm text-desk">사진을 여기에 끌어 놓으세요</p>
            <p className="text-xs text-quiet">PNG, JPEG</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={() => turn(-1)} disabled={!shot || busy}>
            왼쪽으로 돌리기
          </button>
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={() => turn(1)} disabled={!shot || busy}>
            오른쪽으로 돌리기
          </button>
          <button
            type="button"
            className="btn-secondary h-9 px-1 text-xs"
            onClick={() => setEdit((prev) => ({ ...prev, crop: null }))}
            disabled={!shot || busy || !edit.crop}
          >
            자르기 풀기
          </button>
        </div>
        <p className="text-xs text-quiet">미리보기를 끌어서 남길 부분을 고르세요. 고르지 않으면 전체를 씁니다.</p>
        <div className="space-y-1 text-sm text-desk">
          <p>크기</p>
          <label className="flex items-center gap-2">
            <input type="radio" name="edit-size" checked={edit.sizeMode === "keep"} onChange={() => setMode("keep")} />
            그대로
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="edit-size" checked={edit.sizeMode === "long"} onChange={() => setMode("long")} />
            긴 변을 정해서 줄이기
          </label>
          {edit.sizeMode === "long" ? (
            <label className="flex items-center gap-2 pl-6 text-xs">
              긴 변
              <input
                className="field-input h-8 w-24"
                type="number"
                min={16}
                max={8000}
                value={edit.longEdge}
                onChange={(event) => setEdit((prev) => ({ ...prev, longEdge: clampLongEdge(Number(event.target.value)) }))}
              />
              픽셀 (키우지는 않습니다)
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <input type="radio" name="edit-size" checked={edit.sizeMode === "kb"} onChange={() => setMode("kb")} />
            목표 용량에 맞추기 (JPEG)
          </label>
          {edit.sizeMode === "kb" ? (
            <label className="flex items-center gap-2 pl-6 text-xs">
              최대
              <input
                className="field-input h-8 w-24"
                type="number"
                min={20}
                max={20000}
                value={edit.targetKb}
                onChange={(event) => setEdit((prev) => ({ ...prev, targetKb: clampTargetKb(Number(event.target.value)) }))}
              />
              KB
            </label>
          ) : null}
        </div>
        <div className="space-y-1 text-sm text-desk">
          <p>저장 형식</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={edit.format === "jpeg" ? "btn-primary h-9 text-xs" : "btn-secondary h-9 text-xs"}
              aria-pressed={edit.format === "jpeg"}
              onClick={() => setFormat("jpeg")}
            >
              JPEG (용량 작음)
            </button>
            <button
              type="button"
              className={edit.format === "png" ? "btn-primary h-9 text-xs" : "btn-secondary h-9 text-xs"}
              aria-pressed={edit.format === "png"}
              onClick={() => setFormat("png")}
              disabled={edit.sizeMode === "kb"}
            >
              PNG (원본 화질)
            </button>
          </div>
        </div>
        {shot && after ? (
          <p className="text-xs text-quiet">
            {shot.width}×{shot.height} → {after.width}×{after.height}
            {edit.sizeMode === "kb" ? " (용량에 맞추며 더 줄 수 있음)" : ""}
          </p>
        ) : null}
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy || !shot}>
          {busy ? "처리 중..." : "새 파일로 저장"}
        </button>
        {message ? <p className="text-sm leading-6 text-desk">{message}</p> : null}
      </div>
    </div>
  );
}

function fitBox(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function formatKb(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function asMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}
