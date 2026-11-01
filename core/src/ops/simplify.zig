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

pub const Options = struct {
    target_ratio: f32 = 0.5,
    /// max relative error, e.g. 1e-2 = 1%
    error_tolerance: f32 = 1e-3,
    aggressive: bool = false,
    lock_borders: bool = true,
};

pub const Result = struct {
    /// triangles before
    before: u64 = 0,
    /// triangles after simplification
    after: u64 = 0,
};

// ---------------------------------------------------------------------------
// cgltf helpers (local copies; gltf/write.zig has the same private helpers)
// ---------------------------------------------------------------------------

fn sl(comptime T: type, ptr: [*c]T, n: usize) []T {
    if (n == 0 or @intFromPtr(ptr) == 0) return &.{};
    return ptr[0..n];
}

fn ptrIndex(comptime T: type, base: [*c]T, count: usize, p: [*c]T) ?u32 {
    if (count == 0 or @intFromPtr(base) == 0 or @intFromPtr(p) == 0) return null;
    const b: usize = @intFromPtr(base);
    const q: usize = @intFromPtr(p);
    if (q < b) return null;
    const off = q - b;
    if (off % @sizeOf(T) != 0) return null;
    const i = off / @sizeOf(T);
    if (i >= count) return null;
    return @intCast(i);
}

/// Allocate raw bytes through cgltf's allocator hooks, so `cgltf_free`
/// (which releases `buffer_view.data` through them) stays balanced.
fn allocRaw(data: *const c.cgltf_data, n: usize) ?[*]u8 {
    const mem = data.memory;
    if (mem.alloc_func) |f| {
        const p = f(mem.user_data, n) orelse return null;
        return @ptrCast(p);
    }
    const p = std.c.malloc(n) orelse return null;
    return @ptrCast(p);
}

fn freeRaw(data: *const c.cgltf_data, p: anytype) void {
    const mem = data.memory;
    if (mem.free_func) |f| {
        f(mem.user_data, @ptrCast(@constCast(p)));
    } else {
        std.c.free(@ptrCast(@constCast(p)));
    }
}

// ---------------------------------------------------------------------------
// pool regrow + pointer remap
//
// TODO(geom.Builder): this belongs in core/src/ops/geom.zig once that lands
// (shared pool-regrow helper).  Kept private here to stay decoupled.
// ---------------------------------------------------------------------------

const Pool = struct {
    acc: std.ArrayListUnmanaged(c.cgltf_accessor) = .empty,
    view: std.ArrayListUnmanaged(c.cgltf_buffer_view) = .empty,

    fn deinit(self: *Pool, a: std.mem.Allocator) void {
        self.acc.deinit(a);
        self.view.deinit(a);
    }
};

fn remapAcc(
    p: [*c]c.cgltf_accessor,
    old_base: [*c]c.cgltf_accessor,
    old_n: usize,
    new_base: [*c]c.cgltf_accessor,
) [*c]c.cgltf_accessor {
    const i = ptrIndex(c.cgltf_accessor, old_base, old_n, p) orelse return p;
    return new_base + i;
}

fn remapView(
    p: [*c]c.cgltf_buffer_view,
    old_base: [*c]c.cgltf_buffer_view,
    old_n: usize,
    new_base: [*c]c.cgltf_buffer_view,
) [*c]c.cgltf_buffer_view {
    const i = ptrIndex(c.cgltf_buffer_view, old_base, old_n, p) orelse return p;
    return new_base + i;
}

fn remapRefs(
    data: *c.cgltf_data,
    old_acc: [*c]c.cgltf_accessor,
    old_acc_n: usize,
    new_acc: [*c]c.cgltf_accessor,
    old_view: [*c]c.cgltf_buffer_view,
    old_view_n: usize,
    new_view: [*c]c.cgltf_buffer_view,
) void {
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            p.indices = remapAcc(p.indices, old_acc, old_acc_n, new_acc);
            for (sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                at.data = remapAcc(at.data, old_acc, old_acc_n, new_acc);
            }
            for (sl(c.cgltf_morph_target, p.targets, p.targets_count)) |*t| {
                for (sl(c.cgltf_attribute, t.attributes, t.attributes_count)) |*at| {
                    at.data = remapAcc(at.data, old_acc, old_acc_n, new_acc);
                }
            }
            if (@intFromPtr(p.draco_mesh_compression.buffer_view) != 0) {
                p.draco_mesh_compression.buffer_view = remapView(
                    p.draco_mesh_compression.buffer_view,
                    old_view,
                    old_view_n,
                    new_view,
                );
            }
            for (sl(c.cgltf_attribute, p.draco_mesh_compression.attributes, p.draco_mesh_compression.attributes_count)) |*at| {
                at.data = remapAcc(at.data, old_acc, old_acc_n, new_acc);
            }
        }
    }
    for (sl(c.cgltf_animation, data.animations, data.animations_count)) |*an| {
        for (sl(c.cgltf_animation_sampler, an.samplers, an.samplers_count)) |*s| {
            s.input = remapAcc(s.input, old_acc, old_acc_n, new_acc);
            s.output = remapAcc(s.output, old_acc, old_acc_n, new_acc);
        }
    }
    for (sl(c.cgltf_skin, data.skins, data.skins_count)) |*sk| {
        sk.inverse_bind_matrices = remapAcc(sk.inverse_bind_matrices, old_acc, old_acc_n, new_acc);
    }
    for (sl(c.cgltf_accessor, new_acc, data.accessors_count)) |*acc| {
        acc.buffer_view = remapView(acc.buffer_view, old_view, old_view_n, new_view);
        if (acc.is_sparse != 0) {
            acc.sparse.indices_buffer_view = remapView(
                acc.sparse.indices_buffer_view,
                old_view,
                old_view_n,
                new_view,
            );
            acc.sparse.values_buffer_view = remapView(
                acc.sparse.values_buffer_view,
                old_view,
                old_view_n,
                new_view,
            );
        }
    }
    for (sl(c.cgltf_image, data.images, data.images_count)) |*im| {
        im.buffer_view = remapView(im.buffer_view, old_view, old_view_n, new_view);
    }
}

