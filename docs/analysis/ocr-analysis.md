# 텍스트 추출(OCR) 분석

기준일: 2026-10-05  
대상: AI런처 (`AILauncher`) 기존 저장소  
상태: 분석만. 기능 코드와 새 패키지는 넣지 않았다.

라이선스 준수를 보장하지 않음. 이 문서는 법적 검토가 아니다. 특허 비침해를 보장하지 않으며, 확인하지 않은 특허 번호는 적지 않는다. 모델·패키지를 내려받지 않았다. 확인하지 못한 라이선스와 용량은 "확인 필요"로 둔다.

결정 5개와 추가 2개는 기본값으로 고정했다.

## 1. 결정 (기본값으로 고정)

1. **1차 OCR 언어는 한국어와 영어만.** 일본어·중국어·라틴 계열은 언어 팩을 끼울 자리만 1차에 두고, 모델 파일은 2차. 기본값을 바꾸면 언어마다 모델 라이선스와 용량을 1차에 확인해야 해서 작업이 커진다.
2. **같은 와이파이 QR 전송은 2차.** 1차 입력은 파일 놓기, 파일 선택, 클립보드, 화면 영역 캡처. 포트를 열면 지금 지키는 로컬 범위가 넓어진다.
3. **가림은 복사·저장에서는 꺼 두고, AI로 보낼 때만 켠다.** 주민번호·카드·계좌가 기준 개수 이상이면 꺼 둔 상태에서도 보내기 전에 경고. 설정에서 항상 켬/항상 끔. 항상 켜면 고지서를 그대로 베끼는 흐름이 느려지고, 항상 끄면 보내기 전 거름이 약해진다.
4. **인쇄물 우선.** 칠판 사진은 보정과 인식은 하되 손글씨·수식은 직접 확인하라는 안내. 손글씨를 1차 목표로 하면 정확도 검증이 커진다.
5. **1차는 개인 설정만.** 설정 키는 나중에 정책으로 잠글 수 있게 이름만 맞춘다. 정책 파일 읽기와 잠금은 2차. 1차에 잠금까지 넣으면 조직 배포 검증이 늘어난다.

추가, 같은 형식으로 기본값을 둔다.

6. **HWPX 저장은 1차에 넣지 않는다.** 1차 내보내기는 복사, TXT, DOCX, XLSX, 검색 가능한 PDF. 이 저장소는 HWPX를 읽기만 하고 새 HWPX를 쓰지 않는다. 허용된 쓰기 라이브러리는 확인되지 않았다. 1차에 직접 작성하면 규모가 L로 커진다.
7. **앱 문구는 1차에 한국어만.** 화면 문자열은 이미 한국어로 박혀 있고 다국어 표가 없다. 영어 UI를 1차에 넣으면 문구 분리가 먼저 필요하다. OCR 언어(한국어+영어)와 화면 언어는 별개다.

## 2. 한 줄 결론

텍스트 추출은 지금 Rust 프로그램 안의 별도 작업으로 두고, Python 보조 프로세스는 두지 않는다. 모델 파일은 공식 라이선스 원문을 확인하기 전에는 넣지 않는다. 1단계 뼈대는 결과 형식, 해시 검사 자리, 네트워크를 열지 않는 테스트만 만든다.

Python과 `opencv-python` 휠은 이 저장소에 없는 두 번째 런타임이고, 휠 안의 FFmpeg(LGPL)와 HEIC 디코더는 확인 전이다. stdin JSON으로 나눈 프로세스는 언어 팩을 갈아 끼우기에는 낫지만, 1차에는 프로세스를 둘로 늘리지 않는 편이 설치 크기와 시작이 단순하다. 확인된 ONNX 모델을 넣는 단계에서 같은 프로세스의 ONNX Runtime(후보, 라이선스 확인 필요)을 쓴다.

