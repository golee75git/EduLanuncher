# HANDOFF — 다른 PC·다른 Cursor에서 이어가기

기준일: 2026-09-24  
저장소: https://github.com/golee75git/EduLanuncher  
브랜치: `main`  
최신 커밋 시점의 앱 버전: `0.1.116-20260926`

이 파일이 작업 인계본이다. 채팅 기록보다 이 문서와 git을 따른다.

## 다른 PC에서 열기

```bat
git clone https://github.com/golee75git/EduLanuncher.git
cd EduLanuncher
npm install
cd website
npm install
cd ..
```

필요 도구: Node 22+, Visual Studio 2022 Build Tools(C++), Rust(Tauri).

Cursor: 클론한 폴더를 **Open Folder**. `AGENTS.md`와 `.cursor/rules/`가 자동으로 붙는다. 채팅에 `@docs/HANDOFF.md` `@docs/PRD.md` `@docs/PLAN.md`를 넣으면 이 세션과 같다.

로컬 Cursor 대화(`agent-transcripts`)는 git에 없다. 복사하지 말고 위 문서를 쓴다.

## 명령

```bat
tauri-env.cmd dev
tauri-env.cmd build
npm run site:dev
npm run site:build
```

업무자료 검토 화면은 설치본 설정에 없다. 개발자만 `.\tauri-env.cmd dev` → 패널 → 오른쪽 위 톱니(설정) → 스크롤 「업무자료」→ 「검토가 필요한 업무자료」.

설치본 재빌드 규칙은 `.cursor/rules/rebuild-installer.mdc`와 `CLAUDE.md`.

설치 결과:

- `src-tauri/target/release/bundle/nsis/EduLauncher_<version>_x64-setup.exe`
- 같은 폴더에 `EduLauncher_YYYY-MM-DD_HHmm_x64-setup.exe` 복사
- git에 넣지 말고 GitHub Release에 업로드

현재 릴리스: https://github.com/golee75git/EduLanuncher/releases/latest

## 구성

| 경로 | 역할 |
|---|---|
| `src/` | 데스크톱 패널 React |
| `src-tauri/` | Tauri/Rust (트레이, 단축키, 드롭, 스캔, 파일연관) |
| `website/` | Cloudflare 소개 사이트 |
| `packs/` | Pack 예시 JSON |
| `docs/` | PRD, PLAN, HANDOFF, IP 로그 |

데이터(설치 후): 앱 데이터 `tools.json`, `todos.json`, `settings.json`, `memo.json`, `notices.json`, `recent-topics.json`.

Pack 분기 (`src/services/applyNoticePack.ts`):

1. `kind === "edulauncher-backup"` → 백업 복원
2. `kind === "edulauncher-share"` → 공지·사이트 Pack (공지·사이트 고르기)
3. `notices` 배열 → 공지 Pack
4. `tools` 배열 → 바로가기 Pack

끌어놓기: `dragDropEnabled: false` + HTML5 URL + Rust OLE(`drop_target.rs`)로 파일 경로.

## 웹 (Cloudflare)

프로젝트 이름: `edulanuncher`  
Root directory: **`website`** (비우면 런처 화면이 웹에 올라감)

루트 `package.json`·`vite.config.ts`에 wrangler나 `@cloudflare/vite-plugin`을 두지 않는다. 앱 `npm run build`는 패널만 묶는다. 사이트는 `npm run site:build`와 `website/wrangler.jsonc`만 쓴다.

| 항목 | 값 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Output | `dist` |

`website/wrangler.jsonc`: `assets.directory` = `./dist`, `not_found_handling` = `single-page-application`. `_redirects` 쓰지 않음.

`main` 푸시하면 배포. 사이트 다운로드 버튼은 GitHub Releases.

## 지금까지 한 일 (요약)

