# 보안 2단계 1차 분석 — 업무자료 서명 검증과 링크 허용 목록

기준: 교육업무 런처 0.1.159-20261003  
기준일: 2026-10-03  
상태: 분석만 수행함. 코드는 수정하지 않음.

라이선스 준수를 보장하지 않음. 이 보고는 법적 검토가 아니다. 특허 비침해를 보장하지 않으며, 확인하지 않은 특허 번호는 적지 않는다.

수신은 웹뷰 `fetch`이고, 받은 JSON은 화면 데이터만 바꾼다. 바로가기·도구 목록에는 넣지 않는다. 지금 구조로는 서명 검증을 붙일 수 없고, `fixed_https.rs`는 크기·상태 코드·리다이렉트 때문에 그대로 쓸 수 없다.

## 1. 수신 흐름

시작 시 `App.tsx`의 bootstrap이 웹뷰에서 바로 받는다. Rust command는 없다. 설정 저장보다 먼저 호출된다.

| 호출 | 주소 | 저장 | 실패 시 |
| --- | --- | --- | --- |
| `refreshManualPack()` | `https://edulanuncher.zeroorder.kr/knowledge/catalog.json`, 이어서 `knowledge/pack/`의 `handbook.json`, `topics.json`, `master.json`, `epki.json` | Tauri Store `manual-pack.json`의 `pack` | 저장본을 먼저 적용. 네트워크 실패면 그 저장본 또는 설치본 JSON을 유지. 오류 창 없음 |
| `refreshManualIndex()` | `.../knowledge/search-index.json` | `manual-index.json`의 `index` | 저장본이 없으면 화면에 “교육행정 매뉴얼을 불러올 수 없습니다…” |

조건은 다음과 같다.

- 본창은 pack과 index를 둘 다 받는다. 업무 지도 창은 pack만 받는다. 메모 창은 받지 않는다.
- 파일당 상한 8,000,000바이트, 타임아웃 12초이다.
- pack 갱신 기준은 `catalog.json`의 `generatedAt` 문자열이 저장본과 다를 때이다. 숫자가 아니므로 이전 시각으로 되돌린 응답도 새 자료로 저장된다.
- index는 `updatedAt`이 같을 때만 건너뛴다.
- 빈 자료는 지금 거절된다. `replaceSection2`는 주제가 0개면 실패하고, `replaceTopicFile`은 10개 미만이면 실패한다. 하나라도 실패하면 저장하지 않는다.

관련 파일:

- `src/App.tsx`
- `src/services/manualPackService.ts`
- `src/services/manualIndexService.ts`
- `src/config/app.ts`의 `siteUrl`

## 2. JSON 안에서 열리는 값

런처가 실제로 받는 파일은 `catalog.json`, `pack/*.json` 4개, `search-index.json`이다.

사용자가 누르는 주소는 두 종류이다.

- 주제 자료의 `url` 또는 `sourceUrl`. `TopicCard`와 `ResourceCard`가 `launchQuickUrl`을 거쳐 opener로 연다. `http`/`https`만 파서가 남긴다. 저장소 기준으로 구조화된 주소는 `src/data/topics.json`의 `https://www.epki.go.kr/` 1건이다.
- 검색 결과. index의 주소 필드를 열지 않는다. 앱이 `https://edulanuncher.zeroorder.kr/menu/topic/{id}`를 만들어 연다. `id`는 경로 한 조각으로만 인코딩된다.

본문의 주소는 링크로 열리지 않는다. `src/data/knowledge/master.json` 본문에 `http://www.schoolinfo.go.kr`, `https://next.share.go.kr`, `https://total.comwel.or.kr`가 글자로 있다. 제목이 맞으면 앱 코드의 고정 주소 `schoolinfo.go.kr`, `g2b.go.kr`, `keiis.go.kr`를 대신 연다. 이 세 주소는 업무자료 파일이 아니라 `src/services/topicService.ts`의 `KNOWN_SITE_URL`에 있다.

업무자료 수신은 `toolStore`를 부르지 않는다. 사용자 확인 없이 바로가기나 도구를 추가하는 경로는 없다. 바로가기 추가는 별도의 `.edupack` 가져오기이다.

## 3. 사이트에서 파일이 생기는 지점

`website/package.json`의 `build`는 `node tools/copyKnowledge.mjs` 다음 `vite build`이다. 스크립트는 저장소의 편람·주제·master·epki를 읽어 `website/public/knowledge/`에 쓴다. Vite는 `public/`을 `dist/`로 복사하고, `wrangler deploy`는 `website/dist`를 올린다.

사이트 화면은 런처와 다른 파일을 읽는다. `website/src/services/menuContent.ts`는 `/knowledge/handbook.json`, `topics.json`, `master.json`, `epki.json`, `manual.json`이다. `pack/`은 런처 전용이다.

서명은 vite가 `dist`를 만든 뒤, wrangler 앞에 `website/dist/knowledge`를 서명하는 위치가 맞다. 빌드 스크립트가 매번 `generatedAt`을 현재 시각으로 바꾸므로, 일련번호는 그 시각과 분리해야 한다. 서명 실패 시 배포 명령이 끝나지 않게 묶는 것이 맞다.

