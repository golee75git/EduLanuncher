import { useEffect, useMemo, useState } from "react";
import {
  loadEducationMindMap,
  relatedTopicIds,
  topicsMissingFromMindMap,
} from "../services/mindMapService";
import { getTopicById, getTopics } from "../services/topicService";
import { MANUAL_KIND_LABEL, type ManualKind } from "../types/manual";
import type { MindMapNode } from "../types/mindmap";
import { MindMapReviewBadge } from "./MindMapReviewBadge";
import { StatusBadge } from "./StatusBadge";

interface WorkMapListProps {
  onOpen: (topicId: string) => void;
}

interface Row {
  node: MindMapNode;
  depth: number;
}

function collectVisible(nodes: MindMapNode[], open: Set<string>, depth: number): Row[] {
  const rows: Row[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.children.length > 0 && open.has(node.id)) {
      rows.push(...collectVisible(node.children, open, depth + 1));
    }
  }
  return rows;
}

export function WorkMapList({ onOpen }: WorkMapListProps) {
  const map = useMemo(() => loadEducationMindMap(), []);
  const missing = useMemo(() => topicsMissingFromMindMap(getTopics()), []);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(map.roots.map((node) => node.id)));
  const [active, setActive] = useState(0);
  const rows = useMemo(() => collectVisible(map.roots, openIds, 0), [map.roots, openIds]);

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const activate = (node: MindMapNode) => {
    if (node.topicId) {
      onOpen(node.topicId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const row = rows[active];
    if (!row) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, rows.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.node.children.length > 0 && !openIds.has(row.node.id)) {
        toggle(row.node.id);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.node.children.length > 0 && openIds.has(row.node.id)) {
        toggle(row.node.id);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(row.node);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-quiet">
        항목을 누르면 자세한 업무가 열립니다. 인증서 등 매뉴얼 JSON에서 목록을 만듭니다. 그림 마인드맵은 넣지 않습니다.
      </p>
      <div role="tree" tabIndex={0} className="space-y-0.5 outline-none" onKeyDown={onKeyDown}>
        {rows.map((row, index) => {
          const expanded = openIds.has(row.node.id);
          const related = relatedTopicIds(row.node.id, map)
            .map((id) => getTopicById(id))
            .filter((item) => item && item.id !== row.node.topicId);
          return (
            <div key={row.node.id} style={{ paddingLeft: row.depth * 12 }}>
              <div
                role="treeitem"
                aria-expanded={row.node.children.length > 0 ? expanded : undefined}
                aria-selected={index === active}
                className={`flex items-start gap-1 rounded-md px-1 py-1 ${
                  index === active ? "bg-ink-soft/70" : ""
                }`}
              >
                {row.node.children.length > 0 ? (
                  <button
                    type="button"
                    className="mt-0.5 w-5 shrink-0 text-[11px] text-quiet"
                    aria-label={expanded ? "접기" : "펼치기"}
                    onClick={() => toggle(row.node.id)}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="mt-0.5 w-5 shrink-0" />
                )}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => activate(row.node)}
                >
                  <span className="block text-sm text-desk">{row.node.label}</span>
                  <span className="mt-0.5 flex flex-wrap gap-2">
                    {row.node.kind && row.node.kind in MANUAL_KIND_LABEL ? (
                      <span className="text-[11px] text-quiet">
                        {MANUAL_KIND_LABEL[row.node.kind as ManualKind]}
                      </span>
                    ) : null}
                    {row.node.topicId ? (
                      <StatusBadge
                        status={getTopicById(row.node.topicId)?.status ?? "unknown"}
                        needsReview={getTopicById(row.node.topicId)?.needsReview}
                      />
                    ) : null}
                    <MindMapReviewBadge show={row.node.needsReview} />
                  </span>
                </button>
              </div>
              {related.length > 0 && expanded ? (
                <div className="ml-6 mb-1 space-y-0.5">
                  {related.map((topic) =>
                    topic ? (
                      <button
                        key={topic.id}
                        type="button"
                        className="block text-[11px] text-ink"
                        onClick={() => onOpen(topic.id)}
                      >
                        관련: {topic.title}
                      </button>
                    ) : null,
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <section>
        <h2 className="desk-label">마인드맵 미포함 업무</h2>
        <p className="mb-1 text-xs text-quiet">검색과 전체 목록에는 그대로 있습니다.</p>
        <ul className="space-y-1">
          {missing.map((topic) => (
            <li key={topic.id}>
              <button type="button" className="desk-row" onClick={() => onOpen(topic.id)}>
                <span className="min-w-0 flex-1 truncate text-sm">{topic.title}</span>
                <StatusBadge status={topic.status} needsReview={topic.needsReview} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
