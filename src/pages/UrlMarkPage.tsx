import { open, save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";
import {
  buildUrlMark,
  canvasPngBase64,
  drawUrlMark,
  pictureSrc,
  readPictureFile,
  writePngFile,
  type PictureFile,
} from "../services/urlMarkService";

interface UrlMarkPageProps {
  title: string;
  onBack: () => void;
}

export function UrlMarkPage({ title, onBack }: UrlMarkPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState("");
  const [picture, setPicture] = useState<PictureFile | null>(null);
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasMark, setHasMark] = useState(false);

  const pickPicture = async () => {
    setMessage("");
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "그림", extensions: ["png", "jpg", "jpeg"] }],
      });
      if (typeof selected !== "string") {
        return;
      }
      const file = await readPictureFile(selected);
      setPicture(file);
      setHasMark(false);
      setPreview(pictureSrc(file));
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
    } catch (error) {
      setPicture(null);
      setPreview("");
      setMessage(asMessage(error, "그림을 읽지 못했습니다."));
    }
  };

  const showMark = async () => {
    const canvas = canvasRef.current;
    if (!picture || !canvas) {
      setMessage("그림을 먼저 고르세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const grid = await buildUrlMark(url);
      const image = await loadImage(pictureSrc(picture));
      drawUrlMark(canvas, image, grid);
      setHasMark(true);
      setPreview(canvas.toDataURL("image/png"));
    } catch (error) {
      setMessage(asMessage(error, "QR코드를 넣지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const savePng = async () => {
    const canvas = canvasRef.current;
    if (!hasMark || !canvas || canvas.width < 16) {
      setMessage("먼저 QR코드를 넣으세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const selected = await save({
        defaultPath: "QR코드넣기.png",
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (typeof selected !== "string") {
        return;
      }
      const path = selected.toLowerCase().endsWith(".png") ? selected : `${selected}.png`;
      await writePngFile(path, canvasPngBase64(canvas));
      setMessage("이 PC에 PNG로 저장했습니다. 원본 그림은 그대로입니다.");
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
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{title || "QR코드 넣기"}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          이 PC 그림 오른쪽 아래에 주소 QR코드를 넣습니다. http 또는 https만 됩니다. 위치와 색은 바꾸지
          않습니다.
        </p>
        <p className="text-[11px] leading-5 text-quiet">
          QR Code는 DENSO WAVE INCORPORATED의 등록상표입니다. 이 프로그램은 그 상표를 소유하지 않습니다.
          구성 요소 라이선스는 THIRD_PARTY_NOTICES.md에 있습니다. 특허 비침해를 보장하지 않습니다.
        </p>
        <button type="button" className="btn-primary" onClick={() => void pickPicture()} disabled={busy}>
          그림 고르기
        </button>
        <label className="block text-sm text-desk">
          주소
          <input
            className="field-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
            spellCheck={false}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => void showMark()} disabled={busy}>
            {busy ? "만드는 중..." : "QR코드 넣기"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void savePng()} disabled={busy}>
            PNG 저장
          </button>
        </div>
        {message ? <p className="text-sm text-desk">{message}</p> : null}
        {preview ? (
          <img src={preview} alt="QR코드 넣기 미리보기" className="w-full rounded-lg border border-line bg-card" />
        ) : null}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("그림을 열지 못했습니다."));
    image.src = src;
  });
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
