//! Vertex welding on parsed cgltf data.
//!
//! For every indexed triangle primitive: merge vertices whose complete
//! attribute tuple (position, normal, uv, ...) is identical — byte-exact when
//! `tolerance == 0`, or equal after quantizing POSITION to a `tolerance` grid —
//! and rewrite the index buffer. Unreferenced vertices are dropped as well.
//!
//! The new attribute / index accessors are registered with `geom.Builder` and
//! flushed once at the end of `run`; the old accessors stay in the pools
//! (orphaned) and are dropped by the writer's GC pass.

const std = @import("std");
const c = @import("cgltf");
const geom = @import("geom.zig");

pub const Options = struct {
    /// 0 = exact match on (position, normal, uv...) tuples
    tolerance: f32 = 0,
};

pub const Result = struct {
    /// vertices removed across all primitives
    removed_vertices: u32 = 0,
    /// primitives whose index buffer was rewritten
    rewritten_prims: u32 = 0,
};

const Pending = struct {
    prim: *c.cgltf_primitive,
    attrs: []*c.cgltf_accessor,
    indices: *c.cgltf_accessor,
};

/// Vertex welding: within each primitive's index+attribute data, merge
/// byte-identical (or tolerance-equal) vertices, rewrite indices.
/// Creates a new compact accessor set via geom.Builder.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = file_bytes; // buffer payloads are already mapped (cgltf_load_buffers)

    var res: Result = .{};
    if (data.meshes_count == 0 or data.buffers_count == 0) return res;

    var b = geom.Builder.init(a, data) catch |err| switch (err) {
        error.NoBuffer => return res,
        else => |e| return e,
    };
    defer b.deinit();

    var pending: std.ArrayList(Pending) = .empty;
    defer pending.deinit(a);

    for (geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            if (try weldPrim(a, &b, p, opts.tolerance, &res)) |pd| {
                try pending.append(a, pd);
            }
        }
    }

    if (pending.items.len == 0) return res;
    try b.finish();

    for (pending.items) |pd| {
        pd.prim.indices = b.resolve(pd.indices);
        for (geom.sl(c.cgltf_attribute, pd.prim.attributes, pd.prim.attributes_count), 0..) |*at, k| {
            at.data = b.resolve(pd.attrs[k]);
        }
        a.free(pd.attrs);
    }
    return res;
}

fn weldPrim(
    a: std.mem.Allocator,
    b: *geom.Builder,
    p: *c.cgltf_primitive,
    tolerance: f32,
    res: *Result,
) !?Pending {
    if (p.type != 5) return null; // cgltf_primitive_type_triangles
    if (@intFromPtr(p.indices) == 0) return null; // indexed primitives only
    if (p.targets_count > 0 or p.has_draco_mesh_compression != 0) return null;

    const nattr: usize = @intCast(p.attributes_count);
    if (nattr == 0) return null;
    const attrs = geom.sl(c.cgltf_attribute, p.attributes, nattr);

    const streams = try a.alloc(geom.Stream, nattr);
    defer a.free(streams);

    var key_len: usize = 0;
    var vcount: usize = std.math.maxInt(usize);
    var pos_slot: ?usize = null;
    for (attrs, 0..) |*at, k| {
        if (@intFromPtr(at.data) == 0) return null;
        const acc: *const c.cgltf_accessor = @ptrCast(at.data);
        streams[k] = geom.Stream.init(acc) orelse return null;
        vcount = @min(vcount, streams[k].count);
        key_len += streams[k].elem;
        if (at.type == 1) pos_slot = k; // cgltf_attribute_type_position
        if (key_len > 8192) return null; // defensive: absurd vertex layout
    }
    if (vcount == 0 or vcount == std.math.maxInt(usize)) return null;

    const ir = geom.IndexReader.init(@ptrCast(p.indices)) orelse return null;
    const nidx = ir.count();
    if (nidx == 0 or nidx % 3 != 0) return null;

    // --- find unique vertices in first-seen order -------------------------
    const key = try a.alloc(u8, key_len);
    defer a.free(key);

    var map: std.StringHashMapUnmanaged(u32) = .empty;
    defer map.deinit(a);
    var owned_keys: std.ArrayList([]u8) = .empty;
    defer {
        for (owned_keys.items) |k| a.free(k);
        owned_keys.deinit(a);
    }

    var src: std.ArrayList(u32) = .empty; // unique id -> source vertex
    defer src.deinit(a);

    const remap = try a.alloc(u32, vcount);
    defer a.free(remap);
    @memset(remap, std.math.maxInt(u32));

    const new_idx = try a.alloc(u32, nidx);
    defer a.free(new_idx);

    var unique: usize = 0;
    for (0..nidx) |ii| {
        const vi: usize = ir.get(ii);
        if (vi >= vcount) return null; // out-of-range index: leave prim alone
        if (remap[vi] == std.math.maxInt(u32)) {
            fillKey(key, streams, vi, pos_slot, tolerance);
            const gop = try map.getOrPut(a, key);
            if (gop.found_existing) {
                remap[vi] = gop.value_ptr.*;
            } else {
                const owned = try a.dupe(u8, key);
                try owned_keys.append(a, owned);
                gop.key_ptr.* = owned;
                gop.value_ptr.* = @intCast(unique);
                remap[vi] = @intCast(unique);
                try src.append(a, @intCast(vi));
                unique += 1;
            }
        }
        new_idx[ii] = remap[vi];
    }

    if (unique == vcount) return null; // nothing merged, nothing unreferenced

    // --- emit compact streams --------------------------------------------
    const new_attrs = try a.alloc(*c.cgltf_accessor, nattr);
    for (attrs, 0..) |*at, k| {
        const acc: *const c.cgltf_accessor = @ptrCast(at.data);
        new_attrs[k] = try emitStream(a, b, streams[k], src.items, unique, acc, at.type == 1);
    }
    const new_indices = try b.addIndices(new_idx);

    res.removed_vertices += @intCast(vcount - unique);
    res.rewritten_prims += 1;
    return .{ .prim = p, .attrs = new_attrs, .indices = new_indices };
}

