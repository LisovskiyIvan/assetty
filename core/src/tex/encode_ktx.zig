//! basis_universal KTX2 encode/decode over RGBA8.
//!
//! The C++ side (vendor/basisu/basisu_wrapper.cpp) frees its own allocations;
//! every buffer crossing into zig is copied into the caller's allocator.

const std = @import("std");
const c = @import("basisu_c");
const formats = @import("formats.zig");
const mips = @import("mips.zig");

pub const Error = error{
    InvalidImage,
    BasisuEncode,
    BasisuDecode,
    InvalidKtx2,
} || std.mem.Allocator.Error;

pub const Mode = enum { etc1s, uastc };

/// KTX2 payload supercompression. Only meaningful for UASTC (the basisu
/// encoder ignores it for ETC1S); `zstd` writes supercompressionScheme=2.
pub const Supercompression = enum { none, zstd };

pub const Options = struct {
    mode: Mode = .etc1s,
    quality: u8 = 128,
    rdo_lambda: f32 = 1.0,
    normal_map: bool = false,
    generate_mips: bool = true,
    max_size: u32 = 0,
    srgb: bool = true,
    uastc_level: u3 = 2,
    supercompression: Supercompression = .none,
};

pub const Output = struct {
    /// KTX2 bytes, owned by the allocator passed to `encode`
    ktx2: []u8,
    width: u32,
    height: u32,
    mip_levels: u32,
    /// e.g. "ETC2" / "BC7" / "RGBA8" from the KTX2 vkFormat
    format_label: []const u8,
};

pub const Decoded = struct {
    pixels: []u8,
    width: u32,
    height: u32,
};

fn errSlice(buf: *[256]u8) []const u8 {
    const len = std.mem.indexOfScalar(u8, buf, 0) orelse buf.len;
    return buf[0..len];
}

/// Idempotent basisu warm-up (encoder + transcoder init is expensive).
pub fn init() bool {
    return c.basset_basisu_init() == 0;
}

/// Cap on the per-encode basisu job-pool thread count (default 8 when never
/// called). Global pool state: call once before spawning encode workers,
/// not per-encode.
pub fn setMaxThreads(n: u32) void {
    c.basset_basisu_set_max_threads(@intCast(n));
}

pub fn encode(a: std.mem.Allocator, rgba: []const u8, w: u32, h: u32, opts: Options) Error!Output {
    if (w == 0 or h == 0) return error.InvalidImage;
    const needed = @as(usize, w) * h * 4;
    if (rgba.len < needed) return error.InvalidImage;

    var owned: ?mips.Scaled = null;
    defer if (owned) |o| a.free(o.pixels);

    var src: []const u8 = rgba[0..needed];
    var sw = w;
    var sh = h;
    if (opts.max_size > 0 and (w > opts.max_size or h > opts.max_size)) {
        const fitted = try mips.fitMaxSize(a, src, w, h, opts.max_size);
        owned = fitted;
        src = fitted.pixels;
        sw = fitted.w;
        sh = fitted.h;
    }

    var params = std.mem.zeroes(c.basset_basisu_params);
    params.mode = if (opts.mode == .uastc) 1 else 0;
    params.quality = @intCast(opts.quality);
    params.rdo_lambda = opts.rdo_lambda;
    params.normal_map = if (opts.normal_map) 1 else 0;
    params.generate_mips = if (opts.generate_mips) 1 else 0;
    params.max_size = @intCast(opts.max_size);
    params.srgb = if (opts.srgb) 1 else 0;
    params.uastc_level = @intCast(opts.uastc_level);
    params.supercompression = if (opts.supercompression == .zstd) 1 else 0;

    var out_ptr: ?[*]u8 = null;
    var out_len: usize = 0;
    var err_buf: [256]u8 = @splat(0);
    const rc = c.basset_basisu_encode(
        src.ptr,
        @intCast(sw),
        @intCast(sh),
        &params,
        &out_ptr,
        &out_len,
        &err_buf,
        @intCast(err_buf.len),
    );
    if (rc != 0 or out_ptr == null or out_len == 0) {
        std.debug.print("basisu encode: {s}\n", .{errSlice(&err_buf)});
        if (out_ptr) |p| c.basset_basisu_free(p);
        return error.BasisuEncode;
    }
    defer c.basset_basisu_free(out_ptr.?);

    const ktx2 = try a.alloc(u8, out_len);
    errdefer a.free(ktx2);
    @memcpy(ktx2, out_ptr.?[0..out_len]);

    const header = formats.parseHeader(ktx2) orelse {
        std.debug.print("basisu encode: produced data is not KTX2\n", .{});
        return error.InvalidKtx2;
    };
    return .{
        .ktx2 = ktx2,
        .width = header.width,
        .height = header.height,
        .mip_levels = header.mip_levels,
        // Basis Universal KTX2 files carry vkFormat=0 and describe the
        // transcodable format in the DFD, so fall back to the requested mode.
        .format_label = if (header.vk_format == 0)
            (if (opts.mode == .uastc) "UASTC" else "ETC1S")
        else
            formats.formatLabel(header.vk_format),
    };
}

