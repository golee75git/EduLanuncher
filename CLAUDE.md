# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EduLauncher (교육업무 런처) — a Windows tray launcher for Korean school-office staff, built with Tauri 2 (Rust backend) + React 19 + TypeScript (Vite frontend). It lives in the system tray and opens a small panel (first open or a stored 520×720 grows once to the monitor work-area height, capped at 900; width stays 520; later resizes persist per PC) via tray click or `Ctrl+Alt+E`. UI strings and commit-facing text in this repo are Korean.

## Commands

Requires Visual Studio 2022 Build Tools (C++) for the Rust/Tauri side on Windows.

```bat
tauri-env.cmd dev      REM run the app in dev mode (wraps `npm run tauri dev` with vcvars64.bat loaded)
tauri-env.cmd build    REM build the NSIS installer
```

`tauri-env.cmd` just loads the VS C++ build environment then forwards to `npm run tauri`; from an already-configured "Developer Command Prompt" you can use `npm run tauri dev` / `npm run tauri` directly.

Frontend-only (no Rust) commands:
- `npm run dev` — Vite dev server only (port 1420, no Tauri shell)
- `npm run build` — `tsc` (typecheck, `noEmit`) then `vite build` to `dist/`
- `npm run preview` — preview the built frontend

There is no lint script and no test script/framework. Git remote is `https://github.com/golee75git/EduLanuncher.git` (`main`). Continue work from `docs/HANDOFF.md`, `docs/PRD.md`, `docs/PLAN.md`.

### Rebuilding the installer after a change

Anything the *installed* exe needs to pick up — Rust/Tauri commands, tray behavior, file associations, or any change not visible via `tauri-env.cmd dev` — requires a fresh NSIS build, not just a dev-mode check:
1. Bump `version` in `src-tauri/tauri.conf.json` to today's date (`0.1.x-YYYYMMDD`) and update the window `title` to match (`교육업무 런처 0.1.x-YYYYMMDD`). The same version string is also duplicated in `src/config/app.ts` and `website/src/config.ts` (plus that file's `setupFile`/`setupFileDated`/`setupDownloadUrl`) — update all three together, and add an entry to `website/src/data/releases.ts`.
2. Run `.\tauri-env.cmd build` (see note below if the machine's VS Build Tools aren't under the `2022` path the script hardcodes).
3. Copy the resulting `EduLauncher_<version>_x64-setup.exe` to `EduLauncher_YYYY-MM-DD_HHmm_x64-setup.exe` in the same `src-tauri/target/release/bundle/nsis/` folder.
4. Report both paths and note that the previously installed build must be replaced; upload both files to a GitHub Release tagged with the version (`gh release create <version> <exe1> <exe2>`) since the intro site's download link points at GitHub Releases, not the repo.

`tauri-env.cmd` looks for VS Build Tools under `Visual Studio\2022\BuildTools`; on a machine where Build Tools installed under a different version folder (e.g. `Visual Studio\18\BuildTools`), run `vcvars64.bat` from that actual path directly before `npm run tauri build` instead of editing the script.

Pure frontend tweaks visible in `tauri-env.cmd dev` don't need this.

## Architecture

### Process split