fn emitStream(
    a: std.mem.Allocator,
    b: *geom.Builder,
    s: geom.Stream,
    src: []const u32,
    unique: usize,
    acc: *const c.cgltf_accessor,
    is_position: bool,
) !*c.cgltf_accessor {
    const len = std.math.mul(usize, unique, s.elem) catch return error.OutOfMemory;
    const bytes = try a.alloc(u8, len);
    defer a.free(bytes);
    for (0..unique) |u| {
        @memcpy(bytes[u * s.elem ..][0..s.elem], s.at(src[u]));
    }

    const ncomp = geom.numComponents(acc.type);
    var bnd: ?geom.Bounds = null;
    if (is_position and acc.component_type == 6) { // FLOAT
        bnd = geom.f32Bounds(bytes, s.elem, unique, ncomp);
    }

    const vi = try b.addView(bytes, 34962);
    return b.addAccessor(
        vi,
        0,
        acc.component_type,
        acc.type,
        unique,
        acc.normalized != 0,
        if (bnd) |x| x.min[0..ncomp] else null,
        if (bnd) |x| x.max[0..ncomp] else null,
    );
}

/// Concatenate every attribute element of vertex `vi` into `key`
/// (POSITION is quantized to the tolerance grid when `tolerance > 0`).
fn fillKey(
    key: []u8,
    streams: []const geom.Stream,
    vi: usize,
    pos_slot: ?usize,
    tolerance: f32,
) void {
    var off: usize = 0;
    for (streams, 0..) |s, k| {
        const e = s.at(vi);
        const quantize_pos = pos_slot != null and k == pos_slot.? and
            tolerance > 0 and s.elem >= 12;
        if (quantize_pos) {
            for (0..3) |comp| {
                const q = gridQuantize(geom.readF32(e, comp), tolerance);
                std.mem.writeInt(i32, key[off + comp * 4 ..][0..4], q, .little);
            }
            if (s.elem > 12) @memcpy(key[off + 12 ..][0 .. s.elem - 12], e[12..]);
        } else {
            @memcpy(key[off..][0..s.elem], e);
        }
        off += s.elem;
    }
}

fn gridQuantize(v: f32, tolerance: f32) i32 {
    if (!std.math.isFinite(v)) return 0;
    const q = @round(v / tolerance);
    if (q >= 2147483000.0) return 2147483000;
    if (q <= -2147483000.0) return -2147483000;
    return @intFromFloat(q);
}

// ===========================================================================
// tests
// ===========================================================================

