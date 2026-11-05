// basset <-> basis_universal C wrapper (KTX2 encode/decode over RGBA8)
// Only plain C types here: this header is consumed via zig translate-c.
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct basset_basisu_params {
    int32_t mode;        // 0 = ETC1S, 1 = UASTC 4x4
    int32_t quality;     // ETC1S quality 1..255
    float rdo_lambda;    // UASTC RDO quality scalar; <= 0 disables RDO
    int32_t normal_map;  // renormalize normal maps, linear filtering
    int32_t generate_mips;
    int32_t max_size;    // reserved: caller pre-downscales; 0 = unset
    int32_t srgb;        // sRGB transfer function / perceptual metrics
    int32_t uastc_level; // 0..4 UASTC pack level
    int32_t supercompression; // 0 = none, 1 = zstd (UASTC KTX2 payload)
} basset_basisu_params;

// Idempotent, thread-safe. Returns 0 on success, -1 on failure.
int basset_basisu_init(void);

// Cap on the per-encode basisu job-pool thread count. Default 8 (the
// historical hardcoded cap). Clamped to >= 1. Global pool state: set once
// before spawning encode workers, not per-encode.
void basset_basisu_set_max_threads(int n);

// Encodes RGBA8 (w*h*4) to a KTX2 file buffer. On success returns 0 and sets
// *out_ktx2 (malloc'd, free with basset_basisu_free) / *out_len.
// On failure returns -1 and fills err_buf (NUL terminated when err_len > 0).
int basset_basisu_encode(const uint8_t* rgba, int32_t w, int32_t h,
                         const basset_basisu_params* params,
                         uint8_t** out_ktx2, size_t* out_len,
                         char* err_buf, int32_t err_len);

// Decodes level 0 of a KTX2 (or .basis) file to RGBA8.
// Returns 0 on success, -1 on failure.
int basset_basisu_decode_ktx2(const uint8_t* data, size_t len,
                              uint8_t** out_rgba, int32_t* out_w, int32_t* out_h,
                              char* err_buf, int32_t err_len);

void basset_basisu_free(void* ptr);

#ifdef __cplusplus
}
#endif
