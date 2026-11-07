# assetty

A fast glTF/GLB optimization toolkit — one native binary that is both a desktop app and a CLI.

**Why:** game-ready models ship bloated — 2K PNG textures, float32 vertices, unused nodes, full animation sets. assetty takes a source model and produces a small, GPU-friendly GLB: KTX2-compressed textures, quantized geometry, pruned graph. The source file is never touched — every run reads the original and writes a new file, so you can iterate freely (512/1024, different quality, strip animations) and export only when you like the result. Everything runs locally through native encoders (basisu, meshoptimizer) on all your cores.

## Download

Grab a build from [GitHub Releases](../../releases):

| asset | platform | notes |
|---|---|---|
| `assetty-macos-arm64.dmg` | macOS 12+ (Apple Silicon) | drag `assetty.app` to Applications |
| `assetty-macos-arm64.zip` | macOS 12+ (Apple Silicon) | same app; also used by the updater |
| `assetty-windows-x64.zip` | Windows 10/11 x64 | WebView2 preinstalled on Win10/11 |
| `assetty-linux-x64.tar.gz` | Linux x64 | needs GTK 3/4 + WebKitGTK 2.40+ (`sudo apt install libwebkitgtk-6.0-4` or `libwebkit2gtk-4.1-0`) |
| `assetty-linux-arm64.tar.gz` | Linux ARM64 | same |

On macOS, open the DMG and drag `assetty.app` to Applications. Double-click the app for the GUI, use **Open With → assetty** on a `.glb`, or drop a model on the Dock icon. The app remains unsigned: Gatekeeper approval may still be required on the first launch.

The same binary is also the CLI. To install the `assetty` command for your user (no sudo):

```sh
sh /Applications/assetty.app/Contents/Resources/install-cli.sh
# Follow the printed PATH instruction if ~/.local/bin is not on your PATH.
assetty help
assetty info model.glb
```

Without command installation: `/Applications/assetty.app/Contents/MacOS/assetty help`. CLI commands preserve the caller's working directory and relative file paths; `help` writes to stdout.

On Windows, unpack and double-click `assetty.exe` for the GUI without a console. Keep the included `WebView2Loader.dll` beside it. Commands still work from a terminal; scripts that need reliable waiting/exit codes for this GUI-subsystem executable should use a process API such as PowerShell `Start-Process -Wait -PassThru`.

On Linux, unpack and run `sh install.sh` to install the desktop launcher, icon and CLI for your user, without sudo. The launcher opens the GUI without a terminal and accepts `.glb` files. Running `./assetty` directly remains supported.

**Updates:** Settings → check for updates; on a new release the app downloads it, verifies the checksum, swaps the binary and **restarts itself** (all platforms). Releases are published per tag, not per commit.

### Build from source

