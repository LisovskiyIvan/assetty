//! Mesh simplification via `meshopt_simplify` (index-only rewrite).
//!
//! Every indexed triangle primitive is simplified independently; the resulting
//! index list is written into a fresh accessor (+ buffer view) and the
//! primitive is repointed at it.  Vertex buffers are left untouched (unused
//! vertices are dropped later by the weld/compaction stages or by the writer's
//! reachability GC), and the original index accessor becomes unreachable.
//!
//! Non-triangle primitives (points / lines / strips) are skipped: meshoptimizer
//! only understands triangle lists.

const std = @import("std");
const c = @import("cgltf");
const mo = @import("meshopt");
const geom = @import("geom.zig");

pub const Options = struct {
    target_ratio: f32 = 0.5,
    /// max relative error, e.g. 1e-2 = 1%
    error_tolerance: f32 = 1e-3,
    aggressive: bool = false,
    lock_borders: bool = true,
    /// Seam-aware simplification: fold NORMAL/TEXCOORD_0 error into the cost.
    use_attributes: bool = false,
    /// Per-component weight of the normal stream (position weight is implicit).
    weight_normal: f32 = 1.0,
    /// Per-component weight of the TEXCOORD_0 stream.
    weight_uv: f32 = 1.0,
};

pub const Result = struct {
    /// triangles before
    before: u64 = 0,
    /// triangles after simplification
    after: u64 = 0,
};

// Shared cdata helpers (sl, ptrIndex, allocRaw, freeRaw, Pool, remapRefs,
// commitPools) live in geom.zig.

// ---------------------------------------------------------------------------
// simplify
// ---------------------------------------------------------------------------

fn primTriangles(p: *const c.cgltf_primitive) u64 {
    if (p.type != c.cgltf_primitive_type_triangles) return 0;
    if (@intFromPtr(p.indices) != 0) return p.indices.*.count / 3;
    const pos = c.cgltf_find_accessor(p, c.cgltf_attribute_type_position, 0);
    if (@intFromPtr(pos) == 0) return 0;
    return pos.*.count / 3;
}

/// Read a float accessor into a freshly allocated f32 buffer (dense, applies
/// sparse patches, honours byteStride / normalized types).
fn readFloats(a: std.mem.Allocator, acc: *const c.cgltf_accessor) !?[]f32 {
    const ncomp = c.cgltf_num_components(acc.type);
    const total: usize = acc.count * ncomp;
    if (total == 0) return null;
    const out = try a.alloc(f32, total);
    errdefer a.free(out);
    var acc2 = acc.*;
    if (acc2.stride == 0) acc2.stride = c.cgltf_calc_size(acc2.type, acc2.component_type);
    const got = c.cgltf_accessor_unpack_floats(&acc2, out.ptr, total);
    if (got < total) {
        a.free(out);
        return null;
    }
    return out[0..total];
}

/// Interleaved vertex data for `meshopt_simplifyWithAttributes`: one vertex per
/// stride, `float3` position first, then whichever of the attribute streams
/// exist (normal xyz, uv xy). `meshopt` wants positions and attributes as
/// separate pointers, so both point into this one buffer at their offsets.
const AttrStream = struct {
    data: []f32,
    /// bytes per vertex (position + attributes)
    stride: usize,
    /// attribute components per vertex (0 = nothing to weight)
    comps: usize,
    weights: [5]f32 = .{ 0, 0, 0, 0, 0 },

    fn attrs(self: AttrStream) [*]const f32 {
        return self.data.ptr + 3;
    }
};

