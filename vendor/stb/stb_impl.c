#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_STDIO
#include "stb_image.h"

int basset_image_info(const unsigned char *data, int len, int *w, int *h, int *comp) {
    return stbi_info_from_memory(data, len, w, h, comp);
}
