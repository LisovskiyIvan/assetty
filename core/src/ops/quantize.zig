//! Vertex attribute quantization (in-place accessor rewrite, meshoptimizer-flavoured).
//!
//! Positions and UVs become normalized `UNSIGNED_SHORT` attributes, normals and
//! tangents become normalized `SHORT` (snorm) attributes.  Every rewritten
//! attribute gets a fresh accessor + buffer view; the original accessors are
//! left in the pool and dropped by the writer's reachability GC on output.
//!
//! Caveat / design note: core glTF (without `KHR_mesh_quantization`) requires
//! float vertex attributes, and a normalized integer attribute cannot carry the
//! original value range on its own.  We therefore keep the *original* float
//! POSITION `min`/`max` on the accessor and store the quantized values as
//! normalized codes (range-relative to those bounds).  A renderer needs the
//! `min`/`max` to dequantize, which is exactly the contract that a future
//! `KHR_mesh_quantization` / `EXT_meshopt_compression` step will formalize.
//!
//! `normal_oct` is accepted for API stability: octahedral encoding would require
//! emitting NORMAL as a 2-component attribute, which core glTF forbids, so we
//! emit plain 15-bit SNORM VEC3/VEC4 instead.

const std = @import("std");
const c = @import("cgltf");
const mo = @import("meshopt");

pub const Options = struct {
    position_bits: u5 = 14,
    uv_bits: u5 = 12,
    normal_oct: bool = true,
    /// quantize in place: rewrite accessors as normalized u16/u8 (valid core
    /// glTF, no EXT_meshopt_compression yet)
    in_place: bool = true,
};

pub const Result = struct {
    quantized_positions: u32 = 0,
    quantized_uvs: u32 = 0,
    quantized_normals: u32 = 0,
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

fn numComponents(t: c.cgltf_type) usize {
    return switch (t) {
        1 => 1,
        2 => 2,
        3 => 3,
        4 => 4,
        5 => 4,
        6 => 9,
        7 => 16,
        else => 1,
    };
}

/// Allocate raw bytes through cgltf's allocator hooks, so that `cgltf_free`
/// (which releases `buffer_view.data` with the same hooks) stays balanced.
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

/// Rewrite every accessor / buffer-view reference so that it points into the
/// regrown pools.  `new_acc` holds copies of the old entries at the same
/// indices (appended entries last), same for `new_view`.
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
    // accessors themselves reference buffer views (incl. sparse storage)
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

/// Grow both pools by the appended entries and remap every reference.
/// The old pool arrays are released through cgltf's hooks; their string /
/// extras pointers live on in the copied entries, so nothing is double-freed
/// (`cgltf_free` only walks the arrays currently registered in `data`).
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

    // pool counts are already updated below, remapRefs needs the *new* count
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

    // old arrays only held copies now: release them
    if (pool.acc.items.len != 0 and @intFromPtr(old_acc) != 0) freeRaw(data, old_acc);
    if (pool.view.items.len != 0 and @intFromPtr(old_view) != 0) freeRaw(data, old_view);
}

// ---------------------------------------------------------------------------
// quantization
// ---------------------------------------------------------------------------

const Kind = enum { position, texcoord, normal, tangent };

fn expectedComponents(kind: Kind) usize {
    return switch (kind) {
        .position, .normal => 3,
        .texcoord => 2,
        .tangent => 4,
    };
}

const Built = struct {
    acc: c.cgltf_accessor,
    view: c.cgltf_buffer_view,
};

fn clamp01(v: f32) f32 {
    return if (v < 0) 0 else if (v > 1) 1 else v;
}

fn clampSnorm(v: f32) f32 {
    return if (v < -1) -1 else if (v > 1) 1 else v;
}

