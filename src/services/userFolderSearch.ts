import { invoke } from "@tauri-apps/api/core";

export interface UserFolderHit {
  name: string;
  path: string;
  kind: "file" | "folder" | string;
  zone: string;
}

export const USER_FOLDER_HOME_LIMIT = 5;

export async function findUserFolderNames(
  query: string,
  includeMedia: boolean,
  limit: number,
): Promise<UserFolderHit[]> {
  const needle = query.trim();
  if (needle.length < 2) {
    return [];
  }
  return invoke<UserFolderHit[]>("find_user_folder_names", {
    query: needle,
    includeMedia,
    limit,
  });
}

export async function haltUserFolderFind(): Promise<void> {
  await invoke("halt_user_folder_find");
}

export function userFolderAsTool(hit: UserFolderHit) {
  return {
    id: `pc-folder:${hit.path}`,
    name: hit.name,
    description: hit.zone,
    type: hit.kind === "folder" ? ("folder" as const) : ("file" as const),
    target: hit.path,
    icon: hit.kind === "folder" ? "folder" : "file",
    category: hit.zone,
    favorite: false,
    keywords: [hit.name, hit.zone],
    usageCount: 0,
    enabled: true,
    origin: "local" as const,
  };
}
