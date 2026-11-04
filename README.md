# assetty

glTF/GLB asset toolkit: CLI + desktop app (nanoui + Babylon webview).

## Build

```sh
zig build --summary none            # zig-out/bin/assetty — CLI + app в одном бинаре
zig build test                      # core (77) + app (49) tests
zig build -Dtarget=aarch64-linux-gnu        # CLI + app, cross-compile
zig build -Dtarget=x86_64-windows-gnu       # CLI + app, cross-compile
zig build -Dapp=false               # CLI-only binary (no nanoui)
cd app/web && bun install && bun run build   # frontend → app/web/dist (GUI)
./zig-out/bin/assetty               # без аргументов — окно приложения
```

Portability: CLI + core build everywhere Zig + C++17 do (Linux/macOS/Windows,
glibc and musl). The desktop app shell (nanoui 0.11.0) is the same binary on
all three:

| OS | web UI | fallback |
|----|--------|----------|
| macOS | native (WKWebView) | — |
| Windows | native via WebView2 (needs the WebView2 runtime — preinstalled on Win10/11; without it a native notice window opens instead) | native window pointing at the CLI |
| Linux | not supported upstream (`PagesUnsupported`) | native window pointing at the CLI |

No macOS-only code remains in CLI/core; OpenCL (basisu) is macOS-only and
falls back to CPU elsewhere (runtime OpenCL was never enabled). Foreign
binaries are compile-verified on this Mac (can't execute them here); on Linux
the app needs GTK3/GTK4 at runtime (dlopen), on Windows `WebView2Loader.dll`
ships beside the exe when the WebView2 SDK is present at build time, otherwise
the system-installed WebView2 runtime is used.

## CLI

```sh
assetty info <file.glb> [--json]                 # статистика: трисы, draw calls, VRAM, мусор
assetty optimize f.glb --preset mobile -o out.glb [--report r.json] [--strip-animations]
assetty textures <file.glb> [--encode N] [--json] # список текстур; encode → KTX2 + PSNR
assetty presets                                  # список пресетов
```

Exit codes: `0` ok, `2` ошибка.

## App

Вкладки: Viewer (Babylon, анимации, scene explorer) / Optimize (2 вьюпорта до/после,
синхронизация камер, метрики Δ) / Textures (encode → KTX2, PSNR) /
Settings (редактор zon-пресетов). Bridge: JS → nanoui bind → core in-process;
прогресс — события `progress`/`log`.

## Layout

```
core/src/
  gltf/       model.zig, parse.zig (cgltf→model, mmap zero-copy), write.zig (GLB writer + GC)
  stats.zig   метрики + детект мусора (формат/мипы из KTX2 DFD)
  ops/        prune, dedup, weld, join, quantize (meshopt), simplify, geom.zig (builder)
  tex/        decode (stb), formats (KTX2/DFD), mips, encode_ktx (basisu)
  pipeline/   preset.zig (zon), runner.zig
app/          src/ (nanoui shell + bridge backend), web/ (vite + Babylon)
vendor/       cgltf, stb_image, meshoptimizer, basisu, zstd
presets/      mobile.zon, desktop.zon, web.zon
test/         fixtures (синтетика + 12 моделей glTF-Sample-Assets),
              fuzz_corpus.py + fuzz_run.sh (203 коррозивных GLB: 0 crash/hang),
              parse.zig: zig-регрессия на 14 классах битых входов
```

## Status

- [x] GLB parse (mmap, zero-copy BIN) + model + stats
- [x] GLB writer + round-trip (12/12 реальных моделей), GC-проход
- [x] ops: prune, dedup, weld, join, quantize, simplify
- [x] tex: decode, mips, KTX2 encode (ETC1S/UASTC) + PSNR
- [x] pipeline: zon-пресеты, runner, `optimize`
- [x] CLI
- [x] app: nanoui 0.11.0 + Babylon (Viewer/Optimize/Textures/Settings)
- [ ] EXT_meshopt_compression (пока quantize в core glTF: UNORM16/SNORM16)
- [ ] webview на Linux (nanoui 0.11.0: `PagesUnsupported` — там приложение
      открывает нативное окно; web-UI через WebKitGTK — будущая работа в
      nanoui, не в assetty; на Windows web-UI уже нативно через WebView2)


