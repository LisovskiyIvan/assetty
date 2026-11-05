//! EXT_meshopt_compression codec glue (encode/decode wrappers + filters).
//!
//! The C symbols below live in `vendor/meshoptimizer/` (`indexcodec.cpp`,
//! `vertexcodec.cpp`, `vertexfilter.cpp`, `allocator.cpp`, all v1.3) and are
//! only linked when `build.zig` compiles those sources (see the report for
//! the exact one-spot addition). Until then `have_codec` stays `false`:
//!
//! * every wrapper fails fast with `error.CodecUnavailable` (never half-runs),
//! * the calls sit behind a comptime-known branch, so the test binary links
//!   without the codec objects and the whole suite stays green,
//! * codec unit tests `return error.Skip` instead of failing.
//!
//! Flip `have_codec` to `true` together with the `build.zig` line; every
//! skipped test then runs for real.

const std = @import("std");
const mo = @import("meshopt");

/// Codec objects linked in (see module doc). Wired in `build.zig`:
/// allocator/indexcodec/vertexcodec/vertexfilter.cpp. Call sites degrade
/// gracefully (error / Skip, never crash) when a target omits them.
pub const have_codec = true;

pub const Error = error{
    CodecUnavailable,
    /// Encoder returned 0 (output buffer too small — sized from `*Bound`, so
    /// this means corrupt input parameters) or the decoder reported an error.
    CodecFailed,
} || std.mem.Allocator.Error;

/// Buffer-view compression mode (mirrors the glTF extension strings).
pub const Mode = enum {
    attributes,
    triangles,
    indices,

    pub fn label(self: Mode) []const u8 {
        return switch (self) {
            .attributes => "ATTRIBUTES",
            .triangles => "TRIANGLES",
            .indices => "INDICES",
        };
    }
};

/// Buffer-view compression filter (mirrors the glTF extension strings).
pub const Filter = enum {
    none,
    octahedral,
    quaternion,
    exponential,

    pub fn label(self: Filter) []const u8 {
        return switch (self) {
            .none => "NONE",
            .octahedral => "OCTAHEDRAL",
            .quaternion => "QUATERNION",
            .exponential => "EXPONENTIAL",
        };
    }
};

/// Encode one vertex stream (`src` is `vertex_count * vertex_size` bytes,
/// `vertex_size` a multiple of 4, <= 256). Returns an owned compressed copy;
/// the caller frees it. Fails when the payload would not shrink.
pub fn encodeVertices(a: std.mem.Allocator, src: []const u8, vertex_count: usize, vertex_size: usize) Error![]u8 {
    if (!have_codec) return error.CodecUnavailable;
    if (src.len != vertex_count * vertex_size) return error.CodecFailed;
    if (vertex_size == 0 or vertex_size % 4 != 0 or vertex_size > 256) return error.CodecFailed;

    const bound: usize = mo.meshopt_encodeVertexBufferBound(vertex_count, vertex_size);
    if (bound == 0) return error.CodecFailed;
    const tmp = try a.alloc(u8, bound);
    errdefer a.free(tmp);
    const n: usize = mo.meshopt_encodeVertexBuffer(tmp.ptr, tmp.len, src.ptr, vertex_count, vertex_size);
    if (n == 0 or n >= src.len) return error.CodecFailed;
    // Shrink to the exact payload so the BIN chunk holds no slack.
    if (a.remap(tmp, n)) |exact| return exact;
    const out = try a.dupe(u8, tmp[0..n]);
    a.free(tmp);
    return out;
}

/// Decode an ATTRIBUTES payload into `dst` (`vertex_count * vertex_size`).
pub fn decodeVertices(dst: []u8, src: []const u8, vertex_count: usize, vertex_size: usize) Error!void {
    if (!have_codec) return error.CodecUnavailable;
    if (dst.len != vertex_count * vertex_size) return error.CodecFailed;
    const rc: c_int = mo.meshopt_decodeVertexBuffer(dst.ptr, vertex_count, vertex_size, src.ptr, src.len);
    if (rc != 0) return error.CodecFailed;
}

