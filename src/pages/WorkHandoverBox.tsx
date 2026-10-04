import { useMemo, useState } from "react";
import { useMemoStore } from "../stores/memoStore";
import { useToolStore } from "../stores/toolStore";
import type { ToolType } from "../types/tool";
import { pickSaveFile } from "../services/savePick";
import {
  checkHandoverFile,
  handoverBoxName,
  handoverPrivacySpots,
  localTargetPresent,
  openWorkFile,
  pickWorkFolder,
  saveWorkCards,
  writeHandoverBox,
  type BoxLink,
  type CardBatch,
  type ExportDraft,
  type HandoverBox,
  type PrivacySpot,
} from "../services/workHandoverService";

function fileName(rel: string): string {
  const parts = rel.split(/[/\\]/);
  return parts[parts.length - 1] || rel;
}

function thisMonth(): number {
  return new Date().getMonth() + 1;
}

function nextMonth(month: number): number {
  return month === 12 ? 1 : month + 1;
}

export function HandoverExport({ batch, folderId, onClose }: { batch: CardBatch; folderId: string | null; onClose: () => void }) {
  const tools = useToolStore((state) => state.tools);
  const memoText = useMemoStore((state) => state.text);
  const notes = useMemoStore((state) => state.notes);
  const [pickedTools, setPickedTools] = useState<string[]>([]);
  const [includeFolder, setIncludeFolder] = useState(false);
  const [pickedMemos, setPickedMemos] = useState<string[]>([]);
  const [remark, setRemark] = useState("");
  const [spots, setSpots] = useState<PrivacySpot[] | null>(null);
  const [keep, setKeep] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  const memoChoices = useMemo(() => {
    const rows: { id: string; text: string }[] = [];
    if (memoText.trim()) {
      rows.push({ id: "pad", text: memoText });
    }
    for (const note of notes) {
      if (note.text.trim()) {
        rows.push({ id: note.id, text: note.text });
      }
    }
    return rows;
  }, [memoText, notes]);

  function draft(): ExportDraft {
    return {
      folder_id: folderId ?? "",
      include_folder: includeFolder,
      note: remark,
      batch,
      shortcuts: tools
        .filter((tool) => pickedTools.includes(tool.id) && tool.type !== "internal")
        .map((tool) => ({ name: tool.name, type: tool.type, target: tool.target })),
      memos: memoChoices.filter((item) => pickedMemos.includes(item.id)).map((item) => item.text),
      keep,
    };
  }

  async function review() {
    setMessage("");
    try {
      const found = await handoverPrivacySpots(draft());
      setSpots(found);
      setKeep([]);
      if (found.length === 0) {
        await store(draft());
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인계 박스를 만들지 못했습니다.");
    }
  }

  async function store(body: ExportDraft) {
    const name = await handoverBoxName(folderId ?? "").catch(() => "업무인계.edupack");
    const card = await pickSaveFile("pack", name);
    if (!card) {
      return;
    }
    await writeHandoverBox(card.id, body);
    setMessage("인계 박스를 저장했습니다.");
  }

  return (
    <div className="space-y-2 rounded-lg border border-line p-2">
      <p className="text-xs text-desk">넘길 항목을 고릅니다. 기본은 모두 꺼져 있습니다.</p>
      <label className="flex items-center gap-2 text-xs text-desk">
        <input type="checkbox" checked={includeFolder} onChange={(event) => setIncludeFolder(event.target.checked)} />
        업무 폴더 표시
      </label>
      <div className="max-h-28 space-y-1 overflow-auto">
        {tools.filter((tool) => tool.type !== "internal").map((tool) => (
          <label key={tool.id} className="flex items-center gap-2 text-xs text-desk">
            <input
              type="checkbox"
              checked={pickedTools.includes(tool.id)}
              onChange={(event) =>
                setPickedTools((current) => (event.target.checked ? [...current, tool.id] : current.filter((id) => id !== tool.id)))
              }
            />
            {tool.name}
            {tool.type === "url" ? "" : " · 경로 확인 필요"}
          </label>
        ))}
        {memoChoices.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-xs text-desk">
            <input
              type="checkbox"
              checked={pickedMemos.includes(item.id)}
              onChange={(event) =>
                setPickedMemos((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))
              }
            />
            메모 {item.text.slice(0, 24)}
          </label>
        ))}
      </div>
      <textarea
        className="min-h-16 w-full rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-desk"
        value={remark}
        onChange={(event) => setRemark(event.target.value.slice(0, 400))}
        placeholder="전임자 한마디"
        aria-label="전임자 한마디"
      />
      {spots && spots.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-desk">개인정보로 보이는 항목입니다. 기본은 가려서 넣기입니다.</p>
          {spots.map((spot) => (
            <div key={spot.key} className="text-xs text-desk">
              {spot.label} · {spot.kind}
              <label className="ml-2">
                <input
                  type="radio"
                  name={spot.key}
                  checked={!keep.includes(spot.key)}
                  onChange={() => setKeep((current) => current.filter((key) => key !== spot.key))}
                />{" "}
                가려서 넣기
              </label>
              <label className="ml-2">
                <input
                  type="radio"
                  name={spot.key}
                  checked={keep.includes(spot.key)}
                  onChange={() => setKeep((current) => (current.includes(spot.key) ? current : [...current, spot.key]))}
                />{" "}
                그대로 넣기
              </label>
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={() => void store(draft()).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "저장하지 못했습니다."))}>
            저장
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => void review()}>
          인계 박스 저장
        </button>
      )}
      <button type="button" className="btn-secondary" onClick={onClose}>
        닫기
      </button>
      {message ? <p className="text-xs text-desk">{message}</p> : null}
    </div>
  );
}

