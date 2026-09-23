# HANDOFF — 다른 PC·다른 Cursor에서 이어가기

기준일: 2026-09-23  
저장소: https://github.com/golee75git/EduLanuncher  
브랜치: `main`  
최신 커밋 시점의 앱 버전: `0.1.83-20260923`

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

- 트레이·작업 표시줄 패널, Pack, 끌어놓기, 공지 게시판형 목록, 메모, 할 일, 검색
- 패널 창 모서리로 크기 조절. 바꾼 크기는 이 PC 설정에 남는다. 처음 설치는 440×650
- 폴더 바로가기는 Windows 탐색기(explorer.exe)로 연다. 파일·프로그램·사이트는 그대로
- 업무도구 「단축키」: Windows·문서 단축키 20개. 탐색기·잠금·설정·작업 관리자·화면 캡처만 실행. 키 전송 없음
- 홈 아래 메모. 크게는 런처 옆에 창을 연다. 제목 줄로 옮기고, 모서리로 크기를 바꾼다. 바꾼 크기는 이 PC 설정에 남는다. 패널을 숨기면 같이 숨고, 다시 열면 옮긴 자리·크기가 있다. 제목 줄 X로 닫으면 다음 크게는 다시 옆에서 연다. 저장소는 패널만 연다.
- Pack vs 이 PC 표시, 홈 그룹 3개+모두(바로가기만)
- 다른 PC용 백업 JSON (설정 화면)
- git 연결, Cloudflare Workers 정적 사이트 (`website/`)
- GitHub Release에 `0.1.83` 설치파일 업로드
- 실행 중 메인 패널은 작업 표시줄에도 아이콘이 보임 (`skipTaskbar: false`). 창을 닫으면 최소화해서 아이콘이 남고, 아이콘을 누르면 다시 열림. 업무 그림·메모 창은 표시줄에 없음
- 소개·설치 안내 웹에 「개인 사용 PC에만 설치하세요」강조. 아랫줄에 파일·폴더를 삭제하지 않는다고 적음. 공용 PC·실습실·다른 계정 설치를 안내에서 말림
- 업무도구 「QR코드 넣기」(이 PC 그림 + http(s) 주소 → PNG). QR Code 상표·라이선스·특허 비보장 고지
- 공지·사이트 Pack(`edulauncher-share`): 공지+사이트 url만. 저장 시 항목 고르기. 설정에서 저장·가져오기. 받는 쪽에서 공지와 사이트를 고름. 백업·할 일·메모·설정 제외
- 처음 설치 기본: 시작 시 자동 실행·시작 시 창 표시 켜짐. NSIS 설치 직후 앱 실행(`windows/hooks.nsh`). 이미 저장된 설정은 덮지 않음
- 사이트 칸에서 이 PC Edge·Chrome 북마크와 Windows `.url` 목록
- 업무도구 칸에서 컴퓨터도구(이 PC Windows 설정 화면, 이 PC IP 주소·사설/공인 IP, 제어판·소리·인터넷 옵션·작업 관리자·시스템 정보, 익스플로러 설정 복원 확인)
- 설정에서 서류·밝은 화면·어두운 화면 스킨
- 홈 사이트는 한 줄 목록. 모두 화면은 설정에서 1열·2열
- 바로가기 위에 마우스를 올리면 설명(없으면 이름)이 나옴. 주소는 말풍선에 넣지 않음
- 네트워크·CCTV 검색 중 예상·경과·남은 시간, 중지
- 홈 검색·업무도구 「업무자료」: 교육행정 관련 업무를 로컬 JSON에서 찾음. 화면 구역 이름은 「관련 업무」
- 홈 검색 순서: 관련 도구 → 최근 사용 → 이 PC 폴더 → 학교 → 관련 업무. 관련 도구 줄마다 사이트·프로그램·파일·폴더·업무도구. 키보드 이동 순서도 같음
- 처음 화면 단추. 법령·학교알리미·나라장터·교육시설 통합정보망은 공식 주소만 염. 처리 흐름은 상자 순서
- 최근 사용: 바로가기와 열어 본 관련 업무. 검색어 문구는 저장하지 않음
- 설정 하단 소개 사이트 주소
- 할 일 오늘(날짜)·내일·모레. 저장은 YYYY-MM-DD. 날짜 줄 오른쪽 캘린더로 구글·네이버 공식 주소만 염
- 공지 한 칸. 기관/부서 표시. Pack은 고른 항목만 추가. 이 PC에서 넣기·수정·빼기
- 홈 검색의 이 PC 폴더와 컴퓨터도구 「이 PC 폴더 찾기」: 바탕화면·문서·다운로드에서 이름만 찾음. 내용은 읽지 않음. C:\ 전체·Everything 아님
- 업무자료: 검색결과·업무지도. 마인드맵은 로컬 JSON 목록. 항목 클릭 시 Topic 상세. `src/data/manuals/*.json`은 같은 목록에 합쳐 검색·트리·상세를 만듦. EPKI 인증서가 첫 매뉴얼. NotebookLM 수집 없음
- 홈 검색·업무자료 검색의 관련 업무 구역에 업무 그림(자체 SVG). 크게 보기는 런처에서 조금 더 넓게 펼치고 그림을 창에 채움. 단추·휠로 크기, 끌어서 이동. 상자 누르면 패널 상세. 칸 크기는 스크롤바와 나누어 잰다. 그래프 라이브러리 없음. 별도 창은 패널과 같은 index.html을 열고 저장소는 열지 않음. 이미 있는 창은 지우고 다시 연다
- 업무 상세에서 뒤로 가면 직전 검색어·그림·목록이 다시 나옴. 검색어는 화면에만 두고 파일에 넣지 않음. 상세 오른쪽 아래에 이전화면(처음 화면과 같은 모양)과 처음 화면이 있음
- 처음 설치에는 사이트·프로그램·파일·폴더가 비어 있음. 설정에 교육 바로가기 추가 단추 없음. 업무도구 기본은 QR코드 넣기. Network·CCTV는 첫 설치에 없고, 담당자 Pack을 적용한 PC에만 목록에 생김. 이미 있는 목록은 지우지 않음. 컴퓨터도구·업무자료는 앱에 있음. 할 일 샘플도 넣지 않음. 홈 자주 사용하는 도구의 사이트·프로그램·파일·폴더는 비어 있으면 끌어놓기나 + 안내가 나옴. 종류 이름은 구역 제목보다 한 단계 작게(13px). 종류마다 2열로 최대 6개까지 보이고, 더 있으면 모두에서 봄

## 알려진 미완

- 시작 시 `reg.exe` 검은 콘솔 (CREATE_NO_WINDOW 후보)

## 커밋할 때

- 사용자 요청 있을 때만 커밋·푸시
- `.exe`, `target/`, `node_modules` 제외
- 설치본을 바꿨으면 Release에도 `.exe`를 올린다 (`gh` 미설치면 대시보드에서 업로드)
