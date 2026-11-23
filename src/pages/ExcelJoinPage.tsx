import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { holdJoinDrop } from "../services/excelDropGate";
import { EXCEL_MERGE_MAX_FILES, headerKey } from "../services/excelMergeService";
import {
  glanceSheet,
  joinTitleFromName,
  lookExcelJoin,
  preferredKey,
  saveExcelJoin,
  uniqueHeaders,
  type JoinLook,
  type JoinMade,
} from "../services/excelJoinService";
import type { GrantedFile } from "../services/dropSiteService";
import { clearMadeReveals, pickOpenFiles, revealMadeFile } from "../services/savePick";

interface ExcelJoinPageProps {
  onBack: () => void;
  startFiles?: GrantedFile[];
}

interface SheetFile {
  id: string;
  name: string;
  header: string[];
  note: string;
}

interface PairRow {
  id: string;
  fileId: string;
  source: string;
  target: string;
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

function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

function spreadsheetFirst(files: SheetFile[]): SheetFile[] {
  const sheets: SheetFile[] = [];
  const pdfs: SheetFile[] = [];
  for (const file of files) {
    if (isPdfName(file.name)) {
      pdfs.push(file);
    } else {
      sheets.push(file);
    }
  }
  return [...sheets, ...pdfs];
}

export function ExcelJoinPage({ onBack, startFiles }: ExcelJoinPageProps) {
  const addRef = useRef<(files: GrantedFile[]) => void>(() => {});
  const pairSeq = useRef(1);
  const [files, setFiles] = useState<SheetFile[]>([]);
  const [keyName, setKeyName] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [look, setLook] = useState<JoinLook | null>(null);
  const [made, setMade] = useState<JoinMade | null>(null);

  useEffect(() => holdJoinDrop((incoming) => addRef.current(incoming)), []);

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

  const ready = files.filter((file) => !file.note);
  const baseFile = ready.find((file) => !isPdfName(file.name));
  const readyMark = ready.map((file) => `${file.id}:${file.header.join("\t")}`).join("|");
  const baseName = baseFile?.name ?? "";

  useEffect(() => {
    const current = files.filter((file) => !file.note);
    setPairs((prev) => {
      const next: PairRow[] = [];
      for (const file of current.slice(1)) {
        const kept = prev.filter((pair) => pair.fileId === file.id);
        next.push(...(kept.length > 0 ? kept : [{ id: `${file.id}:0`, fileId: file.id, source: "", target: "" }]));
      }
      return next;
    });
    if (!keyTouched) {
      setKeyName(preferredKey(current.map((file) => file.header)));
    }
    setLook(null);
  }, [readyMark, keyTouched, files]);

  useEffect(() => {
    if (titleTouched || !baseName) {
      return;
    }
    setTitle(joinTitleFromName(baseName));
  }, [baseName, titleTouched]);

  const addFiles = async (picked: GrantedFile[]) => {
    if (busy || made) {
      return;
    }
    setMessage("");
    const incoming = picked.filter((file) => file.id && !files.some((item) => item.id === file.id));
    const room = incoming.slice(0, Math.max(0, EXCEL_MERGE_MAX_FILES - files.length));
    if (incoming.length > room.length) {
      setMessage(`한 번에 ${EXCEL_MERGE_MAX_FILES}개까지 넣을 수 있습니다.`);
    }
    const loaded: SheetFile[] = [];
    for (const file of room) {
      try {
        const glance = await glanceSheet(file.id);
        loaded.push({
          id: file.id,
          name: file.name || "엑셀",
          header: glance.header,
          note: glance.columns === 0 ? "내용이 없습니다." : "",
        });
      } catch (error) {
        loaded.push({
          id: file.id,
          name: file.name || "엑셀",
          header: [],
          note: asMessage(error),
        });
      }
    }
    if (loaded.length > 0) {
      setFiles((current) => spreadsheetFirst([...current, ...loaded]));
    }
  };
  addRef.current = (picked) => {
    void addFiles(picked);
  };

  const pickFiles = async () => {
    try {
      const selected = await pickOpenFiles("sheets");
      if (selected.length > 0) {
        await addFiles(selected);
      }
    } catch (error) {
      setMessage(asMessage(error));
    }
  };

  const base = baseFile;
  const baseHeaders = uniqueHeaders(base?.header ?? []);
  const listedKey = keyName && !baseHeaders.some((name) => headerKey(name) === headerKey(keyName)) ? [keyName] : [];

  const chosenPairs = pairs
    .map((pair) => ({
      fileIndex: ready.findIndex((file) => file.id === pair.fileId),
      source: pair.source,
      target: pair.target,
    }))
    .filter((pair) => pair.fileIndex > 0 && pair.source && pair.target);

  const showValues = async () => {
    if (busy) {
      return;
    }
    if (ready.length < 2) {
      setMessage("엑셀 파일을 두 개 이상 넣어 주세요.");
      return;
    }
    if (!keyName.trim() || chosenPairs.length === 0) {
      setMessage("맞출 열, 가져올 열, 넣을 열을 골라 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    setLook(null);
    try {
      setLook(await lookExcelJoin(ready.map((file) => file.id), keyName.trim(), chosenPairs));
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (busy || !look || look.fillCount === 0) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await clearMadeReveals();
      setMade(await saveExcelJoin(ready.map((file) => file.id), title.trim(), keyName.trim(), chosenPairs));
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
    setPairs([]);
    setKeyName("");
    setKeyTouched(false);
    setTitle("");
    setTitleTouched(false);
    setLook(null);
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
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">값 채우기</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {made ? (
          <>
            <p className="text-sm text-desk">값 채우기가 끝났습니다.</p>
            <p className="text-xs leading-5 text-quiet">
              {made.name} · 넣은 칸 {made.fillCount.toLocaleString("ko-KR")}개 · 그대로 둔 칸{" "}
              {made.keepCount.toLocaleString("ko-KR")}개
            </p>
            {made.limited ? <p className="text-xs leading-5 text-desk">줄이나 열이 너무 많아 일부만 담았습니다.</p> : null}
            {made.notes.map((note) => (
              <p key={note} className="text-xs leading-5 text-quiet">
                {note}
              </p>
            ))}
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
              다른 값 채우기
            </button>
          </>
        ) : (
          <>
            <p className="text-xs leading-5 text-quiet">
              첫 파일은 xlsx 또는 csv입니다. 같은 키의 빈 칸에 다른 파일 열 값을 넣습니다. PDF는 글자 위치로 칸을 나눈 표만 추가로 읽습니다. 맞출 열을
              확인한 뒤 적용할 값을 먼저 보여 줍니다. 이미 있는 값은 바꾸지 않고, 원본도 바꾸지 않습니다.
            </p>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void pickFiles()}>
              파일 추가
            </button>
            {files.length > 0 ? (
              <ul className="card-surface divide-y divide-line/70">
                {files.map((file, index) => (
                  <li key={file.id} className="px-3 py-1.5">
                    <p className="truncate text-sm text-desk">
                      {index + 1}. {file.name}
                      {file.id === base?.id ? " · 기준" : ""}
                    </p>
                    <p className="text-[11px] text-quiet">{file.note || `${file.header.length}열`}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card-surface px-3 py-4 text-center text-xs text-quiet">xlsx, csv, PDF를 여기로 끌어 놓거나 위 버튼으로 골라 주세요.</p>
            )}
            {files.length > 0 && !base ? <p className="text-xs text-desk">기준 파일은 xlsx 또는 csv입니다.</p> : null}
            {base ? (
              <>
                <label className="block text-xs text-quiet" htmlFor="excel-join-key">
                  맞출 열
                </label>
                <select
                  id="excel-join-key"
                  className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk"
                  value={keyName}
                  onChange={(event) => {
                    setKeyTouched(true);
                    setKeyName(event.target.value);
                    setLook(null);
                  }}
                >
                  <option value="">열을 고르세요</option>
                  {listedKey.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  {baseHeaders.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {ready.filter((file) => file.id !== base?.id).map((file) => {
                  const hasKey = uniqueHeaders(file.header).some((name) => headerKey(name) === headerKey(keyName));
                  const filePairs = pairs.filter((pair) => pair.fileId === file.id);
                  const sources = uniqueHeaders(file.header).filter((name) => headerKey(name) !== headerKey(keyName));
                  const targets = baseHeaders.filter((name) => headerKey(name) !== headerKey(keyName));
                  return (
                    <div key={file.id} className="space-y-2">
                      <p className="truncate text-xs text-desk">{file.name}</p>
                      {keyName && !hasKey ? <p className="text-[11px] text-desk">이 파일에는 맞출 열이 없습니다.</p> : null}
                      {filePairs.map((pair) => (
                        <div key={pair.id} className="grid grid-cols-2 gap-2">
                          <label className="block text-[11px] text-quiet">
                            가져올 열
                            <select
                              className="mt-1 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-desk"
                              value={pair.source}
                              onChange={(event) => {
                                const source = event.target.value;
                                setPairs((current) => current.map((item) => (item.id === pair.id ? { ...item, source } : item)));
                                setLook(null);
                              }}
                            >
                              <option value="">고르기</option>
                              {sources.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-[11px] text-quiet">
                            넣을 열
                            <select
                              className="mt-1 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-desk"
                              value={pair.target}
                              onChange={(event) => {
                                const target = event.target.value;
                                setPairs((current) => current.map((item) => (item.id === pair.id ? { ...item, target } : item)));
                                setLook(null);
                              }}
                            >
                              <option value="">고르기</option>
                              {targets.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                              {sources
                                .filter((name) => !targets.some((target) => headerKey(target) === headerKey(name)))
                                .map((name) => (
                                  <option key={`new-${name}`} value={name}>
                                    새 열 {name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                      ))}
                      {filePairs.length < 6 ? (
                        <button
                          type="button"
                          className="text-[11px] text-quiet"
                          onClick={() => {
                            pairSeq.current += 1;
                            setPairs((current) => [
                              ...current,
                              { id: `${file.id}:${pairSeq.current}`, fileId: file.id, source: "", target: "" },
                            ]);
                            setLook(null);
                          }}
                        >
                          열 하나 더
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </>
            ) : null}
            <button type="button" className="btn-secondary w-full" disabled={busy || chosenPairs.length === 0} onClick={() => void showValues()}>
              {busy && !look ? "값을 보는 중입니다." : "적용할 값 보기"}
            </button>
            {look ? (
              <div className="space-y-1">
                <p className="text-xs text-desk">
                  넣을 값 {look.fillCount.toLocaleString("ko-KR")}개 · 이미 있어 그대로 둔 값 {look.keepCount.toLocaleString("ko-KR")}개
                </p>
                {look.shown.length > 0 ? (
                  <ul className="card-surface divide-y divide-line/70">
                    {look.shown.map((line, index) => (
                      <li key={`${line.key}-${line.column}-${index}`} className="px-3 py-1.5 text-xs text-quiet">
                        {line.key} · {line.column} · {line.value} · {line.kind}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-quiet">보여 줄 값이 없습니다.</p>
                )}
                {look.fillCount + look.keepCount > look.shown.length ? (
                  <p className="text-[11px] text-quiet">나머지는 줄여서 보여 줍니다.</p>
                ) : null}
                {look.notes.map((note) => (
                  <p key={note} className="text-[11px] leading-5 text-quiet">
                    {note}
                  </p>
                ))}
              </div>
            ) : null}
            <label className="block text-xs text-quiet" htmlFor="excel-join-title">
              새 파일 이름
            </label>
            <input
              id="excel-join-title"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk"
              value={title}
              maxLength={60}
              onChange={(event) => {
                setTitleTouched(true);
                setTitle(event.target.value);
              }}
            />
            <p className="text-[11px] leading-5 text-quiet">비우면 첫 파일 이름 뒤에 _병합이 붙습니다. 같은 이름이 있으면 번호가 붙습니다.</p>
            {message ? <p className="text-sm text-desk">{message}</p> : null}
            <button type="button" className="btn-primary w-full" disabled={busy || !look || look.fillCount === 0} onClick={() => void run()}>
              {busy && look ? "저장하는 중입니다." : "새 엑셀로 저장"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
