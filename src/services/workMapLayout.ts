import { loadEducationMindMap } from "./mindMapService";
import type { MindMapNode } from "../types/mindmap";

export interface LaidBox {
  id: string;
  topicId?: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidLink {
  from: string;
  to: string;
}

export interface WorkMapLayout {
  boxes: LaidBox[];
  links: LaidLink[];
  width: number;
  height: number;
}

interface Size {
  boxW: number;
  boxH: number;
  gapX: number;
  gapY: number;
  labelMax: number;
}

function clipLabel(label: string, max: number): string {
  const text = label.trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function treeScore(node: MindMapNode, queryFold: string, hitIds: Set<string>): number {
  let score = 0;
  if (queryFold && fold(node.label).includes(queryFold)) {
    score += 5;
  }
  if (node.topicId && hitIds.has(node.topicId)) {
    score += 10;
  }
  for (const child of node.children) {
    score += treeScore(child, queryFold, hitIds);
  }
  return score;
}

function treeHasHit(node: MindMapNode, hitIds: Set<string>, queryFold: string): boolean {
  if (node.topicId && hitIds.has(node.topicId)) {
    return true;
  }
  if (queryFold && fold(node.label).includes(queryFold)) {
    return true;
  }
  return node.children.some((child) => treeHasHit(child, hitIds, queryFold));
}

function trimTree(
  node: MindMapNode,
  depth: number,
  maxDepth: number,
  branchCap: number,
  hitIds: Set<string>,
  queryFold: string,
): MindMapNode {
  if (depth >= maxDepth) {
    return { ...node, children: [] };
  }
  const ranked = [...node.children].sort((a, b) => {
    const aHit = treeHasHit(a, hitIds, queryFold) ? 0 : 1;
    const bHit = treeHasHit(b, hitIds, queryFold) ? 0 : 1;
    return aHit - bHit;
  });
  const kept = ranked.slice(0, branchCap).map((child) =>
    trimTree(child, depth + 1, maxDepth, branchCap, hitIds, queryFold),
  );
  return { ...node, children: kept };
}

export function pickWorkMapRoot(query: string, hitIds: Iterable<string>): MindMapNode | null {
  const ids = new Set(hitIds);
  const queryFold = fold(query);
  if (!queryFold && ids.size === 0) {
    return null;
  }
  const map = loadEducationMindMap();
  let best: MindMapNode | null = null;
  let bestScore = 0;
  for (const root of map.roots) {
    const score = treeScore(root, queryFold, ids);
    if (score > bestScore) {
      bestScore = score;
      best = root;
    }
  }
  return bestScore > 0 ? best : null;
}

function place(
  node: MindMapNode,
  depth: number,
  top: number,
  size: Size,
  boxes: LaidBox[],
  links: LaidLink[],
): { height: number; midY: number } {
  const x = depth * (size.boxW + size.gapX);
  if (node.children.length === 0) {
    const y = top;
    boxes.push({
      id: node.id,
      topicId: node.topicId,
      label: clipLabel(node.label, size.labelMax),
      x,
      y,
      w: size.boxW,
      h: size.boxH,
    });
    return { height: size.boxH, midY: y + size.boxH / 2 };
  }
  let cursor = top;
  const childMids: number[] = [];
  for (const child of node.children) {
    const placed = place(child, depth + 1, cursor, size, boxes, links);
    links.push({ from: node.id, to: child.id });
    childMids.push(placed.midY);
    cursor += placed.height + size.gapY;
  }
  const span = cursor - top - size.gapY;
  const midY = childMids.length > 0 ? (childMids[0] + childMids[childMids.length - 1]) / 2 : top + size.boxH / 2;
  const y = Math.max(top, midY - size.boxH / 2);
  boxes.push({
    id: node.id,
    topicId: node.topicId,
    label: clipLabel(node.label, size.labelMax),
    x,
    y,
    w: size.boxW,
    h: size.boxH,
  });
  return { height: Math.max(size.boxH, span), midY: y + size.boxH / 2 };
}

export function layoutWorkMap(
  root: MindMapNode,
  mode: "compact" | "wide",
  hitIds: Iterable<string> = [],
  query = "",
): WorkMapLayout {
  const ids = new Set(hitIds);
  const queryFold = fold(query);
  const trimmed =
    mode === "compact"
      ? trimTree(root, 0, 2, 8, ids, queryFold)
      : trimTree(root, 0, 6, 16, ids, queryFold);
  const size: Size =
    mode === "compact"
      ? { boxW: 96, boxH: 26, gapX: 22, gapY: 8, labelMax: 8 }
      : { boxW: 148, boxH: 34, gapX: 36, gapY: 12, labelMax: 14 };
  const boxes: LaidBox[] = [];
  const links: LaidLink[] = [];
  const placed = place(trimmed, 0, 8, size, boxes, links);
  let maxX = size.boxW;
  let maxY = size.boxH;
  for (const box of boxes) {
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return {
    boxes,
    links,
    width: maxX + 12,
    height: Math.max(placed.height, maxY) + 12,
  };
}

export function elbowPath(
  from: LaidBox,
  to: LaidBox,
): string {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
}
