import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface PickedFile {
  id: string;
  name: string;
  ext: string;
}

interface PlaceNote {
  kind: string;
  finding: string;
  a: number;
  b: number;
  c: number;
  label: string;
}

interface TypeNote {
  kind: string;
  count: number;
  places: PlaceNote[];
  overflow: number;
}

interface ComboNote {
  label: string;
  records: number;
}

interface FileNote {
  id: string;
  name: string;
  ext: string;
  grade: string;
  status: string;
  types: TypeNote[];
  combos: ComboNote[];
  referenceCount: number;
  hidden: boolean;
  partial: boolean;
  reason?: string | null;
}

interface FolderCard {
  id: string;
  name: string;
  ask: string;
}

interface PickNote {
  files: PickedFile[];
  skipped: number;
  folders: number;
  duringScan: boolean;
  foreign: boolean;
  folder?: FolderCard | null;
}

interface FolderSummary {
  listed: number;
  high: number;
  possible: number;
  clear: number;
  incomplete: number;
  unavailable: number;
  cloudFiles: number;
  links: number;
  otherLinks: number;
  systemDirs: number;
  hiddenSystem: number;
  unsupported: number;
  hwp: number;
  images: number;
  tooLarge: number;
  overflow: number;
  truncated: boolean;
  stopped: boolean;
}

interface FolderPulse {
  phase: string;
  listed: number;
  done: number;
  total: number;
  currentName: string;
  stopped: boolean;
  truncated: boolean;
  summary?: FolderSummary | null;
}

interface FolderLine {
  id: string;
  place: string;
  file: FileNote;
}

interface FolderPage {
  rows: FolderLine[];
  total: number;
  overflow: number;
  summary: FolderSummary;
}

interface ProgressNote {
  done: number;
  total: number;
  finished: boolean;
  stopped: boolean;
  currentName: string;
  file?: FileNote | null;
}

interface PrivacyScanPageProps {
  onBack: () => void;
}

const KIND_LABEL: Record<string, string> = {
  rrn: "주민등록번호",
  account: "계좌번호",
  mobile: "휴대전화",
  landline: "전화번호",
  email: "이메일",
  address: "주소",
  birth: "생년월일",
  ip: "IP",
};

const GRADE_RANK: Record<string, number> = {
  high: 0,
  possible: 1,
  incomplete: 2,
  unavailable: 3,
  clear: 4,
};

function folderAsk(ask: string, folders: number): string {
  const extra = folders > 1 ? " 폴더는 한 번에 하나씩 검사할 수 있습니다." : "";
  if (ask === "root") return `드라이브 전체는 검사하지 않습니다. 검사할 폴더를 골라 주세요.${extra}`;
  if (ask === "system") return `시스템 폴더는 검사하지 않습니다.${extra}`;
  if (ask === "link") return `바로가기나 연결 폴더는 따라가지 않습니다.${extra}`;
  if (ask === "slow") return `드라이브 전체를 검사하면 시간이 오래 걸릴 수 있습니다.${extra}`;
  if (ask === "removable") return `이동식 드라이브의 폴더입니다. 확인 후 검사합니다.${extra}`;
  if (ask === "network") return `네트워크 위치의 파일을 읽게 됩니다. 시간이 오래 걸리고 네트워크 사용량이 늘어날 수 있습니다.${extra}`;
  return extra.trim();
}

function gradeLine(grade: string): string {
  if (grade === "high") return "🔴 개인정보 포함 가능성 높음";
  if (grade === "possible") return "🟡 있음";
  if (grade === "clear") return "🟢 특이사항이 발견되지 않았습니다";
  if (grade === "incomplete") return "⚪ 일부만 검사되었습니다";
  return "⏸ 검사할 수 없습니다";
}

