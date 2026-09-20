import { useState } from "react";
import { Plus } from "lucide-react";
import { CALENDAR_SITES } from "../data/calendarSites";
import { launchQuickUrl } from "../services/launcherService";
import { dueYmdOf, localYmd, shiftYmd, shortMd } from "../services/todoDate";
import { useSettingsStore } from "../stores/settingsStore";
import { useTodoStore } from "../stores/todoStore";

const DAY_WORDS = ["오늘", "내일", "모레"] as const;

export function TodoList() {
  const todos = useTodoStore((state) => state.todos);
  const addTodo = useTodoStore((state) => state.addTodo);
  const toggleTodo = useTodoStore((state) => state.toggleTodo);
  const showCompleted = useSettingsStore((state) => state.settings.showCompletedTodos);
  const updateSettings = useSettingsStore((state) => state.update);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);
  const [showSites, setShowSites] = useState(false);

  const today = localYmd();
  const days = DAY_WORDS.map((word, offset) => {
    const ymd = shiftYmd(today, offset);
    return { word, ymd, label: `${word}(${shortMd(ymd)})` };
  });
  const selected = days[dayOffset] ?? days[0];

  const dayItems = todos.filter((todo) => {
    const due = dueYmdOf(todo.dueDate, today);
    if (selected.ymd === today) {
      return due <= today;
    }
    return due === selected.ymd;
  });
  const visible = dayItems.filter((todo) => showCompleted || !todo.completed);
  const completedCount = dayItems.filter((todo) => todo.completed).length;

  const openSite = (url: string) => {
    if (!url.startsWith("https://")) {
      return;
    }
    void launchQuickUrl(url);
  };

  return (
    <section className="zone-block bg-zone-todo">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {days.map((day, offset) => (
            <button
              key={day.ymd}
              type="button"
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ${
                offset === dayOffset ? "bg-ink-soft text-desk" : "text-quiet hover:bg-ink-soft"
              }`}
              onClick={() => setDayOffset(offset)}
            >
              {day.label}
            </button>
          ))}
        </div>
        {completedCount > 0 ? (
          <button
            type="button"
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
            onClick={() => updateSettings({ showCompletedTodos: !showCompleted })}
          >
            {showCompleted ? "완료 숨기기" : "완료 보기"}
          </button>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-quiet">이 날의 할 일이 없습니다.</p>
      ) : (
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
      )}
      {adding ? (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void addTodo(draft, selected.ymd);
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
            placeholder={`${selected.label} 할 일`}
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
      <div className="mt-1.5">
        {showSites ? (
          <div className="flex flex-wrap gap-1">
            {CALENDAR_SITES.map((site) => (
              <button
                key={site.url}
                type="button"
                className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink transition-colors duration-150 hover:bg-ink-soft"
                onClick={() => openSite(site.url)}
              >
                {site.label}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-quiet transition-colors duration-150 hover:bg-ink-soft hover:text-ink"
            onClick={() => setShowSites(true)}
          >
            캘린더 열기
          </button>
        )}
      </div>
    </section>
  );
}
