import { useState } from "react";
import type { CheckItem } from "../services/manualShelf";
import { canonicalWorkId, checklistToShow, resetChecks, toggleCheck, toggleFavorite } from "../services/manualShelf";
import { useManualShelf } from "../services/useManualShelf";

export function StarButton({ id, title }: { id: string; title: string }) {
  const shelf = useManualShelf();
  const on = shelf.favorite(id);
  return (
    <button
      type="button"
      className="no-print inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      aria-pressed={on}
      aria-label={on ? `${title} 즐겨찾기 해제` : `${title} 즐겨찾기에 추가`}
      onClick={() => toggleFavorite(id)}
    >
      <span aria-hidden="true">{on ? "★" : "☆"}</span>
    </button>
  );
}

export function PrintButton() {
  return (
    <button
      type="button"
      className="no-print inline-flex min-h-11 items-center rounded-lg border border-line bg-card px-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      onClick={() => window.print()}
    >
      인쇄 / PDF 저장
    </button>
  );
}

export function ManualChecklist({ workId, items }: { workId: string; items: CheckItem[] }) {
  const ready = checklistToShow(items);
  const shelf = useManualShelf();
  if (ready.length === 0) return null;
  const checked = new Set((shelf.checks[canonicalWorkId(workId)] ?? []).filter((id) => ready.some((item) => item.id === id)));
  return (
    <section className="space-y-2" aria-label="확인할 항목">
      <h2 className="text-sm font-medium text-desk">확인할 항목</h2>
      <p className="text-sm text-quiet">화면의 체크는 이 브라우저에만 남으며, 실제 결재나 업무 완료를 뜻하지 않습니다.</p>
      <p className="text-sm text-desk">
        {checked.size} / {ready.length}
      </p>
      <ul className="space-y-1">
        {ready.map((item) => (
          <li key={item.id}>
            <label className="flex min-h-11 items-center gap-2 text-sm text-desk">
              <input
                type="checkbox"
                checked={checked.has(item.id)}
                onChange={() => toggleCheck(workId, item.id)}
              />
              <span className="break-words">{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="inline-flex min-h-11 items-center text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        onClick={() => resetChecks(workId)}
      >
        체크 초기화
      </button>
    </section>
  );
}

export function ShelfPanels({
  rows,
}: {
  rows: Array<{ id: string; title: string; href: string; meta: string }>;
}) {
  const shelf = useManualShelf();
  const favorites = shelf.favorites
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is { id: string; title: string; href: string; meta: string } => Boolean(row));
  const recent = shelf.recent
    .map((row) => rows.find((item) => item.id === row.id))
    .filter((row): row is { id: string; title: string; href: string; meta: string } => Boolean(row));
  return (
    <div className="no-print grid gap-4 md:grid-cols-2">
      <ShelfList
        title="즐겨찾기"
        empty="저장된 즐겨찾기가 없습니다."
        rows={favorites}
        onRemove={shelf.toggleFavorite}
        removeName={(workTitle) => `즐겨찾기 목록에서 ${workTitle} 삭제`}
        onClear={shelf.clearFavorites}
        clearLabel="즐겨찾기 전체 삭제"
      />
      <ShelfList
        title="최근 본 업무"
        empty="최근 본 업무가 없습니다."
        rows={recent}
        onRemove={shelf.removeRecent}
        removeName={(workTitle) => `최근 본 업무에서 ${workTitle} 삭제`}
        onClear={shelf.clearRecent}
        clearLabel="최근 업무 전체 삭제"
      />
    </div>
  );
}

function ShelfList({
  title,
  empty,
  rows,
  onRemove,
  removeName,
  onClear,
  clearLabel,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; title: string; href: string; meta: string }>;
  onRemove: (id: string) => void;
  removeName: (workTitle: string) => string;
  onClear: () => void;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-lg border border-line bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-desk">
          {title} {rows.length}건
        </h2>
        <button
          type="button"
          className="inline-flex min-h-11 items-center px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "접기" : "펼치기"}
        </button>
      </div>
      {open ? (
        rows.length === 0 ? (
          <p className="mt-2 text-sm text-quiet">{empty}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-2">
                <a className="min-w-0 break-words text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink" href={row.href}>
                  <span className="block">{row.title}</span>
                  <span className="block text-xs text-quiet">{row.meta}</span>
                </a>
                <button
                  type="button"
                  className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  aria-label={removeName(row.title)}
                  onClick={() => onRemove(row.id)}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {rows.length > 0 ? (
        <button
          type="button"
          className="mt-2 inline-flex min-h-11 items-center text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          onClick={onClear}
        >
          {clearLabel}
        </button>
      ) : null}
    </section>
  );
}
