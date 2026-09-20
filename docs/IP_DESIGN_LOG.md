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
로컬 JSON 가져오기. 클릭 시 원문 URL만 브라우저로 연다. 게시판 수집·로그인 없음. Pack 작성 화면에서 기관(담당자)/부서를 구분해 파일을 만듦. 직원이 가져오면 고른 항목만 이 PC 목록에 더함.

External code:
없음

Potential similar products:
그룹웨어 위젯, 피드 리더

Difference:
약속된 Pack 파일에서 고른 항목만 추가. 같은 id는 건너뜀. 스크래핑·실시간 동기화·게시판 UI 복제 없음. .edupack 클릭·드롭 후 선택. 시작 시 HKCU에 설치본 연결

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
기관 공지와 공통 알림을 홈 한 칸에서 제목·날짜와 기관/부서 표시로 정리

Design source:
내부 요구사항

Implementation:
테두리 칸 안에 기관/부서 표시, 제목, 날짜. 홈 3개. 모두 목록에서 넣기·수정·빼기. Pack은 고르기 추가. 게시판 수집·조회수·첨부 아이콘 없음

External code:
없음

Potential similar products:
학교 홈페이지 게시판, 인트라넷 공지 목록

Difference:
특정 교육청·나이스 게시판 HTML/CSS 복제 없음. Pack 또는 이 PC에서 넣은 제목·날짜만 표시

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

---

Feature: Halt range check

Purpose:
네트워크·CCTV 구간 확인을 사용자가 중간에 멈춤

Design source:
내부 요구사항

Implementation:
검색 시작 시 중지 표시를 끄고, 중지 명령으로 켬. 작업 스레드가 다음 주소를 꺼내기 전에 표시를 읽음. 이미 나간 ping은 끝날 수 있음. 그 시점까지 찾은 목록을 돌려줌. 화면을 나가도 중지 명령을 보냄

External code:
없음

Potential similar products:
구간 확인 유틸리티의 정지

Difference:
해당 제품 UI 복제 없음. 기존 검색 버튼 아래에 중지만 추가

PATENT_REVIEW:
구간 확인 작업을 사용자 요청으로 중단하는 구성

---

Feature: Computer tools list

Purpose:
학교 전산에서 자주 여는 Windows 설정 화면(컴퓨터 이름 등)을 업무도구 옆에서 바로 열기 위함

Design source:
내부 요구사항. 홈 칸을 늘리지 않고 업무도구 옆에 목록을 둠

Implementation:
고정된 `C:\Windows\System32` 파일명만 허용. 이름 바꾸기 exe는 파일로 열어 셸이 권한 확인을 띄울 수 있게 함. 프로그램 실행이 740이면 같은 경로를 `open_path`로 다시 연다. 선택 시에만 런처 목록에 추가. 새 도구 유형 없음. 인자·스크립트·ms-settings URL 없음

External code:
없음

Potential similar products:
제어판, 설정 앱, 시스템 유틸리티 모음

Difference:
Windows 설정 앱·제어판 화면을 복제하지 않음. 시작 메뉴형 앱 격자 없음. 이 PC 파일만 열고 이름을 대신 바꾸지 않음

PATENT_REVIEW:
운영체제 설정 화면을 고정 경로로 열어 주는 구성

---

Feature: Home pin star

Purpose:
홈 칸에 둘지 말지를 메뉴 없이 바꾸기 위함

Design source:
내부 요구사항

Implementation:
기존 `favorite` 필드와 `toggleFavorite`만 사용. 카드에 별 단추. 오른쪽 클릭 메뉴는 기존과 같고 커서 근처에 염. 목록에서 제거하지 않음

External code:
없음

Potential similar products:
즐겨찾기 별 표시가 있는 목록

Difference:
시작 메뉴·독 레이아웃 복제 없음. 기존 카드에 별만 추가

---

Feature: Confirm shortcut removal

Purpose:
런처 목록에서 바로가기를 빼기 전에 홈 숨기기와 구분해 확인

Design source:
내부 요구사항

Implementation:
삭제 전에 이름과 짧은 안내를 보여 줌. 확인 시에만 `removeTool`. 프로그램·파일 본체는 건드리지 않음. 즐겨찾기 해제에는 확인 없음

External code:
없음

Potential similar products:
목록 항목 삭제 확인

Difference:
탐색기 휴지통·다른 런처 삭제 UI 복제 없음

PATENT_REVIEW:
목록 항목 삭제 전 확인 안내

---

Feature: Three panel skins

