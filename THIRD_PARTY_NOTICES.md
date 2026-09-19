# Third-party notices

Direct dependencies. Modified: No unless noted.

## npm

Package: @tauri-apps/api
License: Apache-2.0 OR MIT
Purpose: Tauri frontend API
Modified: No

Package: @tauri-apps/plugin-autostart
License: MIT OR Apache-2.0
Purpose: Start with OS login
Modified: No

Package: @tauri-apps/plugin-dialog
License: MIT OR Apache-2.0
Purpose: Native file/folder picker
Modified: No

Package: @tauri-apps/plugin-global-shortcut
License: MIT OR Apache-2.0
Purpose: Global shortcut (Rust side; JS package present)
Modified: No

Package: @tauri-apps/plugin-opener
License: MIT OR Apache-2.0
Purpose: Open URL / path
Modified: No

Package: @tauri-apps/plugin-store
License: MIT OR Apache-2.0
Purpose: Local JSON persistence
Modified: No

Package: lucide-react
License: ISC
Purpose: UI icons
Modified: No

Package: react / react-dom
License: MIT
Purpose: UI
Modified: No

Package: zustand
License: MIT
Purpose: Client state
Modified: No

## npm (dev)

Package: @tauri-apps/cli
License: Apache-2.0 OR MIT
Purpose: Build / dev CLI
Modified: No

Package: tailwindcss / @tailwindcss/vite
License: MIT
Purpose: CSS
Modified: No

Package: vite / @vitejs/plugin-react
License: MIT
Purpose: Frontend bundler
Modified: No

Package: typescript
License: Apache-2.0
Purpose: Typecheck
Modified: No

## Rust (direct)

Crate: tauri / tauri-build
License: Apache-2.0 OR MIT
Purpose: Desktop shell
Modified: No

Crate: tauri-plugin-opener, tauri-plugin-dialog, tauri-plugin-store, tauri-plugin-autostart, tauri-plugin-global-shortcut
License: MIT OR Apache-2.0
Purpose: Desktop plugins
Modified: No

Crate: serde / serde_json
License: MIT OR Apache-2.0
Purpose: Serialization
Modified: No

Crate: qrcode 0.14.1
License: MIT OR Apache-2.0
Source: https://crates.io/crates/qrcode
Repository: https://github.com/kennytm/qrcode-rust
Purpose: Encode a URL into a module matrix for the 주소 무늬 screen. `default-features = false` (no image/svg renderers).
Modified: No
GPL/AGPL: No
Patent: This notice does not grant or warrant freedom from third-party patents.

Transitive crates and full license texts are not copied here. See each package registry page and `LICENSES/README.md`.

## Trademarks

QR Code is a registered trademark of DENSO WAVE INCORPORATED.
This project does not claim ownership of that mark. UI copy prefers 주소 무늬.

## Fonts

Bundled font files: none.
UI stack: Segoe UI Variable, Segoe UI, Malgun Gothic (Windows system fonts, not SIL OFL, not shipped in this repo).
