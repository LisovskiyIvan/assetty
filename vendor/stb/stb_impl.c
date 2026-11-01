#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_STDIO
#include "stb_image.h"

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
