const std = @import("std");

pub const Info = struct { width: u32, height: u32, components: u32 };

extern fn basset_image_info(data: [*]const u8, len: c_int, w: *c_int, h: *c_int, comp: *c_int) c_int;

/// Header-only probe (no pixel decode): PNG/JPG/...
pub fn infoFromMemory(bytes: []const u8) ?Info {
    if (bytes.len == 0) return null;
    var w: c_int = 0;
    var h: c_int = 0;
    var comp: c_int = 0;
    if (basset_image_info(bytes.ptr, @intCast(bytes.len), &w, &h, &comp) == 0) return null;
    if (w <= 0 or h <= 0) return null;
    return .{
        .width = @intCast(w),
        .height = @intCast(h),
        .components = @intCast(@max(comp, 1)),
    };
}

pub const Decoded = struct {
    width: u32,
    height: u32,
    /// RGBA8, width*height*4 bytes; freed via deinit(gpa)
    pixels: []u8,

    pub fn deinit(self: *Decoded, gpa: std.mem.Allocator) void {
        gpa.free(self.pixels);
        self.pixels = &.{};
    }
};

extern fn basset_image_decode_rgba(data: [*]const u8, len: c_int, w: *c_int, h: *c_int) ?[*]u8;
extern fn basset_image_free(pixels: [*]u8) void;

/// Full decode to RGBA8. Copy: stb allocates its own buffer, we copy into
/// gpa-owned slice so caller never touches the C allocator.
pub fn decodeRgba(gpa: std.mem.Allocator, bytes: []const u8) ?Decoded {
    if (bytes.len == 0) return null;
    var w: c_int = 0;
    var h: c_int = 0;
    const raw = basset_image_decode_rgba(bytes.ptr, @intCast(bytes.len), &w, &h) orelse return null;
    if (w <= 0 or h <= 0) {
        basset_image_free(raw);
        return null;
    }
    const n: usize = @as(usize, @intCast(w)) * @as(usize, @intCast(h)) * 4;
    const pixels = gpa.alloc(u8, n) catch {
        basset_image_free(raw);
        return null;
    };
    @memcpy(pixels, raw[0..n]);
    basset_image_free(raw);
    return .{ .width = @intCast(w), .height = @intCast(h), .pixels = pixels };
}

test "infoFromMemory invalid" {
    try std.testing.expect(infoFromMemory("nope") == null);
}

test "decodeRgba 1x1" {
    const gpa = std.testing.allocator;
    // 1x1 RGB PNG (red), real bytes from test fixture
    const png = [_]u8{
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x03, 0x01, 0x01, 0x00, 0xC9, 0xFE, 0x92, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
        0x44, 0xAE, 0x42, 0x60, 0x82,
    };
    var dec = decodeRgba(gpa, &png) orelse return error.TestUnexpectedResult;
    defer dec.deinit(gpa);
    try std.testing.expectEqual(@as(u32, 1), dec.width);
    try std.testing.expectEqual(@as(u32, 4), dec.pixels.len);
}
