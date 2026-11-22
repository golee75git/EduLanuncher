import { useEffect, useState } from "react";
import { SITE_CONFIG } from "../config";

interface VisitCounts {
  total: number;
  today: number;
  overseas: number;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function SiteFooter() {
  const [visits, setVisits] = useState<VisitCounts | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/visits")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { total?: unknown; today?: unknown; overseas?: unknown } | null) => {
        const total = asCount(data?.total);
        const today = asCount(data?.today);
        const overseas = asCount(data?.overseas);
        if (alive && total !== null && today !== null && overseas !== null) {
          setVisits({ total, today, overseas });
        }
      })
      .catch(() => {
        // 방문 수가 없어도 바닥 글은 그대로다.
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="border-t border-line/80 py-6 text-center text-xs text-quiet">
      <p>{SITE_CONFIG.displayName} · Windows 데스크톱 앱</p>
      {visits ? (
        <p className="mt-2">
          전체방문 {visits.total.toLocaleString("ko-KR")} · 오늘 방문 {visits.today.toLocaleString("ko-KR")} · 해외방문{" "}
          {visits.overseas.toLocaleString("ko-KR")}
        </p>
      ) : null}
      <p className="mt-2">
        <a className="underline" href="/third-party-notices.txt">
          오픈소스 라이선스
        </a>
      </p>
    </footer>
  );
}
