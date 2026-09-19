import type { ToolItem } from "../types/tool";

interface RemoveToolDialogProps {
  tool: ToolItem;
  onConfirm: () => void;
  onClose: () => void;
}

export function RemoveToolDialog({ tool, onConfirm, onClose }: RemoveToolDialogProps) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-desk/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm p-4 shadow-pop">
        <h3 className="text-base font-semibold text-desk">이 바로가기를 삭제할까요?</h3>
        <p className="mt-2 text-sm font-medium text-desk">{tool.name}</p>
        <p className="mt-2 text-sm leading-6 text-quiet">
          런처 목록에서만 빠집니다. 이 PC의 프로그램·파일·사이트는 그대로입니다. 홈에서만 안 보이게 하려면 별을
          끄면 됩니다.
        </p>
        {tool.origin === "pack" ? (
          <p className="mt-2 text-xs leading-5 text-quiet">
            Pack에서 온 항목은 바로가기 Pack을 다시 가져오면 돌아올 수 있습니다.
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm text-desk transition-colors duration-150 hover:bg-paper"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm text-red-700 transition-colors duration-150 hover:bg-red-50"
            onClick={onConfirm}
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
