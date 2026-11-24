import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { holdJoinDrop } from "../services/excelDropGate";
import { EXCEL_MERGE_MAX_FILES, headerKey } from "../services/excelMergeService";
import {
  glanceSheet,
  joinTitleFromName,
  KEY_CANDIDATES,
  lookExcelJoin,
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
  /** 통합 문서의 보이는 시트 이름. 시트가 하나뿐이거나 xlsx가 아니면 비어 있다. */
  sheets: string[];
  /** 읽을 시트 이름. 비우면 첫 시트다. */
  sheet: string;
  keyAt: number | null;
  dataFrom: number | null;
  dataTo: number | null;
  valueAt: number | null;
}

interface PairRow {
  id: string;
  fileId: string;
  source: string;
  /** 가져올 열의 번호(0부터). 제목이 없거나 겹쳐도 열 자체를 고를 수 있다. */
  sourceCol: number | null;
  target: string;
  /** 이 열에서 가져올 첫 줄·끝 줄(1부터). 비우면 파일에서 고른 범위를 쓴다. */
  from: string;
  to: string;
}

/** 화면에 적은 줄 번호(1부터)를 0부터 센 줄 번호로 바꾼다. 비었거나 숫자가 아니면 null이다. */
function rowNumber(raw: string): number | null {
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  return trimmed && Number.isInteger(parsed) && parsed > 0 ? parsed - 1 : null;
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

interface HeaderCell {
  name: string;
  col: number;
  row: number;
}

interface HeaderModel {
  cells: HeaderCell[];
  /** 값이 시작하는 줄(0부터). */
  dataStart: number;
  /** 열마다 가장 아래쪽 제목 글자. */
  titleAt: (col: number) => string;
}

const INTEGER_CELL = /^\d{1,4}$/;
const DATE_CELL = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/;
const HEADER_SCAN_ROWS = 8;

function filledCount(row: string[]): number {
  return row.filter((cell) => cell.trim()).length;
}

/**
 * 제목 줄을 찾는다. 값이 시작하는 줄을 사용자가 골랐으면 그 위쪽이 제목이고,
 * 아니면 번호나 날짜 같은 숫자가 처음 나오는 줄 위쪽이 제목이다.
 * 맨 위에 글자 한 칸짜리 표제가 있으면 그 줄은 제목으로 치지 않는다.
 */
function headerModel(file: SheetFile): HeaderModel {
  const rows = file.grid;
  let end = file.dataFrom;
  if (end == null) {
    end = 1;
    for (let row = 1; row < Math.min(rows.length, HEADER_SCAN_ROWS); row += 1) {
      const cells = rows[row];
      if (filledCount(cells) >= 2 && cells.some((cell) => INTEGER_CELL.test(cell.trim()) || DATE_CELL.test(cell.trim()))) {
        end = row;
        break;
      }
    }
    if (end === 1 && rows[0] && filledCount(rows[0]) <= 1) {
      const next = rows.findIndex((row, at) => at >= 1 && filledCount(row) >= 2);
      if (next >= 1 && next < HEADER_SCAN_ROWS) {
        end = next + 1;
      }
    }
  }
  const used: number[] = [];
  for (let row = 0; row < end && row < rows.length; row += 1) {
    if (filledCount(rows[row]) >= 2) {
      used.push(row);
    }
  }
  if (used.length === 0 && end >= 1 && rows[end - 1]) {
    used.push(end - 1);
  }
  const cells: HeaderCell[] = [];
  const seen = new Set<string>();
  const titles = new Map<number, string>();
  for (const row of used) {
    // 첫 줄은 미리보기보다 넓게 읽은 제목을 쓴다.
    const source = row === 0 && file.header.length > 0 ? file.header : rows[row];
    source.forEach((raw, col) => {
      const name = raw.trim();
      if (!name) {
        return;
      }
      titles.set(col, name);
      const key = headerKey(name);
      if (key && !seen.has(key)) {
        seen.add(key);
        cells.push({ name, col, row });
      }
    });
  }
  return { cells, dataStart: end, titleAt: (col) => titles.get(col) ?? "" };
}

function findHeader(model: HeaderModel, name: string): HeaderCell | undefined {
  const key = headerKey(name);
  return key ? model.cells.find((cell) => headerKey(cell.name) === key) : undefined;
}

/** 값이 시작하는 줄부터 그 열의 첫 값. */
function firstValue(file: SheetFile, model: HeaderModel, col: number): string {
  return (
    file.grid
      .slice(model.dataStart)
      .map((row) => (row[col] ?? "").trim())
      .find(Boolean) ?? ""
  );
}

/** 맞출 열 이름으로 쓸 만한 제목을 먼저 고른다. 기준 파일에서 고른 이름이 있으면 같은 이름을 우선한다. */
function autoKey(model: HeaderModel, preferred = ""): string {
  const same = preferred ? findHeader(model, preferred) : undefined;
  if (same) {
    return same.name;
  }
  for (const wanted of KEY_CANDIDATES) {
    const found = findHeader(model, wanted);
    if (found) {
      return found.name;
    }
  }
  return "";
}

/** 목록에서 열을 알아보도록 제목 아래 첫 값을 덧붙여 보여 준다. */
function columnLabel(file: SheetFile, model: HeaderModel, name: string): string {
  const found = findHeader(model, name);
  const sample = found ? firstValue(file, model, found.col) : "";
  return sample ? `${name} · ${clipText(sample, 12)}` : name;
}

interface DataColumn {
  index: number;
  name: string;
  label: string;
}

function columnLetter(index: number): string {
  let rest = index + 1;
  let letters = "";
  while (rest > 0) {
    const at = (rest - 1) % 26;
    letters = String.fromCharCode(65 + at) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

function clipText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 가져올 수 있는 데이터 열. 값이 있는 열을 열 글자(A, B…)와 제목, 첫 값으로 보여 준다.
 * 맞출 열은 뺀다. 미리보기 범위 밖의 열은 값을 알 수 없어 그대로 둔다.
 */
function dataColumns(file: SheetFile, model: HeaderModel, keyCol: number | null): DataColumn[] {
  const gridWidth = file.grid.reduce((most, row) => Math.max(most, row.length), 0);
  const width = Math.max(file.header.length, gridWidth);
  const columns: DataColumn[] = [];
  for (let index = 0; index < width; index += 1) {
    if (index === keyCol) {
      continue;
    }
    const sample = firstValue(file, model, index);
    if (!sample && index < gridWidth) {
      continue;
    }
    const title = model.titleAt(index);
    const letter = `${columnLetter(index)}열`;
    columns.push({
      index,
      name: title || letter,
      label: `${letter} · ${title ? clipText(title, 10) : "제목 없음"}${sample ? ` · ${clipText(sample, 12)}` : ""}`,
    });
  }
  return columns;
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
  /** 기준 파일이 아닌 파일마다 고른 맞출 열 이름. 고르지 않았으면 자동으로 찾는다. */
  const [fileKeys, setFileKeys] = useState<Record<string, string>>({});
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
  const readyMark = ready
    .map((file) => `${file.id}:${file.sheet}:${headerModel(file).cells.map((cell) => cell.name).join("\t")}`)
    .join("|");
  const baseName = baseFile?.name ?? "";

  useEffect(() => {
    const current = files.filter((file) => !file.note);
    setPairs((prev) => {
      const next: PairRow[] = [];
      for (const file of current.slice(1)) {
        const kept = prev.filter((pair) => pair.fileId === file.id);
        next.push(...(kept.length > 0 ? kept : [{ id: `${file.id}:0`, fileId: file.id, source: "", sourceCol: null, target: "", from: "", to: "" }]));
      }
      return next;
    });
    if (!keyTouched) {
      const first = current.find((file) => !isPdfName(file.name));
      setKeyName(first ? autoKey(headerModel(first)) : "");
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
          sheets: glance.sheets ?? [],
          sheet: "",
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
          sheets: [],
          sheet: "",
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
  const baseModel = base ? headerModel(base) : null;
  const baseHeaders = baseModel ? baseModel.cells.map((cell) => cell.name) : [];
  const listedKey = keyName && !baseHeaders.some((name) => headerKey(name) === headerKey(keyName)) ? [keyName] : [];
  const baseKeyCol = base && baseModel ? (base.keyAt ?? (keyName ? findHeader(baseModel, keyName)?.col ?? null : null)) : null;
  const fileKeyOf = (file: SheetFile): string => fileKeys[file.id] ?? autoKey(headerModel(file), keyName);

  const anchor = {
    keyAt: baseKeyCol,
    dataFrom: base && baseModel ? (base.dataFrom ?? baseModel.dataStart) : null,
    dataTo: base?.dataTo ?? null,
  };
  const sheetNames = ready.map((file) => file.sheet);
  const chosenPairs = pairs
    .map((pair) => {
      const file = ready.find((item) => item.id === pair.fileId);
      const model = file ? headerModel(file) : null;
      const own = file ? fileKeyOf(file) : "";
      const from = rowNumber(pair.from);
      const to = rowNumber(pair.to);
      // 제목이 여러 줄이어도 맞도록 열은 번호로 넘긴다.
      const targetAt = base?.valueAt ?? (baseModel && pair.target ? findHeader(baseModel, pair.target)?.col ?? null : null);
      return {
        fileIndex: ready.findIndex((item) => item.id === pair.fileId),
        source: pair.source,
        target: pair.target,
        key: own,
        keyAt: file?.keyAt ?? (model && own ? findHeader(model, own)?.col ?? null : null),
        sourceAt: file?.valueAt ?? pair.sourceCol ?? (model && pair.source ? findHeader(model, pair.source)?.col ?? null : null),
        targetAt,
        dataFrom: from ?? file?.dataFrom ?? model?.dataStart ?? null,
        dataTo: to ?? file?.dataTo ?? null,
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
          return pair.fileId === fileId ? { ...pair, source: "", sourceCol: null } : pair;
        }),
      );
    }
    if (pickMode === "key") {
      const picked = files.find((item) => item.id === fileId);
      let above = "";
      for (let at = row - 1; at >= 0 && !above; at -= 1) {
        above = picked?.grid[at]?.[column]?.trim() ?? "";
      }
      if (above) {
        if (baseFile?.id === fileId) {
          setKeyTouched(true);
          setKeyName(above);
        } else {
          setFileKeys((current) => ({ ...current, [fileId]: above }));
        }
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

  const changeSheet = async (fileId: string, sheet: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const glance = await glanceSheet(fileId, sheet);
      setFiles((current) =>
        current.map((item) =>
          item.id === fileId
            ? {
                ...item,
                sheet,
                header: glance.header,
                grid: glance.grid ?? [],
                note: glance.columns === 0 && glance.grid.length === 0 ? "내용이 없습니다." : "",
                keyAt: null,
                dataFrom: null,
                dataTo: null,
                valueAt: null,
              }
            : item,
        ),
      );
      // 시트가 바뀌면 이 파일에서 고른 열은 맞지 않으므로 비운다.
      const isBase = baseFile?.id === fileId;
      setPairs((current) =>
        current.map((pair) => {
          if (pair.fileId === fileId) {
            return { ...pair, source: "", sourceCol: null };
          }
          return isBase ? { ...pair, target: "" } : pair;
        }),
      );
      setFileKeys((current) => {
        const next = { ...current };
        delete next[fileId];
        return next;
      });
      if (isBase) {
        setKeyTouched(false);
      }
      setLook(null);
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
    }
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
      setLook(await lookExcelJoin(ready.map((file) => file.id), keyName.trim(), chosenPairs, anchor, sheetNames));
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
      setMade(await saveExcelJoin(ready.map((file) => file.id), title.trim(), keyName.trim(), chosenPairs, anchor, sheetNames));
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
    setFileKeys({});
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
                      {file.sheets.length > 1 ? (
                        <label className="flex items-center gap-2 text-[11px] text-quiet">
                          시트
                          <select
                            className="min-w-0 flex-1 rounded border border-line bg-card px-1 py-0.5 text-xs text-desk"
                            value={file.sheet || file.sheets[0]}
                            disabled={busy}
                            onChange={(event) => void changeSheet(file.id, event.target.value)}
                          >
                            {file.sheets.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {file.grid.length > 0 ? (
                        <div className="max-w-full overflow-x-auto">
                          <table className="border-collapse">
                            <tbody>
                              {file.grid.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                  <td className="px-1 text-right text-[10px] text-quiet">{rowIndex + 1}</td>
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
                  맞출 열 · 기준 파일 ({base.name})
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
                  const model = headerModel(file);
                  const fileNames = uniqueHeaders(model.cells.map((cell) => cell.name));
                  const ownKey = fileKeyOf(file);
                  const ownKeyCol = file.keyAt ?? findHeader(model, ownKey)?.col ?? null;
                  const filePairs = pairs.filter((pair) => pair.fileId === file.id);
                  const sources = dataColumns(file, model, ownKeyCol);
                  const targets = baseHeaders.filter((name) => headerKey(name) !== headerKey(keyName));
                  return (
                    <div key={file.id} className="space-y-2">
                      <p className="truncate text-xs text-desk">{file.name}</p>
                      <label className="block text-[11px] text-quiet">
                        맞출 열 · 이 파일
                        <select
                          className="mt-1 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-desk"
                          value={ownKey}
                          onChange={(event) => {
                            const value = event.target.value;
                            setFileKeys((current) => ({ ...current, [file.id]: value }));
                            setLook(null);
                          }}
                        >
                          <option value="">열을 고르세요</option>
                          {fileNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {ownKeyCol == null ? <p className="text-[11px] text-desk">이 파일에서 맞출 열을 고르세요.</p> : null}
                      {filePairs.map((pair) => (
                        <div key={pair.id} className="space-y-1">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block text-[11px] text-quiet">
                            가져올 열
                            <select
                              className="mt-1 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-desk"
                              value={pair.sourceCol == null ? "" : String(pair.sourceCol)}
                              onChange={(event) => {
                                const picked = sources.find((column) => String(column.index) === event.target.value);
                                setPairs((current) =>
                                  current.map((item) =>
                                    item.id === pair.id
                                      ? { ...item, source: picked?.name ?? "", sourceCol: picked?.index ?? null }
                                      : item,
                                  ),
                                );
                                setLook(null);
                              }}
                            >
                              <option value="">고르기</option>
                              {sources.map((column) => (
                                <option key={column.index} value={String(column.index)}>
                                  {column.label}
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
                                  {base && baseModel ? columnLabel(base, baseModel, name) : name}
                                </option>
                              ))}
                              {sources
                                .filter((column) => !targets.some((target) => headerKey(target) === headerKey(column.name)))
                                .map((column) => (
                                  <option key={`new-${column.index}`} value={column.name}>
                                    새 열 {column.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-quiet">
                          <span>가져올 줄</span>
                          {(["from", "to"] as const).map((edge) => (
                            <label key={edge} className="flex items-center gap-1">
                              <input
                                className="w-14 rounded border border-line bg-card px-1 py-0.5 text-xs text-desk"
                                inputMode="numeric"
                                aria-label={edge === "from" ? "가져올 첫 줄" : "가져올 끝 줄"}
                                placeholder={edge === "from" ? "처음" : "끝"}
                                value={pair[edge]}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setPairs((current) => current.map((item) => (item.id === pair.id ? { ...item, [edge]: value } : item)));
                                  setLook(null);
                                }}
                              />
                              {edge === "from" ? "줄부터" : "줄까지"}
                            </label>
                          ))}
                        </div>
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
                              { id: `${file.id}:${pairSeq.current}`, fileId: file.id, source: "", sourceCol: null, target: "", from: "", to: "" },
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
