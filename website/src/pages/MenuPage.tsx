import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TopicStepBoards } from "../components/TopicStepBoards";
import {
  handbookTopicTasks,
  loadMenuData,
  pictureSteps,
  taskNote,
  searchManual,
  section2ForTitle,
  type EpkiNode,
  type FlowNode,
  type MenuData,
  type Section2Task,
} from "../services/menuContent";

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
  { id: "epki", href: "/menu/epki", label: "인증서" },
] as const;

function MenuFrame({ section, children }: { section: string; children: ReactNode }) {
  return (
    <div className="grid items-start gap-6 md:grid-cols-[11rem_minmax(0,1fr)]">
      <nav aria-label="매뉴얼 구분" className="flex flex-wrap gap-2 md:sticky md:top-4 md:flex-col">
        {MENU_RAIL.map((item) => {
          const current = section === item.id;
          return (
            <a
              key={item.id}
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`rounded-lg border px-3 py-2 text-sm text-desk ${current ? "border-ink bg-ink-soft" : "border-line bg-card"}`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function withRail(section: string, body: ReactNode) {
  return <MenuFrame section={section}>{body}</MenuFrame>;
}

export function MenuPage({ pathname }: { pathname: string }) {
  const [data, setData] = useState<MenuData | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [manualQuery, setManualQuery] = useState("");
  const [manualStep, setManualStep] = useState("");
  const [epkiPick, setEpkiPick] = useState("");
  const path = menuPath(pathname);

  useEffect(() => {
    setManualStep("");
    setEpkiPick("");
  }, [pathname]);

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

  if (section === "") {
    return withRail("", (
      <div className="space-y-6">
        <header className="max-w-2xl space-y-2">
          <h1 className="text-2xl font-semibold text-desk">매뉴얼</h1>
          <p className="text-sm leading-relaxed text-quiet">왼쪽에서 편람 분류, 업무자료, 인증서를 고르면 오른쪽에 내용이 나옵니다. 프로그램 실행은 이 페이지에서 하지 않습니다.</p>
        </header>
        <input
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk"
          value={manualQuery}
          placeholder="업무 이름이나 세부업무"
          onChange={(event) => setManualQuery(event.target.value)}
        />
        {manualQuery.trim() ? (
          <ul className="space-y-2">
            {manualHits.map((hit) => (
              <li key={hit.topic.id}>
                <a className="card-surface block px-4 py-3" href={`/menu/topic/${encodeURIComponent(hit.topic.id)}`}>
                  <span className="block text-sm font-medium text-desk">{hit.topic.legacyLabel || hit.topic.title}</span>
                  <span className="mt-1 block text-sm text-quiet">{hit.topic.parts[0]?.body.replace(/\s+/g, " ").slice(0, 120)}</span>
                </a>
              </li>
            ))}
            {manualHits.length === 0 ? <li className="text-sm text-quiet">이 표현은 편람 2장 본문에서 찾지 못했습니다.</li> : null}
          </ul>
        ) : null}
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
        <p className="text-sm text-quiet">분류를 열면 업무 흐름과 한눈에 보기가 있습니다.</p>
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
    const topics = data.handbook.topics.filter((topic) => topic.categoryId === itemId);
    return withRail("handbook", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu/handbook">
          편람 분류
        </a>
        <h1 className="text-2xl font-semibold text-desk">{category?.name ?? "분류"}</h1>
        {category?.picture ? <TopicStepBoards steps={pictureSteps(category.picture)} /> : null}
        <ul className="space-y-2">
          {topics.map((topic) => (
            <li key={topic.id}>
              <a className="card-surface block px-4 py-3" href={`/menu/handbook/${encodeURIComponent(topic.id)}`}>
                <span className="block text-sm font-medium text-desk">{topic.officialName || topic.title}</span>
                {topic.pages ? <span className="text-xs text-quiet">쪽수 {topic.pages}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      </div>
    ));
  }

  if (section === "handbook" && itemId) {
    const topic = data.handbook.topics.find((item) => item.id === itemId);
    const tasks = topic ? handbookTopicTasks(data, topic) : [];
    const steps = (topic?.picture ? pictureSteps(topic.picture) : []).map((step) => {
      const task = tasks.find((item) => item.name.trim() === step.title.trim());
      return task ? { ...step, note: taskNote(task) } : step;
    });
    const covered = new Set(steps.map((step) => step.title.trim()));
    const rest = tasks.filter((task) => !covered.has(task.name.trim()));
    return withRail("handbook", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href={topic ? `/menu/handbook/${encodeURIComponent(topic.categoryId)}` : "/menu/handbook"}>
          편람 분류
        </a>
        <h1 className="text-2xl font-semibold text-desk">{topic?.officialName || topic?.title || "업무"}</h1>
        {topic?.pages ? <p className="text-xs text-quiet">쪽수 {topic.pages}</p> : null}
        {steps.length > 0 ? <TopicStepBoards steps={steps} /> : null}
        {steps.length === 0 ? <TaskBlocks tasks={tasks} /> : rest.length > 0 ? <TaskBlocks tasks={rest} /> : null}
      </div>
    ));
  }

  if (section === "topic" && itemId === "") {
    return withRail("topic", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <h1 className="text-2xl font-semibold text-desk">업무자료</h1>
        <p className="text-sm text-quiet">단계가 있는 업무에는 업무 흐름과 한눈에 보기가 있습니다.</p>
        <input
          className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-desk"
          value={query}
          placeholder="제목, 분류, 설명"
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="space-y-2">
          {topicHits.map((row) => (
            <li key={row.id}>
              <a className="card-surface block px-4 py-3" href={`/menu/topic/${encodeURIComponent(row.id)}`}>
                <span className="block text-sm font-medium text-desk">{row.title}</span>
                <span className="text-xs text-quiet">{[row.category, row.subcategory].filter(Boolean).join(" · ")}</span>
              </a>
            </li>
          ))}
        </ul>
        {topicHits.length === 0 ? <p className="text-sm text-quiet">해당하는 업무가 없습니다.</p> : null}
      </div>
    ));
  }

  if (section === "topic" && itemId.startsWith("topic-")) {
    const topic = data.manual.find((item) => item.id === itemId);
    const parts = topic?.parts ?? [];
    const shown = manualStep ? parts.filter((part) => part.title === manualStep) : parts;
    const visible = shown.length > 0 ? shown : parts;
    return withRail("topic", (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <h1 className="text-2xl font-semibold text-desk">{topic?.legacyLabel || topic?.title || "업무"}</h1>
        {topic?.category ? <p className="text-xs text-quiet">{topic.category}</p> : null}
        {topic && topic.steps.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-line bg-card p-4">
            <div className="flex flex-col items-start gap-2">
              {topic.steps.map((step, index) => (
                <div key={step.id} className="flex flex-col items-start gap-2">
                  {index > 0 ? <span className="ml-4 h-4 border-l border-line" /> : null}
                  <button
                    type="button"
                    className={`rounded-md border px-3 py-2 text-left text-sm text-desk ${
                      manualStep === step.title ? "border-ink bg-ink-soft" : "border-line bg-card"
                    }`}
                    onClick={() => setManualStep((current) => (current === step.title ? "" : step.title))}
                  >
                    {step.title}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {visible.map((part) => (
          <article key={part.id} className="space-y-2">
            <h3 className="text-base font-semibold text-desk">{part.title}</h3>
            <p className="whitespace-pre-wrap text-sm leading-6 text-desk">{part.body}</p>
          </article>
        ))}
        {!topic ? <p className="text-sm text-quiet">이 업무는 자료에 없습니다.</p> : null}
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
        {row?.steps && row.steps.length > 0 ? <TopicStepBoards steps={row.steps} /> : null}
        {row?.beginnerSummary ? <p className="text-sm leading-6 text-desk">{row.beginnerSummary}</p> : null}
        {row?.description && row.description !== row.beginnerSummary ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-desk">{row.description}</p>
        ) : null}
        <TaskBlocks tasks={tasks} />
      </div>
    ));
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
