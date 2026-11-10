const std = @import("std");

pub const Ktx2Header = struct {
    vk_format: u32,
    type_size: u32,
    width: u32,
    height: u32,
    depth: u32,
    layers: u32,
    faces: u32,
    mip_levels: u32,
    supercompression: u32,
};

pub const magic = [12]u8{ 0xAB, 'K', 'T', 'X', ' ', '2', '0', 0xBB, '\r', '\n', 0x1A, '\n' };

pub fn parseHeader(data: []const u8) ?Ktx2Header {
    if (data.len < 48) return null;
    if (!std.mem.eql(u8, data[0..12], &magic)) return null;
    return .{
        .vk_format = std.mem.readInt(u32, data[12..16], .little),
        .type_size = std.mem.readInt(u32, data[16..20], .little),
        .width = std.mem.readInt(u32, data[20..24], .little),
        .height = std.mem.readInt(u32, data[24..28], .little),
        .depth = std.mem.readInt(u32, data[28..32], .little),
        .layers = std.mem.readInt(u32, data[32..36], .little),
        .faces = std.mem.readInt(u32, data[36..40], .little),
        .mip_levels = std.mem.readInt(u32, data[40..44], .little),
        .supercompression = std.mem.readInt(u32, data[44..48], .little),
    };
}

/// KHR_DF color model byte from the DFD block (data: whole ktx2 file).
/// 163 = ETC1S, 166 = UASTC, 0 = unknown. Basis Universal writes vkFormat=0 —
/// the DFD carries the real format.
pub fn dfdColorModel(data: []const u8) u8 {
    if (data.len < 52) return 0;
    const dfd_off = std.mem.readInt(u32, data[48..52], .little);
    if (dfd_off == 0 or dfd_off + 20 > data.len) return 0;
    // DFD: [word0 = dfdTotalSize][word1 vendor|type][word2 ver|blockSize][word3: colorModel = byte 0]
    return data[dfd_off + 12];
}

pub const BasisModel = enum(u8) {
    etc1s = 163,
    uastc = 166,
    _,

    pub fn bppX100(self: BasisModel) u32 {
        return switch (self) {
            .etc1s => 50, // 64 bits per 4x4 block
            .uastc => 100, // 128 bits per 4x4 block
            _ => 400,
        };
    }

    pub fn label(self: BasisModel) []const u8 {
        return switch (self) {
            .etc1s => "ETC1S",
            .uastc => "UASTC",
            _ => "BasisU",
        };
    }

    pub fn from(v: u8) ?BasisModel {
        return switch (v) {
            163 => .etc1s,
            166 => .uastc,
            else => null,
        };
    }
};

/// bytes per pixel (x100 to stay integral). Only exact formats are listed:
/// block formats carry a fixed number of bits per block (BC 64/128, ETC/EAC
/// 64/128, ASTC always 128), uncompressed formats a fixed byte count.
/// Anything else returns 0 (unknown: no estimate rather than a bogus one).
pub fn vkBytesPerPixelX100(vk_format: u32) u32 {
    return switch (vk_format) {
        37, 38 => 400, // R8G8B8A8_UNORM / SRGB
        43, 44 => 300, // R8G8B8_UNORM / SRGB
        131, 132, 133, 134 => 400, // BC1 (64-bit block)
        135, 136, 137, 138 => 800, // BC2/BC3 (128-bit block)
        139, 140 => 400, // BC4 (64-bit block)
        141, 142 => 800, // BC5 (128-bit block)
        143, 144, 145, 146 => 800, // BC6H/BC7 (128-bit block)
        147, 148, 149, 150 => 400, // ETC2 RGB / punchthrough alpha (64-bit block)
        151, 152 => 800, // ETC2 RGBA8 (128-bit block)
        153, 154 => 400, // EAC R11 (64-bit block)
        155, 156 => 800, // EAC R11G11 (128-bit block)
        157, 158 => 800, // ASTC 4x4: 128 / 16
        159, 160 => 640, // ASTC 5x4: 128 / 20
        161, 162 => 512, // ASTC 5x5: 128 / 25
        163, 164 => 427, // ASTC 6x5: 128 / 30
        165, 166 => 356, // ASTC 6x6: 128 / 36
        167, 168 => 320, // ASTC 8x5: 128 / 40
        169, 170 => 267, // ASTC 8x6: 128 / 48
        171, 172 => 200, // ASTC 8x8: 128 / 64
        173, 174 => 256, // ASTC 10x5: 128 / 50
        175, 176 => 213, // ASTC 10x6: 128 / 60
        177, 178 => 160, // ASTC 10x8: 128 / 80
        179, 180 => 128, // ASTC 10x10: 128 / 100
        181, 182 => 107, // ASTC 12x10: 128 / 120
        183, 184 => 89, // ASTC 12x12: 128 / 144
        else => 0, // unknown → no estimate
    };
}