function reasonLine(file: FileNote): string {
  const ext = file.ext.toLowerCase();
  if (file.reason === "unsupported" && ext === "hwp") {
    return "HWP 형식은 아직 검사하지 못합니다. 한글에서 HWPX 형식으로 저장하면 검사할 수 있습니다.";
  }
  if (file.reason === "unsupported" && (ext === "jpg" || ext === "jpeg" || ext === "png")) {
    return "그림 파일은 아직 검사하지 못합니다.";
  }
  if (file.reason === "scannedPdf" || file.reason === "weakPdf") {
    return "이미지 기반 PDF이거나 글자를 읽을 수 없는 PDF일 수 있습니다.";
  }
  if (file.reason === "encrypted") return "암호가 걸려 있어 검사할 수 없습니다.";
  if (file.reason === "damaged" || file.reason === "missing" || file.reason === "io") return "파일을 열 수 없습니다.";
  if (file.reason === "tooLarge") return "파일이 검사 한도를 넘습니다.";
  if (file.reason === "timedOut") return "검사 시간이 넘어 검사할 수 없습니다.";
  if (file.reason === "denied") return "파일을 열 권한이 없습니다.";
  if (file.reason === "parserPanic") return "파일을 검사하는 중 문제가 생겼습니다.";
  if (file.grade === "unavailable") return "검사할 수 없습니다.";
  return "";
}

