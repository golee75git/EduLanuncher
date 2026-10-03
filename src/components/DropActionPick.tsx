import { dropFileLabel } from "../services/dropActionPick";
import type { GrantedFile } from "../services/dropSiteService";

export interface DropPlaceLine {
  id: string;
  name: string;
  place: string;
}

interface DropActionPickProps {
  pictures: GrantedFile[];
  pdfs: GrantedFile[];
  places: DropPlaceLine[];
  siteLabel: string;
  packLabel: string;
  onMosaic: () => void;
  onShrink: () => void;
  onQr: () => void;
  onPdf: () => void;
  onShortcut: () => void;
  onPlaces: () => void;
  onSite: () => void;
  onPack: () => void;
  onClose: () => void;
}

function names(files: GrantedFile[]): string {
  const shown = files.slice(0, 3).map((file) => dropFileLabel(file.name));
  const extra = files.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} 외 ${extra}개` : shown.join(", ");
}

export function DropActionPick({
  pictures,
  pdfs,
  places,
  siteLabel,
  packLabel,
  onMosaic,
  onShrink,
  onQr,
  onPdf,
  onShortcut,
  onPlaces,
  onSite,
  onPack,
  onClose,
}: DropActionPickProps) {
  const hasTools = pictures.length > 0 || pdfs.length > 0;
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-desk/25 p-3">
      <div className="card-surface max-h-[80%] w-full space-y-2 overflow-y-auto p-3">
        <p className="text-sm font-semibold text-desk">넣을 곳 확인</p>
        <p className="text-xs leading-5 text-quiet">넣기를 누르기 전에는 저장하지 않습니다.</p>
        {pictures.length > 0 ? <p className="truncate text-xs text-quiet">사진 {names(pictures)}</p> : null}
        {pdfs.length > 0 ? <p className="truncate text-xs text-quiet">PDF {names(pdfs)}</p> : null}
        {places.map((line) => (
          <p key={line.id} className="truncate text-xs text-desk">
            {line.name} · {line.place}
          </p>
        ))}
        {siteLabel ? <p className="truncate text-xs text-desk">{siteLabel} · 사이트</p> : null}
        {packLabel ? <p className="truncate text-xs text-desk">{packLabel} · Pack</p> : null}
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
          {hasTools ? (
            <button type="button" className="btn-secondary !bg-zone-notice hover:!bg-zone-notice" onClick={onShortcut}>
              바로가기로 두기
            </button>
          ) : null}
          {places.length > 0 ? (
            <button type="button" className="btn-secondary !bg-zone-notice hover:!bg-zone-notice" onClick={onPlaces}>
              {hasTools ? "다른 항목 넣기" : "넣기"}
            </button>
          ) : null}
          {siteLabel ? (
            <button type="button" className="btn-secondary !bg-zone-notice hover:!bg-zone-notice" onClick={onSite}>
              사이트에 넣기
            </button>
          ) : null}
          {packLabel ? (
            <button type="button" className="btn-secondary !bg-zone-todo hover:!bg-zone-todo" onClick={onPack}>
              Pack 가져오기
            </button>
          ) : null}
          <button type="button" className="btn-secondary !bg-zone-alert hover:!bg-zone-alert" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