- `src-tauri/src/lib.rs` — the Rust backend entry point: tray icon/menu, panel show/hide/position, global shortcut registration, `.edupack` file-association registry setup (Windows `HKCU\Software\Classes`), autostart, and the `#[tauri::command]`s the frontend calls via `invoke()`. Feature-specific Rust code lives in sibling modules rather than in `lib.rs` itself:
  - `netutil.rs` — IPv4/CCTV network scans
  - `shortcut.rs` — `.lnk` resolution, Windows SendTo link creation
  - `drop_target.rs` (Windows-only) — OLE `IDropTarget` for drag-and-drop that HTML5 drag can't reach (Explorer/IE-style drags with no `text/*` payload): reads `CF_HDROP`, Shell IDList arrays, virtual `.url` files, and `UniformResourceLocator(W)` in that order, and reports back an `Unreadable{formats}` payload (shown to the user) when none apply
  - `shell_icon.rs` (Windows-only) — extracts a file/shortcut's shell icon (`SHGetFileInfoW`/`ExtractIconExW`) as a small PNG data URL
  - `favicon_db.rs` (Windows-only) — a hand-written, read-only, minimal SQLite page/record reader (no `rusqlite`, no site fetches) that looks up a URL's already-cached favicon PNG out of Edge/Chrome's `Favicons` file (`icon_mapping`/`favicon_bitmaps` tables only); single (`favicon_for_url`) and batched (`favicon_for_urls`) lookups
  - `doc_shrink.rs` — downsizes PNG/JPEG images to a max dimension, writes a new file (never overwrites)
  - `privacy_mask.rs` — applies user-drawn redaction boxes to a local image, writes a new file
  - `pdf_pages.rs` — PDF merge/split/delete/reorder/rotate via `lopdf`, writes new files
  - `document_search/` (`mod.rs` + `extract.rs`) — background-thread, on-demand full-text indexer over user-chosen folders into a local `rusqlite` (bundled SQLite) database; extracts text from HWPX/XLSX/DOCX (via `zip` + `quick-xml`, since both are zipped XML) and PDF/TXT/MD/CSV; has its own start/stop/status gate (`Gate` + `OnceLock`) so a scan can be cancelled from the UI
  - `url_mark.rs` — builds a PNG "address mark" (QR code via `qrcode`) plus reads/writes small picture files for it
  - `user_folder.rs` — filename-only search under Desktop/Documents/Downloads
- Everything else is the React/TS frontend under `src/`. There's no server — all persistence is local (Tauri Store plugin JSON files, plus the document-search SQLite index and the doc-shrink/privacy-mask/PDF output files, all under the app's data dir or beside the user's originals).
- The window is a single hidden/shown panel (`tauri_plugin_single_instance` reuses the one instance; relaunching with a `.edupack`/`.json`/`.url` path on argv reveals the panel and emits `apply-notice-pack`/`apply-url-shortcut` instead of opening a second window). Closing the window hides it rather than quitting (`WindowEvent::CloseRequested` → `prevent_close` + `hide`).

### Frontend layers

