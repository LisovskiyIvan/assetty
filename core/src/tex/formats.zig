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

pub const magic = [8]u8{ 0xAB, 'K', 'T', 'X', ' ', '2', '0', 0xBB };

pub fn parseHeader(data: []const u8) ?Ktx2Header {
    if (data.len < 44) return null;
    if (!std.mem.eql(u8, data[0..8], &magic)) return null;
    return .{
        .vk_format = std.mem.readInt(u32, data[8..12], .little),
        .type_size = std.mem.readInt(u32, data[12..16], .little),
        .width = std.mem.readInt(u32, data[16..20], .little),
        .height = std.mem.readInt(u32, data[20..24], .little),
        .depth = std.mem.readInt(u32, data[24..28], .little),
        .layers = std.mem.readInt(u32, data[28..32], .little),
        .faces = std.mem.readInt(u32, data[32..36], .little),
        .mip_levels = std.mem.readInt(u32, data[36..40], .little),
        .supercompression = std.mem.readInt(u32, data[40..44], .little),
    };
}

/// bytes per pixel (x100 to stay integral): transcodable formats are approximations
pub fn vkBytesPerPixelX100(vk_format: u32) u32 {
    return switch (vk_format) {
        131, 132, 133, 134 => 50, // BC1_RGB / BC1_RGBA (64bit per 4x4)
        135, 136, 137, 138 => 100, // BC2, BC3
        139, 140 => 50, // BC4
        141, 142 => 100, // BC5
        143, 144 => 100, // BC7, BC6H
        145, 146, 147 => 50, // ETC2 RGB / punchthrough
        148, 149 => 100, // ETC2 RGBA
        150, 151, 152, 153, 154 => 50, // EAC R/RG
        157, 158 => 100, // ASTC 4x4
        159 => 100, // ASTC 5x4
        160, 161 => 45, // ASTC 6x6 (~16/36)
        162...178 => 100, // other ASTC blocks (rough)
        37, 38 => 400, // R8G8B8A8 / sRGB
        43, 44 => 300, // R8G8B8
        56...64 => 100, // single/dual channel 8bit families (rough)
        else => 400, // unknown → assume RGBA8
    };
}

pub fn formatLabel(vk_format: u32) []const u8 {
    return switch (vk_format) {
        131, 132 => "BC1_RGB",
        133, 134 => "BC1_RGBA",
        135 => "BC2", 136 => "BC3",
        139, 140 => "BC4", 141, 142 => "BC5",
        143 => "BC7", 144 => "BC6H",
        145, 146, 147 => "ETC2",
        148, 149 => "ETC2_RGBA",
        157, 158, 159, 160, 161 => "ASTC",
        162...178 => "ASTC",
        37, 38 => "RGBA8",
        43, 44 => "RGB8",
        else => "VK?",
    };
}

/// total bytes of the full mip chain for w×h at this format (1 face)
pub fn mipChainBytes(w: u32, h: u32, vk_format: u32, levels: u32) u64 {
    const bpp: f64 = @as(f64, @floatFromInt(vkBytesPerPixelX100(vk_format))) / 100.0;
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
    @memcpy(buf[0..8], &magic);
    std.mem.writeInt(u32, buf[8..12], 143, .little); // BC7
    std.mem.writeInt(u32, buf[16..20], 64, .little);
    std.mem.writeInt(u32, buf[20..24], 64, .little);
    std.mem.writeInt(u32, buf[36..40], 7, .little);
    const h = parseHeader(&buf).?;
    try std.testing.expectEqual(@as(u32, 7), h.mip_levels);
    try std.testing.expectEqual(@as(u32, 100), vkBytesPerPixelX100(h.vk_format));
    // 64x64 BC7 with 7 mips: 4096 + 1024 + 256 + 64 + 16 + 4 + 1... bytes
    const bytes = mipChainBytes(64, 64, 143, 7);
    try std.testing.expectEqual(@as(u64, 4096 + 1024 + 256 + 64 + 16 + 4 + 1), bytes);
}