기존 Windows 글자 인식(`Windows.Media.Ocr`)은 사진 모자이크의 숫자·글자 찾기용으로 둔다. 문서 추출의 본엔진으로 쓰지 않는다. 그 모델은 설치 파일에 들어 있지 않고, 한국어 팩이 없으면 꺼진다. 동봉·해시 검증 규칙과 맞지 않는다.

## 3. 기존 런처 현황

스택: Tauri 2, Rust 2021, React 19, TypeScript, Vite, Tailwind, Zustand. Windows 현재 사용자 NSIS 설치. 실행 파일 이름은 `AILauncher.exe`, 바로가기 이름은 `AILauncher`, 창 제목은 `AI런처`. 코드 서명 없음. 자동 설치 없음. 새 버전은 소개 사이트와 GitHub Releases를 사용자가 연다. 테스트는 `cargo test --lib`과 `npm run build`. CI 설정 파일은 이 분석에서 찾지 못했다.

| 위치 | 역할 |
| --- | --- |
| `src-tauri/src/lib.rs` | 트레이, 창, 파일 연결, 시작 프로그램, Tauri 명령 |
| `src-tauri/src/drop_target.rs` | 탐색기 끌어다 놓기 |
| `src-tauri/src/privacy_find.rs` | 사진에서 얼굴·글자 후보. Windows OCR |
| `src-tauri/src/privacy_mask.rs` | 가림 상자를 새 이미지로 저장 |
| `src-tauri/src/privacy_scan/` | 문서에서 번호·전화·메일 규칙 |
| `src-tauri/src/pdf_pages.rs`, `lopdf` | PDF 페이지와 글자 읽기 |
| `src-tauri/src/document_search/` | 고른 폴더의 HWPX·DOCX·XLSX·PDF·TXT 읽기 |
| `src-tauri/src/loopback.rs` | `127.0.0.1`로만 모델에 요청 |
| `src-tauri/src/fixed_https.rs` | 허용한 https 주소만 읽기 |
| `src-tauri/src/org_policy.rs` | 레지스트리 정책 4개. 앱은 쓰지 않고 읽기만 |
| `src/App.tsx` | 화면 전환. 라우터 없음 |
| `src/pages/PrivacyMaskPage.tsx` | 사진 가림 화면 |
| `src/stores/settingsStore.ts` | 이 PC 설정 |

파일 입력: 패널 끌어다 놓기는 `src/components/DropZone.tsx`와 `src/services/dropSiteService.ts`. 탐색기 드롭은 `src-tauri/src/drop_target.rs`. 파일 선택은 Tauri 대화상자. 클립보드에 텍스트를 넣는 곳은 점검 결과 복사(`src/pages/PrinterCheckPage.tsx` 등)이고, 이미지를 붙여 넣어 OCR하는 경로는 없다. 화면 영역 캡처 명령은 없다.

설정: `@tauri-apps/plugin-store`의 `settings.json`. UI 문자열 표는 없고 한국어가 코드에 있다.

AI 호출: 업무 인수인계만 `src-tauri/src/loopback.rs`로 `127.0.0.1`에 보낸다. 근거 구절이 없으면 모델을 부르지 않는다. 사진 추출 텍스트를 보내는 경로는 없다.

로그: 추출 문장을 파일에 남기는 OCR 로그는 없다. 사진 모자이크 진단은 개발용이고 원문 번호를 넣지 않는 쪽이 기존 규칙이다.

네트워크를 실제로 열 수 있는 곳:

- `src-tauri/src/fixed_https.rs`의 `read_https`. https만, 주소 검사 뒤 WinHTTP.
- `src-tauri/src/netutil.rs` 약 300행. GitHub 최신 릴리스, `api.ipify.org`, `ipv4.icanhazip.com`, `checkip.amazonaws.com`. 인터넷 연결 점검과 새 버전 확인.
- `src-tauri/src/knowledge_sign.rs` 약 124행. 소개 사이트의 업무자료 목록. 설정이 켜져 있을 때만.
- `src-tauri/src/loopback.rs`. `127.0.0.1`만. 문서 추출과 무관.
- 소개 사이트 Worker(`/api/opinion`)는 `website/`이고 설치 프로그램 밖이다.

