import { dropFileLabel } from "../services/dropActionPick";

interface DropActionPickProps {
  pictures: string[];
  pdfs: string[];
  onMosaic: () => void;
  onShrink: () => void;
  onQr: () => void;
  onPdf: () => void;
  onShortcut: () => void;
  onClose: () => void;
}

function names(paths: string[]): string {
  const shown = paths.slice(0, 3).map(dropFileLabel);
  const extra = paths.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} 외 ${extra}개` : shown.join(", ");
}

export function DropActionPick({
  pictures,
  pdfs,
  onMosaic,
  onShrink,
  onQr,
  onPdf,
  onShortcut,
  onClose,
}: DropActionPickProps) {
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-desk/25 p-3">
      <div className="card-surface w-full space-y-2 p-3">
        <p className="text-sm font-semibold text-desk">이 파일로 할 일</p>
        {pictures.length > 0 ? (
          <p className="truncate text-xs text-quiet">{names(pictures)}</p>
        ) : null}
        {pdfs.length > 0 ? <p className="truncate text-xs text-quiet">{names(pdfs)}</p> : null}
        <div className="flex flex-col gap-2">
          {pictures.length === 1 ? (
            <button type="button" className="btn-secondary !bg-zone-tools hover:!bg-zone-tools" onClick={onMosaic}>
              사진 모자이크
            </button>
          ) : null}
          {pictures.length > 0 ? (
            <button type="button" className="btn-secondary !bg-zone-tools hover:!bg-zone-tools" onClick={onShrink}>
              사진 용량 줄이기
            </button>
          ) : null}
          {pictures.length === 1 ? (
            <button type="button" className="btn-secondary !bg-zone-tools hover:!bg-zone-tools" onClick={onQr}>
              QR코드 넣기
            </button>
          ) : null}
          {pdfs.length > 0 ? (
            <button type="button" className="btn-secondary !bg-zone-recent hover:!bg-zone-recent" onClick={onPdf}>
              PDF 도구
            </button>
          ) : null}
          <button type="button" className="btn-secondary !bg-zone-notice hover:!bg-zone-notice" onClick={onShortcut}>
            바로가기로 두기
          </button>
          <button type="button" className="btn-secondary !bg-zone-alert hover:!bg-zone-alert" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
