const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftYmd(ymd: string, days: number): string {
  const parsed = parseYmd(ymd);
  if (!parsed) {
    return localYmd();
  }
  return localYmd(new Date(parsed.year, parsed.month - 1, parsed.day + days));
}

export function shortMd(ymd: string): string {
  const parsed = parseYmd(ymd);
  if (!parsed) {
    return ymd;
  }
  return `${parsed.month}.${parsed.day}`;
}

export function asDueYmd(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = parseYmd(value.trim());
  if (!parsed) {
    return undefined;
  }
  return `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
}

export function dueYmdOf(dueDate: string | undefined, today: string): string {
  return asDueYmd(dueDate) ?? today;
}

function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const match = YMD.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}