Purpose:
패널 분위기를 서류·밝은 화면·어두운 화면으로 고르고, 홈 구역을 읽기 쉽게 나눔

Design source:
내부 요구사항. 칸마다 색 고르기 없음

Implementation:
settings.json의 `panelSkin` 세 값만 허용. html data-skin으로 기존 색 토큰을 통째로 바꿈. 홈 구역 제목은 14px 세미볼드. 구역 배경은 스킨별 연한 토큰. 아크릴·블러·커맨드 팔레트 없음. 창 테두리는 OS

External code:
없음

Potential similar products:
OS 밝기/어두움 설정, 테마 상점이 있는 런처

Difference:
시작 메뉴·Fluent·다른 런처 스킨 UI 복제 없음. 이름과 팔레트는 이 패널용으로 정함. 색상표 편집기 없음

PATENT_REVIEW:
미리 정한 몇 가지 화면 색 묶음을 고르는 구성

---

Feature: Home list and all-view columns

Purpose:
사이트도 한 줄 목록으로 보고, 모두 화면만 1열 또는 2열로 고르기 위함

Design source:
내부 요구사항. 홈 미리보기는 한 줄 유지

Implementation:
기존 FavoriteGrid의 한 줄(row) 배치를 기본으로 씀. settings.json의 `listColumns`는 1 또는 2만 허용. 모두 화면(ToolGroupPage)에만 열 수를 넘김. 원격 파비콘은 받지 않음. 아이콘은 기존 로컬 `iconImage`만

External code:
없음

Potential similar products:
목록 열 수가 있는 설정 화면

Difference:
시작 메뉴·독·다른 런처 격자 복제 없음. 홈은 미리보기 한 줄. 열 선택은 모두 화면만

PATENT_REVIEW:
목록을 한 줄 또는 두 줄로 늘어놓는 일반 배치

---

Feature: This PC address view

Purpose:
이 PC IPv4와 공인(NAT 바깥) 주소만 바로 보기 위함

Design source:
내부 요구사항. 구간 검색 화면과 분리

Implementation:
컴퓨터도구 목록의 한 항목. 기존 `this_pc_ipv4`와 `lookup_public_ipv4`만 호출. 이름·마스크·게이트웨이·구간 검색은 이 화면에 없음. 새 네트워크 API·라이브러리 없음

External code:
없음

Potential similar products:
운영체제 네트워크 상태, 공인 IP 확인 사이트

Difference:
Windows 설정 화면을 복제하지 않음. 기존 Network 검색 도구를 바꾸지 않음. 값 두 가지만 표시

PATENT_REVIEW:
사설 IP와 공인 IP를 나란히 보여 주는 구성

---

Feature: Control Panel and system info shortcuts

Purpose:
학교 사무에서 자주 여는 제어판·시스템 정보 화면을 컴퓨터도구에서 바로 열기 위함

Design source:
내부 요구사항. 인자 없는 System32 파일만

Implementation:
기존 컴퓨터도구 목록에 `control.exe`, `msinfo32.exe`를 파일로 추가. 새 명령·인자·ms-settings 없음

External code:
없음

Potential similar products:
시작 메뉴의 제어판·시스템 정보

Difference:
시작 메뉴·설정 앱 UI 복제 없음. 고정 경로만 연다

---

Feature: Internet Explorer reset confirm

Purpose:
학교 PC에서 익스플로러 설정을 되돌리는 Windows 확인 화면을 바로 열기 위함

Design source:
내부 요구사항. 인자 일반화 없음

Implementation:
프론트는 인자 없이 `open_ie_reset`만 호출. Rust에서 `C:\Windows\System32\rundll32.exe`와 고정 인자 `inetcpl.cpl,ResetIEtoDefaults`만 실행. 사용자 문자열을 명령에 넣지 않음. 확인 전에는 설정을 바꾸지 않음

External code:
없음

Potential similar products:
인터넷 옵션의 원래대로 단추

Difference:
설정 앱·인터넷 옵션 화면을 복제하지 않음. 확인 창만 연다

PATENT_REVIEW:
운영체제 복원 확인 화면을 고정 호출로 여는 구성

---

Feature: QR Code mark and crate notice

Purpose:
주소 무늬 기능을 넣기 전에 상표·크레이트 라이선스를 고지

Design source:
내부 요구사항. 크레이트는 아직 빌드에 없음

Implementation:
THIRD_PARTY_NOTICES.md에 `qrcode` 0.14.1 (MIT OR Apache-2.0) 채택 예정 고지. 설정 프로그램 정보에 QR Code 상표 표기. Cargo.toml 미변경

