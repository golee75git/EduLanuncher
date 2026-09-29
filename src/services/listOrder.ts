export function orderedByIds<T extends { id: string }>(items: T[], saved: string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const next: T[] = [];
  const seen = new Set<string>();
  for (const id of saved) {
    const item = byId.get(id);
    if (!item || seen.has(id)) {
      continue;
    }
    next.push(item);
    seen.add(id);
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      next.push(item);
    }
  }
  return next;
}

export function moveId(ids: string[], id: string, step: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= ids.length) {
    return ids;
  }
  const next = ids.slice();
  const picked = next[index];
  next.splice(index, 1);
  next.splice(target, 0, picked);
  return next;
}

export function moveIdToFront(ids: string[], id: string): string[] {
  const index = ids.indexOf(id);
  if (index <= 0) {
    return ids;
  }
  const next = ids.slice();
  const picked = next[index];
  next.splice(index, 1);
  next.unshift(picked);
  return next;
}
