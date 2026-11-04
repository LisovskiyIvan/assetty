# assetty

glTF/GLB asset toolkit: CLI + desktop app (nanoui + Babylon webview).

## Build

```sh
zig build --summary none            # zig-out/bin/assetty — CLI + app в одном бинаре
zig build test                      # core + app tests
cd app/web && bun install && bun run build   # frontend → app/web/dist (GUI)
./zig-out/bin/assetty               # без аргументов — окно приложения (macOS WKWebView)
```

## CLI

```sh
assetty info <file.glb> [--json]                 # статистика: трисы, draw calls, VRAM, мусор
assetty optimize f.glb --preset mobile -o out.glb [--report r.json]
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
test/         fixtures (синтетика + 12 моделей glTF-Sample-Assets)
```

## Status

- [x] GLB parse (mmap, zero-copy BIN) + model + stats
- [x] GLB writer + round-trip (12/12 реальных моделей), GC-проход
- [x] ops: prune, dedup, weld, join, quantize, simplify
- [x] tex: decode, mips, KTX2 encode (ETC1S/UASTC) + PSNR
- [x] pipeline: zon-пресеты, runner, `optimize`
- [x] CLI
- [x] app: nanoui + Babylon (Viewer/Optimize/Textures/Settings)
- [ ] EXT_meshopt_compression (пока quantize в core glTF: UNORM16/SNORM16)
- [ ] webview за пределами macOS (nanoui page windows: только macOS)


