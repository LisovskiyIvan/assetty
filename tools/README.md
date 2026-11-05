# Release packaging contract

Shared by `.github/workflows/release.yml` and the in-app updater
(`app/src/update.zig`, `assetFor`).

Every tag push `vX.Y.Z` publishes four archives plus `manifest.json`:

| runner | target | archive |
|---|---|---|
| macos-14 | aarch64-macos | `assetty-macos-arm64.zip` |
| windows-latest | x86_64-windows-gnu | `assetty-windows-x64.zip` |
| ubuntu-22.04 | x86_64-linux-gnu | `assetty-linux-x64.tar.gz` |
| ubuntu-22.04 | aarch64-linux-gnu | `assetty-linux-arm64.tar.gz` |

Each archive holds one folder `assetty-<ver>-<os>-<arch>/` with the binary
(`assetty` / `assetty.exe`, plus `NOTES.txt` on Windows/Linux about the
WebView2 / WebKitGTK runtime). The archive names must stay in sync with
`assetFor` — the updater downloads exactly these names. `manifest.json` is
`{"version":"X.Y.Z","files":{"<archive>":{"sha256":"…"}}}`.
