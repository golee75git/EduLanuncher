export type ShortcutRunId = "explorer" | "taskmgr" | "snip" | "settings" | "lock";

export interface ShortcutEntry {
  id: string;
  keys: string;
  name: string;
  hint: string;
  runId?: ShortcutRunId;
}

const ENTRIES: ShortcutEntry[] = [
  {
    id: "win-e",
    keys: "Win + E",
    name: "파일 탐색기",
    hint: "이 PC Windows 탐색기를 엽니다.",
    runId: "explorer",
  },
  {
    id: "win-l",
    keys: "Win + L",
    name: "화면 잠금",
    hint: "이 PC를 잠급니다. 다시 쓰려면 Windows에 로그인합니다.",
    runId: "lock",
  },
  {
    id: "win-d",
    keys: "Win + D",
    name: "바탕 화면 보기",
    hint: "열려 있는 창을 숨기고 바탕 화면을 봅니다. 키로만 됩니다.",
  },
  {
    id: "win-i",
    keys: "Win + I",
    name: "Windows 설정",
    hint: "이 PC Windows 설정 화면을 엽니다.",
    runId: "settings",
  },
  {
    id: "win-r",
    keys: "Win + R",
    name: "실행 창",
    hint: "프로그램 이름이나 경로를 적어 실행합니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-shift-esc",
    keys: "Ctrl + Shift + Esc",
    name: "작업 관리자",
    hint: "실행 중인 프로그램 화면을 엽니다.",
    runId: "taskmgr",
  },
  {
    id: "win-shift-s",
    keys: "Win + Shift + S",
    name: "화면 캡처",
    hint: "화면 일부를 잘라 저장하는 화면을 엽니다.",
    runId: "snip",
  },
  {
    id: "alt-tab",
    keys: "Alt + Tab",
    name: "창 전환",
    hint: "열린 프로그램 창을 고릅니다. 키로만 됩니다.",
  },
  {
    id: "win-arrow",
    keys: "Win + ← / →",
    name: "창 맞추기",
    hint: "창을 화면 왼쪽이나 오른쪽에 맞춥니다. 키로만 됩니다.",
  },
  {
    id: "alt-f4",
    keys: "Alt + F4",
    name: "창 닫기",
    hint: "지금 쓰는 창을 닫습니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-c",
    keys: "Ctrl + C",
    name: "복사",
    hint: "선택한 글이나 파일을 복사합니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-v",
    keys: "Ctrl + V",
    name: "붙여넣기",
    hint: "복사한 내용을 붙입니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-x",
    keys: "Ctrl + X",
    name: "잘라내기",
    hint: "선택한 내용을 잘라 둡니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-z",
    keys: "Ctrl + Z",
    name: "실행 취소",
    hint: "방금 한 일을 되돌립니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-a",
    keys: "Ctrl + A",
    name: "전체 선택",
    hint: "글이나 파일을 모두 고릅니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-s",
    keys: "Ctrl + S",
    name: "저장",
    hint: "작업 중인 문서를 저장합니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-p",
    keys: "Ctrl + P",
    name: "인쇄",
    hint: "인쇄 화면을 엽니다. 키로만 됩니다.",
  },
  {
    id: "ctrl-f",
    keys: "Ctrl + F",
    name: "찾기",
    hint: "문서나 페이지에서 글을 찾습니다. 키로만 됩니다.",
  },
  {
    id: "f5",
    keys: "F5",
    name: "새로 고침",
    hint: "목록이나 누리집을 다시 불러옵니다. 키로만 됩니다.",
  },
  {
    id: "win-v",
    keys: "Win + V",
    name: "클립보드 기록",
    hint: "최근에 복사한 목록을 봅니다. 키로만 됩니다.",
  },
];

export function listShortcuts(): ShortcutEntry[] {
  return ENTRIES;
}

export function canRunShortcut(entry: ShortcutEntry): boolean {
  return Boolean(entry.runId);
}
