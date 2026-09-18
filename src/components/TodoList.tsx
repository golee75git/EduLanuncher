import { Plus } from "lucide-react";
import { useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useTodoStore } from "../stores/todoStore";

export function TodoList() {
  const todos = useTodoStore((state) => state.todos);
  const addTodo = useTodoStore((state) => state.addTodo);
  const toggleTodo = useTodoStore((state) => state.toggleTodo);
  const showCompleted = useSettingsStore((state) => state.settings.showCompletedTodos);
  const updateSettings = useSettingsStore((state) => state.update);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const visible = todos.filter((todo) => showCompleted || !todo.completed);
  const completedCount = todos.filter((todo) => todo.completed).length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="desk-label mb-0">오늘 할 일</h2>
        {completedCount > 0 ? (
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
            onClick={() => updateSettings({ showCompletedTodos: !showCompleted })}
          >
            {showCompleted ? "완료 숨기기" : "완료 보기"}
          </button>
        ) : null}
      </div>
      <ul className="space-y-0.5">
        {visible.map((todo) => (
          <li key={todo.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm transition-colors duration-150 hover:bg-card">
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id)}
                className="h-4 w-4 rounded border-line"
              />
              <span className={todo.completed ? "text-quiet line-through" : "text-desk"}>
                {todo.title}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void addTodo(draft);
            setDraft("");
            setAdding(false);
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (!draft.trim()) {
                setAdding(false);
              }
            }}
            placeholder="할 일을 입력하세요"
            className="field-input mt-0 h-9"
          />
        </form>
      ) : (
        <button
          type="button"
          className="mt-2 flex items-center gap-1 rounded-full py-0.5 pr-2 text-sm text-ink transition-colors duration-150 hover:bg-ink-soft"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-4 w-4" />
          할 일 추가
        </button>
      )}
    </section>
  );
}
