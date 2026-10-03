import type { ToolItem, ToolType } from "../types/tool";

const SYSTEM32 = "C:\\Windows\\System32";

export interface ComputerToolEntry {
  id: string;
  name: string;
  hint: string;
  type: Extract<ToolType, "app" | "file" | "internal">;
  fileName?: string;
  view?: "pc-address" | "ie-reset" | "pc-folder-find" | "doc-shrink" | "pc-link" | "pc-print" | "pc-security" | "privacy-scan";
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
    id: "sound",
    name: "소리",
    hint: "스피커와 마이크 화면을 엽니다.",
    type: "file",
    fileName: "mmsys.cpl",
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
    id: "pc-link",
    name: "인터넷 연결 점검",
    hint: "인터넷이 안 될 때 현재 PC의 연결 상태를 단계별로 확인합니다.",
    type: "internal",
    view: "pc-link",
  },
  {
    id: "pc-print",
    name: "프린터 출력 점검",
    hint: "프린터 출력이 안 될 때 현재 PC의 프린터 상태를 단계별로 확인합니다.",
    type: "internal",
    view: "pc-print",
  },
  {
    id: "pc-security",
    name: "보안 상태 점검",
    hint: "이 PC의 업데이트, 백신, 방화벽 등 기본 보안 상태를 확인합니다.",
    type: "internal",
    view: "pc-security",
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
    id: "task-manager",
    name: "작업 관리자",
    hint: "실행 중인 프로그램 화면을 엽니다. 종료는 Windows가 맡습니다.",
    type: "file",
    fileName: "taskmgr.exe",
  },
  {
    id: "control-panel",
    name: "제어판",
    hint: "이 PC Windows 제어판을 엽니다.",
    type: "file",
    fileName: "control.exe",
  },
  {
    id: "internet-options",
    name: "인터넷 옵션",
    hint: "인터넷 속성 화면을 엽니다. 확인 전에는 바꾸지 않습니다.",
    type: "file",
    fileName: "inetcpl.cpl",
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
    id: "privacy-scan",
    name: "개인정보 보호",
    hint: "PC의 파일에서 개인정보 포함 가능성을 확인하고 안전한 파일 공유를 도와줍니다.",
    type: "internal",
    view: "privacy-scan",
  },
  {
    id: "doc-shrink",
    name: "사진 용량 줄이기",
    hint: "큰 사진을 문서에 알맞은 크기로 줄여 문서 용량을 줄입니다.",
    type: "internal",
    view: "doc-shrink",
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

export function isDocShrinkTool(entry: ComputerToolEntry): boolean {
  return entry.view === "doc-shrink";
}

export function isDocShrinkTarget(target: string): boolean {
  return target === "doc-shrink" || target === "pc-sys:doc-shrink";
}

const LINK_WORDS = [
  "인터넷 연결 점검",
  "인터넷 안돼",
  "인터넷이 안돼요",
  "인터넷 안됨",
  "인터넷 연결",
  "인터넷 점검",
  "인터넷 오류",
  "네트워크 안돼",
  "네트워크 오류",
  "와이파이 안돼",
  "Wi-Fi 안됨",
  "랜선 연결",
  "인터넷 끊김",
  "인터넷 연결 확인",
  "인터넷 문제",
  "웹사이트가 안열려",
  "홈페이지가 안열려",
  "DNS 오류",
];

export function isLinkCheckTool(entry: ComputerToolEntry): boolean {
  return entry.view === "pc-link";
}

export function isLinkCheckTarget(target: string): boolean {
  return target === "pc-link" || target === "pc-sys:pc-link";
}

const PRINT_WORDS = [
  "프린터 출력 점검",
  "프린터 안돼",
  "프린터가 안돼",
  "프린터 안됨",
  "인쇄 안돼",
  "인쇄가 안돼",
  "출력 안돼",
  "출력이 안돼",
  "문서 출력 안됨",
  "프린터 먹통",
  "인쇄 오류",
  "프린터 오류",
  "프린터 오프라인",
  "출력이 안나와",
  "인쇄가 안나와",
  "프린터 점검",
  "프린터 확인",
  "인쇄 대기",
  "인쇄 멈춤",
];

export function isPrintCheckTool(entry: ComputerToolEntry): boolean {
  return entry.view === "pc-print";
}

export function isPrintCheckTarget(target: string): boolean {
  return target === "pc-print" || target === "pc-sys:pc-print";
}

const SECURITY_WORDS = [
  "보안 상태 점검",
  "보안 점검",
  "보안 상태",
  "백신",
  "바이러스",
  "방화벽",
  "윈도우 업데이트",
  "업데이트 확인",
  "화면 잠금",
  "공유 폴더",
  "내 PC 보안",
];

export function isSecurityCheckTool(entry: ComputerToolEntry): boolean {
  return entry.view === "pc-security";
}

export function isSecurityCheckTarget(target: string): boolean {
  return target === "pc-security" || target === "pc-sys:pc-security";
}

const PRIVACY_WORDS = [
  "개인정보 보호",
  "개인정보",
  "개인정보 유출",
  "파일 개인정보",
  "메일 보내기 전 확인",
  "개인정보 검사",
  "개인정보 확인",
  "개인정보 점검",
  "주민번호",
  "주민등록번호",
  "명단 확인",
  "게시 전 확인",
  "올리기 전 확인",
];

export function isPrivacyTool(entry: ComputerToolEntry): boolean {
  return entry.view === "privacy-scan";
}

export function isPrivacyTarget(target: string): boolean {
  return target === "privacy-scan" || target === "pc-sys:privacy-scan";
}

export function listComputerTools(): ComputerToolEntry[] {
  return ENTRIES;
}

export function computerToolAsItem(entry: ComputerToolEntry): ToolItem {
  if (isAddressTool(entry) || isIeResetTool(entry) || isFolderFindTool(entry) || isDocShrinkTool(entry) || isLinkCheckTool(entry) || isPrintCheckTool(entry) || isSecurityCheckTool(entry) || isPrivacyTool(entry)) {
    const target = isIeResetTool(entry)
      ? "ie-reset"
      : isFolderFindTool(entry)
        ? "pc-folder-find"
        : isDocShrinkTool(entry)
          ? "doc-shrink"
          : isLinkCheckTool(entry)
            ? "pc-link"
            : isPrintCheckTool(entry)
              ? "pc-print"
              : isSecurityCheckTool(entry)
                ? "pc-security"
              : isPrivacyTool(entry)
                ? "privacy-scan"
                : "pc-address";
    return {
      id: `pc-sys:${entry.id}`,
      name: entry.name,
      description: entry.hint,
      type: "internal",
      target,
      icon: isPrivacyTool(entry) || isSecurityCheckTool(entry) ? "shield" : isPrintCheckTool(entry) ? "printer" : isLinkCheckTool(entry) ? "globe" : isDocShrinkTool(entry) ? "file" : "folder",
      category: "전산",
      favorite: true,
      keywords: isLinkCheckTool(entry)
        ? LINK_WORDS
        : isPrintCheckTool(entry)
          ? PRINT_WORDS
          : isSecurityCheckTool(entry)
            ? SECURITY_WORDS
          : isPrivacyTool(entry)
            ? PRIVACY_WORDS
        : isDocShrinkTool(entry)
        ? [entry.name, "컴퓨터도구", "사진", "문서", "용량"]
        : isFolderFindTool(entry)
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
