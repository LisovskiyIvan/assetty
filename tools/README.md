# Release packaging contract

Shared by `.github/workflows/release.yml` and the in-app updater
(`app/src/update.zig`, `assetFor`).

Every tag push `vX.Y.Z` publishes four update archives, a macOS DMG installer and `manifest.json`:

| runner | target | archive |
|---|---|---|
| macos-14 | aarch64-macos | `assetty-macos-arm64.zip` |
| windows-latest | x86_64-windows-gnu | `assetty-windows-x64.zip` |
| ubuntu-22.04 | x86_64-linux-gnu | `assetty-linux-x64.tar.gz` |
| ubuntu-22.04 | aarch64-linux-gnu | `assetty-linux-arm64.tar.gz` |

Each archive holds one folder `assetty-<ver>-<os>-<arch>/`. macOS contains
`assetty.app` (including its icon, document-type registration and optional
user CLI installer). The additional DMG includes an Applications shortcut;
the updater continues downloading ZIP. Windows includes `assetty.exe`,
`WebView2Loader.dll` and its license (`tools/fetch-webview2.ps1` stages both).
Linux includes `assetty`, its icon and the user desktop/CLI installer.
Every platform includes `NOTES.txt`. Icon resources are reproducible with
`python3 tools/make-icons.py`. The archive names must stay in sync with
`assetFor` — the updater downloads exactly these names. `manifest.json` is
`{"version":"X.Y.Z","files":{"<archive>":{"sha256":"…"}}}`.
