import type { DataSourceInfo, SchoolItem } from "../types/school";

const SAMPLE_SOURCE: DataSourceInfo = {
  name: "내부 샘플",
  license: "앱 내 예시 데이터. 공공데이터 아님",
};

export const SAMPLE_SCHOOLS: SchoolItem[] = [
  {
    id: "school-jumunjin-e",
    name: "주문진초등학교",
    type: "초등학교",
    address: "강원특별자치도 강릉시 주문진읍",
    phone: "033-000-0001",
    homepage: "https://example.school.kr",
    keywords: ["주문진초", "주문진", "초등학교"],
    source: SAMPLE_SOURCE,
  },
  {
    id: "school-gangneung-m",
    name: "강릉중학교",
    type: "중학교",
    address: "강원특별자치도 강릉시",
    phone: "033-000-0002",
    homepage: "https://example.school.kr",
    keywords: ["강릉중", "강릉", "중학교"],
    source: SAMPLE_SOURCE,
  },
  {
    id: "school-gangneung-h",
    name: "강릉고등학교",
    type: "고등학교",
    address: "강원특별자치도 강릉시",
    phone: "033-000-0003",
    homepage: "https://example.school.kr",
    keywords: ["강릉고", "강릉", "고등학교"],
    source: SAMPLE_SOURCE,
  },
  {
    id: "school-gyeongpo-e",
    name: "경포초등학교",
    type: "초등학교",
    address: "강원특별자치도 강릉시 경포로",
    phone: "033-000-0004",
    homepage: "https://example.school.kr",
    keywords: ["경포초", "경포", "초등학교"],
    source: SAMPLE_SOURCE,
  },
  {
    id: "school-gangneung-gh",
    name: "강릉여자고등학교",
    type: "고등학교",
    address: "강원특별자치도 강릉시",
    phone: "033-000-0005",
    homepage: "https://example.school.kr",
    keywords: ["강릉여고", "여고", "강릉"],
    source: SAMPLE_SOURCE,
  },
];
