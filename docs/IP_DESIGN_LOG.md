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
사이트도 한 줄 목록으로 보고, 모두 화면은 1·2열을 고르며, 패널이 넓으면 2·3열로 보이게 하기 위함

Design source:
내부 요구사항. 패널 너비는 기존 settings.panelWidth

Implementation:
FavoriteGrid list 배치가 1·2·3열. 홈은 `homeListColumns`(560px 미만 2열, 이상 3열). 모두는 `allListColumns`(설정 1열 유지, 2열이면 너비에 따라 2·3열). `listColumns` 설정값은 1·2만. 원격 파비콘 없음

External code:
없음

Potential similar products:
목록 열 수가 있는 설정 화면

Difference:
시작 메뉴·독 복제 없음. 너비에 따른 열만 바꿈

PATENT_REVIEW:
목록을 너비에 맞춰 늘어놓는 일반 배치. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

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

Feature: Sound, Internet Options, Task Manager shortcuts

Purpose:
학교 사무에서 자주 여는 소리·인터넷 옵션·작업 관리자 화면을 컴퓨터도구에서 바로 열기 위함

Design source:
내부 요구사항. 인자 없는 System32 파일만

Implementation:
기존 컴퓨터도구 목록에 `mmsys.cpl`, `inetcpl.cpl`, `taskmgr.exe`를 파일로 추가. 새 명령·인자·ms-settings 없음. 홈 칸은 늘리지 않음

External code:
없음

Potential similar products:
시작 메뉴의 소리·인터넷 옵션·작업 관리자

Difference:
시작 메뉴·설정 앱 UI 복제 없음. 고정 경로만 연다. 시작프로그램 등록 기능은 넣지 않음

PATENT_REVIEW:
고정 System32 파일 실행은 일반 OS 호출. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

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

Feature: 주소 무늬 screen (UI: QR코드 넣기)

Purpose:
이 PC 그림 오른쪽 아래에 http(s) 주소 QR코드를 넣고 PNG로 저장

Design source:
내부 요구사항. 모듈 행렬은 crates.io `qrcode` 0.14.1 (MIT OR Apache-2.0, default-features = false). 그림 읽기·합성·저장은 이 저장소 코드

Implementation:
`src-tauri/src/url_mark.rs`가 주소 검사 후 모듈 행렬만 반환. 프론트 캔버스가 오른쪽 아래 흰 칸에 그림. PNG만 저장. 원본 그림은 덮지 않음. 인터넷 생성기 없음

External code:
크레이트 소스를 복사하지 않음. Cargo.toml로 링크만 함. 합성·파일 읽기·base64는 이 저장소에서 작성

Difference:
외부 QR 웹 서비스·npm 패키지·다른 런처 화면을 쓰지 않음. 메뉴명은 QR코드 넣기

PATENT_REVIEW:
그림 위에 QR 모듈을 합성하고 PNG로 저장하는 구성. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

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
번들 JSON을 `topicService`가 검사해 읽음. 검색은 제목·키워드·예시 질문·자료 제목 순. 홈 검색의 「관련 업무」 구역과 업무도구 「업무자료」에서 연다. http/https 주소만 바깥에서 연다. AI 호출 없음

External code:
없음. 다른 런처 화면을 베끼지 않음

Difference:
실행·최근·폴더·학교 뒤에 관련 업무 카드를 둔다. 자료 PDF 목록을 검색 첫 화면에 펼치지 않음
화면 이름은 「관련 업무」(옛 「업무 주제」)

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

---

Feature: Local work-tree picture and extra window

Purpose:
검색된 업무의 가지를 그림으로 보고, 필요할 때 큰 창에서 본다

Design source:
내부 요구사항. 기존 MindMapNode JSON과 패널 스킨 색

Implementation:
자체 SVG 상자·꺾은 선. 미리보기는 홈 검색·업무자료 검색 상단. 크게 보기는 Tauri `work-map` 창. React Flow/D3/Markmap 없음. 노드 id는 영문·숫자·하이픈만 허용

External code:
없음. ChatGPT·NotebookLM 화면을 쓰지 않음

Difference:
외부 마인드맵 제품·생성기 연동이 아님. 로컬 JSON을 상자 그림으로 표시

PATENT_REVIEW:
계층을 그림으로 그리고 다른 창에서 항목을 여는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Extra window loads without panel store

Purpose:
크게 보기 창이 패널과 같은 저장소를 열다가 비어 보이지 않게 한다

Design source:
내부 요구사항. 기존 work-map 창과 정적 매뉴얼 JSON

Implementation:
work-map 창은 화면만 그리고 plugin-store 초기화를 건너뜀. SVG는 배치 크기만큼 그린다. 설치본은 패널과 같이 index.html을 연다. 이미 있는 창은 지우고 다시 연다. 개발 중에는 패널과 같은 개발 주소를 연다

External code:
없음

Difference:
외부 마인드맵 창·브라우저 복제가 아님

PATENT_REVIEW:
같은 프로그램을 두 창으로 나누는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Restore last search after topic detail

Purpose:
검색에서 연 업무를 닫으면 방금 보던 검색 화면이 다시 나오게 한다

Design source:
내부 요구사항. 기존 View 전환

Implementation:
home·topics 화면에 검색어를 잠깐 두고 상세의 뒤로와 Escape가 그 화면으로 돌아간다. 검색어는 파일에 쓰지 않음. 제어 문자 제거, 120자 제한

External code:
없음

Difference:
검색 기록 DB·클라우드 동기화가 아님

PATENT_REVIEW:
이전화면 검색어를 메모리에 두고 되돌리는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음



---

Feature: Async work map window command

Purpose:
크게 보기 창이 흰 화면으로 멈추는 문제를 고친다

Design source:
내부 결함 수정. Tauri 2 공개 문서의 "Windows에서 동기 커맨드로 창을 만들면 교착" 안내

Implementation:
`open_work_map_window` 커맨드를 `async fn`으로 바꿈. 창 생성 로직은 그대로

External code:
없음. 외부 코드 복사 없음

Difference:
새 기능이 아니라 기존 커맨드의 실행 방식만 바꿈

PATENT_REVIEW:
커맨드 실행 방식 변경. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Mouse-wheel zoom for work map

Purpose:
패널의 업무 그림과 크게 보기 창을 마우스 휠로 확대·축소한다

Design source:
내부 요구사항. 브라우저 표준 wheel 이벤트와 CSS 공개 사양