pub fn formatLabel(vk_format: u32) []const u8 {
    return switch (vk_format) {
        0 => "BasisU",
        131, 132 => "BC1_RGB",
        133, 134 => "BC1_RGBA",
        135 => "BC2",
        136 => "BC3",
        139, 140 => "BC4",
        141, 142 => "BC5",
        143 => "BC7",
        144 => "BC6H",
        145, 146, 147 => "ETC2",
        148, 149 => "ETC2_RGBA",
        157, 158, 159, 160, 161 => "ASTC",
        162...184 => "ASTC",
        37, 38 => "RGBA8",
        43, 44 => "RGB8",
        else => "VK?",
    };
}

/// Full mip-chain depth for a w×h image: floor(log2(max(w,h))) + 1.
/// Centralizes the 32-clz levels math every vram estimate uses.
pub fn mipLevels(w: u32, h: u32) u32 {
    const m = @max(w, h);
    if (m == 0) return 1;
    return @as(u32, 32 - @clz(m));
}

/// total bytes of the full mip chain for w×h at this format (1 face)
pub fn mipChainBytes(w: u32, h: u32, vk_format: u32, levels: u32) u64 {
    return mipChainBytesBpp(w, h, vkBytesPerPixelX100(vk_format), levels);
}

pub fn mipChainBytesBpp(w: u32, h: u32, bpp_x100: u32, levels: u32) u64 {
    if (bpp_x100 == 0) return 0; // unknown format: no estimate, not a bogus one
    const bpp: f64 = @as(f64, @floatFromInt(bpp_x100)) / 100.0;
    var total: f64 = 0;
    var cw: f64 = @floatFromInt(w);
    var ch: f64 = @floatFromInt(h);
    var i: u32 = 0;
    while (i < levels) : (i += 1) {
        total += @max(cw, 1) * @max(ch, 1) * bpp;
        cw /= 2;
        ch /= 2;
    }
    return @intFromFloat(@ceil(total));
}

test "ktx2 header" {
    var buf: [64]u8 = @splat(0);
    @memcpy(buf[0..12], &magic);
    std.mem.writeInt(u32, buf[12..16], 143, .little); // BC7
    std.mem.writeInt(u32, buf[16..20], 1, .little); // typeSize
    std.mem.writeInt(u32, buf[20..24], 64, .little); // width
    std.mem.writeInt(u32, buf[24..28], 64, .little); // height
    std.mem.writeInt(u32, buf[40..44], 7, .little); // levelCount
    const h = parseHeader(&buf).?;
    try std.testing.expectEqual(@as(u32, 7), h.mip_levels);
    try std.testing.expectEqual(@as(u32, 143), h.vk_format);
    try std.testing.expectEqual(@as(u32, 64), h.width);
    try std.testing.expectEqual(@as(u32, 800), vkBytesPerPixelX100(h.vk_format));
    // 64x64 BC7 with 7 mips at 8bpp: 8 * (4096 + 1024 + 256 + 64 + 16 + 4 + 1)
    const bytes = mipChainBytes(64, 64, 143, 7);
    try std.testing.expectEqual(@as(u64, 8 * (4096 + 1024 + 256 + 64 + 16 + 4 + 1)), bytes);
}