/// Build the quantized accessor + buffer view for one source accessor.
fn build(a: std.mem.Allocator, data: *const c.cgltf_data, kind: Kind, acc: [*c]const c.cgltf_accessor, opts: Options) !?Built {
    const src = acc.*;
    const ncomp = numComponents(src.type);
    if (ncomp != expectedComponents(kind)) return null;
    const count: usize = src.count;
    if (count == 0) return null;

    const total = count * ncomp;
    const tmp = try a.alloc(f32, total);
    defer a.free(tmp);

    var acc2 = src;
    if (acc2.stride == 0) acc2.stride = c.cgltf_calc_size(acc2.type, acc2.component_type);
    const got = c.cgltf_accessor_unpack_floats(&acc2, tmp.ptr, total);
    if (got < total) return null;

    // per-component bounds of the *source* data
    var mn = [_]f32{ 0, 0, 0, 0 };
    var mx = [_]f32{ 0, 0, 0, 0 };
    for (0..ncomp) |k| {
        mn[k] = tmp[k];
        mx[k] = tmp[k];
    }
    var e: usize = 1;
    while (e < count) : (e += 1) {
        for (0..ncomp) |k| {
            const v = tmp[e * ncomp + k];
            if (v < mn[k]) mn[k] = v;
            if (v > mx[k]) mx[k] = v;
        }
    }

    const out_bytes = count * ncomp * 2;
    const raw = allocRaw(data, out_bytes) orelse return error.OutOfMemory;
    errdefer freeRaw(data, raw);
    const out = raw[0..out_bytes];

    const signed = kind == .normal or kind == .tangent;
    if (signed) {
        // snorm16: 15 usable bits, tangent w is +-1 so it maps to +-32767 exactly
        for (0..count) |e2| {
            for (0..ncomp) |k| {
                const v = clampSnorm(tmp[e2 * ncomp + k]);
                const q: i16 = @intFromFloat(@round(v * 32767.0));
                std.mem.writeInt(i16, out[(e2 * ncomp + k) * 2 ..][0..2], q, .little);
            }
        }
    } else {
        const req_bits: u5 = if (kind == .position) opts.position_bits else opts.uv_bits;
        const bits: u5 = @intCast(std.math.clamp(@as(u32, req_bits), 1, 16));
        const levels: f32 = @floatFromInt((@as(u32, 1) << bits) - 1);
        for (0..count) |e2| {
            for (0..ncomp) |k| {
                const range = mx[k] - mn[k];
                const t = if (range > 0) clamp01((tmp[e2 * ncomp + k] - mn[k]) / range) else 0;
                // N-bit code first (position_bits / uv_bits precision), then
                // rescaled into the full UNORM16 range of the stored attribute
                const code: f32 = @round(t * levels);
                const full: f32 = @round(code / levels * 65535.0);
                const q: u16 = @intFromFloat(@max(0, @min(65535, full)));
                std.mem.writeInt(u16, out[(e2 * ncomp + k) * 2 ..][0..2], q, .little);
            }
        }
    }

    var na = std.mem.zeroes(c.cgltf_accessor);
    na.component_type = if (signed) c.cgltf_component_type_r_16 else c.cgltf_component_type_r_16u;
    na.normalized = 1;
    na.type = src.type;
    na.count = src.count;
    na.stride = out_bytes / count;
    na.offset = 0;
    if (kind == .position) {
        // POSITION must carry min/max: keep the pre-quantization float bounds
        na.has_min = 1;
        na.has_max = 1;
        for (0..ncomp) |k| {
            na.min[k] = mn[k];
            na.max[k] = mx[k];
        }
    }

    const buffer: [*c]c.cgltf_buffer = if (data.buffers_count > 0) data.buffers else null;
    var nv = std.mem.zeroes(c.cgltf_buffer_view);
    nv.buffer = buffer;
    nv.offset = 0;
    nv.size = out_bytes;
    nv.stride = 0;
    nv.type = c.cgltf_buffer_view_type_vertices;
    nv.data = raw;

    return Built{ .acc = na, .view = nv };
}

fn kindOf(at: *const c.cgltf_attribute) ?Kind {
    return switch (at.type) {
        1 => .position,
        2 => .normal,
        3 => .tangent,
        4 => .texcoord,
        else => null,
    };
}

const Rewrite = struct {
    at: *c.cgltf_attribute,
    new_index: u32,
};

pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = file_bytes;
    // `in_place` is the only supported mode for now (accessor rewrite);
    // the flag is kept for API stability.
    _ = opts.in_place;

    var res: Result = .{};
    const base_acc_n: usize = data.accessors_count;

    // original accessor index -> new accessor index
    const mapping = try a.alloc(?u32, base_acc_n);
    defer a.free(mapping);
    @memset(mapping, null);

    var pool: Pool = .{};
    defer pool.deinit(a);
    var rewrites: std.ArrayListUnmanaged(Rewrite) = .empty;
    defer rewrites.deinit(a);

    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            // vertex-only attribute rewrite; morph targets keep their floats
            for (sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                const kind = kindOf(at) orelse continue;
                const old_index = ptrIndex(c.cgltf_accessor, data.accessors, base_acc_n, at.data) orelse continue;
                if (mapping[old_index] == null) {
                    const built = try build(a, data, kind, data.accessors + old_index, opts);
                    if (built) |b| {
                        const new_index: u32 = @intCast(base_acc_n + pool.acc.items.len);
                        try pool.view.append(a, b.view);
                        try pool.acc.append(a, b.acc);
                        mapping[old_index] = new_index;
                        switch (kind) {
                            .position => res.quantized_positions += 1,
                            .texcoord => res.quantized_uvs += 1,
                            .normal, .tangent => res.quantized_normals += 1,
                        }
                    }
                }
                if (mapping[old_index]) |ni| {
                    try rewrites.append(a, .{ .at = at, .new_index = ni });
                }
            }
        }
    }

    if (pool.acc.items.len == 0) return res;

    try commitPools(data, &pool);

    // point the rewritten attributes at their new accessors
    for (rewrites.items) |r| {
        r.at.data = data.accessors + r.new_index;
    }

    // normalized integer POSITION/UV attributes require KHR_mesh_quantization
    if (res.quantized_positions > 0 or res.quantized_uvs > 0 or res.quantized_normals > 0) {
        try ensureExtension(data, "KHR_mesh_quantization", true);
        try ensureExtension(data, "KHR_mesh_quantization", false);
    }
    return res;
}

/// append `name` to extensions_used (required=true) or extensions_required;
/// strings and the grown array are cgltf-memory owned (cgltf_free frees them)
fn ensureExtension(data: *c.cgltf_data, name: []const u8, required: bool) !void {
    const mem = data.memory;
    const count_ptr = if (required) &data.extensions_required_count else &data.extensions_used_count;
    const list_ptr = if (required) &data.extensions_required else &data.extensions_used;

    var old_list: [*][*c]u8 = undefined;
    var old_n: usize = 0;
    if (@intFromPtr(list_ptr.*) != 0) {
        old_list = @ptrCast(@alignCast(list_ptr.*));
        old_n = @intCast(count_ptr.*);
    }
    var i: usize = 0;
    while (i < old_n) : (i += 1) {
        const s = std.mem.span(old_list[i]);
        if (std.mem.eql(u8, s, name)) return;
    }

    const new_n = old_n + 1;
    const allocf = mem.alloc_func orelse return error.OutOfMemory;
    const new_list_raw = allocf(mem.user_data, new_n * @sizeOf([*c]u8)) orelse return error.OutOfMemory;
    const new_list: [*][*c]u8 = @ptrCast(@alignCast(new_list_raw));
    if (old_n > 0) @memcpy(new_list[0..old_n], old_list[0..old_n]);

    const s_raw = allocf(mem.user_data, name.len + 1) orelse return error.OutOfMemory;
    const s: [*]u8 = @ptrCast(s_raw);
    @memcpy(s[0..name.len], name);
    s[name.len] = 0;
    new_list[old_n] = @ptrCast(s);

    // release the old array (the strings it pointed at are owned individually)
    if (old_n > 0) {
        if (mem.free_func) |ff| ff(mem.user_data, @ptrCast(list_ptr.*));
    }
    list_ptr.* = @ptrCast(new_list);
    count_ptr.* = new_n;
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
            if (p.type != c.cgltf_primitive_type_triangles) continue;
            if (@intFromPtr(p.indices) != 0) {
                tris += p.indices.*.count / 3;
            } else {
                const pos = c.cgltf_find_accessor(p, c.cgltf_attribute_type_position, 0);
                if (@intFromPtr(pos) != 0) tris += pos.*.count / 3;
            }
        }
    }
    return tris;
}

fn firstAttrAcc(data: *const c.cgltf_data, kind: c_int) ?*const c.cgltf_accessor {
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            for (sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                if (at.type != kind) continue;
                if (@intFromPtr(at.data) == 0) continue;
                return at.data;
            }
        }
    }
    return null;
}