Implementation:
wheel 이벤트로 배율을 바꾸고 마우스 위치가 제자리에 있도록 스크롤을 보정. 패널은 100~400%, 큰 창은 45~300%. 외부 지도·마인드맵 라이브러리 없음

External code:
없음. 외부 코드 복사 없음

Difference:
외부 지도 뷰어·마인드맵 도구의 화면·코드를 가져오지 않음

PATENT_REVIEW:
휠 입력으로 배율을 바꾸는 일반 기법. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Work picture sits beside the launcher panel

Purpose:
크게 보기 그림 창을 런처와 같은 높이로 옆에 붙여 본다

Design source:
내부 요구사항. 기존 패널 위치 계산과 work-map 창

Implementation:
그림 창을 숨긴 채 런처 자리에 두고, 보인 뒤 가로를 패널의 1.4배로 늘리며 옆으로 옮긴다. 자리는 모니터 작업 영역 안으로 맞춘다. SVG는 창 안을 채운다. 다른 런처·시작 메뉴 화면을 쓰지 않음

External code:
없음

Difference:
외부 런처의 옆면 서랍·스냅 레이아웃 복제가 아님. 이미 있는 두 창의 좌표만 맞춤

PATENT_REVIEW:
창 둘을 같은 높이로 옆에 두는 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Work picture window scale by button and wheel

Purpose:
크게 보기 창에서 단추와 마우스 휠로 그림 크기를 바꾼다

Design source:
내부 요구사항. 기존 크게 보기 창

Implementation:
창 칸 픽셀 크기에 배율을 곱한 상자를 두고 SVG가 그 상자를 채운다. CSS zoom은 쓰지 않음. 휠은 그림 칸에서만 받는다

External code:
없음

Difference:
외부 지도 뷰어 확대 UI를 베끼지 않음

PATENT_REVIEW:
배율과 스크롤을 맞추는 일반 기법. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Work picture window pointer drag move

Purpose:
크게 보기 창에서 마우스 끌기로 그림 칸을 옮긴다

Design source:
내부 요구사항. 기존 크게 보기 창의 overflow 스크롤

Implementation:
그림 칸에서 왼쪽 단추를 누른 채 움직이면 scrollLeft·scrollTop을 바꾼다. 조금 움직인 뒤에만 옮기고, 그때는 상자 누르기를 열지 않는다. 외부 지도·캔버스 라이브러리 없음

External code:
없음

Difference:
외부 지도 뷰어 끌기 UI를 베끼지 않음

PATENT_REVIEW:
포인터로 스크롤 위치를 바꾸는 일반 기법. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Work picture window stable pane and box click

Purpose:
크게 보기 그림이 깜빡이지 않게 하고, 상자 누르기로 패널 상세를 연다

Design source:
내부 요구사항. 기존 크게 보기 창

Implementation:
칸 크기는 스크롤이 없는 바깥 틀에서만 잰다. 그림 상자는 그 칸에 배율을 곱한 정수 픽셀이다. 포인터 잡기는 조금 움직인 뒤에만 한다. 상자 클릭은 SVG onClick이 그대로 패널 열기로 간다

External code:
없음

Difference:
외부 지도 뷰어의 안정화·클릭 처리를 베끼지 않음

PATENT_REVIEW:
칸 크기와 스크롤을 나누는 일반 화면 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Topic detail previous-screen jump

Purpose:
업무 상세 오른쪽 아래에 이전화면을 두고 직전 화면으로 바로 간다

Design source:
내부 요구사항. 기존 처음 화면 단추와 상세 위쪽 뒤로

Implementation:
처음 화면과 같은 알약 단추에 글자만 이전화면. 누르면 이미 있는 backTo 화면으로 간다. 위쪽 화살표 뒤로는 그대로 둔다

External code:
없음

Difference:
외부 앱의 하단 이중 탐색 막대를 베끼지 않음

PATENT_REVIEW:
화면 전환 단추 배치. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Empty first-run shortcuts except common work tools

Purpose:
처음 설치에 사이트 샘플을 넣지 않고, 업무도구·컴퓨터도구는 공통으로 둔다

Design source:
내부 요구사항. 기존 시드와 설정 Pack 칸

Implementation:
목록이 비어 있을 때만 Network·CCTV·QR코드 넣기를 넣는다. 교육 Pack 3개와 나이스 등 샘플은 넣지 않는다. 설정의 교육 바로가기 추가 단추를 뺀다. 이미 있는 목록 파일은 지우지 않는다

External code:
없음

Difference:
외부 런처의 기본 바로가기 세트를 베끼지 않음

PATENT_REVIEW:
빈 칸에서 사용자가 넣고 Pack으로 나누는 일반 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Empty first-run todos

Purpose:
처음 설치에 할 일 샘플을 넣지 않는다

Design source:
내부 요구사항. 기존 할 일 칸

Implementation:
목록이 비어 있으면 빈 배열만 저장한다. 오늘·내일·모레 칸은 그대로 둔다. 이미 있는 할 일 파일은 지우지 않는다

External code:
없음

Difference:
외부 할 일 앱의 예시 목록을 베끼지 않음

PATENT_REVIEW:
빈 목록으로 시작하는 일반 구성. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Desk leftover mini window

Purpose:
패널을 닫아 둔 동안에도 오늘 남은 할 일 개수만 작은 창으로 본다

Design source:
내부 요구사항. 기존 할 일 칸과 work-map 별도 창 방식

Implementation:
설정이 켜져 있을 때만 220×140 창을 만든다. 오늘 날짜, 오늘·지난 미완료 건수, 런처 열기만 둔다. 작업 영역 왼쪽 아래에 둔다. 패널 숨김은 이 창을 건드리지 않는다. 제목 줄 X는 창만 숨긴다. 홈을 연 뒤에 창을 만들고, 할 일 숫자는 메인 창 이벤트로만 받는다. 미니 창은 저장 파일을 열지 않는다. Windows 위젯 보드·Rainmeter·아이콘 뒤 붙이기를 쓰지 않는다

External code:
없음 (Tauri 공식 창 API)

Potential similar products:
바탕화면 위젯, 할 일 스티커 메모

Difference:
별도 작은 창일 뿐이며 바탕화면 셸이나 위젯 보드에 넣지 않는다. 할 일 목록 전체가 아니라 남은 건수만 보여 준다

PATENT_REVIEW:
별도 창에 요약 숫자를 두는 일반 UI. 바탕화면 셸 삽입·항상 위·아이콘 뒤 배치와는 다르다. 청구항 대조 없음. 특허 비침해를 보장하지 않음

