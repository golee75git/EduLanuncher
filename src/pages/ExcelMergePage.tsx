import { ArrowDown, ArrowLeft, ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { holdExcelDrop } from "../services/excelDropGate";
import {
  EXCEL_MERGE_MAX_FILES,
  glanceExcel,
  headersMissingFrom,
  mergeExcel,
  mergeTitleFromName,
  type ExcelMade,
} from "../services/excelMergeService";
import type { GrantedFile } from "../services/dropSiteService";
import { clearMadeReveals, pickOpenFiles, revealMadeFile } from "../services/savePick";

interface ExcelMergePageProps {
  onBack: () => void;
  startFiles?: GrantedFile[];
}

interface SheetFile {
  id: string;
  name: string;
  dataRows: number;
  columns: number;
  header: string[];
  limited: boolean;
  note: string;
}

function asMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "엑셀 파일을 처리하지 못했습니다.";
}

export function ExcelMergePage({ onBack, startFiles }: ExcelMergePageProps) {
  const addRef = useRef<(files: GrantedFile[]) => void>(() => {});
  const dragIndex = useRef<number | null>(null);
  const [files, setFiles] = useState<SheetFile[]>([]);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [addSource, setAddSource] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [made, setMade] = useState<ExcelMade | null>(null);

  useEffect(() => holdExcelDrop((incoming) => addRef.current(incoming)), []);

  useEffect(() => {
    return () => {
      void clearMadeReveals();
    };
  }, []);

  useEffect(() => {
    if (startFiles && startFiles.length > 0) {
      addRef.current(startFiles);
    }
  }, [startFiles]);

  useEffect(() => {
    if (titleTouched || files.length === 0) {
      return;
    }
    setTitle(mergeTitleFromName(files[0].name));
  }, [files, titleTouched]);

  const addFiles = async (picked: GrantedFile[]) => {
    if (busy || made) {
      return;
    }
    setMessage("");
    const incoming = picked.filter((file) => file.id && !files.some((item) => item.id === file.id));
    const room = incoming.slice(0, Math.max(0, EXCEL_MERGE_MAX_FILES - files.length));
    if (incoming.length > room.length) {
      setMessage(`한 번에 ${EXCEL_MERGE_MAX_FILES}개까지 합칠 수 있습니다.`);
    }
    const loaded: SheetFile[] = [];
    for (const file of room) {
      try {
        const glance = await glanceExcel(file.id);
        loaded.push({
          id: file.id,
          name: file.name || "엑셀",
          dataRows: glance.dataRows,
          columns: glance.columns,
          header: glance.header,
          limited: glance.limited,
          note: glance.columns === 0 ? "내용이 없습니다." : "",
        });
      } catch (error) {
        loaded.push({
          id: file.id,
          name: file.name || "엑셀",
          dataRows: 0,
          columns: 0,
          header: [],
          limited: false,
          note: asMessage(error),
        });
      }
    }
    if (loaded.length > 0) {
      setFiles((current) => [...current, ...loaded]);
    }
  };
  addRef.current = (picked) => {
    void addFiles(picked);
  };

  const pickFiles = async () => {
    try {
      const selected = await pickOpenFiles("excels");
      if (selected.length > 0) {
        await addFiles(selected);
      }
    } catch (error) {
      setMessage(asMessage(error));
    }
  };

  const moveFile = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= files.length) {
      return;
    }
    const next = files.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setFiles(next);
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, fileIndex) => fileIndex !== index));
  };

  const ready = files.filter((file) => !file.note);
  const master = ready[0];
  const totalRows = ready.reduce((sum, file) => sum + file.dataRows, 0);

  const run = async () => {
    if (busy) {
      return;
    }
    if (ready.length < 2) {
      setMessage("엑셀 파일을 두 개 이상 넣어 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await clearMadeReveals();
      setMade(await mergeExcel(ready.map((file) => file.id), title.trim(), addSource));
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    void clearMadeReveals();
    setMade(null);
    setFiles([]);
    setTitle("");
    setTitleTouched(false);
    setMessage("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          className="icon-btn"
          aria-label="뒤로"
          onClick={() => {
            if (made) {
              startOver();
              return;
            }
            onBack();
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">엑셀 통합</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {made ? (
          <>
            <p className="text-sm text-desk">엑셀 통합이 끝났습니다.</p>
            <p className="text-xs leading-5 text-quiet">
              {made.name} · 파일 {made.filesUsed}개 · {made.dataRows.toLocaleString("ko-KR")}줄
            </p>
            {made.limited ? (
              <p className="text-xs leading-5 text-desk">
                줄 수나 열 수가 너무 많아 일부만 담았습니다. 파일을 나눠서 다시 합쳐 주세요.
              </p>
            ) : null}
            {made.skippedFiles.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs leading-5 text-desk">합치지 못한 파일 {made.skippedFiles.length}개</p>
                <ul className="card-surface divide-y divide-line/70">
                  {made.skippedFiles.map((name, index) => (
                    <li key={`${name}-${index}`} className="truncate px-3 py-1.5 text-xs text-quiet">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {made.unmatchedTotal > 0 ? (
              <div className="space-y-1">
                <p className="text-xs leading-5 text-desk">
                  첫 파일에 같은 제목이 없어 담지 못한 열 {made.unmatchedTotal}개
                </p>
                <ul className="card-surface divide-y divide-line/70">
                  {made.unmatched.map((item, index) => (
                    <li key={`${item.file}-${item.column}-${index}`} className="truncate px-3 py-1.5 text-xs text-quiet">
                      {item.file} · {item.column}
                    </li>
                  ))}
                </ul>
                {made.unmatchedTotal > made.unmatched.length ? (
                  <p className="text-[11px] text-quiet">나머지 {made.unmatchedTotal - made.unmatched.length}개는 줄여서 보여 줍니다.</p>
                ) : null}
              </div>
            ) : null}
            <p className="text-[11px] leading-5 text-quiet">원본 파일은 바꾸지 않았습니다. 첫 파일이 있는 폴더에 새 파일로 저장했습니다.</p>
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
            <button type="button" className="btn-primary w-full" onClick={startOver}>
              다른 엑셀 통합
            </button>
          </>
        ) : (
          <>
            <p className="text-xs leading-5 text-quiet">
              같은 양식으로 받은 엑셀(xlsx, 첫 시트)과 UTF-8 csv를 하나로 합칩니다. 첫 파일의 첫 줄을 제목 줄로 보고, 다른 파일은 제목이
              같은 열끼리 모읍니다. xls 파일은 엑셀에서 xlsx로 저장해 주세요.
            </p>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void pickFiles()}>
              엑셀 파일 추가
            </button>
            {files.length > 0 ? (
              <ul className="card-surface divide-y divide-line/70">
                {files.map((file, index) => {
                  const missing = master && file.id !== master.id && !file.note ? headersMissingFrom(master.header, file.header) : [];
                  return (
                    <li
                      key={file.id}
                      className="flex items-center gap-1 px-2 py-1.5"
                      draggable
                      onDragStart={() => {
                        dragIndex.current = index;
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        const from = dragIndex.current;
                        dragIndex.current = null;
                        if (from === null || from === index) {
                          return;
                        }
                        const next = files.slice();
                        const [item] = next.splice(from, 1);
                        next.splice(index, 0, item);
                        setFiles(next);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-desk">
                          {index + 1}. {file.name}
                        </p>
                        <p className="text-[11px] text-quiet">
                          {file.note || `${file.dataRows.toLocaleString("ko-KR")}줄 · ${file.columns}열${file.limited ? " · 일부만 읽음" : ""}`}
                        </p>
                        {missing.length > 0 ? (
                          <p className="text-[11px] leading-4 text-desk">
                            첫 파일에 없는 열: {missing.slice(0, 5).join(", ")}
                            {missing.length > 5 ? ` 외 ${missing.length - 5}개` : ""}
                          </p>
                        ) : null}
                      </div>
                      <button type="button" className="icon-btn" aria-label="위로" onClick={() => moveFile(index, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" className="icon-btn" aria-label="아래로" onClick={() => moveFile(index, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button type="button" className="icon-btn px-2 text-xs" aria-label="목록에서 빼기" onClick={() => removeFile(index)}>
                        빼기
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="card-surface px-3 py-4 text-center text-xs text-quiet">
                엑셀 파일을 여기로 끌어 놓거나 위 버튼으로 골라 주세요.
              </p>
            )}
            {ready.length > 0 ? (
              <p className="text-xs text-quiet">
                합칠 파일 {ready.length}개 · 모두 {totalRows.toLocaleString("ko-KR")}줄
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-desk">
              <input type="checkbox" checked={addSource} onChange={(event) => setAddSource(event.target.checked)} />
              맨 앞 열에 원본 파일 이름 넣기
            </label>
            <label className="block text-xs text-quiet" htmlFor="excel-merge-title">
              새 파일 이름
            </label>
            <input
              id="excel-merge-title"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk"
              value={title}
              maxLength={60}
              onChange={(event) => {
                setTitleTouched(true);
                setTitle(event.target.value);
              }}
            />
            <p className="text-[11px] leading-5 text-quiet">비우면 첫 파일 이름 뒤에 _통합이 붙습니다. 같은 이름이 있으면 번호가 붙습니다.</p>
            {message ? <p className="text-sm text-desk">{message}</p> : null}
            <button type="button" className="btn-primary w-full" disabled={busy || ready.length < 2} onClick={() => void run()}>
              {busy ? "합치는 중입니다." : "하나의 엑셀로 합치기"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
