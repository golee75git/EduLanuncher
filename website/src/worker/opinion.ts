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

const BODY_MAX = 400
const LIST_MAX = 30;
const MANAGE_MAX = 100;
const WAIT_SECONDS = 60;
const FLOOD_WINDOW_MS = 10 * 60 * 1000;
const FLOOD_MAX = 8;
const RELEASE_FRESH_MS = 6 * 60 * 60 * 1000;
const RELEASE_PAGE_CAP = 10;
const RELEASE_BODY_CAP = 1_500_000;

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
      .then(() =>
        db
          .prepare(
            `CREATE TABLE IF NOT EXISTS release_fetch (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              downloads INTEGER NOT NULL,
              fetched_at TEXT NOT NULL
            )`,
          )
          .run(),
      )
      .then(() =>
        db
          .prepare(
            `CREATE TABLE IF NOT EXISTS opinion_seq (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              next_no INTEGER NOT NULL
            )`,
          )
          .run(),
      )
      .then(() =>
        db
          .prepare(
            `CREATE TABLE IF NOT EXISTS visit_count (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              total INTEGER NOT NULL,
              overseas INTEGER NOT NULL,
              today_key TEXT NOT NULL,
              today_count INTEGER NOT NULL
            )`,
          )
          .run(),
      )
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
  if (/^사용자[1-9][0-9]{0,5}$/.test(name)) {
    return name;
  }
  const chars = [...name];
  if (chars.length <= 1) {
    return name;
  }
  return `${chars[0]}**`;
}

async function highestUserNumber(db: D1Database): Promise<number> {
  const names = await db.prepare("SELECT display_name FROM opinion_post LIMIT 500").all<{ display_name?: string }>();
  let max = 0;
  for (const item of names.results ?? []) {
    const matched = typeof item.display_name === "string" ? /^사용자([1-9][0-9]{0,5})$/.exec(item.display_name) : null;
    const value = matched ? Number(matched[1]) : 0;
    if (value > max) {
      max = value;
    }
  }
  return max;
}

async function nextDisplayName(db: D1Database): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await db.prepare("SELECT next_no FROM opinion_seq WHERE id = 1").first<{ next_no?: number }>();
    const stored = current?.next_no;
    let issued = typeof stored === "number" && Number.isInteger(stored) ? stored : 0;
    if (issued < 1) {
      issued = (await highestUserNumber(db)) + 1;
      if (issued > 999999) {
        return null;
      }
      try {
        await db.prepare("INSERT INTO opinion_seq (id, next_no) VALUES (1, ?)").bind(issued + 1).run();
        return `사용자${issued}`;
      } catch {
        continue;
      }
    }
    if (issued > 999999) {
      return null;
    }
    const saved = (await db
      .prepare("UPDATE opinion_seq SET next_no = ? WHERE id = 1 AND next_no = ?")
      .bind(issued + 1, issued)
      .run()) as { meta?: { changes?: number } };
    if ((saved.meta?.changes ?? 0) === 1) {
      return `사용자${issued}`;
    }
  }
  return null;
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
  const body = clip(payload?.body, BODY_MAX);
  if (!body) {
    return json({ error: "글을 적어 주세요." }, 400);
  }
  const name = await nextDisplayName(db);
  if (!name) {
    return json({ error: "남기지 못했습니다." }, 400);
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

async function deletePost(request: Request, env: Env, db: D1Database): Promise<Response> {
  if (!sameSite(request)) {
    return json({ error: "이 사이트에서만 지울 수 있습니다." }, 403);
  }
  const payload = await readJson(request);
  const rejected = rejectKey(env, givenKey(payload));
  if (rejected) {
    return rejected;
  }
  const id = clip(payload?.id, 80);
  if (!id) {
    return json({ error: "지우지 못했습니다." }, 403);
  }
  await db.prepare("DELETE FROM opinion_post WHERE id = ?").bind(id).run();
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

function setupFileName(name: string): boolean {
  return name.length <= 120 && name.endsWith("x64-setup.exe") && !name.includes("/") && !name.includes("\\");
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("release");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) {
      break;
    }
    size += step.value.byteLength;
    if (size > RELEASE_BODY_CAP) {
      await reader.cancel();
      throw new Error("release");
    }
    chunks.push(step.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function githubSetupDownloads(): Promise<number> {
  let total = 0;
  for (let page = 1; page <= RELEASE_PAGE_CAP; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/golee75git/EduLanuncher/releases?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "edulanuncher-site",
        },
      },
    );
    if (!response.ok) {
      throw new Error("release");
    }
    const list = JSON.parse(await readBounded(response)) as unknown;
    if (!Array.isArray(list)) {
      throw new Error("release");
    }
    for (const release of list) {
      if (!release || typeof release !== "object") {
        continue;
      }
      const assets = (release as { assets?: unknown }).assets;
      if (!Array.isArray(assets)) {
        continue;
      }
      for (const asset of assets) {
        if (!asset || typeof asset !== "object") {
          continue;
        }
        const name = (asset as { name?: unknown }).name;
        const count = (asset as { download_count?: unknown }).download_count;
        if (typeof name !== "string" || !setupFileName(name)) {
          continue;
        }
        if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 1_000_000_000) {
          continue;
        }
        total += count;
      }
    }
    if (total > 2_000_000_000) {
      throw new Error("release");
    }
    if (list.length < 100) {
      break;
    }
  }
  return total;
}