External code:
없음 (크레이트 소스 미포함)

PATENT_REVIEW:
그림 위에 주소 무늬를 합성하는 구성은 아직 미구현. 이 고지가 특허 비침해를 의미하지 않음

---

Feature: 주소 무늬 screen

Purpose:
이 PC 그림 오른쪽 아래에 http(s) 주소 무늬를 넣고 PNG로 저장

Design source:
내부 요구사항. 모듈 행렬은 crates.io `qrcode` 0.14.1 (MIT OR Apache-2.0, default-features = false). 그림 읽기·합성·저장은 이 저장소 코드

Implementation:
`src-tauri/src/url_mark.rs`가 주소 검사 후 모듈 행렬만 반환. 프론트 캔버스가 오른쪽 아래 흰 칸에 그림. PNG만 저장. 원본 그림은 덮지 않음. 인터넷 생성기 없음

External code:
크레이트 소스를 복사하지 않음. Cargo.toml로 링크만 함. 합성·파일 읽기·base64는 이 저장소에서 작성

Difference:
외부 QR 웹 서비스·npm 패키지·다른 런처 화면을 쓰지 않음. UI 이름은 주소 무늬

PATENT_REVIEW:
그림 위에 주소 무늬를 합성하고 PNG로 저장하는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Shortcut hover text

Purpose:
바로가기 위에 마우스를 올리면 주소 대신 설명을 보여 줌

Design source:
내부 요구사항. HTML title만 사용

Implementation:
`ToolCard` 실행 단추의 title을 설명, 없으면 이름으로. 주소·경로는 넣지 않음

External code:
없음

PATENT_REVIEW:
해당 없음

---

Feature: Education work topics

Purpose:
학교 사무 직원이 문서 이름이 아니라 궁금한 말로 업무주제를 찾고, 처리 흐름과 자료 유형을 주제 단위로 본다

Design source:
내부 요구사항. 원본 안내는 이 저장소 `HelpMake/EDU` JSON. 화면·검색 점수는 이 저장소에서 작성

Implementation:
번들 JSON을 `topicService`가 검사해 읽음. 검색은 제목·키워드·예시 질문·자료 제목 순. 홈 검색 결과 맨 위와 업무도구 「업무자료」에서 연다. http/https 주소만 바깥에서 연다. AI 호출 없음

External code:
없음. 다른 런처 화면을 베끼지 않음

Difference:
바로가기 실행기가 아니라 업무주제 카드가 먼저 나온다. 자료 PDF 목록을 검색 첫 화면에 펼치지 않음

PATENT_REVIEW:
키워드로 업무를 묶어 보여주는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Home jump, official links, work flow boxes

Purpose:
안쪽 화면에서 첫 화면으로 돌아가고, 확인된 공식 누리집만 바깥에서 열며, 처리 단계를 상자 순서로 보여 줌

Design source:
내부 요구사항. 법령 검색은 국가법령정보센터 주소. 학교알리미·나라장터·교육시설 통합정보망은 각 공식 누리집. 흐름은 기존 workflow 배열을 세로 상자로 표시

Implementation:
`HomeJumpButton`. 법령 유형만 법령정보센터 검색 URL. 나머지 자료는 JSON url 또는 제목으로 아는 공식 주소만. http/https만. 처리 흐름은 CSS 상자+아래 화살표. 마인드맵 라이브러리 없음

External code:
없음

Difference:
원문 PDF를 넣거나 게시판을 긁지 않음. 다른 마인드맵 제품 화면을 쓰지 않음

PATENT_REVIEW:
단계를 상자로 나열하는 구성, 공식 사이트 검색 연결. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Recent opened topics

Purpose:
홈의 최근 사용에 실행한 바로가기와 함께, 열어 본 업무주제만 시간 순으로 보여 줌

Design source:
내부 요구사항. 검색창에 친 말은 저장하지 않음

Implementation:
주제 상세를 열 때 `recent-topics.json`에 id와 시각만 저장. 홈에서 바로가기의 lastUsedAt과 섞어 설정 개수만큼 표시

External code:
없음

Difference:
검색어 기록·자동완성이 아님. 연 주제만 남김

PATENT_REVIEW:
최근 연 항목 목록. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Settings intro site link

Purpose:
설정 하단에서 이 프로그램 소개 웹 주소를 연다

Design source:
내부 요구사항. Cloudflare `website/` 소개 페이지

Implementation:
`APP_CONFIG.siteUrl`을 설정 하단에 그대로 보여 주고 `launchQuickUrl`로 연다

