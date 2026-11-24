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
  grid: string[][];
  keyAt: number | null;
  dataFrom: number | null;
  dataTo: number | null;
  valueAt: number | null;
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

function bandLabel(file: SheetFile): string {
  const parts: string[] = [];
  if (file.keyAt != null) {
    parts.push(`맞출 칸 ${file.keyAt + 1}`);
  }
  if (file.dataFrom != null) {
    parts.push(`${file.dataFrom + 1}째 줄부터`);
  }
  if (file.dataTo != null) {
    parts.push(`${file.dataTo + 1}째 줄까지`);
  }
  if (file.valueAt != null) {
    parts.push(`값 칸 ${file.valueAt + 1}`);
  }
  return parts.join(" · ");
}

/** 사용자가 고른 데이터 줄 바로 위 줄을 제목으로 본다. 고르지 않았으면 첫 줄이다. */
function headerRow(file: SheetFile): string[] {
  if (file.dataFrom != null && file.dataFrom > 0) {
    const row = file.grid[file.dataFrom - 1];
    if (row) {
      return row;
    }
  }
  return file.header;
}

/** 목록에서 열을 알아보도록 제목 아래 첫 값을 덧붙여 보여 준다. */
function columnLabel(file: SheetFile, name: string): string {
  const at = headerRow(file).findIndex((item) => headerKey(item) === headerKey(name));
  const sample = at >= 0 ? (file.grid[file.dataFrom ?? 1]?.[at] ?? "").trim() : "";
  return sample ? `${name} · ${sample.length > 12 ? `${sample.slice(0, 12)}…` : sample}` : name;
}

