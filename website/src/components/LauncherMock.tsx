const GROUPS = [
  { label: "사이트", items: ["교육청", "나이스 안내", "업무포털"] },
  { label: "프로그램", items: ["계산기", "메모장", "엑셀"] },
  { label: "파일", items: ["서식1", "서식2", "안내문"] },
] as const;

const NOTICES = [
  { mark: "기관", title: "1학기 학사 일정 안내", date: "09.12" },
  { mark: "기관", title: "개인정보 보호 교육", date: "09.08" },
  { mark: "부서", title: "공용 PC 점검 일정", date: "09.03" },
] as const;

export function LauncherMock() {
  return (
    <div
      className="relative mx-auto flex h-[650px] w-[440px] max-w-full flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-pop"
      aria-hidden="true"
    >
      <div className="absolute inset-x-0 top-0 z-10 bg-ink-soft/90 px-3 py-1.5 text-center text-[11px] font-medium text-ink-strong">
        미리보기 · 클릭해도 실행되지 않습니다
      </div>
      <header className="flex items-center justify-between px-4 pt-8">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-ink shadow-[0_0_0_3px] shadow-ink-soft" />
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-ink">EduLauncher</p>
            <p className="text-[15px] font-semibold text-desk">교육업무 런처</p>
          </div>
        </div>
        <span className="text-xs text-quiet">샘플</span>
      </header>
      <div className="mx-3 mt-3 h-10 rounded-lg border border-line bg-card px-3 text-sm leading-10 text-quiet">
        학교·도구 검색
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-hidden px-3 pb-3">
        <section>
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-quiet uppercase">공지</h2>
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            {NOTICES.map((row) => (
              <div
                key={row.title}
                className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-[10px] text-quiet">{row.mark}</span>
                  <span className="truncate text-sm">{row.title}</span>
                </span>
                <span className="shrink-0 text-xs text-quiet">{row.date}</span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-quiet uppercase">자주 사용하는 도구</h2>
          <div className="space-y-3">
            {GROUPS.map((group) => (
              <div key={group.label}>
                <div className="mb-1.5 flex items-center">
                  <h3 className="min-w-0 flex-1 text-[11px] text-quiet">{group.label}</h3>
                  <span className="text-[11px] font-medium text-ink">모두</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {group.items.map((name) => (
                    <div key={name} className="rounded-lg border border-line/70 bg-card px-2 py-3 text-center text-xs">
                      {name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