pub fn decodeToRgba(a: std.mem.Allocator, ktx2: []const u8) Error!Decoded {
    if (ktx2.len == 0) return error.InvalidKtx2;
    var out_ptr: ?[*]u8 = null;
    var out_w: i32 = 0;
    var out_h: i32 = 0;
    var err_buf: [256]u8 = @splat(0);
    const rc = c.basset_basisu_decode_ktx2(
        ktx2.ptr,
        ktx2.len,
        &out_ptr,
        &out_w,
        &out_h,
        &err_buf,
        @intCast(err_buf.len),
    );
    if (rc != 0 or out_ptr == null or out_w <= 0 or out_h <= 0) {
        std.debug.print("basisu decode: {s}\n", .{errSlice(&err_buf)});
        if (out_ptr) |p| c.basset_basisu_free(p);
        return error.BasisuDecode;
    }
    defer c.basset_basisu_free(out_ptr.?);

    const w: u32 = @intCast(out_w);
    const h: u32 = @intCast(out_h);
    const n: usize = @as(usize, w) * h * 4;
    const pixels = try a.alloc(u8, n);
    @memcpy(pixels, out_ptr.?[0..n]);
    return .{ .pixels = pixels, .width = w, .height = h };
}

/// PSNR in dB between two 8-bit buffers (RGBA or any 8-bit layout). Uses the
/// shorter length when they differ. Identical buffers -> 99 dB sentinel.
pub fn psnr(a_bytes: []const u8, b_bytes: []const u8) f32 {
    const n = @min(a_bytes.len, b_bytes.len);
    if (n == 0) return 99.0;
    if (std.mem.eql(u8, a_bytes[0..n], b_bytes[0..n])) return 99.0;
    var sum: f64 = 0;
    for (a_bytes[0..n], b_bytes[0..n]) |x, y| {
        const d = @as(f64, @floatFromInt(x)) - @as(f64, @floatFromInt(y));
        sum += d * d;
    }
    const mse = sum / @as(f64, @floatFromInt(n));
    if (mse <= 0) return 99.0;
    const v = 10.0 * std.math.log10(255.0 * 255.0 / mse);
    return @floatCast(@min(v, 99.0));
}

test "psnr identical sentinel" {
    const buf = [_]u8{ 1, 2, 3, 4 };
    try std.testing.expectEqual(@as(f32, 99.0), psnr(&buf, &buf));
    const black = [_]u8{ 0, 0, 0, 0 };
    const white = [_]u8{ 255, 255, 255, 255 };
    const v = psnr(&black, &white);
    try std.testing.expect(v < 1.0);
}

test "encode 1x1 red png -> ktx2 -> rgba" {
    const a = std.testing.allocator;
    const decode = @import("decode.zig");
    // 1x1 RGB PNG (red), same fixture as decode.zig test
    const png = [_]u8{
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
        0x00, 0x03, 0x01, 0x01, 0x00, 0xC9, 0xFE, 0x92, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
        0x44, 0xAE, 0x42, 0x60, 0x82,
    };
    var dec = decode.decodeRgba(a, &png) orelse return error.TestUnexpectedResult;
    defer dec.deinit(a);

    const out = try encode(a, dec.pixels, dec.width, dec.height, .{ .generate_mips = false });
    defer a.free(out.ktx2);

    const header = formats.parseHeader(out.ktx2) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u32, 1), header.width);
    try std.testing.expectEqual(@as(u32, 1), header.height);
    try std.testing.expect(out.ktx2.len > 44);

    const rt = try decodeToRgba(a, out.ktx2);
    defer a.free(rt.pixels);
    try std.testing.expectEqual(@as(u32, 1), rt.width);
    try std.testing.expectEqual(@as(u32, 1), rt.height);
    try std.testing.expectEqual(@as(usize, 4), rt.pixels.len);
    // red stays dominant
    try std.testing.expect(rt.pixels[0] > 200);
    try std.testing.expect(rt.pixels[1] < 60);
    try std.testing.expect(rt.pixels[2] < 60);
}

fn makeGradient(a: std.mem.Allocator, w: u32, h: u32) ![]u8 {
    const pixels = try a.alloc(u8, @as(usize, w) * h * 4);
    for (0..h) |y| {
        for (0..w) |x| {
            const o = (y * w + x) * 4;
            pixels[o] = @intCast((x * 255) / @max(w - 1, 1));
            pixels[o + 1] = @intCast((y * 255) / @max(h - 1, 1));
            pixels[o + 2] = @intCast(((x + y) * 127) / @max(w + h - 2, 1));
            pixels[o + 3] = 255;
        }
    }
    return pixels;
}

test "etc1s 64x64 gradient psnr" {
    const a = std.testing.allocator;
    const src = try makeGradient(a, 64, 64);
    defer a.free(src);

    const out = try encode(a, src, 64, 64, .{ .mode = .etc1s, .quality = 128 });
    defer a.free(out.ktx2);
    try std.testing.expect(out.mip_levels >= 1);

    const rt = try decodeToRgba(a, out.ktx2);
    defer a.free(rt.pixels);
    try std.testing.expectEqual(@as(u32, 64), rt.width);
    try std.testing.expectEqual(@as(u32, 64), rt.height);

    const p = psnr(src, rt.pixels);
    std.debug.print("etc1s 64x64: {d:.2} dB, {d} bytes\n", .{ p, out.ktx2.len });
    try std.testing.expect(p > 25.0);
}

