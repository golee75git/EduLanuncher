import { ArrowLeft } from "lucide-react";
import { MemoEditor } from "../components/MemoPad";

interface MemoPageProps {
  onBack: () => void;
}

export function MemoPage({ onBack }: MemoPageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">메모</h1>
      </header>
      <div className="min-h-0 flex-1 p-3">
        <MemoEditor large />
      </div>
    </div>
  );
}
