import type { NoticeItem } from "../types/notice";
import { NOTICE_KIND_LABEL } from "../types/notice";

interface RemoveNoticeDialogProps {
  item: NoticeItem;
  onConfirm: () => void;
  onClose: () => void;
}

export function RemoveNoticeDialog({ item, onConfirm, onClose }: RemoveNoticeDialogProps) {
  const kindLabel = NOTICE_KIND_LABEL[item.kind === "alert" ? "alert" : "org"];
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-desk/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm p-4 shadow-pop">
        <h3 className="text-base font-semibold text-desk">이 공지를 목록에서 뺄까요?</h3>
        <p className="mt-2 text-sm font-medium text-desk">{item.title}</p>
        <p className="mt-2 text-sm leading-6 text-quiet">
          런처 목록에서만 빠집니다. 원문 사이트와 Pack 파일은 그대로입니다.
        </p>
        <p className="mt-2 text-xs leading-5 text-quiet">
          {kindLabel}
          {item.origin === "pack" ? " · Pack에서 온 항목은 파일을 다시 가져와 고를 수 있습니다." : ""}
        </p>
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
            빼기
          </button>
        </div>
      </div>
    </div>
  );
}