test "uastc 64x64 smoke" {
    const a = std.testing.allocator;
    const src = try makeGradient(a, 64, 64);
    defer a.free(src);

    const out = try encode(a, src, 64, 64, .{ .mode = .uastc, .uastc_level = 2 });
    defer a.free(out.ktx2);
    try std.testing.expect(out.ktx2.len > 44);

    const rt = try decodeToRgba(a, out.ktx2);
    defer a.free(rt.pixels);
    try std.testing.expectEqual(@as(u32, 64), rt.width);
    const p = psnr(src, rt.pixels);
    std.debug.print("uastc 64x64: {d:.2} dB, {d} bytes, {s}\n", .{ p, out.ktx2.len, out.format_label });
    try std.testing.expect(p > 30.0);
}

test "uastc zstd supercompression header + decode roundtrip" {
    const a = std.testing.allocator;
    const src = try makeGradient(a, 64, 64);
    defer a.free(src);

    // Default: no supercompression (byte-compat with existing outputs).
    const plain = try encode(a, src, 64, 64, .{ .mode = .uastc, .uastc_level = 2 });
    defer a.free(plain.ktx2);
    const plain_hdr = formats.parseHeader(plain.ktx2) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u32, 0), plain_hdr.supercompression);

    // zstd: header scheme 2, smaller, still decodes to the same dims.
    const z = try encode(a, src, 64, 64, .{ .mode = .uastc, .uastc_level = 2, .supercompression = .zstd });
    defer a.free(z.ktx2);
    const z_hdr = formats.parseHeader(z.ktx2) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u32, 2), z_hdr.supercompression);
    try std.testing.expect(z.ktx2.len < plain.ktx2.len);

    const rt = try decodeToRgba(a, z.ktx2);
    defer a.free(rt.pixels);
    try std.testing.expectEqual(@as(u32, 64), rt.width);
    try std.testing.expectEqual(@as(u32, 64), rt.height);
    const rt_plain = try decodeToRgba(a, plain.ktx2);
    defer a.free(rt_plain.pixels);
    const p_plain = psnr(src, rt_plain.pixels);
    // zstd is lossless on the payload: same pixels as the plain encode.
    try std.testing.expectEqual(@as(f32, 99.0), psnr(rt.pixels, rt_plain.pixels));
    std.debug.print("uastc 64x64 plain {d} B vs zstd {d} B, psnr {d:.2}\n", .{ plain.ktx2.len, z.ktx2.len, p_plain });
}

test "zstd ignored for etc1s (scheme unchanged)" {
    const a = std.testing.allocator;
    const src = try makeGradient(a, 32, 32);
    defer a.free(src);
    const plain = try encode(a, src, 32, 32, .{ .mode = .etc1s });
    defer a.free(plain.ktx2);
    const out = try encode(a, src, 32, 32, .{ .mode = .etc1s, .supercompression = .zstd });
    defer a.free(out.ktx2);
    // ETC1S KTX2 always carries BASISLZ (1); the zstd flag must not change it.
    const p_hdr = formats.parseHeader(plain.ktx2) orelse return error.TestUnexpectedResult;
    const hdr = formats.parseHeader(out.ktx2) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(p_hdr.supercompression, hdr.supercompression);
    try std.testing.expectEqualSlices(u8, plain.ktx2, out.ktx2);
}

test "normal map smoke" {
    const a = std.testing.allocator;
    const w = 32;
    const h = 32;
    const src = try a.alloc(u8, w * h * 4);
    defer a.free(src);
    for (0..h) |y| {
        for (0..w) |x| {
            const o = (y * w + x) * 4;
            // mostly flat normal +Z with a slight X/Y bend
            src[o] = @intCast(128 + (x % 8));
            src[o + 1] = @intCast(128 + (y % 8));
            src[o + 2] = 255;
            src[o + 3] = 255;
        }
    }
    const out = try encode(a, src, w, h, .{ .normal_map = true, .srgb = false });
    defer a.free(out.ktx2);
    const rt = try decodeToRgba(a, out.ktx2);
    defer a.free(rt.pixels);
    try std.testing.expectEqual(@as(u32, w), rt.width);
    const p = psnr(src, rt.pixels);
    std.debug.print("normal 32x32: {d:.2} dB, {d} bytes\n", .{ p, out.ktx2.len });
    try std.testing.expect(p > 20.0);
}

test "max_size downscales before encode" {
    const a = std.testing.allocator;
    const src = try makeGradient(a, 64, 64);
    defer a.free(src);
    const out = try encode(a, src, 64, 64, .{ .max_size = 16, .generate_mips = false });
    defer a.free(out.ktx2);
    try std.testing.expectEqual(@as(u32, 16), out.width);
    try std.testing.expectEqual(@as(u32, 16), out.height);
}