Removed:
0.1.59에서 미니 창과 설정 칸을 뺀다. 홈 빈 칸 안내로 대체한다.

---

Feature: Home favorite two-column preview

Purpose:
자주 쓰는 바로가기를 종류별로 조금 더 많이 한눈에 본다

Design source:
내부 요구사항. 기존 FavoriteGrid 2열과 홈 종류 칸

Implementation:
홈 자주 사용하는 도구만 2열 목록으로 두고 종류마다 6개까지 보여 준다. 칸 안 스크롤은 넣지 않는다. 나머지는 모두 화면

External code:
없음

Difference:
모두 화면의 열 설정과 별개로 홈 미리보기만 고정한다

PATENT_REVIEW:
목록을 잘라 보여 주는 일반 UI. 청구항 대조 없음. 특허 비침해를 보장하지 않음

---

Feature: Memo side window

Purpose:
홈 아래 짧은 메모를 런처 옆 창에서 더 크게 보고, 그 창만 옮겨 두기 위함

Design source:
내부 요구사항. 기존 업무 그림 옆 창과 홈 메모 칸

Implementation:
`memo-pad` 창을 패널 옆에서 연다. 처음 열 때만 옆으로 옮기며 조금 더 넓게 한다. 창 제목 줄로 옮기고, 모서리로 크기를 바꾼다. 바꾼 너비·높이는 이 PC `settings.json`의 `memoWidth`/`memoHeight`에 남긴다. 패널을 숨기면 창도 숨기고 크기를 저장한다. 다시 열면 창 위치·크기는 그대로 둔다. 제목 줄 X로 닫으면 크기를 저장하고, 다음 크게는 다시 옆에서 연다. 글은 패널이 저장하고, 창은 짧게 받아 보여 준다. 창은 메모 본문 저장 파일을 열지 않는다. 여러 장·노란 스티커·항상 위는 없다

External code:
없음 (Tauri 공식 창 API)

Potential similar products:
스티커 메모, 노트 앱

Difference:
런처와 같이 숨는 한 칸 메모일 뿐이며 바탕 스티커나 메모 앱이 아니다

PATENT_REVIEW:
별도 창·크기 조절·위치 유지는 일반 OS 창 동작. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Resizable panel with remembered size

Purpose:
학교 사무 PC에서 패널 창 크기를 사용자에 맞게 바꾸고 다음 실행에도 같은 크기로 열기 위함

Design source:
내부 요구사항. Windows 창 테두리만 사용

Implementation:
`main` 창 `resizable: true`. 최소 400×550, 최대 720×900. 기본 440×650. `settings.json`에 `panelWidth`·`panelHeight` 저장. 시작·숨김·종료·리사이즈 후 저장. 전용 손잡이 UI·스냅·다른 런처 복제 없음

External code:
없음 (Tauri 공식 창 API)

Potential similar products:
일반 Windows 프로그램 창 크기 조절

Difference:
웹 반응형 그리드가 아니라 창 크기만 바꾸고, 안쪽은 기존 스크롤 레이아웃을 그대로 씀

PATENT_REVIEW:
OS 창 크기 조절은 일반 UI. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Open folders with explorer.exe

Purpose:
런처에서 폴더를 처음 열 때 Windows 탐색기 제목 줄이 검게 보이는 경우를 줄이기 위함

Design source:
내부 요구사항. Windows 탐색기를 직접 호출

Implementation:
`type`이 `folder`일 때만 `C:\Windows\explorer.exe`에 폴더 경로를 인자로 넘긴다. 디렉터리가 아니면 열지 않는다. 파일·프로그램·사이트는 기존 `open_path`·실행 방식을 유지한다. 셸 문자열 조합 없음

External code:
없음

Potential similar products:
바탕화면에서 폴더 열기, 시작 메뉴

Difference:
탐색기 테마를 바꾸지 않고, 폴더만 고정된 explorer.exe로 연다

PATENT_REVIEW:
고정 실행 파일로 폴더를 여는 일반 OS 호출. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Work shortcut guide

Purpose:
직장·교육기관에서 자주 쓰는 Windows·문서 단축키를 한곳에서 보고, 열 수 있는 화면은 바로 열기 위함

Design source:
내부 요구사항. 키 입력 시뮬레이션 없음

Implementation:
업무도구에 「단축키」 화면. 고정 20개. 실행은 `explorer`·`taskmgr`·`snip`·`settings`·`lock` id만. 탐색기·작업 관리자·캡처·설정은 고정 경로 또는 고정 URI. 잠금은 `LockWorkStation`. 키를 대신 누르지 않음

External code:
없음 (Windows API·고정 실행 파일)

Potential similar products:
단축키 치트시트 앱, 매크로 런처

Difference:
안내 목록이며 키 전송·매크로·다른 앱 복제가 아니다

PATENT_REVIEW:
고정 id로 OS 화면을 여는 일반 UI. 키 후킹·매크로와 다르다. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Notice and site share pack

Purpose:
기관이 공지와 사이트 바로가기만 한 파일로 직원 PC에 나눠 주기 위함

Design source:
내부 요구사항. 기존 공지 Pack·사이트 Pack·백업과 구분

Implementation:
`kind: "edulauncher-share"`. notices와 url 타입 tools만. 할 일·메모·설정 없음. 저장 시 공지·사이트를 고른 뒤 파일로 씀. 가져올 때 공지는 고르기, 사이트는 넣기와 함께 병합. 백업(`edulauncher-backup`) 다음·일반 notices 앞에서 판별. 설정에서 고르기 화면·가져오기

External code:
없음

Potential similar products:
인트라넷 배포 패키지, 런처 프리셋

Difference:
게시판 수집 없음. 이 PC 목록만 파일로 나눔. 전체 백업이 아님

PATENT_REVIEW:
로컬 JSON 병합·선택 UI. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Home search result order and related-work label

Purpose:
홈에서 검색할 때 바로 실행할 항목을 먼저 두고, 업무 안내는 「관련 업무」로 부르게 함

Design source:
내부 요구사항. 기존 HomePage 검색 구역만 순서·문구 변경

Implementation:
화면과 `flattenResults`를 관련 도구 → 최근 사용 → 이 PC 폴더 → 학교 → 관련 업무 순으로 맞춤. 「업무 주제」표시를 「관련 업무」로 바꿈. Topic id·JSON 구조는 그대로

External code:
없음

