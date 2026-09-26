import { useEffect, useState } from "react";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import { pathToView, type SiteView } from "./config";
import { DownloadPage } from "./pages/DownloadPage";
import { IntroPage } from "./pages/IntroPage";
import { ManagePage } from "./pages/ManagePage";
import { OpinionPage } from "./pages/OpinionPage";
import { PreviewPage } from "./pages/PreviewPage";

function isInternalPath(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export default function App() {
  const [view, setView] = useState<SiteView>(() => pathToView(window.location.pathname));

  useEffect(() => {
    const applyPath = (pathname: string) => {
      setView(pathToView(pathname));
      window.scrollTo(0, 0);
    };

    const onPop = () => applyPath(window.location.pathname);
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const pathname = isInternalPath(anchor.href);
      if (!pathname) return;
      event.preventDefault();
      if (pathname !== window.location.pathname) {
        window.history.pushState({}, "", pathname);
      }
      applyPath(pathname);
    };

    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader view={view} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        {view === "intro" ? <IntroPage /> : null}
        {view === "preview" ? <PreviewPage /> : null}
        {view === "download" ? <DownloadPage /> : null}
        {view === "opinion" ? <OpinionPage /> : null}
        {view === "manage" ? <ManagePage /> : null}
      </main>
      <SiteFooter />
    </div>
  );
}
