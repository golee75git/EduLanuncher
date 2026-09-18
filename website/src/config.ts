export const SITE_CONFIG = {
  appName: "EduLauncher",
  displayName: "교육업무 런처",
  githubRepo: "https://github.com/golee75git/EduLanuncher",
  releasesUrl: "https://github.com/golee75git/EduLanuncher/releases/latest",
} as const;

export type SiteView = "intro" | "preview" | "download";

export function pathToView(pathname: string): SiteView {
  if (pathname === "/preview" || pathname.startsWith("/preview/")) return "preview";
  if (pathname === "/download" || pathname.startsWith("/download/")) return "download";
  return "intro";
}

export function viewToPath(view: SiteView): string {
  if (view === "preview") return "/preview";
  if (view === "download") return "/download";
  return "/";
}
