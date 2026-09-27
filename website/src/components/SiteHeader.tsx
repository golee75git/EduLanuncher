import { SITE_CONFIG, viewToPath, type SiteView } from "../config";

const NAV: Array<{ view: SiteView; label: string }> = [
  { view: "intro", label: "소개" },
  { view: "preview", label: "웹 미리보기" },
  { view: "download", label: "다운로드" },
  { view: "opinion", label: "의견" },
];

interface SiteHeaderProps {
  view: SiteView;
}

export function SiteHeader({ view }: SiteHeaderProps) {
  return (
    <header className="border-b border-line/80 bg-card/80">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href="/" className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink shadow-[0_0_0_3px] shadow-ink-soft" />
          <span className="truncate">
            <span className="block text-[11px] font-semibold tracking-wide text-ink">{SITE_CONFIG.appName}</span>
            <span className="block text-sm font-semibold text-desk">{SITE_CONFIG.displayName}</span>
          </span>
        </a>
        <nav className="flex items-center gap-1 text-sm" aria-label="사이트 메뉴">
          {NAV.map((item) => {
            const href = viewToPath(item.view);
            const active = view === item.view;
            return (
              <a
                key={item.view}
                href={href}
                className={`rounded-full px-3 py-1.5 ${
                  active ? "bg-ink-soft font-medium text-ink-strong" : "text-quiet hover:bg-paper hover:text-desk"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
