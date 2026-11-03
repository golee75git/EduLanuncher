import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type { GrantedFile } from "../services/dropSiteService";
import { clearMadeReveals, revealMadeFile } from "../services/savePick";
import { photoTitleFromName, photosToPdf, type PdfMade } from "../services/pdfToolService";

interface PhotoPdfPageProps {
  onBack: () => void;
  startFiles?: GrantedFile[];
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : "PDF로 저장하지 못했습니다.";
}

export function PhotoPdfPage({ onBack, startFiles }: PhotoPdfPageProps) {
  const files = (startFiles ?? []).filter((file) => file.id);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [made, setMade] = useState<PdfMade | null>(null);

  useEffect(() => {
    return () => {
      void clearMadeReveals();
    };
  }, []);

  useEffect(() => {
    if (titleTouched || files.length === 0) {
      return;
    }
    setTitle(photoTitleFromName(files[0].name));
  }, [files, titleTouched]);

  const save = async () => {
    if (busy) {
      return;
    }
    if (files.length < 1) {
      setMessage("사진을 넣어 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await photosToPdf(
        files.map((file) => file.id),
        title.trim(),
      );
      setMade(result);
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-1 border-b border-line px-2 py-2">
        <button type="button" className="icon-btn" aria-label="뒤로" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">사진 PDF</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {made ? (
          <>
            <p className="text-sm text-desk">PDF로 저장했습니다.</p>
            <p className="text-xs leading-5 text-quiet">
              {made.files.map((file) => file.name).join(", ")} · {made.pages}페이지
            </p>
            <p className="text-[11px] leading-5 text-quiet">원본 사진은 바꾸지 않습니다. 특허 비침해를 보장하지 않습니다.</p>
            {made.files[0] ? (
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => {
                  void revealMadeFile(made.files[0].revealId).catch((error) => setMessage(asMessage(error)));
                }}
              >
                저장 폴더 열기
              </button>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-xs leading-5 text-quiet">
              사진 한 장에 한 페이지로 저장합니다. 제목은 파일 이름이며, 페이지 안에는 글자를 넣지 않습니다.
            </p>
            <ul className="card-surface divide-y divide-line/70">
              {files.map((file, index) => (
                <li key={file.id} className="truncate px-3 py-2 text-sm text-desk">
                  {index + 1}. {file.name}
                </li>
              ))}
            </ul>
            <label className="block text-xs text-quiet" htmlFor="photo-pdf-title">
              제목
            </label>
            <input
              id="photo-pdf-title"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk"
              value={title}
              maxLength={60}
              onChange={(event) => {
                setTitleTouched(true);
                setTitle(event.target.value);
              }}
            />
            <p className="text-xs text-quiet">비우면 첫 사진 이름 뒤에 _사진문서가 붙습니다.</p>
            {message ? <p className="text-xs leading-5 text-desk">{message}</p> : null}
            <button type="button" className="btn-primary w-full" disabled={busy || files.length === 0} onClick={() => void save()}>
              PDF로 저장
            </button>
          </>
        )}
      </div>
    </section>
  );
}
