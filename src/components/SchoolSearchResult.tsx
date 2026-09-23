import { FileText, Mic, Wrench } from "lucide-react";
import { launchQuickUrl } from "../services/launcherService";
import type { SchoolItem } from "../types/school";
import { HighlightText } from "./HighlightText";

interface SchoolSearchResultProps {
  school: SchoolItem;
  query: string;
  onOpenInternal: (id: string, title: string) => void;
}

const SCHOOL_TASKS = [
  { id: "equipment", title: "장비", icon: Wrench },
  { id: "voicestamp", title: "VoiceStamp", icon: Mic },
  { id: "support-history", title: "지원이력", icon: FileText },
] as const;

export function SchoolSearchResult({ school, query, onOpenInternal }: SchoolSearchResultProps) {
  return (
    <article className="card-surface p-3.5">
      <h3 className="text-base font-semibold text-desk">
        <HighlightText text={school.name} query={query} />
      </h3>
      <p className="mt-1 text-xs text-quiet">
        {school.type}
        {school.address ? ` · ${school.address}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1.5 text-xs text-desk transition-colors duration-150 hover:border-ink/30 hover:bg-ink-soft/50"
          onClick={() => school.homepage && void launchQuickUrl(school.homepage)}
        >
          홈페이지
        </button>
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1.5 text-xs text-desk transition-colors duration-150 hover:border-ink/30 hover:bg-ink-soft/50"
          onClick={() => school.phone && void launchQuickUrl(`tel:${school.phone}`)}
        >
          전화
        </button>
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1.5 text-xs text-desk transition-colors duration-150 hover:border-ink/30 hover:bg-ink-soft/50"
          onClick={() =>
            school.address &&
            void launchQuickUrl(`https://map.naver.com/p/search/${encodeURIComponent(school.address)}`)
          }
        >
          지도
        </button>
      </div>
      <h4 className="desk-label mt-4">학교 업무</h4>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {SCHOOL_TASKS.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onOpenInternal(task.id, `${school.name} ${task.title}`)}
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-desk transition-colors duration-150 hover:border-ink/30 hover:bg-ink-soft"
          >
            <task.icon className="h-4 w-4 text-ink" />
            {task.title}
          </button>
        ))}
      </div>
    </article>
  );
}
