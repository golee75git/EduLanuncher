import { invoke } from "@tauri-apps/api/core";

export interface DocFolder {
  path: string;
  id: string;
}

export interface DocStatus {
  running: boolean;
  indexed: number;
  skipped: number;
  failed: number;
  cloudSkipped: number;
  current: string;
  message: string;
}

export interface DocHit {
  name: string;
  ext: string;
  snippet: string;
  score: number;
  note: string;
  place: string;
  launchId: string;
  folderId: string;
}

export interface DocQuery {
  hits: DocHit[];
  hint: string;
  batch: string;
}

export const DOC_SEARCH_HOME_LIMIT = 5;

export function listDocFolders(): Promise<DocFolder[]> {
  return invoke("doc_search_folders");
}

export function addDocFolder(): Promise<void> {
  return invoke("doc_search_add_folder");
}

export function removeDocFolder(id: string): Promise<void> {
  return invoke("doc_search_remove_folder", { id });
}

export function clearDocIndex(): Promise<void> {
  return invoke("doc_search_clear");
}

export function docSearchStatus(): Promise<DocStatus> {
  return invoke("doc_search_status");
}

export function startDocIndex(): Promise<void> {
  return invoke("doc_search_start");
}

export function haltDocIndex(): Promise<void> {
  return invoke("doc_search_halt");
}

export function queryDocuments(query: string, limit: number): Promise<DocQuery> {
  return invoke("doc_search_query", { query, limit });
}
