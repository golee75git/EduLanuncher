export type LauncherPosition = "bottom-right" | "center";
export type PanelSkin = "paper" | "bright" | "dusk";
export type ListColumns = 1 | 2;
export type GridColumns = 1 | 2 | 3;

export const PANEL_SIZE = {
  defaultWidth: 440,
  defaultHeight: 650,
  minWidth: 400,
  minHeight: 550,
  maxWidth: 720,
  maxHeight: 900,
} as const;

/** 이 너비 이상이면 홈·모두(2열 설정) 목록을 3열로 둔다. */
export const LIST_THREE_COL_MIN_WIDTH = 560;

export const MEMO_SIZE = {
  defaultWidth: 440,
  defaultHeight: 650,
  minWidth: 280,
  minHeight: 400,
  maxWidth: 720,
  maxHeight: 900,
} as const;

export interface AppSettings {
  autoStart: boolean;
  showWindowOnLaunch: boolean;
  launcherPosition: LauncherPosition;
  globalShortcut: string;
  favoriteCount: number;
  recentCount: number;
  showCompletedTodos: boolean;
  hideEmptySearchGroups: boolean;
  onboarded: boolean;
  panelSkin: PanelSkin;
  listColumns: ListColumns;
  panelWidth: number;
  panelHeight: number;
  memoWidth: number;
  memoHeight: number;
}

export const PANEL_SKIN_OPTIONS: Array<{ id: PanelSkin; label: string; hint: string }> = [
  { id: "paper", label: "서류", hint: "차가운 회색 바탕" },
  { id: "bright", label: "밝은 화면", hint: "따뜻한 서류색 바탕" },
  { id: "dusk", label: "어두운 화면", hint: "낮은 조명 바탕" },
];

export function asPanelSkin(value: unknown): PanelSkin {
  return value === "bright" || value === "dusk" ? value : "paper";
}

export function asListColumns(value: unknown): ListColumns {
  return value === 2 || value === "2" ? 2 : 1;
}

export function asPanelWidth(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return PANEL_SIZE.defaultWidth;
  }
  return Math.min(PANEL_SIZE.maxWidth, Math.max(PANEL_SIZE.minWidth, Math.round(parsed)));
}

/** 홈 자주 사용: 좁으면 2열, 넓으면 3열. */
export function homeListColumns(panelWidth: unknown): 2 | 3 {
  return asPanelWidth(panelWidth) >= LIST_THREE_COL_MIN_WIDTH ? 3 : 2;
}

/** 모두 목록: 1열 설정은 유지, 2열 설정은 너비에 따라 2·3열. */
export function allListColumns(panelWidth: unknown, preferred: ListColumns): GridColumns {
  if (preferred === 1) {
    return 1;
  }
  return homeListColumns(panelWidth);
}

export function asPanelHeight(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return PANEL_SIZE.defaultHeight;
  }
  return Math.min(PANEL_SIZE.maxHeight, Math.max(PANEL_SIZE.minHeight, Math.round(parsed)));
}

export function asMemoWidth(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return MEMO_SIZE.defaultWidth;
  }
  return Math.min(MEMO_SIZE.maxWidth, Math.max(MEMO_SIZE.minWidth, Math.round(parsed)));
}

export function asMemoHeight(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return MEMO_SIZE.defaultHeight;
  }
  return Math.min(MEMO_SIZE.maxHeight, Math.max(MEMO_SIZE.minHeight, Math.round(parsed)));
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: true,
  showWindowOnLaunch: true,
  launcherPosition: "bottom-right",
  globalShortcut: "Ctrl+Alt+E",
  favoriteCount: 9,
  recentCount: 5,
  showCompletedTodos: false,
  hideEmptySearchGroups: false,
  onboarded: false,
  panelSkin: "paper",
  listColumns: 1,
  panelWidth: PANEL_SIZE.defaultWidth,
  panelHeight: PANEL_SIZE.defaultHeight,
  memoWidth: MEMO_SIZE.defaultWidth,
  memoHeight: MEMO_SIZE.defaultHeight,
};
