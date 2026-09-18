# IP design log

Feature: Entity Search (school sample)

Purpose:
업무 대상을 이름으로 찾아 관련 작업 진입점을 보여주기 위함

Design source:
내부 요구사항

Implementation:
독립 구현 (소문자 정규화, prefix/포함 점수)

External code:
없음

Potential similar products:
범용 검색 런처

Difference:
프로그램 목록이 아니라 학교 등 업무 대상 중심 검색

---

Feature: Tray work panel

Purpose:
평소 화면을 가리지 않고, 필요할 때만 작은 패널을 연다

Design source:
내부 요구사항

Implementation:
Tauri 2 공식 tray / window API로 독립 구현

External code:
없음 (공식 API 호출만)

Potential similar products:
트레이 상주 유틸리티 일반

Difference:
즐겨찾기 카드, 오늘 할 일, 학교 업무 진입을 한 패널에 둔 업무 허브 형태

---

Feature: Local launch

Purpose:
URL, 파일, 폴더, 등록된 프로그램을 이 PC에서 연다

Design source:
내부 요구사항

Implementation:
opener / process spawn, 경로 없으면 안내

External code:
없음

IP_REVIEW_REQUIRED:
파일 드롭 후 업무 자동 판단, 학교-시스템 자동 연결, 매크로/AI 추천은 아직 미구현. 추가 시 별도 검토.

---

Feature: Local memo pad

Purpose:
런처 패널 하단에 짧은 업무 메모를 적어 이 PC에만 보관

Design source:
내부 요구사항

Implementation:
단일 텍스트 입력 + plugin-store 로컬 저장. 독립 구현

External code:
없음

Potential similar products:
스티커 메모, 노트 앱, 일부 런처의 노트 플러그인

Difference:
노란색 스티커/핀/여러 장 메모/클라우드 동기화/리치텍스트가 아님. 패널 하단 고정 평문 한 칸만 제공

---

Feature: Desk panel visual theme

Purpose:
교육업무 패널을 차분한 지색·잉크 틸 톤으로 정리

Design source:
내부 요구사항

Implementation:
배경/테두리/카드 정렬만 조정. 레이아웃·기능 구조 유지. 독립 색과 여백

External code:
없음

Potential similar products:
Windows 시작 메뉴, 커맨드 팔레트 런처, Fluent 아크릴 UI

Difference:
아크릴/블러/시작 메뉴 타일/중앙 커맨드 팔레트를 쓰지 않음. 카드는 왼쪽 정렬의 낮은 업무 목록 형태

---

Feature: Organization notice pack

Purpose:
기관 담당자가 작성한 공지 JSON을 직원이 가져와 홈에 최근 안내를 표시

Design source:
내부 요구사항

Implementation:
로컬 JSON 가져오기. 클릭 시 원문 URL만 브라우저로 연다. 게시판 수집·로그인 없음. 담당자 작성 화면에서 기관 공지/공통 알림을 구분해 Pack 파일을 만듦

External code:
없음

Potential similar products:
그룹웨어 위젯, 피드 리더

Difference:
약속된 Pack 파일만 교체 갱신. 스크래핑·실시간 동기화·게시판 UI 복제 없음. .edupack 클릭·드롭으로 적용. 시작 시 HKCU에 설치본 연결

---

Feature: Local IPv4 range helper

Purpose:
업무도구 Network에서 주소와 마스크로 네트워크 구간을 계산

Design source:
내부 요구사항

Implementation:
로컬 비트 연산. 이 PC 주소·공인 IP 조회. 사용자가 연 구간의 ICMP 응답 목록

External code:
없음. 공인 IP는 ipify / icanhazip / checkip.amazonaws.com 중 응답 텍스트만 사용

Potential similar products:
IP 계산기, 구간 생존 확인 유틸리티

Difference:
런처 내부 업무도구. /24보다 넓은 자동 검색·포트 스캔·구성도 자동 생성 없음

---

Feature: Local range reply check and public IP

Purpose:
학교 LAN에서 응답하는 IPv4와 NAT 바깥 공인 IP를 확인

Design source:
내부 요구사항