export function HandoverReceive({ box, onBack }: { box: HandoverBox; onBack: () => void }) {
  const [folderId, setFolderId] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>(box.cards.map((card) => card.note ?? ""));
  const [fileNote, setFileNote] = useState<Record<string, string>>({});
  const [pickedLinks, setPickedLinks] = useState<number[]>([]);
  const [pickedMemos, setPickedMemos] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const month = thisMonth();
  const follow = nextMonth(month);
  const near = box.cards.filter((card) => card.months.includes(month) || card.months.includes(follow));
  const shortcuts = box.shortcuts ?? [];
  const memos = box.memos ?? [];

  function asBatch(): CardBatch {
    return {
      file_count: box.cards.reduce((sum, card) => sum + card.files.length, 0),
      model: box.model,
      tasks: box.cards.map((card, index) => ({
        name: card.name,
        ai_open: card.ai_open,
        months: card.months,
        period: card.period,
        confidence: card.confidence,
        years: [],
        deadlines: card.deadlines,
        todos: card.todos,
        todo_open: card.todo_open ?? [],
        orgs: card.orgs,
        org_open: card.org_open ?? [],
        files: card.files.map((file) => ({ rel: file.rel, modified: "", clues: [] })),
        include: true,
        successor_note: notes[index] ?? "",
      })),
    };
  }

  async function openEvidence(rel: string, hash: string) {
    if (!folderId) {
      setMessage("업무 폴더를 고르면 같은 위치의 파일을 엽니다.");
      return;
    }
    try {
      const state = await checkHandoverFile(folderId, rel, hash);
      if (state !== "same") {
        setFileNote((current) => ({ ...current, [rel]: state }));
        return;
      }
      await openWorkFile(folderId, rel);
      setFileNote((current) => ({ ...current, [rel]: "" }));
    } catch (error) {
      setFileNote((current) => ({ ...current, [rel]: error instanceof Error ? error.message : "파일을 열지 못했습니다." }));
    }
  }

  async function addLinks() {
    const store = useToolStore.getState();
    let added = 0;
    let skipped = 0;
    for (const index of pickedLinks) {
      const link = shortcuts[index];
      if (!link) {
        continue;
      }
      if (store.tools.some((tool) => tool.type === link.type && tool.target === link.target)) {
        skipped += 1;
        continue;
      }
      if (link.type !== "url") {
        const present = await localTargetPresent(link.target);
        if (!present && !window.confirm(`${link.name}은 이 PC에 없습니다. 그래도 넣을까요?`)) {
          continue;
        }
      }
      await store.addTool({
        id: crypto.randomUUID(),
        name: link.name,
        type: link.type as ToolType,
        target: link.target,
        origin: "local",
      });
      added += 1;
    }
    setMessage(`바로가기 ${added}개를 넣었습니다. 같은 대상 ${skipped}개는 건너뛰었습니다.`);
    setPickedLinks([]);
  }

  async function addMemos() {
    const store = useMemoStore.getState();
    let added = 0;
    for (const index of pickedMemos) {
      const text = memos[index];
      if (!text) {
        continue;
      }
      const note = store.addNote();
      if (!note) {
        setMessage("메모를 더 넣을 수 없습니다.");
        break;
      }
      store.updateNote(note.id, { text });
      added += 1;
    }
    await store.persist();
    setMessage(`메모 ${added}개를 넣었습니다.`);
    setPickedMemos([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" className="btn-secondary" onClick={onBack}>
          뒤로
        </button>
        <h1 className="text-sm font-semibold text-desk">인계 박스</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
        <p className="text-xs leading-5 text-desk">전임자 한마디: {box.note?.trim() || "없음"}</p>
        <p className="text-[11px] text-quiet">만든 날짜 {box.made_at} · 모델 {box.model?.trim() || "없음"}</p>
        {box.folder ? (
          <p className="text-xs text-desk">
            업무 폴더 {box.folder.name} · 경로 확인 필요
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void pickWorkFolder().then((id) => {
                if (id) {
                  setFolderId(id);
                  setMessage("업무 폴더를 골랐습니다. 같은 상대 위치와 해시인 파일만 엽니다.");
                }
              });
            }}
          >
            업무 폴더 고르기
          </button>
          <button type="button" className="btn-secondary" onClick={() => void saveWorkCards(folderId ?? "", asBatch()).then(() => setMessage("저장했습니다.")).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "저장하지 못했습니다."))}>
            저장
          </button>
          <button type="button" className="btn-secondary" onClick={() => setExporting(true)}>
            새 인계 박스
          </button>
        </div>
        {exporting ? <HandoverExport batch={asBatch()} folderId={folderId} onClose={() => setExporting(false)} /> : null}
        <section className="space-y-1">
          <h2 className="text-xs font-medium text-desk">이번 달 업무</h2>
          {near.length === 0 ? <p className="text-[11px] text-quiet">이번 달과 다음 달에 해당하는 카드가 없습니다.</p> : null}
          {near.map((card) => (
            <p key={`near-${card.name}`} className="text-xs text-desk">
              {card.name} · {card.period}
            </p>
          ))}
        </section>
        <div className="grid grid-cols-3 gap-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((item) => (
            <div key={item} className="rounded-lg border border-line p-1.5">
              <p className="text-[11px] font-medium text-desk">{item}월</p>
              {box.cards.filter((card) => card.months.includes(item)).map((card) => (
                <p key={`${item}-${card.name}`} className="text-[10px] text-desk">
                  {card.name}
                </p>
              ))}
            </div>
          ))}
        </div>
        {box.cards.map((card, index) => (
          <article key={`${card.name}-${index}`} className="space-y-1 rounded-lg border border-line p-2">
            <p className="text-xs font-medium text-desk">
              {card.name} · {card.confidence}
              {card.ai_open ? " · AI 제안" : ""}
            </p>
            <p className="text-[11px] text-quiet">{card.period}</p>
            {card.deadlines.map((item) => (
              <p key={`${item.file}-${item.month}-${item.day}`} className="text-[11px] text-quiet">
                {item.month}월 {item.day}일 · {fileName(item.file)} · {item.snippet}
                {item.from_model ? " · AI 제안" : ""}
              </p>
            ))}
            {card.todos.map((todo, todoIndex) => (
              <p key={`${todo}-${todoIndex}`} className="text-[11px] text-quiet">
                {todo}
                {card.todo_open?.[todoIndex] ? " · AI 제안" : ""}
              </p>
            ))}
            {card.orgs.map((org, orgIndex) => (
              <p key={`${org}-${orgIndex}`} className="text-[11px] text-quiet">
                {org}
                {card.org_open?.[orgIndex] ? " · AI 제안" : ""}
              </p>
            ))}
            {card.files.map((file) => (
              <p key={file.rel} className="text-[11px] text-desk">
                {file.rel}{" "}
                <button type="button" className="underline" onClick={() => void openEvidence(file.rel, file.hash)}>
                  열기
                </button>
                {fileNote[file.rel] ? ` ${fileNote[file.rel]}` : ""}
              </p>
            ))}
            <textarea
              className="min-h-14 w-full rounded-lg border border-line bg-transparent px-2 py-1 text-xs text-desk"
              value={notes[index] ?? ""}
              onChange={(event) => setNotes((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value.slice(0, 400) : item)))}
              placeholder="후임자 메모"
              aria-label="후임자 메모"
            />
          </article>
        ))}
        {shortcuts.length > 0 ? (
          <section className="space-y-1">
            <h2 className="text-xs font-medium text-desk">바로가기</h2>
            {shortcuts.map((link, index) => (
              <LinkRow key={`${link.target}-${index}`} link={link} index={index} picked={pickedLinks} setPicked={setPickedLinks} />
            ))}
            <button type="button" className="btn-secondary" onClick={() => void addLinks()}>
              고른 바로가기 넣기
            </button>
          </section>
        ) : null}
        {memos.length > 0 ? (
          <section className="space-y-1">
            <h2 className="text-xs font-medium text-desk">메모</h2>
            {memos.map((text, index) => (
              <label key={`${text.slice(0, 12)}-${index}`} className="flex items-center gap-2 text-xs text-desk">
                <input
                  type="checkbox"
                  checked={pickedMemos.includes(index)}
                  onChange={(event) =>
                    setPickedMemos((current) => (event.target.checked ? [...current, index] : current.filter((item) => item !== index)))
                  }
                />
                {text.slice(0, 40)}
              </label>
            ))}
            <button type="button" className="btn-secondary" onClick={() => void addMemos()}>
              고른 메모 넣기
            </button>
          </section>
        ) : null}
        {message ? <p className="text-xs text-desk">{message}</p> : null}
      </div>
    </div>
  );
}

function LinkRow({ link, index, picked, setPicked }: { link: BoxLink; index: number; picked: number[]; setPicked: (value: number[]) => void }) {
  const needsPath = link.type !== "url";
  return (
    <label className="flex items-center gap-2 text-xs text-desk">
      <input
        type="checkbox"
        checked={picked.includes(index)}
        onChange={(event) => setPicked(event.target.checked ? [...picked, index] : picked.filter((item) => item !== index))}
      />
      {link.name}
      {needsPath ? " · 경로 확인 필요" : ""}
    </label>
  );
}
