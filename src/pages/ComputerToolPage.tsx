import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import {
  computerToolAsItem,
  computerToolPath,
  isAddressTool,
  isFolderFindTool,
  listComputerTools,
  sameLocalPath,
} from "../data/computerTools";
import { useToolStore } from "../stores/toolStore";
import type { ToolItem } from "../types/tool";

interface ComputerToolPageProps {
  onBack: () => void;
  onLaunch: (tool: ToolItem) => void;
  onShowAddress: () => void;
  onShowFolderFind: () => void;
}

export function ComputerToolPage({ onBack, onLaunch, onShowAddress, onShowFolderFind }: ComputerToolPageProps) {
  const tools = useToolStore((state) => state.tools);
  const addTool = useToolStore((state) => state.addTool);
  const [notice, setNotice] = useState("");

  const pinToLauncher = async (item: ToolItem) => {
    const exists =
      item.type === "internal"
        ? tools.some((tool) => tool.type === "internal" && tool.target === item.target)
        : tools.some(
            (tool) =>
              (tool.type === "app" || tool.type === "file") && sameLocalPath(tool.target, item.target),
          );
    if (exists) {
      setNotice("이미 런처 목록에 있습니다.");
      return;
    }
    await addTool({ ...item, id: crypto.randomUUID() });
    setNotice(item.type === "internal" ? "업무도구 칸에 넣었습니다." : "프로그램 또는 파일 칸에 넣었습니다.");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">컴퓨터도구</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          이 PC Windows 설정 화면을 열거나, 사설·공인 IP를 보고, 이 사용자 폴더에서 이름을 찾습니다. 익스플로러 설정
          복원 확인 화면을 엽니다. 소리·인터넷 옵션·작업 관리자 화면도 엽니다. 이름을 대신 바꾸거나 권한을 올리지
          않습니다. 설정 화면은 고정된 System32 파일만 실행합니다.
        </p>
        {notice ? <p className="text-sm text-desk">{notice}</p> : null}
        <ul className="card-surface divide-y divide-line/70">
          {listComputerTools().map((entry) => {
            const item = computerToolAsItem(entry);
            return (
              <li key={entry.id} className="flex items-center gap-1 px-2 py-1.5">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-paper"
                  onClick={() =>
                    isAddressTool(entry)
                      ? onShowAddress()
                      : isFolderFindTool(entry)
                        ? onShowFolderFind()
                        : onLaunch(item)
                  }
                >
                  <span className="block truncate text-sm font-medium text-desk">{entry.name}</span>
                  <span className="block truncate text-[11px] text-quiet" title={computerToolPath(entry) || entry.hint}>
                    {entry.hint}
                  </span>
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-ink hover:bg-ink-soft"
                  onClick={() => void pinToLauncher(item)}
                >
                  추가
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
