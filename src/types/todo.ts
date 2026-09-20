export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  /** 할 날. YYYY-MM-DD. 오늘·내일 같은 상대 말은 넣지 않음. */
  dueDate?: string;
}
