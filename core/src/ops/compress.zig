//! Standalone meshopt pass (`compress` step): compress every eligible buffer
//! view AFTER the geometry ops, so decoded-but-untouched accessors (float
//! positions/UVs/normals the quantize step never rewrote) still ship as
//! `EXT_meshopt_compression` instead of raw bytes.
//!
//! The pass is exactly `quantize.compressViews` run standalone: same
//! eligibility census (vertex-attribute + index views only; sparse, image,
//! animation, skin, instancing and draco views are never touched), same
//! never-lose rule (views under ~256 B or encoding larger than raw stay
//! plain), same layout the quantize path emits (ATTRIBUTES with filter NONE
//! for float data — the data is final, no octahedral re-encode — TRIANGLES /
//! INDICES for index views). Already-compressed views are skipped, never
//! re-encoded, so this composes with `quantize.meshopt_compression`.
//!
//! Output requires an EXT_meshopt_compression-capable loader (the op
//! registers the extension in used+required when it compresses anything).

const std = @import("std");
const c = @import("cgltf");
const mc = @import("meshopt.zig");
const quantize = @import("quantize.zig");

pub const Options = struct {};

pub const Result = struct {
    /// buffer views carrying EXT_meshopt_compression after this step
    meshopt_views: u32 = 0,
    /// requested but the codec objects are not linked
    meshopt_no_codec: bool = false,
};

pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = file_bytes;
    _ = opts;
    var res: Result = .{};
    if (!mc.have_codec) {
        res.meshopt_no_codec = true;
        return res;
    }
    var qres: quantize.Result = .{};
    try quantize.compressViews(a, data, &qres, .{ .meshopt_compression = true });
    res.meshopt_views = qres.meshopt_views;
    if (res.meshopt_views > 0) {
        try quantize.ensureExtension(data, "EXT_meshopt_compression", true);
        try quantize.ensureExtension(data, "EXT_meshopt_compression", false);
    }
    return res;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

const testing = std.testing;
const parse_mod = @import("../gltf/parse.zig");
const write_mod = @import("../gltf/write.zig");

fn countMcViews(data: *c.cgltf_data) usize {
    var n: usize = 0;
    const views = data.buffer_views[0..data.buffer_views_count];
    for (views) |*v| {
        if (v.has_meshopt_compression != 0) n += 1;
    }
    return n;
}

test "compress-only on float helmet compresses eligible views and re-parses" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var loaded = try parse_mod.loadFile(testing.io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded.deinit();
    try testing.expectEqual(@as(usize, 0), countMcViews(loaded.cdata));

    const res = try run(a, loaded.cdata, loaded.map, .{});
    try testing.expect(!res.meshopt_no_codec);
    try testing.expect(res.meshopt_views > 0);
    try testing.expectEqual(@as(u32, @intCast(countMcViews(loaded.cdata))), res.meshopt_views);

    // every flagged view decodes: writer layout is (buffer, byteOffset,
    // byteLength compressed, byteStride, count, mode) with decompressed
    // byteLength on the view itself.
    const out = try write_mod.serialize(a, loaded.cdata, loaded.map);
    try testing.expect(std.mem.indexOf(u8, out, "EXT_meshopt_compression") != null);

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(testing.io, .{ .sub_path = "compress-only.glb", .data = out });
    const out_path = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/compress-only.glb", .{tmp.sub_path[0..]});
    var rp = try parse_mod.loadFile(testing.io, a, out_path);
    defer rp.deinit();
    try testing.expectEqual(
        @as(c_uint, c.cgltf_result_success),
        @as(c_uint, c.cgltf_validate(rp.cdata)),
    );
    // accessor counts unchanged by compression
    try testing.expectEqual(loaded.cdata.accessors_count, rp.cdata.accessors_count);
}

test "compress after quantize.meshopt_compression adds nothing (no double-compress)" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var loaded = try parse_mod.loadFile(testing.io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded.deinit();

    const qres = try quantize.run(a, loaded.cdata, loaded.map, .{ .meshopt_compression = true });
    try testing.expect(qres.meshopt_views > 0);
    const before = countMcViews(loaded.cdata);

    const cres = try run(a, loaded.cdata, loaded.map, .{});
    try testing.expectEqual(@as(u32, 0), cres.meshopt_views);
    try testing.expectEqual(before, countMcViews(loaded.cdata));
}

test "quantize.meshopt_compression without compress keeps old behavior" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var loaded = try parse_mod.loadFile(testing.io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded.deinit();

    const qres = try quantize.run(a, loaded.cdata, loaded.map, .{ .meshopt_compression = true });
    // quantize-only run still compresses exactly what it always did: only the
    // views it quantized itself (float leftovers stay plain without compress)
    try testing.expect(qres.meshopt_views > 0);
    const out = try write_mod.serialize(a, loaded.cdata, loaded.map);
    try testing.expect(std.mem.indexOf(u8, out, "EXT_meshopt_compression") != null);
}