async function downloadCount(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare("SELECT downloads, fetched_at FROM release_fetch WHERE id = 1")
    .first<{ downloads?: number; fetched_at?: string }>();
  const saved =
    row &&
    typeof row.downloads === "number" &&
    Number.isInteger(row.downloads) &&
    row.downloads >= 0 &&
    row.downloads <= 2_000_000_000
      ? row.downloads
      : null;
  const fetchedAt = row && typeof row.fetched_at === "string" ? Date.parse(row.fetched_at) : Number.NaN;
  if (saved !== null && Number.isFinite(fetchedAt) && Date.now() - fetchedAt < RELEASE_FRESH_MS) {
    return saved;
  }
  try {
    const downloads = await githubSetupDownloads();
    await db
      .prepare(
        `INSERT INTO release_fetch (id, downloads, fetched_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET downloads = excluded.downloads, fetched_at = excluded.fetched_at`,
      )
      .bind(downloads, new Date().toISOString())
      .run();
    return downloads;
  } catch {
    if (saved !== null) {
      await db
        .prepare("UPDATE release_fetch SET fetched_at = ? WHERE id = 1")
        .bind(new Date().toISOString())
        .run()
        .catch(() => undefined);
    }
    return saved;
  }
}

function seoulDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function counted(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_000_000_000 ? value : 0;
}

function overseasMark(request: Request): number {
  const country = request.headers.get("CF-IPCountry") ?? "";
  if (country.length !== 2 || country === "KR" || country === "XX") {
    return 0;
  }
  return 1;
}

function markedVisitDay(request: Request): string {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const text = part.trim();
    if (!text.startsWith("visit_day=")) {
      continue;
    }
    const value = text.slice("visit_day=".length);
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
      return value;
    }
  }
  return "";
}

function visitDayCookie(day: string): string {
  return `visit_day=${day}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=172800`;
}

async function recordVisit(request: Request, db: D1Database): Promise<void> {
  const day = seoulDay();
  await db
    .prepare(
      `INSERT INTO visit_count (id, total, overseas, today_key, today_count)
       VALUES (1, 0, 0, '', 0)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run();
  await db
    .prepare(
      `UPDATE visit_count
       SET total = total + 1,
           overseas = overseas + ?,
           today_count = CASE WHEN today_key = ? THEN today_count + 1 ELSE 1 END,
           today_key = ?
       WHERE id = 1`,
    )
    .bind(overseasMark(request), day, day)
    .run();
}

async function visitCounts(db: D1Database): Promise<{ total: number; today: number; overseas: number }> {
  const row = await db
    .prepare("SELECT total, overseas, today_key, today_count FROM visit_count WHERE id = 1")
    .first<{ total?: number; overseas?: number; today_key?: string; today_count?: number }>();
  return {
    total: counted(row?.total),
    today: row?.today_key === seoulDay() ? counted(row?.today_count) : 0,
    overseas: counted(row?.overseas),
  };
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  if (!env.OPINION_DB) {
    return json({ error: "의견 저장소가 아직 연결되지 않았습니다." }, 503);
  }
  const db = env.OPINION_DB;
  const url = new URL(request.url);
  try {
    await ensureSchema(db);
    if (request.method === "POST" && url.pathname === "/api/visits") {
      const day = seoulDay();
      const onSite = sameSite(request);
      if (onSite && markedVisitDay(request) !== day) {
        await recordVisit(request, db);
      }
      return json(
        await visitCounts(db),
        200,
        onSite ? { "set-cookie": visitDayCookie(day) } : undefined,
      );
    }
    if (request.method === "GET" && url.pathname === "/api/visits") {
      return json(await visitCounts(db));
    }
    if (request.method === "GET" && url.pathname === "/api/downloads") {
      return json({ downloads: await downloadCount(db) });
    }
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
    if (request.method === "POST" && url.pathname === "/api/opinion/delete") {
      return await deletePost(request, env, db);
    }
    return json({ error: "없는 주소입니다." }, 404);
  } catch {
    return json({ error: "의견을 저장하지 못했습니다." }, 500);
  }
}

function hasFileExtension(pathname: string): boolean {
  const leaf = pathname.split("/").pop() ?? "";
  return leaf.includes(".");
}

function isKnowledgePath(pathname: string): boolean {
  return pathname === "/knowledge" || pathname.startsWith("/knowledge/");
}

function plain(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function withShortKnowledgeCache(pathname: string, response: Response): Response {
  if (!isKnowledgePath(pathname) || response.status !== 200) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=60");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readAsset(request: Request, env: Env): Promise<Response> {
  try {
    return await env.ASSETS.fetch(request);
  } catch {
    return new Response(null, { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (
        url.pathname === "/api/downloads" ||
        url.pathname === "/api/visits" ||
        url.pathname === "/api/opinion" ||
        url.pathname === "/api/opinion/hide" ||
        url.pathname === "/api/opinion/show" ||
        url.pathname === "/api/opinion/manage" ||
        url.pathname === "/api/opinion/delete"
      ) {
        return await handleApi(request, env);
      }
      const asset = await readAsset(request, env);
      if (asset.status !== 404) {
        return withShortKnowledgeCache(url.pathname, asset);
      }
      if (hasFileExtension(url.pathname) || isKnowledgePath(url.pathname)) {
        return plain("없는 파일입니다.", 404);
      }
      const indexUrl = new URL("/index.html", request.url);
      const index = await readAsset(new Request(indexUrl, { method: "GET" }), env);
      if (index.status === 404) {
        return plain("없는 파일입니다.", 404);
      }
      return index;
    } catch {
      return plain("요청을 처리하지 못했습니다.", 500);
    }
  },
};
