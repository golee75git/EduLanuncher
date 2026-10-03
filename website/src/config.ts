export const SITE_CONFIG = {
  appName: "EduLauncher",
  displayName: "교육업무 런처",
  githubRepo: "https://github.com/golee75git/EduLanuncher",
  releasesUrl: "https://github.com/golee75git/EduLanuncher/releases/latest",
  version: "0.1.162-20261003",
  setupFile: "EduLauncher_0.1.162-20261003_x64-setup.exe",
  setupFileDated: "EduLauncher_2026-10-03_1230_x64-setup.exe",
  setupDownloadUrl:
    "https://github.com/golee75git/EduLanuncher/releases/download/0.1.162-20261003/EduLauncher_0.1.162-20261003_x64-setup.exe",
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
