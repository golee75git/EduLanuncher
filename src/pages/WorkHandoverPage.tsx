import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  assistWorkCards,
  checkLocalModel,
  haltWorkCards,
  listLocalModels,
  loadWorkCards,
  mergeWorkCards,
  openWorkFile,
  pickWorkFolder,
  readHandoverBox,
  runWorkCards,
  saveWorkCards,
  watchHandover,
  type CardBatch,
  type HandoverBox,
  type WorkCard,
} from "../services/workHandoverService";
import { HandoverExport, HandoverReceive } from "./WorkHandoverBox";

interface WorkHandoverPageProps {
  onBack: () => void;
  incoming?: HandoverBox | null;
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function fileName(rel: string): string {
  const parts = rel.split(/[/\\]/);
  return parts[parts.length - 1] || rel;
}

export function WorkHandoverPage({ onBack, incoming }: WorkHandoverPageProps) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [batch, setBatch] = useState<CardBatch | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [note, setNote] = useState("");
  const [mergeOn, setMergeOn] = useState<number[]>([]);
  const [aiOn, setAiOn] = useState(false);
  const [portText, setPortText] = useState("11434");
  const [model, setModel] = useState("");
  const [modelChoices, setModelChoices] = useState<string[] | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [incomingBox, setIncomingBox] = useState<HandoverBox | null>(incoming ?? null);
  const stopped = useRef(false);
  const shownBox = incoming ?? incomingBox;

  function portNumber(): number | null {
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return port;
  }

  useEffect(() => {
    let stop = () => {};
    void watchHandover((item) => {
      const line = item.phase === "assist" ? `AI가 정리하는 중 ${item.read} / ${item.total} 카드` : `파일을 읽는 중 ${item.read} / ${item.total}`;
      setStep(line);
    }).then((unlisten) => {
      stop = unlisten;
    });
    return () => {
      stop();
      void haltWorkCards();
    };
  }, []);

  const unread = useMemo(() => {
    const rows: { name: string; reason: string }[] = [];
    for (const task of batch?.tasks ?? []) {
      for (const file of task.files) {
        if (file.error) {
          rows.push({ name: fileName(file.rel), reason: file.error });
        }
      }
    }
    return rows;
  }, [batch]);

  function leave() {
    if (dirty && !window.confirm("저장하지 않은 내용이 있습니다. 화면을 닫을까요?")) {
      return;
    }
    onBack();
  }

  function replaceBatch(next: CardBatch, changed: boolean) {
    setBatch(next);
    setDirty(changed);
    setMergeOn([]);
  }

  async function chooseFolder() {
    setNote("");
    try {
      const id = await pickWorkFolder();
      if (!id) {
        return;
      }
      setFolderId(id);
      setBusy(true);
      stopped.current = false;
      setStep("파일을 읽는 중 0 / 0");
      let next = await runWorkCards(id);
      replaceBatch(next, true);
      if (!stopped.current && aiOn && aiReady && model.trim()) {
        const port = portNumber();
        if (port) {
          setStep("AI가 정리하는 중 0 / 0 카드");
          next = await assistWorkCards(id, next, port, model.trim());
          replaceBatch(next, true);
        }
      }
      setStep("");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "파일을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function updateTask(index: number, patch: Partial<WorkCard>) {
    setBatch((current) => {
      if (!current) {
        return current;
      }
      const tasks = current.tasks.map((task, item) => (item === index ? { ...task, ...patch } : task));
      return { ...current, tasks };
    });
    setDirty(true);
  }

  function toggleMerge(index: number) {
    setMergeOn((current) => {
      if (current.includes(index)) {
        return current.filter((item) => item !== index);
      }
      return [...current, index].slice(-2);
    });
  }

  async function mergeSelected() {
    if (!batch || mergeOn.length !== 2) {
      return;
    }
    const [first, second] = [...mergeOn].sort((left, right) => left - right);
    const left = batch.tasks[first];
    const right = batch.tasks[second];
    if (!left || !right) {
      return;
    }
    try {
      const merged = await mergeWorkCards(left, right);
      const tasks = batch.tasks.filter((_, index) => index !== first && index !== second);
      tasks.splice(first, 0, merged);
      replaceBatch({ ...batch, tasks, file_count: tasks.reduce((sum, task) => sum + task.files.length, 0) }, true);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "파일을 읽지 못했습니다.");
    }
  }

  async function save() {
    if (!batch || !folderId) {
      setNote("업무 폴더를 다시 고르면 열 수 있습니다.");
      return;
    }
    try {
      await saveWorkCards(folderId, batch);
      setDirty(false);
      setNote("저장했습니다.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "저장하지 못했습니다.");
    }
  }

  async function load() {
    setNote("");
    try {
      const next = await loadWorkCards();
      if (!next) {
        return;
      }
      replaceBatch(next, false);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "저장 파일을 읽지 못했습니다.");
    }
  }