Implementation:
Windows ping/arp/ipconfig, DNS·NetBIOS 이름, HTTPS 공인 IP 조회. 사용자가 계산기에 연 구간만, 최대 256개

External code:
없음

Potential similar products:
Angry IP Scanner, Advanced IP Scanner

Difference:
해당 제품 UI/워크플로 복제 없음. 포트 스캔·벤더 배너·자동 매핑 없음. 계산 화면의 보조 확인만 제공. 종류는 이 PC·게이트웨이·이름 규칙 추정. 목록은 UTF-8 CSV로 저장. 검색 구간의 미연결 주소도 상태 열에 포함

---

Feature: Local CCTV list

Purpose:
업무도구 CCTV에서 이 PC 구간의 카메라로 보이는 주소를 확인

Design source:
내부 요구사항

Implementation:
/24 ICMP와 이름 단서, RTSP 554 연결 여부만. 로그인·영상 스트림 없음

External code:
없음

Potential similar products:
NVR/VMS 검색 도구

Difference:
전용 관제 UI·제조사 SDK·기본 암호 접속 없음. 추정 목록만 표시

---

Feature: Shortcut pack icons

Purpose:
담당자가 공통 사이트 바로가기의 아이콘을 Pack으로 나눠 같은 도구 ID에 적용

Design source:
내부 요구사항

Implementation:
LauncherPack JSON에 런처 내장 아이콘 id만 넣음. 가져오면 같은 id의 아이콘을 바꾸고, 없는 바로가기는 추가. 파비콘·사이트 그림 수집 없음

External code:
없음

Potential similar products:
브라우저 즐겨찾기 내보내기, 런처 스킨 팩

Difference:
공식 로고 복사·파비콘 스크래핑 없음. 런처가 가진 아이콘 이름만 전달

---

Feature: Drop current site URL

Purpose:
보고 있는 웹 주소를 패널에 놓아 URL 바로가기로 넣기

Design source:
내부 요구사항

Implementation:
Windows에서는 웹뷰 HTML5 드롭을 사용. http(s) 텍스트, text/html 링크 글자, .url/.website의 URL= 만 읽음. 페이지 요청·파비콘·로고 없음. 표시 이름은 브라우저가 넘긴 문서 제목을 쓰고, 없을 때만 호스트명. 호스트 이름으로 먼저 저장된 항목은 제목이 오면 갱신

External code:
없음

Potential similar products:
브라우저 즐겨찾기 드래그, 런처 URL 드롭

Difference:
타 런처 UI 복제 없음. 기존 Pack 드롭 패널에 주소만 추가. 확장 프로그램·사이트 수집 없음

---

Feature: Per-kind favorite groups

Purpose:
사이트·파일·업무도구 칸에서 해당 종류만 더 보거나 추가

Design source:
내부 요구사항

Implementation:
홈은 종류마다 즐겨찾기 3개만. 모두를 누르면 해당 종류 목록 화면. 카드에 Pack/이 PC 표시. 시작 메뉴·런처 서랍 UI 없음

External code:
없음

Potential similar products:
시작 메뉴 모든 앱, 런처 카테고리 탭

Difference:
패널 안 기존 칸에서 종류별 목록만 연다. 별도 앱 서랍·검색 UI 복제 없음

---

Feature: Pack vs local origin label

Purpose:
바로가기가 Pack으로 들어왔는지 이 PC에서 만들었는지 구분

Design source:
내부 요구사항

Implementation:
도구에 origin pack|local. Pack extras만 packName 부여. 끌어놓기·직접 추가는 local. 카드 아래 Pack 또는 이 PC

External code:
없음

Potential similar products:
스토어 앱 vs 로컬 설치 표시

Difference:
스토어·서명 UI 없음. 출처 글자만

---

Feature: Drop local file shortcut

Purpose:
탐색기의 파일·폴더·실행 파일을 패널에 놓아 경로 바로가기로 넣기

Design source:
내부 요구사항

Implementation:
내용은 복사하지 않고 경로만 저장. 주소/Pack은 웹 드롭, 탐색기 파일은 창 OLE 놓기. 폴더는 folder, .exe는 app, .lnk는 대상이 exe면 app·폴더면 folder·아니면 file. 어디에 넣을지 묻지 않음. 표시 이름은 놓은 항목 이름. 한 번에 10개

