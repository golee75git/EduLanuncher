import { listen } from "@tauri-apps/api/event";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { holdPrivacyDrop } from "../services/privacyDropGate";
import {
  exportCover,
  findPrivacyRegions,
  loadPrivacyShot,
  paintCover,
  paintMarks,
  paintStages,
  privacyFindCaps,
  privacySaveName,
  stopPrivacyFind,
  writePrivacyFile,
  type CoverBox,
  type CoverKind,
  type CoverLevel,
  type FaceCover,
  type FindCaps,
  type FindOutcome,
  type JpegGrade,
  type StageMark,
  type PrivacyShot,
  type RegionKind,
} from "../services/privacyMaskService";
import { pickOpenFiles, pickSaveFile } from "../services/savePick";
import type { GrantedFile } from "../services/dropSiteService";

interface PrivacyMaskPageProps {
  title: string;
  onBack: () => void;
  startFile?: GrantedFile;
}

interface DragState {
  mode: "new" | "move" | "nw" | "ne" | "sw" | "se";
  id: string;
  x: number;
  y: number;
  box: CoverBox;
  past: CoverBox[];
}

let boxSerial = 0;

export function PrivacyMaskPage({ title, onBack, startFile }: PrivacyMaskPageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<PrivacyShot | null>(null);
  const boxesRef = useRef<CoverBox[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const openPictureRef = useRef<(file: GrantedFile) => void>(() => {});
  const recentOpen = useRef({ path: "", at: 0 });
  const [sourcePath, setSourcePath] = useState("");
  const [shot, setShot] = useState<PrivacyShot | null>(null);
  const [boxes, setBoxes] = useState<CoverBox[]>([]);
  const [stages, setStages] = useState<StageMark[]>([]);
  const [fullOnly, setFullOnly] = useState(false);
  const [diagSave, setDiagSave] = useState(false);
  const stagesRef = useRef<StageMark[]>([]);
  const [past, setPast] = useState<CoverBox[][]>([]);
  const [future, setFuture] = useState<CoverBox[][]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [kind, setKind] = useState<CoverKind>("solid");
  const [level, setLevel] = useState<CoverLevel>("mid");
  const [faceCover, setFaceCover] = useState<FaceCover>("soft");
  const [grade, setGrade] = useState<JpegGrade>("high");
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [findStep, setFindStep] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [caps, setCaps] = useState<FindCaps | null>(null);
  const [wishFace, setWishFace] = useState(true);
  const [wishNumber, setWishNumber] = useState(true);
  const [wishPlate, setWishPlate] = useState(false);
  const [wishText, setWishText] = useState(false);
  const findStarted = useRef(0);

  boxesRef.current = boxes;
  shotRef.current = shot;

  useEffect(() => {
    return () => {
      const current = shotRef.current;
      if (current) {
        URL.revokeObjectURL(current.url);
      }
    };
  }, []);

  useEffect(() => holdPrivacyDrop((file) => openPictureRef.current(file)), []);

  useEffect(() => {
    if (startFile) {
      openPictureRef.current(startFile);
    }
  }, [startFile]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (event.ctrlKey && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (event.key === "Escape") {
        setSelectedId("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    drawPreview();
  }, [shot, boxes, stages, kind, level, faceCover]);

  useEffect(() => {
    void privacyFindCaps()
      .then((next) => {
        setCaps(next);
        if (!next.face) setWishFace(false);
        if (!next.text) {
          setWishNumber(false);
          setWishPlate(false);
          setWishText(false);
        }
      })
      .catch(() => setCaps({ face: false, text: false, debug: false }));
  }, []);

  useEffect(() => {
    if (!finding) return;
    const timer = window.setInterval(() => {
      setElapsed(Date.now() - findStarted.current);
    }, 200);
    return () => window.clearInterval(timer);
  }, [finding]);

  useEffect(() => {
    const unlisten = listen<string>("privacy-find-step", (event) => {
      setFindStep(event.payload === "text" ? "글자를 찾는 중" : "얼굴을 찾는 중");
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (!shotRef.current) {
        return;
      }
      event.preventDefault();
      setZoom((current) => clampZoom(current * (event.deltaY > 0 ? 0.9 : 1.1)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [shot]);

  const drawPreview = () => {
    const canvas = canvasRef.current;
    const current = shotRef.current;
    if (!canvas || !current) {
      return;
    }
    const fitted = fitBox(current.width, current.height, 640, 420);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(fitted.width * ratio));
    canvas.height = Math.max(1, Math.round(fitted.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    paintCover(ctx, current.image, canvas.width, canvas.height, boxesRef.current, kind, level, faceCover);
    paintMarks(ctx, canvas.width, canvas.height, boxesRef.current);
    if (import.meta.env.DEV) {
      paintStages(ctx, canvas.width, canvas.height, stagesRef.current);
    }
  };

  const replaceShot = (next: PrivacyShot | null) => {
    const previous = shotRef.current;
    if (previous) {
      URL.revokeObjectURL(previous.url);
    }
    shotRef.current = next;
    setShot(next);
    setBoxes([]);
    boxesRef.current = [];
    setStages([]);
    stagesRef.current = [];
    setPast([]);
    setFuture([]);
    setSelectedId("");
    setZoom(1);
  };

  const readPath = async (file: GrantedFile) => {
    const now = Date.now();
    if (recentOpen.current.path === file.id && now - recentOpen.current.at < 1200) {
      return;
    }
    recentOpen.current = { path: file.id, at: now };
    setBusy(true);
    setMessage("");
    try {
      const next = await loadPrivacyShot(file.id);
      replaceShot(next);
      setSourcePath(file.name);
    } catch (error) {
      setMessage(asMessage(error, "그림을 열지 못했습니다. 직접 영역을 지정하려면 다른 그림을 고르세요."));
    } finally {
      setBusy(false);
    }
  };

  openPictureRef.current = (file: GrantedFile) => {
    void readPath(file);
  };

  const pickPicture = async () => {
    setMessage("");
    try {
      const selected = await pickOpenFiles("picture");
      const file = selected[0];
      if (!file) {
        return;
      }
      await readPath(file);
    } catch (error) {
      setMessage(asMessage(error, "그림을 열지 못했습니다."));
    }
  };

  const remember = (next: CoverBox[]) => {
    setPast((items) => [...items, boxesRef.current].slice(-40));
    setFuture([]);
    boxesRef.current = next;
    setBoxes(next);
  };

  const undo = () => {
    setPast((items) => {
      const previous = items[items.length - 1];
      if (!previous) {
        return items;
      }
      setFuture((ahead) => [...ahead, boxesRef.current]);
      boxesRef.current = previous;
      setBoxes(previous);
      return items.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((items) => {
      const next = items[items.length - 1];
      if (!next) {
        return items;
      }
      setPast((behind) => [...behind, boxesRef.current].slice(-40));
      boxesRef.current = next;
      setBoxes(next);
      return items.slice(0, -1);
    });
  };

  const removeSelected = () => {
    if (!selectedId) {
      return;
    }
    const next = boxesRef.current.filter((box) => box.id !== selectedId);
    if (next.length === boxesRef.current.length) {
      return;
    }
    remember(next);
    setSelectedId("");
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = shotRef.current;
    const canvas = canvasRef.current;
    if (!current || !canvas || busy || finding) {
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    const point = normPoint(event, canvas);
    const selected = boxesRef.current.find((box) => box.id === selectedId);
    const handle = selected ? hitHandle(selected, point, canvas.getBoundingClientRect()) : null;
    if (selected && handle) {
      dragRef.current = {
        mode: handle,
        id: selected.id,
        x: point.x,
        y: point.y,
        box: selected,
        past: boxesRef.current,
      };
      return;
    }
    const hit = [...boxesRef.current].reverse().find((box) => insideBox(box, point));
    if (hit) {
      setSelectedId(hit.id);
      dragRef.current = {
        mode: "move",
        id: hit.id,
        x: point.x,
        y: point.y,
        box: hit,
        past: boxesRef.current,
      };
      return;
    }
    const id = nextBoxId();
    const created: CoverBox = { id, x: point.x, y: point.y, w: 0, h: 0, kind: "manual", on: true };
    setSelectedId(id);
    dragRef.current = {
      mode: "new",
      id,
      x: point.x,
      y: point.y,
      box: created,
      past: boxesRef.current,
    };
    boxesRef.current = [...boxesRef.current, created];
    setBoxes(boxesRef.current);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) {
      return;
    }
    const point = normPoint(event, canvas);
    const dx = point.x - drag.x;
    const dy = point.y - drag.y;
    const nextBox = movedBox(drag, dx, dy);
    const next = boxesRef.current.map((box) => (box.id === drag.id ? nextBox : box));
    boxesRef.current = next;
    setBoxes(next);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) {
      return;
    }
    let next = boxesRef.current.map((box) => (box.id === drag.id ? finishBox(box) : box));
    const changed = next.find((box) => box.id === drag.id);
    if (drag.mode === "new" && changed && (changed.w < 0.01 || changed.h < 0.01)) {
      next = next.filter((box) => box.id !== drag.id);
      setSelectedId("");
    }
    if (sameBoxes(drag.past, next)) {
      boxesRef.current = next;
      setBoxes(next);
      return;
    }
    setPast((items) => [...items, drag.past].slice(-40));
    setFuture([]);
    boxesRef.current = next;
    setBoxes(next);
  };

  const saveFile = async () => {
    const current = shotRef.current;
    if (!current || !sourcePath) {
      setMessage("그림을 먼저 고르세요.");
      return;
    }
    if (!boxesRef.current.some((box) => box.on)) {
      setMessage("가릴 영역을 먼저 지정하세요.");
      return;
    }
    if (finding) {
      setMessage("찾기가 끝난 뒤에 저장하세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const picked = await pickSaveFile(
        "picture",
        privacySaveName(sourcePath, current.mime),
        current.mime === "image/png" ? "png" : "jpeg",
      );
      if (!picked) {
        return;
      }
      const blob = await exportCover(current, boxesRef.current, kind, level, grade, faceCover);
      await writePrivacyFile(current.readId, picked.id, blob);
      setMessage("새 파일로 저장했습니다. 원본 그림은 그대로입니다. 저장 전에 가린 자리를 직접 확인하세요.");
    } catch (error) {
      setMessage(asMessage(error, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const anyWish = () => wishFace || wishNumber || wishPlate || wishText;

  const toggleBox = (id: string) => {
    remember(boxesRef.current.map((box) => (box.id === id ? { ...box, on: !box.on } : box)));
  };

  const removeBox = (id: string) => {
    const next = boxesRef.current.filter((box) => box.id !== id);
    if (next.length === boxesRef.current.length) return;
    remember(next);
    if (selectedId === id) setSelectedId("");
  };

  const runFind = async () => {
    const current = shotRef.current;
    if (!current || finding) return;
    setFinding(true);
    setFindStep("찾는 중");
    findStarted.current = Date.now();
    setElapsed(0);
    setMessage("");
    try {
      const outcome = await findPrivacyRegions(
        current.readId,
        {
          face: wishFace,
          number: wishNumber,
          plate: wishPlate,
          text: wishText,
        },
        import.meta.env.DEV ? { fullOnly, diag: diagSave } : undefined,
      );
      const nextStages = import.meta.env.DEV ? outcome.stages ?? [] : [];
      stagesRef.current = nextStages;
      setStages(nextStages);
      const manual = boxesRef.current.filter((box) => box.kind === "manual");
      const added = outcome.regions.map((region) => ({
        id: nextBoxId(),
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
        kind: region.kind,
        on: true,
      }));
      remember([...manual, ...added]);
      setMessage(findMessage(outcome, { face: wishFace, number: wishNumber, plate: wishPlate, text: wishText }));
    } catch (error) {
      setMessage(asMessage(error, "사진을 확인하지 못했습니다."));
    } finally {
      setFinding(false);
      setFindStep("");
    }
  };

  const haltFind = async () => {
    try {
      await stopPrivacyFind();
    } catch (error) {
      setMessage(asMessage(error, "찾기를 멈추지 못했습니다."));
    }
  };

  const fitted = shot ? fitBox(shot.width, shot.height, 640, 420) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{title || "사진 모자이크"}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          사진 속 얼굴·번호·문자 등 개인정보를 영역으로 가리고, 원본 크기 그대로 새 파일에 저장합니다.
          원본 파일은 바꾸지 않습니다.
        </p>
        <p className="text-[11px] leading-5 text-quiet">
          자동으로 찾기는 이 PC 안에서만 얼굴과 숫자 후보를 보여 줍니다. 켠 영역만 새 파일에 가려 저장하며,
          결과는 자동으로 저장되지 않습니다. 새 파일에는 위치·카메라 정보가 들어가지 않습니다.
        </p>
        <p className="text-[11px] leading-5 text-quiet">
          자동 찾기는 모든 얼굴과 숫자를 찾지 못할 수 있습니다. 옆모습, 작거나 가려진 얼굴, 흐린 글자는 빠질 수
          있으니 저장 전에 사진 전체를 직접 확인하세요.
        </p>
        <p className="text-[11px] leading-5 text-quiet">특허 비침해를 보장하지 않으며 법적 검토가 아닙니다.</p>
        <button type="button" className="btn-primary" onClick={() => void pickPicture()} disabled={busy}>
          사진 선택
        </button>
        {shot && fitted ? (
          <div
            ref={frameRef}
            className="max-h-80 overflow-auto rounded-lg border border-line bg-card"
          >
            <canvas
              ref={canvasRef}
              className="block cursor-crosshair touch-none"
              style={{ width: fitted.width * zoom, height: fitted.height * zoom }}
              aria-label="사진 미리보기. 끌어서 가릴 영역을 지정합니다."
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
        <div className="grid grid-cols-4 gap-2">
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={() => setZoom((value) => clampZoom(value * 1.25))} disabled={!shot}>
            확대
          </button>
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={() => setZoom((value) => clampZoom(value / 1.25))} disabled={!shot}>
            축소
          </button>
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={() => setActualSize()} disabled={!shot}>
            100%
          </button>
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={() => setZoom(1)} disabled={!shot}>
            화면 맞춤
          </button>
        </div>
        <div className="space-y-2 rounded-lg border border-line bg-card p-2">
          <p className="text-xs text-desk">자동으로 찾기</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-desk">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={wishFace} disabled={finding || caps?.face === false} onChange={(event) => setWishFace(event.target.checked)} />
              얼굴
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={wishNumber} disabled={finding || caps?.text === false} onChange={(event) => setWishNumber(event.target.checked)} />
              개인정보 숫자·글자
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={wishPlate} disabled={finding || caps?.text === false} onChange={(event) => setWishPlate(event.target.checked)} />
              번호판
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={wishText} disabled={finding || caps?.text === false} onChange={(event) => setWishText(event.target.checked)} />
              모든 글자
            </label>
          </div>
          {caps && !caps.face ? <p className="text-[11px] leading-5 text-quiet">이 PC에서는 얼굴 찾기를 사용할 수 없습니다.</p> : null}
          {import.meta.env.DEV && caps?.debug ? (
            <div className="space-y-1 text-[11px] text-quiet">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={fullOnly} disabled={finding} onChange={(event) => setFullOnly(event.target.checked)} />
                전체만
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={diagSave} disabled={finding} onChange={(event) => setDiagSave(event.target.checked)} />
                확인용 그림 저장
              </label>
              <p>파랑은 전체, 주황은 2×2, 초록은 3×3입니다. 저장한 그림은 다음 찾기 때 지웁니다.</p>
            </div>
          ) : null}
          {caps && !caps.text ? <p className="text-[11px] leading-5 text-quiet">이 PC에서는 글자 인식을 사용할 수 없습니다(Windows 언어 설정 확인).</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary h-9 text-xs" onClick={() => void runFind()} disabled={!shot || finding || busy || !anyWish()}>
              자동으로 찾기
            </button>
            <button type="button" className="btn-secondary h-9 text-xs" onClick={() => void haltFind()} disabled={!finding}>
              중지
            </button>
          </div>
          {finding ? (
            <p className="text-[11px] text-quiet">
              {findStep || "찾는 중"} · {(elapsed / 1000).toFixed(1)}초
            </p>
          ) : null}
        </div>
        {boxes.length > 0 ? (
          <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-line bg-card p-2">
            {boxes.map((box, index) => (
              <div key={box.id} className="flex items-center gap-2 text-xs text-desk">
                <input type="checkbox" checked={box.on} onChange={() => toggleBox(box.id)} aria-label={`${kindLabel(box.kind)} 영역 켜기`} />
                <span className="min-w-0 flex-1" style={{ color: kindTone(box.kind) }}>
                  {kindLabel(box.kind)} {index + 1}
                </span>
                <button type="button" className="btn-secondary h-7 px-2 text-[11px]" onClick={() => removeBox(box.id)}>
                  지우기
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={kindButton(faceCover === "soft")} onClick={() => setFaceCover("soft")} aria-pressed={faceCover === "soft"}>
            얼굴 강한 흐림
          </button>
          <button type="button" className={kindButton(faceCover === "block")} onClick={() => setFaceCover("block")} aria-pressed={faceCover === "block"}>
            얼굴 큰 모자이크
          </button>
        </div>
        <p className="text-[11px] leading-5 text-quiet">아래 가리기 방식은 직접 그린 영역에 적용됩니다. 숫자·번호판·글자는 단색으로 덮습니다.</p>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={kindButton(kind === "solid")} onClick={() => setKind("solid")} aria-pressed={kind === "solid"}>
            완전 가림
          </button>
          <button type="button" className={kindButton(kind === "block")} onClick={() => setKind("block")} aria-pressed={kind === "block"}>
            모자이크
          </button>
          <button type="button" className={kindButton(kind === "soft")} onClick={() => setKind("soft")} aria-pressed={kind === "soft"}>
            흐림
          </button>
        </div>
        {kind !== "solid" ? (
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className={kindButton(level === "light")} onClick={() => setLevel("light")} aria-pressed={level === "light"}>
              약하게
            </button>
            <button type="button" className={kindButton(level === "mid")} onClick={() => setLevel("mid")} aria-pressed={level === "mid"}>
              보통
            </button>
            <button type="button" className={kindButton(level === "heavy")} onClick={() => setLevel("heavy")} aria-pressed={level === "heavy"}>
              강하게
            </button>
          </div>
        ) : null}
        {shot?.mime === "image/jpeg" ? (
          <div className="grid grid-cols-3 gap-2">
            <button type="button" className={kindButton(grade === "best")} onClick={() => setGrade("best")} aria-pressed={grade === "best"}>
              최고 품질
            </button>
            <button type="button" className={kindButton(grade === "high")} onClick={() => setGrade("high")} aria-pressed={grade === "high"}>
              고품질
            </button>
            <button type="button" className={kindButton(grade === "small")} onClick={() => setGrade("small")} aria-pressed={grade === "small"}>
              파일 크기 우선
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={undo} disabled={past.length === 0}>
            실행 취소
          </button>
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={redo} disabled={future.length === 0}>
            다시 실행
          </button>
          <button type="button" className="btn-secondary h-9 px-1 text-xs" onClick={removeSelected} disabled={!selectedId}>
            영역 삭제
          </button>
        </div>
        <p className="text-xs text-quiet">가릴 곳 {boxes.length}개. Delete 키로 선택 영역을 지웁니다.</p>
        <button type="button" className="btn-primary" onClick={() => void saveFile()} disabled={busy || finding || !shot}>
          {busy ? "처리 중..." : "새 파일로 저장"}
        </button>
        {message ? <p className="text-sm leading-6 text-desk">{message}</p> : null}
      </div>
    </div>
  );

  function setActualSize() {
    const current = shotRef.current;
    if (!current) {
      return;
    }
    const fittedSize = fitBox(current.width, current.height, 640, 420);
    setZoom(clampZoom(current.width / fittedSize.width));
  }
}

function findMessage(outcome: FindOutcome, wish: { face: boolean; number: boolean; plate: boolean; text: boolean }): string {
  const parts: string[] = [];
  if (wish.face) parts.push(`얼굴 ${outcome.faceCount}개`);
  if (wish.number) parts.push(`숫자 ${outcome.numberCount}개`);
  if (wish.plate) parts.push(`번호판 ${outcome.plateCount}개`);
  if (wish.text) parts.push(`글자 ${outcome.textCount}개`);
  const total = outcome.faceCount + outcome.numberCount + outcome.plateCount + outcome.textCount;
  const lines: string[] = [];
  if (total > 0 && parts.length > 0) {
    lines.push(`${parts.join(", ")}를 찾았습니다.`);
  } else if (!outcome.partial) {
    lines.push("찾지 못했습니다.");
  }
  if (outcome.partialReason === "timeout") {
    lines.push("시간이 되어 여기까지 찾았습니다. 나머지는 직접 확인하세요.");
  } else if (outcome.partialReason === "stopped") {
    lines.push("찾기를 멈췄습니다.");
  } else if (outcome.partialReason === "trimmed") {
    lines.push("영역이 많아 여기까지만 표시합니다. 나머지는 직접 확인하세요.");
  }
  lines.push(`걸린 시간 ${(outcome.elapsedMs / 1000).toFixed(1)}초`);
  return lines.join(" ");
}

function kindLabel(kind: RegionKind): string {
  if (kind === "face") return "얼굴";
  if (kind === "number") return "개인정보 숫자";
  if (kind === "plate") return "번호판";
  if (kind === "text") return "글자";
  return "직접 지정";
}

function kindTone(kind: RegionKind): string {
  if (kind === "face") return "#c2410c";
  if (kind === "number") return "#1d4ed8";
  if (kind === "plate") return "#15803d";
  if (kind === "text") return "#7c3aed";
  return "inherit";
}

function kindButton(active: boolean): string {
  return active
    ? "btn-primary h-9 px-1 text-xs"
    : "btn-secondary h-9 px-1 text-xs";
}

function fitBox(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function clampZoom(value: number): number {
  return Math.min(8, Math.max(0.25, value));
}

function nextBoxId(): string {
  boxSerial += 1;
  return `box-${boxSerial}`;
}

function normPoint(event: ReactPointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const x = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
  const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
  return { x: clamp01(x), y: clamp01(y) };
}

function insideBox(box: CoverBox, point: { x: number; y: number }): boolean {
  return point.x >= box.x && point.y >= box.y && point.x <= box.x + box.w && point.y <= box.y + box.h;
}

function hitHandle(
  box: CoverBox,
  point: { x: number; y: number },
  rect: DOMRect,
): "nw" | "ne" | "sw" | "se" | null {
  const reachX = rect.width > 0 ? 14 / rect.width : 0.04;
  const reachY = rect.height > 0 ? 14 / rect.height : 0.04;
  const corners = [
    { mode: "nw" as const, x: box.x, y: box.y },
    { mode: "ne" as const, x: box.x + box.w, y: box.y },
    { mode: "sw" as const, x: box.x, y: box.y + box.h },
    { mode: "se" as const, x: box.x + box.w, y: box.y + box.h },
  ];
  return corners.find((corner) => Math.abs(point.x - corner.x) <= reachX && Math.abs(point.y - corner.y) <= reachY)?.mode ?? null;
}

function movedBox(drag: DragState, dx: number, dy: number): CoverBox {
  const box = drag.box;
  if (drag.mode === "move") {
    return {
      ...box,
      x: clampRange(box.x + dx, box.w),
      y: clampRange(box.y + dy, box.h),
    };
  }
  if (drag.mode === "new") {
    const x = Math.min(drag.x, drag.x + dx);
    const y = Math.min(drag.y, drag.y + dy);
    return finishBox({ ...box, x, y, w: Math.abs(dx), h: Math.abs(dy) });
  }
  let x = box.x;
  let y = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  if (drag.mode === "nw" || drag.mode === "sw") {
    x = box.x + dx;
  }
  if (drag.mode === "ne" || drag.mode === "se") {
    right = box.x + box.w + dx;
  }
  if (drag.mode === "nw" || drag.mode === "ne") {
    y = box.y + dy;
  }
  if (drag.mode === "sw" || drag.mode === "se") {
    bottom = box.y + box.h + dy;
  }
  return finishBox({
    ...box,
    x: Math.min(x, right),
    y: Math.min(y, bottom),
    w: Math.abs(right - x),
    h: Math.abs(bottom - y),
  });
}

function finishBox(box: CoverBox): CoverBox {
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const right = clamp01(box.x + box.w);
  const bottom = clamp01(box.y + box.h);
  return { ...box, x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

function sameBoxes(left: CoverBox[], right: CoverBox[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((box, index) => {
    const other = right[index];
    return box.id === other.id && box.x === other.x && box.y === other.y && box.w === other.w && box.h === other.h;
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampRange(origin: number, size: number): number {
  return Math.min(Math.max(0, origin), Math.max(0, 1 - size));
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
