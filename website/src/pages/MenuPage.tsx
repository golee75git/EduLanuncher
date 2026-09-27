import { useEffect, useMemo, useState } from "react";
import {
  handbookTopicTasks,
  loadMenuData,
  section2ForTitle,
  type EpkiNode,
  type MenuData,
  type Section2Task,
} from "../services/menuContent";

function menuPath(pathname: string): string[] {
  const path = decodeURI(pathname).replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts[0] === "menu" ? parts.slice(1) : [];
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

export function MenuPage({ pathname }: { pathname: string }) {
  const [data, setData] = useState<MenuData | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const path = menuPath(pathname);

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
    return (
      <div className="space-y-6">
        <header className="max-w-2xl space-y-2">
          <h1 className="text-2xl font-semibold text-desk">매뉴얼</h1>
          <p className="text-sm leading-relaxed text-quiet">편람과 업무자료, 인증서 안내를 읽습니다. 프로그램 실행은 이 페이지에서 하지 않습니다.</p>
        </header>
        <div className="grid gap-3 sm:grid-cols-3">
          <a className="card-surface p-4" href="/menu/handbook">
            <span className="block text-sm font-semibold text-desk">편람 분류</span>
            <span className="mt-1 block text-sm text-quiet">업무 분류와 세부업무 본문</span>
          </a>
          <a className="card-surface p-4" href="/menu/topic">
            <span className="block text-sm font-semibold text-desk">업무자료</span>
            <span className="mt-1 block text-sm text-quiet">제목으로 찾아 세부업무를 봅니다</span>
          </a>
          <a className="card-surface p-4" href="/menu/epki">
            <span className="block text-sm font-semibold text-desk">인증서</span>
            <span className="mt-1 block text-sm text-quiet">교육행정전자서명(EPKI)</span>
          </a>
        </div>
      </div>
    );
  }

  if (section === "handbook" && itemId === "") {
    return (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <h1 className="text-2xl font-semibold text-desk">편람 분류</h1>
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
    );
  }

  if (section === "handbook" && itemId.startsWith("CAT-")) {
    const category = data.handbook.categories.find((item) => item.id === itemId);
    const topics = data.handbook.topics.filter((topic) => topic.categoryId === itemId);
    return (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu/handbook">
          편람 분류
        </a>
        <h1 className="text-2xl font-semibold text-desk">{category?.name ?? "분류"}</h1>
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
    );
  }

  if (section === "handbook" && itemId) {
    const topic = data.handbook.topics.find((item) => item.id === itemId);
    const tasks = topic ? handbookTopicTasks(data, topic) : [];
    return (
      <div className="space-y-4">
        <a className="text-sm text-ink" href={topic ? `/menu/handbook/${encodeURIComponent(topic.categoryId)}` : "/menu/handbook"}>
          편람 분류
        </a>
        <h1 className="text-2xl font-semibold text-desk">{topic?.officialName || topic?.title || "업무"}</h1>
        {topic?.pages ? <p className="text-xs text-quiet">쪽수 {topic.pages}</p> : null}
        <TaskBlocks tasks={tasks} />
      </div>
    );
  }

  if (section === "topic" && itemId === "") {
    return (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu">
          매뉴얼
        </a>
        <h1 className="text-2xl font-semibold text-desk">업무자료</h1>
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
    );
  }

  if (section === "topic" && itemId) {
    const row = data.topics.find((item) => item.id === itemId);
    const tasks = row ? section2ForTitle(data.section2, row.title) : [];
    return (
      <div className="space-y-4">
        <a className="text-sm text-ink" href="/menu/topic">
          업무자료
        </a>
        <h1 className="text-2xl font-semibold text-desk">{row?.title ?? "업무"}</h1>
        {row ? <p className="text-xs text-quiet">{[row.category, row.subcategory].filter(Boolean).join(" · ")}</p> : null}
        {row?.beginnerSummary ? <p className="text-sm leading-6 text-desk">{row.beginnerSummary}</p> : null}
        {row?.description && row.description !== row.beginnerSummary ? (
          <p className="whitespace-pre-wrap text-sm leading-6 text-desk">{row.description}</p>
        ) : null}
        <TaskBlocks tasks={tasks} />
      </div>
    );
  }

  if (section === "epki") {
    return (
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
        <div className="space-y-4">
          {(data.epki.children ?? []).map((child) => (
            <EpkiTree key={child.id} node={child} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <a className="text-sm text-ink" href="/menu">
        매뉴얼
      </a>
      <p className="text-sm text-desk">이 매뉴얼 주소는 없습니다.</p>
    </div>
  );
}
