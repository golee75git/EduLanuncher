import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { dueYmdOf, localYmd, shortMd } from "../services/todoDate";
import { hydrateTodos, useTodoStore } from "../stores/todoStore";
import { showPanel } from "../services/windowService";

export function DeskMiniPage() {
  const todos = useTodoStore((state) => state.todos);
  const today = localYmd();
  const leftover = todos.filter((todo) => dueYmdOf(todo.dueDate, today) <= today && !todo.completed).length;

  useEffect(() => {
    const unlisten = listen("todos-changed", () => {
      void hydrateTodos();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper px-3 py-2">
      <p className="text-[11px] text-quiet">오늘({shortMd(today)})</p>
      <p className="mt-1 text-[15px] font-semibold text-desk">
        {leftover > 0 ? `남은 할 일 ${leftover}건` : "오늘 할 일이 없습니다."}
      </p>
      <button type="button" className="btn-primary mt-auto" onClick={() => void showPanel()}>
        런처 열기
      </button>
    </div>
  );
}
