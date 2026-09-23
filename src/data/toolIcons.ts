import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  Camera,
  File,
  FileText,
  Folder,
  Globe,
  GraduationCap,
  Mic,
  Monitor,
  Network,
  School,
  Settings,
  Sheet,
  Star,
  Wallet,
  Wrench,
} from "lucide-react";

export const TOOL_ICON_MAP: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  graduation: GraduationCap,
  wallet: Wallet,
  fileText: FileText,
  file: File,
  sheet: Sheet,
  network: Network,
  camera: Camera,
  mic: Mic,
  globe: Globe,
  folder: Folder,
  school: School,
  settings: Settings,
  star: Star,
  monitor: Monitor,
  wrench: Wrench,
};

export const TOOL_ICON_OPTIONS = [
  { id: "briefcase", label: "업무" },
  { id: "graduation", label: "학사" },
  { id: "wallet", label: "재무" },
  { id: "fileText", label: "문서" },
  { id: "file", label: "파일" },
  { id: "sheet", label: "엑셀" },
  { id: "network", label: "네트워크" },
  { id: "camera", label: "CCTV" },
  { id: "mic", label: "음성" },
  { id: "globe", label: "웹" },
  { id: "folder", label: "폴더" },
  { id: "school", label: "학교" },
  { id: "monitor", label: "프로그램" },
  { id: "wrench", label: "도구" },
] as const;

export function asLocalPngIcon(value?: string): string | undefined {
  const prefix = "data:image/png;base64,";
  if (!value || value.length > 40_000) {
    return undefined;
  }
  const lower = value.slice(0, prefix.length).toLowerCase();
  if (lower !== prefix) {
    return undefined;
  }
  const payload = value.slice(prefix.length);
  if (!payload || /[^A-Za-z0-9+/=]/.test(payload)) {
    return undefined;
  }
  return `${prefix}${payload}`;
}

export function getToolIcon(name?: string): LucideIcon {
  if (!name) {
    return Wrench;
  }
  return TOOL_ICON_MAP[name] ?? Wrench;
}
