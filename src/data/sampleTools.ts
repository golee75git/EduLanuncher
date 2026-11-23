import type { ToolItem } from "../types/tool";

export const URL_MARK_TOOL: ToolItem = {
  id: "tool-url-mark",
  name: "QR코드 넣기",
  description: "그림 오른쪽 아래에 주소 QR코드를 넣습니다",
  type: "internal",
  target: "url-mark",
  icon: "globe",
  category: "전산",
  favorite: true,
  keywords: ["qr", "QR", "주소", "그림", "png", "무늬"],
  usageCount: 0,
  enabled: true,
};

export const DOC_SHRINK_TOOL: ToolItem = {
  id: "tool-doc-shrink",
  name: "사진 용량 줄이기",
  description: "큰 사진을 문서에 알맞은 크기로 줄여 문서 용량을 줄입니다",
  type: "internal",
  target: "doc-shrink",
  icon: "file",
  category: "전산",
  favorite: true,
  keywords: ["사진", "문서", "용량"],
  usageCount: 0,
  enabled: true,
};

export const PDF_PAGES_TOOL: ToolItem = {
  id: "tool-pdf-pages",
  name: "PDF 도구",
  description: "PDF를 합치고, 나누고, 페이지를 간단하게 정리합니다",
  type: "internal",
  target: "pdf-pages",
  icon: "fileText",
  category: "전산",
  favorite: true,
  keywords: ["pdf", "PDF", "합치기", "나누기", "페이지"],
  usageCount: 0,
  enabled: true,
};

export function isPdfPagesTarget(target: string): boolean {
  return target === PDF_PAGES_TOOL.target || target === PDF_PAGES_TOOL.id;
}

export const EXCEL_MERGE_TOOL: ToolItem = {
  id: "tool-excel-merge",
  name: "엑셀 취합",
  description: "같은 양식으로 받은 엑셀·csv 여러 개를 하나의 새 엑셀로 합칩니다",
  type: "internal",
  target: "excel-merge",
  icon: "sheet",
  category: "전산",
  favorite: true,
  keywords: ["엑셀", "xlsx", "csv", "통합", "취합", "합치기", "excel"],
  usageCount: 0,
  enabled: true,
};

export function isExcelMergeTarget(target: string): boolean {
  return target === EXCEL_MERGE_TOOL.target || target === EXCEL_MERGE_TOOL.id;
}

export const EXCEL_JOIN_TOOL: ToolItem = {
  id: "tool-excel-join",
  name: "엑셀 값 채우기",
  description: "같은 키의 빈 칸에 다른 엑셀이나 글자 PDF의 열 값을 넣어 새 파일로 저장합니다",
  type: "internal",
  target: "excel-join",
  icon: "sheet",
  category: "전산",
  favorite: true,
  keywords: ["엑셀", "xlsx", "csv", "pdf", "값 채우기", "학교명", "맞추기", "excel"],
  usageCount: 0,
  enabled: true,
};

export function isExcelJoinTarget(target: string): boolean {
  return target === EXCEL_JOIN_TOOL.target || target === EXCEL_JOIN_TOOL.id;
}

export const PDF_SHEET_TOOL: ToolItem = {
  id: "tool-pdf-sheet",
  name: "PDF를 엑셀로",
  description: "글자가 있는 PDF를 표로 읽어 새 엑셀로 저장합니다",
  type: "internal",
  target: "pdf-sheet",
  icon: "fileText",
  category: "전산",
  favorite: true,
  keywords: ["pdf", "PDF", "엑셀", "xlsx", "엑셀로 저장"],
  usageCount: 0,
  enabled: true,
};

export function isPdfSheetTarget(target: string): boolean {
  return target === PDF_SHEET_TOOL.target || target === PDF_SHEET_TOOL.id;
}

export const TIMER_TOOL: ToolItem = {
  id: "tool-timer",
  name: "타이머·스톱워치",
  description: "카운트다운 타이머와 스톱워치. 구간 이름과 메모를 CSV·엑셀로 저장합니다. 끝나면 소리와 함께 패널이 열립니다",
  type: "internal",
  target: "timer",
  icon: "timer",
  category: "전산",
  favorite: true,
  keywords: ["타이머", "스톱워치", "카운트다운", "시간", "알람", "초시계", "timer", "stopwatch"],
  usageCount: 0,
  enabled: true,
};

export function isTimerTarget(target: string): boolean {
  return target === TIMER_TOOL.target || target === TIMER_TOOL.id;
}

