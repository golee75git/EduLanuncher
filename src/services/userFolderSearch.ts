import { invoke } from "@tauri-apps/api/core";

export interface UserFolderHit {
  name: string;
  kind: "file" | "folder" | string;
  zone: string;
  place: string;
  launchId: string;
  folderId: string;
}

export interface UserFolderQuery {
  hits: UserFolderHit[];
  batch: string;
}

export const USER_FOLDER_HOME_LIMIT = 5;

export async function findUserFolderNames(
  query: string,
  includeMedia: boolean,
  limit: number,
): Promise<UserFolderQuery> {
  const needle = query.trim();
  if (needle.length < 2) {
    return { hits: [], batch: "" };
  }
  return invoke<UserFolderQuery>("find_user_folder_names", {
    query: needle,
    includeMedia,
    limit,
  });
}

export async function haltUserFolderFind(): Promise<void> {
  await invoke("halt_user_folder_find");
}
