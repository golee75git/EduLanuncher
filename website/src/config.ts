export const SITE_CONFIG = {
  appName: "AILauncher",
  displayName: "AI런처",
  githubRepo: "https://github.com/golee75git/EduLanuncher",
  releasesUrl: "https://github.com/golee75git/EduLanuncher/releases/latest",
  version: "0.1.177-20261005",
  setupFile: "AILauncher_0.1.177-20261005_x64-setup.exe",
  setupFileDated: "AILauncher_2026-10-05_1205_x64-setup.exe",
  setupDownloadUrl:
    "https://github.com/golee75git/EduLanuncher/releases/download/0.1.177-20261005/AILauncher_0.1.177-20261005_x64-setup.exe",
} as const;

export type SiteView = "intro" | "menu" | "preview" | "download" | "opinion" | "manage";

export function pathToView(pathname: string): SiteView {
  if (pathname === "/menu" || pathname.startsWith("/menu/")) return "menu";
  if (pathname === "/preview" || pathname.startsWith("/preview/")) return "preview";
  if (pathname === "/download" || pathname.startsWith("/download/")) return "download";
  if (pathname === "/opinion" || pathname.startsWith("/opinion/")) return "opinion";
  if (pathname === "/manage" || pathname.startsWith("/manage/")) return "manage";
  return "intro";
}

export function viewToPath(view: SiteView): string {
  if (view === "menu") return "/menu";
  if (view === "preview") return "/preview";
  if (view === "download") return "/download";
  if (view === "opinion") return "/opinion";
  if (view === "manage") return "/manage";
  return "/";
}
