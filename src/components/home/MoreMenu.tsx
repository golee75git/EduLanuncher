import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface MoreMenuProps {
  onLaunch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function MoreMenu({ onLaunch, onEdit, onDelete }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-quiet transition-colors duration-150 hover:bg-desk/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        aria-label="더보기"
        title="더보기"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div className="card-surface absolute right-0 top-8 z-20 min-w-28 overflow-hidden py-1 text-sm shadow-pop" role="menu">
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink-soft/60"
            onClick={() => {
              setOpen(false);
              onLaunch();
            }}
          >
            실행
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left transition-colors duration-150 hover:bg-ink-soft/60"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            편집
          </button>
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-red-700 transition-colors duration-150 hover:bg-red-50"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            빼기
          </button>
        </div>
      ) : null}
    </div>
  );
}