External code:
없음

PATENT_REVIEW:
해당 없음

---

Feature: Dated local todos and calendar site open

Purpose:
홈 할 일을 오늘·내일·모레에 나눠 적고, 구글·네이버 캘린더 누리집만 연다

Design source:
내부 요구사항. 날짜는 이 PC 달력. 캘린더는 공식 https 주소만

Implementation:
할 날에 YYYY-MM-DD만 저장. 화면 이름은 오늘(9.20)처럼 그날 시계로 붙임. 백업 JSON에도 상대 말(오늘)을 넣지 않음. 캘린더 단추는 오늘·내일·모레 줄 오른쪽에 두고, 누르면 고정 https만 고른다. `launchQuickUrl`로 연다. 계정 연동·일정 읽기 없음

External code:
없음. 구글·네이버 화면·로고를 쓰지 않음

Difference:
클라우드 할 일·캘린더 동기화가 아님. 이 PC 목록과 사이트 열기만 함

PATENT_REVIEW:
날짜를 붙여 할 일을 나누고 외부 캘린더 사이트를 여는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Single local notice list with source mark

Purpose:
홈 공지를 한 칸으로 두고, 기관(담당자)과 부서를 줄에 표시하며 이 PC에서 넣기·수정·빼기

Design source:
내부 요구사항. 기존 NoticeItem.kind(org/alert)를 화면 이름만 기관/부서로 씀

Implementation:
한 목록. Pack은 같은 id를 건너뛰고 고른 항목만 추가. origin pack/local. 클릭 시 적어 둔 http(s)만 염. 게시판 수집·권한 서버 없음

External code:
없음

Difference:
피드 동기화가 아님. 이 PC JSON 목록

PATENT_REVIEW:
로컬 목록에 출처 표시를 두고 파일에서 고른 줄을 더하는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: User folder name find

Purpose:
이 사용자 폴더에서 파일·폴더 **이름**만 찾아 연다. 홈 검색 맨 아래와 컴퓨터도구 전용 화면

Design source:
내부 요구사항. 기존 USERPROFILE·path_inside·깊이 제한 패턴

Implementation:
고정 루트(바탕화면·문서·다운로드, 선택 시 사진·음악·동영상). 이름 접기(소문자·공백 제거) 후 정확/접두/포함 점수. 내용 미열람. 심볼릭 링크 제외. 검색어에 경로 문자 거부. 홈은 5건, 전용 화면은 40건. 중지는 네트워크 검색과 다른 AtomicBool. 열기는 기존 launch_tool

External code:
없음. Everything·Windows 검색·시작 메뉴 UI/로고/인덱서를 쓰지 않음

Difference:
디스크 전체 검색·내용 색인이 아님. 이 사용자 알려진 폴더의 이름만 봄

PATENT_REVIEW:
사용자 폴더 안에서 이름으로 항목을 나열하는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Education topic search and work map list

Purpose:
업무주제를 검색하고, 마인드맵 계층을 목록으로 눌러 상세를 연다

Design source:
내부 요구사항. 기존 topics.json. 마인드맵은 계층 표만 로컬 JSON으로 옮김

Implementation:
업무자료 탭 검색결과·업무지도. 접이식 목록, 키보드 이동. 클릭 시 기존 Topic 상세. 원문 금액·기한을 Topic에 합치지 않음. NotebookLM URL 수집 없음. 그래프 라이브러리 없음

External code:
없음. NotebookLM 화면·로고를 쓰지 않음

Difference:
마인드맵 캔버스 제품이 아님. 로컬 주제 목록과 접이식 탐색

PATENT_REVIEW:
계층 목록에서 업무 주제로 이동하는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Local manual JSON work tree (EPKI first)

Purpose:
매뉴얼 JSON 하나에서 검색, 접이식 업무지도, 상세, 관련 업무를 만든다. 첫 자료는 교육행정전자서명(EPKI) 인증서

Design source:
내부 요구사항. 기존 Topic·WorkMapList·searchTopics

Implementation:
`src/data/manuals/*.json`을 Vite glob으로 읽고 Topic·MindMapNode로 바꿈. 패널 440px 접이식 목록. React Flow/Markmap/D3 없음. 인증서 파일 실행·원격 수집 없음. 비밀번호를 찾거나 복구하는 기능 없음

External code:
없음

Difference:
마인드맵 캔버스·외부 지식 서비스가 아님. 이 PC에 넣은 JSON 목록

PATENT_REVIEW:
계층 JSON에서 검색하고 같은 항목 상세를 여는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음


