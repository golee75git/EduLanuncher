# EduLauncher (교육업무 런처) V0.1

Windows용 교육기관 업무 런처입니다. 평소에는 시스템 트레이에만 있고, 트레이 클릭 또는 `Ctrl + Alt + E`로 작은 패널을 엽니다.

## 실행

Visual Studio 2022 Build Tools(C++)가 필요합니다.

```bat
tauri-env.cmd dev
```

또는 개발자 명령 프롬프트에서:

```bat
npm run tauri dev
```

첫 실행 시 환영 화면이 나타납니다. 이후에는 트레이 아이콘만 남습니다.

## 빌드

```bat
tauri-env.cmd build
```

설치 파일은 git에 넣지 않습니다. 받은 위치:

- 빌드 후: `src-tauri/target/release/bundle/nsis/`
- 배포: [GitHub Releases](https://github.com/golee75git/EduLanuncher/releases/latest)

## 문서 (다른 PC에서 이어서)

- [docs/HANDOFF.md](docs/HANDOFF.md) — 환경, 명령, Cloudflare, 미완
- [docs/PRD.md](docs/PRD.md) — 제품 요구
- [docs/PLAN.md](docs/PLAN.md) — 다음 작업
- [AGENTS.md](AGENTS.md) — Cursor가 여는 안내

Cursor는 이 폴더를 Open Folder 하면 `AGENTS.md`와 `.cursor/rules/`를 읽습니다. 채팅에 `@docs/HANDOFF.md`를 붙이면 됩니다.

## 웹 소개 사이트

`website/` — Cloudflare. 설명은 [website/README.md](website/README.md).
