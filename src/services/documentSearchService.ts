import { invoke } from "@tauri-apps/api/core";
import { containingFolder, containingFolderLabel, containingFolderTool } from "./userFolderSearch";
import type { ToolItem } from "../types/tool";

export interface DocFolder {
  path: string;
}

export interface DocStatus {
  running: boolean;
  indexed: number;
  skipped: number;
  failed: number;
  current: string;
  message: string;
}

export interface DocHit {
  path: string;
  name: string;
  ext: string;
  snippet: string;
  score: number;
}

export const DOC_SEARCH_HOME_LIMIT = 5;

export function listDocFolders(): Promise<DocFolder[]> {
  return invoke("doc_search_folders");
}

export function addDocFolder(path: string): Promise<void> {
  return invoke("doc_search_add_folder", { path });
}

export function removeDocFolder(path: string): Promise<void> {
  return invoke("doc_search_remove_folder", { path });
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

export function queryDocuments(query: string, limit: number): Promise<DocHit[]> {
  return invoke("doc_search_query", { query, limit });
}

export function documentAsTool(hit: DocHit): ToolItem {
  return {
    id: `doc-search:${hit.path}`,
    name: hit.name,
    description: hit.snippet,
    type: "file",
    target: hit.path,
    icon: "file",
    category: "내 문서",
    favorite: false,
    keywords: [hit.name],
    usageCount: 0,
    enabled: true,
    origin: "local",
  };
}

export function documentFolderTool(hit: DocHit) {
  return containingFolderTool({
    name: hit.name,
    path: hit.path,
    kind: "file",
    zone: "내 문서",
  });
}

export function documentFolderLabel(path: string): string {
  return containingFolderLabel(path);
}

export function documentFolderPath(path: string): string {
  return containingFolder(path);
}
