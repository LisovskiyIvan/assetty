const std = @import("std");

pub const Info = struct { width: u32, height: u32, components: u32 };

extern fn basset_image_info(data: [*]const u8, len: c_int, w: *c_int, h: *c_int, comp: *c_int) c_int;

extern fn basset_webp_info(data: [*]const u8, len: usize, w: *c_int, h: *c_int) c_int;

/// RIFF....WEBP container sniff (lossy VP8, lossless VP8L, alpha, animated).
pub fn isWebP(bytes: []const u8) bool {
    return bytes.len >= 12 and std.mem.eql(u8, bytes[0..4], "RIFF") and
        std.mem.eql(u8, bytes[8..12], "WEBP");
}

/// VP8X feature-flags byte: bit 1 = animation. The simple decode API handles
/// still images only, so animated WebP is detected here and rejected.
pub fn isAnimatedWebP(bytes: []const u8) bool {
    if (!isWebP(bytes)) return false;
    if (bytes.len >= 21 and std.mem.eql(u8, bytes[12..16], "VP8X")) return bytes[20] & 0x02 != 0;
    return false;
}

/// Header-only probe (no pixel decode): PNG/JPG/... + WebP (libwebp).
pub fn infoFromMemory(bytes: []const u8) ?Info {
    if (bytes.len == 0) return null;
    if (isWebP(bytes)) {
        if (isAnimatedWebP(bytes)) return null;
        var w: c_int = 0;
        var h: c_int = 0;
        if (basset_webp_info(bytes.ptr, bytes.len, &w, &h) == 0) return null;
        if (w <= 0 or h <= 0) return null;
        return .{ .width = @intCast(w), .height = @intCast(h), .components = 4 };
    }
    return stbInfo(bytes);
}

fn stbInfo(bytes: []const u8) ?Info {
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

extern fn basset_webp_decode_rgba(data: [*]const u8, len: usize, w: *c_int, h: *c_int) ?[*]u8;
extern fn basset_webp_free(pixels: [*]u8) void;

/// Full decode to RGBA8. Copy: stb/libwebp allocate their own buffers, we
/// copy into gpa-owned slices so the caller never touches the C allocator.
pub fn decodeRgba(gpa: std.mem.Allocator, bytes: []const u8) ?Decoded {
    if (bytes.len == 0) return null;
    if (isWebP(bytes)) {
        if (isAnimatedWebP(bytes)) return null;
        var w: c_int = 0;
        var h: c_int = 0;
        const raw = basset_webp_decode_rgba(bytes.ptr, bytes.len, &w, &h) orelse return null;
        if (w <= 0 or h <= 0) {
            basset_webp_free(raw);
            return null;
        }
        const n: usize = @as(usize, @intCast(w)) * @as(usize, @intCast(h)) * 4;
        const pixels = gpa.alloc(u8, n) catch {
            basset_webp_free(raw);
            return null;
        };
        @memcpy(pixels, raw[0..n]);
        basset_webp_free(raw);
        return .{ .width = @intCast(w), .height = @intCast(h), .pixels = pixels };
    }
    return stbDecode(gpa, bytes);
}

fn stbDecode(gpa: std.mem.Allocator, bytes: []const u8) ?Decoded {
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

// ---- PNG encode -----------------------------------------------------------

pub const EncodeError = error{InvalidImage} || std.mem.Allocator.Error;

extern fn basset_png_encode(
    rgba: [*]const u8,
    w: c_int,
    h: c_int,
    comp: c_int,
    out: *?[*]u8,
    out_len: *usize,
) c_int;
extern fn basset_png_free(p: [*]u8) void;

/// Encode `w*h` RGBA8 pixels to a PNG memory buffer owned by `gpa`.
/// The stb buffer is freed here, so the caller only ever sees a Zig slice.
pub fn encodePngRgba(gpa: std.mem.Allocator, rgba: []const u8, w: u32, h: u32) EncodeError![]u8 {
    if (w == 0 or h == 0) return error.InvalidImage;
    const need = @as(usize, w) * h * 4;
    if (rgba.len < need) return error.InvalidImage;

    var c_out: ?[*]u8 = null;
    var c_len: usize = 0;
    if (basset_png_encode(
        rgba.ptr,
        @intCast(w),
        @intCast(h),
        4,
        &c_out,
        &c_len,
    ) == 0) return error.InvalidImage;
    const raw = c_out orelse return error.InvalidImage;
    defer basset_png_free(raw);

    const png = try gpa.alloc(u8, c_len);
    @memcpy(png, raw[0..c_len]);
    return png;
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

test "encodePngRgba 2x2 round-trips through decodeRgba" {
    const gpa = std.testing.allocator;
    const src = [_]u8{
        255, 0, 0, 255, // red
        0, 255, 0, 128, // green, half alpha
        0, 0, 255, 255, // blue
        17, 34, 51, 255, // dark grey
    };

    const png = try encodePngRgba(gpa, &src, 2, 2);
    defer gpa.free(png);

    // PNG signature.
    try std.testing.expect(png.len > 8);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A }, png[0..8]);

    // Header probe agrees.
    const info = infoFromMemory(png) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u32, 2), info.width);
    try std.testing.expectEqual(@as(u32, 2), info.height);

    // Lossless: the pixels come back byte for byte.
    var dec = decodeRgba(gpa, png) orelse return error.TestUnexpectedResult;
    defer dec.deinit(gpa);
    try std.testing.expectEqual(@as(u32, 2), dec.width);
    try std.testing.expectEqual(@as(u32, 2), dec.height);
    try std.testing.expectEqualSlices(u8, &src, dec.pixels);
}

