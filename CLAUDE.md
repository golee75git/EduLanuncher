# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EduLauncher (교육업무 런처) — a Windows tray launcher for Korean school-office staff, built with Tauri 2 (Rust backend) + React 19 + TypeScript (Vite frontend). It lives in the system tray and opens a small 440×650 panel via tray click or `Ctrl+Alt+E`. UI strings and commit-facing text in this repo are Korean.

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
1. Bump `version` in `src-tauri/tauri.conf.json` to today's date (`0.1.x-YYYYMMDD`) and update the window `title` to match (`교육업무 런처 0.1.x-YYYYMMDD`).
2. Run `.\tauri-env.cmd build`.
3. Copy the resulting `EduLauncher_<version>_x64-setup.exe` to `EduLauncher_YYYY-MM-DD_x64-setup.exe` in the same `src-tauri/target/release/bundle/nsis/` folder.
4. Report both paths and note that the previously installed build must be replaced.

Pure frontend tweaks visible in `tauri-env.cmd dev` don't need this.

## Architecture

### Process split

- `src-tauri/src/lib.rs` — the entire Rust backend: tray icon/menu, panel show/hide/position, global shortcut registration, `.edupack` file-association registry setup (Windows `HKCU\Software\Classes`), autostart, and a handful of `#[tauri::command]`s the frontend calls via `invoke()` (file read/write for packs, dropped-path classification, `.url` shortcut parsing, IPv4/CCTV network scans via `netutil.rs`, shortcut `.lnk` resolution via `shortcut.rs`, drag-and-drop hookup via `drop_target.rs`).
- Everything else is the React/TS frontend under `src/`. There's no server — all persistence is local (Tauri Store plugin, i.e. JSON files under the app's data dir).
- The window is a single hidden/shown panel (`tauri_plugin_single_instance` reuses the one instance; relaunching with a `.edupack`/`.json` path on argv reveals the panel and emits `apply-notice-pack` instead of opening a second window). Closing the window hides it rather than quitting (`WindowEvent::CloseRequested` → `prevent_close` + `hide`).

### Frontend layers

- `src/stores/*` — Zustand stores (`toolStore`, `todoStore`, `memoStore`, `noticeStore`, `settingsStore`), one per domain. Each store exposes a `hydrate*()` function called once at startup (`App.tsx`'s bootstrap effect) that loads persisted state via `src/services/storageService.ts` (wraps `@tauri-apps/plugin-store`, one `Store` per JSON file: `tools.json`, `todos.json`, `settings.json`, `memo.json`, `notices.json`). Store actions mutate in-memory state with `set()` and persist immediately afterward — there's no separate save step.
- `src/services/*` — no-React logic: `launcherService` (runs a `ToolItem`, calls the `launch_tool` Tauri command), `noticePackService`/`launcherPackService` (parse & validate untrusted pack JSON into typed data), `applyNoticePack.ts` (dispatches a parsed pack to the right store based on whether it has a `notices` or `tools` array), `dropSiteService.ts` (drag-and-drop URL/file/shortcut parsing — this is the largest and most detail-sensitive service; see below), `searchService.ts` (in-memory fuzzy-ish scoring over tools/schools, no external index), `networkService.ts`/`ipv4Math.ts` (frontend half of the IPv4/CCTV scan tools, backed by `netutil.rs`).
- `src/pages/*` — top-level views. `App.tsx` holds a hand-rolled `View` union and switches between pages itself (no router).
- `src/components/*` — presentational/shared UI (search bar, tool cards/grids, dialogs, drop zone, memo pad, etc).
- `src/data/*` — static seed data (`sampleTools.ts`, `sampleTodos.ts`, `sampleSchools.ts`, `categories.ts`, `toolIcons.ts`) and `educationPack.ts` (the built-in default "education pack" of tools/sites merged in on first run via `seedIfEmpty()`).

### The "Pack" system

Packs are the extensibility/distribution mechanism: JSON (or `.edupack`, same format, registered as a Windows file association) files a user can drop onto the app or double-click to import. Three kinds, disambiguated in `applyNoticePack.ts`:
- **Backup** (`{ kind: "edulauncher-backup" }`) — full local lists for another PC, parsed by `backupService`.
- **Notice pack** (`{ notices: [...] }`) — org/alert (화면에서는 기관/부서). `noticePackService.parseNoticePack` 후 고른 항목만 `noticeStore.addFromPack`
- **Launcher pack** (`{ tools: [...] }`) — shortcuts/sites, parsed by `launcherPackService.parseLauncherPack`, merged via `toolStore.applyLauncherPack` (add-or-update by id, tracks `added`/`updated` counts, tags imported tools with `origin: "pack"` and `packName`).

Both parsers are defensive by design (untrusted input from disk/drag-drop): they silently drop malformed entries rather than throwing, cap string lengths, and only throw when *nothing* usable was found. Example fixtures live in `packs/*.example.json`; sample `.edupack` files sit at repo root.

### 업무자료 (Topics, manuals, work map)

Read-only reference content, separate from the tool/pack system:
- `src/data/topics.json` (workflow-style task topics), `src/data/manuals/*.json` (e.g. `epki.json`, tree-shaped manuals), and `src/data/education/*mindmap.json` are bundled static data. `topicService.ts` validates/clips `topics.json` and merges in topics derived from manuals via `manualService.ts` (`getManualTopics`); `mindMapService.ts` + `workMapLayout.ts` turn nodes into the work-map layout. Both parsers use the same defensive caps (`MAX_*`) as the pack parsers.
- Pages: `TopicListPage`, `TopicDetailPage`, `TopicReviewPage`; recently opened topics persist via `recentTopicStore`. `App.tsx`'s `View` union carries `backTo` so leaving a topic restores the previous view (including the home search text).
- The "크게 보기" work map opens as a second Tauri window labelled `work-map` (`open_work_map_window` / `work_map_root_id` in `lib.rs`, wrapped by `windowService.ts`). `App.tsx` checks `currentWindowLabel() === "work-map"` and renders `WorkMapWindowPage` instead of the panel, so that window shares the same frontend bundle but must skip panel-only bootstrap.

### Drag-and-drop

`DropZone` + `dropSiteService.ts` accept four input shapes onto the panel: pack files (`.edupack`/`.json`), Windows internet shortcuts (`.url`/`.website`), raw browser drags (URL extracted from `text/html`/`text/uri-list`/`text/x-moz-url`/`text/plain`, in that preference order), and local files/folders/exes (resolved and classified Rust-side via `dropped_path_info`, including `.lnk` shortcut target resolution). `addDroppedSite`/`addDroppedPaths` serialize concurrent drops through a promise queue so rapid multi-item drops don't race on the store.

### Repo conventions (also in `AGENTS.md` / `.cursor/rules/`)

- Minimal diffs; don't touch screens the request didn't mention. No cloning of other launchers' UI, logos, or favicons; no scraping or auto-login of school systems.
- Don't commit installer `.exe` files (the root-level `EduLauncher_*_x64-setup.exe` are untracked build copies).
- `website/` is a separate Cloudflare-hosted site (Root directory `website`); it has its own `package.json` and is not part of the Tauri build.

### IP / provenance logging

`docs/IP_DESIGN_LOG.md` and `docs/RELEASE_IP_CHECKLIST.md` track, per feature, what external references were consulted and whether any code/design was copied — this project cares about clean-room provenance. When implementing a feature inspired by or referencing an external product/API/doc, add an entry to `IP_DESIGN_LOG.md` (purpose, design source, implementation approach, whether external code was copied, similar existing products, and how this differs).