  async function openFile(rel: string) {
    setNote("");
    try {
      await openWorkFile(folderId, rel);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "파일을 열지 못했습니다.");
    }
  }

  if (shownBox) {
    return <HandoverReceive box={shownBox} onBack={onBack} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" className="icon-btn" onClick={leave} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold text-desk">업무 인수인계</h1>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        <p className="text-xs leading-5 text-quiet">
          업무 폴더의 문서를 이 PC 안에서 읽어 업무별 시기와 기한을 정리합니다. 원본 파일은 바꾸지 않습니다.
        </p>
        <div className="space-y-2 rounded-lg border border-line p-2">
          <label className="flex items-center gap-2 text-xs text-desk">
            <input
              type="checkbox"
              checked={aiOn}
              onChange={(event) => {
                setAiOn(event.target.checked);
                setAiReady(false);
              }}
            />
            AI 보조
          </label>
          <p className="text-[11px] leading-4 text-quiet">기본은 꺼져 있습니다. 켜면 이 PC의 127.0.0.1에만 연결합니다.</p>
          {aiOn ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-desk">
                포트
                <input
                  className="ml-1 w-20 rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-desk"
                  value={portText}
                  onChange={(event) => {
                    setPortText(event.target.value);
                    setAiReady(false);
                  }}
                  aria-label="포트"
                />
              </label>
              {modelChoices && modelChoices.length > 0 ? (
                <select
                  className="rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-desk"
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setAiReady(false);
                  }}
                  aria-label="모델"
                >
                  <option value="">모델 선택</option>
                  {modelChoices.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-40 rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-desk"
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setAiReady(false);
                  }}
                  placeholder="모델 이름"
                  aria-label="모델 이름"
                />
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => {
                  const port = portNumber();
                  if (!port) {
                    setAiNote("이 주소는 연결하지 않습니다.");
                    return;
                  }
                  setAiNote("");
                  void listLocalModels(port)
                    .then((names) => {
                      setModelChoices(names);
                      if (!model && names[0]) {
                        setModel(names[0]);
                      }
                    })
                    .catch((error: unknown) => {
                      setModelChoices([]);
                      setAiNote(error instanceof Error ? error.message : "목록을 가져오지 못했습니다. 모델 이름을 입력하세요.");
                    });
                }}
              >
                모델 목록
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || !model.trim()}
                onClick={() => {
                  const port = portNumber();
                  if (!port) {
                    setAiNote("이 주소는 연결하지 않습니다.");
                    setAiReady(false);
                    return;
                  }
                  const started = performance.now();
                  void checkLocalModel(port, model.trim())
                    .then((ms) => {
                      const seconds = (ms / 1000).toFixed(1);
                      setAiReady(true);
                      setAiNote(`응답함 · ${seconds}초`);
                    })
                    .catch((error: unknown) => {
                      setAiReady(false);
                      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
                      const message = error instanceof Error ? error.message : "연결하지 못했습니다.";
                      setAiNote(`${message} · ${elapsed}초`);
                    });
                }}
              >
                연결 확인
              </button>
            </div>
          ) : null}
          {aiNote ? <p className="text-xs text-desk">{aiNote}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => void chooseFolder()} disabled={busy}>
            업무 폴더 고르기
          </button>
          <button type="button" className="btn-secondary" onClick={() => void save()} disabled={!batch || busy}>
            저장
          </button>
          <button type="button" className="btn-secondary" onClick={() => void load()} disabled={busy}>
            불러오기
          </button>
          <button type="button" className="btn-secondary" disabled={!batch || busy} onClick={() => setExportOpen(true)}>
            인계 박스 만들기
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              void readHandoverBox()
                .then((box) => {
                  if (box) {
                    setIncomingBox(box);
                  }
                })
                .catch((error: unknown) => setNote(error instanceof Error ? error.message : "인계 박스를 열지 못했습니다."));
            }}
          >
            인계 박스 열기
          </button>
          {busy ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                stopped.current = true;
                void haltWorkCards();
              }}
            >
              중지
            </button>
          ) : null}
          {batch && aiOn ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !aiReady || !folderId}
              onClick={() => {
                const port = portNumber();
                if (!folderId || !port || !model.trim()) {
                  setNote("모델 이름을 입력하세요.");
                  return;
                }
                setBusy(true);
                stopped.current = false;
                setStep("AI가 정리하는 중 0 / 0 카드");
                void assistWorkCards(folderId, batch, port, model.trim())
                  .then((next) => {
                    replaceBatch(next, true);
                    setStep("");
                  })
                  .catch((error: unknown) => {
                    setNote(error instanceof Error ? error.message : "연결하지 못했습니다.");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              다른 모델로 다시 정리
            </button>
          ) : null}
        </div>
        {exportOpen && batch ? <HandoverExport batch={batch} folderId={folderId} onClose={() => setExportOpen(false)} /> : null}
        {step ? <p className="text-xs text-desk">{step}</p> : null}
        {batch?.notice ? <p className="text-xs text-desk">{batch.notice}</p> : null}
        {batch?.reviewed_at ? <p className="text-xs text-quiet">확인 시각 {batch.reviewed_at}</p> : null}
        {note ? <p className="text-xs text-desk">{note}</p> : null}
        {batch ? (
          <>
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((month) => {
                const names = batch.tasks.filter((task) => task.include && task.months.includes(month));
                return (
                  <div key={month} className="rounded-lg border border-line p-1.5">
                    <p className="text-[11px] font-medium text-desk">{month}월</p>
                    {names.length === 0 ? <p className="text-[10px] text-quiet">없음</p> : null}
                    {names.map((task) => (
                      <p key={`${month}-${task.name}`} className="text-[10px] leading-4 text-desk">
                        {task.name}
                        {task.deadlines
                          .filter((item) => item.month === month)
                          .map((item) => ` ${item.day}일`)
                          .join("")}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
            {mergeOn.length === 2 ? (
              <button type="button" className="btn-secondary" onClick={() => void mergeSelected()}>
                고른 두 카드 합치기
              </button>
            ) : null}
            <div className="space-y-2">
              {batch.tasks.map((task, index) => (
                <article key={`${task.name}-${index}`} className="space-y-1.5 rounded-lg border border-line p-2">
                  <label className="flex items-center gap-2 text-xs text-desk">
                    <input
                      type="checkbox"
                      checked={task.include}
                      onChange={(event) => updateTask(index, { include: event.target.checked })}
                    />
                    포함
                  </label>
                  <label className="flex items-center gap-2 text-xs text-desk">
                    <input type="checkbox" checked={mergeOn.includes(index)} onChange={() => toggleMerge(index)} />
                    합치기
                  </label>
                  <input
                    className="w-full rounded-lg border border-line bg-transparent px-2 py-1 text-sm text-desk"
                    value={task.name}
                    onChange={(event) => updateTask(index, { name: event.target.value, ai_open: false })}
                    aria-label="업무 이름"
                  />
                  {task.ai_open && task.ai_name ? (
                    <p className="text-xs text-desk">
                      AI 제안 이름: {task.ai_name}{" "}
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => updateTask(index, { name: task.ai_name ?? task.name, ai_open: false })}
                      >
                        적용
                      </button>
                    </p>
                  ) : null}
                  <input
                    className="w-full rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-desk"
                    value={task.period}
                    onChange={(event) =>
                      updateTask(index, {
                        period: event.target.value,
                        deadlines: task.deadlines.map((item) => ({ ...item, from_model: false })),
                      })
                    }
                    aria-label="시기"
                  />
                  <p className="text-xs text-desk">확신 {task.confidence}</p>
                  {task.deadlines.length > 0 ? (
                    <ul className="space-y-0.5 text-[11px] text-quiet">
                      {task.deadlines.map((item) => (
                        <li key={`${item.file}-${item.month}-${item.day}`}>
                          {item.month}월 {item.day}일 · {fileName(item.file)}
                          {item.from_model ? (
                            <>
                              {" "}
                              AI 제안
                              <button
                                type="button"
                                className="ml-1 underline"
                                onClick={() =>
                                  updateTask(index, {
                                    deadlines: task.deadlines.map((row) =>
                                      row.month === item.month && row.day === item.day && row.file === item.file ? { ...row, from_model: false } : row,
                                    ),
                                  })
                                }
                              >
                                확인
                              </button>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    {task.files.map((file) =>
                      file.error ? (
                        <span key={file.rel} className="text-[11px] text-quiet">
                          {file.rel}
                        </span>
                      ) : (
                        <button key={file.rel} type="button" className="text-[11px] text-desk underline" onClick={() => void openFile(file.rel)}>
                          {file.rel}
                        </button>
                      ),
                    )}
                  </div>
                  <textarea
                    className="min-h-16 w-full rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-desk"
                    value={task.todos.join("\n")}
                    onChange={(event) => updateTask(index, { todos: event.target.value.split("\n").slice(0, 8), todo_open: [] })}
                    aria-label="할 일"
                    placeholder="할 일"
                  />
                  {task.todo_open?.some(Boolean) ? <p className="text-[11px] text-quiet">할 일 AI 제안</p> : null}
                  {task.orgs.length > 0 ? (
                    <ul className="space-y-0.5 text-[11px] text-quiet">
                      {task.orgs.map((org, orgIndex) => (
                        <li key={`${org}-${orgIndex}`}>
                          {org}
                          {task.org_open?.[orgIndex] ? (
                            <>
                              {" "}
                              AI 제안
                              <button
                                type="button"
                                className="ml-1 underline"
                                onClick={() =>
                                  updateTask(index, {
                                    org_open: (task.org_open ?? []).map((open, item) => (item === orgIndex ? false : open)),
                                  })
                                }
                              >
                                확인
                              </button>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
            {unread.length > 0 ? (
              <div>
                <h2 className="text-xs font-medium text-desk">읽지 못한 파일</h2>
                <ul className="mt-1 space-y-0.5 text-[11px] text-quiet">
                  {unread.map((item) => (
                    <li key={`${item.name}-${item.reason}`}>
                      {item.name} · {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
