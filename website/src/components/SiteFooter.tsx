import { SITE_CONFIG } from "../config";

export function SiteFooter() {
  return (
    <footer className="border-t border-line/80 py-6 text-center text-xs text-quiet">
      <p>{SITE_CONFIG.displayName} · Windows 데스크톱 앱</p>
    </footer>
  );
}
