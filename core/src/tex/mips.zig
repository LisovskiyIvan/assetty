//! RGBA8 box-filter downscaling. Pure zig, no dependencies.

const std = @import("std");

pub const Scaled = struct {
    pixels: []u8,
    w: u32,
    h: u32,
};

pub const Error = error{
    InvalidImage,
} || std.mem.Allocator.Error;

/// `w * h * 4` without overflow: null when the byte count does not fit a
/// `usize` (a hostile width/height must not wrap into a small allocation).
pub fn checkedRgbaBytes(w: u32, h: u32) ?usize {
    const px = std.math.mul(usize, @as(usize, w), @as(usize, h)) catch return null;
    return std.math.mul(usize, px, 4) catch null;
}

/// Box-filter downscale by an integer `factor` (>= 1). Edge pixels average the
/// clipped source region, so arbitrary dimensions are supported.
pub fn downscaleRgba(a: std.mem.Allocator, src: []const u8, w: u32, h: u32, factor: u32) Error!Scaled {
    if (w == 0 or h == 0 or factor == 0) return error.InvalidImage;
    // Checked multiply: a hostile image size must not wrap the byte count.
    const need = checkedRgbaBytes(w, h) orelse return error.InvalidImage;
    if (src.len < need) return error.InvalidImage;
    if (factor == 1) {
        const pixels = try a.dupe(u8, src[0..need]);
        return .{ .pixels = pixels, .w = w, .h = h };
    }

    const dw: u32 = @max(1, (w + factor - 1) / factor);
    const dh: u32 = @max(1, (h + factor - 1) / factor);
    const out_bytes = checkedRgbaBytes(dw, dh) orelse return error.InvalidImage;
    const pixels = try a.alloc(u8, out_bytes);
    errdefer a.free(pixels);

    var dy: u32 = 0;
    while (dy < dh) : (dy += 1) {
        const y0 = dy * factor;
        const y1 = @min(y0 + factor, h);
        var dx: u32 = 0;
        while (dx < dw) : (dx += 1) {
            const x0 = dx * factor;
            const x1 = @min(x0 + factor, w);
            const n: u32 = (x1 - x0) * (y1 - y0);
            var acc: [4]u32 = .{ 0, 0, 0, 0 };
            var sy = y0;
            while (sy < y1) : (sy += 1) {
                var sx = x0;
                while (sx < x1) : (sx += 1) {
                    const o = (@as(usize, sy) * w + sx) * 4;
                    acc[0] += src[o];
                    acc[1] += src[o + 1];
                    acc[2] += src[o + 2];
                    acc[3] += src[o + 3];
                }
            }
            const o = (@as(usize, dy) * dw + dx) * 4;
            pixels[o] = @intCast((acc[0] + n / 2) / n);
            pixels[o + 1] = @intCast((acc[1] + n / 2) / n);
            pixels[o + 2] = @intCast((acc[2] + n / 2) / n);
            pixels[o + 3] = @intCast((acc[3] + n / 2) / n);
        }
    }
    return .{ .pixels = pixels, .w = dw, .h = dh };
}

/// Single 2x2 box reduction. Equivalent to `downscaleRgba(..., 2)`.
pub fn halve(a: std.mem.Allocator, src: []const u8, w: u32, h: u32) Error!Scaled {
    return downscaleRgba(a, src, w, h, 2);
}

/// Downscale once by the exact ceil factor so max(w,h) <= max_dim.
/// Returns a copy when already small.
pub fn fitMaxSize(a: std.mem.Allocator, src: []const u8, w: u32, h: u32, max_dim: u32) Error!Scaled {
    if (max_dim == 0 or (w <= max_dim and h <= max_dim)) return downscaleRgba(a, src, w, h, 1);
    const m: u32 = @max(w, h);
    const factor = (m + max_dim - 1) / max_dim; // ceil; >= 2 since m > max_dim
    return downscaleRgba(a, src, w, h, factor);
}

test "downscale 4x4 gradient factor 2" {
    const a = std.testing.allocator;
    var src: [4 * 4 * 4]u8 = undefined;
    for (&src, 0..) |*p, i| p.* = @intCast(i % 256);
    // make alpha opaque and channels independent of stride for clarity
    var y: u32 = 0;
    while (y < 4) : (y += 1) {
        var x: u32 = 0;
        while (x < 4) : (x += 1) {
            const o = (@as(usize, y) * 4 + x) * 4;
            src[o] = @intCast(x * 60); // R: 0,60,120,180
            src[o + 1] = @intCast(y * 60); // G: 0,60,120,180
            src[o + 2] = 10;
            src[o + 3] = 255;
        }
    }
    const out = try halve(a, &src, 4, 4);
    defer a.free(out.pixels);
    try std.testing.expectEqual(@as(u32, 2), out.w);
    try std.testing.expectEqual(@as(u32, 2), out.h);

    // top-left 2x2: R avg(0,60)=30, G avg(0,60)=30
    try std.testing.expectEqual(@as(u8, 30), out.pixels[0]);
    try std.testing.expectEqual(@as(u8, 30), out.pixels[1]);
    try std.testing.expectEqual(@as(u8, 10), out.pixels[2]);
    try std.testing.expectEqual(@as(u8, 255), out.pixels[3]);
    // top-right 2x2: R avg(120,180)=150, G 30
    try std.testing.expectEqual(@as(u8, 150), out.pixels[4]);
    // bottom-left: R 30, G avg(120,180)=150
    try std.testing.expectEqual(@as(u8, 30), out.pixels[8]);
    try std.testing.expectEqual(@as(u8, 150), out.pixels[9]);
}

test "downscale odd dimensions" {
    const a = std.testing.allocator;
    // 3x3 RGBA
    var src: [36]u8 = @splat(0);
    @memset(src[0..], 200);
    const out = try downscaleRgba(a, &src, 3, 3, 2);
    defer a.free(out.pixels);
    try std.testing.expectEqual(@as(u32, 2), out.w);
    try std.testing.expectEqual(@as(u32, 2), out.h);
    for (out.pixels) |p| try std.testing.expectEqual(@as(u8, 200), p);
}

test "fitMaxSize" {
    const a = std.testing.allocator;
    var src: [16 * 8 * 4]u8 = @splat(128);
    const out = try fitMaxSize(a, &src, 16, 8, 4);
    defer a.free(out.pixels);
    try std.testing.expectEqual(@as(u32, 4), out.w);
    try std.testing.expectEqual(@as(u32, 2), out.h);
}
