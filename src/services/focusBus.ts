let handler: (() => void) | null = null;

export function setSearchFocusHandler(next: (() => void) | null): void {
  handler = next;
}

export function focusSearchInput(): void {
  handler?.();
}
