#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_STDIO
#include "stb_image.h"

// PNG *encoding* only: the file-writing entry points stay out (STBI_WRITE_NO_STDIO),
// we hand stb a growable memory sink below instead.
#define STBI_WRITE_NO_STDIO
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

int basset_image_info(const unsigned char *data, int len, int *w, int *h, int *comp) {
    return stbi_info_from_memory(data, len, w, h, comp);
}

/// decode to RGBA8 (4 bytes/pixel), returns NULL on failure
unsigned char *basset_image_decode_rgba(const unsigned char *data, int len, int *w, int *h) {
    return stbi_load_from_memory(data, len, w, h, NULL, 4);
}

void basset_image_free(unsigned char *pixels) {
    stbi_image_free(pixels);
}

// ---- PNG encode -----------------------------------------------------------

/// Growable output buffer for stbi_write_png_to_func.
typedef struct {
    unsigned char *buf;
    size_t len, cap;
    int oom;
} basset_png_buf;

static void basset_png_append(void *ctx, void *data, int n) {
    basset_png_buf *b = (basset_png_buf *)ctx;
    if (b->oom || n <= 0) return;
    size_t need = b->len + (size_t)n;
    if (need < b->len) { // overflow
        b->oom = 1;
        return;
    }
    if (need > b->cap) {
        size_t cap = b->cap ? b->cap : 8192;
        while (cap < need) {
            if (cap > ((size_t)-1) / 2) {
                cap = need;
                break;
            }
            cap *= 2;
        }
        unsigned char *grown = (unsigned char *)realloc(b->buf, cap);
        if (!grown) {
            b->oom = 1;
            return;
        }
        b->buf = grown;
        b->cap = cap;
    }
    memcpy(b->buf + b->len, data, (size_t)n);
    b->len = need;
}

/// Encode `comp`-channel 8-bit pixels (3 = RGB, 4 = RGBA) to PNG in memory.
/// Returns 1 on success and hands a malloc'd buffer to the caller, which must
/// release it with `basset_png_free`. 0 on failure (nothing to free).
int basset_png_encode(const unsigned char *rgba, int w, int h, int comp,
                      unsigned char **out, size_t *out_len) {
    if (!rgba || !out || !out_len || w <= 0 || h <= 0 || (comp != 3 && comp != 4)) return 0;
    basset_png_buf sink = {0};
    // stride 0: stb derives it from w * comp.
    int ok = stbi_write_png_to_func(basset_png_append, &sink, w, h, comp, rgba, 0);
    if (!ok || sink.oom || !sink.buf || sink.len == 0) {
        free(sink.buf);
        return 0;
    }
    *out = sink.buf;
    *out_len = sink.len;
    return 1;
}

void basset_png_free(unsigned char *p) {
    free(p);
}
