export type LauncherPosition = "bottom-right" | "center";

export interface AppSettings {
  autoStart: boolean;
  showWindowOnLaunch: boolean;
  launcherPosition: LauncherPosition;
  globalShortcut: string;
  favoriteCount: number;
  recentCount: number;
  showCompletedTodos: boolean;
  onboarded: boolean;
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
};
