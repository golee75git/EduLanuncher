import { launchQuickUrl } from "../services/launcherService";
import type { TopicResource } from "../types/topic";
import { SourceBadge } from "./SourceBadge";
import { StatusBadge } from "./StatusBadge";

interface ResourceCardProps {
  resource: TopicResource;
}

export function ResourceCard({ resource }: ResourceCardProps) {
  const audit = resource.type === "audit";
  const openSource = () => {
    if (!resource.url) {
      return;
    }
    void launchQuickUrl(resource.url);
  };

  return (
    <article className={`rounded-lg border border-line/70 p-2.5 ${audit ? "bg-zone-alert" : "bg-card"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge type={resource.type} />
        <StatusBadge status={resource.status} needsReview={resource.needsReview} />
      </div>
      <h3 className="mt-1.5 text-sm font-medium text-desk">{resource.title}</h3>
      {resource.summary ? <p className="mt-1 text-xs leading-5 text-quiet">{resource.summary}</p> : null}
      {resource.organization ? (
        <p className="mt-1 text-[11px] text-quiet">{resource.organization}</p>
      ) : null}
      {resource.publishedAt ? (
        <p className="text-[11px] text-quiet">{resource.publishedAt}</p>
      ) : null}
      {resource.document ? <p className="text-[11px] text-quiet">{resource.document}</p> : null}
      {resource.pages ? <p className="text-[11px] text-quiet">원문 {resource.pages}</p> : null}
      {resource.url ? (
        <button
          type="button"
          className="mt-2 text-[11px] font-medium text-ink"
          onClick={openSource}
        >
          원문 보기
        </button>
      ) : (
        <p className="mt-2 text-[11px] text-quiet">원문 링크 미등록</p>
      )}
    </article>
  );
}
