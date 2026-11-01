// basset <-> basis_universal C wrapper implementation.
#include "basisu_wrapper.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <new>
#include <thread>
#include <vector>

#include "encoder/basisu_comp.h"
#include "transcoder/basisu_transcoder.h"

namespace {

std::once_flag g_init_flag;
bool g_init_ok = false;

void set_err(char* err_buf, int err_len, const char* msg) {
    if (!err_buf || err_len <= 0) return;
    std::snprintf(err_buf, static_cast<size_t>(err_len), "%s", msg ? msg : "unknown error");
}

void do_init() {
    g_init_ok = basisu::basisu_encoder_init(/*use_opencl=*/false, /*opencl_force_serialization=*/false);
    basist::basisu_transcoder_init();
}

}  // namespace

extern "C" int basset_basisu_init(void) {
    std::call_once(g_init_flag, do_init);
    return g_init_ok ? 0 : -1;
}

extern "C" void basset_basisu_free(void* ptr) {
    std::free(ptr);
}

extern "C" int basset_basisu_encode(const uint8_t* rgba, int32_t w, int32_t h,
                                    const basset_basisu_params* params,
                                    uint8_t** out_ktx2, size_t* out_len,
                                    char* err_buf, int32_t err_len) {
    if (!out_ktx2 || !out_len) {
        set_err(err_buf, err_len, "null output pointer");
        return -1;
    }
    *out_ktx2 = nullptr;
    *out_len = 0;

    if (!rgba || w <= 0 || h <= 0) {
        set_err(err_buf, err_len, "invalid image dimensions/buffer");
        return -1;
    }
    if (basset_basisu_init() != 0) {
        set_err(err_buf, err_len, "basisu encoder init failed");
        return -1;
    }

    const bool uastc = params && params->mode == 1;
    const bool normal_map = params && params->normal_map != 0;
    const bool srgb = !params || params->srgb != 0;
    const bool gen_mips = !params || params->generate_mips != 0;
    int quality = params ? params->quality : 128;
    if (quality < 1) quality = 1;
    if (quality > 255) quality = 255;
    int uastc_level = params ? params->uastc_level : 2;
    if (uastc_level < 0) uastc_level = 0;
    if (uastc_level > 4) uastc_level = 4;
    const float rdo_lambda = params ? params->rdo_lambda : 1.0f;

    basisu::basis_compressor_params cp;
    cp.m_uastc = uastc;
    cp.m_hdr = false;
    cp.m_use_opencl = false;
    cp.m_read_source_images = false;
    cp.m_write_output_basis_or_ktx2_files = false;
    cp.m_status_output = false;
    cp.m_debug = false;
    cp.m_compute_stats = false;
    cp.m_print_stats = false;
    cp.m_multithreading = true;
    cp.m_perceptual = srgb;
    cp.m_check_for_alpha = true;
    cp.m_force_alpha = false;

    cp.m_mip_gen = gen_mips;
    cp.m_mip_srgb = srgb && !normal_map;
    cp.m_mip_premultiplied = false;
    cp.m_mip_renormalize = normal_map;
    cp.m_mip_wrapping = true;
    cp.m_mip_fast = true;
    cp.m_mip_smallest_dimension = 1;

    cp.m_renormalize = normal_map;

    cp.m_etc1s_quality_level = quality;
    cp.m_pack_uastc_ldr_4x4_flags = static_cast<uint32_t>(uastc_level);
    cp.m_rdo_uastc_ldr_4x4 = rdo_lambda > 0.0f;
    cp.m_rdo_uastc_ldr_4x4_quality_scalar = rdo_lambda > 0.0f ? rdo_lambda : 1.0f;

    cp.m_create_ktx2_file = true;
    cp.m_ktx2_srgb_transfer_func = srgb && !normal_map;
    cp.m_ktx2_uastc_supercompression = basist::KTX2_SS_NONE;

    basisu::image src(static_cast<uint32_t>(w), static_cast<uint32_t>(h));
    std::memcpy(src.get_ptr(), rgba, static_cast<size_t>(w) * static_cast<size_t>(h) * 4);
    cp.m_source_images.push_back(src);

    uint32_t hw = std::thread::hardware_concurrency();
    if (hw == 0) hw = 1;
    if (hw > 8) hw = 8;
    basisu::job_pool jpool(hw);
    cp.m_pJob_pool = &jpool;

    basisu::basis_compressor compressor;
    if (!compressor.init(cp)) {
        set_err(err_buf, err_len, "basis_compressor::init failed");
        return -1;
    }
    const basisu::basis_compressor::error_code ec = compressor.process();
    if (ec != basisu::basis_compressor::cECSuccess) {
        char msg[96];
        std::snprintf(msg, sizeof(msg), "basis_compressor::process failed (code %d)", static_cast<int>(ec));
        set_err(err_buf, err_len, msg);
        return -1;
    }

    const basisu::uint8_vec& out = compressor.get_output_ktx2_file();
    if (out.empty()) {
        set_err(err_buf, err_len, "empty KTX2 output");
        return -1;
    }
    uint8_t* buf = static_cast<uint8_t*>(std::malloc(out.size()));
    if (!buf) {
        set_err(err_buf, err_len, "out of memory");
        return -1;
    }
    std::memcpy(buf, out.data(), out.size());
    *out_ktx2 = buf;
    *out_len = out.size();
    return 0;
}

