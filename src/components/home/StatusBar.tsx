import { APP_CONFIG } from "../../config/app";
import { launchQuickUrl } from "../../services/launcherService";

const opinionSiteUrl = `${APP_CONFIG.siteUrl}#opinion`;

function openOpinionSite() {
  void launchQuickUrl(opinionSiteUrl).catch(() => {
    window.open(opinionSiteUrl, "_blank", "noopener,noreferrer");
  });
}

export function OpinionLink() {
  return (
    <button type="button" className="underline" onClick={openOpinionSite}>
      개선의견
    </button>
  );
}

export function StatusBar() {
  return (
    <div className="mx-auto w-full max-w-[600px] shrink-0 bg-paper px-7 pb-2 text-[10px] text-quiet">
      <p className="text-right">
        {APP_CONFIG.displayName} · 준비됨 <OpinionLink />
      </p>
    </div>
  );
}
