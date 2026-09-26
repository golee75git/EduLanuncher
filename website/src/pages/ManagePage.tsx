import { useState } from "react";
import { SITE_RELEASE_NOTES } from "../data/releases";

interface ManagedPost {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  hidden?: boolean;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ManagePage() {
  const [key, setKey] = useState("");
  const [posts, setPosts] = useState<ManagedPost[]>([]);
  const [opened, setOpened] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (nextKey: string) => {
    const response = await fetch("/api/opinion/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: nextKey }),
    });
    const data = (await response.json()) as { error?: string; posts?: ManagedPost[] };
    if (!response.ok) {
      setOpened(false);
      setPosts([]);
      setNotice(data.error || "열지 못했습니다.");
      return;
    }
    setOpened(true);
    setPosts(Array.isArray(data.posts) ? data.posts : []);
    setNotice("");
  };

  const setHidden = async (id: string, hidden: boolean) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(hidden ? "/api/opinion/hide" : "/api/opinion/show", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, key }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(data.error || "바꾸지 못했습니다.");
        return;
      }
      await load(key);
    } catch {
      setNotice("바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-desk">글 관리</h1>
        <p className="text-sm leading-relaxed text-quiet">숨긴 글과 보이는 글을 함께 봅니다. 이름은 입력한 그대로입니다.</p>
        <p className="text-sm leading-relaxed text-quiet">
          요청 수는{" "}
          <a
            className="underline decoration-line underline-offset-2 hover:text-desk"
            href="https://dash.cloudflare.com/"
            rel="noreferrer"
            target="_blank"
          >
            Cloudflare
          </a>
          에서 봅니다.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">버전</h2>
        <ol className="card-surface divide-y divide-line/70">
          {SITE_RELEASE_NOTES.map((item) => (
            <li key={item.version} className="px-4 py-3">
              <p className="text-sm font-medium text-desk">{item.version}</p>
              <p className="mt-1 text-sm leading-relaxed text-quiet">{item.note}</p>
            </li>
          ))}
        </ol>
      </section>

      <form
        className="card-surface flex flex-wrap items-center gap-2 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void load(key).catch(() => setNotice("열지 못했습니다."));
        }}
      >
        <input
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          aria-label="숨기기 열쇠"
          className="h-11 min-w-48 flex-1 rounded-lg border border-line bg-paper px-3 text-desk outline-none focus:border-ink"
        />
        <button type="submit" className="btn-primary h-11 px-4">
          보기
        </button>
      </form>
      {notice ? <p className="text-sm text-quiet">{notice}</p> : null}

      {opened ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">글</h2>
          {posts.length === 0 ? <p className="text-sm text-quiet">글이 없습니다.</p> : null}
          {posts.map((post) => (
            <article key={post.id} className="card-surface space-y-2 p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  {post.name}
                  <span className="ml-2 text-xs font-normal text-quiet">{post.hidden ? "숨김" : "보임"}</span>
                </h3>
                <time className="shrink-0 text-xs text-quiet" dateTime={post.createdAt}>
                  {formatWhen(post.createdAt)}
                </time>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-desk">{post.body}</p>
              <button
                type="button"
                className="text-xs text-quiet underline"
                disabled={busy}
                onClick={() => void setHidden(post.id, !post.hidden)}
              >
                {post.hidden ? "다시 보이기" : "숨기기"}
              </button>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
