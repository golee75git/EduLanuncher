interface OpinionRow {
  id: string;
  display_name: string;
  body: string;
  created_at: string;
  hidden?: number;
}

interface Env {
  ASSETS: { fetch: (input: Request) => Promise<Response> };
  OPINION_DB?: D1Database;
  OPINION_HIDE_KEY?: string;
}

interface D1Prepared {
  bind: (...values: unknown[]) => D1Prepared;
  all: <T>() => Promise<{ results?: T[] }>;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
}

interface D1Database {
  prepare: (query: string) => D1Prepared;
}

const NAME_MAX = 20;
const BODY_MAX = 400;
const LIST_MAX = 30;
const MANAGE_MAX = 100;
const WAIT_SECONDS = 60;
const FLOOD_WINDOW_MS = 10 * 60 * 1000;
const FLOOD_MAX = 8;

let schemaReady: Promise<void> | null = null;

function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/g, "").trim().slice(0, max);
}

function sameSite(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function sameText(leftText: string, rightText: string): boolean {
  const left = new TextEncoder().encode(leftText);
  const right = new TextEncoder().encode(rightText);
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

async function clientHash(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`edulanuncher-opinion|${ip}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function ensureSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = db
      .prepare(
        `CREATE TABLE IF NOT EXISTS opinion_post (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          hidden INTEGER NOT NULL DEFAULT 0,
          client_hash TEXT NOT NULL
        )`,
      )
      .run()
      .then(() => undefined)
      .catch((error: unknown) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > 2000) {
    return null;
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function publicName(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) {
    return name;
  }
  return `${chars[0]}**`;
}

function toPost(row: OpinionRow, maskName: boolean) {
  return {
    id: row.id,
    name: maskName ? publicName(row.display_name) : row.display_name,
    body: row.body,
    createdAt: row.created_at,
    hidden: Number(row.hidden) === 1,
  };
}

async function listPosts(db: D1Database): Promise<Response> {
  const listed = await db
    .prepare(
      "SELECT id, display_name, body, created_at FROM opinion_post WHERE hidden = 0 ORDER BY created_at DESC LIMIT ?",
    )
    .bind(LIST_MAX)
    .all<OpinionRow>();
  return json({ posts: (listed.results ?? []).map((row) => toPost(row, true)) });
}

async function addPost(request: Request, db: D1Database): Promise<Response> {
  if (!sameSite(request)) {
    return json({ error: "이 사이트에서만 남길 수 있습니다." }, 403);
  }
  if (request.headers.get("Cookie")?.includes("opinion_wait=1")) {
    return json({ error: "잠시 뒤에 다시 남겨 주세요." }, 429);
  }
  const payload = await readJson(request);
  const name = clip(payload?.name, NAME_MAX);
  const body = clip(payload?.body, BODY_MAX);
  if (!name || !body) {
    return json({ error: "이름과 글을 적어 주세요." }, 400);
  }
  const hash = await clientHash(request);
  const since = new Date(Date.now() - FLOOD_WINDOW_MS).toISOString();
  const recent = await db.prepare(
    "SELECT COUNT(*) AS count FROM opinion_post WHERE client_hash = ? AND created_at > ?",
  )
    .bind(hash, since)
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= FLOOD_MAX) {
    return json({ error: "잠시 뒤에 다시 남겨 주세요." }, 429);
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.prepare(
    "INSERT INTO opinion_post (id, display_name, body, created_at, hidden, client_hash) VALUES (?, ?, ?, ?, 0, ?)",
  )
    .bind(id, name, body, createdAt, hash)
    .run();
  const headers = new Headers();
  headers.set("set-cookie", `opinion_wait=1; Max-Age=${WAIT_SECONDS}; HttpOnly; Secure; SameSite=Lax; Path=/`);
  return json({ post: { id, name: publicName(name), body, createdAt, hidden: false } }, 201, headers);
}

function givenKey(payload: Record<string, unknown> | null): string {
  return typeof payload?.key === "string" ? payload.key : "";
}

function rejectKey(env: Env, given: string): Response | null {
  const key = env.OPINION_HIDE_KEY ?? "";
  if (!key) {
    return json({ error: "숨기기 열쇠가 아직 없습니다." }, 503);
  }
  if (!sameText(given, key)) {
    return json({ error: "열쇠가 맞지 않습니다." }, 403);
  }
  return null;
}

async function hidePost(request: Request, env: Env, db: D1Database): Promise<Response> {
  if (!sameSite(request)) {
    return json({ error: "이 사이트에서만 숨길 수 있습니다." }, 403);
  }
  const payload = await readJson(request);
  const rejected = rejectKey(env, givenKey(payload));
  if (rejected) {
    return rejected;
  }
  const id = clip(payload?.id, 80);
  if (!id) {
    return json({ error: "숨기지 못했습니다." }, 403);
  }
  await db.prepare("UPDATE opinion_post SET hidden = 1 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function showPost(request: Request, env: Env, db: D1Database): Promise<Response> {
  if (!sameSite(request)) {
    return json({ error: "이 사이트에서만 다시 보일 수 있습니다." }, 403);
  }
  const payload = await readJson(request);
  const rejected = rejectKey(env, givenKey(payload));
  if (rejected) {
    return rejected;
  }
  const id = clip(payload?.id, 80);
  if (!id) {
    return json({ error: "다시 보이지 못했습니다." }, 403);
  }
  await db.prepare("UPDATE opinion_post SET hidden = 0 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function managePosts(request: Request, env: Env, db: D1Database): Promise<Response> {
  if (!sameSite(request)) {
    return json({ error: "이 사이트에서만 볼 수 있습니다." }, 403);
  }
  const payload = await readJson(request);
  const rejected = rejectKey(env, givenKey(payload));
  if (rejected) {
    return rejected;
  }
  const listed = await db
    .prepare(
      "SELECT id, display_name, body, created_at, hidden FROM opinion_post ORDER BY created_at DESC LIMIT ?",
    )
    .bind(MANAGE_MAX)
    .all<OpinionRow>();
  return json({ posts: (listed.results ?? []).map((row) => toPost(row, false)) });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  if (!env.OPINION_DB) {
    return json({ error: "의견 저장소가 아직 연결되지 않았습니다." }, 503);
  }
  const db = env.OPINION_DB;
  const url = new URL(request.url);
  try {
    await ensureSchema(db);
    if (request.method === "GET" && url.pathname === "/api/opinion") {
      return await listPosts(db);
    }
    if (request.method === "POST" && url.pathname === "/api/opinion") {
      return await addPost(request, db);
    }
    if (request.method === "POST" && url.pathname === "/api/opinion/hide") {
      return await hidePost(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/opinion/show") {
      return await showPost(request, env, db);
    }
    if (request.method === "POST" && url.pathname === "/api/opinion/manage") {
      return await managePosts(request, env, db);
    }
    return json({ error: "없는 주소입니다." }, 404);
  } catch {
    return json({ error: "의견을 저장하지 못했습니다." }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname === "/api/opinion" ||
      url.pathname === "/api/opinion/hide" ||
      url.pathname === "/api/opinion/show" ||
      url.pathname === "/api/opinion/manage"
    ) {
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
