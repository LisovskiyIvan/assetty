# assetty

glTF/GLB asset toolkit: info, diff, lint, optimize. Zig core + CLI (app UI — later).

## Build

```sh
zig build --summary none          # zig-out/bin/assetty
zig build test                    # core tests + golden
python3 test/gen_fixture.py       # синтетическая фикстура (если нет)
```

## CLI

```sh
assetty info <file.glb> [--json]                 # статистика: трисы, draw calls, VRAM, мусор
assetty diff a.glb b.glb [--json]                # что добавилось/удалилось/изменилось
assetty lint <dir|file> --budget budgets.json    # лимиты; exit 1 при нарушениях (CI)
assetty optimize f.glb --preset mobile -o out.glb [--report r.json]
assetty presets                                  # список пресетов
```

Exit codes: `0` ok, `1` lint-нарушения, `2` ошибка.

## Layout

```
core/src/
  gltf/       model.zig (структуры), parse.zig (cgltf→model), write.zig (GLB writer, GC-проход)
  stats.zig   метрики + детект мусора
  ops/        prune.zig, dedup.zig, weld.zig, join.zig (weld/join — next)
  tex/        decode.zig (header probe; KTX2/basisu — next)
  pipeline/   preset.zig (zon-пресеты), runner.zig
  diff.zig    сопоставление ассетов
  lint.zig    budgets
vendor/       cgltf, stb_image (одна C-зависимость на хедер)
presets/      mobile.zon, desktop.zon, web.zon
test/         fixtures (синтетика + 12 реальных моделей из glTF-Sample-Assets), budgets.json
```

## Status

- [x] GLB parse (mmap, zero-copy BIN) + model + stats → `info --json`
- [x] GLB writer + round-trip тесты (write∘parse∘write == write, 12/12 реальных моделей)
- [x] prune, diff, lint, пресеты (zon), runner + `optimize` (prune/dedup)
- [ ] weld, join (нужен buffer builder)
- [ ] tex: decode, mips, KTX2 encode (basisu), выбор формата (ASTC/BC7/ETC1S)
- [ ] meshopt: quantize (14bit pos, oct normals, 12bit uv) + simplify + EXT_meshopt_compression
- [ ] app: nanoui + Babylon webview (Viewer / Optimize / Textures / Diff)