fn commitPools(data: *c.cgltf_data, pool: *Pool) !void {
    const old_acc = data.accessors;
    const old_acc_n: usize = data.accessors_count;
    const old_view = data.buffer_views;
    const old_view_n: usize = data.buffer_views_count;

    const new_acc_n = old_acc_n + pool.acc.items.len;
    const new_view_n = old_view_n + pool.view.items.len;
    if (new_acc_n == old_acc_n and new_view_n == old_view_n) return;

    var new_acc: [*c]c.cgltf_accessor = old_acc;
    var new_view: [*c]c.cgltf_buffer_view = old_view;

    if (pool.acc.items.len != 0) {
        const bytes = allocRaw(data, new_acc_n * @sizeOf(c.cgltf_accessor)) orelse return error.OutOfMemory;
        new_acc = @ptrCast(@alignCast(bytes));
        if (old_acc_n != 0) @memcpy(new_acc[0..old_acc_n], old_acc[0..old_acc_n]);
        @memcpy(new_acc[old_acc_n..new_acc_n], pool.acc.items);
    }
    errdefer if (pool.acc.items.len != 0) freeRaw(data, new_acc);

    if (pool.view.items.len != 0) {
        const bytes = allocRaw(data, new_view_n * @sizeOf(c.cgltf_buffer_view)) orelse return error.OutOfMemory;
        new_view = @ptrCast(@alignCast(bytes));
        if (old_view_n != 0) @memcpy(new_view[0..old_view_n], old_view[0..old_view_n]);
        @memcpy(new_view[old_view_n..new_view_n], pool.view.items);
    }
    errdefer if (pool.view.items.len != 0) freeRaw(data, new_view);

    data.accessors = new_acc;
    data.accessors_count = new_acc_n;
    data.buffer_views = new_view;
    data.buffer_views_count = new_view_n;

    remapRefs(data, old_acc, old_acc_n, new_acc, old_view, old_view_n, new_view);

    // appended entries are paired 1:1 (each new accessor owns one new view);
    // wire them up now that the final array addresses are known
    std.debug.assert(pool.acc.items.len == pool.view.items.len);
    for (0..pool.acc.items.len) |k| {
        data.accessors[old_acc_n + k].buffer_view = data.buffer_views + (old_view_n + k);
    }

    if (pool.acc.items.len != 0 and @intFromPtr(old_acc) != 0) freeRaw(data, old_acc);
    if (pool.view.items.len != 0 and @intFromPtr(old_view) != 0) freeRaw(data, old_view);
}

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

const Rewrite = struct {
    prim: *c.cgltf_primitive,
    new_index: u32,
};

/// meshopt_simplify per primitive (triangles only), rewrite index accessors.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = file_bytes;
    var res: Result = .{};
    const base_acc_n: usize = data.accessors_count;

    var pool: Pool = .{};
    defer pool.deinit(a);
    var rewrites: std.ArrayListUnmanaged(Rewrite) = .empty;
    defer rewrites.deinit(a);

    const ratio: f32 = std.math.clamp(opts.target_ratio, 0, 1);

    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
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

            var flags: c_uint = 0;
            if (opts.lock_borders) flags |= @intCast(mo.meshopt_SimplifyLockBorder);
            // v0.25+ dropped the "aggressive" flag; the closest knob is pruning
            // fully disconnected components.
            if (opts.aggressive) flags |= @intCast(mo.meshopt_SimplifyPrune);

            var result_error: f32 = 0;
            const out_n = mo.meshopt_simplify(
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

            const raw = allocRaw(data, out_bytes) orelse return error.OutOfMemory;
            errdefer freeRaw(data, raw);
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
        try commitPools(data, &pool);
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
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            tris += primTriangles(p);
        }
    }
    return tris;
}

fn firstIndexAccessor(data: *const c.cgltf_data) ?*const c.cgltf_accessor {
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
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
