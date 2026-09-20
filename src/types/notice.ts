export type NoticeKind = "org" | "alert";

export type NoticeOrigin = "pack" | "local";

export interface NoticeItem {
  id: string;
  kind: NoticeKind;
  title: string;
  summary?: string;
  url?: string;
  publishedAt: string;
  expiresAt?: string;
  origin?: NoticeOrigin;
  packName?: string;
}

export interface NoticePack {
  id: string;
  name: string;
  version: string;
  kind: NoticeKind;
  notices: NoticeItem[];
}

export interface StoredNotices {
  packId?: string;
  packName?: string;
  importedAt?: string;
  notices: NoticeItem[];
}

export const EMPTY_NOTICES: StoredNotices = {
  notices: [],
};

export const NOTICE_HOME_LIMIT = 3;

export const NOTICE_MAX = 200;

/** 홈 줄에 쓰는 짧은 표시. org는 기관 담당자, alert는 부서. */
export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = {
  org: "기관",
  alert: "부서",
};

export const NOTICE_KIND_FILE: Record<NoticeKind, string> = {
  org: "org-notice-pack.edupack",
  alert: "common-alert-pack.edupack",
};
