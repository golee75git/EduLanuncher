import { create } from "zustand";
import { SAMPLE_TODOS } from "../data/sampleTodos";
import { asDueYmd, localYmd } from "../services/todoDate";
import { loadTodos, saveTodos } from "../services/storageService";
import type { TodoItem } from "../types/todo";

interface TodoState {
  todos: TodoItem[];
  loaded: boolean;
  hydrate: (todos: TodoItem[]) => void;
  seedIfEmpty: () => Promise<void>;
  addTodo: (title: string, dueDate: string) => Promise<void>;
  toggleTodo: (id: string) => Promise<void>;
  removeTodo: (id: string) => Promise<void>;
}

export const useTodoStore = create<TodoState>((set, get) => ({
  todos: [],
  loaded: false,
  hydrate: (todos) => set({ todos, loaded: true }),
  seedIfEmpty: async () => {
    if (get().todos.length > 0) {
      return;
    }
    set({ todos: SAMPLE_TODOS });
    await saveTodos(SAMPLE_TODOS);
  },
  addTodo: async (title, dueDate) => {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const dueDateYmd = asDueYmd(dueDate) ?? localYmd();
    const todos = [
      {
        id: crypto.randomUUID(),
        title: trimmed,
        completed: false,
        createdAt: new Date().toISOString(),
        dueDate: dueDateYmd,
      },
      ...get().todos,
    ];
    set({ todos });
    await saveTodos(todos);
  },
  toggleTodo: async (id) => {
    const todos = get().todos.map((todo) =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo,
    );
    set({ todos });
    await saveTodos(todos);
  },
  removeTodo: async (id) => {
    const todos = get().todos.filter((todo) => todo.id !== id);
    set({ todos });
    await saveTodos(todos);
  },
}));

export async function hydrateTodos(): Promise<void> {
  const todos = await loadTodos();
  useTodoStore.getState().hydrate(todos);
}
