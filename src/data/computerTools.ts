import type { ToolItem, ToolType } from "../types/tool";

const SYSTEM32 = "C:\\Windows\\System32";

export interface ComputerToolEntry {
  id: string;
  name: string;
  hint: string;
  type: Extract<ToolType, "app" | "file">;
  fileName: string;
}

const ENTRIES: ComputerToolEntry[] = [
  {
    id: "rename-pc",
    name: "컴퓨터 이름 바꾸기",
    hint: "이 PC 이름을 바꾸는 화면을 엽니다. 저장과 재시작은 Windows가 맡습니다.",
    type: "file",
    fileName: "SystemPropertiesComputerName.exe",
  },
  {
    id: "display",
    name: "화면 설정",
    hint: "해상도와 화면 배치 화면을 엽니다.",
    type: "file",
    fileName: "desk.cpl",
  },
  {
    id: "devices",
    name: "장치 확인",
    hint: "이 PC에 연결된 장치 목록을 엽니다.",
    type: "file",
    fileName: "devmgmt.msc",
  },
  {
    id: "net-links",
    name: "네트워크 연결",
    hint: "네트워크 어댑터 연결 화면을 엽니다.",
    type: "file",
    fileName: "ncpa.cpl",
  },
  {
    id: "clock",
    name: "날짜와 시간",
    hint: "시계와 표준시 화면을 엽니다.",
    type: "file",
    fileName: "timedate.cpl",
  },
  {
    id: "programs",
    name: "설치된 프로그램",
    hint: "이 PC에 설치된 프로그램 목록을 엽니다.",
    type: "file",
    fileName: "appwiz.cpl",
  },
];

function system32Path(fileName: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) {
    throw new Error("허용되지 않은 파일명입니다.");
  }
  return `${SYSTEM32}\\${fileName}`;
}

export function computerToolPath(entry: ComputerToolEntry): string {
  return system32Path(entry.fileName);
}

export function listComputerTools(): ComputerToolEntry[] {
  return ENTRIES;
}

export function computerToolAsItem(entry: ComputerToolEntry): ToolItem {
  return {
    id: `pc-sys:${entry.id}`,
    name: entry.name,
    description: entry.hint,
    type: entry.type,
    target: computerToolPath(entry),
    icon: "monitor",
    category: "전산",
    favorite: true,
    keywords: [entry.name, "컴퓨터도구"],
    usageCount: 0,
    enabled: true,
    origin: "local",
  };
}

export function sameLocalPath(left: string, right: string): boolean {
  return left.replace(/\//g, "\\").trim().toLowerCase() === right.replace(/\//g, "\\").trim().toLowerCase();
}