Requires [Zig 0.17.0](https://ziglang.org) and [bun](https://bun.sh) (frontend build runs automatically):

```sh
git clone <repo> && cd assetty
(cd app/web && bun install)                    # once
zig build                                      # zig-out/bin/assetty (CLI + app); builds frontend too
zig build test --summary all                   # test suite
zig build -Dapp=false                          # CLI-only binary
zig build -Dtarget=x86_64-windows-gnu          # cross-compile: also aarch64-linux-gnu, x86_64-linux-gnu
zig build -Dversion=0.2.0 -Drepo=owner/name    # bake release identity
zig build -Dstrip=false                        # keep debug info (default: stripped except -Doptimize=Debug)
```

| OS | app shell | runtime deps |
|---|---|---|
| macOS | WKWebView | — |
| Windows | WebView2 | preinstalled on Win10/11; without it a native notice opens |
| Linux | WebKitGTK 2.40+ (dlopen) | GTK 3/4 + WebKitGTK; without them a native notice opens |

CLI and core compile everywhere Zig does (glibc/musl); OpenCL (basisu) is macOS-only and falls back to CPU elsewhere.

## Desktop app

Run `assetty` with no arguments. Tabs:

- **Viewer** — Babylon.js scene with the inspector open alongside (scene tree left, properties right, model centered). Drag & drop a `.glb` anywhere to open it; `⌘O`/Open picks from your recent folders.
- **Optimize** — pick pipeline steps (prune / dedup / weld / join / simplify / quantize / textures), run, and compare. Every step has `?` help explaining what it does and what it affects. After a run: a **split slider** renders the source and the result in one viewport with frame-synced cameras — drag the divider to compare pixel-by-pixel. The report shows before/after stats, per-step timings and texture details. Results land in `.zig-cache/assetty-app/`; the banner offers **Save as…** (native save dialog) and **Discard** (deletes the result file). A pre-run guard warns when the source textures are already KTX2.
- **Textures** — lists every texture with facts (dims, format, VRAM, disk). **Preview KTX2** is a dry-run encode (before/after, PSNR, VRAM); each texture has its own settings — format (auto/ETC1S/UASTC), quality, resize, mips, normal-map, skip — shown in a side panel on click. **Apply to model** writes the whole textures step into a new file. Auto presets (mobile/desktop/web) live on the Optimize tab.
- **Settings** — theme (light/dark), language (EN/RU), per-step defaults, per-model texture overrides, JSON editor for the whole settings file (`assetty.settings.json`), update check.

Strip animations: one checkbox — drops all animation tracks, keeps the scene graph and skins (on a 28 MiB animated character: mobile preset 28 → 8.3 MiB, +strip → **3.7 MiB**, −87%).

Pipeline progress is animated: stage chips (load → geometry → textures → write → done) with a spinner, `texture 3/7` sub-progress and an elapsed clock.

**Cancel** (or `Esc` outside menus/text fields) requests a safe stop of Optimize, LOD, texture encoding or Apply. An encoder call already in flight finishes first; the UI shows **Cancelling…** and keeps conflicting actions disabled until the worker exits. Disabled actions explain the missing model, demo mode or active job. Subtle transitions respect the system's reduced-motion preference; keyboard focus is visible and the comparison divider supports arrow keys, Home and End.

## CLI

```sh
assetty help
assetty info <file.glb> [--json]
assetty textures <file.glb> [--encode N] [--json]
assetty optimize <file.glb> --preset <name|path.zon> [-o out.glb] [--report r.json] [--strip-animations]
assetty --version
```

- `info` — triangles, vertices, draw calls, VRAM estimate (mip-chain aware), disk split, per-image table.
- `textures` — per-image texture report; `--encode N` dry-run-encodes image N to KTX2 (writes before/after PNGs into `.zig-cache/assetty-app/`).
- `optimize` — runs the pipeline. `--strip-animations` drops all animation tracks on top of any preset. Exit codes: `0` ok, `2` error.

**Presets** are `.zon` files (`presets/mobile.zon`, `desktop.zon`, `web.zon` — or your own, passed by path):

```zig
.{
    .name = "mobile",
    .target = .mobile,
    .steps = .{
        .{ .prune = .{} },                                   // unused nodes/materials/textures (+ .animations = false to strip)
        .{ .dedup = .{} },                                   // accessors/meshes/materials
        .{ .weld = .{} },                                    // vertex welding
        .{ .simplify = .{ .target_ratio = 0.5 } },           // meshopt simplify, seam-aware + attr weights optional
        .{ .quantize = .{ .position_bits = 14, .uv_bits = 12, .normal_oct = true, .meshopt_compression = true } },
        .{ .textures = .{ .format = .etc1s, .quality = 128, .max_size = 1024, .generate_mips = true } },
    },
}
```

Per-texture overrides go in the textures step: `.overrides = .{ .{ .image = 0, .skip = true }, .{ .name = "normal", .format = .uastc, .max_size = 512 } }` — match by image index or name substring, applied in order, `skip` leaves a texture byte-identical.

Typical result (10-core Mac, ReleaseFast): DamagedHelmet mobile preset 6.7 → **4.5 s**; output is bit-deterministic across runs and thread counts.

## Pipeline reference

| step | what it does |
|---|---|
| `prune` | drops unreferenced nodes/materials/textures; `animations = false` strips all animation tracks (skeletons kept) |
| `dedup` | merges identical accessors/meshes/materials (content-hash + byte compare) |
| `weld` | welds duplicate vertices per primitive, tolerance-aware |
| `join` | merges compatible primitives to cut draw calls |
| `simplify` | meshoptimizer simplifier; ratio, error tolerance, aggressive, border lock, seam-aware attribute weights |
| `quantize` | positions/UVs to 16-bit, octahedral normals; dequant is baked into node transforms; `meshopt_compression = true` emits `EXT_meshopt_compression` buffer views (meshopt filters, another −6–15% on top) |
| `textures` | decode → (resize) → basisu encode to KTX2 (ETC1S/UASTC), mips, per-image overrides, skips already-KTX2 |

The writer garbage-collects everything unreferenced, so ops can leave orphans freely. Sources are immutable by design.

### `EXT_meshopt_compression` output (`quantize.meshopt_compression = true`)

gltfpack-`-cc`-style: every eligible vertex/index buffer view is meshopt-compressed after quantization — positions/UVs with the ATTRIBUTES codec (VEC3 payloads padded to an 8-byte stride), normals/tangents with the 12-bit OCTAHEDRAL filter (8-byte stride), triangle lists with the TRIANGLES codec (index order within a triangle may rotate; winding and triangle sets are preserved). Views that would not shrink, sparse/image/animation/skin/instancing views, and non-triangle index views that cannot use the sequence codec stay uncompressed; only compressed views carry the extension. `extensionsUsed` + `extensionsRequired` gain `EXT_meshopt_compression`, decompressed bytes live in spec fallback layout (placeholder buffer, `fallback: true`).

**The output requires an `EXT_meshopt_compression`-capable loader** (Babylon, three.js, filament with the meshopt decoder). Readers without the extension must refuse the file (`extensionsRequired`) — this is per-spec behavior, not a bug. `assetty info` still opens these files (counts only; it cannot decode the payloads without a linked decoder).

## Notes

- Malformed GLBs exit with clean errors (fuzzed corpus, 600+ runs, zero crashes — ReleaseFast keeps runtime checks off, parse layer validates instead).
- Installed macOS apps keep settings and user presets in `~/Library/Application Support/assetty/`, and temporary results in `~/Library/Caches/assetty/results/`. Existing settings/presets next to the app are copied on first launch without deleting the originals or replacing newer user data. Raw/development binaries keep `assetty.settings.json` and `.zig-cache/assetty-app/` in the working directory. Settings writes are atomic.
- Roadmap: batch/folder mode, `.gltf` (non-binary) output, signed macOS bundles for in-app updates.