/// Build the interleaved position+attribute stream for `p`. Returns null when
/// `use_attributes` is off, no attribute matches `vertex_count`, or the
/// attribute data cannot be unpacked — callers then use plain `meshopt_simplify`.
fn buildAttrStream(
    a: std.mem.Allocator,
    p: *const c.cgltf_primitive,
    positions: []const f32,
    vertex_count: usize,
    opts: Options,
) !?AttrStream {
    if (!opts.use_attributes) return null;

    const normal = c.cgltf_find_accessor(p, c.cgltf_attribute_type_normal, 0);
    const uv = c.cgltf_find_accessor(p, c.cgltf_attribute_type_texcoord, 0);

    const have_normal = @intFromPtr(normal) != 0 and
        normal.*.count == vertex_count and
        c.cgltf_num_components(normal.*.type) == 3;
    const have_uv = @intFromPtr(uv) != 0 and
        uv.*.count == vertex_count and
        c.cgltf_num_components(uv.*.type) == 2;
    const comps: usize = (if (have_normal) @as(usize, 3) else 0) + (if (have_uv) @as(usize, 2) else 0);
    if (comps == 0) return null;

    var normals: ?[]f32 = null;
    defer if (normals) |n| a.free(n);
    var uvs: ?[]f32 = null;
    defer if (uvs) |u| a.free(u);
    if (have_normal) normals = try readFloats(a, normal);
    if (have_uv) uvs = try readFloats(a, uv);
    // A stream that failed to unpack drops out; retry the decision without it.
    const n_ok = normals != null;
    const uv_ok = uvs != null;
    const used: usize = (if (n_ok) @as(usize, 3) else 0) + (if (uv_ok) @as(usize, 2) else 0);
    if (used == 0) return null;

    const stride_floats = 3 + used;
    const data = try a.alloc(f32, vertex_count * stride_floats);
    var weights: [5]f32 = .{ 0, 0, 0, 0, 0 };
    var w: usize = 0;
    if (n_ok) {
        weights[w..][0..3].* = .{ opts.weight_normal, opts.weight_normal, opts.weight_normal };
        w += 3;
    }
    if (uv_ok) {
        weights[w..][0..2].* = .{ opts.weight_uv, opts.weight_uv };
        w += 2;
    }
    for (0..vertex_count) |v| {
        const dst = data[v * stride_floats ..][0..stride_floats];
        @memcpy(dst[0..3], positions[v * 3 ..][0..3]);
        var o: usize = 3;
        if (n_ok) {
            const n = normals.?;
            @memcpy(dst[o..][0..3], n[v * 3 ..][0..3]);
            o += 3;
        }
        if (uv_ok) {
            const u = uvs.?;
            @memcpy(dst[o..][0..2], u[v * 2 ..][0..2]);
            o += 2;
        }
    }

    return .{
        .data = data,
        .stride = stride_floats * @sizeOf(f32),
        .comps = used,
        .weights = weights,
    };
}

const Rewrite = struct {
    prim: *c.cgltf_primitive,
    new_index: u32,
};

