import { useEffect, useState } from "react";

interface OpinionPost {
  id: string;
  name: string;
  body: string;
  createdAt: string;
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

export function OpinionPage({ section = false }: { section?: boolean }) {
  const [posts, setPosts] = useState<OpinionPost[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [hideId, setHideId] = useState("");
  const [hideKey, setHideKey] = useState("");

  const load = async () => {
    const response = await fetch("/api/opinion");
    if (!response.ok) {
      setNotice("글을 불러오지 못했습니다.");
      return;
    }
    const data = (await response.json()) as { posts?: OpinionPost[] };
    setPosts(Array.isArray(data.posts) ? data.posts : []);
  };

  useEffect(() => {
    void load().catch(() => setNotice("글을 불러오지 못했습니다."));
  }, []);

  const submit = async () => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/opinion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, body }),
      });
      const data = (await response.json()) as { error?: string; post?: OpinionPost };
      if (!response.ok || !data.post) {
        setNotice(data.error || "남기지 못했습니다.");
        return;
      }
      setPosts((current) => [data.post as OpinionPost, ...current].slice(0, 30));
      setName("");
      setBody("");
    } catch {
      setNotice("남기지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const hide = async (id: string) => {
    setNotice("");
    try {
      const response = await fetch("/api/opinion/hide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, key: hideKey }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(data.error || "숨기지 못했습니다.");
        return;
      }
      setPosts((current) => current.filter((post) => post.id !== id));
      setHideId("");
      setHideKey("");
    } catch {
      setNotice("숨기지 못했습니다.");
    }
  };

  return (
    <div className={section ? "max-w-2xl space-y-4" : "mx-auto max-w-2xl space-y-8"}>
      <section className="space-y-3">
        {section ? (
          <h2 className="text-sm font-semibold">의견</h2>
        ) : (
          <h1 className="text-3xl font-semibold tracking-tight text-desk">의견</h1>
        )}
        <p className="text-sm leading-relaxed text-quiet">
          계정은 없습니다. 이름과 글만 남깁니다. 이름은 그 글에만 붙고, 다음 글과 이어지지 않습니다.
        </p>
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-sm leading-relaxed text-desk">
          학생 이름, 전화번호, 비밀번호는 적지 마세요.
        </p>
      </section>

      <form
        className="card-surface space-y-3 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="block text-sm">
          <span className="font-medium">이름</span>
          <input
            value={name}
            maxLength={20}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-paper px-3 text-desk outline-none focus:border-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">글</span>
          <textarea
            value={body}
            maxLength={400}
            rows={5}
            onChange={(event) => setBody(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-desk outline-none focus:border-ink"
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          남기기
        </button>
        {notice ? <p className="text-sm text-quiet">{notice}</p> : null}
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">최근 글</h2>
        {posts.length === 0 ? <p className="text-sm text-quiet">아직 글이 없습니다.</p> : null}
        {posts.map((post) => (
          <article key={post.id} className="card-surface space-y-2 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">{post.name}</h3>
              <time className="shrink-0 text-xs text-quiet" dateTime={post.createdAt}>
                {formatWhen(post.createdAt)}
              </time>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-desk">{post.body}</p>
            {hideId === post.id ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void hide(post.id);
                }}
              >
                <input
                  type="password"
                  value={hideKey}
                  onChange={(event) => setHideKey(event.target.value)}
                  aria-label="숨기기 열쇠"
                  className="h-9 rounded-lg border border-line bg-paper px-3 text-sm outline-none focus:border-ink"
                />
                <button type="submit" className="btn-secondary h-9 px-3 text-xs">
                  숨기기
                </button>
              </form>
            ) : (
              <button type="button" className="text-xs text-quiet underline" onClick={() => setHideId(post.id)}>
                숨기기
              </button>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
