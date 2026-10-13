const KEY: Record<string, { kind: "c" | "v"; n: number }> = {
  q: { kind: "c", n: 7 },
  w: { kind: "c", n: 12 },
  e: { kind: "c", n: 3 },
  r: { kind: "c", n: 0 },
  t: { kind: "c", n: 9 },
  y: { kind: "v", n: 12 },
  u: { kind: "v", n: 6 },
  i: { kind: "v", n: 2 },
  o: { kind: "v", n: 1 },
  p: { kind: "v", n: 5 },
  a: { kind: "c", n: 6 },
  s: { kind: "c", n: 2 },
  d: { kind: "c", n: 11 },
  f: { kind: "c", n: 5 },
  g: { kind: "c", n: 18 },
  h: { kind: "v", n: 8 },
  j: { kind: "v", n: 4 },
  k: { kind: "v", n: 0 },
  l: { kind: "v", n: 20 },
  z: { kind: "c", n: 15 },
  x: { kind: "c", n: 16 },
  c: { kind: "c", n: 14 },
  v: { kind: "c", n: 17 },
  b: { kind: "v", n: 17 },
  n: { kind: "v", n: 13 },
  m: { kind: "v", n: 18 },
};

const LEAD_MARK = [0x3131, 0x3132, 0x3134, 0x3137, 0x3138, 0x3139, 0x3141, 0x3142, 0x3143, 0x3145, 0x3146, 0x3147, 0x3148, 0x3149, 0x314a, 0x314b, 0x314c, 0x314d, 0x314e];
const TAIL_OF = [1, 2, 4, 7, -1, 8, 16, 17, -1, 19, 20, 21, 22, -1, 23, 24, 25, 26, 27];

function syllable(lead: number, vowel: number, tail: number): string {
  return String.fromCodePoint(0xac00 + (lead * 21 + vowel) * 28 + tail);
}

function leadMark(lead: number): string {
  const code = LEAD_MARK[lead];
  return code ? String.fromCodePoint(code) : "";
}

function vowelMark(vowel: number): string {
  return String.fromCodePoint(0x314f + vowel);
}

function doubledLead(lead: number, next: number): number | null {
  if (lead === 0 && next === 0) return 1;
  if (lead === 3 && next === 3) return 4;
  if (lead === 7 && next === 7) return 8;
  if (lead === 9 && next === 9) return 10;
  if (lead === 12 && next === 12) return 13;
  return null;
}

function joinedVowel(vowel: number, next: number): number | null {
  if (vowel === 8 && next === 0) return 9;
  if (vowel === 8 && next === 1) return 10;
  if (vowel === 8 && next === 20) return 11;
  if (vowel === 13 && next === 4) return 14;
  if (vowel === 13 && next === 5) return 15;
  if (vowel === 13 && next === 20) return 16;
  if (vowel === 18 && next === 20) return 19;
  return null;
}

function joinedTail(tail: number, lead: number): number | null {
  if (tail === 1 && lead === 9) return 3;
  if (tail === 4 && lead === 12) return 5;
  if (tail === 4 && lead === 18) return 6;
  if (tail === 8 && lead === 0) return 9;
  if (tail === 8 && lead === 6) return 10;
  if (tail === 8 && lead === 7) return 11;
  if (tail === 8 && lead === 9) return 12;
  if (tail === 8 && lead === 16) return 13;
  if (tail === 8 && lead === 17) return 14;
  if (tail === 8 && lead === 18) return 15;
  if (tail === 17 && lead === 9) return 18;
  if (tail === 19 && lead === 9) return 20;
  return null;
}