/// meshopt_simplify per primitive (triangles only), rewrite index accessors.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = file_bytes;
    var res: Result = .{};
    const base_acc_n: usize = data.accessors_count;

    var pool: geom.Pool = .{};
    defer pool.deinit(a);
    var rewrites: std.ArrayListUnmanaged(Rewrite) = .empty;
    defer rewrites.deinit(a);

    const ratio: f32 = std.math.clamp(opts.target_ratio, 0, 1);

    for (geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            const tris = primTriangles(p);
            res.before += tris;
            if (tris == 0 or @intFromPtr(p.indices) == 0) {
                res.after += tris;
                continue;
            }
            const pos = c.cgltf_find_accessor(p, c.cgltf_attribute_type_position, 0);
            if (@intFromPtr(pos) == 0) {
                res.after += tris;
                continue;
            }

            const idx = p.indices;
            const idx_n: usize = idx.*.count;
            const tri_n = idx_n / 3;
            if (tri_n < 2 or ratio >= 1) {
                res.after += tris;
                continue;
            }

            const positions = (try readFloats(a, pos)) orelse {
                res.after += tris;
                continue;
            };
            defer a.free(positions);
            const vertex_count: usize = pos.*.count;
            if (vertex_count == 0 or positions.len != vertex_count * 3) {
                res.after += tris;
                continue;
            }

            const indices = try a.alloc(u32, idx_n);
            defer a.free(indices);
            if (c.cgltf_accessor_unpack_indices(idx, indices.ptr, 4, idx_n) != idx_n) {
                res.after += tris;
                continue;
            }
            // meshopt requires every index to address the position array
            var in_range = true;
            for (indices) |i| {
                if (i >= vertex_count) {
                    in_range = false;
                    break;
                }
            }
            if (!in_range) {
                res.after += tris;
                continue;
            }

            var target: usize = @intFromFloat(@as(f64, @floatFromInt(idx_n)) * @as(f64, ratio));
            target -= target % 3;
            if (target < 3) target = 3;
            if (target >= idx_n) {
                res.after += tris;
                continue;
            }

            const dest = try a.alloc(u32, idx_n);
            defer a.free(dest);

            // Seam-aware path: fold normal/UV error into the collapse cost.
            // Without matching attributes this is null and plain simplify runs.
            const attr: ?AttrStream = try buildAttrStream(a, p, positions, vertex_count, opts);
            defer if (attr) |as| a.free(as.data);

            var flags: c_uint = 0;
            if (opts.lock_borders) flags |= @intCast(mo.meshopt_SimplifyLockBorder);
            // v0.25+ dropped the "aggressive" flag; the closest knob is pruning
            // fully disconnected components.
            if (opts.aggressive) flags |= @intCast(mo.meshopt_SimplifyPrune);

            var result_error: f32 = 0;
            const out_n = if (attr) |as| mo.meshopt_simplifyWithAttributes(
                dest.ptr,
                indices.ptr,
                idx_n,
                as.data.ptr,
                vertex_count,
                as.stride,
                as.attrs(),
                as.stride,
                as.weights[0..].ptr,
                as.comps,
                null,
                target,
                opts.error_tolerance,
                flags,
                &result_error,
            ) else mo.meshopt_simplify(
                dest.ptr,
                indices.ptr,
                idx_n,
                positions.ptr,
                vertex_count,
                12,
                target,
                opts.error_tolerance,
                flags,
                &result_error,
            );

            if (out_n < 3 or out_n >= idx_n) {
                // nothing useful came back: keep the original index buffer
                res.after += tris;
                continue;
            }

            var max_index: u32 = 0;
            for (dest[0..out_n]) |i| {
                if (i > max_index) max_index = i;
            }
            const wide = max_index > std.math.maxInt(u16);
            const comp_size: usize = if (wide) 4 else 2;
            const out_bytes = out_n * comp_size;

            const raw = geom.allocRaw(data, out_bytes) orelse return error.OutOfMemory;
            errdefer geom.freeRaw(data, raw);
            const out = raw[0..out_bytes];
            for (dest[0..out_n], 0..) |v, i| {
                if (wide) {
                    std.mem.writeInt(u32, out[i * 4 ..][0..4], v, .little);
                } else {
                    std.mem.writeInt(u16, out[i * 2 ..][0..2], @intCast(v), .little);
                }
            }

            var na = std.mem.zeroes(c.cgltf_accessor);
            na.component_type = if (wide) c.cgltf_component_type_r_32u else c.cgltf_component_type_r_16u;
            na.type = c.cgltf_type_scalar;
            na.count = out_n;
            na.stride = comp_size;
            na.offset = 0;

            var nv = std.mem.zeroes(c.cgltf_buffer_view);
            nv.buffer = if (data.buffers_count > 0) data.buffers else null;
            nv.offset = 0;
            nv.size = out_bytes;
            nv.stride = 0;
            nv.type = c.cgltf_buffer_view_type_indices;
            nv.data = raw;

            const new_index: u32 = @intCast(base_acc_n + pool.acc.items.len);
            try pool.view.append(a, nv);
            try pool.acc.append(a, na);
            try rewrites.append(a, .{ .prim = p, .new_index = new_index });

            res.after += out_n / 3;
        }
    }

    if (pool.acc.items.len != 0) {
        try geom.commitPools(data, &pool);
        for (rewrites.items) |r| r.prim.indices = data.accessors + r.new_index;
    }
    return res;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

