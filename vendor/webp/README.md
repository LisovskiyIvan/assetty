# libwebp v1.4.0 — decoder-only vendored subset

Source: https://github.com/web-sharp/libwebp (tag v1.4.0),
tarball `libwebp-1.4.0.tar.gz` from
https://storage.googleapis.com/downloads.webmproject.org/releases/webp/.

Only the **decoder** is vendored (no encode, no demux, no mux). The file set
is exactly upstream's `libwebpdecoder` amalgam (`src/*/Makefile.am`
`libwebpdecode_la_SOURCES` + `libwebpdspdecode_la_SOURCES` +
`libwebputilsdecode_la_SOURCES`), i.e.:

- `src/dec/`: alpha_dec, buffer_dec, frame_dec, idec_dec, io_dec,
  quant_dec, tree_dec, vp8_dec, vp8l_dec, webp_dec (+ internal headers)
- `src/dsp/`: alpha_processing, cpu, dec, dec_clip_tables, filters,
  lossless, rescaler, upsampling, yuv (+ headers)
- `src/utils/`: bit_reader_utils, color_cache_utils, filters_utils,
  huffman_utils, palette, quant_levels_dec_utils, rescaler_utils,
  random_utils, thread_utils, utils (+ headers)
- `src/webp/`: decode.h, types.h, format_constants.h (public) +
  encode.h, mux_types.h (referenced by vendored sources)
- SIMD (runtime-dispatched, compile-guarded by libwebp's own `cpu.h`):
  x86: `*_sse2.c` (7) + `*_sse41.c` (5); aarch64: `*_neon.c` (7)

Upstream layout (`src/...`) is kept verbatim so `#include "src/..."`
lines work untouched; add `-I vendor/webp` (via
`core_mod.addIncludePath(b.path("vendor/webp"))`).

`webp_impl.c` is the assetty bridge: `basset_webp_info` (WebPGetInfo),
`basset_webp_decode_rgba` (WebPDecodeRGBA, still images only),
`basset_webp_free` (WebPFree). Animated WebP is rejected in Zig
(`decode.isAnimatedWebP`, VP8X flag sniff) — the simple decode API does
not handle animation and GLB images are stills.

Public API used: `WebPGetInfo`, `WebPDecodeRGBA`, `WebPFree`
(`src/webp/decode.h`). Pure C, no config header required (defaults apply;
`HAVE_CONFIG_H` stays undefined). No extra system libs (no libm use in the
decode set; threads use win32/pthreads per platform via libc, already
linked).
