import { invoke } from "@tauri-apps/api/core";
import { APP_CONFIG } from "../config/app";

const RELEASE_API =
  "https://api.github.com/repos/golee75git/EduLanuncher/releases/latest";

export function parseReleaseParts(value: string): [number, number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?/.exec(value.trim());
  if (!match) {
    return [0, 0, 0, 0];
  }
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] ? Number(match[4]) : 0,
  ];
}

export function isReleaseNewer(latest: string, current: string): boolean {
  const next = parseReleaseParts(latest);
  const now = parseReleaseParts(current);
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== now[index]) {
      return next[index] > now[index];
    }
  }
  return false;
}

async function readTagFromSite(): Promise<string | null> {
  try {
    const response = await fetch(RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") {
      return null;
    }
    const tag = (body as { tag_name?: unknown }).tag_name;
    return typeof tag === "string" && tag.trim() ? tag.trim() : null;
  } catch {
    return null;
  }
}

export async function readLatestReleaseTag(): Promise<string | null> {
  try {
    const tag = await invoke<string>("latest_release_tag");
    if (typeof tag === "string" && tag.trim()) {
      return tag.trim();
    }
  } catch {
    // Command is unavailable in browser preview.
  }
  return readTagFromSite();
}

export async function findNewerRelease(): Promise<string | null> {
  const latest = await readLatestReleaseTag();
  if (!latest || !isReleaseNewer(latest, APP_CONFIG.version)) {
    return null;
  }
  return latest;
}