Potential similar products:
일반 런처 검색 목록

Difference:
교육행정 관련 업무 JSON을 마지막 구역에 두고, 실행·최근·폴더를 앞에 둔 자체 순서

PATENT_REVIEW:
목록 구역 순서·표시 이름만. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Default show window on launch and run after NSIS install

Purpose:
처음 설치 후 패널이 바로 보이게 하고, 설치가 끝나면 프로그램을 실행함

Design source:
내부 요구사항. 기존 settings 기본값·Tauri NSIS installerHooks

Implementation:
`showWindowOnLaunch` 기본 true. `autoStart` 기본 true는 유지. NSIS `windows/hooks.nsh`의 POSTINSTALL에서 설치 폴더 exe 실행. 이미 저장된 settings.json은 덮지 않음

External code:
없음. Tauri 공식 installerHooks 자리만 사용

Difference:
교육업무 런처 자체 설정 기본값과 설치 훅. 타 런처 UI 복제 없음

PATENT_REVIEW:
시작 옵션·설치 후 실행은 일반 데스크톱 관행. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Staff-only Network and CCTV list via Pack

Purpose:
일반 설치 화면에는 망 검색 도구를 두지 않고, 담당자가 Pack을 적용한 PC 목록에만 보이게 함

Design source:
내부 요구사항. 기존 바로가기 Pack(`type: internal`)과 seedIfEmpty

Implementation:
첫 설치 `COMMON_WORK_TOOLS`는 QR코드 넣기만. Network·CCTV 정의와 화면은 앱에 그대로 두고, Pack으로 id가 들어오면 목록에 붙음. 이미 있는 tools.json은 지우지 않음. 학교 검색 상세의 네트워크·CCTV 단추는 뺌. 설정 켜기/끄기는 두지 않음. 배포용 Pack 파일은 설치본·git에 넣지 않음

External code:
없음

Difference:
역할 로그인 없이, 이 PC 목록에 Pack으로만 항목을 더함. 계정 잠금이 아님

PATENT_REVIEW:
목록 항목을 Pack으로 넣는 일반 구성. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Topic review button only in development

Purpose:
일반 설치 설정에는 업무자료 검토 입구를 두지 않고, 소스 개발 실행에서만 열어 봄

Design source:
내부 요구사항. Vite `import.meta.env.DEV`

Implementation:
설정 업무자료 칸의 「검토가 필요한 업무자료」를 개발 실행에서만 그림. TopicReviewPage는 그대로. 설치본에는 단추 없음

External code:
없음

Difference:
역할 로그인 없이 실행 방식(dev/설치)으로 입구만 나눔

PATENT_REVIEW:
개발 전용 설정 단추. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Personal-PC-only install notice on the site

Purpose:
설치 안내에서 개인 사용 PC에만 두라고 분명히 알리기 위함

Design source:
내부 요구사항. 기존 website 소개·다운로드 문구

Implementation:
소개·설치 안내 상단에 굵은 「개인 사용 PC에만 설치하세요」와 공용 PC·실습실·다른 계정 안내. 아랫줄에 파일·폴더를 삭제하지 않는다고 적음. 설정 사용 방법에도 같은 뜻. 새 패키지 없음

External code:
없음

Difference:
계정 잠금이 아니라 설치 안내 문구

PATENT_REVIEW:
안내 문구만. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Main panel on the Windows taskbar

Purpose:
런처가 실행 중일 때 하단 작업 표시줄에서도 패널을 찾을 수 있게 함

Design source:
내부 요구사항. 기존 Tauri 창 `skipTaskbar`

Implementation:
메인 창만 `skipTaskbar: false`. 업무 그림·메모 창은 `skip_taskbar(true)` 유지. 트레이·닫으면 숨김은 그대로

External code:
없음

Difference:
표시줄 아이콘은 메인 패널만. 타 런처 UI 복제 없음

PATENT_REVIEW:
창을 작업 표시줄에 보이게 하는 일반 Windows 동작. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Keep main panel on the taskbar after close

Purpose:
창을 닫아도 작업 표시줄 아이콘을 남기고, 아이콘을 누르면 패널을 다시 연다. 컴퓨터가 켜져 있는 동안 아이콘이 보이게 함

Design source:
내부 요구사항. 기존 Tauri `hide` / `minimize` / `reveal_panel`

Implementation:
메인 창을 숨기지 않고 최소화. 시작 직후 `show` 뒤 `minimize`로 아이콘을 둠. 트레이 토글은 최소화된 창을 다시 연다. 업무 그림·메모는 계속 숨김. 작업 표시줄 고정(핀) 없음

External code:
없음

Difference:
표시줄 아이콘은 실행 중인 메인 패널만. 타 런처 UI 복제 없음

PATENT_REVIEW:
창 최소화와 작업 표시줄 복원은 일반 Windows 동작. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Pick sites when importing a share pack

Purpose:
공지·사이트 Pack을 가져올 때 사이트도 목록에 보이게 하고 고른 항목만 넣음

Design source:
내부 요구사항. 기존 `NoticePackPick` 공지 고르기와 `SharePackSavePage` 사이트 목록

Implementation:
가져오기 화면에 사이트 체크 목록. 이미 있는 id는 건너뜀. 사이트만 있는 Pack도 같은 고르기 화면. 넣기는 고른 사이트만 `applyLauncherPack`

External code:
없음

Difference:
저장·가져오기 모두 이 PC에서 항목을 고름. 타 런처 UI 복제 없음

PATENT_REVIEW:
목록에서 항목을 고르는 일반 가져오기 화면. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Keep Cloudflare deploy on website/ only

Purpose:
데스크톱 앱 Vite와 소개 사이트 배포를 섞지 않음

Design source:
내부 요구사항. 기존 `website/wrangler.jsonc`, `npm run site:build`

Implementation:
루트 `package.json`·`vite.config.ts`에서 wrangler·`@cloudflare/vite-plugin`을 뺌. 루트 `wrangler.jsonc` 삭제. 문서에 루트 배포 금지

External code:
없음

Difference:
사이트는 `website/`만. 앱 빌드는 패널만

PATENT_REVIEW:
빌드 경로 분리. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Type label on home search tool rows

Purpose:
검색된 관련 도구 줄에서 사이트·프로그램·파일·폴더·업무도구를 바로 구분

Design source:
내부 요구사항. 기존 `toolGroupLabel`

Implementation:
관련 도구 각 줄 오른쪽에 종류 이름. 구역을 나누지 않음. 검색 순서·키보드 이동 그대로