External code:
없음

Potential similar products:
바로가기 만들기, 런처 파일 드롭

Difference:
파일을 앱 폴더로 가져오지 않음. 시작 메뉴 고정 UI 없음

---

Feature: Memo full view

Purpose:
홈 아래 짧은 메모를 같은 내용으로 패널 한 화면에 크게 보기

Design source:
내부 요구사항

Implementation:
홈 메모 칸의 크게만 추가. 메모는 하나, 이 PC 저장 그대로. 별도 메모 앱·여러 장 없음

External code:
없음

Potential similar products:
스티커 메모, 노트 앱

Difference:
런처 패널 안 기존 메모만 확대. 새 창·여러 메모 목록 없음

---

Feature: Cool paper palette

Purpose:
패널 배경과 글자색을 서류에 가까운 차가운 톤으로 정리

Design source:
내부 요구사항

Implementation:
index.css 토큰만 교체. 시스템 글꼴 유지. 아크릴·마이카·어두운 검색창 없음

External code:
없음

Potential similar products:
밝은 런처, 사무용 패널

Difference:
타 런처 레이아웃·블러 효과 복제 없음. 색만 변경

---

Feature: Cloudflare Pages product site

Purpose:
제품 소개, 웹 화면 미리보기, 데스크톱 설치 안내를 정적 사이트로 두기 위함

Design source:
내부 요구사항. 호스팅은 Cloudflare Pages 문서의 Git 연결·정적 dist 배포

Implementation:
website/ 별도 Vite+React. 소개·미리보기·다운로드 세 경로. 미리보기는 정적 목업. 설치파일은 GitHub Releases 링크

External code:
없음. Pages 설정값만 문서화

Potential similar products:
제품 랜딩 + 다운로드 페이지 일반

Difference:
타사 런처 스토어·랜딩 레이아웃 복제 없음. 웹은 실행기가 아님을 명시

---

Feature: Local backup for another PC

Purpose:
이 PC의 바로가기·공지·메모·할 일·표시 설정을 파일로 옮겨 새 PC에서 이어쓰기 위함

Design source:
내부 요구사항

Implementation:
설정에서 JSON 내보내기/가져오기. 기존 파일 대화상자·read/write_json_file만 사용. 프로그램·파일 복사는 하지 않음. Pack과 구분하는 kind 필드

External code:
없음

Potential similar products:
브라우저 북마크보내기, 앱 설정보내기 일반

Difference:
클라우드 동기화·프로필 로밍 없음. URL과 설정만 옮기고 로컬 경로는 안내만 함

---

Feature: Local path tools as list rows

Purpose:
프로그램·파일·폴더·업무도구를 좁은 3칸 카드 대신 한 줄로 읽어 구분하기 위함

Design source:
내부 요구사항

Implementation:
홈 사이트만 3칸 유지. 모두 보기(사이트 포함)와 프로그램·파일·폴더는 한 줄 목록. 이름+파일명(경로 끝)+Pack/이 PC. 전체 경로는 title만. 시작 메뉴형 큰 아이콘 격자 없음

External code:
없음

Potential similar products:
파일 목록, 바로가기 목록

Difference:
시작 메뉴·탐색기 타일 복제 없음. 홈 3개 제한과 기존 카드 메뉴 유지

---

Feature: Folder drop path recovery

Purpose:
탐색기에서 폴더를 놓아도 바로가기에 안 들어가던 문제를 줄이기 위함

Design source:
내부 요구사항. HTML5는 폴더에 File.path가 없고, OLE 훅이 WebView 재생성 후 빠질 수 있음

Implementation:
file:// 여러 줄 경로 수집. 패널을 열 때와 시작 후 몇 차례 IDropTarget을 다시 붙임. 폴더 내용을 복사하지 않음

External code:
없음

Potential similar products:
파일 끌어놓기 일반

Difference:
폴더 내용을 런처로 복사하지 않고 경로 바로가기만 추가

---

Feature: Home notice board rows

Purpose:
기관 공지·공통 알림을 홈에서 제목과 날짜만 보이게 정리

Design source:
내부 요구사항

