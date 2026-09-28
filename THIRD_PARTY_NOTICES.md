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
Purpose: Encode a URL into a module matrix for the QR코드 넣기 screen. `default-features = false` (no image/svg renderers).
Modified: No
GPL/AGPL: No
Patent: This notice does not grant or warrant freedom from third-party patents.

Transitive crates and full license texts are not copied here. See each package registry page and `LICENSES/README.md`.

## Trademarks

QR Code is a registered trademark of DENSO WAVE INCORPORATED.
This project does not claim ownership of that mark. The feature UI label is 「QR코드 넣기」 and screens state the trademark owner. Using the words QR Code / QR코드 does not mean this product is affiliated with or endorsed by DENSO WAVE INCORPORATED.

Crate: lopdf 0.45.0
License: MIT
Source: https://crates.io/crates/lopdf
Repository: https://github.com/J-F-Liu/lopdf
Purpose: Read and write PDF page objects for PDF 도구. `default-features = false` (no chrono, rayon, image, or font embedding).
Modified: No
GPL/AGPL: No
Font files: the published crate excludes `/assets`. Montserrat is not in the package used here and is not embedded.
Patent: This notice does not grant or warrant freedom from third-party patents.

Direct dependencies of lopdf used by this build are MIT, Apache-2.0, BSD-3-Clause, or a combination of those. No GPL or AGPL crate was added. Password and signature removal APIs in lopdf are not called.

Crate: rusqlite 0.40.2
License: MIT
Source: https://crates.io/crates/rusqlite
Purpose: Local SQLite FTS5 index for 내 문서 검색. `default-features = false`, feature `bundled` only.
Modified: No
GPL/AGPL: No
Bundled SQLite 3.53.2 (libsqlite3-sys) is in the public domain. The amalgamation header disclaims copyright. See https://www.sqlite.org/copyright.html

Crate: zip 8.6.0
License: MIT
Source: https://crates.io/crates/zip
Purpose: Read HWPX, DOCX, and XLSX zip entries. `default-features = false`, feature `deflate` only.
Modified: No
GPL/AGPL: No
Transitive for this build: flate2 1.1.10 (MIT OR Apache-2.0), zlib-rs 0.6.8 (zlib-style permission), zopfli 0.8.3 (Apache-2.0). No GPL or AGPL.

Crate: quick-xml 0.42.0
License: MIT
Source: https://crates.io/crates/quick-xml
Purpose: Read text nodes from Office XML. No extra features.
Modified: No
GPL/AGPL: No

## Fonts

Bundled font files: none.
UI stack: Segoe UI Variable, Segoe UI, Malgun Gothic (Windows system fonts, not SIL OFL, not shipped in this repo).