function splitTail(tail: number): { keep: number; move: number } {
  if (tail === 2) return { keep: 1, move: 0 };
  if (tail === 3) return { keep: 1, move: 9 };
  if (tail === 5) return { keep: 4, move: 12 };
  if (tail === 6) return { keep: 4, move: 18 };
  if (tail === 9) return { keep: 8, move: 0 };
  if (tail === 10) return { keep: 8, move: 6 };
  if (tail === 11) return { keep: 8, move: 7 };
  if (tail === 12) return { keep: 8, move: 9 };
  if (tail === 13) return { keep: 8, move: 16 };
  if (tail === 14) return { keep: 8, move: 17 };
  if (tail === 15) return { keep: 8, move: 18 };
  if (tail === 18) return { keep: 17, move: 9 };
  if (tail === 20) return { keep: 19, move: 9 };
  const move = [0, 0, 0, 0, 2, 0, 0, 3, 5, 0, 0, 0, 0, 0, 0, 0, 6, 7, 0, 9, 0, 11, 12, 14, 15, 16, 17, 18][tail];
  return { keep: 0, move: move ?? 0 };
}

class LineBuilder {
  out = "";
  lead: number | null = null;
  vowel: number | null = null;
  tail = 0;
  hold: number | null = null;

  commit(): void {
    if (this.lead != null && this.vowel != null) {
      this.out += syllable(this.lead, this.vowel, this.tail);
    } else if (this.lead != null) {
      this.out += leadMark(this.lead);
    } else if (this.vowel != null) {
      this.out += vowelMark(this.vowel);
    }
    this.lead = null;
    this.vowel = null;
    this.tail = 0;
  }

  finish(): void {
    if (this.hold != null) {
      const pending = this.hold;
      this.hold = null;
      this.commit();
      this.lead = pending;
    }
    this.commit();
  }

  addConsonant(next: number): void {
    if (this.hold != null) {
      const pending = this.hold;
      this.hold = null;
      this.commit();
      this.lead = pending;
    }
    if (this.lead == null && this.vowel == null) {
      this.lead = next;
      return;
    }
    if (this.vowel == null && this.lead != null) {
      const twin = doubledLead(this.lead, next);
      if (twin != null) {
        this.lead = twin;
        return;
      }
      this.commit();
      this.lead = next;
      return;
    }
    if (this.tail === 0) {
      const asTail = TAIL_OF[next];
      if (asTail != null && asTail >= 0) {
        this.tail = asTail;
        return;
      }
      this.hold = next;
      return;
    }
    const joined = joinedTail(this.tail, next);
    if (joined != null) {
      this.tail = joined;
      return;
    }
    this.hold = next;
  }

  addVowel(next: number): void {
    if (this.hold != null) {
      const pending = this.hold;
      this.hold = null;
      this.commit();
      this.lead = pending;
      this.vowel = next;
      return;
    }
    if (this.lead == null && this.vowel == null) {
      this.vowel = next;
      return;
    }
    if (this.vowel == null) {
      this.vowel = next;
      return;
    }
    if (this.tail === 0) {
      const joined = joinedVowel(this.vowel, next);
      if (joined != null) {
        this.vowel = joined;
        return;
      }
      this.commit();
      this.vowel = next;
      return;
    }
    const parts = splitTail(this.tail);
    this.tail = parts.keep;
    this.commit();
    this.lead = parts.move;
    this.vowel = next;
  }

  gap(text: string): void {
    this.finish();
    this.out += text;
  }
}

export function readKeyLine(value: string): string {
  const builder = new LineBuilder();
  for (const ch of value) {
    const key = KEY[ch.toLowerCase()];
    if (!key) {
      builder.gap(ch);
      continue;
    }
    if (key.kind === "c") {
      builder.addConsonant(key.n);
    } else {
      builder.addVowel(key.n);
    }
  }
  builder.finish();
  return builder.out;
}

function syllableOnly(value: string): boolean {
  const text = value.replace(/\s/g, "");
  if (!text) {
    return false;
  }
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0xac00 || code > 0xd7a3) {
      return false;
    }
  }
  return true;
}

export function searchForms(value: string): string[] {
  const raw = value.trim();
  if (!raw) {
    return [];
  }
  const read = readKeyLine(raw).trim();
  if (read && read !== raw && syllableOnly(read)) {
    return [raw, read];
  }
  return [raw];
}

export function latinLookup(value: string): string {
  const raw = value.trim();
  const read = searchForms(raw).find((form) => form !== raw);
  if (read && /^[a-zA-Z\s]+$/.test(raw)) {
    return read;
  }
  return raw;
}
