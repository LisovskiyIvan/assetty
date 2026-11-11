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

## Manifest signing

`manifest.json` is published together with `manifest.json.sig`: a detached
Ed25519 signature (hex) over the manifest's exact bytes. The app verifies
it against the public key compiled into the binary
(`core/src/update_key.zig`, `default_public_key_hex`) before it believes the
manifest — a checksum alone would only prove the archive matches the
manifest, not that either came from this project.

The release workflow signs the manifest right after `tools/manifest.py`
wrote it:

```sh
ASSETTY_UPDATE_SEED=<seed hex> zig build sign-manifest -- out/manifest.json
```

The seed comes from the repository secret `ASSETTY_UPDATE_SEED` and never
enters the repository. The workflow fails the release when the secret is
missing: an unsigned manifest is refused by every app build.

Key management (`zig build update-keygen` prints a new pair, the public hex
goes into `core/src/update_key.zig`, the seed becomes the secret) is
described in the top-level README.
