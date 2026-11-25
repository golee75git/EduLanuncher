# 창 앞에 고정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 열려 있는 창을 런처에서 골라 항상 위로 두고 해제한다.

**Architecture:** `window_pin.rs`가 창 목록, id 장부(`PinBook`), `SetWindowPos`를 맡는다. `lib.rs`는 패널의 항상 위 값을 맞추고 종료 때 해제한다. 화면은 컴퓨터도구의 새 페이지 하나다.

**Tech Stack:** Tauri 2, `windows` 0.61, React 19. 새 라이브러리 없음.

**Spec:** `docs/superpowers/specs/2026-11-25-window-pin-design.md`

## Global Constraints

- 새 crate 없음. `windows` 기능 `Win32_Graphics_Dwm`만 추가.
- 명령은 `main` 창에서만 받는다. 창 핸들·실행 파일 경로는 화면으로 넘기지 않는다. 창 제목은 저장·기록하지 않는다.
- 목록 최대 60개, 제목 120자.
- `PinBook` 잠금을 쥔 채 `SetWindowPos`/`set_always_on_top`을 부르지 않는다(런처 UI 스레드와 교착).
- 커밋·버전 올리기·설치 파일 빌드는 하지 않는다(사용자가 따로 정한다).
- 요청과 무관한 작업 트리 변경은 건드리지 않는다.

## Review Focus

- 고정한 창이 트레이로 숨거나 다른 가상 데스크톱에 있으면: 목록에서 빠져도 장부에는 남아 종료 때 해제 (Task 1 시험).
- 창이 닫힌 뒤 핸들이 다른 프로세스에 재사용되면: 같은 id로 바꾸지 않음 (Task 1 시험).
- 다른 곳에서 고정이 풀린 창: 우리 고정으로 세지 않음 (Task 1 시험).
- 고정한 창이 닫힌 뒤: 패널 항상 위가 원래 값으로 돌아옴 (Task 1 시험 + Task 2).
- 두 번째 창을 고정해도 패널이 그 아래로 가리지 않음 (Task 2, 직접 확인).

---

### Task 1: `window_pin.rs` 판별·장부·고정

**Files:**
- Create: `src-tauri/src/window_pin.rs`
- Modify: `src-tauri/Cargo.toml` (windows features), `src-tauri/src/lib.rs` (`mod window_pin;`)

**Interfaces:**
- Produces:
  - `struct WindowFace { visible, own, tool, app, owned, cloaked: bool, class: String, title: String }`, `fn listable(&WindowFace) -> bool`
  - `fn clip_title(&str) -> String`
  - `struct Seen { hwnd: isize, pid: u32, topmost: bool }`
  - `PinBook::new()`, `book.reconcile(listed: &[Seen], alive: impl Fn(isize, u32) -> Option<bool /*topmost*/>) -> Vec<(String /*id*/, PinState)>` (listed와 같은 순서)
  - `book.target(id) -> Option<(isize, u32)>`, `book.mark(id, ours: bool)`, `book.ours() -> Vec<(isize, u32)>`, `book.holding() -> bool`(살아 있고 항상 위인 우리 창이 있는지 실제 창으로 확인)
  - `enum PinState { Free, Ours, Other }` (serde: `"free" | "ours" | "other"`)
  - Windows: `set_topmost(hwnd: isize, on: bool, wait: bool) -> bool`(적용 확인), `raise(hwnd: isize)`, `release_all_on_exit(&PinBook)`

- [ ] **Step 1: 실패하는 시험 작성** — `listable_rules`, `title_is_clipped`, `ids_survive_and_pid_reuse_gets_new_id`, `hidden_pinned_window_stays_in_book`, `outside_release_drops_ownership`, `closed_pinned_window_stops_holding`, `real_window_pins_and_releases`(보이지 않는 `STATIC` 창을 만들어 `set_topmost` 켜고 끄며 `WS_EX_TOPMOST` 확인)
- [ ] **Step 2:** `cargo test window_pin` → 컴파일 실패(이름 없음) 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** `cargo test window_pin` → 모두 통과

### Task 2: 명령, 패널 항상 위, 종료 해제

**Files:**
- Modify: `src-tauri/src/window_pin.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces (invoke 이름):
  - `list_pin_windows() -> Vec<PinRow { id, title, app, iconImage?, state }>` (동기: 아이콘 추출)
  - `set_window_pin(id: String, pinned: bool) -> Result<(), String>` (async)
  - `release_window_pins() -> Result<(), String>` (async)
  - `lib.rs`: `pub(crate) fn hold_panel_above(app: &AppHandle)` — 항상 위 = 설정값 || `holding()`. 고정 중이면 패널을 `raise`.
- 오류 문구:
  - `창이 닫혔습니다.`
  - `응답이 없는 창은 바꾸지 않습니다.`
  - `이 창은 고정하지 못했습니다. 관리자 권한으로 실행한 창은 고정할 수 없습니다.`
  - `이 창은 해제하지 못했습니다. 관리자 권한으로 실행한 창은 바꿀 수 없습니다.`
  - `일부 창은 해제하지 못했습니다.`

- [ ] **Step 1:** 명령 구현, `invoke_handler`·`manage` 등록. 최소화 창은 `ShowWindowAsync(SW_RESTORE)` 후 고정.
- [ ] **Step 2:** `hold_panel_above`를 세 명령 끝, `reveal_panel`, `Focused(true)`에서 호출. `place_panel_above`는 `above || holding()`을 적용하고 저장값은 `above`.
- [ ] **Step 3:** `.run(context)`를 `.build(context)?.run(...)`으로 바꾸고 `RunEvent::Exit`에서 `release_all_on_exit`(기다리지 않는 방식).
- [ ] **Step 4:** `cargo test` 전체 통과, 새 경고 없음

### Task 3: 화면과 연결

**Files:**
- Create: `src/services/windowPinService.ts`, `src/pages/WindowPinPage.tsx`
- Modify: `src/data/computerTools.ts`, `src/pages/ComputerToolPage.tsx`, `src/App.tsx`, `docs/IP_DESIGN_LOG.md`

**Interfaces:**
- Consumes: Task 2의 세 명령
- Produces: `listPinWindows()`, `setWindowPin(id, pinned)`, `releaseWindowPins()`; `isWindowPinTool(entry)`, `isWindowPinTarget(target)`; view `{ name: "window-pin"; backTo?: View }`; `onShowWindowPin`

- [ ] **Step 1:** `computerTools.ts` 항목 `id/view: "window-pin"`, 이름 `창 앞에 고정`, 설명 `열린 강의 창·탐색기를 골라 맨 앞(항상 위)에 두는 창 고정 도구입니다.` (홈 검색은 이름·설명으로 찾으므로 `HomePage.tsx`는 바꾸지 않는다)
- [ ] **Step 2:** 페이지 구현. 들어올 때·`새로 고침`·`window`의 `focus`에서 읽기. 상태별 표시: `free`→`고정`, `ours`→`고정 중`+`해제`, `other`→`항상 위`+`해제`. 빈 목록 `고정할 창이 없습니다.`. `모두 해제`는 `ours`가 있을 때만 활성.
- [ ] **Step 3:** `ComputerToolPage`·`App.tsx`(`handleLaunch`, 컴퓨터도구, view 렌더) 연결, IP 기록 추가
- [ ] **Step 4:** `npm run build` 통과
