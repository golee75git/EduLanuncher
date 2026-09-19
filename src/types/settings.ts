export type LauncherPosition = "bottom-right" | "center";
export type PanelSkin = "paper" | "bright" | "dusk";
export type ListColumns = 1 | 2;

export interface AppSettings {
  autoStart: boolean;
  showWindowOnLaunch: boolean;
  launcherPosition: LauncherPosition;
  globalShortcut: string;
  favoriteCount: number;
  recentCount: number;
  showCompletedTodos: boolean;
  onboarded: boolean;
  panelSkin: PanelSkin;
  listColumns: ListColumns;
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

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: true,
  showWindowOnLaunch: false,
  launcherPosition: "bottom-right",
  globalShortcut: "Ctrl+Alt+E",
  favoriteCount: 9,
  recentCount: 5,
  showCompletedTodos: false,
  onboarded: false,
  panelSkin: "paper",
  listColumns: 1,
};