- `src/stores/*` — Zustand stores (`toolStore`, `todoStore`, `memoStore`, `noticeStore`, `settingsStore`, `schoolStore`, `recentTopicStore`), one per domain. Each store exposes a `hydrate*()` function called once at startup (`App.tsx`'s bootstrap effect) that loads persisted state via `src/services/storageService.ts` (wraps `@tauri-apps/plugin-store`, one `Store` per JSON file: `tools.json`, `todos.json`, `settings.json`, `memo.json`, `notices.json`, `recent-topics.json`). Store actions mutate in-memory state with `set()` and persist immediately afterward — there's no separate save step. `settingsStore` also drives `document.documentElement.dataset.skin` for the light/dark/paper panel skins.
- `src/services/*` — no-React logic, grouped by feature. Core: `launcherService` (runs a `ToolItem`, calls `launch_tool`), `noticePackService`/`launcherPackService`/`sharePackService`/`backupService` (parse & validate untrusted pack JSON — see Pack system below), `applyNoticePack.ts` (dispatches a parsed pack to the right store/flow), `dropSiteService.ts` + `bookmarkHtmlService.ts` (drag-and-drop and browser-favorites-export parsing — the largest, most detail-sensitive services; see Drag-and-drop below), `searchService.ts` (in-memory fuzzy-ish scoring over tools/schools/topics, no external index), `networkService.ts`/`ipv4Math.ts` (IPv4/CCTV scan frontend, backed by `netutil.rs`). Newer feature services each pair with a Rust module of the same concern: `documentSearchService.ts` ↔ `document_search/`, `pdfToolService.ts` ↔ `pdf_pages.rs`, `docShrinkService.ts` ↔ `doc_shrink.rs`, `privacyMaskService.ts`/`privacyDropGate.ts` ↔ `privacy_mask.rs`, `pcUrlListService.ts` ↔ Edge/Chrome bookmark + `.url` listing. `manualService.ts`/`manualIndexService.ts`/`manualPackService.ts`/`handbookFlow.ts`/`knowledgeService.ts`/`jurisdictionService.ts` back the 업무자료/편람 reference content (see below).
- `src/pages/*` — top-level views. `App.tsx` holds a hand-rolled `View` union and switches between pages itself (no router).
- `src/components/*` — shared presentational UI (search bar, tool cards/grids, dialogs, drop zone, memo pad, etc). `src/components/home/*` is the current (2026-09) home-screen redesign (`AppHeader`, `GlobalSearch`, `LauncherGrid`, `SectionHeader`, `MemoPanel`, `StatusBar`); the pre-redesign card layout is still reachable as a settings-selectable "이전 홈"/카드형 skin, so don't delete the older home components without checking `SettingsPage.tsx`'s view option first.
- `src/data/*` — static seed data (`sampleTools.ts`, `sampleTodos.ts`, `sampleSchools.ts`, `categories.ts`/`toolGroups.ts`, `toolIcons.ts`, `computerTools.ts`, `shortcuts.ts`, `calendarSites.ts`) and `educationPack.ts` (the built-in default "education pack" of tools/sites merged in on first run via `seedIfEmpty()`). `src/data/manuals/`, `src/data/education/`, `src/data/knowledge/`, `src/data/troubleshooting/`, `topics.json`, and `handbookFlowPack.json` are the bundled 업무자료/편람 reference datasets (see below).

### The "Pack" system

Packs are the extensibility/distribution mechanism: JSON (or `.edupack`, same format, registered as a Windows file association) files a user can drop onto the app or double-click to import. Four kinds, disambiguated in `applyNoticePack.ts`'s `openParsedPack`:
- **Backup** (`{ kind: "edulauncher-backup" }`) — full local lists for another PC, parsed by `backupService`.
- **Share pack** (`{ kind: "edulauncher-share" }`) — notices + site shortcuts only (no tools/todos/memo/settings), parsed by `sharePackService`; the sender picks items to include, the receiver picks items to import (`mode: "notice-pick"`).
- **Notice pack** (`{ notices: [...] }`) — org/alert (화면에서는 기관/부서). `noticePackService.parseNoticePack` then the picked items go through `noticeStore.addFromPack`.
- **Launcher pack** (`{ tools: [...] }`) — shortcuts/sites, parsed by `launcherPackService.parseLauncherPack`, merged via `toolStore.applyLauncherPack` (add-or-update by id, tracks `added`/`updated` counts, tags imported tools with `origin: "pack"` and `packName`).

All parsers are defensive by design (untrusted input from disk/drag-drop): they silently drop malformed entries rather than throwing, cap string lengths, and only throw when *nothing* usable was found. Example fixtures live in `packs/*.example.json`; sample `.edupack` files sit at repo root.

### 업무자료 (Topics, manuals, handbook flow, work map)

Read-only reference content, separate from the tool/pack system. All of it is bundled JSON shipped with the app — none of it is scraped or fetched from an external site at runtime, which matters for the IP-provenance conventions below:
- `src/data/topics.json` (workflow-style task topics), `src/data/manuals/*.json` (e.g. `epki.json`, tree-shaped manuals), and `src/data/education/*mindmap.json` are bundled static data. `topicService.ts` validates/clips `topics.json` and merges in topics derived from manuals via `manualService.ts` (`getManualTopics`); `mindMapService.ts` + `workMapLayout.ts` turn nodes into the work-map layout. Parsers use the same defensive caps (`MAX_*`) as the pack parsers.
- 편람 (handbook) content is a newer, separate layer on top: `handbookFlowPack.json` + `handbookFlowData.ts`/`handbookFlow.ts` drive the flow-diagram detail pages (`HandbookFlowPages.tsx`, `HandbookFlowPicture.tsx`), and `manualIndexService.ts`/`manualPackService.ts` index handbook topics for the home search's 업무자료 section. `notebookTopicMerge.ts` merges these into the same topic list the older manuals use, so a single search/result path covers both. `jurisdictionService.ts` + `JurisdictionBadge.tsx` tag content as 강원 기준/전국 공통/타 교육청 참고/지역 확인 필요 rather than presenting any of it as universally authoritative.
- Pages: `TopicListPage`, `TopicDetailPage`, `TopicReviewPage`; recently opened topics persist via `recentTopicStore`. `App.tsx`'s `View` union carries `backTo` so leaving a topic restores the previous view (including the home search text).
- The "크게 보기" work map opens as a second Tauri window labelled `work-map` (`open_work_map_window` / `work_map_root_id` in `lib.rs`, wrapped by `windowService.ts`). `App.tsx` checks `currentWindowLabel() === "work-map"` and renders `WorkMapWindowPage` instead of the panel, so that window shares the same frontend bundle but must skip panel-only bootstrap.

### Drag-and-drop

`DropZone` + `dropSiteService.ts` accept several input shapes onto the panel: pack files (`.edupack`/`.json`), Windows internet shortcuts (`.url`/`.website`), raw browser drags (URL extracted from `text/html`/`text/uri-list`/`text/x-moz-url`/`text/plain`, in that preference order), and local files/folders/exes (resolved and classified Rust-side via `dropped_path_info`, including `.lnk` shortcut target resolution). A few other drop-target "gates" (`pdfDropGate.ts`, `docDropGate.ts`, `privacyDropGate.ts`) let a specific tool page temporarily claim matching dropped files (PDFs, doc-embeddable pictures, privacy-mask pictures) before the generic path handling runs. `addDroppedSite`/`addDroppedPaths` serialize concurrent drops through a promise queue so rapid multi-item drops don't race on the store.

Native browser/Explorer drags that carry no HTML5 `text/*` payload (e.g. dragging from the IE/Edge favorites bar or menu) don't reach the webview's `drop` event at all, so `drop_target.rs` installs a real Win32 `IDropTarget` on the window and reads the OLE data directly (see Process split above); results come back over the `launcher-drop`/`launcher-drop-hover` events. When a site is dropped or picked without an icon, `addDroppedSiteNow` in `dropSiteService.ts` falls back to `favicon_db.rs`'s already-cached-in-Edge/Chrome lookup rather than fetching the site.

### Repo conventions (also in `AGENTS.md` / `.cursor/rules/`)

- Minimal diffs; don't touch screens the request didn't mention. No cloning of other launchers' UI, logos, or favicons; no scraping or auto-login of school systems.
- Don't commit installer `.exe` files (the root-level `EduLauncher_*_x64-setup.exe` are untracked build copies).
- `website/` is a separate Cloudflare-hosted site (Root directory `website`); it has its own `package.json` and is not part of the Tauri build. It also runs a small Cloudflare Worker (`website/src/worker/opinion.ts`, bound as `main` in `wrangler.jsonc`) backing a no-login `/opinion` feedback board stored in a D1 database (binding `OPINION_DB`); public listings mask all but the first character of a submitted name, and a `/manage`-path (not linked from any menu) plus a `OPINION_HIDE_KEY` Worker secret let an admin unhide/moderate entries. Don't commit the secret's value.

### IP / provenance logging

`docs/IP_DESIGN_LOG.md` and `docs/RELEASE_IP_CHECKLIST.md` track, per feature, what external references were consulted and whether any code/design was copied — this project cares about clean-room provenance. When implementing a feature inspired by or referencing an external product/API/doc, add an entry to `IP_DESIGN_LOG.md` (purpose, design source, implementation approach, whether external code was copied, similar existing products, and how this differs, plus a `PATENT_REVIEW` line for anything structurally novel — this project explicitly does not claim non-infringement, only that it documented its own reasoning).

New Rust dependencies get the same treatment: when a feature needs a new crate (`qrcode`, `lopdf`, `rusqlite`, `zip`, `quick-xml` were each added this way), state the crate name/version/license/source and the reason *before* wiring it in, per `AGENTS.md`'s rule — this repo has stayed on this policy in practice (see `수정기록.txt` entries), so don't add a dependency silently. `favicon_db.rs` and `document_search/extract.rs`'s HWPX/DOCX/XLSX handling are deliberately hand-rolled minimal readers against public file-format documentation rather than pulling in a general-purpose library, specifically to keep the dependency footprint and provenance story simple — don't casually replace them with a heavier library without checking why they were written this way first.