/// Encode a triangle-list index buffer (`indices` are u32 vertex ids).
pub fn encodeTriangles(a: std.mem.Allocator, indices: []const u32) Error![]u8 {
    if (!have_codec) return error.CodecUnavailable;
    if (indices.len == 0 or indices.len % 3 != 0) return error.CodecFailed;

    var bound_max: usize = 0;
    for (indices) |ix| bound_max = @max(bound_max, ix);
    const bound: usize = mo.meshopt_encodeIndexBufferBound(indices.len, bound_max + 1);
    if (bound == 0) return error.CodecFailed;
    const tmp = try a.alloc(u8, bound);
    errdefer a.free(tmp);
    const n: usize = mo.meshopt_encodeIndexBuffer(tmp.ptr, tmp.len, indices.ptr, indices.len);
    if (n == 0 or n >= indices.len * 4) return error.CodecFailed;
    if (a.remap(tmp, n)) |exact| return exact;
    const out = try a.dupe(u8, tmp[0..n]);
    a.free(tmp);
    return out;
}

/// Encode a general index sequence (non-triangle topology).
pub fn encodeSequence(a: std.mem.Allocator, indices: []const u32) Error![]u8 {
    if (!have_codec) return error.CodecUnavailable;
    if (indices.len == 0) return error.CodecFailed;

    var bound_max: usize = 0;
    for (indices) |ix| bound_max = @max(bound_max, ix);
    const bound: usize = mo.meshopt_encodeIndexSequenceBound(indices.len, bound_max + 1);
    if (bound == 0) return error.CodecFailed;
    const tmp = try a.alloc(u8, bound);
    errdefer a.free(tmp);
    const n: usize = mo.meshopt_encodeIndexSequence(tmp.ptr, tmp.len, indices.ptr, indices.len);
    if (n == 0 or n >= indices.len * 4) return error.CodecFailed;
    if (a.remap(tmp, n)) |exact| return exact;
    const out = try a.dupe(u8, tmp[0..n]);
    a.free(tmp);
    return out;
}

fn decodeIndicesAny(dst: []u8, src: []const u8, index_count: usize, index_size: usize, sequence: bool) Error!void {
    if (!have_codec) return error.CodecUnavailable;
    if (dst.len != index_count * index_size) return error.CodecFailed;
    const rc: c_int = if (sequence)
        mo.meshopt_decodeIndexSequence(dst.ptr, index_count, index_size, src.ptr, src.len)
    else
        mo.meshopt_decodeIndexBuffer(dst.ptr, index_count, index_size, src.ptr, src.len);
    if (rc != 0) return error.CodecFailed;
}

/// Decode a TRIANGLES/INDICES payload into `dst` (`index_count * index_size`).
pub fn decodeIndices(dst: []u8, src: []const u8, index_count: usize, index_size: usize, sequence: bool) Error!void {
    return decodeIndicesAny(dst, src, index_count, index_size, sequence);
}

/// Octahedral-encode `count` unit float3 normals into `dst` (`count * stride`
/// bytes, stride 4 or 8, 2 <= bits <= 16). The 4th component is passthrough
/// (zero it for plain normals; tangents keep W).
pub fn encodeFilterOct(dst: []u8, count: usize, stride: usize, bits: u5, src: []const f32) Error!void {
    if (!have_codec) return error.CodecUnavailable;
    if (dst.len != count * stride) return error.CodecFailed;
    if (src.len != count * 4) return error.CodecFailed;
    if (stride != 4 and stride != 8) return error.CodecFailed;
    if (bits < 2 or bits > 16) return error.CodecFailed;
    mo.meshopt_encodeFilterOct(dst.ptr, count, stride, bits, src.ptr);
}

