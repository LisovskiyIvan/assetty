# assetty-app web UI

Vite + vanilla TypeScript + Babylon.js frontend for the nanoui (Zig) desktop window.

```sh
bun install
bun run dev      # plain browser → demo mode (fake data, actions disabled)
bun run build    # → dist/ (index.html + hashed assets + vendored transcoders)
bun run preview  # serve the built dist/ for a browser smoke test
```

The Zig app serves the contents of `dist/`; `base: "./"` keeps every URL relative.

## Bridge contract

`src/bridge.ts` probes for the backend at boot:

1. `window.nanoui.invoke(method, ...args)` if present
2. `window.nanoui` with the methods directly
3. a bound backend object on the global scope (`window.backend`, `window.assetty`, …)
4. flat globals `window.<prefix>_<method>`

Methods called (JSON string in / out, promises or plain values):

| method | args | returns |
| --- | --- | --- |
| `openDialog()` | — | path string |
| `listDir(path)` | path | `{ entries: [{ name, path, is_dir, size }] }` |
| `info(path)` | path | same JSON as `assetty info --json` |
| `loadBytes(path)` | path | `{ b64, size }` or bare base64 |
| `optimize(path, preset)` | path, preset | `{ out_path, report: { steps, before, after, deltas } }` (CLI `output`/flat shape also accepted) |
| `textures(path)` | path | `{ images: [...] }` |
| `texturePreview(path, i)` | path, index | `{ started: true }` → `texturePreviewDone` |
| `textureEncode(path, i)` | path, index | `{ started: true }` → `textureEncodeDone` (legacy hosts may still return the encode result directly) |
| `presets()` | — | `["desktop", …]` |
| `presetLoad(name)` | name | zon text |
| `presetSave(name, zon)` | name, text | anything |

Events:

- `progress` `{ step, pct }`, `log` `{ line }`
- `optimizeDone` `{ ok, out_path, report }`
- `texturePreviewDone` `{ ok, index, b64, width, height }`
- `textureEncodeDone` `{ ok, index, ktx2_size, psnr, vram_after, before_png, after_png,
  width, height, mip_levels, format, settings: { format, quality, max_size, generate_mips } }`

Subscribed via `backend.on(event, cb)` / `addEventListener` / `subscribe`, falling
back to DOM events `nanoui:<event>` and `<event>`. `texturePreview` and
`textureEncode` are feature-detected: a host without them still lists images and
shows a toast instead of breaking the tab.

If nothing is found the UI runs in demo mode: banner, static fixtures, backend
actions disabled.

## KTX2

All decoder payloads are vendored (no network at runtime):

- `public/ktx2/` — Babylon 9 decoder + wasm transcoders (UASTC→ASTC/BC7/RGBA, ETC1S via MSC, zstd)
- `public/basis/` — classic `basis_transcoder.js/.wasm` (`.basis` files)

`src/ktx2.ts` points `KhronosTextureContainer2.URLConfig` at those files,
resolved against `document.baseURI`.