External code:
없음

Difference:
홈 자주 사용하는 도구처럼 구역을 나누지 않고 줄에만 표시

PATENT_REVIEW:
목록 줄에 종류 이름을 붙이는 일반 표시. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Place panel when restoring from the taskbar

Purpose:
작업 표시줄에서 패널을 열 때도 왼쪽이 아니라 설정한 자리(기본 오른쪽 아래)에 펼침

Design source:
내부 요구사항. 기존 `position_panel`

Implementation:
시작 시 최소화 전에 자리를 잡음. 포커스가 오고 최소화가 아니면 같은 배치를 다시 적용. 트레이·단축키와 같음

External code:
없음

Difference:
창 복원 시에도 기존 자리 규칙을 씀. 타 런처 UI 복제 없음

PATENT_REVIEW:
창을 화면 구석에 두는 일반 배치. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Tell the user when a newer setup file exists

Purpose:
설치된 버전보다 새 GitHub Release가 있으면 설정에서 안내하고 설치 안내만 연다

Design source:
내부 요구사항. 기존 GitHub Releases 태그와 `APP_CONFIG.version`. 공인 IP 조회와 같은 curl 호출

Implementation:
`releases/latest`의 `tag_name`만 읽음. 숫자·날짜를 비교. 새 버전이면 설정 프로그램 정보에 안내와 단추. 설치 파일은 받지 않고 브라우저만 연다. 확인 실패는 안내 생략

External code:
없음

Difference:
자동 업데이트 설치기가 아님. 안내 후 사용자가 설치본을 교체

PATENT_REVIEW:
버전 문자열 비교와 공개 릴리스 주소 열기는 일반 안내. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Guided PC troubleshooting cards

Purpose:
학교 행정실 PC에서 인터넷·프린터·Windows 증상을 질문으로 좁혀 안내한다

Design source:
내부 지식 JSON(`LauncherBox-PC-knowledgebase-30`). Microsoft 공개 지원 문서 URL만 출처

Implementation:
로컬 JSON을 읽어 목록·검색·질문 흐름을 표시. 단계는 글만. 시스템 명령을 대신 실행하지 않음. 공식 주소는 기존 브라우저 열기. 검색어는 파일에 넣지 않음

External code:
없음. JSON 본문은 제공된 지식 파일. UI·로더는 자체 구현

Difference:
타 런처 UI 복제 없음. 자동 복구·원격 진단 아님. 관련 업무와 구역을 나눔

PATENT_REVIEW:
질문-선택-안내 흐름은 일반 안내 화면. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Tell once at process start if a newer setup exists

Purpose:
설정을 열지 않아도 켤 때 한 번 새 설치 파일이 있으면 패널에 안내한다

Design source:
내부 요구사항. 기존 `findNewerRelease`와 GitHub Releases 태그

Implementation:
메인 창 시작 후 기존 태그 비교를 한 번 호출. 더 새면 패널 안내와 설치 안내 단추. 패널을 숨긴 채 켜면 억지로 열지 않음. 자동 설치·다운로드 없음

External code:
없음

Difference:
자동 업데이트 설치기가 아님. Windows 알림이 아님

PATENT_REVIEW:
버전 비교 후 안내 표시는 일반 알림. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Intro site custom domain

Purpose:
설정 소개 사이트 단추를 사용자 지정 주소로 연다

Design source:
내부 요구사항. 기존 `APP_CONFIG.siteUrl`과 `launchQuickUrl`

Implementation:
https 주소만 바꾸고 기존 브라우저 열기를 씀

External code:
없음

Difference:
주소 문자열만 변경. 새 연동 없음

PATENT_REVIEW:
고정 https 주소를 브라우저로 여는 일반 동작. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Show current and newer version on the setup notice

Purpose:
새 설치 안내에서 이 PC 버전과 새 버전을 같이 보여 주고 소개 사이트를 연다

Design source:
내부 요구사항. 기존 안내 문구와 `APP_CONFIG.siteUrl`

Implementation:
패널·설정 안내에 두 버전 문자열을 넣고 단추는 소개 사이트 https만 연다. 자동 설치 없음

External code:
없음

Difference:
GitHub Releases 페이지를 직접 열지 않음

PATENT_REVIEW:
버전 문자열 표시와 고정 주소 열기는 일반 안내. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Intro site version notes

Purpose:
소개 페이지에서 설치 버전과 짧은 수정·개선을 본다

Design source:
내부 요구사항. 기존 소개 페이지 구역과 `수정기록.txt` 요약

Implementation:
website에 고정 목록. GitHub API·쿠키·자동 수집 없음. 설치 파일은 Releases 링크만

External code:
없음

Difference:
릴리스 노트를 사이트에 짧게 적음. 타 제품 변경 로그 UI 복제 없음

PATENT_REVIEW:
버전과 한 줄 설명을 나열하는 일반 안내. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Hide console when writing file association

Purpose:
켤 때 `reg.exe` 검은 창이 여러 번 깜빡이지 않게 한다

Design source:
내부 요구사항. 기존 `netutil`의 창 없는 실행과 같은 Windows 생성 플래그

Implementation:
`reg add`에 창 없음 플래그. 표준 입출력은 열지 않음. 동작은 이전과 같음

External code:
없음

Difference:
콘솔을 작게 만들지 않고 창을 만들지 않음

PATENT_REVIEW:
자식 프로세스 창을 숨기는 일반 Windows 동작. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Optional hide of empty home search groups

Purpose:
홈 검색 구역 순서와 빈 안내는 그대로 두고, 원할 때만 일치가 없는 구역을 숨긴다

Design source:
내부 요구사항. 기존 HomePage 구역과 설정 보기 토글

Implementation:
`hideEmptySearchGroups` 기본 false. 켜면 일치가 없는 구역을 렌더하지 않음. 모두 없으면 한 줄. 이 PC 폴더는 한 글자일 때 안내를 남기고, 두 글자 이상에서만 빈 결과를 숨김. 키보드 순서는 기존 flattenResults

External code:
없음

Potential similar products:
일반 검색 화면의 빈 구역 숨김

Difference:
구역 순서를 점수·개수로 바꾸지 않음. 이 PC 설정에만 남김

PATENT_REVIEW:
설정 불리언과 조건부 표시. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Keep dropped PNG picture on site shortcut

Purpose:
즐겨찾기 표시줄에서 끌어 넣은 사이트에, 브라우저가 이미 넘긴 PNG만 바로가기 그림으로 남긴다

