import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FieldColorIndex, FieldNav, FieldQuery, FieldTaskMap, GroupedHandbookResults, HandbookCardList, ManualPartList, linkedManual } from "../components/FieldGuide";
import { HandbookWorkGuide, PurchaseGuide, handbookOverview } from "../components/WorkGuide";
import { ManualChecklist, PrintButton, ShelfPanels, StarButton } from "../components/ManualShelfUi";
import { MenuWorkMap } from "../components/MenuWorkMap";
import { PilotManualArticle } from "../components/PilotManualArticle";
import { TopicStepBoards } from "../components/TopicStepBoards";
import {
  loadMenuData,
  pictureSteps,
  searchManual,
  section2ForTitle,
  type EpkiNode,
  type FlowNode,
  type MenuData,
  type Section2Task,
} from "../services/menuContent";
import { fieldCardState, fieldStateLabel, handbookIdForDetail, selectHandbookTopics, visibleParts } from "../services/manualField";
import { canonicalWorkId, noteVisit, shelfTarget } from "../services/manualShelf";
import { useManualShelf } from "../services/useManualShelf";

function menuPath(pathname: string): string[] {
  const path = decodeURI(pathname).replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts[0] === "menu" ? parts.slice(1) : [];
}

function FlowPicture({
  node,
  active,
  onPick,
}: {
  node: FlowNode;
  active: string;
  onPick: (label: string) => void;
}) {
  const box = "rounded-md border px-3 py-2 text-left text-sm text-desk";
  const face = active && node.pick === active ? "border-ink bg-ink-soft" : "border-line bg-card";
  const label = node.topicId ? (
    <a className={`${box} ${face} block`} href={`/menu/handbook/${encodeURIComponent(node.topicId)}`}>
      {node.label}
    </a>
  ) : node.pick ? (
    <button type="button" className={`${box} ${face}`} onClick={() => onPick(node.pick ?? "")}>
      {node.label}
    </button>
  ) : (
    <span className={`${box} block`}>{node.label}</span>
  );
  return (
    <div className="flex flex-col items-start gap-2">
      {label}
      {node.children.length > 0 ? (
        <div className="flex flex-wrap gap-4 border-l border-line pl-4">
          {node.children.map((child) => (
            <FlowPicture key={child.id} node={child} active={active} onPick={onPick} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TaskBlocks({ tasks }: { tasks: Section2Task[] }) {
  if (tasks.length === 0) {
    return <p className="text-sm leading-relaxed text-quiet">이 제목과 같은 세부업무 본문은 아직 연결되어 있지 않습니다.</p>;
  }
  return (
    <div className="space-y-6">
      {tasks.map((task) => (
        <article key={task.name} className="space-y-2">
          <h3 className="text-base font-semibold text-desk">{task.name}</h3>
          {task.body ? <p className="whitespace-pre-wrap text-sm leading-6 text-desk">{task.body}</p> : null}
          {task.tip.trim() ? (
            <p className="whitespace-pre-wrap text-sm leading-6 text-desk">
              <span className="font-medium">팁</span>
              {"\n"}
              {task.tip.trim()}
            </p>
          ) : null}
          {task.reference.trim() ? (
            <p className="whitespace-pre-wrap text-sm leading-6 text-desk">
              <span className="font-medium">참고</span>
              {"\n"}
              {task.reference.trim()}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

const EPKI_SITE = "https://www.epki.go.kr/";

function EpkiSummary({ text }: { text: string }) {
  const parts = text.split(EPKI_SITE);
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 ? (
            <a className="text-ink underline" href={EPKI_SITE} target="_blank" rel="noopener noreferrer">
              {EPKI_SITE}
            </a>
          ) : null}
        </span>
      ))}
    </>
  );
}

function epkiPicture(node: EpkiNode): FlowNode {
  return {
    id: node.id,
    label: node.title,
    pick: node.id,
    children: (node.children ?? []).map(epkiPicture),
  };
}

function findEpki(node: EpkiNode, id: string): EpkiNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findEpki(child, id);
    if (found) return found;
  }
  return null;
}

function EpkiTree({ node }: { node: EpkiNode }) {
  return (
    <article className="space-y-2">
      <h3 className="text-base font-semibold text-desk">{node.title}</h3>
      {node.summary ? <p className="whitespace-pre-wrap text-sm leading-6 text-desk">{node.summary}</p> : null}
      {node.children && node.children.length > 0 ? (
        <div className="space-y-4 border-l border-line pl-4">
          {node.children.map((child) => (
            <EpkiTree key={child.id} node={child} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

const MENU_RAIL = [
  { id: "handbook", href: "/menu/handbook", label: "편람 분류" },
  { id: "topic", href: "/menu/topic", label: "업무자료" },
  { id: "pilot", href: "/menu/pilot", label: "시범 매뉴얼" },
  { id: "epki", href: "/menu/epki", label: "인증서" },
] as const;

function MenuFrame({ section, children }: { section: string; children: ReactNode }) {
  const shelf = useManualShelf();
  return (
    <div className="grid items-start gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
      <nav aria-label="매뉴얼 구분" className="no-print flex flex-wrap gap-2 md:sticky md:top-4 md:flex-col">
        {MENU_RAIL.map((item) => {
          const current = section === item.id;
          return (
            <a
              key={item.id}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${current ? "border-ink bg-ink-soft" : "border-line bg-card"}`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="min-w-0 overflow-x-hidden">
        {shelf.warning ? (
          <p className="no-print mb-4 text-sm text-desk" role="status">
            {shelf.warning}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function withRail(section: string, body: ReactNode) {
  return <MenuFrame section={section}>{body}</MenuFrame>;
}

function MapSide({ data, topicId }: { data: MenuData; topicId: string | null }) {
  if (!topicId) {
    return <p className="text-sm text-quiet">왼쪽 상자를 누르면 여기에 내용이 나옵니다.</p>;
  }
  const row = data.topics.find((item) => item.id === topicId);
  if (row) {
    const tasks = section2ForTitle(data.section2, row.title);
    return (
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-desk">{row.title}</h3>
        <p className="text-xs text-quiet">{[row.category, row.subcategory].filter(Boolean).join(" · ")}</p>
        {row.steps && row.steps.length > 0 ? <TopicStepBoards board="glance" steps={row.steps} /> : null}
        {row.beginnerSummary ? <p className="text-sm leading-6 text-desk">{row.beginnerSummary}</p> : null}
        <TaskBlocks tasks={tasks} />
        <a className="text-sm text-ink" href={`/menu/topic/${encodeURIComponent(row.id)}`}>
          이 업무 페이지
        </a>
      </div>
    );
  }
  const manual = data.manual.find((item) => item.id === topicId);
  if (manual) {
    const parts = visibleParts(manual.parts);
    return (
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-desk">{manual.legacyLabel || manual.title}</h3>
        <p className="text-sm text-desk">검토 필요</p>
        {parts.slice(0, 1).map((part) => (
          <article key={part.id} className="space-y-2">
            <h4 className="text-sm font-semibold text-desk">{part.title}</h4>
            <p className="whitespace-pre-wrap text-sm leading-6 text-desk">{part.body}</p>
          </article>
        ))}
        <a className="text-sm text-ink" href={`/menu/topic/${encodeURIComponent(manual.id)}`}>
          이 업무 페이지
        </a>
      </div>
    );
  }
  const category = data.handbook.categories.find((item) => item.id === topicId);
  if (category) {
    return (
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-desk">{category.name}</h3>
        {category.picture ? (
          <ul className="space-y-1">
            {pictureSteps(category.picture).map((step) => (
              <li key={`${step.order}-${step.title}`}>
                {step.href ? (
                  <a className="text-sm text-ink" href={step.href}>{step.title}</a>
                ) : (
                  <span className="text-sm text-desk">{step.title}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <a className="text-sm text-ink" href={`/menu/handbook/${encodeURIComponent(category.id)}`}>
          이 분류 페이지
        </a>
      </div>
    );
  }
  const handbook = data.handbook.topics.find((item) => item.id === topicId);
  if (handbook) {
    const state = fieldCardState(handbook.id);
    const manual = state === "review" ? linkedManual(data.manual, handbook.id) : null;
    return (
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-desk">{handbook.officialName || handbook.title}</h3>
        {handbook.pages ? <p className="text-xs text-quiet">편람 목차 기준 {handbook.pages}</p> : null}
        <p className="text-sm text-desk">{fieldStateLabel(state)}</p>
        {manual ? <ManualPartList parts={manual.parts} /> : null}
        <a className="text-sm text-ink" href={`/menu/handbook/${encodeURIComponent(handbook.id)}`}>
          이 업무 페이지
        </a>
      </div>
    );
  }
  return <p className="text-sm text-quiet">이 상자는 매뉴얼 본문에 연결되어 있지 않습니다.</p>;
}

function shelfRows(data: MenuData) {
  const rows: Array<{ id: string; title: string; href: string; meta: string }> = [];
  for (const topic of data.handbook.topics) {
    if (!data.handbook.categories.some((category) => category.topicIds.includes(topic.id))) continue;
    const href = shelfTarget(topic.id);
    if (!href) continue;
    const category = data.handbook.categories.find((item) => item.id === topic.categoryId);
    rows.push({
      id: canonicalWorkId(topic.id),
      title: topic.officialName || topic.title,
      href,
      meta: [category?.name, fieldStateLabel(fieldCardState(topic.id))].filter(Boolean).join(" · "),
    });
  }
  for (const topic of data.manual) {
    if (handbookIdForDetail(topic.id)) continue;
    const href = shelfTarget(topic.id);
    if (!href) continue;
    rows.push({
      id: topic.id,
      title: topic.legacyLabel || topic.title,
      href,
      meta: "분야 카드에 없는 기존 본문",
    });
  }
  return rows;
}

export function MenuPage({ pathname }: { pathname: string }) {
  const [data, setData] = useState<MenuData | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [manualQuery, setManualQuery] = useState("");
  const [fieldQuery, setFieldQuery] = useState("");
  const [epkiPick, setEpkiPick] = useState("");
  const path = menuPath(pathname);

  useEffect(() => {
    setEpkiPick("");
    setFieldQuery("");
  }, [pathname]);

  useEffect(() => {
    if (!data) return;
    const parts = menuPath(pathname);
    const section = parts[0] ?? "";
    const itemId = parts[1] ?? "";
    if (section === "handbook" && itemId.startsWith("TOPIC-") && itemId !== "TOPIC-EPKI-01") {
      if (data.handbook.topics.some((topic) => topic.id === itemId)) noteVisit(itemId);
    }
    if (section === "topic" && itemId.startsWith("topic-") && data.manual.some((topic) => topic.id === itemId)) {
      noteVisit(itemId);
    }
  }, [pathname, data]);

  useEffect(() => {
    let alive = true;
    loadMenuData()
      .then((loaded) => {
        if (alive) setData(loaded);
      })
      .catch(() => {
        if (alive) setError("매뉴얼을 불러오지 못했습니다.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const manualHits = useMemo(() => (data ? searchManual(data.manual, manualQuery) : []), [data, manualQuery]);

  const topicHits = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    const rows = data.topics;
    if (!needle) return rows.slice(0, 40);
    return rows
      .filter((row) =>
        [row.title, row.category, row.subcategory, row.beginnerSummary, row.description]
          .join("\n")
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 40);
  }, [data, query]);

  if (error) {
    return <p className="text-sm text-desk">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-quiet">매뉴얼을 불러오는 중입니다.</p>;
  }

  const section = path[0] ?? "";
  const itemId = path[1] ?? "";
  const hrefFor = (topicId: string) => {
    if (data.topics.some((row) => row.id === topicId) || data.manual.some((row) => row.id === topicId)) {
      return `/menu/topic/${encodeURIComponent(topicId)}`;
    }
    if (
      data.handbook.categories.some((row) => row.id === topicId) ||
      data.handbook.topics.some((row) => row.id === topicId)
    ) {
      return `/menu/handbook/${encodeURIComponent(topicId)}`;
    }
    return null;
  };

  if (section === "") {
    return withRail("", (
      <div className="space-y-6">
        <header className="max-w-2xl space-y-2">
          <h1 className="text-2xl font-semibold text-desk">학교행정 업무매뉴얼</h1>
          <p className="text-sm leading-relaxed text-quiet">분야를 고르면 편람 목차의 업무가 나옵니다. 프로그램 실행은 이 페이지에서 하지 않습니다.</p>
        </header>
        <ShelfPanels rows={shelfRows(data)} />
        <FieldQuery
          id="manual-query"
          value={manualQuery}
          onChange={setManualQuery}
          scope={manualQuery.trim() ? "전체 19개 분야에서 찾습니다." : ""}
          count={
            manualQuery.trim()
              ? selectHandbookTopics(data.handbook.categories, data.handbook.topics, "", manualQuery).length +
                manualHits.filter((hit) => !handbookIdForDetail(hit.topic.id)).length
              : null
          }
        />
        {manualQuery.trim() && manualHits.length === 20 ? (
          <p className="no-print text-xs text-quiet">기존 본문 검색은 20건까지 보여 줍니다.</p>
        ) : null}
        {!manualQuery.trim() ? <FieldColorIndex categories={data.handbook.categories} /> : null}
        <div className="grid items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
          <FieldNav categories={data.handbook.categories} activeId="" />
          {manualQuery.trim() ? (
            <GroupedHandbookResults
              categories={data.handbook.categories}
              topics={data.handbook.topics}
              categoryId=""
              query={manualQuery}
              outside={manualHits}
            />
          ) : (
            <HandbookCardList
              categories={data.handbook.categories}
              topics={data.handbook.topics}
              categoryId=""
              query=""
            />
          )}
        </div>
        <div className="no-print">
          <MenuWorkMap
            query={manualQuery}
            hitIds={manualHits.map((hit) => hit.topic.id)}
            hrefFor={hrefFor}
            showIdle
            renderSide={(topicId) => <MapSide data={data} topicId={topicId} />}
          />
        </div>
      </div>
    ));
  }

  if (section === "handbook" && itemId === "") {
    return withRail("handbook", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <h1 className="text-2xl font-semibold text-desk">편람 분류</h1>
        <p className="text-sm text-quiet">분야를 열면 편람 목차의 업무가 나옵니다.</p>
        <ul className="space-y-2">
          {data.handbook.categories.map((category) => (
            <li key={category.id}>
              <a className="card-surface block px-4 py-3" href={`/menu/handbook/${encodeURIComponent(category.id)}`}>
                <span className="block text-sm font-medium text-desk">{category.name}</span>
                {category.pages ? <span className="text-xs text-quiet">쪽수 {category.pages}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      </div>
    ));
  }

  if (section === "handbook" && itemId.startsWith("CAT-")) {
    const category = data.handbook.categories.find((item) => item.id === itemId);
    const topics = data.handbook.topics.filter((topic) => category?.topicIds.includes(topic.id));
    return withRail("handbook", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu/handbook">
          편람 분류
        </a>
        <h1 className="text-2xl font-semibold text-desk">{category?.name ?? "분류"}</h1>
        {category?.pages ? <p className="text-xs text-quiet">편람 목차 기준 {category.pages}</p> : null}
        <FieldQuery
          id="field-query"
          value={fieldQuery}
          onChange={setFieldQuery}
          scope={fieldQuery.trim() ? `${category?.name ?? "이 분야"} 분야에서 찾습니다. 검색어를 지워도 이 분야에 머뭅니다.` : ""}
          count={fieldQuery.trim() ? selectHandbookTopics(data.handbook.categories, topics, itemId, fieldQuery).length : null}
        />
        {!fieldQuery.trim() && category ? <FieldTaskMap category={category} topics={topics} /> : null}
        <div className="grid items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
          <FieldNav categories={data.handbook.categories} activeId={itemId} />
          {fieldQuery.trim() ? (
            <GroupedHandbookResults
              categories={data.handbook.categories}
              topics={topics}
              categoryId={itemId}
              query={fieldQuery}
              outside={[]}
            />
          ) : (
            <HandbookCardList
              categories={data.handbook.categories}
              topics={topics}
              categoryId={itemId}
              query=""
            />
          )}
        </div>
      </div>
    ));
  }

  if (section === "handbook" && itemId) {
    const topic = data.handbook.topics.find((item) => item.id === itemId);
    if (topic?.id === "TOPIC-EPKI-01") {
      return withRail("epki", (
        <div className="space-y-3">
          <a className="text-sm text-ink" href="/menu/epki">인증서</a>
          <p className="text-sm text-desk">인증서 안내는 기존 화면에서 봅니다.</p>
        </div>
      ));
    }
    const state = topic ? fieldCardState(topic.id) : "preparing";
    const manual = topic && state === "review" ? linkedManual(data.manual, topic.id) : null;
    if (!topic) {
      return withRail("handbook", (
        <div className="space-y-4">
          <a className="text-sm text-ink" href="/menu/handbook">편람 분류</a>
          <h1 className="text-2xl font-semibold text-desk">업무</h1>
          <p className="text-sm text-quiet">이 업무는 자료에 없습니다.</p>
        </div>
      ));
    }
    const category = data.handbook.categories.find((item) => item.id === topic.categoryId);
    const opened = manual ? visibleParts(manual.parts) : [];
    return (
      <HandbookWorkGuide
        topic={topic}
        categoryName={category?.name ?? ""}
        siblings={(category?.topicIds ?? []).flatMap((id) => {
          const item = data.handbook.topics.find((row) => row.id === id);
          return item && item.id !== "TOPIC-EPKI-01" ? [item] : [];
        })}
        stateLabel={fieldStateLabel(state)}
        overview={handbookOverview(opened[0]?.body ?? "", fieldStateLabel(state))}
        starId={topic.id}
        body={manual ? <ManualPartList parts={manual.parts} /> : null}
      />
    );
  }

  if (section === "topic" && itemId === "") {
    return withRail("topic", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <h1 className="text-2xl font-semibold text-desk">업무자료</h1>
        <p className="text-sm text-quiet">단계가 있는 업무에는 한눈에 보기가 있습니다. 검색하면 업무 그림도 나옵니다.</p>
        <MenuWorkMap
          query={query}
          hitIds={query.trim() ? topicHits.map((row) => row.id) : []}
          hrefFor={hrefFor}
          showIdle={false}
          renderSide={(topicId) => <MapSide data={data} topicId={topicId} />}
        />
        <form role="search" className="no-print flex items-center gap-2" onSubmit={(event) => event.preventDefault()}>
          <label className="sr-only" htmlFor="topic-query">
            업무자료 검색
          </label>
          <input
            id="topic-query"
            className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-card px-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            value={query}
            placeholder="제목, 분류, 설명"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.trim() ? (
            <button
              type="button"
              className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line bg-card px-3 text-sm text-desk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              onClick={() => setQuery("")}
            >
              검색어 지우기
            </button>
          ) : null}
        </form>
        {query.trim() ? (
          <p className="text-sm text-desk" aria-live="polite">
            {topicHits.length === 0 ? "해당하는 업무가 없습니다." : `검색 결과 ${topicHits.length}건`}
          </p>
        ) : null}
        <ul className="space-y-2">
          {topicHits.map((row) => (
            <li key={row.id}>
              <a className="card-surface block min-h-11 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink" href={`/menu/topic/${encodeURIComponent(row.id)}`}>
                <span className="block break-words text-sm font-medium text-desk">{row.title}</span>
                <span className="text-xs text-quiet">{[row.category, row.subcategory].filter(Boolean).join(" · ")}</span>
              </a>
            </li>
          ))}
        </ul>
        {!query.trim() && topicHits.length === 0 ? <p className="text-sm text-quiet">해당하는 업무가 없습니다.</p> : null}
      </div>
    ));
  }

  if (section === "topic" && itemId.startsWith("topic-")) {
    const topic = data.manual.find((item) => item.id === itemId);
    if (!topic) {
      return withRail("topic", (
        <div className="space-y-4">
          <a className="text-sm text-ink" href="/menu">매뉴얼</a>
          <h1 className="text-2xl font-semibold text-desk">업무</h1>
          <p className="text-sm text-quiet">이 업무는 자료에 없습니다.</p>
        </div>
      ));
    }
    const parts = topic.parts ?? [];
    const handbookId = handbookIdForDetail(itemId);
    const handbook = handbookId ? data.handbook.topics.find((item) => item.id === handbookId) : undefined;
    if (handbook) {
      const category = data.handbook.categories.find((item) => item.id === handbook.categoryId);
      const opened = visibleParts(parts);
      return (
        <HandbookWorkGuide
          topic={handbook}
          categoryName={category?.name ?? ""}
          siblings={(category?.topicIds ?? []).flatMap((id) => {
            const item = data.handbook.topics.find((row) => row.id === id);
            return item && item.id !== "TOPIC-EPKI-01" ? [item] : [];
          })}
          stateLabel="검토 필요"
          overview={handbookOverview(opened[0]?.body ?? "", "검토 필요")}
          starId={topic.id}
          body={<ManualPartList parts={parts} />}
        />
      );
    }
    return withRail("topic", (
      <div className="space-y-4">
        <a className="no-print text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <div className="flex items-start justify-between gap-3">
          <h1 className="break-words text-2xl font-semibold text-desk">{topic.legacyLabel || topic.title}</h1>
          <div className="flex shrink-0 gap-2">
            <PrintButton />
            <StarButton id={topic.id} title={topic.legacyLabel || topic.title} />
          </div>
        </div>
        <p className="text-sm text-desk">검토 필요</p>
        {topic.category ? <p className="break-words text-xs text-quiet">자료에 적힌 분야 {topic.category}</p> : null}
        <p className="text-sm text-quiet">이 본문은 편람 분야 카드에 연결하지 않았습니다.</p>
        <p className="text-sm text-desk">분야 카드에 없는 기존 본문</p>
        <ManualPartList parts={parts} />
        <ManualChecklist workId={topic.id} items={[]} />
      </div>
    ));
  }

  if (section === "topic" && itemId) {
    const row = data.topics.find((item) => item.id === itemId);
    const tasks = row ? section2ForTitle(data.section2, row.title) : [];
    return withRail("topic", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu/topic">
          업무자료
        </a>
        <h1 className="text-2xl font-semibold text-desk">{row?.title ?? "업무"}</h1>
        {row ? <p className="text-xs text-quiet">{[row.category, row.subcategory].filter(Boolean).join(" · ")}</p> : null}
        {row?.steps && row.steps.length > 0 ? <TopicStepBoards board="glance" steps={row.steps} /> : null}
        {row?.beginnerSummary ? <p className="text-sm leading-6 text-desk">{row.beginnerSummary}</p> : null}
        {row?.description && row.description !== row.beginnerSummary ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-desk">{row.description}</p>
        ) : null}
        <TaskBlocks tasks={tasks} />
      </div>
    ));
  }

  if (section === "pilot" && itemId === "") {
    return withRail("pilot", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <h1 className="text-2xl font-semibold text-desk">시범 매뉴얼</h1>
        <p className="text-sm leading-relaxed text-quiet">
          병가와 질병휴직은 개발용 시범입니다. 현행 법령 검증 중이며 실제 업무 기준으로 쓰지 않습니다.
        </p>
        <ul className="space-y-2">
          <li>
            <a className="card-surface block px-4 py-3" href="/menu/pilot/gwe-2026-p053">
              <span className="block text-sm font-medium text-desk">병가</span>
              <span className="text-xs text-quiet">복무</span>
            </a>
          </li>
          <li>
            <a className="card-surface block px-4 py-3" href="/menu/pilot/gwe-work-0001">
              <span className="block text-sm font-medium text-desk">질병휴직</span>
              <span className="text-xs text-quiet">인사</span>
            </a>
          </li>
          <li>
            <a className="card-surface block px-4 py-3" href="/menu/guide/purchase">
              <span className="block text-sm font-medium text-desk">물품구매</span>
              <span className="text-xs text-quiet">시범 · 물품계약과 물품 관리로 연결</span>
            </a>
          </li>
        </ul>
      </div>
    ));
  }

  if (section === "guide" && itemId === "purchase") {
    return <PurchaseGuide />;
  }

  if (section === "pilot" && itemId) {
    return withRail("pilot", <PilotManualArticle topicId={itemId} />);
  }

  if (section === "epki") {
    return withRail("epki", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <h1 className="text-2xl font-semibold text-desk">{data.epki.title}</h1>
        {data.epki.summary ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-desk">
            <EpkiSummary text={data.epki.summary} />
          </p>
        ) : null}
        {data.epki.securityNotes && data.epki.securityNotes.length > 0 ? (
          <div className="space-y-1">
            {data.epki.securityNotes.map((note) => (
              <p key={note} className="text-sm leading-6 text-desk">
                {note}
              </p>
            ))}
          </div>
        ) : null}
        {(data.epki.children ?? []).length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-line bg-card p-4">
            <div className="flex flex-wrap gap-4">
              {(data.epki.children ?? []).map((child) => (
                <FlowPicture key={child.id} node={epkiPicture(child)} active={epkiPick} onPick={setEpkiPick} />
              ))}
            </div>
          </div>
        ) : null}
        {epkiPick ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-desk">{findEpki(data.epki, epkiPick)?.summary}</p>
        ) : null}
        <div className="space-y-4">
          {(data.epki.children ?? []).map((child) => (
            <EpkiTree key={child.id} node={child} />
          ))}
        </div>
      </div>
    ));
  }

  return withRail("", (
    <div className="space-y-3">
      <a className="text-sm text-ink" href="/menu">
        매뉴얼
      </a>
      <p className="text-sm text-desk">이 매뉴얼 주소는 없습니다.</p>
    </div>
  ));
}
