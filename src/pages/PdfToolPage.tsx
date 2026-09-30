import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArrowDown, ArrowLeft, ArrowUp, RotateCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { holdPdfDrop } from "../services/pdfDropGate";
import { sameLocalPath } from "../services/dropSiteService";
import {
  arrangePdf,
  extractPdf,
  formatByteSize,
  glancePdf,
  haltPdf,
  mergePdf,
  parsePageSpec,
  type PdfMade,
  type PdfSlot,
} from "../services/pdfToolService";

interface PdfToolPageProps {
  onBack: () => void;
  startPaths?: string[];
}

interface PdfFile {
  path: string;
  name: string;
  pages: number;
  signed: boolean;
  note: string;
}

type Mode = "menu" | "merge" | "split" | "arrange" | "turn" | "done";

const SIGNED_NOTE =
  "전자서명이 포함된 PDF일 수 있습니다. 페이지를 합치거나 삭제·회전하면 기존 전자서명의 유효성에 영향을 줄 수 있습니다.";

export function PdfToolPage({ onBack, startPaths }: PdfToolPageProps) {
  const addRef = useRef<(paths: string[]) => void>(() => {});
  const [mode, setMode] = useState<Mode>("menu");
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [slots, setSlots] = useState<PdfSlot[]>([]);
  const [, setPast] = useState<PdfSlot[][]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [rangeText, setRangeText] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [eachPage, setEachPage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [made, setMade] = useState<PdfMade | null>(null);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => holdPdfDrop((paths) => addRef.current(paths)), []);

  useEffect(() => {
    if (startPaths && startPaths.length > 0) {
      addRef.current(startPaths);
    }
  }, [startPaths]);

  const fileName = (path: string) => path.split(/[/\\]/).pop() || path;

  const readFile = async (path: string): Promise<PdfFile> => {
    const glance = await glancePdf(path);
    return { path, name: fileName(path), pages: glance.pages, signed: glance.signed, note: "" };
  };

  const addPaths = async (paths: string[], into?: Mode) => {
    if (busy) {
      return;
    }
    const target = into ?? mode;
    setMessage("");
    const base = target === "merge" && mode === "menu" ? [] : files;
    const incoming = paths.filter((path) => !base.some((file) => sameLocalPath(file.path, path)));
    if (target === "split" || target === "arrange" || target === "turn") {
      const path = incoming[0] ?? paths[0];
      if (!path) {
        return;
      }
      try {
        const file = await readFile(path);
        setFiles([file]);
        const next = Array.from({ length: file.pages }, (_, index) => ({ page: index + 1, turn: 0 }));
        setSlots(next);
        setPast([]);
        setPicked(null);
        setRangeText("");
        setRangeError("");
      } catch (error) {
        setMessage(asMessage(error));
      }
      return;
    }
    if (target !== "merge" && target !== "menu") {
      return;
    }
    setMode("merge");
    const room = incoming.slice(0, Math.max(0, 20 - base.length));
    if (incoming.length > room.length) {
      setMessage("한 번에 20개까지 합칠 수 있습니다.");
    }
    const loaded: PdfFile[] = [];
    for (const path of room) {
      try {
        loaded.push(await readFile(path));
      } catch (error) {
        loaded.push({ path, name: fileName(path), pages: 0, signed: false, note: asMessage(error) });
      }
    }
    if (loaded.length) {
      setFiles(base.length === 0 && target === "merge" && mode === "menu" ? loaded : [...base, ...loaded]);
    }
  };
  addRef.current = (paths) => {
    void addPaths(paths);
  };

  const pickFiles = async (multiple: boolean, into?: Mode) => {
    const selected = await open({
      multiple,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) {
      return;
    }
    const paths = Array.isArray(selected) ? selected : [selected];
    await addPaths(
      paths.filter((path): path is string => typeof path === "string"),
      into,
    );
  };

  const openSingle = async (next: "split" | "arrange" | "turn") => {
    setMode(next);
    setFiles([]);
    setSlots([]);
    setPast([]);
    setPicked(null);
    setRangeText("");
    setRangeError("");
    setMessage("");
    await pickFiles(false, next);
  };

  const remember = (next: PdfSlot[]) => {
    setPast((current) => [...current.slice(-20), slots]);
    setSlots(next);
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

  const moveSlot = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= slots.length) {
      return;
    }
    const next = slots.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    remember(next);
    setPicked(target);
  };

  const turnSlot = (index: number, delta: number) => {
    const next = slots.map((slot, slotIndex) =>
      slotIndex === index ? { ...slot, turn: (slot.turn + delta + 360) % 360 } : slot,
    );
    remember(next);
  };

  const removeSlot = (index: number) => {
    remember(slots.filter((_, slotIndex) => slotIndex !== index));
    setPicked(null);
  };

  const finish = (result: PdfMade) => {
    setMade(result);
    setMode("done");
    setProgress("");
  };

  const runMerge = async () => {
    const ready = files.filter((file) => file.pages > 0 && !file.note);
    if (ready.length < 2) {
      setMessage("PDF를 두 개 이상 넣어 주세요.");
      return;
    }
    setBusy(true);
    setProgress(`PDF를 처리하고 있습니다. 1 / ${ready.length} 파일`);
    setMessage("");
    try {
      finish(await mergePdf(ready.map((file) => file.path)));
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const runSplit = async () => {
    const file = files[0];
    if (!file || file.pages < 1) {
      setMessage("PDF 파일을 넣어 주세요.");
      return;
    }
    let pages: number[] = [];
    try {
      pages = parsePageSpec(rangeText, file.pages);
      setRangeError("");
    } catch (error) {
      setRangeError(asMessage(error));
      return;
    }
    setBusy(true);
    setProgress(eachPage ? `PDF를 처리하고 있습니다. 0 / ${pages.length} 페이지` : "PDF를 처리하고 있습니다.");
    setMessage("");
    try {
      finish(await extractPdf(file.path, pages, eachPage));
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const runArrange = async () => {
    const file = files[0];
    if (!file || slots.length === 0) {
      setMessage("남길 페이지가 없습니다.");
      return;
    }
    setBusy(true);
    setProgress(`PDF를 처리하고 있습니다. ${slots.length} / ${file.pages} 페이지`);
    setMessage("");
    try {
      finish(await arrangePdf(file.path, slots));
    } catch (error) {
      setMessage(asMessage(error));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const onRange = (value: string) => {
    setRangeText(value);
    const file = files[0];
    if (!file || !value.trim()) {
      setRangeError("");
      return;
    }
    try {
      parsePageSpec(value, file.pages);
      setRangeError("");
    } catch (error) {
      setRangeError(asMessage(error));
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (mode !== "arrange" && mode !== "turn") {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }
    if (event.key === "Escape") {
      setPicked(null);
    } else if (event.key === "Delete" && picked !== null) {
      event.preventDefault();
      removeSlot(picked);
    } else if (event.key === "z" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      setPast((current) => {
        const previous = current[current.length - 1];
        if (previous) {
          setSlots(previous);
        }
        return current.slice(0, -1);
      });
    }
  };

  const signed = files.some((file) => file.signed);
  const mergePages = files.reduce((sum, file) => sum + (file.note ? 0 : file.pages), 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper" onKeyDown={onKeyDown}>
      <header className="flex items-center gap-2 px-3 pt-3">
        <button
          type="button"
          className="icon-btn"
          aria-label="뒤로"
          onClick={() => {
            if (mode === "menu") {
              onBack();
              return;
            }
            if (mode === "done") {
              setMode("menu");
              setMade(null);
              setFiles([]);
              return;
            }
            setMode("menu");
            setMessage("");
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">PDF 도구</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {mode === "menu" ? (
          <>
            <p className="text-xs leading-5 text-quiet">
              PDF 파일을 쉽고 빠르게 정리하세요. 파일은 PC 안에서만 처리됩니다.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary" onClick={() => void pickFiles(true, "merge")}>
                PDF 합치기
              </button>
              <button type="button" className="btn-secondary" onClick={() => void openSingle("split")}>
                PDF 나누기
              </button>
              <button type="button" className="btn-secondary" onClick={() => void openSingle("arrange")}>
                페이지 정리
              </button>
              <button type="button" className="btn-secondary" onClick={() => void openSingle("turn")}>
                페이지 회전
              </button>
            </div>
          </>
        ) : null}

        {mode === "merge" ? (
          <>
            <p className="text-xs leading-5 text-quiet">순서를 정한 뒤 새 PDF로 저장합니다. 원본은 바꾸지 않습니다.</p>
            <button type="button" className="btn-secondary" onClick={() => void pickFiles(true)}>
              PDF 추가
            </button>
            <ul className="card-surface divide-y divide-line/70">
              {files.map((file, index) => (
                <li
                  key={file.path}
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
                    <p className="text-[11px] text-quiet">{file.note || `${file.pages}페이지`}</p>
                  </div>
                  <button type="button" className="icon-btn" aria-label="위로" onClick={() => moveFile(index, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className="icon-btn" aria-label="아래로" onClick={() => moveFile(index, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-quiet">총 {mergePages}페이지</p>
            {signed ? <p className="text-xs leading-5 text-desk">{SIGNED_NOTE}</p> : null}
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void runMerge()}>
              하나의 PDF로 합치기
            </button>
          </>
        ) : null}

        {mode === "split" && files[0] ? (
          <>
            <p className="text-sm text-desk">{files[0].name}</p>
            <p className="text-xs text-quiet">총 {files[0].pages}페이지</p>
            {files[0].signed ? <p className="text-xs leading-5 text-desk">{SIGNED_NOTE}</p> : null}
            <label className="block text-xs text-quiet" htmlFor="pdf-range">
              페이지 범위
            </label>
            <input
              id="pdf-range"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk"
              value={rangeText}
              placeholder="1-3, 5, 8-10"
              onChange={(event) => onRange(event.target.value)}
            />
            {rangeError ? <p className="text-xs text-desk">{rangeError}</p> : null}
            <label className="flex items-center gap-2 text-sm text-desk">
              <input type="radio" name="pdf-split" checked={!eachPage} onChange={() => setEachPage(false)} />
              선택한 페이지를 하나의 PDF로 저장
            </label>
            <label className="flex items-center gap-2 text-sm text-desk">
              <input type="radio" name="pdf-split" checked={eachPage} onChange={() => setEachPage(true)} />
              페이지별로 각각 저장
            </label>
            <button type="button" className="btn-primary w-full" disabled={busy || Boolean(rangeError)} onClick={() => void runSplit()}>
              나누기
            </button>
          </>
        ) : null}

        {(mode === "arrange" || mode === "turn") && files[0] ? (
          <>
            <p className="text-sm text-desk">{files[0].name}</p>
            <p className="text-xs leading-5 text-quiet">
              {mode === "turn"
                ? "페이지를 고르고 회전한 뒤 새 PDF로 저장합니다. Delete는 선택 페이지를 빼고, Ctrl+Z는 되돌립니다."
                : "순서를 바꾸거나 뺀 뒤 새 PDF로 저장합니다. Delete는 선택 페이지를 빼고, Ctrl+Z는 되돌립니다."}
            </p>
            {files[0].signed ? <p className="text-xs leading-5 text-desk">{SIGNED_NOTE}</p> : null}
            <ul className="card-surface divide-y divide-line/70">
              {slots.map((slot, index) => (
                <li
                  key={`${slot.page}-${index}`}
                  className={`flex items-center gap-1 px-2 py-1.5 ${picked === index ? "bg-card" : ""}`}
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
                    const next = slots.slice();
                    const [item] = next.splice(from, 1);
                    next.splice(index, 0, item);
                    remember(next);
                    setPicked(index);
                  }}
                >
                  <button type="button" className="min-w-0 flex-1 text-left text-sm text-desk" onClick={() => setPicked(index)}>
                    {index + 1}쪽 ← 원본 {slot.page}
                    {slot.turn ? ` · ${slot.turn}°` : ""}
                  </button>
                  <button type="button" className="icon-btn" aria-label="왼쪽 90도" onClick={() => turnSlot(index, 270)}>
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button type="button" className="icon-btn" aria-label="오른쪽 90도" onClick={() => turnSlot(index, 90)}>
                    <RotateCw className="h-4 w-4" />
                  </button>
                  <button type="button" className="icon-btn" aria-label="180도" onClick={() => turnSlot(index, 180)}>
                    180
                  </button>
                  <button type="button" className="icon-btn" aria-label="위로" onClick={() => moveSlot(index, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className="icon-btn" aria-label="아래로" onClick={() => moveSlot(index, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void runArrange()}>
              새 PDF로 저장
            </button>
          </>
        ) : null}

        {mode === "done" && made ? (
          <>
            <p className="text-sm text-desk">
              {made.stopped ? "작업을 멈췄습니다." : "PDF 처리가 완료되었습니다."}
            </p>
            <p className="text-xs leading-5 text-quiet">
              {made.paths.length}개 PDF · {made.pages}페이지 · {formatByteSize(made.bytes)}
            </p>
            {made.signed ? <p className="text-xs leading-5 text-desk">{SIGNED_NOTE}</p> : null}
            <p className="text-[11px] leading-5 text-quiet">특허 비침해를 보장하지 않습니다.</p>
            {made.paths[0] ? (
              <button type="button" className="btn-secondary w-full" onClick={() => void revealItemInDir(made.paths[0])}>
                저장 폴더 열기
              </button>
            ) : null}
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => {
                setMode("menu");
                setMade(null);
                setFiles([]);
                setSlots([]);
                setMessage("");
              }}
            >
              다른 PDF 작업
            </button>
          </>
        ) : null}

        {progress ? <p className="text-sm text-desk">{progress}</p> : null}
        {message ? <p className="text-sm text-desk">{message}</p> : null}
        {busy ? (
          <button type="button" className="btn-secondary" onClick={() => void haltPdf()}>
            중지
          </button>
        ) : null}
      </div>
    </div>
  );
}

function asMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "PDF를 처리하지 못했습니다.";
}
