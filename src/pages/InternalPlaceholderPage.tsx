import { ArrowLeft } from "lucide-react";

interface InternalPlaceholderPageProps {
  title: string;
  onBack: () => void;
}

export function InternalPlaceholderPage({ title, onBack }: InternalPlaceholderPageProps) {
  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold text-desk">{title}</h1>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="card-surface max-w-xs p-5 text-center">
          <p className="text-sm font-medium text-desk">{title}</p>
          <p className="mt-2 text-sm leading-6 text-quiet">
            이 기능은 향후 단계에서 연결됩니다. V0.1에서는 실행 위치만 안내합니다.
          </p>
        </div>
      </div>
    </div>
  );
}