- 트레이·작업 표시줄 패널, Pack, 끌어놓기, 공지 게시판형 목록, 메모, 할 일, 검색. 즐겨찾기 표시줄에서 끌어 올 때 브라우저가 넘긴 PNG만 바로가기 그림으로 남김. 사이트 재접속 없음
- 패널 창 모서리로 크기 조절. 바꾼 크기는 이 PC 설정에 남는다. 처음 설치는 440×650
- 폴더 바로가기는 Windows 탐색기(explorer.exe)로 연다. 파일·프로그램·사이트는 그대로
- 업무도구 「단축키」: Windows·문서 단축키 20개. 탐색기·잠금·설정·작업 관리자·화면 캡처만 실행. 키 전송 없음
- 홈 아래 메모. 크게는 런처 옆에 창을 연다. 제목 줄로 옮기고, 모서리로 크기를 바꾼다. 바꾼 크기는 이 PC 설정에 남는다. 패널을 숨기면 같이 숨고, 다시 열면 옮긴 자리·크기가 있다. 제목 줄 X로 닫으면 다음 크게는 다시 옆에서 연다. 저장소는 패널만 연다.
- Pack vs 이 PC 표시, 홈 그룹 3개+모두(바로가기만)
- 다른 PC용 백업 JSON (설정 화면)
- git 연결, Cloudflare Workers 정적 사이트 (`website/`)
- GitHub Release에 `0.1.98` 설치파일 업로드
- 켤 때 한 번과 설정 프로그램 정보에서 이 PC 버전과 새 버전을 보여 준다. 새 파일이 있으면 패널에 안내하고 소개 사이트(`https://edulanuncher.zeroorder.kr/`)만 연다. 자동 설치·다운로드 없음
- Pack 연결과 시작 시 자동 실행용 `reg.exe`는 콘솔 창을 띄우지 않음
- 실행 중 메인 패널은 작업 표시줄에도 아이콘이 보임 (`skipTaskbar: false`). 창을 닫으면 최소화해서 아이콘이 남고, 아이콘을 누르면 설정한 자리(기본 오른쪽 아래)에 다시 열림. 업무 그림·메모 창은 표시줄에 없음
- 소개·설치 안내 웹에 「개인 사용 PC에만 설치하세요」강조. 아랫줄에 파일·폴더를 삭제하지 않는다고 적음. 공용 PC·실습실·다른 계정 설치를 안내에서 말림
- 업무도구 「QR코드 넣기」(이 PC 그림 + http(s) 주소 → PNG). QR Code 상표·라이선스·특허 비보장 고지
- 공지·사이트 Pack(`edulauncher-share`): 공지+사이트 url만. 저장 시 항목 고르기. 설정에서 저장·가져오기. 받는 쪽에서 공지와 사이트를 고름. 백업·할 일·메모·설정 제외
- 처음 설치 기본: 시작 시 자동 실행·시작 시 창 표시 켜짐. NSIS 마침을 누르면 앱 실행. 이미 저장된 설정은 덮지 않음
- 사이트 칸에서 이 PC Edge·Chrome 북마크와 Windows `.url` 목록. Windows `.url`을 넣으면 그 파일 아이콘을 남김. 탐색기 보내기 → 교육업무 런처로 `.url`을 넣음. `.url` 기본 연결은 바꾸지 않음. `.url` 본문의 `IconFile`이 이 PC 안 `.ico/.exe/.dll`이면 그 그림을 우선 쓰고, 경로 없이 넘어오는 가상 파일 `.url`(IE 즐겨찾기 등)도 이름·본문을 읽어 같은 방식으로 처리(`drop_target.rs`, `shell_icon.rs`). 원격 아이콘 주소는 받지 않음. IE 즐겨찾기 표시줄·펼친 즐겨찾기에서 끌 때는 끌어 온 쪽이 허용한 동작(복사→링크, 이동은 받지 않음)으로 응답하고, `CF_HDROP`→`Shell IDList Array`(파일 경로)→가상 파일→`UniformResourceLocator(W)`→텍스트 순으로 읽음. 다 읽지 못하면 받은 형식 이름을 안내 문구로 보여 줌. Edge 즐겨찾기 막대 끌기는 이 PC의 보안 프로그램(AhnLab Safe Transaction·V3 Lite·INISAFE)으로 막힐 수 있어, 「인터넷 즐겨찾기」 화면의 「내보낸 즐겨찾기 파일 불러오기」로 Edge가 내보낸 HTML(`ICON="data:image/png;base64,…"`, `bookmarkHtmlService.ts`, `read_bookmark_html`)을 읽어 PNG 그림과 함께 넣는다. 사이트에 접속하지 않음. 추가로 사이트를 넣을 때(`addDroppedSiteNow`) 그림이 없으면 이 PC Edge·Chrome의 `Favicons`에서 그 주소의 PNG를 찾아 남김(`favicon_db.rs`, `favicon_for_url`): SQLite 공개 형식 문서만 보고 새로 쓴 읽기 전용 최소 코드로 `icon_mapping`·`favicon_bitmaps` 두 표만 읽고 History·쿠키·로그인은 열지 않음. 열 이름이 기대와 다르면 포기. 32px에 가까운 PNG(24KB 이하)를 고르고 같은 주소가 없으면 같은 사이트 주소로 찾음. `.url` 경로는 본문 IconFile → 브라우저 그림 → 셸 아이콘 순. 「인터넷 즐겨찾기」 목록 각 줄 앞에도 그림을 보임: 내보낸 파일의 그림 → `.url` 파일 자체 그림(`readUrlShortcut`, 200개까지) → 이 PC 브라우저 그림을 `favicon_for_urls`로 한 번에(1000개까지, 파일을 두 번만 훑음). 없으면 지구본
- 업무도구 칸에서 컴퓨터도구(이 PC Windows 설정 화면, 이 PC IP 주소·사설/공인 IP, 제어판·소리·인터넷 옵션·작업 관리자·시스템 정보, 익스플로러 설정 복원 확인)
- 설정에서 서류·밝은 화면·어두운 화면 스킨
- 홈은 교육업무 런처 헤더, 시간 인사(11시 30분–12시 59분은 즐거운 점심시간이에요), 검색(안내: 사이트·업무·파일·폴더·컴퓨터도구·PC 문제, Ctrl+K는 글자 없이 동작), 공지 카드, 자주 사용하는 도구 카드. 최소 너비 1열, 기본 2열, 약 560px 이상 3열. 할 일·최근 사용·검색 결과 구역은 그대로. 메모는 아래, 상태 줄은 오른쪽 아래. 설정의 보기에서 이전스킨을 고르면 카드형 이전 홈(색은 서류)으로 돌아간다. 모두 화면은 설정에서 1열·2열
- 바로가기 위에 마우스를 올리면 설명(없으면 이름)이 나옴. 주소는 말풍선에 넣지 않음
- 네트워크·CCTV 검색 중 예상·경과·남은 시간, 중지
- 홈 검색·업무도구 「업무자료」: 교육행정 관련 업무를 로컬 JSON에서 찾음. 화면 구역 이름은 「관련 업무」
- 홈 검색 순서: 관련 도구 → 최근 사용 → 이 PC 폴더 → 학교 → PC 문제 해결 → 관련 업무. 관련 도구 줄마다 사이트·프로그램·파일·폴더·업무도구. 키보드 이동 순서도 같음. 기본은 빈 구역 안내를 두고, 설정 보기에서 빈 구역 숨김을 켜면 일치가 없는 구역만 숨긴다. 이 PC 폴더는 한 글자일 때 두 글자 안내를 남긴다.
- 컴퓨터도구 「PC 문제 해결」: 로컬 JSON 30장. 질문 안내. 시스템 명령 자동 실행 없음. Microsoft 공식 주소만 염
- 처음 화면 단추. 법령·학교알리미·나라장터·교육시설 통합정보망은 공식 주소만 염. 처리 흐름은 상자 순서
- 최근 사용: 바로가기와 열어 본 관련 업무. 검색어 문구는 저장하지 않음
- 설정 하단 소개 사이트 주소 `https://edulanuncher.zeroorder.kr/`
- 소개 페이지에 버전과 짧은 수정·개선 목록. 설치 파일은 GitHub Releases
- 할 일 오늘(날짜)·내일·모레. 저장은 YYYY-MM-DD. 날짜 줄 오른쪽 캘린더로 구글·네이버 공식 주소만 염
- 공지 한 칸. 기관/부서 표시. Pack은 고른 항목만 추가. 이 PC에서 넣기·수정·빼기
- 홈 검색의 이 PC 폴더와 컴퓨터도구 「이 PC 폴더 찾기」: 바탕화면·문서·다운로드에서 이름만 찾음. 내용은 읽지 않음. C:\ 전체·Everything 아님
- 업무자료: 검색결과·업무지도. 마인드맵은 로컬 JSON 목록. 항목 클릭 시 Topic 상세. `src/data/manuals/*.json`은 같은 목록에 합쳐 검색·트리·상세를 만듦. EPKI 인증서가 첫 매뉴얼. NotebookLM 수집 없음. 자료 출처는 읽을 때 강원 기준·전국 공통·타 교육청 참고·지역 확인 필요로 나누고, JSON 파일은 덮어쓰지 않음
- 홈 검색·업무자료 검색의 관련 업무 구역에 업무 그림(자체 SVG). 크게 보기는 런처에서 조금 더 넓게 펼치고 그림을 창에 채움. 단추·휠로 크기, 끌어서 이동. 상자 누르면 패널 상세. 칸 크기는 스크롤바와 나누어 잰다. 그래프 라이브러리 없음. 별도 창은 패널과 같은 index.html을 열고 저장소는 열지 않음. 이미 있는 창은 지우고 다시 연다
- 업무 상세에서 뒤로 가면 직전 검색어·그림·목록이 다시 나옴. 검색어는 화면에만 두고 파일에 넣지 않음. 상세 오른쪽 아래에 이전화면(처음 화면과 같은 모양)과 처음 화면이 있음
- 처음 설치에는 사이트·프로그램·파일·폴더가 비어 있음. 그때만 자주 사용하는 도구 아래에 끌어 놓기 안내가 나옴. 오른쪽 위 날짜는 9월26일(토) 형식. 설정에 교육 바로가기 추가 단추 없음. 업무도구 기본은 QR코드 넣기. Network·CCTV는 첫 설치에 없고, 담당자 Pack을 적용한 PC에만 목록에 생김. 이미 있는 목록은 지우지 않음. 컴퓨터도구·업무자료는 앱에 있음. 홈 업무도구 줄의 단축키·업무자료·편람 분류·컴퓨터도구 앞에 작은 그림이 있음. 편람 분류의 공통 문장 그림은 숨기고, 같은 이름의 기존 업무 순서가 하나면 그 제목으로 그린다. 할 일 샘플도 넣지 않음. 홈 자주 사용하는 도구의 사이트·프로그램·파일·폴더는 비어 있으면 끌어놓기나 + 안내가 나옴. 종류 이름은 구역 제목보다 한 단계 작게. 종류마다 기본 2열(최소 너비 1열, 약 560px 이상 3열)로 최대 6개까지 보이고, 더 있으면 모두에서 봄

## 알려진 미완

- 설치파일 자동 릴리스(GitHub Actions)는 선택

## 커밋할 때

- 사용자 요청 있을 때만 커밋·푸시
- `.exe`, `target/`, `node_modules` 제외
- 설치본을 바꿨으면 Release에도 `.exe`를 올린다 (`gh` 미설치면 대시보드에서 업로드)