test "encodePngRgba rejects a short buffer and empty dimensions" {
    const gpa = std.testing.allocator;
    try std.testing.expectError(error.InvalidImage, encodePngRgba(gpa, &.{ 1, 2, 3 }, 2, 2));
    try std.testing.expectError(error.InvalidImage, encodePngRgba(gpa, &.{}, 0, 0));
}

test "webp sniff" {
    // RIFF....WEBP container; VP8X flags byte bit 1 = animation.
    const still = "RIFF\x00\x00\x00\x00WEBP" ++ "VP8 0123456789";
    const anim = "RIFF\x00\x00\x00\x00WEBP" ++ "VP8X\x0A\x00\x00\x00\x02\x00\x00\x00\x00\x00";
    const noanim = "RIFF\x00\x00\x00\x00WEBP" ++ "VP8X\x0A\x00\x00\x00\x10\x00\x00\x00\x00\x00";
    try std.testing.expect(isWebP(still));
    try std.testing.expect(isWebP(anim));
    try std.testing.expect(!isWebP("RIFF\x00\x00"));
    try std.testing.expect(!isWebP("not webp bytes...."));
    try std.testing.expect(!isAnimatedWebP(still));
    try std.testing.expect(isAnimatedWebP(anim));
    try std.testing.expect(!isAnimatedWebP(noanim));
}

fn webpFixture(gpa: std.mem.Allocator, name: []const u8) ![]u8 {
    var buf: [128]u8 = undefined;
    const path = try std.fmt.bufPrint(&buf, "test/fixtures/webp/{s}", .{name});
    return try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, gpa, .limited(1 << 20));
}

test "webp info + decode lossy/lossless/alpha" {
    const gpa = std.testing.allocator;
    for ([_][]const u8{ "lossy_8x8.webp", "lossless_8x8.webp", "alpha_8x8.webp" }) |name| {
        const bytes = try webpFixture(gpa, name);
        defer gpa.free(bytes);
        try std.testing.expect(isWebP(bytes));
        try std.testing.expect(!isAnimatedWebP(bytes));
        const info = infoFromMemory(bytes) orelse {
            std.debug.print("webp info failed: {s}\n", .{name});
            return error.TestUnexpectedResult;
        };
        try std.testing.expectEqual(@as(u32, 8), info.width);
        try std.testing.expectEqual(@as(u32, 8), info.height);
        var dec = decodeRgba(gpa, bytes) orelse return error.TestUnexpectedResult;
        defer dec.deinit(gpa);
        try std.testing.expectEqual(@as(u32, 8), dec.width);
        try std.testing.expectEqual(@as(u32, 8), dec.height);
        try std.testing.expectEqual(@as(usize, 8 * 8 * 4), dec.pixels.len);
    }
}

test "webp lossless decodes bit-exact" {
    const gpa = std.testing.allocator;
    const bytes = try webpFixture(gpa, "lossless_8x8.webp");
    defer gpa.free(bytes);
    var dec = decodeRgba(gpa, bytes) orelse return error.TestUnexpectedResult;
    defer dec.deinit(gpa);
    // Fixture gradient: R=x*32, G=y*32, B=128, A=255.
    var want: [8 * 8 * 4]u8 = undefined;
    for (0..8) |y| for (0..8) |x| {
        const o = (y * 8 + x) * 4;
        want[o] = @intCast(x * 32);
        want[o + 1] = @intCast(y * 32);
        want[o + 2] = 128;
        want[o + 3] = 255;
    };
    try std.testing.expectEqualSlices(u8, &want, dec.pixels);
}

test "webp alpha decodes with transparency" {
    const gpa = std.testing.allocator;
    const bytes = try webpFixture(gpa, "alpha_8x8.webp");
    defer gpa.free(bytes);
    var dec = decodeRgba(gpa, bytes) orelse return error.TestUnexpectedResult;
    defer dec.deinit(gpa);
    // Opaque red-ish first pixel, fully transparent second.
    try std.testing.expectEqualSlices(u8, &[_]u8{ 200, 50, 30, 255 }, dec.pixels[0..4]);
    try std.testing.expectEqual(@as(u8, 0), dec.pixels[7]);
}

test "webp animated is rejected" {
    const gpa = std.testing.allocator;
    const bytes = try webpFixture(gpa, "anim_4x4.webp");
    defer gpa.free(bytes);
    try std.testing.expect(isWebP(bytes));
    try std.testing.expect(isAnimatedWebP(bytes));
    try std.testing.expect(infoFromMemory(bytes) == null);
    try std.testing.expect(decodeRgba(gpa, bytes) == null);
}
