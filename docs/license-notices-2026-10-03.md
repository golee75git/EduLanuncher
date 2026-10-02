# 오픈소스 라이선스 2-1 이후 구현

기준: 교육업무 런처 0.1.158-20261003  
기준일: 2026-10-03  
상태: 고지 파일, 설치본 포함, 설정 화면, 소개 사이트 링크, 문서를 반영함. 커밋·릴리스 업로드·사이트 배포는 하지 않음.

라이선스 준수를 보장하지 않음. 이 보고는 법적 검토가 아니다.

저작권자 이름은 비어 있어 화면에 `교육업무 런처 © 2026 [저작권자]`로 두었다. `Cargo.toml` authors는 바꾸지 않았다.

이전 설치본은 지우고 아래 파일로 바꿔야 한다. 둘 다 3,697,846바이트이다.

- `src-tauri\target\release\bundle\nsis\EduLauncher_0.1.158-20261003_x64-setup.exe`
- `src-tauri\target\release\bundle\nsis\EduLauncher_2026-10-03_0116_x64-setup.exe`

## H. 예외 1 사전 확인

`[patch]`, `[replace]`, vendor, path·git 의존성, 저장소 안 복사 폴더는 없다. MPL 4개는 로컬 cargo registry의 crates.io 패키지이다.

## B. 생성·수정 파일

새로 만든 파일:

- `scripts/gen-third-party-notices.mjs`
- `src-tauri/resources/THIRD_PARTY_NOTICES.txt`
- `website/public/third-party-notices.txt`
- `docs/LICENSES.md`

고친 파일:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/lib.rs`
- `src/pages/SettingsPage.tsx`
- `src/config/app.ts`
- `website/src/App.tsx`
- `website/src/components/SiteFooter.tsx`
- `website/src/config.ts`
- `website/src/data/releases.ts`
- `수정기록.txt`

글꼴은 기존 Windows 시스템 글꼴이고, OFL 글꼴 파일은 넣지 않았다. 새 패키지는 없다.

## C. 고지 구성요소

앱 고지: Rust 실행 파일 256, npm 11, 고정 항목 2(SQLite, NSIS). 파일 크기 313,189바이트. 경고(조건부·금지·판단 불가) 없음.

사이트 고지: npm 4. `website/node_modules`가 없고 오프라인 캐시에 `lucide-react` 1.47.0이 없어, react·react-dom·scheduler는 같은 버전의 런처 `node_modules` 라이선스 파일을 썼다.

## D. Rust 크레이트에서 빌린 라이선스 파일

- `@tauri-apps/plugin-autostart` → `tauri-plugin-autostart` 2.5.1
- `@tauri-apps/plugin-dialog` → `tauri-plugin-dialog` 2.7.3
- `@tauri-apps/plugin-global-shortcut` → `tauri-plugin-global-shortcut` 2.3.2
- `@tauri-apps/plugin-opener` → `tauri-plugin-opener` 2.5.5
- `@tauri-apps/plugin-store` → `tauri-plugin-store` 2.4.4

## E. NSIS·압축

`tauri.conf.json`에 compression 키가 없다. 로컬 `tauri-utils` 2.9.3의 기본값은 LZMA이다. Tauri 설치 스크립트 템플릿은 Apache-2.0 OR MIT이고, 선택은 MIT이다. NSIS 라이선스 원문과 LZMA 구성요소 라이선스 원문 파일은 로컬에서 찾지 못했다.

## F. 라이선스 파일 없음 또는 확인 불가

- NSIS 라이선스 원문: 확인 불가
- LZMA 구성요소 라이선스 원문: 확인 불가
- `selectors` 0.36.1: 크레이트 폴더에 LICENSE 없음. 다른 로컬 MPL-2.0 LICENSE 전문을 한 번 넣었다.
- 사이트 `lucide-react` 1.47.0: 설치된 폴더 없음. `package-lock.json`의 ISC만 적고 라이선스 파일 없음으로 남겼다.

포함 패키지 루트에서 Apache `NOTICE` 파일은 찾지 못했다.

## I. NOTICE

실행 파일·npm 고지에 넣은 NOTICE 파일은 없다.

## J. unic 저작권 줄

| 패키지 | 출처 | 문구 |
| --- | --- | --- |
| unic-char-property 0.9.0 | `src/lib.rs` | Copyright 2017 The UNIC Project Developers. |
| unic-char-range 0.9.0 | `src/lib.rs` | Copyright 2017 The UNIC Project Developers. |
| unic-common 0.9.0 | `src/lib.rs` | Copyright 2017 The UNIC Project Developers. |
| unic-ucd-ident 0.9.0 | `src/lib.rs` | Copyright 2017-2019 The UNIC Project Developers. |
| unic-ucd-version 0.9.0 | `src/lib.rs` | Copyright 2017 The UNIC Project Developers. |

선택은 MIT이다. 고지에는 라이선스 파일이 패키지에 없어 소스 주석을 따랐다고 적혀 있다.

## K. 라이선스별 개수

실행 파일 256개의 선택 결과이다. 2-0의 MIT 206, 판단 불가 5와 숫자가 다르다. 승인된 `A/B` = `A OR B` 규칙으로 MIT를 선택하면서, 판단 불가 5개와 그때 파일 문구로 Apache·BSD에 두었던 13개가 MIT로 옮았다. 206+18=224. MPL-2.0 4개는 그대로이다.

| 선택 라이선스 | 실행 파일 |
| --- | --- |
| MIT | 224 |
| Unicode-3.0 | 15 |
| BSD-3-Clause | 4 |
| MPL-2.0 | 4 |
| Apache-2.0 | 2 |
| Zlib | 2 |
| Apache-2.0 AND MIT | 1 |
| BSD-3-Clause AND MIT | 1 |
| MIT AND BSD-3-Clause | 1 |
| MIT AND Unicode-3.0 | 1 |
| MIT-0 | 1 |

npm 11개는 MIT 10, ISC 1이다. 고지 파일 전체 선택 개수는 MIT 234, ISC 1, 나머지는 위 실행 파일 개수와 같다.

## G. 빌드와 확인 절차

`cargo check` 성공, `cargo test` 79개 통과, `npm run build` 성공, 소개 사이트 빌드 성공, `npm run tauri build` 성공이다. `npm run notices`는 경고 없이 끝났다.

설치 후 확인: 현재 사용자 설치 폴더에서 `edulauncher.exe` 옆에 `THIRD_PARTY_NOTICES.txt`가 있는지 본다. 빌드 결과물에는 `src-tauri\target\release\THIRD_PARTY_NOTICES.txt`로 이미 있다.

앱 화면 확인: 설정의 프로그램 정보에서 `교육업무 런처 © 2026 [저작권자]` 아래 `오픈소스 라이선스`를 누른다. 고지 본문이 그 자리에서 열리고, 원격으로 받아 오지 않는다. 이 세션에서는 설치된 창을 눌러 보지 않았다.

저작권자 이름을 정하면 `[저작권자]`만 바꾸면 된다.