export function PrivacyScanPage({ onBack }: PrivacyScanPageProps) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [notes, setNotes] = useState<Record<string, FileNote>>({});
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentName, setCurrentName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [previewNote, setPreviewNote] = useState("");
  const [folder, setFolder] = useState<FolderCard | null>(null);
  const [subfolders, setSubfolders] = useState(true);
  const [folderPhase, setFolderPhase] = useState("");
  const [listed, setListed] = useState(0);
  const [summary, setSummary] = useState<FolderSummary | null>(null);
  const [folderRows, setFolderRows] = useState<FolderLine[]>([]);
  const [folderTotal, setFolderTotal] = useState(0);
  const [folderPage, setFolderPage] = useState(1);
  const [gradeFilter, setGradeFilter] = useState("all");

  useEffect(() => {
    let unlistenPick: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;
    let cancelled = false;
    void listen<PickNote>("privacy-picked", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.duringScan) {
        setNotice("검사가 끝난 뒤 다시 놓아 주세요.");
        return;
      }
      if (payload.folder) {
        setFolder(payload.folder);
        setSummary(null);
        setFolderRows([]);
        setFolderPhase("");
        setNotice(folderAsk(payload.folder.ask, payload.folders));
      } else if (payload.folders > 0) {
        setNotice("폴더는 한 번에 하나씩 검사할 수 있습니다.");
      } else if (payload.foreign) {
        setNotice("이번 버전은 파일만 검사할 수 있습니다.");
      } else if (payload.skipped > 0) {
        setNotice("한 번에 200개까지 검사합니다. 나머지는 이번 검사에 넣지 않았습니다.");
      } else {
        setNotice("");
      }
      if (payload.files.length) {
        setFiles((current) => {
          const known = new Set(current.map((item) => item.id));
          const next = payload.files.filter((item) => !known.has(item.id));
          return next.length ? [...current, ...next] : current;
        });
        setSelected(null);
      }
    }).then((unlisten) => {
      unlistenPick = unlisten;
    });
    void listen<ProgressNote>("privacy-progress", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      setDone(payload.done);
      setTotal(payload.total);
      setCurrentName(payload.currentName);
      if (payload.file) {
        const file = payload.file;
        setNotes((current) => ({ ...current, [file.id]: file }));
      }
      if (payload.finished) {
        setScanning(false);
        setCurrentName("");
      }
    }).then((unlisten) => {
      unlistenProgress = unlisten;
    });
    let unlistenFolder: (() => void) | undefined;
    void listen<FolderPulse>("privacy-folder", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      setFolderPhase(payload.phase);
      setListed(payload.listed);
      setDone(payload.done);
      setTotal(payload.total);
      setCurrentName(payload.currentName);
      if (payload.phase === "done") {
        setScanning(false);
        setCurrentName("");
        if (payload.summary) setSummary(payload.summary);
        void invoke<FolderPage>("privacy_folder_page", { grade: "all", page: 1, size: 50 }).then((page) => {
          setFolderRows(page.rows);
          setFolderTotal(page.total);
          setFolderPage(1);
          setGradeFilter("all");
          setSummary(page.summary);
        }).catch(() => setNotice("결과를 불러오지 못했습니다."));
      } else {
        setScanning(true);
      }
    }).then((unlisten) => {
      unlistenFolder = unlisten;
    });
    return () => {
      cancelled = true;
      unlistenPick?.();
      unlistenProgress?.();
      unlistenFolder?.();
    };
  }, []);

  const ordered = useMemo(() => {
    return [...files].sort((left, right) => {
      const leftRank = GRADE_RANK[notes[left.id]?.grade ?? ""] ?? 5;
      const rightRank = GRADE_RANK[notes[right.id]?.grade ?? ""] ?? 5;
      return leftRank - rightRank;
    });
  }, [files, notes]);

  const folderHit = folderRows.find((row) => row.id === selected);
  const detail = selected ? notes[selected] ?? folderHit?.file : undefined;
  const picked = selected ? files.find((item) => item.id === selected) : undefined;
  const detailTitle = folderHit?.place ?? picked?.name ?? detail?.name ?? "";
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const started = Object.keys(notes).length > 0 || scanning;

  const pick = () => {
    setNotice("");
    void invoke("privacy_pick").catch(() => setNotice("파일을 고르지 못했습니다."));
  };

  const scan = () => {
    if (!files.length || scanning) return;
    setNotes({});
    setSelected(null);
    setPreview(null);
    setPlacesOpen(false);
    setDone(0);
    setTotal(files.length);
    setFolderPhase("");
    setScanning(true);
    setNotice("");
    void invoke("privacy_scan", { ids: files.map((item) => item.id) }).catch(() => {
      setScanning(false);
      setNotice("검사를 시작하지 못했습니다.");
    });
  };

  const stop = () => {
    void invoke("privacy_stop");
  };

  const reset = () => {
    void invoke("privacy_reset").then(() => {
      setFiles([]);
      setNotes({});
      setSelected(null);
      setPreview(null);
      setPlacesOpen(false);
      setDone(0);
      setTotal(0);
      setScanning(false);
      setNotice("");
      setFolder(null);
      setSummary(null);
      setFolderRows([]);
      setFolderPhase("");
    });
  };

  const startFolder = () => {
    if (!folder || scanning) return;
    if (folder.ask === "root" || folder.ask === "system" || folder.ask === "link") return;
    setSummary(null);
    setFolderRows([]);
    setSelected(null);
    setScanning(true);
    setFolderPhase("list");
    setDone(0);
    setTotal(0);
    setListed(0);
    void invoke("privacy_folder_begin", {
      id: folder.id,
      subfolders,
      confirmed: folder.ask !== "start",
    }).catch(() => {
      setScanning(false);
      setNotice("폴더 검사를 시작하지 못했습니다.");
    });
  };

  const showPage = (grade: string, page: number) => {
    setGradeFilter(grade);
    setFolderPage(page);
    void invoke<FolderPage>("privacy_folder_page", { grade, page, size: 50 }).then((result) => {
      setFolderRows(result.rows);
      setFolderTotal(result.total);
      setSummary(result.summary);
    }).catch(() => setNotice("결과를 불러오지 못했습니다."));
  };

  const openPreview = (file: FileNote) => {
    const places = file.types.flatMap((item) => item.places);
    setPreview(null);
    setPreviewNote("");
    void invoke<string[]>("privacy_preview", { id: file.id, places })
      .then((masks) => setPreview(masks))
      .catch((error: unknown) => {
        const code = typeof error === "string" ? error : "";
        setPreviewNote(code === "changed" ? "파일이 바뀌어 다시 검사가 필요합니다." : "미리보기를 열지 못했습니다.");
      });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <ShieldCheck className="h-4 w-4 text-quiet" aria-hidden="true" />
        <h1 className="text-sm font-semibold text-desk">개인정보 보호</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          선택한 파일이나 폴더를 이 PC 안에서만 확인합니다. 파일을 바꾸거나 다른 곳으로 보내지 않습니다.
        </p>
        <p className="text-[11px] text-quiet">TXT, CSV, XLSX, DOCX, HWPX, PDF</p>
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
        {detail && detailTitle ? (
          <section className="space-y-2 rounded-lg border border-line bg-card p-3 shadow-card">
            <p className="truncate text-sm font-medium text-desk">{detailTitle}</p>
            <p className="text-sm text-desk">{gradeLine(detail.grade)}</p>
            {reasonLine(detail) ? <p className="text-xs leading-5 text-quiet">{reasonLine(detail)}</p> : null}
            {detail.types.map((item) => (
              <p key={item.kind} className="text-xs text-desk">
                {KIND_LABEL[item.kind] ?? item.kind} {item.count}건
                {item.overflow > 0 ? ` (위치 ${item.overflow}건은 목록에 넣지 않음)` : ""}
              </p>
            ))}
            {detail.combos.map((item) => (
              <p key={item.label} className="text-xs text-desk">
                {item.label} {item.records}건
              </p>
            ))}
            {detail.hidden ? <p className="text-xs text-quiet">화면에 보이지 않는 위치에서 후보가 나왔습니다.</p> : null}
            {detail.referenceCount > 0 ? (
              <p className="text-xs text-quiet">반복되거나 기관용으로 보이는 항목은 참고로만 두었습니다.</p>
            ) : null}
            <p className="text-xs leading-5 text-desk">외부 전송 또는 게시 전에 내용을 확인하세요.</p>
            {detail.partial && detail.types.length > 0 ? (
              <p className="text-xs text-quiet">단, 문서 일부만 검사되었습니다.</p>
            ) : null}
            <div className="flex flex-wrap gap-1">
              <button type="button" className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk" onClick={() => setPlacesOpen((open) => !open)}>
                발견 위치 보기
              </button>
              <button type="button" className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk" onClick={() => openPreview(detail)}>
                미리보기
              </button>
              <button
                type="button"
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk"
                onClick={() => void invoke("privacy_reveal", { id: detail.id }).catch(() => setNotice("파일 위치를 열지 못했습니다."))}
              >
                파일 위치 열기
              </button>
              <button
                type="button"
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk"
                onClick={() => {
                  setSelected(null);
                  setScanning(true);
                  setNotes((current) => {
                    const next = { ...current };
                    delete next[detail.id];
                    return next;
                  });
                  void invoke("privacy_scan", { ids: [detail.id] }).catch(() => setScanning(false));
                }}
              >
                다시 검사
              </button>
            </div>
            {placesOpen
              ? detail.types.flatMap((item) => item.places).map((place, index) => (
                  <p key={`${place.kind}-${place.a}-${place.b}-${place.c}-${index}`} className="text-[11px] text-quiet">
                    {KIND_LABEL[place.finding] ?? place.finding} {place.label}
                  </p>
                ))
              : null}
            {preview ? (
              <ul className="space-y-1">
                {preview.length ? preview.map((line, index) => (
                  <li key={`${index}-${line}`} className="text-xs text-desk">{line}</li>
                )) : <li className="text-xs text-quiet">표시할 미리보기가 없습니다.</li>}
              </ul>
            ) : null}
            {previewNote ? <p className="text-xs text-desk">{previewNote}</p> : null}
            <button type="button" className="text-[11px] text-ink" onClick={() => { setSelected(null); setPreview(null); setPlacesOpen(false); }}>
              목록으로
            </button>
          </section>
        ) : null}
        {!detail && scanning ? (
          <section className="space-y-2">
            <p className="text-sm text-desk">
              {folderPhase === "list" ? `파일을 찾는 중 ${listed}개` : `검사 중 ${done} / ${total}`}
              {folderPhase !== "list" && total > 0 ? ` · ${percent}%` : ""}
            </p>
            {currentName ? <p className="truncate text-xs text-quiet">{currentName}</p> : null}
            <button type="button" className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk" onClick={stop}>
              검사 중지
            </button>
          </section>
        ) : null}
        {!detail && started && !scanning ? (
          <ul className="card-surface divide-y divide-line/70">
            {ordered.map((file) => {
              const note = notes[file.id];
              return (
                <li key={file.id}>
                  <button type="button" className="w-full px-3 py-2 text-left" onClick={() => note && setSelected(file.id)}>
                    <span className="block truncate text-sm text-desk">{file.name}</span>
                    <span className="block text-[11px] text-quiet">{note ? gradeLine(note.grade) : "기다리는 중"}</span>
                    {note && reasonLine(note) ? <span className="block text-[11px] text-quiet">{reasonLine(note)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {!detail && folder && !summary ? (
          <section className="space-y-2 rounded-lg border border-line bg-card p-3">
            <p className="text-sm text-desk">{folder.name}</p>
            {folder.ask === "start" || folder.ask === "slow" || folder.ask === "removable" || folder.ask === "network" ? (
              <>
                <label className="flex items-center gap-2 text-xs text-desk">
                  <input type="checkbox" checked={subfolders} onChange={(event) => setSubfolders(event.target.checked)} />
                  하위 폴더 포함
                </label>
                <button type="button" className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white" onClick={startFolder} disabled={scanning}>
                  검사 시작
                </button>
              </>
            ) : null}
          </section>
        ) : null}
        {!detail && summary ? (
          <section className="space-y-2">
            {summary.stopped ? <p className="text-sm text-desk">검사를 멈췄습니다.</p> : null}
            {summary.truncated ? <p className="text-sm text-desk">검사 개수 한도에 도달해 나머지를 건너뛰었습니다.</p> : null}
            <p className="text-xs leading-5 text-desk">
              🔴 높음 {summary.high} · 🟡 있음 {summary.possible} · 🟢 특이사항이 발견되지 않은 파일 {summary.clear} · ⚪ 일부 {summary.incomplete} · ⏸ 검사 불가 {summary.unavailable}
            </p>
            <p className="text-xs leading-5 text-quiet">
              클라우드 전용 파일 {summary.cloudFiles} · 바로가기·연결 {summary.links} · 기타 연결 폴더 {summary.otherLinks} · 시스템 폴더 {summary.systemDirs} · 숨김 시스템 파일 {summary.hiddenSystem} · 지원하지 않는 형식 {summary.unsupported}
            </p>
            {summary.hwp > 0 ? <p className="text-xs leading-5 text-quiet">HWP 형식은 아직 검사하지 못합니다. 한글에서 HWPX 형식으로 저장하면 검사할 수 있습니다.</p> : null}
            {summary.cloudFiles > 0 ? <p className="text-xs leading-5 text-quiet">이 PC에 내려받지 않은 클라우드 파일은 검사하지 않았습니다.</p> : null}
            {summary.overflow > 0 ? <p className="text-xs text-quiet">외 {summary.overflow}개</p> : null}
            <div className="flex flex-wrap gap-1">
              {[
                ["all", "전체"],
                ["high", "높음"],
                ["possible", "있음"],
                ["incomplete", "일부"],
                ["unavailable", "불가"],
              ].map(([grade, label]) => (
                <button key={grade} type="button" className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk" onClick={() => showPage(grade, 1)}>
                  {label}
                </button>
              ))}
            </div>
            <ul className="card-surface divide-y divide-line/70">
              {folderRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left"
                    onClick={() => {
                      setNotes((current) => ({ ...current, [row.file.id]: row.file }));
                      setSelected(row.id);
                      setPreview(null);
                      setPlacesOpen(false);
                    }}
                  >
                    <span className="block text-[11px] text-quiet">{gradeLine(row.file.grade)}</span>
                    <span className="block truncate text-sm text-desk">{row.place}</span>
                  </button>
                </li>
              ))}
            </ul>
            {folderTotal > 50 ? (
              <div className="flex gap-1">
                <button type="button" className="text-[11px] text-ink" disabled={folderPage <= 1} onClick={() => showPage(gradeFilter, folderPage - 1)}>이전</button>
                <button type="button" className="text-[11px] text-ink" disabled={folderPage * 50 >= folderTotal} onClick={() => showPage(gradeFilter, folderPage + 1)}>다음</button>
              </div>
            ) : null}
          </section>
        ) : null}
        {!detail ? (
          <div className="flex flex-wrap gap-1">
            <button type="button" className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white" onClick={pick} disabled={scanning}>
              파일 선택
            </button>
            <button
              type="button"
              className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk"
              onClick={() => void invoke("privacy_pick_folder").catch(() => setNotice("폴더를 고르지 못했습니다."))}
              disabled={scanning}
            >
              폴더 선택
            </button>
            <button type="button" className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk" onClick={scan} disabled={scanning || files.length === 0}>
              검사 시작
            </button>
            {files.length > 0 ? (
              <button type="button" className="rounded-full border border-line px-2.5 py-1 text-[11px] text-desk" onClick={reset}>
                새로 검사
              </button>
            ) : null}
          </div>
        ) : null}
        {!detail && !started && files.length > 0 ? (
          <ul className="text-xs text-quiet">
            {files.map((file) => (
              <li key={file.id} className="truncate">{file.name}</li>
            ))}
          </ul>
        ) : null}
        {!detail ? (
          <p className="text-[11px] leading-5 text-quiet">파일이나 폴더를 놓으세요.</p>
        ) : null}
      </div>
    </div>
  );
}
