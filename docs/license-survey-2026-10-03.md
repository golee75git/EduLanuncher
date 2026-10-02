# 오픈소스 라이선스 전수 조사 — 1단계

기준: 교육업무 런처 0.1.157-20261003 (개인정보 보호 V1 Phase 4 완료 상태)  
기준일: 2026-10-03  
상태: 조사만 완료. 고지 파일 생성·포함(2단계)은 시작하지 않음.

라이선스 준수를 보장하지 않음. 이 보고는 법적 검토가 아니다.

이 세션에서는 `cargo metadata`와 `npm ls`를 실행하지 못했다. Rust 쪽 플랫폼 필터 그래프는 그래서 확정하지 못했다. npm 운영 의존성은 `package-lock.json`과 설치된 `node_modules`로 확인했다. `Cargo.lock` 전체 개수를 배포본 개수로 쓰지 않는다. 그 파일에는 Windows 빌드에 들어가지 않는 Linux 크레이트(`atk`, `cairo-rs`, `dbus` 등)가 함께 있다.

## A. 개수

| 구분 | 개수 |
| --- | --- |
| Rust, 실행 파일에 포함 | 확인 불가. 직접 의존성만 아래에서 확인 |
| Rust, 빌드 전용 | 확인 불가. `tauri-build` 2.6.3과 SQLite용 `cc`는 빌드 전용으로 판단 |
| Rust, 개발 전용 | 루트 `Cargo.toml`에 `[dev-dependencies]` 없음 |
| `fixtures` 전용 | 없음. `fixtures = []`이고 `privacy_fixtures`는 그 feature가 있을 때만 빌드되어 설치본에 없음 |
| 런처 npm 운영 의존성 | 11 |
| 런처 npm 개발 의존성 | 고지 대상 아님. 잠금 파일의 MPL 패키지는 모두 `dev: true` |
| 패키지 관리자 밖 | SQLite 본문, NSIS 템플릿, WebView2, 아이콘 |
| 소개 사이트 npm 운영 의존성 | 4 |

## B. 라이선스별 개수

런처 npm 운영 의존성만 집계했다. `A OR B`는 MIT를 선택했다.

| 분류 | 라이선스 | 개수 |
| --- | --- | --- |
| 허용(고지 필요) | MIT | 10 |
| 허용(고지 필요) | ISC | 1 |
| 조건부·금지 | — | 0 |

소개 사이트 운영 의존성도 같다. MIT 3, ISC 1.

확인한 Rust 직접 의존성은 모두 MIT이거나 `Apache-2.0 OR MIT` / `MIT OR Apache-2.0`이다. 선택한 라이선스는 MIT이다. 전이 의존성 전체의 라이선스별 개수는 확인 불가이다.

## C. 조건부·금지

런처와 소개 사이트의 npm 운영 의존성에는 없다.

개발 의존성으로만 있는 조건부 패키지:

| 이름 | 버전 | 라이선스 | 들어오는 경로 | 배포본 |
| --- | --- | --- | --- | --- |
| lightningcss | 1.33.0 (런처), 1.32.0 (사이트와 Tailwind 중첩) | MPL-2.0 | `vite`, `@tailwindcss/node`의 devDependency | JS 운영 의존성에는 없음 |
| lightningcss-win32-x64-msvc 등 플랫폼 패키지 | 위와 같음 | MPL-2.0 | lightningcss의 optionalDependency, `dev: true` | 없음 |

Rust 전이 의존성 중 조건부·금지 여부는 확인 불가이다. 잠금 파일에 이름이 있어도 Windows 실행 파일에 링크된다고 보지 않았다.

## D. 라이선스 파일 또는 저작권 표시를 찾지 못한 패키지

npm:

| 패키지 | 버전 | 상태 |
| --- | --- | --- |
| `@tauri-apps/api` | 2.11.1 | `LICENSE_MIT` 있음. Copyright (c) 2017 - Present Tauri Apps Contributors. Apache 전문 파일과 NOTICE는 이 폴더에서 열리지 않음 |
| `@tauri-apps/plugin-autostart` | 2.5.1 | `package.json`은 `LICENSE`를 배포 파일로 적지만, 설치된 폴더에서 그 파일은 열리지 않음. authors에 Tauri Programme within The Commons Conservancy |
| plugin-dialog 2.7.3, plugin-global-shortcut 2.3.2, plugin-opener 2.5.5, plugin-store 2.4.4 | 같음 | 같은 상태 |

아래는 LICENSE 파일과 저작권 줄이 있다.

- react 19.3.0, react-dom 19.3.0, scheduler 0.28.0 — Copyright (c) Meta Platforms, Inc. and affiliates.
- zustand 5.0.15 — Copyright (c) 2019 Paul Henschel
- lucide-react 1.46.0 — ISC, Copyright (c) 2026 Lucide Icons and Contributors

Rust 전이 패키지의 LICENSE 파일 유무는 확인 불가이다.

## E. Apache-2.0 NOTICE

