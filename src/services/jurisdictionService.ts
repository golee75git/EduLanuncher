import {
  JURISDICTION_LABEL,
  JURISDICTIONS,
  type Jurisdiction,
} from "../types/topic";

export interface AreaSource {
  organization?: string;
  document?: string;
  title?: string;
  summary?: string;
  jurisdiction?: string;
  jurisdictionName?: string;
}

export interface ResolvedArea {
  jurisdiction: Jurisdiction;
  jurisdictionName?: string;
}

interface OfficeName {
  name: string;
  jurisdiction: Jurisdiction;
}

const NATIONAL_NAMES = [
  "국민권익위원회",
  "국가법령정보센터",
  "행정안전부",
  "교육부",
  "법제처",
  "조달청",
];

const GANGWON_NAMES = [
  "강원특별자치도교육청",
  "속초양양교육지원청",
  "강원도교육청",
  "강릉교육지원청",
  "춘천교육지원청",
  "원주교육지원청",
  "동해교육지원청",
  "태백교육지원청",
  "삼척교육지원청",
  "홍천교육지원청",
  "횡성교육지원청",
  "영월교육지원청",
  "평창교육지원청",
  "정선교육지원청",
  "철원교육지원청",
  "화천교육지원청",
  "양구교육지원청",
  "인제교육지원청",
  "고성교육지원청",
  "강원교육청",
];

const OTHER_REGION_NAMES = [
  "전북특별자치도교육청",
  "제주특별자치도교육청",
  "세종특별자치시교육청",
  "서울특별시교육청",
  "부산광역시교육청",
  "대구광역시교육청",
  "인천광역시교육청",
  "광주광역시교육청",
  "대전광역시교육청",
  "울산광역시교육청",
  "충청북도교육청",
  "충청남도교육청",
  "전라북도교육청",
  "전라남도교육청",
  "경상북도교육청",
  "경상남도교육청",
  "경기도교육청",
];

const OFFICES: OfficeName[] = [
  ...NATIONAL_NAMES.map((name) => ({ name, jurisdiction: "national" as const })),
  ...GANGWON_NAMES.map((name) => ({ name, jurisdiction: "gangwon" as const })),
  ...OTHER_REGION_NAMES.map((name) => ({ name, jurisdiction: "other-region" as const })),
].sort((a, b) => b.name.length - a.name.length);

const JURISDICTION_SET = new Set<string>(JURISDICTIONS);

function findOffices(text: string): OfficeName[] {
  const raw = text.trim();
  if (!raw) {
    return [];
  }
  let rest = raw;
  const found: OfficeName[] = [];
  for (const office of OFFICES) {
    if (!rest.includes(office.name)) {
      continue;
    }
    found.push(office);
    rest = rest.split(office.name).join(" ");
  }
  return found;
}

function fromOffices(offices: OfficeName[]): ResolvedArea | "mixed" | "none" {
  if (offices.length === 0) {
    return "none";
  }
  const kinds = new Set(offices.map((office) => office.jurisdiction));
  if (kinds.size > 1) {
    return "mixed";
  }
  const jurisdiction = offices[0].jurisdiction;
  const names = [...new Set(offices.map((office) => office.name))];
  if (jurisdiction === "other-region" && names.length > 1) {
    return "mixed";
  }
  if (jurisdiction === "national" || names.length !== 1) {
    return { jurisdiction };
  }
  return { jurisdiction, jurisdictionName: names[0] };
}

function fromSummary(summary: string): ResolvedArea | "none" {
  const text = summary.trim();
  if (!text || text.includes("참고")) {
    return "none";
  }
  const offices = findOffices(text);
  if (offices.length !== 1 || !text.startsWith(offices[0].name)) {
    return "none";
  }
  const resolved = fromOffices(offices);
  if (resolved === "mixed" || resolved === "none") {
    return "none";
  }
  return resolved;
}

export function detectJurisdiction(source: AreaSource): ResolvedArea {
  const fields = [source.organization ?? "", source.document ?? "", source.title ?? ""];
  for (const field of fields) {
    const offices = findOffices(field);
    if (offices.length === 0) {
      continue;
    }
    const resolved = fromOffices(offices);
    if (resolved === "mixed" || resolved === "none") {
      return { jurisdiction: "unknown" };
    }
    return resolved;
  }
  const summary = fromSummary(source.summary ?? "");
  if (summary !== "none") {
    return summary;
  }
  return { jurisdiction: "unknown" };
}

export function resolveJurisdiction(source: AreaSource): ResolvedArea {
  const written = (source.jurisdiction ?? "").trim();
  const detected = detectJurisdiction(source);
  if (JURISDICTION_SET.has(written)) {
    const jurisdiction = written as Jurisdiction;
    const writtenName = (source.jurisdictionName ?? "").trim();
    if (writtenName) {
      return { jurisdiction, jurisdictionName: writtenName };
    }
    if (detected.jurisdiction === jurisdiction && detected.jurisdictionName) {
      return { jurisdiction, jurisdictionName: detected.jurisdictionName };
    }
    return { jurisdiction };
  }
  return detected;
}

export function getJurisdictionLabel(source: ResolvedArea): string {
  const base = JURISDICTION_LABEL[source.jurisdiction];
  if (source.jurisdiction === "other-region" && source.jurisdictionName) {
    return `${base} · ${source.jurisdictionName}`;
  }
  return base;
}
