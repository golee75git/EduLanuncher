import type { TodoItem } from "../types/todo";

export const SAMPLE_TODOS: TodoItem[] = [
  {
    id: "todo-ap",
    title: "OO초 AP 점검",
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "todo-cctv",
    title: "CCTV 점검 결과 보고",
    completed: false,
    createdAt: new Date().toISOString(),
  },
];
