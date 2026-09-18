import type { ToolItem } from "../types/tool";

interface MissingPathDialogProps {
  message: string;
  tool?: ToolItem;
  onRetarget: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function MissingPathDialog({
  message,
  tool,
  onRetarget,
  onDelete,
  onClose,
}: MissingPathDialogProps) {
  const canRetarget = tool && (tool.type === "file" || tool.type === "folder" || tool.type === "app");

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-desk/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm p-4 shadow-pop">
        <h3 className="text-base font-semibold text-desk">실행할 수 없습니다</h3>
        <p className="mt-2 text-sm leading-6 text-quiet">{message}</p>
        {tool?.target ? (
          <p className="mt-2 break-all rounded-lg bg-paper px-2 py-1.5 text-xs text-quiet">
            {tool.target}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {canRetarget ? (
            <button
              type="button"
              className="rounded-lg bg-ink px-3 py-2 text-sm text-white shadow-card transition-colors duration-150 hover:bg-ink-strong"
              onClick={onRetarget}
            >
              경로 다시 지정
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-ink px-3 py-2 text-sm text-white shadow-card transition-colors duration-150 hover:bg-ink-strong"
              onClick={onRetarget}
            >
              편집
            </button>
          )}
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm text-red-700 transition-colors duration-150 hover:bg-red-50"
            onClick={onDelete}
          >
            삭제
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm text-desk transition-colors duration-150 hover:bg-paper"
            onClick={onClose}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
