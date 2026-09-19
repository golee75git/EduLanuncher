# PLAN — 이어서 할 일

기준일: 2026-09-19  
완료된 큰 줄기는 `docs/HANDOFF.md`.

## 원칙 (모든 작업)

- 최소수정. 다른 기능은 그대로
- UI 문자열·커밋 메시지는 한국어
- 독립 UI. 타 런처 복제 없음
- 저작권·특허 이슈를 피하려면 로고 복사·게시판 스크랩·시스템 자동연동을 넣지 않음
- 새 기능은 `docs/IP_DESIGN_LOG.md` 항목 추가
- 설치본이 받아야 하는 변경이면 버전 `0.1.x-YYYYMMDD` 올리고 `.\tauri-env.cmd build` 후 GitHub Releases에 `.exe` 업로드

## 2026-09-19에 넣은 것

- 사이트 칸 「인터넷 즐겨찾기」: 이 PC Edge·Chrome `Bookmarks`와 Windows `Favorites`의 `.url`
- 네트워크·CCTV 검색 시작부터 예상·경과·남은 시간, 검색 중 중지
- 업무도구 칸 「컴퓨터도구」: 이 PC `System32`의 고정 파일만 열어 이름 바꾸기·제어판·시스템 정보 등 Windows 설정 화면을 연다. 익스플로러 설정 복원은 고정된 확인 화면만 연다. 이 PC IP 주소에서 사설·공인 IP만 본다. 홈 칸을 늘리지 않음
- 바로가기 카드 별로 홈 표시를 바꾸고, 빼기는 확인 후 목록에서만 뺀다. 관리자가 필요한 프로그램은 셸로 연다
- 보기 스킨 3개(서류·밝은 화면·어두운 화면). 홈 구역 제목을 진하게, 구역은 연한 배경으로 구분
- 홈 사이트는 한 줄 목록. 모두 목록 열은 설정에서 1열·2열

## 2026-09-20에 넣은 것

- 업무도구 「주소 무늬」: 이 PC 그림 오른쪽 아래에 http(s) 주소 무늬를 넣고 PNG로 저장 (`qrcode` 0.14.1)
- 바로가기 말풍선: 설명, 없으면 이름. 주소는 넣지 않음

## 다음 후보 (우선 낮은 것부터)

1. **시작 시 검은 콘솔**  
   `.edupack` 연결용 `reg.exe`가 창을 띄움. `CREATE_NO_WINDOW`로 숨기기. Rust (`src-tauri/src/lib.rs`) + 설치본 재빌드.

2. **기관 공지·공통 알림 「모두」**  
   바로가기 그룹처럼 홈 3건 + 모두 → 목록 페이지. `NoticeList`는 아직 3건만 자른다. Ask에서 하기로 했으나 미구현.

3. **바탕화면 미니 위젯**  
   설정에 「준비 중」만 있음. 요청 오기 전에는 손대지 않음.

4. **설치파일 자동 릴리스**  
   지금은 로컬 빌드 후 `gh release`로 수동 업로드. GitHub Actions(Windows runner + VS)는 선택.

5. **웹 미리보기**  
   실제 런처를 브라우저에 이식하지 않음. 목업 유지.

## 하지 말 것

- `src-tauri/target`, `node_modules`, `.exe`를 git에 넣기
- Cloudflare Pages에 설치파일 올리기
- Root directory 없이 저장소 루트를 웹으로 빌드하기 (런처 UI가 웹에 올라감)
- `_redirects`의 `/* → /index.html` (Workers SPA와 루프)
- Chrome/Edge 북마크 JSON을 몰래 읽어 동기화하기
- APK·Play Store·Vercel 점수판 문구를 이 Windows 앱에 넣기