크래시 리포트·사용량 수집 호출은 찾지 못했다. OCR을 붙여도 이 목록을 추출 경로에서 호출하면 안 된다.

## 4. 통합 설계안

```text
패널 (React)
  놓기 / 고르기 / 붙여넣기 / 영역 캡처
        |
        v
  Rust 명령 (파일은 고른 경로만, 원본은 수정하지 않음)
        |
        +-- PDF에 글자 층이 있으면 lopdf로 읽고 OCR은 건너뜀
        +-- 아니면 보정 후 인식 작업 (1차는 인터페이스만, 모델은 확인 후)
        |
        v
  메모리의 블록 {text, bbox, confidence, lang}
        |
        +-- 미리보기 (좌 이미지, 우 텍스트)
        +-- 복사·저장 (가림 기본 꺼짐, 새 파일)
        +-- AI로 보내기 (가림 기본 켜짐, 127.0.0.1만, 보내기 전 미리보기)
```

엔진 인터페이스 초안. 디스크에 원문을 쓰지 않는다.

- 입력: 파일 바이트 또는 이미 고른 경로, 언어 힌트(자동 또는 수동).
- 출력: 블록 목록과 읽기 순서 텍스트, 표이면 행·열, 경고(손글씨, 낮은 확신).
- 언어 팩: 설치 폴더 밖이 아니라 앱 데이터 아래 `ocr-packs/<lang>/`에 둔다. 1차 폴더 형식만 정하고 파일은 비운다. 추가 팩은 서명과 SHA-256이 있는 오프라인 파일로만 넣고, 받는 주소는 없다.
- 화면: `App.tsx`의 화면 목록에 텍스트 추출을 하나 추가한다. 사진 모자이크 화면을 그대로 쓰지 않는다. 가림 상자 그리기와 새 파일 저장만 `privacy_mask.rs` 쪽 규칙을 참고한다.
- AI로 보내기: 업무 인수인계 질문(`handover/ask.rs`)에 붙이지 않는다. 그 경로는 인계 박스 근거가 있을 때만 모델을 부른다. 새 명령은 가림이 켜져 있으면 치환된 문자열만 `loopback`으로 보내고, 원문 이미지는 보내지 않는다.
- 설정 우선순위(2차 정책까지 포함해 이름만): 정책 잠금 > 개인 설정 > 기본값. 1차에는 정책 파일이 없으므로 개인 설정 > 기본값만 동작한다. 기존 `HKLM\SOFTWARE\Policies\EduLauncher`의 관리자 도구 스위치와 섞지 않는다.

## 5. 재사용과 수정

그대로 둘 곳:

- 끌어다 놓기 `DropZone.tsx`, `drop_target.rs`
- PDF 글자 읽기 `lopdf` (`document_search`, `pdf_pages.rs`)
- 번호·전화·메일 규칙 `privacy_scan`
- 이미지에 영역을 덮어 새 파일로 저장 `privacy_mask.rs`
- `127.0.0.1`만 허용 `loopback.rs`
- 설정 저장 `settingsStore.ts`

손볼 곳:

- `App.tsx`에 화면 하나
- 클립보드 이미지 읽기와 화면 영역 캡처는 새로 필요
- HEIC·WebP는 지금 사진 가림이 PNG·JPEG만 받는다 (`privacyMaskService.ts`)
- HWPX 쓰기는 없음. 읽기만 `document_search`
- DOCX·XLSX 쓰기도 없음. 읽기만 있음

## 6. 의존성·라이선스

기존 고지 `src-tauri/resources/THIRD_PARTY_NOTICES.txt`에서 이름·버전·라이선스 줄 267개를 읽었다. 이 분석에서 `npm run notices`를 다시 돌리지는 않았다. 릴리스 전 재실행이 필요하다. 라이선스 준수를 보장하지 않는다.

