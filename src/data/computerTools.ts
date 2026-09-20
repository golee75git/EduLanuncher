import type { ToolItem, ToolType } from "../types/tool";

const SYSTEM32 = "C:\\Windows\\System32";

export interface ComputerToolEntry {
  id: string;
  name: string;
  hint: string;
  type: Extract<ToolType, "app" | "file" | "internal">;
  fileName?: string;
  view?: "pc-address" | "ie-reset" | "pc-folder-find";
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
    id: "pc-address",
    name: "이 PC IP 주소",
    hint: "사설 IP 주소와 공인 IP 주소만 봅니다.",
    type: "internal",
    view: "pc-address",
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
  {
    id: "control-panel",
    name: "제어판",
    hint: "이 PC Windows 제어판을 엽니다.",
    type: "file",
    fileName: "control.exe",
  },
  {
    id: "ie-reset",
    name: "익스플로러 설정 복원",
    hint: "설정을 되돌리는 Windows 확인 화면을 엽니다. 확인 전에는 바꾸지 않습니다.",
    type: "internal",
    view: "ie-reset",
  },
  {
    id: "pc-folder-find",
    name: "이 PC 폴더 찾기",
    hint: "바탕화면·문서·다운로드에서 이름을 찾습니다. 내용은 읽지 않습니다.",
    type: "internal",
    view: "pc-folder-find",
  },
  {
    id: "pc-info",
    name: "시스템 정보",
    hint: "이 PC 하드웨어·Windows 정보 화면을 엽니다.",
    type: "file",
    fileName: "msinfo32.exe",
  },
];

function system32Path(fileName: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) {
    throw new Error("허용되지 않은 파일명입니다.");
  }
  return `${SYSTEM32}\\${fileName}`;
}

export function computerToolPath(entry: ComputerToolEntry): string {
  if (!entry.fileName) {
    return "";
  }
  return system32Path(entry.fileName);
}

export function isAddressTool(entry: ComputerToolEntry): boolean {
  return entry.view === "pc-address";
}

export function isIeResetTool(entry: ComputerToolEntry): boolean {
  return entry.view === "ie-reset";
}

export function isIeResetTarget(target: string): boolean {
  return target === "ie-reset" || target === "pc-sys:ie-reset";
}

export function isFolderFindTool(entry: ComputerToolEntry): boolean {
  return entry.view === "pc-folder-find";
}

export function isFolderFindTarget(target: string): boolean {
  return target === "pc-folder-find" || target === "pc-sys:pc-folder-find";
}

export function listComputerTools(): ComputerToolEntry[] {
  return ENTRIES;
}

export function computerToolAsItem(entry: ComputerToolEntry): ToolItem {
  if (isAddressTool(entry) || isIeResetTool(entry) || isFolderFindTool(entry)) {
    const target = isIeResetTool(entry)
      ? "ie-reset"
      : isFolderFindTool(entry)
        ? "pc-folder-find"
        : "pc-address";
    return {
      id: `pc-sys:${entry.id}`,
      name: entry.name,
      description: entry.hint,
      type: "internal",
      target,
      icon: "folder",
      category: "전산",
      favorite: true,
      keywords: isFolderFindTool(entry)
        ? [entry.name, "컴퓨터도구", "문서", "다운로드", "바탕"]
        : isIeResetTool(entry)
          ? [entry.name, "컴퓨터도구", "익스플로러", "인터넷"]
          : [entry.name, "컴퓨터도구", "아이피", "ip"],
      usageCount: 0,
      enabled: true,
      origin: "local",
    };
  }
  return {
    id: `pc-sys:${entry.id}`,
    name: entry.name,
    description: entry.hint,
    type: entry.type === "app" ? "app" : "file",
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
