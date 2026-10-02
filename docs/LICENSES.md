# 오픈소스 라이선스

기준일: 2026-10-03  
대상: 교육업무 런처 0.1.159-20261003

라이선스 준수를 보장하지 않음. 이 문서는 법적 검토가 아니다.

## 고지 파일을 다시 만드는 방법

```bat
npm run notices
npm run notices -- --site
```

`npm run notices`는 `src-tauri/resources/THIRD_PARTY_NOTICES.txt`를 만든다. `--site`는 `website/public/third-party-notices.txt`를 만든다. `--report`는 파일 없이 조사표만 출력한다.

의존성을 바꾸거나 릴리스하기 전에 `npm run notices`를 다시 실행한다. 경고가 있으면 고지 파일을 배포하지 않는다.

`license` 필드의 `A/B`는 Cargo의 옛 관용 표기이며 `A OR B`로 해석한다. `A OR B`에서는 MIT를 선택할 수 있으면 MIT를 선택하고 고지에 `선택: MIT`를 적는다.

## 분류

| 분류 | 라이선스 |
| --- | --- |
| 허용(고지 필요) | MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unicode-3.0, Unicode-DFS-2016, BSL-1.0 |
| 허용(고지 불필요) | CC0-1.0, 0BSD, Unlicense, Public Domain |
| 조건부 | MPL-2.0, LGPL, EPL, CDDL, 그 밖의 파일·라이브러리 카피레프트 |
| 금지 | GPL, AGPL, SSPL, 비상업 제한, 라이선스 없음, 판단 불가 |

## 승인 예외

이름과 버전이 함께 맞을 때만 예외이다. 버전이 바뀌면 스크립트가 다시 경고하고 고지 파일을 만들지 않는다.

| 이름 | 버전 | 라이선스 | 사유 |
| --- | --- | --- | --- |
| cssparser | 0.36.0 | MPL-2.0 | Tauri 기본 의존성, 수정 없이 사용 |
| selectors | 0.36.1 | MPL-2.0 | Tauri 기본 의존성, 수정 없이 사용 |
| dtoa-short | 0.3.5 | MPL-2.0 | Tauri 기본 의존성, 수정 없이 사용 |
| option-ext | 0.2.0 | MPL-2.0 | Tauri 기본 의존성, 수정 없이 사용 |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 | 라이선스 파일이 없어 소스 주석을 따름. 선택: MIT |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 | 라이선스 파일이 없어 소스 주석을 따름. 선택: MIT |
| unic-common | 0.9.0 | MIT/Apache-2.0 | 라이선스 파일이 없어 소스 주석을 따름. 선택: MIT |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 | 라이선스 파일이 없어 소스 주석을 따름. 선택: MIT |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 | 라이선스 파일이 없어 소스 주석을 따름. 선택: MIT |

### MPL-2.0

이 4개 크레이트의 파일을 수정하거나 vendor하면, 수정한 파일의 소스를 MPL-2.0으로 제공해야 한다. 수정하지 않는 한 런처 자체 코드 공개 의무는 없다.

2026-10-03 확인: `Cargo.toml`에 이 4개에 대한 `[patch]`, `[replace]`, path·git 의존성이 없고, `.cargo/config`와 vendor 디렉터리가 없으며, 저장소 안에 이 크레이트 소스를 복사한 폴더가 없다.

## 소개 사이트

고지 파일은 `website/public/third-party-notices.txt`이다. 바닥글의 「오픈소스 라이선스」가 이 파일을 연다. 이 작업에서 사이트를 배포하지 않았다.

## 사용자가 확인할 항목

- 저작권자 표시가 자리표시이면 릴리스하지 않음
- 라이선스 파일이 없는 패키지: webview2-com 0.38.2, webview2-com-sys 0.38.2. 저장소 표기만 있고 저작권 줄을 만들지 않았다.
- WebView2Loader 라이선스 원문이 크레이트에 없음
- NSIS 공식 라이선스 페이지에서 내용 확인
- HWPX(한글) 이용 조건
- 공모·제출처가 요구하는 오픈소스 고지
- 릴리스 전 공개 SW 라이선스 검증 서비스
- 앱 아이콘(`src-tauri/icons`)의 제작 출처와 이용 조건

## 릴리스 전 체크리스트

- 저작권자 표시가 자리표시이면 릴리스하지 않음
- `npm run notices`를 실행한다.
- 경고가 없는지 확인한다.
- 설치 폴더에 `THIRD_PARTY_NOTICES.txt`가 있는지 확인한다.
- 설정의 프로그램 정보에서 오픈소스 라이선스가 열리는지 확인한다.
