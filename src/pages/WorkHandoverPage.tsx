import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  haltWorkCards,
  loadWorkCards,
  mergeWorkCards,
  openWorkFile,
  pickWorkFolder,
  runWorkCards,
  saveWorkCards,
  watchHandover,
  type CardBatch,
  type WorkCard,
} from "../services/workHandoverService";

interface WorkHandoverPageProps {
  onBack: () => void;
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function fileName(rel: string): string {
  const parts = rel.split(/[/\\]/);
  return parts[parts.length - 1] || rel;
}

export function WorkHandoverPage({ onBack }: WorkHandoverPageProps) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [batch, setBatch] = useState<CardBatch | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [note, setNote] = useState("");
  const [mergeOn, setMergeOn] = useState<number[]>([]);

  useEffect(() => {
    let stop = () => {};
    void watchHandover((item) => {
      setStep(`파일을 읽는 중 ${item.read} / ${item.total}`);
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
      setStep("파일을 읽는 중 0 / 0");
      const next = await runWorkCards(id);
      replaceBatch(next, true);
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
          {busy ? (
            <button type="button" className="btn-secondary" onClick={() => void haltWorkCards()}>
              중지
            </button>
          ) : null}
        </div>
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
                    onChange={(event) => updateTask(index, { name: event.target.value })}
                    aria-label="업무 이름"
                  />
                  <input
                    className="w-full rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-desk"
                    value={task.period}
                    onChange={(event) => updateTask(index, { period: event.target.value })}
                    aria-label="시기"
                  />
                  <p className="text-xs text-desk">확신 {task.confidence}</p>
                  {task.deadlines.length > 0 ? (
                    <ul className="space-y-0.5 text-[11px] text-quiet">
                      {task.deadlines.map((item) => (
                        <li key={`${item.file}-${item.month}-${item.day}`}>
                          {item.month}월 {item.day}일 · {fileName(item.file)}
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
                    onChange={(event) => updateTask(index, { todos: event.target.value.split("\n").slice(0, 8) })}
                    aria-label="할 일"
                    placeholder="할 일"
                  />
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
