# 오픈소스 라이선스 2단계 — 2-0에서 중지

기준: 교육업무 런처 0.1.157-20261003  
기준일: 2026-10-03  
상태: Rust 전이 의존성 조사만 완료. 고지 파일과 앱은 수정하지 않음.

라이선스 준수를 보장하지 않음. 이 보고는 법적 검토가 아니다.

1단계(`docs/license-survey-2026-10-03.md`)를 승인받은 뒤 2-0만 수행했다. 실행 파일에 조건부 4개, 판단 불가 5개가 있어 2-1 이후는 진행하지 않았다.

## 조사 방법

`scripts/gen-third-party-notices.mjs`를 `--report`로 실행했다. 의존성은 추가·삭제·버전 변경하지 않았다. 새 도구를 설치하지 않았고, 네트워크로 라이선스 원문을 조회하지 않았다. 개인정보 보호 기능 코드는 수정하지 않았다.

Rust 그래프는 아래 명령으로 만들었다.

`cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc --offline --locked`

일반 의존성의 `kind`는 문자열 `"normal"`이 아니라 `null`이다. `kind`가 `null`인 간선만 실행 파일 쪽으로 따라갔고, 대상이 `x86_64-pc-windows-msvc`에서 참인 경우만 포함했다. `build` 간선만으로 도달하는 패키지와 proc-macro는 빌드 전용이다. 기본 feature 기준이며 `fixtures`는 제외했다.

npm은 `npm ls --omit=dev --all --json`이다. `extraneous`와 개발 의존성, 선택적 peer는 운영 의존성에서 빼서 1단계와 같은 11개만 남겼다. SPDX가 아닌 `MIT/Apache-2.0` 표기는 로컬 `LICENSE` 파일 문구로 다시 판단했다. 파일에서 MIT 문구가 확인되면 MIT를 선택했다.

## A. 개수

실행 파일 256개, 빌드 전용 69개, 앱 npm 운영 의존성 11개(MIT 10, ISC 1). npm 운영 의존성에는 조건부·금지가 없다.

| 구분 | 라이선스 | 개수 |
| --- | --- | --- |
| 실행 파일 | MIT | 206 |
| 실행 파일 | Unicode-3.0 | 15 |
| 실행 파일 | Apache-2.0 | 14 |
| 실행 파일 | BSD-3-Clause | 5 |
| 실행 파일 | Zlib | 2 |
| 실행 파일 | Apache-2.0 AND MIT | 1 |
| 실행 파일 | BSD-3-Clause AND MIT | 1 |
| 실행 파일 | MIT AND BSD-3-Clause | 1 |
| 실행 파일 | MIT AND Unicode-3.0 | 1 |
| 실행 파일 | MIT-0 | 1 |
| 실행 파일 | MPL-2.0 (조건부) | 4 |
| 실행 파일 | MIT/Apache-2.0 (판단 불가) | 5 |
| 빌드 전용 | MIT | 63 |
| 빌드 전용 | Unicode-3.0 | 3 |
| 빌드 전용 | Apache-2.0 | 2 |
| 빌드 전용 | MPL-2.0 (`cssparser-macros` 0.6.1, proc-macro) | 1 |

금지 라이선스는 실행 파일 목록에 없다. 빌드 전용 `cssparser-macros` 0.6.1(MPL-2.0)은 proc-macro라 실행 파일 중지 조건에는 넣지 않았다.

## B. 조건부

직접 의존성은 모두 `tauri` 2.11.5이다. 플러그인도 `tauri`를 쓰므로 같은 크레이트가 그 경로로도 연결된다.

| 이름 | 버전 | 라이선스 | 포함 경로 |
| --- | --- | --- | --- |
| cssparser | 0.36.0 | MPL-2.0 | tauri → tauri-utils → dom_query |
| selectors | 0.36.1 | MPL-2.0 | tauri → tauri-utils → dom_query |
| dtoa-short | 0.3.5 | MPL-2.0 | tauri → tauri-utils → dom_query → cssparser |
| option-ext | 0.2.0 | MPL-2.0 | tauri → dirs → dirs-sys |

선택지:

- 예외로 승인한다. MPL-2.0은 그 파일만 카피레프트이다. 해당 파일을 수정하면 그 파일의 소스를 MPL-2.0으로 제공해야 하고, 고지 파일에 전문이 들어간다. 승인 예외 목록은 지금 비어 있다.
- 의존성을 바꾸지 않고는 빼지 못한다. `dom_query`와 `dirs`는 Tauri 기본 의존성이다.

## C. 판단 불가

로컬 크레이트 폴더에 `LICENSE`/`COPYING`/`NOTICE` 파일이 없다. `license` 필드는 SPDX가 아닌 `MIT/Apache-2.0`이다. 소스 첫머리는 Apache-2.0 또는 MIT라고 적고 `LICENSE-APACHE`, `LICENSE-MIT`, `COPYRIGHT`를 가리키지만, 그 파일은 배포된 크레이트에 없다. 네트워크로 원본 저장소를 조회하지 않았으므로 판단 불가로 남겼다.

| 이름 | 버전 | 라이선스 | 포함 경로 |
| --- | --- | --- | --- |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 | tauri → tauri-utils → urlpattern |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 | urlpattern → unic-ucd-ident |
| unic-common | 0.9.0 | MIT/Apache-2.0 | unic-ucd-ident → unic-ucd-version |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 | unic-ucd-ident 계열, 직접 의존성은 tauri |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 | unic-ucd-ident 계열, 직접 의존성은 tauri |

선택지:

- 소스 주석만으로 MIT 선택을 예외 승인한다. 승인하면 고지에 `선택: MIT`와 주석의 저작권 줄을 적는다.
- 의존성을 바꾸지 않고는 `urlpattern`/`unic`을 빼지 못한다.

## D. 하지 않은 일

고지 파일, `package.json` 스크립트, 설치본 리소스, 설정 화면, 소개 사이트, `docs/LICENSES.md`는 만들지 않았다. 조사 스크립트만 `scripts/gen-third-party-notices.mjs`에 있다. 2-1 이후는 위 9개가 해결된 뒤에 진행한다.