export const PHOTO_CAPTION_TOOL: ToolItem = {
  id: "tool-photo-caption",
  name: "사진에 글자",
  description: "사진에 글자와 배경색을 넣어 새 파일로 저장합니다",
  type: "internal",
  target: "photo-caption",
  icon: "fileText",
  category: "전산",
  favorite: true,
  keywords: ["사진", "글자", "문구", "배경"],
  usageCount: 0,
  enabled: true,
};

export const PRIVACY_MASK_TOOL: ToolItem = {
  id: "tool-privacy-mask",
  name: "사진 모자이크",
  description: "사진 속 얼굴·번호·문자를 가리고 안전하게 저장합니다",
  type: "internal",
  target: "privacy-mask",
  icon: "eyeOff",
  category: "전산",
  favorite: true,
  keywords: ["사진", "개인정보", "가리기", "얼굴", "번호"],
  usageCount: 0,
  enabled: true,
};

export const SAMPLE_TOOLS: ToolItem[] = [
  {
    id: "tool-portal",
    name: "업무포털",
    description: "교육청 업무포털",
    type: "url",
    target: "",
    icon: "briefcase",
    category: "행정",
    favorite: true,
    keywords: ["포털", "행정", "업무"],
    usageCount: 0,
    enabled: true,
  },
  {
    id: "tool-neis",
    name: "나이스 바로가기",
    description: "나이스 학사행정",
    type: "url",
    target: "",
    icon: "graduation",
    category: "행정",
    favorite: true,
    keywords: ["나이스", "학사", "neis"],
    usageCount: 0,
    enabled: true,
  },
  {
    id: "tool-edufine",
    name: "에듀파인 바로가기",
    description: "교육재무 시스템",
    type: "url",
    target: "",
    icon: "wallet",
    category: "행정",
    favorite: true,
    keywords: ["에듀파인", "재무", "회계"],
    usageCount: 0,
    enabled: true,
  },
  {
    id: "tool-hwpx",
    name: "HWPX",
    description: "한글 문서 도구",
    type: "file",
    target: "",
    icon: "fileText",
    category: "문서",
    favorite: true,
    keywords: ["한글", "hwpx", "hwp", "문서"],
    usageCount: 0,
    enabled: true,
  },
  {
    id: "tool-pdf",
    name: "PDF",
    description: "PDF 문서 도구",
    type: "file",
    target: "",
    icon: "file",
    category: "문서",
    favorite: true,
    keywords: ["pdf", "문서"],
    usageCount: 0,
    enabled: true,
  },
  {
    id: "tool-excel",
    name: "스프레드시트",
    description: "스프레드시트 파일 열기",
    type: "file",
    target: "",
    icon: "sheet",
    category: "문서",
    favorite: true,
    keywords: ["엑셀", "excel", "xlsx", "spreadsheet"],
    usageCount: 0,
    enabled: true,
  },
  {
    id: "tool-network",
    name: "Network",
    description: "IPv4 계산 · 구간 검색 · 공인 IP",
    type: "internal",
    target: "network",
    icon: "network",
    category: "전산",
    favorite: true,
    keywords: ["네트워크", "구성도", "회선", "ip", "mac", "공인", "nat", "검색"],
    usageCount: 0,
    enabled: true,
  },
  {
    id: "tool-cctv",
    name: "CCTV",
    description: "현재 망 CCTV 확인",
    type: "internal",
    target: "cctv",
    icon: "camera",
    category: "시설",
    favorite: true,
    keywords: ["씨씨티비", "카메라", "점검"],
    usageCount: 0,
    enabled: true,
  },
  {
    id: "tool-voicestamp",
    name: "VoiceStamp",
    description: "음성 기록 도구",
    type: "internal",
    target: "voicestamp",
    icon: "mic",
    category: "학교지원",
    favorite: true,
    keywords: ["보이스", "음성", "녹음"],
    usageCount: 0,
    enabled: true,
  },
  URL_MARK_TOOL,
];

export const COMMON_WORK_TOOLS: ToolItem[] = [
  PRIVACY_MASK_TOOL,
  PHOTO_CAPTION_TOOL,
  DOC_SHRINK_TOOL,
  URL_MARK_TOOL,
  PDF_PAGES_TOOL,
  PDF_SHEET_TOOL,
  EXCEL_MERGE_TOOL,
  EXCEL_JOIN_TOOL,
  TIMER_TOOL,
];