Implementation:
테두리 칸 안에 제목 왼쪽·날짜 오른쪽 한 줄. 홈 3개 유지. Pack 원문 링크만 열림. 게시판 수집·조회수·첨부 아이콘 없음

External code:
없음

Potential similar products:
학교 홈페이지 게시판, 인트라넷 공지 목록

Difference:
특정 교육청·나이스 게시판 HTML/CSS 복제 없음. Pack으로 넣은 제목·날짜만 표시

---

Feature: List row overflow menu stacking

Purpose:
목록 오른쪽 점세개 메뉴가 아래 줄에 가리지 않게 함

Design source:
내부 요구사항. 기존 ToolCard 메뉴 유지

Implementation:
메뉴가 열린 카드만 z-index를 올리고 호버 이동을 끈다.
스크롤 아래쪽이면 같은 메뉴를 위로 연다.
새 컴포넌트·외부 메뉴 라이브러리 없음

External code:
없음

Potential similar products:
목록 행 부가 메뉴 일반

Difference:
시작 메뉴·탐색기·타 런처 액션 패널 복제 없음.
기존 네 항목 한글 메뉴만 같은 카드 스타일로 표시

---

Feature: Local shell icons on drop

Purpose:
파일·폴더·프로그램·이 PC의 .url/.lnk를 끌어넣을 때 탐색기가 보여 주는 아이콘을 카드에도 씀

Design source:
내부 요구사항. Windows SHGetFileInfoW 공식 API

Implementation:
끌어넣은 로컬 경로의 현재 셸 아이콘만 PNG로 이 PC tools.json에 저장.
사이트 서버 요청·파비콘 URL·Google 아이콘 API 없음.
브라우저 탭만 놓으면 경로가 없어 지구본 유지.
Pack·백업 JSON에는 그림을 넣지 않음 (내장 아이콘 이름만)

External code:
없음 (Win32 공식 API 호출과 PNG 인코딩만)

Potential similar products:
탐색기 아이콘 표시, 바로가기 속성

Difference:
웹에서 로고를 수집하지 않음. 이 PC에 이미 있는 항목의 표시 아이콘만 씀. 타 런처 UI 복제 없음

---

Feature: This PC internet shortcut list

Purpose:
사이트 칸에서 이 PC에 있는 인터넷 바로가기를 보고 기본 브라우저로 연다

Design source:
내부 요구사항

Implementation:
Windows `Favorites`의 `.url`과, 이 PC `%LOCALAPPDATA%` 아래 Edge·Chrome `User Data` 프로필의 `Bookmarks` 파일만 읽음.
JSON에서 `url` 문자열이 http(s)인 항목과 `children` 배열만 재귀적으로 모음. 쿠키·로그인·방문 기록 파일은 열지 않음.
파일 크기 2MB, 프로필 8개, 항목 400개, 심볼릭 링크 제외. 파비콘 없음. 클릭 시 opener. 선택 시에만 런처에 넣기

External code:
없음

Potential similar products:
브라우저 즐겨찾기 창

Difference:
브라우저 UI 복제 없음. 공식 로고 복사 없음. 실시간 동기화·클라우드 계정 없음. 메뉴를 눌렀을 때만 로컬 파일 읽기

PATENT_REVIEW:
로컬 브라우저 북마크 파일과 인터넷 바로가기 파일을 읽어 폴더별로 나열하고 브라우저로 여는 구성

---

Feature: Range check elapsed bar

Purpose:
네트워크·CCTV 구간 확인이 끝날 때까지 처리 개수와 경과 시간을 보여 답답함을 줄임

Design source:
내부 요구사항

Implementation:
기존 ping/554 확인 루프에서 처리한 주소 수를 이벤트로 보냄. 화면은 막대와 예상·경과·남은 초를 표시. 시작 직후에도 구간 개수와 대기 시간으로 예상을 보여 줌. 검색 알고리즘 변경 없음

External code:
없음

Potential similar products:
구간 생존 확인 유틸리티의 상태 표시

Difference:
해당 제품 표·상태바 레이아웃 복제 없음. 기존 패널 카드 안에 막대와 숫자만 추가

PATENT_REVIEW:
호스트 구간 확인 중 완료 비율과 경과 시간을 표시하는 구성