사이트가 탈취되면 사이트 JavaScript도 같이 바뀌므로, 서명은 브라우저 방문자를 보호하지 않는다. 공개키가 들어 있는 런처만 보호한다.

## 4. `fixed_https.rs`를 그대로 쓸 수 없는 이유

재사용할 수 있는 부분은 https만 허용, 사용자 정보·공백 거부, 443 이외 포트 거부, WinHTTP GET, 타임아웃이다. 호스트를 고정하는 코드는 없다. 호출부가 `edulanuncher.zeroorder.kr`만 넘기면 된다.

그대로 쓰면 안 되는 부분은 다음과 같다.

- 응답 상한이 64KB이다. 업무자료 JSON은 이보다 크다. 프론트 상한은 8MB이다.
- HTTP 상태 코드를 보지 않는다.
- WinHTTP 기본값으로 리다이렉트를 따라간다. 다른 호스트의 본문이 섞일 수 있다.
- 타임아웃이 5초이다. 프론트는 12초이다.
- 문자열로 바꾼 뒤 돌려준다. SHA-256은 응답 바이트 원문에 계산해야 한다.

같은 파일에 크기 인자와 상태·리다이렉트 거부를 추가하는 편이 맞다. 버전 확인(`api.github.com`)과 공인 IP 조회도 이 함수를 쓰므로, 그 호출의 64KB 동작은 유지해야 한다.

`windows` crate 0.61에 `Win32_Security_Cryptography` feature는 아직 없다. 이 feature 추가는 허용 범위이고, 새 크레이트는 필요 없다.

## 5. CSP

운영 CSP와 개발 CSP의 `connect-src`에 `https://edulanuncher.zeroorder.kr`가 있다. 위치는 `src-tauri/tauri.conf.json`이다. 웹뷰에서 그 호스트로 요청하는 곳은 위 두 `fetch`뿐이다. 소개 사이트 열기와 버전 확인은 Rust·opener라 CSP와 무관하다.

수신을 Rust로 옮기면 운영 CSP와 개발 CSP 둘 다에서 그 출처를 뺄 수 있다. `ipc:`, `http://ipc.localhost`, 개발용 `localhost:1420`은 남겨야 한다.

## 6. 링크 허용 목록 초안

업무자료·그 화면에서 확인한 호스트이다. `https`만, 호스트가 아래와 같거나 그 하위 도메인일 때만이다. `go.kr`이나 `or.kr` 전체는 넣지 않는다.

- `edulanuncher.zeroorder.kr`
- `epki.go.kr`
- `schoolinfo.go.kr`
- `g2b.go.kr`
- `keiis.go.kr`
- `next.share.go.kr`
- `total.comwel.or.kr`

이 초안이면 현재 업무자료에서 열리는 주소 1건은 제외되지 않는다. 본문 글자 주소 3곳도 초안 안에 있다. `http://www.schoolinfo.go.kr`는 https 규칙 때문에 링크로는 제외된다.

업무자료가 아닌 주소는 이 목록에 넣지 않는 쪽이 맞다. PC 문제 해결의 `support.microsoft.com`, 일정·지도·속도 측정, GitHub Releases, 공인 IP 조회, 사이트 관리 화면의 `dash.cloudflare.com`이 여기 해당한다.

## 7. 설계에 대한 수정

- 빈 manifest는 성공으로 보되, 이미 있는 설치본·캐시를 지우지는 않는다. 지금 파서에 빈 배열을 넣으면 화면 자료가 사라진다.
- 일련번호는 `generatedAt`과 따로 둔다. 캐시가 없으면 검증된 첫 일련번호를 받고, 같으면 받지 않고, 더 작으면 저장하지 않는다.
- manifest 경로는 `knowledge/` 아래의 기대 파일만 허용한다. `..`, 절대 경로, 쿼리, 다른 폴더는 거부한다. 파일 수 상한은 지금 구성(6개)보다 조금 큰 정도로 고정한다.
- 서명은 manifest 바이트 원문에 하고, 해시도 파일 바이트 원문에 한다. 파싱 후 다시 만든 JSON에 계산하지 않는다.
- Node 서명은 DER이 아니라 raw `r||s` 64바이트(`ieee-p1363`)로 맞춘다. 공개키 상수는 65바이트 비압축 점(base64)으로 두고, 앱에서 CNG blob으로 바꾼다. 개인키는 만들지 않는다.
- 설정 두 개의 기본값은 켜짐으로 둔다. 설정을 읽기 전에 수신이 시작되므로, 순서를 바꿔야 꺼짐이 적용된다. 업무 지도 창의 pack 수신도 같은 설정을 따라야 한다.
- 검증 실패 때 새 오류 창은 만들지 않는다. index가 비었을 때 이미 있는 안내 문장을 둘지는 승인 때 정하면 된다.
- `ms-settings:`는 https 규칙과 문장이 겹친다. 업무자료에서는 https만 허용하고 `ms-settings:`도 무시하는 쪽을 제안한다.

## 고지 파일

`THIRD_PARTY_NOTICES` 재생성은 필요 없다. 패키지 추가가 없고, `windows` crate의 feature만 늘어난다.

## 승인 전에 확정할 항목

- 허용 도메인 초안
- 빈 자료일 때 설치본·캐시를 유지하는 처리
