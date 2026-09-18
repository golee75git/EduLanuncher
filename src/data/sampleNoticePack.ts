import type { NoticePack } from "../types/notice";

/** 담당자가 편집해 직원에게 배포하는 예시. 게시판 수집 없음. */
export const SAMPLE_NOTICE_PACK: NoticePack = {
  id: "pack-org-notices",
  name: "기관 공지",
  version: "0.1.0",
  kind: "org",
  notices: [
    {
      id: "notice-sample-1",
      kind: "org",
      title: "샘플 공지: 담당자가 작성한 안내",
      summary: "원문 링크만 넣습니다. 내부 게시판을 자동으로 가져오지 않습니다.",
      url: "https://www.moe.go.kr",
      publishedAt: "2026-09-17",
    },
  ],
};
