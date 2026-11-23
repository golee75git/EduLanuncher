import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { holdPdfDrop } from "../services/pdfDropGate";
import { lookPdfSheet, pdfSheetTitleFromName, savePdfSheet, type PdfSheetLook, type PdfSheetMade } from "../services/pdfSheetService";
import type { GrantedFile } from "../services/dropSiteService";
import { clearMadeReveals, pickOpenFiles, revealMadeFile } from "../services/savePick";

interface PdfSheetPageProps {
  onBack: () => void;
  startFiles?: GrantedFile[];
}

function asMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "PDF를 엑셀로 바꾸지 못했습니다.";
}

export function PdfSheetPage({ onBack, startFiles }: PdfSheetPageProps) {
  const [file, setFile] = useState<GrantedFile | null>(null);
  const [look, setLook] = useState<PdfSheetLook | null>(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [made, setMade] = useState<PdfSheetMade | null>(null);

  useEffect(() => {
    return () => {
      void clearMadeReveals();
    };
  }, []);

  const loadFile = async (next: GrantedFile) => {
    if (!next.id || busy) {
      return;
    }
    setMessage("");
    setMade(null);
    setLook(null);
    setFile(next);
    if (!titleTouched) {
      setTitle(pdfSheetTitleFromName(next.name));
    }
    setBusy(true);
    try {
      const glanced = await lookPdfSheet(next.id);
      setLook(glanced);
      if (glanced.columns === 0) {
        setMessage("표로 나눌 글자가 없습니다.");
      }
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => holdPdfDrop((incoming) => {
    const next = incoming.find((item) => item.id);
    if (next) {
      void loadFile(next);
    }
  }), [titleTouched, busy]);

  useEffect(() => {
    const first = startFiles?.find((item) => item.id);
    if (first) {
      void loadFile(first);
    }
    // 처음 넘어온 파일만 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFile = async () => {
    try {
      const selected = await pickOpenFiles("pdf");
      const next = selected.find((item) => item.id);
      if (next) {
        await loadFile(next);
      }
    } catch (error) {
      setMessage(asMessage(error));
    }
  };

  const run = async () => {
    if (!file?.id || busy) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      setMade(await savePdfSheet(file.id, title));
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" aria-label="뒤로" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">엑셀로 저장</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {made ? (
          <>
            <p className="text-sm text-desk">엑셀 저장이 끝났습니다.</p>
            <p className="text-xs leading-5 text-quiet">
              {made.name}
              {made.dataRows > 0 ? ` · 내용 ${made.dataRows.toLocaleString("ko-KR")}줄` : ""}
            </p>
            {made.limited ? <p className="text-xs leading-5 text-desk">줄이나 열이 너무 많아 일부만 담았습니다.</p> : null}
            <p className="text-[11px] leading-5 text-quiet">원본 PDF는 바꾸지 않았습니다. PDF가 있는 폴더에 새 엑셀로 저장했습니다.</p>
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() => {
                void revealMadeFile(made.revealId).catch((error) => setMessage(asMessage(error)));
              }}
            >
              저장 폴더 열기
            </button>
            {message ? <p className="text-sm text-desk">{message}</p> : null}
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => {
                void clearMadeReveals();
                setMade(null);
                setFile(null);
                setLook(null);
                setTitle("");
                setTitleTouched(false);
                setMessage("");
              }}
            >
              다른 PDF
            </button>
          </>
        ) : (
          <>
            <p className="text-xs leading-5 text-quiet">
              글자가 있는 PDF를 줄로 읽어 새 엑셀로 저장합니다. 칸은 탭이나 띄어쓰기가 넓은 자리에서 나눕니다. 원본은 바꾸지 않습니다.
            </p>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void pickFile()}>
              PDF 고르기
            </button>
            {file ? <p className="truncate text-sm text-desk">{file.name || "PDF"}</p> : <p className="card-surface px-3 py-4 text-center text-xs text-quiet">PDF를 여기로 끌어 놓거나 위 버튼으로 골라 주세요.</p>}
            {look && look.preview.length > 0 ? (
              <ul className="card-surface divide-y divide-line/70">
                {look.preview.map((row, index) => (
                  <li key={index} className="truncate px-3 py-1.5 text-xs text-quiet">
                    {index === 0 ? "제목 · " : ""}
                    {row.filter((cell) => cell).join(" · ") || "(빈 줄)"}
                  </li>
                ))}
              </ul>
            ) : null}
            {look?.limited ? <p className="text-[11px] leading-5 text-quiet">앞부분만 보여 줍니다. 저장할 때도 상한을 넘기면 잘립니다.</p> : null}
            <label className="block text-xs text-quiet" htmlFor="pdf-sheet-title">
              새 파일 이름
            </label>
            <input
              id="pdf-sheet-title"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk"
              value={title}
              maxLength={60}
              onChange={(event) => {
                setTitleTouched(true);
                setTitle(event.target.value);
              }}
            />
            <p className="text-[11px] leading-5 text-quiet">비우면 PDF 이름 뒤에 _엑셀이 붙습니다. 같은 이름이 있으면 번호가 붙습니다.</p>
            {message ? <p className="text-sm text-desk">{message}</p> : null}
            <button type="button" className="btn-primary w-full" disabled={busy || !file || !look || look.columns === 0} onClick={() => void run()}>
              {busy ? "읽는 중입니다." : "새 엑셀로 저장"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
