# AGENTS.md

Cursor가 이 저장소를 열면 이 파일을 읽는다. 이어 작업은 `docs/HANDOFF.md`가 기준이다.

필수 문서:

- `docs/HANDOFF.md` — 현재 버전, 명령, Cloudflare, 미완
- `docs/PRD.md` — 무엇을 만들고 무엇을 안 하는지
- `docs/PLAN.md` — 다음 작업
- `CLAUDE.md` — 아키텍처
- `docs/IP_DESIGN_LOG.md` — 기능 출처

항상:

- 최소수정. 요청하지 않은 화면은 건드리지 않음
- UI·커밋은 한국어
- 타 런처 UI 복제 없음. 로고·파비콘 복사 없음. 학교 시스템 스크랩·자동로그인 없음
- 설치본이 필요한 변경이면 버전 날짜를 올리고 `.\tauri-env.cmd build` 후 경로를 알리고, 가능하면 GitHub Release에 `.exe` 업로드
- Cloudflare는 `website/`만 빌드. Root directory는 `website`
- `.exe`를 git에 넣지 않음
