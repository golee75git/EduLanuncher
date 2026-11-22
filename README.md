# EduLauncher (교육업무 런처) V0.1

Windows용 교육기관 업무 런처입니다. 평소에는 시스템 트레이에만 있고, 트레이 클릭 또는 `Ctrl + Alt + E`로 작은 패널을 엽니다.

## 설치

개인 사용 PC에만 설치하세요. 공용 PC, 실습실, 다른 사람의 계정에는 설치하지 않습니다. 설치는 파일과 폴더를 삭제하지 않습니다.

1. 설치 파일을 받습니다.
   [AILauncher_0.1.223-20261122_x64-setup.exe](https://github.com/golee75git/EduLanuncher/releases/download/0.1.223-20261122/AILauncher_0.1.223-20261122_x64-setup.exe)
   같은 버전의 날짜 복사본은 `AILauncher_2026-11-22_1400_x64-setup.exe`입니다. 최신 목록은 [GitHub Releases](https://github.com/golee75git/EduLanuncher/releases/latest)에 있습니다.
2. 받은 파일을 실행하고 설치를 마칩니다. 마침을 누르면 앱이 켜집니다.
3. 이후에는 시스템 트레이에 있습니다. 트레이를 누르거나 `Ctrl+Alt+E`로 패널을 엽니다.

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