const parse_mod = @import("../gltf/parse.zig");
const write_mod = @import("../gltf/write.zig");

fn countTriangles(data: *const c.cgltf_data) u64 {
    var tris: u64 = 0;
    for (geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            tris += primTriangles(p);
        }
    }
    return tris;
}

fn firstIndexAccessor(data: *const c.cgltf_data) ?*const c.cgltf_accessor {
    for (geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            if (@intFromPtr(p.indices) != 0) return p.indices;
        }
    }
    return null;
}

/// Run simplify, serialize, re-parse from a temp .glb and return the triangle
/// counts as they exist in the written file.
fn simplifyRoundTrip(comptime path: []const u8, tmp_name: []const u8, opts: Options) !struct { before: u64, after: u64, written: u64 } {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, path);
    defer loaded.deinit();

    const before = countTriangles(loaded.cdata);
    const res = try run(aa, loaded.cdata, loaded.map, opts);
    try std.testing.expectEqual(before, res.before);

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = tmp_name, .data = out });
    const out_path = try std.fmt.allocPrint(aa, ".zig-cache/tmp/{s}/{s}", .{ tmp.sub_path[0..], tmp_name });

    var re = try parse_mod.loadFile(std.testing.io, a, out_path);
    defer re.deinit();
    try std.testing.expectEqual(
        @as(c_uint, c.cgltf_result_success),
        @as(c_uint, c.cgltf_validate(re.cdata)),
    );

    const written = countTriangles(re.cdata);
    try std.testing.expectEqual(res.after, written);
    std.debug.print(
        "simplify {s}: tris {d} -> {d} (written {d})\n",
        .{ path, before, res.after, written },
    );

    // index accessors that survived must stay valid scalars
    if (firstIndexAccessor(re.cdata)) |idx| {
        try std.testing.expectEqual(@as(c.cgltf_type, c.cgltf_type_scalar), idx.type);
        try std.testing.expect(idx.component_type == c.cgltf_component_type_r_16u or
            idx.component_type == c.cgltf_component_type_r_32u);
        try std.testing.expect(idx.count % 3 == 0);
        // the rewritten index buffer must be reachable and long enough
        try std.testing.expect(@intFromPtr(idx.buffer_view) != 0);
        const comp: usize = if (idx.component_type == c.cgltf_component_type_r_16u) 2 else 4;
        try std.testing.expect(idx.buffer_view.*.size >= idx.count * comp);
        const pos = c.cgltf_find_accessor(&re.cdata.meshes[0].primitives[0], c.cgltf_attribute_type_position, 0);
        if (@intFromPtr(pos) != 0) {
            var max_idx: c.cgltf_size = 0;
            for (0..idx.count) |i| {
                const v = c.cgltf_accessor_read_index(idx, i);
                if (v > max_idx) max_idx = v;
            }
            try std.testing.expect(max_idx < pos.*.count);
        }
    }

    return .{ .before = before, .after = res.after, .written = written };
}

test "simplify: damaged helmet reaches the target ratio" {
    const a = std.testing.allocator;
    var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded.deinit();
    const total = countTriangles(loaded.cdata);
    try std.testing.expect(total > 1000);

    // default tolerance is deliberately strict (0.1% of extents); give the
    // simplifier enough rope to actually reach 50% like the CLI preset does.
    const r = try simplifyRoundTrip("test/fixtures/real/DamagedHelmet.glb", "simplify-helmet.glb", .{
        .target_ratio = 0.5,
        .error_tolerance = 10.0,
        .lock_borders = true,
    });

    const half: f64 = @as(f64, @floatFromInt(r.before)) * 0.5;
    const got: f64 = @floatFromInt(r.after);
    try std.testing.expect(got <= half * 1.10);
    try std.testing.expect(got >= half * 0.90);
    try std.testing.expectEqual(r.after, r.written);

    // lock-border keeps the mesh watertight: no index out of range, parse ok
    try std.testing.expect(r.after < r.before);
}