Design source:
내부 요구사항. 기존 `iconImage`와 `asLocalPngIcon`

Implementation:
드롭 HTML에서 `data:image/png;base64`만 읽음. http(s)·chrome 그림 주소는 쓰지 않음. 사이트에 다시 접속하지 않음. 이미 있는 주소는 그림이 비어 있을 때만 채움

External code:
없음

Potential similar products:
브라우저 즐겨찾기 드래그

Difference:
사이트 파비콘을 받지 않음. 끌어 온 PNG만 이 PC에 남김

PATENT_REVIEW:
드롭 문자열에서 그림 자료를 고르는 일반 처리. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Send To and Windows favorites file icon

Purpose:
탐색기 보내기와 인터넷 즐겨찾기의 Windows `.url`에서, 그 파일에 붙어 있는 아이콘을 바로가기에 남긴다

Design source:
내부 요구사항. 기존 `read_url_shortcut`·`local_file_icon`과 Pack 실행 인자

Implementation:
현재 사용자 SendTo에 `.lnk`만 둠. `.url` 기본 연결은 바꾸지 않음. 인자의 `.url`은 Pack과 다른 이벤트로 넘김. 목록의 Windows `.url`만 경로를 두고 같은 읽기를 씀. JSON 북마크는 경로 없음

External code:
없음

Potential similar products:
Windows 보내기, 인터넷 바로가기

Difference:
사이트를 다시 열지 않음. `.url`을 기본 프로그램으로 빼앗지 않음

PATENT_REVIEW:
보내기 폴더에 바로가기를 두는 일반 Windows 동작. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

Feature: Favorites shortcut own icon file and virtual .url drop

Purpose:
인터넷 즐겨찾기에서 끌어 넣은 `.url`이 가리키는 이 PC 안의 아이콘 파일을 바로가기 그림으로 남기고, 경로 없이 넘어오는 가상 파일 `.url`도 이름과 그림을 받는다

Design source:
내부 요구사항. Windows 공식 API(ExtractIconExW, IDataObject 가상 파일 형식). 기존 `read_url_shortcut`·`shell_icon`·`drop_target`

Implementation:
`.url` 본문의 IconFile·IconIndex를 읽어 드라이브 문자 절대 경로의 .ico/.exe/.dll만 받음(환경변수 확장은 이 PC 값만, URL·UNC·네트워크 드라이브·상대 경로·없는 환경변수는 거부). 실패하면 기존 셸 아이콘으로 돌아감. 경로가 없을 때는 드롭 데이터의 파일 이름과 본문(16KB 이하)만 읽고 저장하지 않음. 새 라이브러리 없음(기존 windows 크레이트 기능 플래그 Win32_System_DataExchange만 추가)

External code:
없음

Potential similar products:
탐색기 즐겨찾기 아이콘, 브라우저 북마크 가져오기

Difference:
사이트에 접속하거나 파비콘을 받지 않음. 원격 IconFile 주소는 받지 않음. 이 PC에 이미 있는 그림 파일만 씀

PATENT_REVIEW:
드롭 데이터에서 주소와 아이콘 위치를 읽어 표시 그림으로 쓰는 일반 처리. 청구항 대조는 별도. 특허 비침해를 보장하지 않음
Feature: Accept IE favorites drag and report unreadable drops

Purpose:
IE 즐겨찾기 표시줄·펼친 즐겨찾기에서 끌어 넣을 때 받지 못하던 문제를 고치고, 읽지 못하면 조용히 넘기지 않고 안내한다

Design source:
내부 요구사항. Windows 공식 OLE 끌기·놓기 API(IDropTarget 동작 값, IDataObject 형식, Shell IDList). 기존 `drop_target.rs`

Implementation:
끌어 온 쪽이 허용한 동작 안에서 복사를 먼저, 없으면 링크로 응답(이동은 원본을 지울 수 있어 받지 않음). 읽는 순서는 CF_HDROP, Shell IDList Array(파일 경로 복원. PIDL 범위 검사 후 사용), 가상 파일 .url, UniformResourceLocator(W), 텍스트. 모두 실패하면 받은 형식 이름만 화면 안내로 알림(내용은 보내지 않음). 새 라이브러리 없음(기존 windows 크레이트 기능 플래그 Win32_UI_Shell_Common만 추가)

External code:
없음

Potential similar products:
브라우저·탐색기의 끌어 넣기, 북마크 가져오기

Difference:
사이트에 접속하지 않음. 형식 이름만 알리고 끌어 온 내용은 저장·전송하지 않음

PATENT_REVIEW:
끌기 자료의 형식을 차례로 시도해 주소를 읽는 일반 처리. 청구항 대조는 별도. 특허 비침해를 보장하지 않음
Feature: Import exported favorites HTML with site pictures

Purpose:
Edge 등이 내보낸 즐겨찾기 HTML을 불러와 주소·이름·사이트 그림(PNG)을 바로가기에 남긴다

Design source:
내부 요구사항. 브라우저들이 서로 주고받는 공개 북마크 HTML 형식(Netscape 북마크 파일 형식)의 표시 방식. 사용자가 이 PC에서 직접 내보낸 파일. 기존 `asLocalPngIcon`·`addDroppedSite`

Implementation:
파일 선택창으로 .html/.htm(8MB 이하, UTF-8)만 읽음. `<A HREF ICON>`·`<H3>` 폴더를 자체 토큰 분석으로 목록화. http(s) 주소만, 그림은 PNG data 주소만(40KB 이하 검사) 이 PC tools.json에 저장. 항목 2000개·폴더 깊이 8 제한. 새 라이브러리 없음

External code:
없음

Potential similar products:
브라우저 즐겨찾기 가져오기, 북마크 관리자

Difference:
사이트에 접속하지 않음. 브라우저 프로필·Favicons 파일을 열지 않음. 사용자가 내보낸 파일만 읽음. 그림은 파일 안에 들어 있는 PNG만 사용

PATENT_REVIEW:
공개 파일 형식을 읽어 목록과 표시 그림으로 쓰는 일반 처리. 청구항 대조는 별도. 특허 비침해를 보장하지 않음
Feature: Browser favicon lookup by page address (read-only SQLite reader)

Purpose:
Edge·Chrome에서 끌어 넣거나 목록에서 넣은 사이트에, 그 브라우저가 이 PC에 이미 저장해 둔 사이트 그림(PNG)을 같이 남긴다

