import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { holdPrivacyDrop } from "../services/privacyDropGate";
import { loadPrivacyShot, writePrivacyFile, type PrivacyShot } from "../services/privacyMaskService";
import {
  captionFileName,
  captionPng,
  clipLetters,
  emptyCaption,
  hexColor,
  paintCaption,
  type CaptionBox,
  type CaptionMark,
} from "../services/photoCaptionService";
import type { GrantedFile } from "../services/dropSiteService";
import { pickOpenFiles, pickSaveFile } from "../services/savePick";

interface PhotoCaptionPageProps {
  title: string;
  onBack: () => void;
  startFile?: GrantedFile;
}

export function PhotoCaptionPage({ title, onBack, startFile }: PhotoCaptionPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<PrivacyShot | null>(null);
  const markRef = useRef<CaptionMark>(emptyCaption());
  const boxRef = useRef<CaptionBox | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const openRef = useRef<(file: GrantedFile) => void>(() => {});
  const [shot, setShot] = useState<PrivacyShot | null>(null);
  const [mark, setMark] = useState<CaptionMark>(emptyCaption());
  const [sourceName, setSourceName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  markRef.current = mark;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const current = shotRef.current;
    if (!canvas || !current) {
      boxRef.current = null;
      return;
    }
    const fitted = fitBox(current.width, current.height, 480, 280);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(fitted.width * ratio));
    canvas.height = Math.max(1, Math.round(fitted.height * ratio));
    canvas.style.width = `${fitted.width}px`;
    canvas.style.height = `${fitted.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    boxRef.current = paintCaption(ctx, current.image, canvas.width, canvas.height, markRef.current);
  }, [shot, mark]);

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
      const fresh = emptyCaption();
      markRef.current = fresh;
      setMark(fresh);
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
    const files = await pickOpenFiles("picture");
    const file = files[0];
    if (!file) {
      return;
    }
    await openPicture(file);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const current = shotRef.current;
    if (!canvas || !current) {
      return;
    }
    const point = canvasPoint(event, canvas);
    const box = boxRef.current;
    if (box && point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height) {
      dragRef.current = { dx: point.x - box.left, dy: point.y - box.top };
    } else {
      dragRef.current = { dx: 0, dy: 0 };
      setMark((prev) => ({ ...prev, x: point.x / canvas.width, y: point.y / canvas.height }));
    }
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    if (!canvas || !drag) {
      return;
    }
    const point = canvasPoint(event, canvas);
    const x = (point.x - drag.dx) / canvas.width;
    const y = (point.y - drag.dy) / canvas.height;
    setMark((prev) => ({ ...prev, x, y }));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const savePng = async () => {
    const current = shotRef.current;
    if (!current) {
      setMessage("사진을 먼저 넣으세요.");
      return;
    }
    if (!clipLetters(markRef.current.letters).trim()) {
      setMessage("글을 입력하세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const picked = await pickSaveFile("png", captionFileName(sourceName));
      if (!picked) {
        return;
      }
      const blob = await captionPng(current, markRef.current);
      await writePrivacyFile(current.readId, picked.id, blob);
      setMessage("새 PNG로 저장했습니다. 원본 사진은 그대로입니다.");
    } catch (error) {
      setMessage(asMessage(error, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{title || "사진에 글자"}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          이 PC의 PNG·JPEG에 글을 올립니다. 글자색과 배경색을 고르고, 미리보기에서 위치를 끌어 정합니다. 원본은
          바꾸지 않습니다.
        </p>
        <p className="text-[11px] leading-5 text-quiet">
          글꼴은 이 PC의 Windows 글꼴(Segoe UI, 맑은 고딕)입니다. 글꼴 파일은 설치본에 없습니다. 새 파일에는
          위치·카메라 정보가 들어가지 않습니다.
        </p>
        <p className="text-[11px] leading-5 text-quiet">
          단색 바탕과 단색 글자를 사진에 올리는 구성은 특허 검토가 필요할 수 있습니다. 특허 비침해를 보장하지
          않으며 법적 검토가 아닙니다.
        </p>
        <button type="button" className="btn-primary" onClick={() => void pickPicture()} disabled={busy}>
          사진 선택
        </button>
        {shot ? (
          <div className="max-h-72 overflow-auto rounded-lg border border-line bg-card">
            <canvas
              ref={canvasRef}
              className="block cursor-move touch-none"
              aria-label="사진 미리보기. 끌어서 글자 위치를 정합니다."
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
        <label className="block text-sm text-desk">
          글
          <textarea
            className="field-input mt-1 min-h-16"
            value={mark.letters}
            maxLength={200}
            onChange={(event) => setMark((prev) => ({ ...prev, letters: clipLetters(event.target.value) }))}
            placeholder="사진에 넣을 글"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center justify-between gap-2 text-sm text-desk">
            글자색
            <input
              type="color"
              aria-label="글자색"
              value={mark.ink}
              onChange={(event) => setMark((prev) => ({ ...prev, ink: hexColor(event.target.value, prev.ink) }))}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-sm text-desk">
            배경색
            <input
              type="color"
              aria-label="배경색"
              value={mark.plate}
              disabled={!mark.plateOn}
              onChange={(event) => setMark((prev) => ({ ...prev, plate: hexColor(event.target.value, prev.plate) }))}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-desk">
          <input
            type="checkbox"
            checked={mark.plateOn}
            onChange={(event) => setMark((prev) => ({ ...prev, plateOn: event.target.checked }))}
          />
          글자 배경
        </label>
        <label className="block text-sm text-desk">
          글자 크기 {Math.round(mark.scale * 100)}%
          <input
            className="mt-1 w-full"
            type="range"
            min={2}
            max={12}
            value={Math.round(mark.scale * 100)}
            onChange={(event) => setMark((prev) => ({ ...prev, scale: Number(event.target.value) / 100 }))}
          />
        </label>
        <button type="button" className="btn-primary" onClick={() => void savePng()} disabled={busy || !shot}>
          PNG 저장
        </button>
        {message ? <p className="text-sm text-desk">{message}</p> : null}
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

function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: ((event.clientX - rect.left) / width) * canvas.width,
    y: ((event.clientY - rect.top) / height) * canvas.height,
  };
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