test "simplify: default tolerance is conservative but stable" {
    const r = try simplifyRoundTrip("test/fixtures/real/DamagedHelmet.glb", "simplify-helmet-strict.glb", .{
        .target_ratio = 0.5,
    });
    try std.testing.expect(r.after <= r.before);
    try std.testing.expectEqual(r.after, r.written);
}

test "simplify: box fixture does not crash below the minimum" {
    const r = try simplifyRoundTrip("test/fixtures/box.glb", "simplify-box.glb", .{
        .target_ratio = 0.5,
    });
    try std.testing.expect(r.before > 0);
    try std.testing.expect(r.after <= r.before);
    try std.testing.expectEqual(r.after, r.written);
}

test "simplify: attributes keep seams, helmet still reaches the target" {
    const r = try simplifyRoundTrip("test/fixtures/real/DamagedHelmet.glb", "simplify-helmet-attrs.glb", .{
        .target_ratio = 0.5,
        .error_tolerance = 10.0,
        .lock_borders = true,
        .use_attributes = true,
        .weight_normal = 2.0,
        .weight_uv = 1.0,
    });

    const half: f64 = @as(f64, @floatFromInt(r.before)) * 0.5;
    const got: f64 = @floatFromInt(r.after);
    try std.testing.expect(got <= half * 1.25);
    try std.testing.expect(got >= half * 0.75);
    try std.testing.expectEqual(r.after, r.written);
    try std.testing.expect(r.after < r.before);
}

test "simplify: use_attributes falls back when attributes are missing" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded.deinit();

    // Strip NORMAL/TEXCOORD_* in place: the primitives become positions-only,
    // which must route through plain meshopt_simplify without failing.
    var stripped = false;
    for (geom.sl(c.cgltf_mesh, loaded.cdata.meshes, loaded.cdata.meshes_count)) |*m| {
        for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            for (geom.sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                if (at.type == c.cgltf_attribute_type_normal or
                    at.type == c.cgltf_attribute_type_texcoord)
                {
                    at.type = c.cgltf_attribute_type_invalid;
                    stripped = true;
                }
            }
        }
    }
    try std.testing.expect(stripped);

    const before = countTriangles(loaded.cdata);
    const res = try run(aa, loaded.cdata, loaded.map, .{
        .target_ratio = 0.5,
        .error_tolerance = 10.0,
        .use_attributes = true,
    });
    try std.testing.expectEqual(before, res.before);
    try std.testing.expect(res.after < res.before);

    const half: f64 = @as(f64, @floatFromInt(before)) * 0.5;
    const got: f64 = @floatFromInt(res.after);
    try std.testing.expect(got <= half * 1.10);
    try std.testing.expect(got >= half * 0.90);
}

test "simplify: attribute weights stay close to plain simplify" {
    const plain = try simplifyRoundTrip("test/fixtures/real/DamagedHelmet.glb", "simplify-helmet-plain.glb", .{
        .target_ratio = 0.5,
        .error_tolerance = 10.0,
    });
    const attrs = try simplifyRoundTrip("test/fixtures/real/DamagedHelmet.glb", "simplify-helmet-weight.glb", .{
        .target_ratio = 0.5,
        .error_tolerance = 10.0,
        .use_attributes = true,
        .weight_normal = 2.0,
        .weight_uv = 0.5,
    });

    try std.testing.expectEqual(plain.before, attrs.before);
    // Weights change the collapse order, not the target: both runs must land
    // inside the same ballpark.
    const p: f64 = @floatFromInt(plain.after);
    const g: f64 = @floatFromInt(attrs.after);
    try std.testing.expect(g <= p * 1.25);
    try std.testing.expect(g >= p * 0.75);
}