Design source:
내부 요구사항. SQLite 공개 파일 형식 문서(퍼블릭 도메인 프로젝트가 공개한 형식 설명)만 보고 새로 설계. 브라우저 데이터 파일은 이 PC 사용자 자신의 것. 기존 `asLocalPngIcon`·`addDroppedSiteNow`

Implementation:
`favicon_db.rs`: 읽기 전용으로 Favicons 파일을 열어 머리말·페이지 크기·UTF-8을 확인하고, 표 이름과 앞쪽 열 이름이 기대와 같을 때만 `icon_mapping`(주소→그림 번호)과 `favicon_bitmaps`(그림)를 훑는다(b-tree 잎·안쪽 페이지, 넘침 페이지, 가변 길이 정수). 같은 주소(끝 슬래시·조각 무시)를 우선하고 없으면 같은 호스트. PNG 서명·24KB 이하·16~128px 중 32px에 가까운 것 하나. 페이지 방문 15만·깊이 24·행 64KB·프로필 6개 제한. 맞지 않거나 잘못된 파일이면 그림만 포기(지구본). History·Cookies·Login Data는 열지 않음. 결과는 이 PC tools.json에만 저장하고 백업·Pack에는 넣지 않음(기존 규칙). 새 라이브러리 없음

External code:
없음

Potential similar products:
브라우저 즐겨찾기 가져오기, 북마크 관리자, SQLite 뷰어

Difference:
사이트에 접속하지 않음. 필요한 두 표만 읽는 전용 최소 코드이며 범용 SQLite 엔진이 아님. 쓰기·기록·쿠키 접근 없음

PATENT_REVIEW:
이 PC에 저장된 사이트 그림을 주소로 찾아 표시 그림으로 쓰는 일반 처리. 청구항 대조는 별도. 특허 비침해를 보장하지 않음. 저작권 관련: 사이트 로고는 각 소유자의 저작물·상표일 수 있어 이 PC 안 표시에만 쓰고 배포하지 않음. 상용 배포 전 전문가 검토 권장
Feature: Favicons in the internet favorites list

Purpose:
인터넷 즐겨찾기 목록의 각 줄 앞에 사이트 그림을 보여 주고, 「넣기」 때 같은 그림을 남긴다

Design source:
내부 요구사항. 기존 `favicon_db.rs`(읽기 전용 최소 SQLite 읽기)·`readUrlShortcut`·`ToolGlyph`

Implementation:
목록 그림 순서는 내보낸 파일의 PNG → `.url` 파일 자체 그림 → 브라우저가 이 PC에 저장해 둔 그림. 브라우저 그림은 주소 목록(1000개까지)을 한 번에 넘겨 icon_mapping·favicon_bitmaps를 각각 한 번만 훑어 찾음. 없으면 기존 지구본. 새 라이브러리 없음

External code:
없음

Potential similar products:
브라우저 즐겨찾기 목록, 북마크 관리자

Difference:
사이트에 접속하지 않음. 그림은 화면 표시와 이 PC의 tools.json에만 쓰고 백업·Pack에는 넣지 않음

PATENT_REVIEW:
저장된 사이트 그림을 주소로 찾아 목록 표시에 쓰는 일반 처리. 청구항 대조는 별도. 특허 비침해를 보장하지 않음. 사이트 로고는 각 소유자의 저작물·상표일 수 있어 이 PC 안 표시에만 씀

---

Feature: Home panel arrangement

Purpose:
홈에서 인사, 검색, 공지, 자주 사용하는 도구, 메모, 상태 줄을 한 흐름으로 보여 주기

Design source:
내부 요구사항. 기존 검색·실행·즐겨찾기·공지·메모 저장소를 그대로 사용

Implementation:
홈 전용 컴포넌트로 헤더·검색·공지 카드·도구 카드를 그림. 색은 기존 스킨 변수. 도구 목록은 저장된 즐겨찾기. 새 라이브러리 없음. 글꼴 파일 없음

External code:
없음

Potential similar products:
업무용 런처의 홈 카드 배치

Difference:
이 프로젝트의 검색 순서, 공지, 할 일, 메모 창을 유지한다. 외부 제품 이름이나 화면 문구를 가져오지 않음

PATENT_REVIEW:
카드 목록과 검색창 포커스는 일반 화면 구성. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Previous home arrangement option

Purpose:
설정에서 카드형 홈 이전 배치를 다시 고를 수 있게 한다

Design source:
이 저장소의 직전 홈 배치. 색 스킨(서류·밝은 화면·어두운 화면)은 그대로

Implementation:
설정 값 prior일 때만 이전 헤더·검색·공지 목록·줄 목록·메모를 그린다. 색은 서류 변수. 기본값은 카드형 홈. 새 라이브러리 없음

External code:
없음

Potential similar products:
화면 테마 전환

Difference:
색 스킨과 홈 배치 선택을 한 목록에 둔다. 이전 배치는 이 앱이 이미 쓰던 화면이다

PATENT_REVIEW:
설정 값에 따라 같은 데이터를 다른 배치로 그리는 일반 화면 전환. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Work material area label

Purpose:
업무자료가 강원 기준인지, 전국 공통인지, 다른 교육청 참고인지 화면에서 구분한다

Design source:
이 저장소의 업무자료 JSON과 기존 배지·탭 화면

Implementation:
JSON에 지역 값이 있으면 그 값을 쓴다. 없으면 발행기관·문서명·제목의 기관명만 보고 읽기 중에 나눈다. 기관명이 없거나 서로 다르면 지역 확인 필요로 둔다. 원본 JSON은 고치지 않는다. 타 교육청 금액·서식은 변환하지 않는다

External code:
없음

Potential similar products:
문서 목록의 출처 표시

Difference:
검색 결과의 중심은 문서가 아니라 업무주제다. 주제 자체에는 지역을 붙이지 않고 자료마다 표시한다

PATENT_REVIEW:
출처 라벨, 탭, 필터, 키워드 검색은 일반 화면 구성. 특허 청구항과 1:1 대조는 하지 않음. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Handbook-backed topic detail

Purpose:
검색 카드에 쉬운 설명을 보여주고, 편람에서 확인한 절차·서류·인쇄 쪽수를 자세히 보기에 붙인다

Design source:
이 저장소의 Topic 카드·상세 화면. 문장은 프로젝트 안 2026 학교행정 업무편람 PDF에서 확인한 내용만 사용

