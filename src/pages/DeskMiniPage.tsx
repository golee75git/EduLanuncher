import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { dueYmdOf, localYmd, shortMd } from "../services/todoDate";
import { useTodoStore } from "../stores/todoStore";
import { showPanel } from "../services/windowService";
import type { TodoItem } from "../types/todo";

export function DeskMiniPage() {
  const todos = useTodoStore((state) => state.todos);
  const today = localYmd();
  const leftover = todos.filter((todo) => dueYmdOf(todo.dueDate, today) <= today && !todo.completed).length;

  useEffect(() => {
    let dropped = false;
    let stop: (() => void) | undefined;
    void (async () => {
      const unlisten = await listen<TodoItem[]>("todos-changed", (event) => {
        if (Array.isArray(event.payload)) {
          useTodoStore.getState().hydrate(event.payload);
        }
      });
      if (dropped) {
        unlisten();
        return;
      }
      stop = unlisten;
      void emit("desk-mini-ready");
    })();
    return () => {
      dropped = true;
      stop?.();
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