fn quantizeRoundTrip(comptime path: []const u8, tmp_name: []const u8) !void {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, path);
    defer loaded.deinit();

    const tris_before = countTriangles(loaded.cdata);
    const pos_before = firstAttrAcc(loaded.cdata, c.cgltf_attribute_type_position) orelse return error.NoPosition;
    const min_before = pos_before.min;
    const max_before = pos_before.max;
    const has_bounds = pos_before.has_min != 0 and pos_before.has_max != 0;

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expect(res.quantized_positions > 0);
    try std.testing.expect(res.quantized_uvs > 0);
    try std.testing.expect(res.quantized_normals > 0);
    std.debug.print(
        "quantize {s}: pos={d} uv={d} nrm={d} tris={d}\n",
        .{ path, res.quantized_positions, res.quantized_uvs, res.quantized_normals, tris_before },
    );

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

    try std.testing.expectEqual(tris_before, countTriangles(re.cdata));

    const pos_after = firstAttrAcc(re.cdata, c.cgltf_attribute_type_position) orelse return error.NoPosition;
    try std.testing.expectEqual(@as(c.cgltf_component_type, c.cgltf_component_type_r_16u), pos_after.component_type);
    try std.testing.expect(pos_after.normalized != 0);
    try std.testing.expectEqual(@as(c.cgltf_type, c.cgltf_type_vec3), pos_after.type);
    // the quantized data must actually be reachable (buffer view + bytes)
    try std.testing.expect(@intFromPtr(pos_after.buffer_view) != 0);
    try std.testing.expect(pos_after.buffer_view.*.size >= pos_after.count * 6);
    try std.testing.expect(@intFromPtr(c.cgltf_buffer_view_data(pos_after.buffer_view)) != 0);
    try std.testing.expect(pos_after.has_min != 0 and pos_after.has_max != 0);
    if (has_bounds) {
        for (0..3) |k| {
            try std.testing.expectApproxEqRel(min_before[k], pos_after.min[k], 1e-5);
            try std.testing.expectApproxEqRel(max_before[k], pos_after.max[k], 1e-5);
        }
    }

    const uv_after = firstAttrAcc(re.cdata, c.cgltf_attribute_type_texcoord) orelse return error.NoUv;
    try std.testing.expectEqual(@as(c.cgltf_component_type, c.cgltf_component_type_r_16u), uv_after.component_type);
    try std.testing.expect(uv_after.normalized != 0);
    try std.testing.expectEqual(@as(c.cgltf_type, c.cgltf_type_vec2), uv_after.type);

    const n_after = firstAttrAcc(re.cdata, c.cgltf_attribute_type_normal) orelse return error.NoNormal;
    try std.testing.expectEqual(@as(c.cgltf_component_type, c.cgltf_component_type_r_16), n_after.component_type);
    try std.testing.expect(n_after.normalized != 0);
    try std.testing.expectEqual(@as(c.cgltf_type, c.cgltf_type_vec3), n_after.type);

    // the model-level view still matches (attributes survive the writer)
    for (re.asset.meshes) |m| {
        for (m.primitives) |p| {
            try std.testing.expect(p.attributes.len > 0);
        }
    }
}

test "quantize: damaged helmet becomes normalized u16/s16" {
    try quantizeRoundTrip("test/fixtures/real/DamagedHelmet.glb", "quantize-helmet.glb");
}

test "quantize: box fixture round-trips" {
    try quantizeRoundTrip("test/fixtures/box.glb", "quantize-box.glb");
}

test "quantize declares KHR_mesh_quantization" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const al = arena.allocator();
    var loaded = try parse_mod.loadFile(std.testing.io, al, "test/fixtures/box.glb");
    defer loaded.deinit();
    const res = try run(al, loaded.cdata, loaded.map, .{});
    try std.testing.expect(res.quantized_positions > 0);
    var found_used = false;
    var found_req = false;
    for (loaded.cdata.extensions_used[0..loaded.cdata.extensions_used_count]) |e| {
        if (std.mem.eql(u8, std.mem.span(e), "KHR_mesh_quantization")) found_used = true;
    }
    for (loaded.cdata.extensions_required[0..loaded.cdata.extensions_required_count]) |e| {
        if (std.mem.eql(u8, std.mem.span(e), "KHR_mesh_quantization")) found_req = true;
    }
    try std.testing.expect(found_used);
    try std.testing.expect(found_req);
}