Implementation:
Topic에 선택 필드 beginnerSummary와 detail을 두고, 없는 주제는 기존 설명과 처리 순서를 그대로 보여 준다. 원문 보기는 http 주소가 있을 때만 연다

External code:
없음

PATENT_REVIEW:
검색 카드와 단계 목록은 일반 화면 구성. 특허 청구항과 1:1 대조는 하지 않음. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Plain-language work search phrases

Purpose:
공식 업무명 대신 짧은 말로 기존 업무주제를 찾게 한다

Design source:
이 저장소의 기존 Topic 제목과 키워드. 편람 원문은 복사하지 않음

Implementation:
topics.json의 beginner와 exampleQuestions에 짧은 검색 표현을 합침. 같은 업무는 기존 id에 붙임. 분류 비교는 검색어 전체만 본다

External code:
없음

PATENT_REVIEW:
문자열 포함 비교와 키워드 배열. 청구항 대조는 별도. 특허 비침해를 보장하지 않음

---

Feature: Work-guide panels on existing topics

Purpose:
기존 업무주제 자세히 보기에 흐름, 조건, 일정, 체크, 비교표를 눌러 보게 한다

Design source:
이 저장소의 Topic 상세 화면. 문장은 참고자료 18건을 기존 ID에만 붙였고, 없는 업무는 만들지 않음

Implementation:
세로 단계 버튼, 조건 버튼, 접히는 목록, 표. 그래프 라이브러리 없음. 체크 상태는 화면 안에서만 유지. 금액과 기한은 원문 확인 필요로 표시

External code:
없음

PATENT_REVIEW:
단계 버튼과 접히는 목록은 일반 화면 구성. 특허 청구항과 1:1 대조는 하지 않음. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Boxed work-step flow

Purpose:
업무 순서를 아이콘이 있는 상자와 짧은 한눈에 보기로 눌러 보게 한다

Design source:
이 저장소의 Topic 상세 화면과 이미 있는 lucide 아이콘. 단계 문장은 기존 workflow와 참고 흐름만 사용

Implementation:
상자, 화살표, 단계 색은 기존 화면 색으로 그림. 좁은 창은 세로, 넓은 창은 가로. 통계 숫자가 없으면 차트를 그리지 않음. 새 라이브러리 없음

External code:
없음

PATENT_REVIEW:
상자 흐름과 아이콘 버튼은 일반 화면 구성. 특허 청구항과 1:1 대조는 하지 않음. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Natural-question search order

Purpose:
같은 업무에 쉬운 질문과 초보자 검색어가 같이 있을 때, 점수가 더 높은 쉬운 질문을 쓰게 한다

Design source:
이 저장소의 기존 검색 점수. 검색 문장은 추가하지 않음

Implementation:
쉬운 질문 비교를 초보자 검색어보다 먼저 한다. 흐름 상자 제목도 처리 순서와 같이 찾는다

External code:
없음

PATENT_REVIEW:
문자열 포함 비교. 청구항 대조는 별도. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Pension topic detail from an attached pack

Purpose:
공무원연금 업무를 쪽수 안내 대신 첨부 자료의 단계와 조건으로 보여 준다

Design source:
이 저장소의 Topic 상세 화면. 문장은 launcherbox-topic-pension-v4.json만 사용

Implementation:
기존 ID gwe-2026-p142에 흐름, 조건, 일정, 체크, 비교표를 붙임. 금액과 기간은 고치지 않음. 그래프는 그리지 않음

External code:
없음

PATENT_REVIEW:
상자 흐름과 조건 버튼은 일반 화면 구성. 특허 청구항과 1:1 대조는 하지 않음. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Handbook category pictures from the v6 pack

Purpose:
편람 분류 19개와 업무 91개를 기존 업무 목록과 따로 두고, 상자 그림으로 열게 한다

Design source:
이 저장소의 업무 그림 배치(workMapLayout)와 단계 목록. 문장은 src/data/handbookFlowPack.json만 사용

Implementation:
흐름 문장에서 상자와 화살표만 읽어 기존 왼쪽-오른쪽 상자 배치로 그린다. 외부 도식 라이브러리는 넣지 않음. 기존 업무 ID는 바꾸지 않음

External code:
없음

PATENT_REVIEW:
상자 클릭으로 단계를 여는 구성. 특허 청구항과 1:1 대조는 하지 않음. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Korean installer pages and upgrade without a close step

Purpose:
학교 업무 담당자가 설치 창을 한글로 보고, 기존 버전을 지운 뒤 닫기 단추 없이 새 설치로 이어지게 한다

Design source:
Tauri NSIS 설정 languages. 설치 스크립트는 Tauri 템플릿(Apache-2.0 OR MIT, tauri-cli 2.11.4)이며 업그레이드 제거에 /UPDATE를 항상 붙인 한 줄만 이 저장소에서 바꿈

Implementation:
설치 언어는 Korean만. 영어 설치 파일은 만들지 않음. 제거 프로그램이 /UPDATE를 받으면 완료 페이지를 스스로 닫음

External code:
설치 스크립트 본문은 Tauri 템플릿. 앱 화면 코드는 복사하지 않음

PATENT_REVIEW:
설치 마법사 언어와 업데이트 시 자동 닫기. 청구항 대조는 별도. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Certificate search shows the EPKI site

Purpose:
인증서 검색 안내에 신청 사이트 주소를 보여 준다

Design source:
요청자가 지정한 https://www.epki.go.kr/ . 기존 업무 카드와 원문 보기

Implementation:
TASK-010 안내 문장과 자료 주소, EPKI 매뉴얼 첫 요약에만 그 주소를 넣음

External code:
없음

PATENT_REVIEW:
주소 표시와 브라우저 열기. 청구항 대조는 별도. 특허 비침해를 보장하지 않음. 사람 검토가 필요함

---

Feature: Korean uninstall pages and launch on finish

Purpose:
제거 창을 한글로 보여주고, 설치 완료 창의 마침을 눌렀을 때 런처를 실행한다

Design source:
이 저장소의 NSIS 마침 페이지(MUI_FINISHPAGE_RUN). 파일 복사 직후 실행은 제거

Implementation:
제거 시작 시 언어를 한글로 고정. POSTINSTALL의 즉시 실행을 뺌

External code:
없음. 기존 Tauri 템플릿의 호출 시점만 조정

PATENT_REVIEW:
설치 완료 후 실행과 제거 창 언어. 청구항 대조는 별도. 특허 비침해를 보장하지 않음. 사람 검토가 필요함