금지(GPL, AGPL, SSPL)로 표시된 줄은 없었다.

조건부·예외는 기존 `docs/LICENSES.md`와 같다.

| 이름 | 버전 | 라이선스 | 판정 |
| --- | --- | --- | --- |
| cssparser | 0.36.0 | MPL-2.0 | 조건부. Tauri 경유, 수정 없음 |
| selectors | 0.36.1 | MPL-2.0 | 같음 |
| dtoa-short | 0.3.5 | MPL-2.0 | 같음 |
| option-ext | 0.2.0 | MPL-2.0 | 같음 |
| webview2-com, webview2-com-sys | 0.38.2 | 확인 필요 | 불명. 고지 파일에 저작권 줄을 만들지 않았다는 기록이 있음 |
| WebView2Loader | 확인 필요 | 확인 필요 | 불명 |

그 밖 267개 중 나머지는 MIT, Apache-2.0, BSD, ISC, Zlib, 0BSD, Unlicense, CC0, Unicode, BSL 조합으로 읽혔다. `A OR B`는 고지 규칙대로 MIT를 고를 수 있으면 MIT다. `A AND B`인 brotli, dpi, encoding_rs, unicode-ident는 두 라이선스가 함께 붙는다. 판정은 허용 쪽으로 보이나 이번 문서가 법적 결론은 아니다.

직접 의존(앱 `package.json`, `src-tauri/Cargo.toml`): React, Zustand, Tauri 플러그인, lopdf 0.45, rusqlite 0.40(bundled), zip 8.6, quick-xml 0.42, qrcode 0.14, png 0.17, windows 0.61. 각 크레이트의 정확한 라이선스 문장은 위 고지 파일을 본다. 여기 표에 없는 버전을 추정하지 않는다.

새로 넣지 않는다. 후보만 적고, 원문 LICENSE를 보지 못한 것은 확인 필요다. 금지 목록(Ultralytics, InsightFace, dlib, PyMuPDF, pyhwp, PyQt, 비상업 NER)은 후보가 아니다.

| 후보 | 라이선스 | 비고 |
| --- | --- | --- |
| ONNX Runtime | 확인 필요. 프롬프트는 MIT로 적음 | 공식 고지를 보기 전. 용량 확인 필요 |
| PaddleOCR PP-OCR 모델, 언어별 | 확인 필요 | Apache-2.0이라는 안내만 있고 모델 카드 원문은 안 봄. 학습 데이터 조건 확인 필요 |
| RapidOCR 배포 모델 | 확인 필요 | 같음 |
| Tesseract 5와 traineddata, 언어별 | 확인 필요 | 엔진 Apache-2.0 안내는 있음. traineddata마다 확인 필요 |
| opencv 얼굴 YuNet | 확인 필요 | 휠의 FFmpeg 포함 여부 확인 필요. 1차 얼굴은 기존 Windows 얼굴 찾기를 우선 검토 |
| pypdfium2, opencv-python | 후보에서 제외 | Python 런타임. 이 저장소 스택과 다름 |
| HEIC 디코더 | 확인 필요 | libheif 계열 LGPL 가능. 1차는 JPG·PNG·WebP·PDF만 두고 HEIC는 확인 후 |
| HWPX 쓰기 | 없음 | 1차에 넣지 않음. 있으면 직접 최소 작성은 2차 검토 |
| DOCX·XLSX 쓰기 | 확인 필요 | 기존 `zip`+`quick-xml`로 최소 파일을 직접 쓰는 안이 새 패키지보다 맞음. 검색 가능 PDF는 기존 `lopdf`로 가능한지 확인 필요 |

## 7. 위험과 검증