const write_mod = @import("../gltf/write.zig");
const parse_mod = @import("../gltf/parse.zig");

const Parsed = struct {
    data: *c.cgltf_data,

    fn deinit(self: *Parsed) void {
        c.cgltf_free(self.data);
    }
};

fn parseBytes(bytes: []const u8) !Parsed {
    var options: c.cgltf_options = std.mem.zeroes(c.cgltf_options);
    var data: ?*c.cgltf_data = null;
    const res = c.cgltf_parse(&options, bytes.ptr, bytes.len, &data);
    if (res != c.cgltf_result_success or data == null) return error.ParseFailed;
    errdefer c.cgltf_free(data);
    if (c.cgltf_load_buffers(&options, data, null) != c.cgltf_result_success) {
        return error.LoadFailed;
    }
    return .{ .data = data.? };
}

fn primAt(data: *c.cgltf_data, mesh: usize, prim: usize) *c.cgltf_primitive {
    const m = &geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count)[mesh];
    return &geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)[prim];
}

fn attrAcc(p: *c.cgltf_primitive, name: []const u8) *const c.cgltf_accessor {
    for (geom.sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
        const n = at.name orelse continue;
        if (std.mem.eql(u8, std.mem.span(n), name)) {
            const acc: *const c.cgltf_accessor = @ptrCast(at.data);
            return acc;
        }
    }
    unreachable;
}

fn readFloats(a: std.mem.Allocator, acc: *const c.cgltf_accessor) ![]f32 {
    const ncomp = geom.numComponents(acc.type);
    const total: usize = @as(usize, @intCast(acc.count)) * ncomp;
    const buf = try a.alloc(f32, total);
    const got = c.cgltf_accessor_unpack_floats(acc, buf.ptr, total);
    return buf[0..got];
}

fn readIdx(a: std.mem.Allocator, acc: *const c.cgltf_accessor) ![]u32 {
    const n: usize = @intCast(acc.count);
    const out = try a.alloc(u32, n);
    for (out, 0..) |*v, i| v.* = @intCast(c.cgltf_accessor_read_index(acc, i));
    return out;
}

test "weld: fixture merges duplicate vertices and rewrites indices" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/weld_join_target.glb");
    defer loaded.deinit();
    const d = loaded.cdata;

    try std.testing.expectEqual(@as(usize, 1), d.meshes_count);
    try std.testing.expectEqual(@as(usize, 4), geom.sl(c.cgltf_mesh, d.meshes, d.meshes_count)[0].primitives_count);

    const p0 = primAt(d, 0, 0);
    const pos_before = try readFloats(aa, attrAcc(p0, "POSITION"));
    const idx_before = try readIdx(aa, @ptrCast(p0.indices));
    try std.testing.expectEqual(@as(usize, 12), pos_before.len / 3);
    try std.testing.expectEqual(@as(usize, 18), idx_before.len);

    const res = try run(aa, d, loaded.map, .{});
    // prim A: 12 -> 10, prim B: 12 -> 10; non-indexed + clean prim untouched
    try std.testing.expectEqual(@as(u32, 4), res.removed_vertices);
    try std.testing.expectEqual(@as(u32, 2), res.rewritten_prims);

    // new references must be pool accessors (writer GC relies on that)
    try std.testing.expectEqual(@as(usize, 10), attrAcc(p0, "POSITION").count);
    try std.testing.expectEqual(@as(usize, 10), attrAcc(p0, "NORMAL").count);
    try std.testing.expectEqual(@as(usize, 10), attrAcc(p0, "TEXCOORD_0").count);
    try std.testing.expectEqual(@as(usize, 18), @as(usize, @intCast(p0.indices.*.count)));

    // first 8 vertices keep their exact values; the duplicated seam verts
    // (source 8/9, byte-identical copies of source 0/1) collapse, so the new
    // list is [0..7, 10, 11]
    const pos_after = try readFloats(aa, attrAcc(p0, "POSITION"));
    try std.testing.expectEqual(@as(usize, 30), pos_after.len);
    try std.testing.expectEqualSlices(f32, pos_before[0 .. 8 * 3], pos_after[0 .. 8 * 3]);
    try std.testing.expectEqualSlices(f32, pos_before[10 * 3 .. 12 * 3], pos_after[8 * 3 .. 10 * 3]);

    // indices: quad 1+2 unchanged, seam quad now [0,1,8, 0,8,9]
    const idx_after = try readIdx(aa, @ptrCast(p0.indices));
    try std.testing.expectEqualSlices(u32, &.{
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
        0, 1, 8, 0, 8, 9,
    }, idx_after);

    // POSITION min/max present and correct on the new accessor
    const pos_acc = attrAcc(p0, "POSITION");
    try std.testing.expect(pos_acc.has_min != 0 and pos_acc.has_max != 0);
    var lo: [3]f32 = .{ std.math.inf(f32), std.math.inf(f32), std.math.inf(f32) };
    var hi: [3]f32 = .{ -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32) };
    for (0..10) |i| {
        for (0..3) |k| {
            const v = pos_after[i * 3 + k];
            if (v < lo[k]) lo[k] = v;
            if (v > hi[k]) hi[k] = v;
        }
    }
    try std.testing.expectEqualSlices(f32, &lo, pos_acc.min[0..3]);
    try std.testing.expectEqualSlices(f32, &hi, pos_acc.max[0..3]);

    // other primitives unchanged
    try std.testing.expectEqual(@as(usize, 3), attrAcc(primAt(d, 0, 2), "POSITION").count);
    try std.testing.expectEqual(@as(usize, 4), attrAcc(primAt(d, 0, 3), "POSITION").count);
    try std.testing.expect(primAt(d, 0, 2).indices == null);
}

