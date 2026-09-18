# Cloudflare Pages (웹 소개 사이트)

데스크톱 앱(`src/`, `src-tauri/`)과 분리된 정적 사이트입니다.

## 로컬

```bat
cd website
npm install
npm run dev
```

http://localhost:5173 — `/` 소개, `/preview` 웹 미리보기, `/download` 설치 안내

## Cloudflare 대시보드

Workers & Pages → Create → Pages → Connect to Git → `golee75git/EduLanuncher`

| 항목 | 값 |
|---|---|
| Root directory | `website` |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build output directory | `dist` |
| NODE_VERSION | `22` |

설치 파일(.exe)은 Pages에 넣지 않습니다. 다운로드 버튼은 GitHub Releases를 엽니다.

`wrangler.jsonc`의 `name`은 Cloudflare 프로젝트 이름 `edulanuncher`와 같고, 정적 파일은 `assets.directory`의 `./dist`입니다. 대시보드 Root directory를 `website`로 두면 이 파일이 빌드 설정과 맞습니다.
