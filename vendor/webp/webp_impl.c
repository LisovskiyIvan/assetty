// assetty WebP decode bridge (libwebp v1.4.0, decoder-only vendored subset).
//
// The vendored tree keeps upstream layout (`src/dec`, `src/dsp`, `src/utils`,
// `src/webp`) so `#include "src/..."` lines work untouched with
// `-I vendor/webp`. See vendor/webp/README.md for the file list and the
// build.zig addition required to compile it.

#include <stddef.h>

#include "src/webp/decode.h"

// Header-only probe: 1 on success (w/h filled), 0 otherwise.
int basset_webp_info(const unsigned char *data, size_t len, int *w, int *h) {
    return WebPGetInfo(data, len, w, h);
}

// Full decode to RGBA8. Returns a WebP-malloc'd buffer (release with
// basset_webp_free) or NULL on failure. Animated WebP is rejected by the
// caller (VP8X flag sniff) before reaching here; the simple API below only
// handles still images (lossy VP8 / lossless VP8L / alpha).
unsigned char *basset_webp_decode_rgba(const unsigned char *data, size_t len,
                                       int *w, int *h) {
    return WebPDecodeRGBA(data, len, w, h);
}

void basset_webp_free(unsigned char *pixels) {
    WebPFree(pixels);
}
