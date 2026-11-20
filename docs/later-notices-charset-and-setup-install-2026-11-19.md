# 나중 개선 — 오픈소스 고지 글자, 패널에서 설치

기준일: 2026-11-19  
기준 버전: `0.1.209-20261119`  
상태: 기록만 남김. 이 문서를 쓰는 동안 소스, 설정, 설치 파일, 사이트 배포는 바꾸지 않았다.

두 건 다 아직 하지 않는다. 할 때는 이 문서의 제약 안에서 따로 설계한다. 외부 업데이터 구현을 복사·번역·변형하지 않는다. 새 패키지는 넣지 않는다. 패키지가 꼭 필요하면 이름, 버전, 출처, 라이선스, 이유를 먼저 적고 코드에는 그때 넣지 않는다. 특허 비침해를 보장하지 않으며, 특허 검토가 필요한 구성은 작업 때 `docs/IP_DESIGN_LOG.md`에 적는다.

## 1. 오픈소스 라이선스 글자가 깨짐

주소: `https://edulanuncher.zeroorder.kr/third-party-notices.txt`

확인:

- 저장소 `website/public/third-party-notices.txt`와 배포된 파일의 글은 UTF-8이다. `업무 런처`로 시작한다. 바이트가 깨진 상태가 아니다.
- `scripts/gen-third-party-notices.mjs`는 BOM 없는 UTF-8로 저장한다.
- 바닥글 `website/src/components/SiteFooter.tsx`의 「오픈소스 라이선스」가 이 `.txt`를 그대로 연다.
- `website/src/worker/opinion.ts`는 정적 파일을 `ASSETS`에서 받은 그대로 돌려준다. `/knowledge` 캐시 헤더만 덧붙인다. 이 파일에는 `charset`을 붙이지 않는다.
- Worker가 직접 만드는 짧은 글(`plain`)만 `text/plain; charset=utf-8`이다. 고지 파일에는 적용되지 않는다.
- `.txt` 기본 헤더는 `Content-Type: text/plain`이다. charset이 없으면 브라우저는 이 본문을 UTF-8로 읽지 않는다. 한국어 Windows에서는 EUC-KR, 그 외에는 windows-1252로 읽어 한글이 깨져 보인다. 같은 사이트의 HTML은 `<meta charset="UTF-8">`가 있어서 정상이다.

나중에 할 일:

- 이 응답만 `Content-Type: text/plain; charset=utf-8`로 준다.
- 넣는 위치는 `website/src/worker/opinion.ts`에서 `/third-party-notices.txt`를 돌려주기 전, 또는 배포 자산의 헤더 파일. 둘 중 한 곳이면 된다.
- 소개 사이트만 다시 배포한다. 설치 프로그램은 다시 만들지 않는다.
- 고지 본문, 생성 스크립트, 설치본의 `THIRD_PARTY_NOTICES.txt`는 이 건으로 바꾸지 않는다.

## 2. 새 버전을 패널에서 설치

지금:

- 켤 때 한 번과 설정의 「지금 확인」이 `https://api.github.com/repos/golee75git/EduLanuncher/releases/latest`의 `tag_name`만 읽는다. 비교는 `src/services/releaseCheckService.ts`, 읽기는 `src-tauri/src/netutil.rs`의 `latest_release_tag`와 `src-tauri/src/fixed_https.rs`이다.
- 더 새면 패널과 설정에 이 PC 버전과 새 버전을 보여 준다. 단추 「최신 설치 파일 받기」는 그 태그가 `숫자.숫자.숫자-8자리`일 때만 `AILauncher_<태그>_x64-setup.exe` 주소를 브라우저로 연다. 파일을 받아 실행하지는 않는다. 소개 사이트는 설정 맨 아래 단추로 그대로 연다.
- 제품 기준은 브라우저로 받은 파일을 사용자가 실행하는 것이다. 앱이 설치 파일을 받아 실행하는 일은 아직 없다.

나중에 할 일:

- 안내 단추를 누르면, 방금 확인한 태그의 설치 파일만 받아 현재 사용자용 NSIS를 실행한다.
- 주소 형식은 소개 사이트가 이미 쓰는 것과 같다. `website/src/config.ts`의 `setupDownloadUrl` 참고.

`https://github.com/golee75git/EduLanuncher/releases/download/<태그>/AILauncher_<태그>_x64-setup.exe`

- 태그는 `0.1.209-20261119` 형식이고, 방금 읽은 최신 태그와 같고, 이 PC 버전보다 클 때만 받는다.
- 받는 동안에는 안내만 둔다. 설치 창 전에 런처를 종료한다. 실행 중인 exe를 설치 프로그램이 바꿀 수 있어야 한다. 마침을 누르면 새 버전이 다시 켜지는 지금의 NSIS 동작은 유지한다. `src-tauri/windows/hooks.nsh`는 마침에서 프로그램을 연다.
- 설치 방식은 `src-tauri/tauri.conf.json`의 `installMode: currentUser` 그대로다.

막히는 점:

- `fixed_https.rs`는 리다이렉트를 거부하고, 버전 확인 본문 상한은 64KB이다. GitHub 설치 파일 주소는 다른 호스트로 넘어가고 파일은 그보다 크다. 기존 `read_https`로 받으면 실패한다.
- 설치 파일만 따로 받는다. 용량 상한을 두고, 임시 폴더에 저장한 뒤 그 파일만 실행한다. 응답 본문은 로그에 남기지 않는다.
- 허용 호스트와 파일 이름을 코드에 고정한다. 화면에서 온 주소로 받지 않는다.

서명:

- 저장소에 코드 서명 개인키는 없다. 서명이 없으면 받은 파일이 그 릴리스인지 암호로 확인할 수 없다.
- 첫 단계는 사용자가 누른 뒤에만 받아 설치 창을 연다. 켤 때마다 묻지 않고 깔지는 않는다. 무인 설치는 서명을 넣은 뒤로 미룬다. 개인키는 저장소에 넣지 않는다. `docs/security-review-2026-10-02.md`의 업데이터 메모와 같다.

이미 깔린 프로그램:

- 지금 설치본에는 받기 명령이 없다. 이 기능이 들어간 설치 파일은 한 번은 소개 사이트에서 받아야 한다. 그 다음 버전부터 패널에서 설치할 수 있다.
- 구현하면 버전 날짜를 올리고 `.\tauri-env.cmd build`로 NSIS를 다시 만든 뒤 GitHub Release에 올린다. 소개 사이트 다운로드 주소도 그 파일로 맞춘다.

하지 않을 것:

- 소개 사이트를 여는 지금의 안내를, 받기 기능이 들어가기 전에 지우지 않는다.
- 기관 정책으로 시작 시 버전 확인이 꺼진 경우(`disableStartupUpdate`)에는 받지 않는다.
- 백그라운드에서 설치 파일을 미리 받아 두지 않는다.
