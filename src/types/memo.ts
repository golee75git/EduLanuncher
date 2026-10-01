export interface MemoNote {
  id: string;
  text: string;
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  updatedAt: string;
}

export interface LocalMemo {
  text: string;
  updatedAt: string;
  notes: MemoNote[];
}

export const EXTRA_MEMO_LIMIT = 4;

export const EXTRA_MEMO_SIZE = {
  defaultWidth: 280,
  defaultHeight: 320,
  minWidth: 220,
  minHeight: 180,
  maxWidth: 720,
  maxHeight: 900,
} as const;

const NOTE_ID = /^[a-z0-9]{4,16}$/;

export const EMPTY_MEMO: LocalMemo = {
  text: "",
  updatedAt: "",
  notes: [],
};

export function asNoteWidth(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return EXTRA_MEMO_SIZE.defaultWidth;
  }
  return Math.min(EXTRA_MEMO_SIZE.maxWidth, Math.max(EXTRA_MEMO_SIZE.minWidth, Math.round(parsed)));
}

export function asNoteHeight(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return EXTRA_MEMO_SIZE.defaultHeight;
  }
  return Math.min(EXTRA_MEMO_SIZE.maxHeight, Math.max(EXTRA_MEMO_SIZE.minHeight, Math.round(parsed)));
}

export function asNoteCoord(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(8000, Math.max(-4000, Math.round(value)));
}

export function parseMemoNotes(value: unknown): MemoNote[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const notes: MemoNote[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id : "";
    if (!NOTE_ID.test(id) || notes.some((note) => note.id === id)) {
      continue;
    }
    notes.push({
      id,
      text: typeof source.text === "string" ? source.text.slice(0, 2000) : "",
      x: asNoteCoord(source.x),
      y: asNoteCoord(source.y),
      width: asNoteWidth(source.width),
      height: asNoteHeight(source.height),
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt.slice(0, 40) : "",
    });
    if (notes.length >= EXTRA_MEMO_LIMIT) {
      break;
    }
  }
  return notes;
}

export function newMemoNoteId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function memoWindowTitle(index: number): string {
  const number = index + 2;
  if (number < 2 || number > EXTRA_MEMO_LIMIT + 1) {
    return "메모";
  }
  return `메모 ${number}`;
}

export function memoNotePreview(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) {
    return "빈 메모";
  }
  const clipped = Array.from(line).slice(0, 24).join("");
  return clipped || "빈 메모";
}

export function readMemoNoteId(label: string): string | null {
  const prefix = "memo-n-";
  if (!label.startsWith(prefix)) {
    return null;
  }
  const id = label.slice(prefix.length);
  return NOTE_ID.test(id) ? id : null;
}