extern "C" int basset_basisu_decode_ktx2(const uint8_t* data, size_t len,
                                         uint8_t** out_rgba, int32_t* out_w, int32_t* out_h,
                                         char* err_buf, int32_t err_len) {
    if (!out_rgba || !out_w || !out_h) {
        set_err(err_buf, err_len, "null output pointer");
        return -1;
    }
    *out_rgba = nullptr;
    *out_w = 0;
    *out_h = 0;
    if (!data || len == 0) {
        set_err(err_buf, err_len, "empty input");
        return -1;
    }
    if (len > 0xFFFFFFFFu) {
        set_err(err_buf, err_len, "input too large");
        return -1;
    }
    if (basset_basisu_init() != 0) {
        set_err(err_buf, err_len, "basisu transcoder init failed");
        return -1;
    }

    basist::ktx2_transcoder dec;
    if (!dec.init(data, static_cast<uint32_t>(len))) {
        set_err(err_buf, err_len, "ktx2_transcoder::init failed");
        return -1;
    }
    if (!dec.start_transcoding()) {
        set_err(err_buf, err_len, "ktx2_transcoder::start_transcoding failed");
        return -1;
    }

    basist::ktx2_image_level_info info;
    if (!dec.get_image_level_info(info, 0, 0, 0)) {
        set_err(err_buf, err_len, "ktx2 get_image_level_info failed");
        return -1;
    }
    const uint32_t dw = info.m_orig_width;
    const uint32_t dh = info.m_orig_height;
    if (dw == 0 || dh == 0 || dw > 65536 || dh > 65536) {
        set_err(err_buf, err_len, "invalid decoded dimensions");
        return -1;
    }

    const size_t total = static_cast<size_t>(dw) * static_cast<size_t>(dh) * 4;
    uint8_t* buf = static_cast<uint8_t*>(std::malloc(total));
    if (!buf) {
        set_err(err_buf, err_len, "out of memory");
        return -1;
    }
    std::memset(buf, 0, total);

    const bool ok = dec.transcode_image_level(
        0, 0, 0, buf, dw * dh, basist::transcoder_texture_format::cTFRGBA32,
        /*decode_flags=*/0, /*output_row_pitch=*/dw, /*output_rows=*/dh);
    if (!ok) {
        std::free(buf);
        set_err(err_buf, err_len, "ktx2 transcode_image_level failed");
        return -1;
    }

    *out_rgba = buf;
    *out_w = static_cast<int32_t>(dw);
    *out_h = static_cast<int32_t>(dh);
    return 0;
}