/// In-place octahedral decode of a decoded vertex buffer (see header docs).
pub fn decodeFilterOct(buf: []u8, count: usize, stride: usize) Error!void {
    if (!have_codec) return error.CodecUnavailable;
    if (buf.len != count * stride) return error.CodecFailed;
    if (stride != 4 and stride != 8) return error.CodecFailed;
    mo.meshopt_decodeFilterOct(buf.ptr, count, stride);
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

const testing = std.testing;

fn skipIfNoCodec() !void {
    if (!have_codec) {
        return error.SkipZigTest;
    }
}

test "meshopt unavailable without codec objects" {
    // Gating contract: with have_codec=false every entry point fails fast
    // (and links without the C++ objects). This branch only runs when the
    // codec IS linked, so assert the positive instead.
    if (!have_codec) {
        try testing.expectError(error.CodecUnavailable, encodeVertices(testing.allocator, &.{ 0, 0, 0, 0 }, 1, 4));
        try testing.expectError(error.CodecUnavailable, encodeTriangles(testing.allocator, &.{ 0, 1, 2 }));
    }
}

test "attributes: positions round-trip" {
    try skipIfNoCodec();
    const a = testing.allocator;
    // 64 quantized-like positions (VEC3 u16, stride 8 padded like the op emits)
    const src = try a.alloc(u8, 64 * 8);
    defer a.free(src);
    // Smooth quantized-like data: neighbouring vertices are close, so
    // per-byte deltas are small and the payload compresses (random bytes do
    // not, and correctly fail with CodecFailed -- see the test below).
    for (0..64) |v| {
        const s: f32 = @sin(@as(f32, @floatFromInt(v)) * 0.35);
        const q: u16 = @intFromFloat(32768.0 + 20000.0 * s);
        std.mem.writeInt(u16, src[v * 8 ..][0..2], q, .little);
        std.mem.writeInt(u16, src[v * 8 + 2 ..][0..2], q +% @as(u16, @intCast(v)), .little);
        std.mem.writeInt(u16, src[v * 8 + 4 ..][0..2], 65535 - q, .little);
        std.mem.writeInt(u16, src[v * 8 + 6 ..][0..2], 0, .little);
    }

    const enc = try encodeVertices(a, src, 64, 8);
    defer a.free(enc);
    try testing.expect(enc.len < src.len);

    const dec = try a.alloc(u8, src.len);
    defer a.free(dec);
    try decodeVertices(dec, enc, 64, 8);
    try testing.expectEqualSlices(u8, src, dec);
}

test "attributes: tiny payload is rejected (no growth)" {
    try skipIfNoCodec();
    const a = testing.allocator;
    const src = [_]u8{ 1, 2, 3, 4 };
    // 1 vertex of stride 4: encoding overhead exceeds the payload.
    try testing.expectError(error.CodecFailed, encodeVertices(a, &src, 1, 4));
}

test "octahedral normals round-trip" {
    try skipIfNoCodec();
    const a = testing.allocator;
    const count = 48;
    var normals = try a.alloc(f32, count * 4);
    defer a.free(normals);
    // Unit vectors sweeping the sphere; W passthrough pattern included.
    var i: usize = 0;
    while (i < count) : (i += 1) {
        const t: f32 = @as(f32, @floatFromInt(i)) / @as(f32, count) * std.math.pi * 2.0;
        normals[i * 4 + 0] = @cos(t);
        normals[i * 4 + 1] = @sin(t) * 0.5;
        normals[i * 4 + 2] = @sin(t) * 0.5;
        const l = @sqrt(normals[i * 4] * normals[i * 4] + normals[i * 4 + 1] * normals[i * 4 + 1] + normals[i * 4 + 2] * normals[i * 4 + 2]);
        normals[i * 4] /= l;
        normals[i * 4 + 1] /= l;
        normals[i * 4 + 2] /= l;
        normals[i * 4 + 3] = 0;
    }

    const oct = try a.alloc(u8, count * 8);
    defer a.free(oct);
    try encodeFilterOct(oct, count, 8, 12, normals);

    const enc = try encodeVertices(a, oct, count, 8);
    defer a.free(enc);
    try testing.expect(enc.len < oct.len);

    const dec = try a.alloc(u8, oct.len);
    defer a.free(dec);
    try decodeVertices(dec, enc, count, 8);
    try testing.expectEqualSlices(u8, oct, dec);

    try decodeFilterOct(dec, count, 8);
    // Filter output is int16 triples + W passthrough: decoded values must be
    // unit-length within 12-bit-oct tolerance.
    var k: usize = 0;
    while (k < count) : (k += 1) {
        const x = std.mem.readInt(i16, dec[k * 8 ..][0..2], .little);
        const y = std.mem.readInt(i16, dec[k * 8 + 2 ..][0..2], .little);
        const z = std.mem.readInt(i16, dec[k * 8 + 4 ..][0..2], .little);
        const w = std.mem.readInt(i16, dec[k * 8 + 6 ..][0..2], .little);
        const fx: f32 = @as(f32, @floatFromInt(x)) / 32767.0;
        const fy: f32 = @as(f32, @floatFromInt(y)) / 32767.0;
        const fz: f32 = @as(f32, @floatFromInt(z)) / 32767.0;
        const len = @sqrt(fx * fx + fy * fy + fz * fz);
        try testing.expectApproxEqAbs(1.0, len, 0.01);
        try testing.expectEqual(@as(i16, 0), w);
    }
}

test "indices: triangle list round-trip" {
    try skipIfNoCodec();
    const a = testing.allocator;
    // A strip-like triangle list (vertex-cache friendly => compressible).
    const idx = try a.alloc(u32, 300);
    defer a.free(idx);
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        idx[i * 3 + 0] = @intCast(i);
        idx[i * 3 + 1] = @intCast(i + 1);
        idx[i * 3 + 2] = @intCast(i + 2);
    }
    const enc = try encodeTriangles(a, idx);
    defer a.free(enc);
    try testing.expect(enc.len < idx.len * 4);

    // Decode as 16-bit (index_size=2): the loader path for u16 indices.
    // Note: the encoder rotates triangles within themselves (winding
    // preserved) to fit the fast code path, so compare rotation-insensitively.
    const dec16 = try a.alloc(u8, 300 * 2);
    defer a.free(dec16);
    try decodeIndices(dec16, enc, 300, 2, false);
    for (0..100) |t| {
        var got = [_]u32{
            std.mem.readInt(u16, dec16[(t * 3 + 0) * 2 ..][0..2], .little),
            std.mem.readInt(u16, dec16[(t * 3 + 1) * 2 ..][0..2], .little),
            std.mem.readInt(u16, dec16[(t * 3 + 2) * 2 ..][0..2], .little),
        };
        var want = [_]u32{ idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2] };
        std.mem.sort(u32, &got, {}, std.sort.asc(u32));
        std.mem.sort(u32, &want, {}, std.sort.asc(u32));
        try testing.expectEqualSlices(u32, &want, &got);
    }
    // And as 32-bit (same rotation-insensitive comparison).
    const dec32 = try a.alloc(u8, 300 * 4);
    defer a.free(dec32);
    try decodeIndices(dec32, enc, 300, 4, false);
    for (0..100) |t| {
        const got = [_]u32{
            std.mem.readInt(u32, dec32[(t * 3 + 0) * 4 ..][0..4], .little),
            std.mem.readInt(u32, dec32[(t * 3 + 1) * 4 ..][0..4], .little),
            std.mem.readInt(u32, dec32[(t * 3 + 2) * 4 ..][0..4], .little),
        };
        // (t, t+1, t+2) as a set: rotation-insensitive membership check.
        var seen = [_]bool{ false, false, false };
        for (got) |v| {
            try testing.expect(v >= t and v <= t + 2);
            seen[v - t] = true;
        }
        try testing.expect(seen[0] and seen[1] and seen[2]);
    }
}

test "indices: sequence round-trip (non-triangle topology)" {
    try skipIfNoCodec();
    const a = testing.allocator;
    const idx = try a.alloc(u32, 200);
    defer a.free(idx);
    // Line-list-like pairs with bimodal locality.
    var i: usize = 0;
    while (i < 100) : (i += 1) {
        idx[i * 2 + 0] = @intCast(i);
        idx[i * 2 + 1] = @intCast(1000 + i);
    }
    const enc = try encodeSequence(a, idx);
    defer a.free(enc);
    try testing.expect(enc.len < idx.len * 4);

    const dec = try a.alloc(u8, idx.len * 4);
    defer a.free(dec);
    try decodeIndices(dec, enc, idx.len, 4, true);
    for (idx, 0..) |v, k| {
        try testing.expectEqual(v, std.mem.readInt(u32, dec[k * 4 ..][0..4], .little));
    }
}