/** 첫 줄에 글자가 한 칸뿐이면 제목 줄일 가능성이 크다. */
function looksLikeTitleRow(file: SheetFile): boolean {
  return file.dataFrom == null && file.header.filter((cell) => cell.trim()).length === 1 && file.grid.length > 1;
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
  const [pickMode, setPickMode] = useState<"key" | "value">("key");

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
  const readyMark = ready.map((file) => `${file.id}:${headerRow(file).join("\t")}`).join("|");
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
      setKeyName(preferredKey(current.map((file) => headerRow(file))));
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
          note: glance.columns === 0 && glance.grid.length === 0 ? "내용이 없습니다." : "",
          grid: glance.grid ?? [],
          keyAt: null,
          dataFrom: null,
          dataTo: null,
          valueAt: null,
        });
      } catch (error) {
        loaded.push({
          id: file.id,
          name: file.name || "엑셀",
          header: [],
          note: asMessage(error),
          grid: [],
          keyAt: null,
          dataFrom: null,
          dataTo: null,
          valueAt: null,
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
  const baseHeaders = uniqueHeaders(base ? headerRow(base) : []);
  const listedKey = keyName && !baseHeaders.some((name) => headerKey(name) === headerKey(keyName)) ? [keyName] : [];

  const anchor = {
    keyAt: baseFile?.keyAt ?? null,
    dataFrom: baseFile?.dataFrom ?? null,
    dataTo: baseFile?.dataTo ?? null,
  };
  const chosenPairs = pairs
    .map((pair) => {
      const file = ready.find((item) => item.id === pair.fileId);
      return {
        fileIndex: ready.findIndex((item) => item.id === pair.fileId),
        source: pair.source,
        target: pair.target,
        keyAt: file?.keyAt ?? null,
        sourceAt: file?.valueAt ?? null,
        targetAt: baseFile?.valueAt ?? null,
        dataFrom: file?.dataFrom ?? null,
        dataTo: file?.dataTo ?? null,
      };
    })
    .filter((pair) => pair.fileIndex > 0 && (pair.source || pair.sourceAt != null) && (pair.target || pair.targetAt != null));

  const markCell = (fileId: string, row: number, column: number) => {
    setFiles((current) =>
      current.map((item) => {
        if (item.id !== fileId) {
          return item;
        }
        if (pickMode === "value") {
          return { ...item, valueAt: column };
        }
        return { ...item, keyAt: column, dataFrom: row };
      }),
    );
    if (pickMode === "key") {
      // 제목 줄이 바뀌면 이전에 고른 열 이름은 더 이상 목록에 없을 수 있어 비운다.
      const isBase = baseFile?.id === fileId;
      setPairs((current) =>
        current.map((pair) => {
          if (isBase) {
            return { ...pair, target: "" };
          }
          return pair.fileId === fileId ? { ...pair, source: "" } : pair;
        }),
      );
    }
    if (pickMode === "key" && baseFile?.id === fileId) {
      const above = files.find((item) => item.id === fileId)?.grid[row - 1]?.[column]?.trim() ?? "";
      if (above) {
        setKeyTouched(true);
        setKeyName(above);
      }
    }
    setLook(null);
  };

  const setEndRow = (fileId: string, raw: string) => {
    const trimmed = raw.trim();
    const parsed = Number(trimmed);
    const dataTo = trimmed && Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : null;
    setFiles((current) => current.map((item) => (item.id === fileId ? { ...item, dataTo } : item)));
    setLook(null);
  };

  const showValues = async () => {
    if (busy) {
      return;
    }
    if (ready.length < 2) {
      setMessage("엑셀 파일을 두 개 이상 넣어 주세요.");
      return;
    }
    if ((!keyName.trim() && anchor.keyAt == null) || chosenPairs.length === 0) {
      setMessage("맞출 칸, 가져올 칸, 넣을 칸을 골라 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    setLook(null);
    try {
      setLook(await lookExcelJoin(ready.map((file) => file.id), keyName.trim(), chosenPairs, anchor));
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
      setMade(await saveExcelJoin(ready.map((file) => file.id), title.trim(), keyName.trim(), chosenPairs, anchor));
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
              첫 파일은 xlsx 또는 csv입니다. 같은 키의 빈 칸에 다른 파일 열 값을 넣습니다. xlsx·csv·PDF는 앞부분 칸을 보여 줍니다. 맞출 칸을 누르면 그 줄부터
              데이터로 쓰고, 값 칸은 기준 파일에서는 넣을 칸, 다른 파일에서는 가져올 칸입니다. 칸을 누르지 않으면 첫 줄을 제목으로 봅니다. 적용할 값을
              먼저 보여 줍니다. 이미 있는 값은 바꾸지 않고, 원본도 바꾸지 않습니다.
              학교 이름은 OO초=OO초등학교, OO중=OO중학교, OO고=OO고등학교, OO유=OO유치원을 같게 봅니다.
            </p>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void pickFiles()}>
              파일 추가
            </button>
            {files.length > 0 ? (
              <div className="flex gap-2">
                <button type="button" className={pickMode === "key" ? "btn-primary" : "btn-secondary"} onClick={() => setPickMode("key")}>
                  맞출 칸
                </button>
                <button type="button" className={pickMode === "value" ? "btn-primary" : "btn-secondary"} onClick={() => setPickMode("value")}>
                  값 칸
                </button>
              </div>
            ) : null}
            {files.length > 0 ? (
              <ul className="card-surface divide-y divide-line/70">
                {files.map((file, index) => {
                  const marked = bandLabel(file);
                  return (
                    <li key={file.id} className="space-y-1 px-3 py-1.5">
                      <p className="truncate text-sm text-desk">
                        {index + 1}. {file.name}
                        {file.id === base?.id ? " · 기준" : ""}
                      </p>
                      <p className="text-[11px] text-quiet">{file.note || marked || `${file.header.length}열`}</p>
                      {looksLikeTitleRow(file) ? (
                        <p className="text-[11px] text-desk">첫 줄이 제목 한 칸뿐입니다. 맞출 칸을 눌러 값이 시작하는 줄을 알려 주세요.</p>
                      ) : null}
                      {file.grid.length > 0 ? (
                        <div className="max-w-full overflow-x-auto">
                          <table className="border-collapse">
                            <tbody>
                              {file.grid.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                  {row.map((cell, columnIndex) => {
                                    const inBand =
                                      file.keyAt === columnIndex &&
                                      file.dataFrom != null &&
                                      rowIndex >= file.dataFrom &&
                                      (file.dataTo == null || rowIndex <= file.dataTo);
                                    const valueHere = file.valueAt === columnIndex;
                                    return (
                                      <td key={columnIndex} className="p-0">
                                        <button
                                          type="button"
                                          className={`max-w-24 truncate border px-1 py-0.5 text-left text-[10px] text-desk ${inBand || valueHere ? "border-desk bg-card font-semibold" : "border-line"}`}
                                          onClick={() => markCell(file.id, rowIndex, columnIndex)}
                                        >
                                          {cell || "·"}
                                        </button>
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      <label className="block text-[11px] text-quiet">
                        끝 줄
                        <input
                          className="ml-2 w-16 rounded border border-line bg-card px-1 py-0.5 text-xs text-desk"
                          inputMode="numeric"
                          value={file.dataTo == null ? "" : String(file.dataTo + 1)}
                          onChange={(event) => setEndRow(file.id, event.target.value)}
                        />
                      </label>
                    </li>
                  );
                })}
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
                  const fileHeaders = uniqueHeaders(headerRow(file));
                  const hasKey = file.keyAt != null || fileHeaders.some((name) => headerKey(name) === headerKey(keyName));
                  const filePairs = pairs.filter((pair) => pair.fileId === file.id);
                  const sources = fileHeaders.filter((name) => headerKey(name) !== headerKey(keyName));
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
                                  {columnLabel(file, name)}
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
                                  {base ? columnLabel(base, name) : name}
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
