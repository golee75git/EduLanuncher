# HANDOFF — 다른 PC·다른 Cursor에서 이어가기

기준일: 2026-09-19  
저장소: https://github.com/golee75git/EduLanuncher  
브랜치: `main`  
최신 커밋 시점의 앱 버전: `0.1.26-20260919`

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

설치본 재빌드 규칙은 `.cursor/rules/rebuild-installer.mdc`와 `CLAUDE.md`.

설치 결과:

- `src-tauri/target/release/bundle/nsis/EduLauncher_<version>_x64-setup.exe`
- 같은 폴더에 `EduLauncher_YYYY-MM-DD_x64-setup.exe` 복사
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

데이터(설치 후): 앱 데이터 `tools.json`, `todos.json`, `settings.json`, `memo.json`, `notices.json`.

Pack 분기 (`src/services/applyNoticePack.ts`):

1. `kind === "edulauncher-backup"` → 백업 복원
2. `notices` 배열 → 공지 Pack
3. `tools` 배열 → 바로가기 Pack

끌어놓기: `dragDropEnabled: false` + HTML5 URL + Rust OLE(`drop_target.rs`)로 파일 경로.

## 웹 (Cloudflare)

프로젝트 이름: `edulanuncher`  
Root directory: **`website`** (비우면 런처 화면이 웹에 올라감)

| 항목 | 값 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Output | `dist` |

`website/wrangler.jsonc`: `assets.directory` = `./dist`, `not_found_handling` = `single-page-application`. `_redirects` 쓰지 않음.

`main` 푸시하면 배포. 사이트 다운로드 버튼은 GitHub Releases.

## 지금까지 한 일 (요약)

- 트레이 패널, Pack, 끌어놓기, 공지 게시판형 목록, 메모, 할 일, 검색
- Pack vs 이 PC 표시, 홈 그룹 3개+모두(바로가기만)
- 다른 PC용 백업 JSON (설정 화면)
- git 연결, Cloudflare Workers 정적 사이트 (`website/`)
- GitHub Release에 `0.1.26` 설치파일 업로드
- 사이트 칸에서 이 PC Edge·Chrome 북마크와 Windows `.url` 목록
- 업무도구 칸에서 컴퓨터도구(이 PC Windows 설정 화면)
- 네트워크·CCTV 검색 중 예상·경과·남은 시간, 중지

## 알려진 미완

- 시작 시 `reg.exe` 검은 콘솔 (CREATE_NO_WINDOW 후보)
- 공지 「모두」 목록 페이지 없음
- 바탕화면 위젯 준비 중
- 설치파일은 수동 Release

## 커밋할 때

- 사용자 요청 있을 때만 커밋·푸시
- `.exe`, `target/`, `node_modules` 제외
- 설치본을 바꿨으면 Release에도 `.exe`를 올린다 (`gh` 미설치면 대시보드에서 업로드)