test "weld: serialized output round-trips and is byte-stable" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/weld_join_target.glb");
    defer loaded.deinit();

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expect(res.removed_vertices > 0);

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    var p1 = try parseBytes(out);
    defer p1.deinit();

    // the writer GC drops the orphaned accessors/views: 4 prims,
    // A: pos/nrm/uv/idx, B: pos/nrm/uv/idx, C: pos/nrm/uv (no index),
    // D: pos/nrm/uv/idx = 15 accessors
    try std.testing.expectEqual(@as(usize, 15), p1.data.accessors_count);
    try std.testing.expectEqual(@as(usize, 15), p1.data.buffer_views_count);
    try std.testing.expectEqual(@as(usize, 2), p1.data.materials_count);

    var total_v: usize = 0;
    const m = &geom.sl(c.cgltf_mesh, p1.data.meshes, p1.data.meshes_count)[0];
    for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
        total_v += @intCast(attrAcc(p, "POSITION").count);
        if (p.indices) |ix| {
            const idx = try readIdx(aa, @ptrCast(ix));
            for (idx) |v| try std.testing.expect(v < attrAcc(p, "POSITION").count);
        }
    }
    try std.testing.expectEqual(@as(usize, 27), total_v);

    // idempotent writer, and a second weld run finds nothing to merge
    const out2 = try write_mod.serialize(aa, p1.data, out);
    try std.testing.expectEqualSlices(u8, out, out2);

    const again = try run(aa, p1.data, out, .{});
    try std.testing.expectEqual(@as(u32, 0), again.removed_vertices);
    try std.testing.expectEqual(@as(u32, 0), again.rewritten_prims);
    const out3 = try write_mod.serialize(aa, p1.data, out);
    try std.testing.expectEqualSlices(u8, out, out3);
}

test "weld: clean asset is left byte-identical" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();
    var arena2 = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena2.deinit();
    const aa2 = arena2.allocator();

    var fresh = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/box.glb");
    defer fresh.deinit();
    const reference = try write_mod.serialize(aa2, fresh.cdata, fresh.map);

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/box.glb");
    defer loaded.deinit();

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expectEqual(@as(u32, 0), res.removed_vertices);
    try std.testing.expectEqual(@as(u32, 0), res.rewritten_prims);
    try std.testing.expectEqual(loaded.cdata.accessors_count, loaded.cdata.accessors_count);

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    try std.testing.expectEqualSlices(u8, reference, out);
}

test "weld: tolerance snaps near-identical positions" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/weld_join_target.glb");
    defer loaded.deinit();

    // 1e-3 grid: exact duplicates still merge, nothing extra on this fixture
    const res = try run(aa, loaded.cdata, loaded.map, .{ .tolerance = 1e-3 });
    try std.testing.expectEqual(@as(u32, 4), res.removed_vertices);
    try std.testing.expectEqual(@as(u32, 2), res.rewritten_prims);
}