npm 운영 의존성 폴더에서는 NOTICE 파일을 찾지 못했다. `Apache-2.0 OR MIT`인 `@tauri-apps/api`도 선택한 라이선스는 MIT이다.

Rust 패키지의 NOTICE 목록은 확인 불가이다.

## F. 패키지 관리자 밖

**SQLite.** `rusqlite` 0.40.2는 `bundled`만 켜져 있고 기본 feature는 꺼져 있다. `libsqlite3-sys` 0.38.2의 license 필드는 MIT이다. `bundled`는 `cc`로 `sqlite3/sqlite3.c`를 컴파일한다. 그 헤더에는 저작권 포기가 있고, SQLite 축복 문구가 있다. 분류표의 Public Domain에 해당한다. SQLCipher feature는 켜져 있지 않다.

**NSIS.** `src-tauri/windows/installer.nsi` 첫 주석은 Tauri NSIS 템플릿, Apache-2.0 OR MIT, tauri-cli 2.11.4이다. `hooks.nsh`는 이 저장소의 훅이다. 설치 프로그램에 들어가는 NSIS 스텁의 라이선스 원문 파일은 이번 조사에서 열지 못했다. 그 부분은 확인 불가이다.

**WebView2.** `tauri.conf.json`에 설치 방식이 없다. 로컬 `tauri-utils` 2.9.3의 기본값은 `DownloadBootstrapper`이다. 런타임은 설치본에 들어 있지 않고, 없을 때 설치 과정에서 부트스트래퍼를 받는다. Microsoft 구성요소이며 오픈소스 고지 대상의 번들 라이브러리는 아니다.

**아이콘·이미지.** `src-tauri/icons`의 png, ico, icns가 설치 아이콘이다. 옆에 제3자 라이선스 문구는 없다. 외부에서 가져온 자산이라는 기록도 이 조사에서 찾지 못했다.

**복사한 코드.** `favicon_db.rs`는 SQLite 파일 형식 문서를 보고 새로 썼다고 적혀 있다. `installer.nsi`는 Tauri 템플릿을 바탕으로 한 파일이라 Tauri 라이선스 고지에 포함된다. 소스에서 다른 저장소의 SPDX 저작권 헤더는 찾지 못했다.

## G. 소개 사이트

운영 의존성은 네 개이다.

- react 19.3.0, MIT
- react-dom 19.3.0, MIT, scheduler에 의존
- scheduler 0.28.0, MIT
- lucide-react 1.46.0, ISC

고지 위치 제안: 소개 사이트의 다운로드 페이지 또는 바닥글에 “오픈소스 라이선스” 링크를 두고, 사이트 전용 고지 문서를 정적 파일로 제공한다. 이번 단계에서는 사이트 파일을 수정하지 않았다.

## H. 선택지

의존성은 바꾸지 않았다.

- lightningcss(MPL-2.0)는 개발 도구이다. 배포되는 JS 운영 의존성이 아니므로 그대로 두어도 런처 고지 목록에는 넣지 않는다. 나중에 이 패키지 자체를 배포하면 MPL-2.0의 파일 단위 고지와 소스 제공을 따로 봐야 한다.
- Rust 전이 의존성에서 GPL, AGPL 또는 라이선스 없음이 나오면, 그때 대체·제거·예외 중 하나를 고른다. 지금은 그 목록이 확인 불가이다.
- SQLite 축복 문구는 Public Domain이라 고지가 필수는 아니어도, 2단계 고정 항목으로 넣는 쪽이 안전하다.

## I. 2단계 제안

승인한 뒤에만 진행한다.

- `scripts/gen-third-party-notices.mjs`는 Node 내장 모듈만 쓰고, `cargo metadata --filter-platform x86_64-pc-windows-msvc`와 `npm ls --omit=dev`로 이번과 같은 목록을 만든다.
- 출력은 `src-tauri/resources/THIRD_PARTY_NOTICES.txt`이다. 저작권 줄은 패키지마다 남기고, 같은 전문은 한 번만 묶을 수 있다. Apache NOTICE는 빠뜨리지 않는다.
- 고정 항목은 SQLite 축복 문구, NSIS 스텁(원문 경로를 찾은 뒤), Tauri 설치 스크립트 템플릿이다. `privacy_fixtures`와 `fixtures` 전용 항목은 넣지 않는다.
- 조건부·금지가 새로 나오면 0이 아닌 코드로 끝낸다. 승인 예외만 스크립트 상단 상수로 둔다.
- 설치본에는 `bundle.resources`로 넣고, 설정의 [오픈소스 라이선스]에서 리소스 파일만 읽는다. 앱 저작권 표시는 `Cargo.toml`의 `authors = ["EduLauncher"]`뿐이라 사람 이름과 연도는 아직 없다. 자리표시로 두고 보고하는 구성이 맞다.

2단계는 시작하지 않았다. 전이 Rust 목록을 확정하려면 `cargo metadata`를 다시 돌려야 한다.