- 한국어·영어 인쇄물, 한영 혼합, 영수증, 명함, 표: 가짜 문서 이미지로 문자 오류율. 모델이 없기 전에는 측정하지 않는다.
- 짧은 글, 한자가 섞인 한국어: 자동 감지가 틀릴 수 있다. 수동 언어 선택을 남긴다.
- 표: 선 검출을 직접 짤지, 인식 모델의 표 출력을 쓸지. 모델 확인 전이라 방식을 확정하지 않는다.
- 기울기·종이 테두리·그림자는 OpenCV 없이 Rust로 직접 짜는 범위가 1차 인쇄물(기울기)까지인지 확인 필요. 원근·그림자는 4단계.
- 저사양(GPU 없음, RAM 8GB): 처리 시간과 메모리는 모델이 정해진 뒤 같은 PC에서 잰다. 숫자를 추정하지 않는다. 지금 설치 파일은 약 4MB대이고, ONNX를 넣으면 그보다 커진다. 늘어나는 크기는 확인 필요.
- 백신 오탐: 서명 없는 NSIS는 이미 SmartScreen 안내가 있다. 모델 동봉 후에도 같은 안내가 필요할 수 있다.
- 이름 오탐: 확정 치환하지 않고 확인 필요로 둔다. 주민번호·전화·계좌는 기존 `privacy_scan` 규칙을 가짜 번호로 재현율·정밀도를 본다.
- 네트워크: 추출 테스트를 소켓이 실패하는 상태에서 돌린다. 기존 https 점검 코드는 추출 함수에서 호출하지 않는지로 검사한다.

테스트 데이터는 가짜 이름·번호만. 실존 인물 사진 금지. 출처는 나중에 `tests/fixtures/SOURCES.md`.

## 8. 구현 계획 (아직 시작하지 않음)

순서는 프롬프트의 1~9를 유지한다. 2단계 앞에 모델 라이선스 원문 확인이 끝나야 파일을 넣는다.

| 단계 | 목표 | 규모 | 완료 기준 |
| --- | --- | --- | --- |
| 1 | 결과 형식, 라이선스 검사 훅, 추출 경로가 https를 안 부르는지, 빈 모델 해시 자리 | M | 네트워크를 막는 테스트가 통과. 새 패키지 없음 |
| 2 | 글자 PDF는 직추출. 스캔은 기울기와 한국어·영어. 언어 팩 폴더만 | L | 가짜 인쇄물 샘플. 모델 확인 전이면 이 단계는 착수하지 않음 |
| 3 | 미리보기, 노란 낮은 확신, 복사·TXT, 키보드·큰 글씨 | M | 화면 테스트. 원문 로그 없음 |
| 4 | 폰 사진 보정, 칠판은 안내 문구 | L | 합성 이미지. 손글씨 정확도를 보장하지 않음 |
| 5 | 규칙 가림과 보내기 전 경고 | M | 가짜 번호. 복사 기본은 가림 꺼짐 |
| 6 | 얼굴은 탐지만, 기존 모자이크 저장 | M | 합성 얼굴. 임베딩 없음 |
| 7 | DOCX·XLSX·검색 PDF, 메타데이터 제거, AI 보내기는 가린 텍스트와 127.0.0.1 | L | 원본 파일 크기·시각이 그대로 |
| 8 | 개인 설정. 정책 잠금은 키만. 고지 문서 | M | 정책 파일 없이도 동작 |
| 9 | 2차. 추가 언어 팩, 폰 QR | L | 1차 밖 |

## 9. 확인하지 못한 것

- PaddleOCR·RapidOCR·Tesseract traineddata의 언어별 라이선스 원문과 학습 데이터 조건
- ONNX Runtime Windows 빌드의 정확한 라이선스 파일과 용량
- opencv 휠의 FFmpeg, HEIC 디코더 라이선스
- `lopdf`로 검색 가능한 PDF를 만들 수 있는지
- 저사양 PC의 처리 시간
- webview2 크레이트와 NSIS, HWPX 이용 조건 (기존 고지에도 사용자 확인 항목으로 남아 있음)
- 화면 영역 캡처를 WebView 밖에서 어떻게 받을지

추정하지 않았다.
