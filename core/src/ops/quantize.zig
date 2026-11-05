//! Vertex attribute quantization (in-place accessor rewrite, meshoptimizer-flavoured).
//!
//! Positions and UVs become normalized `UNSIGNED_SHORT` attributes, normals and
//! tangents become normalized `SHORT` (snorm) attributes.  Every rewritten
//! attribute gets a fresh accessor + buffer view; the original accessors are
//! left in the pool and dropped by the writer's reachability GC on output.
//!
//! # Dequantization is baked into the node graph (gltfpack-style)
//!
//! A normalized integer POSITION accessor decodes to `code / 65535`, so the
//! decoded range is always `[0, 1]` no matter what `min`/`max` claim.  The
//! glTF spec forbids a renderer from dequantizing through the accessor bounds,
//! so keeping them is not a fix: the model collapses to a unit cube.  The
//! missing offset/scale has to be supplied by the node transform instead.
//!
//! For every node that references a position-quantized mesh we bake exactly
//! that map into the node TRS (`v` = original mesh-space position):
//!
//!     q = (v - mn) / (mx - mn)             // what the accessor stores
//!     node' = node * T(mn) * S(mx - mn)    // so node' * q == node * v
//!     translation' = translation + R(rotation) * (scale ⊙ mn)
//!     scale'       = scale ⊙ (mx - mn)     // per component, 0-range axis -> 1
//!     rotation     unchanged
//!
//! Nodes with a MATRIX transform cannot be rewritten without changing what
//! their matrix means, so their meshes keep float POSITION accessors.  Skinned
//! meshes are joint-driven (the node transform is ignored by the shader) and
//! morph targets store offsets in mesh space, so those keep floats too.
//!
//! `min`/`max` on a quantized POSITION accessor keep the ORIGINAL float bounds
//! (gltfpack convention: viewers use them as the mesh-space bbox even though
//! the payload is normalized).
//!
//! A mesh referenced by several nodes is duplicated (one mesh per node, shallow
//! primitive copies on the first mesh and a deep clone for the rest) so every
//! node carries exactly one baked dequant transform.  When a mesh's primitives
//! have different position bounds the mesh is split, one mesh per distinct
//! bounds group, with a sibling node per extra group (a *child* node would be
//! transformed twice).
//!
//! `normal_oct` is accepted for API stability: octahedral encoding would require
//! emitting NORMAL as a 2-component attribute, which core glTF forbids, so we
//! emit plain 15-bit SNORM VEC3/VEC4 instead. (With `meshopt_compression` the
//! oct path still happens — inside EXT_meshopt_compression views with the
//! OCTAHEDRAL filter, where the extension spec explicitly allows it.)

const std = @import("std");
const c = @import("cgltf");
const mo = @import("meshopt");
const mc = @import("meshopt.zig");

pub const Options = struct {
    position_bits: u5 = 14,
    uv_bits: u5 = 12,
    normal_oct: bool = true,
    /// quantize in place: rewrite accessors as normalized u16/u8 (valid core
    /// glTF, no EXT_meshopt_compression yet)
    in_place: bool = true,
    /// EXT_meshopt_compression (gltfpack-style `-cc`): meshopt-compress every
    /// eligible vertex/index buffer view (quantized or not) and mark it with
    /// the extension. Output requires an EXT_meshopt_compression-capable
    /// loader (registered in extensionsUsed + extensionsRequired). Needs the
    /// codec objects linked (see ops/meshopt.zig); without them the flag is a
    /// loud no-op (Result.meshopt_no_codec) and the output stays plain glTF.
    meshopt_compression: bool = false,
};

pub const Result = struct {
    quantized_positions: u32 = 0,
    quantized_uvs: u32 = 0,
    quantized_normals: u32 = 0,
    /// nodes whose TRS got a dequant map baked in
    dequantized_nodes: u32 = 0,
    /// buffer views carrying EXT_meshopt_compression
    meshopt_views: u32 = 0,
    /// meshopt requested but the codec objects are not linked
    meshopt_no_codec: bool = false,
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

/// Allocate an array owned by cgltf (freed by `cgltf_free` with its hooks).
fn cgltfAllocSlice(comptime T: type, data: *const c.cgltf_data, n: usize) ![*c]T {
    if (n == 0) return null;
    const bytes = allocRaw(data, n * @sizeOf(T)) orelse return error.OutOfMemory;
    return @ptrCast(@alignCast(bytes));
}

fn dupStr(data: *const c.cgltf_data, s: [*c]const u8) ![*c]u8 {
    const src = std.mem.span(s);
    const raw = allocRaw(data, src.len + 1) orelse return error.OutOfMemory;
    @memcpy(raw[0..src.len], src);
    raw[src.len] = 0;
    return @ptrCast(raw);
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
// mesh / node pool growth
// ---------------------------------------------------------------------------

fn commitMeshes(data: *c.cgltf_data, extra: []const c.cgltf_mesh) !void {
    if (extra.len == 0) return;
    const old = data.meshes;
    const old_n: usize = data.meshes_count;
    const n = old_n + extra.len;
    const bytes = allocRaw(data, n * @sizeOf(c.cgltf_mesh)) orelse return error.OutOfMemory;
    const new: [*c]c.cgltf_mesh = @ptrCast(@alignCast(bytes));
    if (old_n != 0) @memcpy(new[0..old_n], old[0..old_n]);
    @memcpy(new[old_n..n], extra);

    // meshes are only referenced from nodes
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*nd| {
        if (ptrIndex(c.cgltf_mesh, old, old_n, nd.mesh)) |i| nd.mesh = new + i;
    }

    data.meshes = new;
    data.meshes_count = n;
    if (old_n != 0 and @intFromPtr(old) != 0) freeRaw(data, old);
}

fn remapNodePtr(
    slot: *[*c]c.cgltf_node,
    old: [*c]c.cgltf_node,
    old_n: usize,
    new: [*c]c.cgltf_node,
) void {
    if (ptrIndex(c.cgltf_node, old, old_n, slot.*)) |i| slot.* = new + i;
}

fn commitNodes(data: *c.cgltf_data, extra: []const c.cgltf_node) !void {
    if (extra.len == 0) return;
    const old = data.nodes;
    const old_n: usize = data.nodes_count;
    const n = old_n + extra.len;
    const bytes = allocRaw(data, n * @sizeOf(c.cgltf_node)) orelse return error.OutOfMemory;
    const new: [*c]c.cgltf_node = @ptrCast(@alignCast(bytes));
    if (old_n != 0) @memcpy(new[0..old_n], old[0..old_n]);
    @memcpy(new[old_n..n], extra);

    data.nodes = new;
    data.nodes_count = n;

    for (sl(c.cgltf_node, new, n)) |*nd| {
        remapNodePtr(&nd.parent, old, old_n, new);
        for (sl([*c]c.cgltf_node, nd.children, nd.children_count)) |*cp| {
            remapNodePtr(cp, old, old_n, new);
        }
    }
    for (sl(c.cgltf_scene, data.scenes, data.scenes_count)) |*s| {
        for (sl([*c]c.cgltf_node, s.nodes, s.nodes_count)) |*cp| {
            remapNodePtr(cp, old, old_n, new);
        }
    }
    for (sl(c.cgltf_skin, data.skins, data.skins_count)) |*sk| {
        remapNodePtr(&sk.skeleton, old, old_n, new);
        for (sl([*c]c.cgltf_node, sk.joints, sk.joints_count)) |*jp| {
            remapNodePtr(jp, old, old_n, new);
        }
    }
    for (sl(c.cgltf_animation, data.animations, data.animations_count)) |*an| {
        for (sl(c.cgltf_animation_channel, an.channels, an.channels_count)) |*ch| {
            remapNodePtr(&ch.target_node, old, old_n, new);
        }
    }

    if (old_n != 0 and @intFromPtr(old) != 0) freeRaw(data, old);
}

fn appendNodeRef(
    data: *const c.cgltf_data,
    arr: *[*c][*c]c.cgltf_node,
    count: anytype,
    node: [*c]c.cgltf_node,
) !void {
    const n: usize = count.*;
    const out = try cgltfAllocSlice([*c]c.cgltf_node, data, n + 1);
    if (n != 0) @memcpy(out[0..n], arr.*[0..n]);
    out[n] = node;
    if (n != 0 and @intFromPtr(arr.*) != 0) freeRaw(data, arr.*);
    arr.* = out;
    count.* = n + 1;
}

fn appendChild(data: *c.cgltf_data, parent: [*c]c.cgltf_node, child: [*c]c.cgltf_node) !void {
    const arr: *[*c][*c]c.cgltf_node = @ptrCast(&parent[0].children);
    try appendNodeRef(data, arr, &parent[0].children_count, child);
    child[0].parent = parent;
}

/// Add `np` to every scene that lists `src` (root nodes have no parent).
fn addToScenes(data: *c.cgltf_data, src: [*c]c.cgltf_node, np: [*c]c.cgltf_node) !void {
    for (sl(c.cgltf_scene, data.scenes, data.scenes_count)) |*s| {
        var found = false;
        for (sl([*c]c.cgltf_node, s.nodes, s.nodes_count)) |cand| {
            if (@intFromPtr(cand) == @intFromPtr(src)) {
                found = true;
                break;
            }
        }
        if (found) {
            const arr: *[*c][*c]c.cgltf_node = @ptrCast(&s.nodes);
            try appendNodeRef(data, arr, &s.nodes_count, np);
        }
    }
}

// ---------------------------------------------------------------------------
// dequant transform math (no external deps)
// ---------------------------------------------------------------------------

const Bounds = struct {
    mn: [3]f32,
    mx: [3]f32,
};

fn boundsEql(x: Bounds, y: Bounds) bool {
    return std.mem.eql(u8, std.mem.asBytes(&x), std.mem.asBytes(&y));
}

const Trs = struct {
    t: [3]f32 = .{ 0, 0, 0 },
    r: [4]f32 = .{ 0, 0, 0, 1 },
    s: [3]f32 = .{ 1, 1, 1 },
};

fn readTrs(n: *const c.cgltf_node) Trs {
    var out: Trs = .{};
    if (n.has_translation != 0) out.t = n.translation;
    if (n.has_rotation != 0) out.r = n.rotation;
    if (n.has_scale != 0) out.s = n.scale;
    return out;
}

fn cross(a: [3]f32, b: [3]f32) [3]f32 {
    return .{
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    };
}

/// Rotate `v` by the quaternion `q` (xyz, w).  glTF rotations are unit
/// quaternions; the formula below is the standard unit-quaternion rotation.
fn quatRotate(q: [4]f32, v: [3]f32) [3]f32 {
    const u = [3]f32{ q[0], q[1], q[2] };
    const t = cross(u, v);
    const scaled = [3]f32{ t[0] * 2.0, t[1] * 2.0, t[2] * 2.0 };
    const c2 = cross(u, scaled);
    return .{
        v[0] + scaled[0] * q[3] + c2[0],
        v[1] + scaled[1] * q[3] + c2[1],
        v[2] + scaled[2] * q[3] + c2[2],
    };
}

/// `node' = node * T(mn) * S(mx - mn)`, keeping the rotation untouched.
fn bakeDequant(trs: Trs, b: Bounds) Trs {
    const mn = [3]f32{ b.mn[0], b.mn[1], b.mn[2] };
    const off = quatRotate(trs.r, .{
        trs.s[0] * mn[0],
        trs.s[1] * mn[1],
        trs.s[2] * mn[2],
    });
    var s: [3]f32 = .{ 1, 1, 1 };
    for (0..3) |k| {
        const range = b.mx[k] - b.mn[k];
        // a flat axis quantizes to code 0 everywhere; any scale reproduces
        // `mn`, and 1 keeps the composed matrix invertible
        s[k] = trs.s[k] * (if (range != 0) range else 1.0);
    }
    return .{
        .t = .{ trs.t[0] + off[0], trs.t[1] + off[1], trs.t[2] + off[2] },
        .r = trs.r,
        .s = s,
    };
}

fn applyTrs(n: *c.cgltf_node, trs: Trs) void {
    n.has_translation = 1;
    n.translation = trs.t;
    n.has_scale = 1;
    n.scale = trs.s;
    // rotation is copied verbatim; only emit it when the source had one
    if (n.has_rotation != 0) n.rotation = trs.r;
}

// ---------------------------------------------------------------------------
// mesh / node cloning (deep, because cgltf owns every nested array)
// ---------------------------------------------------------------------------

fn cloneAttributes(
    data: *const c.cgltf_data,
    attrs: [*c]c.cgltf_attribute,
    n: usize,
) ![*c]c.cgltf_attribute {
    if (n == 0) return null;
    const out = try cgltfAllocSlice(c.cgltf_attribute, data, n);
    for (0..n) |k| {
        out[k] = attrs[k];
        if (@intFromPtr(attrs[k].name) != 0) {
            out[k].name = try dupStr(data, attrs[k].name);
        }
    }
    return out;
}

fn cloneMesh(data: *const c.cgltf_data, src: *const c.cgltf_mesh) !c.cgltf_mesh {
    var m = std.mem.zeroes(c.cgltf_mesh);
    if (@intFromPtr(src.name) != 0) {
        m.name = try dupStr(data, src.name);
    }

    const pn: usize = src.primitives_count;
    m.primitives_count = pn;
    if (pn != 0) {
        const prims = try cgltfAllocSlice(c.cgltf_primitive, data, pn);
        for (0..pn) |k| {
            const sp = &src.primitives[k];
            prims[k] = sp.*;
            prims[k].attributes = try cloneAttributes(data, sp.attributes, sp.attributes_count);
            // extras / raw extensions are not deep-cloned: their storage is
            // owned by the source mesh and cgltf_free would double-free it
            prims[k].extras = std.mem.zeroes(c.cgltf_extras);
            prims[k].extensions = null;
            prims[k].extensions_count = 0;

            if (sp.targets_count != 0) {
                const ts = try cgltfAllocSlice(c.cgltf_morph_target, data, sp.targets_count);
                for (0..sp.targets_count) |t| {
                    ts[t] = sp.targets[t];
                    ts[t].attributes = try cloneAttributes(
                        data,
                        sp.targets[t].attributes,
                        sp.targets[t].attributes_count,
                    );
                }
                prims[k].targets = ts;
            }
            if (sp.mappings_count != 0) {
                const ms = try cgltfAllocSlice(c.cgltf_material_mapping, data, sp.mappings_count);
                for (0..sp.mappings_count) |t| {
                    ms[t] = sp.mappings[t];
                    ms[t].extras = std.mem.zeroes(c.cgltf_extras);
                }
                prims[k].mappings = ms;
            }
            if (sp.has_draco_mesh_compression != 0) {
                prims[k].draco_mesh_compression.attributes = try cloneAttributes(
                    data,
                    sp.draco_mesh_compression.attributes,
                    sp.draco_mesh_compression.attributes_count,
                );
            }
        }
        m.primitives = prims;
    }

    if (src.weights_count != 0) {
        const ws = try cgltfAllocSlice(c.cgltf_float, data, src.weights_count);
        @memcpy(ws[0..src.weights_count], src.weights[0..src.weights_count]);
        m.weights = ws;
        m.weights_count = src.weights_count;
    }
    if (src.target_names_count != 0) {
        const tn = try cgltfAllocSlice([*c]u8, data, src.target_names_count);
        for (0..src.target_names_count) |k| {
            tn[k] = if (@intFromPtr(src.target_names[k]) != 0)
                try dupStr(data, src.target_names[k])
            else
                null;
        }
        m.target_names = tn;
        m.target_names_count = src.target_names_count;
    }
    return m;
}

fn cloneNodeForGroup(
    data: *const c.cgltf_data,
    src: *const c.cgltf_node,
    b: Bounds,
) !c.cgltf_node {
    var n = std.mem.zeroes(c.cgltf_node);
    n.rotation = .{ 0, 0, 0, 1 };
    n.scale = .{ 1, 1, 1 };

    const baked = bakeDequant(readTrs(src), b);
    n.has_translation = 1;
    n.translation = baked.t;
    n.has_rotation = src.has_rotation;
    n.rotation = baked.r;
    n.has_scale = 1;
    n.scale = baked.s;

    if (src.has_mesh_gpu_instancing != 0) {
        n.has_mesh_gpu_instancing = 1;
        n.mesh_gpu_instancing.attributes = try cloneAttributes(
            data,
            src.mesh_gpu_instancing.attributes,
            src.mesh_gpu_instancing.attributes_count,
        );
        n.mesh_gpu_instancing.attributes_count = src.mesh_gpu_instancing.attributes_count;
    }
    if (src.weights_count != 0) {
        const ws = try cgltfAllocSlice(c.cgltf_float, data, src.weights_count);
        @memcpy(ws[0..src.weights_count], src.weights[0..src.weights_count]);
        n.weights = ws;
        n.weights_count = src.weights_count;
    }
    return n;
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

fn findAttr(p: *const c.cgltf_primitive, at_type: c_int) ?[*c]c.cgltf_accessor {
    for (sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
        if (at.type == at_type) return at.data;
    }
    return null;
}

/// Bounds of a VEC3 position accessor (dequantized floats; sparse-aware).
fn computeBounds(a: std.mem.Allocator, acc: [*c]const c.cgltf_accessor) !?Bounds {
    const src = acc.*;
    if (numComponents(src.type) != 3 or src.count == 0) return null;

    const total: usize = src.count * 3;
    const tmp = try a.alloc(f32, total);
    defer a.free(tmp);

    var acc2 = src;
    if (acc2.stride == 0) acc2.stride = c.cgltf_calc_size(acc2.type, acc2.component_type);
    const got = c.cgltf_accessor_unpack_floats(&acc2, tmp.ptr, total);
    if (got < total) return null;

    var b = Bounds{
        .mn = .{ tmp[0], tmp[1], tmp[2] },
        .mx = .{ tmp[0], tmp[1], tmp[2] },
    };
    var e: usize = 1;
    while (e < src.count) : (e += 1) {
        for (0..3) |k| {
            const v = tmp[e * 3 + k];
            if (v < b.mn[k]) b.mn[k] = v;
            if (v > b.mx[k]) b.mx[k] = v;
        }
    }
    return b;
}

/// Build the quantized accessor + buffer view for one source accessor.
///
/// Always emits the historical tight layout (6-byte VEC3): the meshopt pass
/// picks its own padded / octahedral layouts per view when they win on size.
fn build(
    a: std.mem.Allocator,
    data: *const c.cgltf_data,
    kind: Kind,
    acc: [*c]const c.cgltf_accessor,
    opts: Options,
    pos_bounds: ?Bounds,
) !?Built {
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

    if (kind == .position) {
        // the mesh plan already computed these; use them so encode, accessor
        // bounds and the baked node transform are guaranteed to agree
        if (pos_bounds) |pb| {
            for (0..3) |k| {
                mn[k] = pb.mn[k];
                mx[k] = pb.mx[k];
            }
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
        // (gltfpack convention; the dequant lives in the node transform)
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

// ---------------------------------------------------------------------------
// mesh planning
// ---------------------------------------------------------------------------

const Group = struct {
    bounds: Bounds,
    prims: std.ArrayListUnmanaged(usize) = .empty,
};

const MeshPlan = struct {
    /// positions of every primitive may be quantized and dequantized via the
    /// transforms of all referencing nodes
    eligible: bool = false,
    groups: std.ArrayListUnmanaged(Group) = .empty,

    fn deinit(self: *MeshPlan, a: std.mem.Allocator) void {
        for (self.groups.items) |*g| g.prims.deinit(a);
        self.groups.deinit(a);
    }

    fn clearGroups(self: *MeshPlan, a: std.mem.Allocator) void {
        for (self.groups.items) |*g| g.prims.deinit(a);
        self.groups.clearRetainingCapacity();
    }
};

/// Node-transform / attribute level preconditions for quantizing positions.
fn baseEligible(
    data: *const c.cgltf_data,
    mesh: *const c.cgltf_mesh,
    refs: []const *c.cgltf_node,
    anim_trs: []const bool,
) bool {
    if (refs.len == 0) return false;
    for (refs) |n| {
        if (n.has_matrix != 0) return false;
        if (@intFromPtr(n.skin) != 0) return false;
        // animations on translation/scale would overwrite the baked dequant
        const ni = ptrIndex(c.cgltf_node, data.nodes, anim_trs.len, n) orelse return false;
        if (anim_trs[ni]) return false;
    }
    if (mesh.primitives_count == 0) return false;

    for (sl(c.cgltf_primitive, mesh.primitives, mesh.primitives_count)) |*p| {
        // morph target deltas are mesh-space offsets: the baked node scale
        // would scale them as well, so keep the whole mesh in float space
        if (p.targets_count != 0) return false;

        var has_pos = false;
        for (sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
            if (at.type == c.cgltf_attribute_type_joints) return false; // skinned
            if (at.type == c.cgltf_attribute_type_position) {
                if (@intFromPtr(at.data) == 0) return false;
                if (numComponents(at.data.*.type) != 3 or at.data.*.count == 0) return false;
                has_pos = true;
            }
        }
        if (!has_pos) return false;
    }
    return true;
}

/// Fill `plan.groups`: primitives grouped by identical position bounds.
/// Returns false when the mesh cannot be position-quantized after all.
fn planGroups(
    a: std.mem.Allocator,
    acc_base: [*c]c.cgltf_accessor,
    acc_n: usize,
    mesh: *const c.cgltf_mesh,
    plan: *MeshPlan,
    cache: []?Bounds,
    done: []bool,
) !bool {
    plan.clearGroups(a);
    for (sl(c.cgltf_primitive, mesh.primitives, mesh.primitives_count), 0..) |*p, pi| {
        const acc = findAttr(p, c.cgltf_attribute_type_position) orelse return false;
        const ai = ptrIndex(c.cgltf_accessor, acc_base, acc_n, acc) orelse return false;
        if (!done[ai]) {
            cache[ai] = try computeBounds(a, acc_base + ai);
            done[ai] = true;
        }
        const b = cache[ai] orelse return false;

        var placed = false;
        for (plan.groups.items) |*g| {
            if (boundsEql(g.bounds, b)) {
                try g.prims.append(a, pi);
                placed = true;
                break;
            }
        }
        if (!placed) {
            try plan.groups.append(a, .{ .bounds = b });
            try plan.groups.items[plan.groups.items.len - 1].prims.append(a, pi);
        }
    }
    return plan.groups.items.len > 0;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = file_bytes;
    // `in_place` is the only supported mode for now (accessor rewrite);
    // the flag is kept for API stability.
    _ = opts.in_place;

    var res: Result = .{};
    const base_acc_n: usize = data.accessors_count;
    const mesh_n: usize = data.meshes_count;
    if (mesh_n == 0) return res;

    // --- which nodes reference which mesh --------------------------------
    const refs = try a.alloc(std.ArrayListUnmanaged(*c.cgltf_node), mesh_n);
    defer {
        for (refs) |*r| r.deinit(a);
        a.free(refs);
    }
    for (refs) |*r| r.* = .empty;
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*n| {
        if (ptrIndex(c.cgltf_mesh, data.meshes, mesh_n, n.mesh)) |mi| {
            try refs[mi].append(a, n);
        }
    }

    // --- per mesh position plan ------------------------------------------
    // nodes whose translation/scale are animated cannot carry a baked dequant
    // (the animation would overwrite it on the first frame)
    const anim_trs = try a.alloc(bool, data.nodes_count);
    defer a.free(anim_trs);
    @memset(anim_trs, false);
    for (sl(c.cgltf_animation, data.animations, data.animations_count)) |*an| {
        for (sl(c.cgltf_animation_channel, an.channels, an.channels_count)) |*ch| {
            if (@intFromPtr(ch.target_node) == 0) continue;
            if (ch.target_path != c.cgltf_animation_path_type_translation and
                ch.target_path != c.cgltf_animation_path_type_scale) continue;
            if (ptrIndex(c.cgltf_node, data.nodes, data.nodes_count, ch.target_node)) |ni| {
                anim_trs[ni] = true;
            }
        }
    }

    const plans = try a.alloc(MeshPlan, mesh_n);
    defer {
        for (plans) |*p| p.deinit(a);
        a.free(plans);
    }
    for (plans) |*p| p.* = .{};

    const bounds_cache = try a.alloc(?Bounds, base_acc_n);
    defer a.free(bounds_cache);
    const bounds_done = try a.alloc(bool, base_acc_n);
    defer a.free(bounds_done);
    for (0..base_acc_n) |i| {
        bounds_cache[i] = null;
        bounds_done[i] = false;
    }

    // position accessor -> meshes that use it (shared accessors must keep a
    // single quantized payload, so *every* user has to be transform-bakeable)
    var pos_use: std.AutoHashMapUnmanaged(u32, std.ArrayListUnmanaged(u32)) = .empty;
    defer {
        var it = pos_use.valueIterator();
        while (it.next()) |v| v.deinit(a);
        pos_use.deinit(a);
    }
    for (0..mesh_n) |mi| {
        // meshes without node references are dropped by the writer's GC; they
        // must not veto quantizing an accessor they happen to share
        if (refs[mi].items.len == 0) continue;
        const mesh = &sl(c.cgltf_mesh, data.meshes, mesh_n)[mi];
        for (sl(c.cgltf_primitive, mesh.primitives, mesh.primitives_count)) |*p| {
            const acc = findAttr(p, c.cgltf_attribute_type_position) orelse continue;
            const ai = ptrIndex(c.cgltf_accessor, data.accessors, base_acc_n, acc) orelse continue;
            const gop = try pos_use.getOrPut(a, ai);
            if (!gop.found_existing) gop.value_ptr.* = .empty;
            try gop.value_ptr.append(a, @intCast(mi));
        }
    }

    for (plans, 0..) |*plan, mi| {
        const mesh = &sl(c.cgltf_mesh, data.meshes, mesh_n)[mi];
        plan.eligible = baseEligible(data, mesh, refs[mi].items, anim_trs);
    }

    // Revoke eligibility until stable: a shared position accessor may only be
    // quantized when *all* of its users bake a dequant transform, and a mesh
    // can only be quantized when every primitive has usable float bounds.
    var stable = false;
    while (!stable) {
        stable = true;
        for (plans, 0..) |*plan, mi| {
            if (!plan.eligible) continue;
            const mesh = &sl(c.cgltf_mesh, data.meshes, mesh_n)[mi];

            outer: for (sl(c.cgltf_primitive, mesh.primitives, mesh.primitives_count)) |*p| {
                const acc = findAttr(p, c.cgltf_attribute_type_position) orelse continue;
                const ai = ptrIndex(c.cgltf_accessor, data.accessors, base_acc_n, acc) orelse continue;
                if (pos_use.get(ai)) |users| {
                    for (users.items) |mj| {
                        if (!plans[mj].eligible) {
                            plan.eligible = false;
                            stable = false;
                            break :outer;
                        }
                    }
                }
            }
            if (!plan.eligible) continue;

            if (!try planGroups(a, data.accessors, base_acc_n, mesh, plan, bounds_cache, bounds_done)) {
                plan.eligible = false;
                stable = false;
            }
        }
        for (plans) |*plan| {
            if (!plan.eligible) plan.clearGroups(a);
        }
    }

    // --- structural changes: split / duplicate meshes, bake node TRS ------
    var new_meshes: std.ArrayListUnmanaged(c.cgltf_mesh) = .empty;
    defer new_meshes.deinit(a);
    var new_bounds: std.ArrayListUnmanaged(?Bounds) = .empty;
    defer new_bounds.deinit(a);

    const SiblingJob = struct {
        src_index: u32,
        parent_index: ?u32,
        mesh_index: usize,
        bounds: Bounds,
    };
    var jobs: std.ArrayListUnmanaged(SiblingJob) = .empty;
    defer jobs.deinit(a);

    const NodeAssignment = struct {
        node: *c.cgltf_node,
        mesh_index: usize,
        bounds: Bounds,
    };
    var assignments: std.ArrayListUnmanaged(NodeAssignment) = .empty;
    defer assignments.deinit(a);

    const old_node_n: usize = data.nodes_count;

    for (0..mesh_n) |mi| {
        const plan = &plans[mi];
        if (!plan.eligible) continue;
        const meshes = sl(c.cgltf_mesh, data.meshes, mesh_n);
        const mesh = &meshes[mi];
        const groups = plan.groups.items;

        const group_mesh = try a.alloc(usize, groups.len);
        defer a.free(group_mesh);
        group_mesh[0] = mi;

        // one mesh per additional bounds group; primitive structs are copied
        // (their nested arrays change ownership exactly once)
        for (groups[1..], 1..) |grp, g| {
            var nm = std.mem.zeroes(c.cgltf_mesh);
            const prims = try cgltfAllocSlice(c.cgltf_primitive, data, grp.prims.items.len);
            for (grp.prims.items, 0..) |pi, k| prims[k] = mesh.primitives[pi];
            nm.primitives = prims;
            nm.primitives_count = grp.prims.items.len;
            group_mesh[g] = mesh_n + new_meshes.items.len;
            try new_meshes.append(a, nm);
            try new_bounds.append(a, grp.bounds);
        }
        if (groups.len > 1) {
            // the original mesh keeps only group 0's primitives
            for (groups[0].prims.items, 0..) |pi, k| mesh.primitives[k] = mesh.primitives[pi];
            mesh.primitives_count = groups[0].prims.items.len;
        }

        // one mesh per referencing node (gltfpack dups instanced meshes)
        for (refs[mi].items, 0..) |node, ri| {
            for (groups, 0..) |grp, g| {
                var mindex = group_mesh[g];
                if (ri > 0) {
                    const src_mesh = if (mindex < mesh_n)
                        &meshes[mindex]
                    else
                        &new_meshes.items[mindex - mesh_n];
                    const clone = try cloneMesh(data, src_mesh);
                    mindex = mesh_n + new_meshes.items.len;
                    try new_meshes.append(a, clone);
                    try new_bounds.append(a, grp.bounds);
                }
                if (g == 0) {
                    // the referencing node itself takes this mesh
                    try assignments.append(a, .{ .node = node, .mesh_index = mindex, .bounds = grp.bounds });
                } else {
                    // extra bounds group: needs a sibling leaf node
                    const src_index = ptrIndex(c.cgltf_node, data.nodes, old_node_n, node) orelse continue;
                    const parent_index: ?u32 = if (@intFromPtr(node.parent) != 0)
                        ptrIndex(c.cgltf_node, data.nodes, old_node_n, node.parent)
                    else
                        null;
                    try jobs.append(a, .{
                        .src_index = src_index,
                        .parent_index = parent_index,
                        .mesh_index = mindex,
                        .bounds = grp.bounds,
                    });
                }
            }
        }
    }

    // --- grow the mesh pool, then bake the original nodes -----------------
    const total_meshes = mesh_n + new_meshes.items.len;
    const final_bounds = try a.alloc(?Bounds, total_meshes);
    defer a.free(final_bounds);
    for (0..mesh_n) |mi| {
        final_bounds[mi] = if (plans[mi].eligible) plans[mi].groups.items[0].bounds else null;
    }
    for (new_bounds.items, 0..) |b, k| final_bounds[mesh_n + k] = b;

    try commitMeshes(data, new_meshes.items);

    // sibling nodes are derived from the *original* (still unbaked) TRS, so
    // build them before the assignments rewrite translation/scale in place
    var extra: std.ArrayListUnmanaged(c.cgltf_node) = .empty;
    defer extra.deinit(a);
    for (jobs.items) |job| {
        const src = &sl(c.cgltf_node, data.nodes, old_node_n)[job.src_index];
        var nn = try cloneNodeForGroup(data, src, job.bounds);
        nn.mesh = data.meshes + job.mesh_index;
        try extra.append(a, nn);
    }

    for (assignments.items) |asg| {
        const trs = bakeDequant(readTrs(asg.node), asg.bounds);
        applyTrs(asg.node, trs);
        asg.node.mesh = data.meshes + asg.mesh_index;
        res.dequantized_nodes += 1;
    }

    // --- grow the node pool, then attach the sibling nodes ----------------
    if (extra.items.len != 0) {
        try commitNodes(data, extra.items);

        for (jobs.items, 0..) |job, k| {
            const np: [*c]c.cgltf_node = data.nodes + (old_node_n + k);
            if (job.parent_index) |pi| {
                try appendChild(data, data.nodes + pi, np);
            } else {
                try addToScenes(data, data.nodes + job.src_index, np);
            }
        }
        res.dequantized_nodes += @intCast(jobs.items.len);
    }

    // --- quantize the attributes of the final mesh pool -------------------
    const mapping = try a.alloc(?u32, base_acc_n);
    defer a.free(mapping);
    @memset(mapping, null);

    var pool: Pool = .{};
    defer pool.deinit(a);
    var rewrites: std.ArrayListUnmanaged(Rewrite) = .empty;
    defer rewrites.deinit(a);

    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count), 0..) |*m, mi| {
        const pos_bounds: ?Bounds = final_bounds[mi];
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            // vertex-only attribute rewrite; morph targets keep their floats
            for (sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                const kind = kindOf(at) orelse continue;
                // no baked dequant for this mesh: keep float POSITION
                if (kind == .position and pos_bounds == null) continue;
                const old_index = ptrIndex(c.cgltf_accessor, data.accessors, base_acc_n, at.data) orelse continue;
                if (mapping[old_index] == null) {
                    const built = try build(
                        a,
                        data,
                        kind,
                        data.accessors + old_index,
                        opts,
                        if (kind == .position) pos_bounds else null,
                    );
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

    // EXT_meshopt_compression over every eligible vertex/index view.
    if (mc.have_codec) {
        if (opts.meshopt_compression) {
            try compressViews(a, data, &res, opts);
            if (res.meshopt_views > 0) {
                try ensureExtension(data, "EXT_meshopt_compression", true);
                try ensureExtension(data, "EXT_meshopt_compression", false);
            }
        }
    } else if (opts.meshopt_compression) {
        res.meshopt_no_codec = true;
    }
    return res;
}

// ---------------------------------------------------------------------------
// EXT_meshopt_compression (all codec calls live here, behind have_codec)
// ---------------------------------------------------------------------------

/// Views smaller than this are left uncompressed: the extension JSON (~150 B)
/// would eat the savings.
const min_compress_bytes: usize = 256;

const Use = struct {
    const vertex: u8 = 1;
    const index: u8 = 2;
    const image: u8 = 4;
    const other: u8 = 8;
};

/// Raw bytes of a buffer view (op-built `data` or the buffer slice).
/// Null when unavailable — including already-compressed views, which our
/// cgltf cannot decode (no meshopt decoder linked): never touch those.
fn viewRawBytes(v: *const c.cgltf_buffer_view) ?[]const u8 {
    if (v.has_meshopt_compression != 0) return null;
    if (v.data) |d| {
        const p: [*]const u8 = @ptrCast(d);
        return p[0..v.size];
    }
    if (@intFromPtr(v.buffer) == 0) return null;
    const data = v.buffer.*.data orelse return null;
    const bsize: usize = @intCast(v.buffer.*.size);
    const off: usize = @intCast(v.offset);
    const sz: usize = @intCast(v.size);
    if (off > bsize or sz > bsize - off) return null;
    const p: [*]const u8 = @ptrCast(data);
    return p[off .. off + sz];
}

/// Install `enc` as the view payload: op-built allocations are reused
/// in place (the encoding only ever shrinks), parsed buffer-backed views get
/// a fresh cgltf-owned allocation. `v.size` keeps the DECOMPRESSED length.
fn installPayload(data: *const c.cgltf_data, a: std.mem.Allocator, v: *c.cgltf_buffer_view, enc: []u8) !void {
    if (v.data) |d| {
        const p: [*]u8 = @ptrCast(d);
        @memcpy(p[0..enc.len], enc);
        a.free(enc);
    } else {
        const mem = allocRaw(data, enc.len) orelse return error.OutOfMemory;
        @memcpy(mem[0..enc.len], enc);
        a.free(enc);
        v.data = mem;
    }
    v.has_meshopt_compression = 1;
}

/// Per-view attribute census for the ATTRIBUTES candidate picker.
const AttrUse = struct {
    /// Natural element size of every user, 0 when mixed.
    elem: usize = 0,
    /// Accessor stride consensus, 0 when mixed.
    astride: usize = 0,
    /// cgltf_attribute_type of every user, -2 when mixed, -1 when none yet.
    sem: c_int = -1,
    /// Any user is a morph-target attribute (deltas, never unit vectors).
    has_morph: bool = false,
    /// Every user is a normalized snorm accessor (oct needs unit vectors).
    all_signed_norm: bool = true,
    /// Every user has a 6-byte element (VEC3 x 16-bit).
    all_elem6: bool = true,
    found: bool = false,
    /// Referencing accessors (for post-compress stride updates).
    accs: std.ArrayListUnmanaged(*c.cgltf_accessor) = .empty,
};

/// Fold one vertex accessor into the census. Returns true when the view is
/// ineligible (mixed strides, unreadable offsets).
fn checkAttrElem(
    at: *const c.cgltf_attribute,
    is_morph: bool,
    v: *const c.cgltf_buffer_view,
    use: *AttrUse,
    a: std.mem.Allocator,
) !bool {
    if (@intFromPtr(at.data) == 0) return false;
    const acc: *c.cgltf_accessor = @ptrCast(at.data);
    const e: usize = c.cgltf_calc_size(acc.type, acc.component_type);
    if (e == 0) return true;
    const off: usize = @intCast(acc.offset);
    const astride: usize = if (acc.stride != 0) @intCast(acc.stride) else e;
    if (astride < e) return true;
    if (v.stride != 0) {
        const s: usize = @intCast(v.stride);
        if (off + e > s) return true;
    } else {
        if (off % e != 0) return true;
    }
    if (use.elem != 0 and use.elem != e) use.all_elem6 = false else use.elem = e;
    if (use.found and use.astride != astride) return true;
    use.astride = astride;
    if (use.sem == -1) {
        use.sem = @intCast(at.type);
    } else if (use.sem != @as(c_int, @intCast(at.type))) {
        use.sem = -2;
    }
    if (is_morph) use.has_morph = true;
    const signed = acc.component_type == c.cgltf_component_type_r_16 or acc.component_type == c.cgltf_component_type_r_8;
    if (acc.normalized == 0 or !signed) use.all_signed_norm = false;
    if (!use.found) use.all_elem6 = e == 6;
    use.found = true;
    try use.accs.append(a, acc);
    return false;
}

/// Encode `raw` (count elements of `stride` bytes) when it shrinks; null on
/// incompressible input or when the codec is unavailable (unreachable here,
/// the caller guards on have_codec). OOM propagates.
fn tryEncode(a: std.mem.Allocator, raw: []const u8, count: usize, stride: usize) !?[]u8 {
    const enc = mc.encodeVertices(a, raw, count, stride) catch |err| switch (err) {
        error.CodecFailed => return null,
        else => |e| return e,
    };
    return enc;
}

/// Compress one vertex-attribute view (ATTRIBUTES mode).
///
/// Tries every layout the codec allows and installs the smallest payload —
/// but only when it beats the current (tight) size, so meshopt can never
/// lose against the plain quantize output:
///   * direct encode when the stride is already a multiple of 4 (covers
///     interleaved views too: the codec is byte-exact for any stride),
///   * VEC3 (6 B) zero-padded to an 8-byte stride,
///   * octahedral K=12 re-encode (8 B, filter OCTAHEDRAL) for uniform,
///     normalized, non-morph NORMAL (VEC3) / TANGENT (VEC4, W preserved).
fn compressAttributes(
    a: std.mem.Allocator,
    data: *c.cgltf_data,
    res: *Result,
    v: *c.cgltf_buffer_view,
    raw: []const u8,
    opts: Options,
) !void {
    var use: AttrUse = .{};
    defer use.accs.deinit(a);
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            for (sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                if (@intFromPtr(at.data) == 0 or at.data.*.buffer_view != v) continue;
                if (try checkAttrElem(at, false, v, &use, a)) return;
            }
            for (sl(c.cgltf_morph_target, p.targets, p.targets_count)) |*t| {
                for (sl(c.cgltf_attribute, t.attributes, t.attributes_count)) |*at| {
                    if (@intFromPtr(at.data) == 0 or at.data.*.buffer_view != v) continue;
                    if (try checkAttrElem(at, true, v, &use, a)) return;
                }
            }
        }
    }
    if (!use.found) return;
    const base_stride: usize = if (v.stride != 0) @intCast(v.stride) else use.astride;
    // A view stride that disagrees with every accessor stride is corrupt.
    if (v.stride != 0 and use.astride != 0 and base_stride != use.astride) return;
    if (base_stride == 0 or base_stride > 256) return;
    if (raw.len % base_stride != 0) return;
    const count: usize = raw.len / base_stride;
    if (count == 0) return;

    var best: ?[]u8 = null;
    defer if (best) |b| a.free(b);
    var best_stride: usize = 0;
    var best_oct = false;

    // Candidate 1: direct encode (byte-exact for any stride).
    if (base_stride % 4 == 0) {
        if (try tryEncode(a, raw, count, base_stride)) |enc| {
            best = enc;
            best_stride = base_stride;
        }
    }
    // Candidate 2: VEC3 zero-padded to 8.
    if (use.all_elem6 and use.elem == 6) {
        const padded = try a.alloc(u8, count * 8);
        defer a.free(padded);
        for (0..count) |k| {
            @memcpy(padded[k * 8 ..][0..6], raw[k * 6 ..][0..6]);
            @memset(padded[k * 8 + 6 ..][0..2], 0);
        }
        if (try tryEncode(a, padded, count, 8)) |enc| {
            if (best == null or enc.len < best.?.len) {
                if (best) |b| a.free(b);
                best = enc;
                best_stride = 8;
            } else {
                a.free(enc);
            }
        }
    }
    // Candidate 3: octahedral K=12 (unit normals/tangents only).
    const oct_sem = use.sem == @as(c_int, @intCast(c.cgltf_attribute_type_normal)) or use.sem == @as(c_int, @intCast(c.cgltf_attribute_type_tangent));
    const oct_elem_ok = (use.sem == @as(c_int, @intCast(c.cgltf_attribute_type_normal)) and use.elem == 6) or
        (use.sem == @as(c_int, @intCast(c.cgltf_attribute_type_tangent)) and use.elem == 8);
    if (oct_sem and oct_elem_ok and use.all_elem6 and !use.has_morph and use.all_signed_norm and opts.normal_oct) {
        const f4 = try a.alloc(f32, count * 4);
        defer a.free(f4);
        const is_tangent = use.sem == @as(c_int, @intCast(c.cgltf_attribute_type_tangent));
        for (0..count) |k| {
            for (0..3) |ax| {
                const q = std.mem.readInt(i16, raw[k * use.elem + ax * 2 ..][0..2], .little);
                f4[k * 4 + ax] = @as(f32, @floatFromInt(q)) / 32767.0;
            }
            // Tangent W passes through verbatim; normals store 0.
            f4[k * 4 + 3] = if (is_tangent) @as(f32, @floatFromInt(std.mem.readInt(i16, raw[k * use.elem + 6 ..][0..2], .little))) / 32767.0 else 0;
        }
        // 12-bit oct: matches gltfpack's -cc quality/size trade-off.
        const oct = try a.alloc(u8, count * 8);
        defer a.free(oct);
        try mc.encodeFilterOct(oct, count, 8, 12, f4);
        if (try tryEncode(a, oct, count, 8)) |enc| {
            if (best == null or enc.len < best.?.len) {
                if (best) |b| a.free(b);
                best = enc;
                best_stride = 8;
                best_oct = true;
            } else {
                a.free(enc);
            }
        }
    }

    const win = best orelse return;
    if (win.len >= raw.len) return; // never lose vs the tight layout
    if (best_stride != base_stride) {
        // Padded / octahedral layouts decode to best_stride bytes per
        // element: resize the view and the accessor strides to match.
        for (use.accs.items) |acc| acc.stride = best_stride;
        v.size = count * best_stride;
    }
    const enc_len: usize = win.len;
    best = null; // installPayload takes ownership (frees after copying)
    try installPayload(data, a, v, win);
    v.meshopt_compression = .{
        .buffer = if (data.buffers_count > 0) data.buffers else null,
        .offset = 0, // assigned by the writer's BIN layout
        .size = enc_len,
        .stride = best_stride,
        .count = count,
        .mode = c.cgltf_meshopt_compression_mode_attributes,
        .filter = if (best_oct) c.cgltf_meshopt_compression_filter_octahedral else c.cgltf_meshopt_compression_filter_none,
        .is_khr = 0,
    };
    res.meshopt_views += 1;
}

/// Compress one index view (TRIANGLES for triangle lists, else INDICES).
/// u8 indices widen to u16; every referencing accessor must cover the whole
/// view (rotation within a triangle keeps per-triangle sets, so sub-range
/// accessors would read shifted values — those views stay uncompressed).
fn compressIndices(
    a: std.mem.Allocator,
    data: *c.cgltf_data,
    res: *Result,
    v: *c.cgltf_buffer_view,
    raw: []const u8,
) !void {
    var refs: std.ArrayListUnmanaged(*c.cgltf_accessor) = .empty;
    defer refs.deinit(a);
    var s_orig: usize = 0;
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            if (@intFromPtr(p.indices) == 0) continue;
            const acc: *c.cgltf_accessor = @ptrCast(p.indices);
            if (acc.buffer_view != v) continue;
            const s: usize = switch (acc.component_type) {
                c.cgltf_component_type_r_8u => 1,
                c.cgltf_component_type_r_16u => 2,
                c.cgltf_component_type_r_32u => 4,
                else => return,
            };
            if (s_orig == 0) {
                s_orig = s;
            } else if (s_orig != s) {
                return;
            }
            // Whole-view coverage only (see doc comment).
            if (acc.offset != 0) return;
            if (@as(usize, @intCast(acc.count)) * s != raw.len) return;
            try refs.append(a, acc);
        }
    }
    if (refs.items.len == 0 or s_orig == 0) return;
    if (raw.len % s_orig != 0) return;
    const n_idx: usize = raw.len / s_orig;
    if (n_idx == 0) return;

    const idx = try a.alloc(u32, n_idx);
    defer a.free(idx);
    switch (s_orig) {
        1 => {
            for (raw, 0..) |b, k| idx[k] = b;
        },
        2 => {
            for (0..n_idx) |k| idx[k] = std.mem.readInt(u16, raw[k * 2 ..][0..2], .little);
        },
        else => {
            for (0..n_idx) |k| idx[k] = std.mem.readInt(u32, raw[k * 4 ..][0..4], .little);
        },
    }
    var idx_max: u32 = 0;
    for (idx) |ix| idx_max = @max(idx_max, ix);
    const s_new: usize = if (idx_max <= 0xffff) 2 else 4;
    if (n_idx * s_new < min_compress_bytes) return;

    // Triangle lists (default/empty mode counts as triangles, like the
    // writer) use the triangle codec; anything else the index sequence.
    var all_tris = n_idx % 3 == 0;
    var any_user = false;
    outer: for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            if (@intFromPtr(p.indices) == 0) continue;
            const acc: *c.cgltf_accessor = @ptrCast(p.indices);
            if (acc.buffer_view != v) continue;
            any_user = true;
            if (p.type != 0 and p.type != 5) {
                all_tris = false;
                break :outer;
            }
        }
    }
    if (!any_user) return;

    const enc = if (all_tris)
        mc.encodeTriangles(a, idx) catch |err| switch (err) {
            error.CodecFailed => return,
            else => |e| return e,
        }
    else
        mc.encodeSequence(a, idx) catch |err| switch (err) {
            error.CodecFailed => return,
            else => |e| return e,
        };
    // The codec's own shrink check is against u32 data: enforce the real
    // never-lose rule against the decoded (possibly 16-bit) size here.
    if (enc.len >= n_idx * s_new) {
        a.free(enc);
        return;
    }
    const enc_len: usize = enc.len;
    try installPayload(data, a, v, enc);
    v.size = n_idx * s_new; // decoded length (widens u8 -> u16)
    for (refs.items) |acc| {
        acc.component_type = if (s_new == 2) c.cgltf_component_type_r_16u else c.cgltf_component_type_r_32u;
        acc.stride = s_new;
    }
    v.meshopt_compression = .{
        .buffer = if (data.buffers_count > 0) data.buffers else null,
        .offset = 0, // assigned by the writer's BIN layout
        .size = enc_len,
        .stride = s_new,
        .count = n_idx,
        .mode = if (all_tris) c.cgltf_meshopt_compression_mode_triangles else c.cgltf_meshopt_compression_mode_indices,
        .filter = c.cgltf_meshopt_compression_filter_none,
        .is_khr = 0,
    };
    res.meshopt_views += 1;
}

/// Meshopt-compress every eligible mesh vertex/index view in place.
/// Ineligible views (sparse, images, animations, skins, instancing,
/// interleaved-mixed, tiny, incompressible) stay uncompressed; the writer
/// only marks views with `has_meshopt_compression`.
fn compressViews(a: std.mem.Allocator, data: *c.cgltf_data, res: *Result, opts: Options) !void {
    const n_views: usize = data.buffer_views_count;
    if (n_views == 0) return;
    const usage = try a.alloc(u8, n_views);
    defer a.free(usage);
    @memset(usage, 0);
    const views = sl(c.cgltf_buffer_view, data.buffer_views, n_views);

    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            for (sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                if (@intFromPtr(at.data) == 0) continue;
                if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, at.data.*.buffer_view)) |vi| usage[vi] |= Use.vertex;
            }
            for (sl(c.cgltf_morph_target, p.targets, p.targets_count)) |*t| {
                for (sl(c.cgltf_attribute, t.attributes, t.attributes_count)) |*at| {
                    if (@intFromPtr(at.data) == 0) continue;
                    if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, at.data.*.buffer_view)) |vi| usage[vi] |= Use.vertex;
                }
            }
            if (@intFromPtr(p.indices) != 0) {
                if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, p.indices.*.buffer_view)) |vi| usage[vi] |= Use.index;
            }
            if (@intFromPtr(p.draco_mesh_compression.buffer_view) != 0) {
                if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, p.draco_mesh_compression.buffer_view)) |vi| usage[vi] |= Use.other;
            }
        }
    }
    for (sl(c.cgltf_image, data.images, data.images_count)) |*im| {
        if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, im.buffer_view)) |vi| usage[vi] |= Use.image;
    }
    for (sl(c.cgltf_animation, data.animations, data.animations_count)) |*an| {
        for (sl(c.cgltf_animation_sampler, an.samplers, an.samplers_count)) |*s| {
            if (@intFromPtr(s.input) != 0) {
                if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, s.input.*.buffer_view)) |vi| usage[vi] |= Use.other;
            }
            if (@intFromPtr(s.output) != 0) {
                if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, s.output.*.buffer_view)) |vi| usage[vi] |= Use.other;
            }
        }
    }
    for (sl(c.cgltf_skin, data.skins, data.skins_count)) |*sk| {
        if (@intFromPtr(sk.inverse_bind_matrices) != 0) {
            if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, sk.inverse_bind_matrices.*.buffer_view)) |vi| usage[vi] |= Use.other;
        }
    }
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*nd| {
        if (nd.has_mesh_gpu_instancing != 0) {
            for (sl(c.cgltf_attribute, nd.mesh_gpu_instancing.attributes, nd.mesh_gpu_instancing.attributes_count)) |*at| {
                if (@intFromPtr(at.data) == 0) continue;
                if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, at.data.*.buffer_view)) |vi| usage[vi] |= Use.other;
            }
        }
    }
    // Sparse storage is never eligible.
    for (sl(c.cgltf_accessor, data.accessors, data.accessors_count)) |*acc| {
        if (acc.is_sparse == 0) continue;
        if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, acc.sparse.indices_buffer_view)) |vi| usage[vi] |= Use.other;
        if (ptrIndex(c.cgltf_buffer_view, data.buffer_views, n_views, acc.sparse.values_buffer_view)) |vi| usage[vi] |= Use.other;
    }

    for (views, 0..) |*v, i| {
        const u = usage[i];
        if (u != Use.vertex and u != Use.index) continue;
        const raw = viewRawBytes(v) orelse continue;
        if (raw.len < min_compress_bytes) continue;
        if (u == Use.vertex) {
            try compressAttributes(a, data, res, v, raw, opts);
        } else {
            try compressIndices(a, data, res, v, raw);
        }
    }
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

fn countMeshTriangles(m: *const c.cgltf_mesh) u64 {
    var tris: u64 = 0;
    for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
        if (p.type != c.cgltf_primitive_type_triangles) continue;
        if (@intFromPtr(p.indices) != 0) {
            tris += p.indices.*.count / 3;
        } else {
            const pos = c.cgltf_find_accessor(p, c.cgltf_attribute_type_position, 0);
            if (@intFromPtr(pos) != 0) tris += pos.*.count / 3;
        }
    }
    return tris;
}

/// Triangles actually drawn: a mesh referenced by two nodes counts twice, so
/// mesh duplication (one mesh per node) stays invisible to this metric.
fn instancedTriangles(data: *const c.cgltf_data) u64 {
    var tris: u64 = 0;
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*n| {
        const mi = ptrIndex(c.cgltf_mesh, data.meshes, data.meshes_count, n.mesh) orelse continue;
        tris += countMeshTriangles(&sl(c.cgltf_mesh, data.meshes, data.meshes_count)[mi]);
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

fn findNode(data: *const c.cgltf_data, name: []const u8) ?*c.cgltf_node {
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*n| {
        if (@intFromPtr(n.name) == 0) continue;
        if (std.mem.eql(u8, std.mem.span(n.name), name)) return n;
    }
    return null;
}

fn meshPosBounds(m: *const c.cgltf_mesh) ?Bounds {
    for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
        const pos = findAttr(p, c.cgltf_attribute_type_position) orelse continue;
        if (pos[0].has_min == 0 or pos[0].has_max == 0) continue;
        return .{
            .mn = .{ pos[0].min[0], pos[0].min[1], pos[0].min[2] },
            .mx = .{ pos[0].max[0], pos[0].max[1], pos[0].max[2] },
        };
    }
    return null;
}

const Aabb = struct {
    mn: [3]f32 = .{ std.math.inf(f32), std.math.inf(f32), std.math.inf(f32) },
    mx: [3]f32 = .{ -std.math.inf(f32), -std.math.inf(f32), -std.math.inf(f32) },
    valid: bool = false,

    fn add(self: *Aabb, p: [3]f32) void {
        self.valid = true;
        for (0..3) |k| {
            if (p[k] < self.mn[k]) self.mn[k] = p[k];
            if (p[k] > self.mx[k]) self.mx[k] = p[k];
        }
    }

    fn merge(self: *Aabb, o: Aabb) void {
        if (!o.valid) return;
        self.add(o.mn);
        self.add(o.mx);
    }
};

fn transformPoint(m: *const [16]f32, v: [3]f32) [3]f32 {
    // cgltf matrices are column-major
    return .{
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
    };
}

/// World-space AABB of one node's mesh, using the *decoded* accessor values
/// (normalized integers included), i.e. exactly what a renderer sees.
fn nodeWorldAabb(
    data: *const c.cgltf_data,
    a: std.mem.Allocator,
    node: *const c.cgltf_node,
) !Aabb {
    var out = Aabb{};
    const mi = ptrIndex(c.cgltf_mesh, data.meshes, data.meshes_count, node.mesh) orelse return out;
    var m: [16]f32 = undefined;
    c.cgltf_node_transform_world(node, &m);

    const mesh = &sl(c.cgltf_mesh, data.meshes, data.meshes_count)[mi];
    for (sl(c.cgltf_primitive, mesh.primitives, mesh.primitives_count)) |*p| {
        const pos = findAttr(p, c.cgltf_attribute_type_position) orelse continue;
        const ncomp = numComponents(pos[0].type);
        if (ncomp < 3 or pos[0].count == 0) continue;
        const total = pos[0].count * ncomp;
        const tmp = try a.alloc(f32, total);
        defer a.free(tmp);
        var acc2 = pos[0];
        if (acc2.stride == 0) acc2.stride = c.cgltf_calc_size(acc2.type, acc2.component_type);
        if (c.cgltf_accessor_unpack_floats(&acc2, tmp.ptr, total) < total) continue;
        for (0..pos[0].count) |v| {
            out.add(transformPoint(&m, .{
                tmp[v * ncomp + 0],
                tmp[v * ncomp + 1],
                tmp[v * ncomp + 2],
            }));
        }
    }
    return out;
}

fn worldAabb(data: *const c.cgltf_data, a: std.mem.Allocator) !Aabb {
    var out = Aabb{};
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*n| {
        out.merge(try nodeWorldAabb(data, a, n));
    }
    return out;
}

fn expectAabbClose(before: Aabb, after: Aabb) !void {
    try std.testing.expect(before.valid and after.valid);
    for (0..3) |k| {
        const span = @max(before.mx[k] - before.mn[k], 1e-3);
        const tol = span * 0.02 + 1e-4;
        try std.testing.expectApproxEqAbs(before.mn[k], after.mn[k], tol);
        try std.testing.expectApproxEqAbs(before.mx[k], after.mx[k], tol);
    }
}

const Reparsed = struct {
    loaded: parse_mod.Loaded,
    tmp: std.testing.TmpDir,
};

fn reparse(a: std.mem.Allocator, tmp_name: []const u8, bytes: []const u8) !Reparsed {
    var tmp = std.testing.tmpDir(.{});
    errdefer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{ .sub_path = tmp_name, .data = bytes });
    const out_path = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/{s}", .{ tmp.sub_path[0..], tmp_name });
    const loaded = try parse_mod.loadFile(std.testing.io, a, out_path);
    return .{ .loaded = loaded, .tmp = tmp };
}

fn quantizeRoundTrip(comptime path: []const u8, tmp_name: []const u8) !void {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, path);
    defer loaded.deinit();

    const tris_before = instancedTriangles(loaded.cdata);
    const pos_before = firstAttrAcc(loaded.cdata, c.cgltf_attribute_type_position) orelse return error.NoPosition;
    const min_before = pos_before.min;
    const max_before = pos_before.max;
    const has_bounds = pos_before.has_min != 0 and pos_before.has_max != 0;
    const aabb_before = try worldAabb(loaded.cdata, aa);

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expect(res.quantized_positions > 0);
    try std.testing.expect(res.quantized_uvs > 0);
    try std.testing.expect(res.quantized_normals > 0);
    try std.testing.expect(res.dequantized_nodes > 0);
    std.debug.print(
        "quantize {s}: pos={d} uv={d} nrm={d} nodes={d} tris={d}\n",
        .{ path, res.quantized_positions, res.quantized_uvs, res.quantized_normals, res.dequantized_nodes, tris_before },
    );

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);

    var rp = try reparse(aa, tmp_name, out);
    defer {
        rp.loaded.deinit();
        rp.tmp.cleanup();
    }
    try std.testing.expectEqual(
        @as(c_uint, c.cgltf_result_success),
        @as(c_uint, c.cgltf_validate(rp.loaded.cdata)),
    );

    try std.testing.expectEqual(tris_before, instancedTriangles(rp.loaded.cdata));

    // the baked node transforms must reproduce the original world-space model
    try expectAabbClose(aabb_before, try worldAabb(rp.loaded.cdata, aa));

    const pos_after = firstAttrAcc(rp.loaded.cdata, c.cgltf_attribute_type_position) orelse return error.NoPosition;
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

    const uv_after = firstAttrAcc(rp.loaded.cdata, c.cgltf_attribute_type_texcoord) orelse return error.NoUv;
    try std.testing.expectEqual(@as(c.cgltf_component_type, c.cgltf_component_type_r_16u), uv_after.component_type);
    try std.testing.expect(uv_after.normalized != 0);
    try std.testing.expectEqual(@as(c.cgltf_type, c.cgltf_type_vec2), uv_after.type);

    const n_after = firstAttrAcc(rp.loaded.cdata, c.cgltf_attribute_type_normal) orelse return error.NoNormal;
    try std.testing.expectEqual(@as(c.cgltf_component_type, c.cgltf_component_type_r_16), n_after.component_type);
    try std.testing.expect(n_after.normalized != 0);
    try std.testing.expectEqual(@as(c.cgltf_type, c.cgltf_type_vec3), n_after.type);

    // the model-level view still matches (attributes survive the writer)
    for (rp.loaded.asset.meshes) |m| {
        for (m.primitives) |p| {
            try std.testing.expect(p.attributes.len > 0);
        }
    }

    // serialize(parse(serialize(x))) is byte-identical
    const out2 = try write_mod.serialize(aa, rp.loaded.cdata, rp.loaded.map);
    try std.testing.expectEqualSlices(u8, out, out2);
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

test "quantize: dequant baked into node TRS keeps the cube's world bounds" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/box.glb");
    defer loaded.deinit();

    const aabb_before = try worldAabb(loaded.cdata, aa);
    const box_a = findNode(loaded.cdata, "BoxA") orelse return error.NoNode;
    const box_b = findNode(loaded.cdata, "BoxB") orelse return error.NoNode;
    const aabb_a_before = try nodeWorldAabb(loaded.cdata, aa, box_a);
    const aabb_b_before = try nodeWorldAabb(loaded.cdata, aa, box_b);
    const meshes_before: usize = loaded.cdata.meshes_count;
    try std.testing.expectEqual(@as(usize, 1), meshes_before);

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expect(res.quantized_positions > 0);
    // mesh 0 is used by two nodes -> duplicated, one mesh per node
    try std.testing.expectEqual(meshes_before + 1, @as(usize, loaded.cdata.meshes_count));
    try std.testing.expectEqual(@as(u32, 2), res.dequantized_nodes);

    // every mesh-carrying node carries the dequant scale / offset
    var mesh_nodes: usize = 0;
    for (sl(c.cgltf_node, loaded.cdata.nodes, loaded.cdata.nodes_count)) |*n| {
        const mi = ptrIndex(c.cgltf_mesh, loaded.cdata.meshes, loaded.cdata.meshes_count, n.mesh) orelse continue;
        mesh_nodes += 1;
        const b = meshPosBounds(&sl(c.cgltf_mesh, loaded.cdata.meshes, loaded.cdata.meshes_count)[mi]) orelse continue;
        try std.testing.expect(n.has_scale != 0);
        for (0..3) |k| {
            const range = b.mx[k] - b.mn[k];
            if (range != 0) try std.testing.expectApproxEqRel(range, n.scale[k], 1e-5);
        }
    }
    try std.testing.expectEqual(@as(usize, 2), mesh_nodes);

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    var rp = try reparse(aa, "quantize-dequant.glb", out);
    defer {
        rp.loaded.deinit();
        rp.tmp.cleanup();
    }
    try std.testing.expectEqual(
        @as(c_uint, c.cgltf_result_success),
        @as(c_uint, c.cgltf_validate(rp.loaded.cdata)),
    );

    try expectAabbClose(aabb_before, try worldAabb(rp.loaded.cdata, aa));
    const box_a2 = findNode(rp.loaded.cdata, "BoxA") orelse return error.NoNode;
    const box_b2 = findNode(rp.loaded.cdata, "BoxB") orelse return error.NoNode;
    try expectAabbClose(aabb_a_before, try nodeWorldAabb(rp.loaded.cdata, aa, box_a2));
    try expectAabbClose(aabb_b_before, try nodeWorldAabb(rp.loaded.cdata, aa, box_b2));

    // dequant is scale = original position range, translation = t + mn
    // (box nodes are rotation-free, so R is the identity)
    // NB: the node pool was regrown above, so re-resolve the node pointer
    const box_a_after = findNode(loaded.cdata, "BoxA") orelse return error.NoNode;
    const scale_a = box_a_after.scale;
    const trans_a = box_a_after.translation;
    try std.testing.expect(box_a_after.has_scale != 0 and box_a_after.has_translation != 0);
    const mesh_a = &sl(c.cgltf_mesh, loaded.cdata.meshes, loaded.cdata.meshes_count)[0];
    const b = meshPosBounds(mesh_a) orelse return error.NoBounds;
    for (0..3) |k| {
        const range = b.mx[k] - b.mn[k];
        if (range != 0) try std.testing.expectApproxEqRel(range, scale_a[k], 1e-5);
        // BoxA's original translation was (-1.2, 0, 0)
        const expect_t = if (k == 0) -1.2 + b.mn[k] else b.mn[k];
        try std.testing.expectApproxEqAbs(expect_t, trans_a[k], 1e-5);
    }
}

test "quantize: rotated + translated node keeps its world bounds" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/box.glb");
    defer loaded.deinit();

    // single-node fixture: 0.5 on X plus a 90 degree rotation around Y
    (findNode(loaded.cdata, "BoxB") orelse return error.NoNode).mesh = null;
    const box = findNode(loaded.cdata, "BoxA") orelse return error.NoNode;
    box.has_translation = 1;
    box.translation = .{ 0.5, 0, 0 };
    box.has_rotation = 1;
    const s = @sqrt(0.5);
    box.rotation = .{ 0, s, 0, s };

    const rot_before = box.rotation;
    const aabb_before = try worldAabb(loaded.cdata, aa);

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expect(res.quantized_positions > 0);
    try std.testing.expectEqual(@as(usize, 1), @as(usize, loaded.cdata.meshes_count));

    const box_after = findNode(loaded.cdata, "BoxA") orelse return error.NoNode;
    // rotation must be untouched (only translation/scale absorb the dequant)
    try std.testing.expectEqualSlices(f32, rot_before[0..], box_after.rotation[0..]);

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    var rp = try reparse(aa, "quantize-rotated.glb", out);
    defer {
        rp.loaded.deinit();
        rp.tmp.cleanup();
    }
    try expectAabbClose(aabb_before, try worldAabb(rp.loaded.cdata, aa));
}

test "quantize: matrix nodes and skinned meshes keep float positions" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    // MATRIX transform: the dequant cannot be baked into a bare matrix
    {
        var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/box.glb");
        defer loaded.deinit();
        (findNode(loaded.cdata, "BoxB") orelse return error.NoNode).mesh = null;
        (findNode(loaded.cdata, "BoxA") orelse return error.NoNode).has_matrix = 1;

        const res = try run(aa, loaded.cdata, loaded.map, .{});
        try std.testing.expectEqual(@as(u32, 0), res.quantized_positions);
        // uv / normals still quantize: only POSITION needs a node transform
        try std.testing.expect(res.quantized_uvs > 0 or res.quantized_normals > 0);
        const pos = firstAttrAcc(loaded.cdata, c.cgltf_attribute_type_position) orelse return error.NoPosition;
        try std.testing.expectEqual(@as(c.cgltf_component_type, c.cgltf_component_type_r_32f), pos.component_type);
    }

    // skinned node: the shader ignores the node transform, so positions stay
    // in joint space.  (A zeroed skin is enough: only its presence matters.)
    {
        var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/box.glb");
        defer loaded.deinit();
        (findNode(loaded.cdata, "BoxB") orelse return error.NoNode).mesh = null;
        var fake_skin = std.mem.zeroes(c.cgltf_skin);
        (findNode(loaded.cdata, "BoxA") orelse return error.NoNode).skin = @ptrCast(&fake_skin);

        const res = try run(aa, loaded.cdata, loaded.map, .{});
        try std.testing.expectEqual(@as(u32, 0), res.quantized_positions);
        const pos = firstAttrAcc(loaded.cdata, c.cgltf_attribute_type_position) orelse return error.NoPosition;
        try std.testing.expectEqual(@as(c.cgltf_component_type, c.cgltf_component_type_r_32f), pos.component_type);
        try std.testing.expectEqual(@as(usize, 1), @as(usize, loaded.cdata.meshes_count));
    }
}

test "quantize: serialize -> parse -> serialize is byte-stable" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/box.glb");
    defer loaded.deinit();
    _ = try run(aa, loaded.cdata, loaded.map, .{});

    const out1 = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    var rp = try reparse(aa, "quantize-stable.glb", out1);
    defer {
        rp.loaded.deinit();
        rp.tmp.cleanup();
    }
    const out2 = try write_mod.serialize(aa, rp.loaded.cdata, rp.loaded.map);
    try std.testing.expectEqualSlices(u8, out1, out2);
}

fn appendU32(a: std.mem.Allocator, out: *std.ArrayList(u8), v: u32) !void {
    var b: [4]u8 = undefined;
    std.mem.writeInt(u32, &b, v, .little);
    try out.appendSlice(a, &b);
}

/// Minimal GLB: one node -> one mesh with two primitives whose POSITION
/// bounds differ (triangles at x in [0,1] and x in [2,4]).
fn glbTwoPrims(a: std.mem.Allocator, tmp_name: []const u8) !Reparsed {
    const json =
        \\{"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":[0]}],
        \\"nodes":[{"mesh":0}],
        \\"meshes":[{"primitives":[
        \\{"attributes":{"POSITION":0},"indices":2},
        \\{"attributes":{"POSITION":1},"indices":3}]}],
        \\"buffers":[{"byteLength":88}],
        \\"bufferViews":[
        \\{"buffer":0,"byteOffset":0,"byteLength":36},
        \\{"buffer":0,"byteOffset":36,"byteLength":36},
        \\{"buffer":0,"byteOffset":72,"byteLength":6},
        \\{"buffer":0,"byteOffset":80,"byteLength":6}],
        \\"accessors":[
        \\{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[1,1,0]},
        \\{"bufferView":1,"componentType":5126,"count":3,"type":"VEC3","min":[2,2,2],"max":[4,3,2]},
        \\{"bufferView":2,"componentType":5123,"count":3,"type":"SCALAR"},
        \\{"bufferView":3,"componentType":5123,"count":3,"type":"SCALAR"}]}
    ;

    var bin: [88]u8 = @splat(0);
    const pos_a = [9]f32{ 0, 0, 0, 1, 0, 0, 0, 1, 0 };
    const pos_b = [9]f32{ 2, 2, 2, 4, 2, 2, 2, 3, 2 };
    for (pos_a, 0..) |v, k| std.mem.writeInt(u32, bin[k * 4 ..][0..4], @bitCast(v), .little);
    for (pos_b, 0..) |v, k| std.mem.writeInt(u32, bin[36 + k * 4 ..][0..4], @bitCast(v), .little);
    for (0..3) |k| {
        std.mem.writeInt(u16, bin[72 + k * 2 ..][0..2], @intCast(k), .little);
        std.mem.writeInt(u16, bin[80 + k * 2 ..][0..2], @intCast(k), .little);
    }

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(a);
    try out.appendSlice(a, "glTF");
    try appendU32(a, &out, 2);
    try appendU32(a, &out, 0); // total length, patched below
    const pad = (4 - (json.len % 4)) % 4;
    try appendU32(a, &out, @intCast(json.len + pad));
    try appendU32(a, &out, 0x4E4F534A);
    try out.appendSlice(a, json);
    try out.appendNTimes(a, ' ', pad);
    try appendU32(a, &out, 88);
    try appendU32(a, &out, 0x004E4942);
    try out.appendSlice(a, &bin);
    std.mem.writeInt(u32, out.items[8..12], @intCast(out.items.len), .little);

    return reparse(a, tmp_name, out.items);
}

test "quantize: multi-primitive mesh splits per bounds group" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var rp = try glbTwoPrims(aa, "quantize-twoprim.glb");
    defer {
        rp.loaded.deinit();
        rp.tmp.cleanup();
    }
    try std.testing.expectEqual(@as(usize, 1), @as(usize, rp.loaded.cdata.meshes_count));

    const aabb_before = try worldAabb(rp.loaded.cdata, aa);

    const res = try run(aa, rp.loaded.cdata, rp.loaded.map, .{});
    try std.testing.expectEqual(@as(u32, 2), res.quantized_positions); // one accessor per primitive
    // two distinct bounds groups -> mesh split, sibling node for group 2
    try std.testing.expectEqual(@as(usize, 2), @as(usize, rp.loaded.cdata.meshes_count));
    try std.testing.expectEqual(@as(u32, 2), res.dequantized_nodes);

    var found_a = false;
    var found_b = false;
    for (sl(c.cgltf_node, rp.loaded.cdata.nodes, rp.loaded.cdata.nodes_count)) |*n| {
        if (ptrIndex(c.cgltf_mesh, rp.loaded.cdata.meshes, rp.loaded.cdata.meshes_count, n.mesh) == null) continue;
        // group A: unit range; group B: x range 2 (0 range axes become 1)
        if (std.math.approxEqAbs(f32, n.scale[0], 1.0, 1e-5) and
            std.math.approxEqAbs(f32, n.scale[1], 1.0, 1e-5)) found_a = true;
        if (std.math.approxEqAbs(f32, n.scale[0], 2.0, 1e-5) and
            std.math.approxEqAbs(f32, n.scale[1], 1.0, 1e-5)) found_b = true;
    }
    try std.testing.expect(found_a and found_b);

    const out = try write_mod.serialize(aa, rp.loaded.cdata, rp.loaded.map);
    var rp2 = try reparse(aa, "quantize-twoprim-out.glb", out);
    defer {
        rp2.loaded.deinit();
        rp2.tmp.cleanup();
    }
    try std.testing.expectEqual(
        @as(c_uint, c.cgltf_result_success),
        @as(c_uint, c.cgltf_validate(rp2.loaded.cdata)),
    );
    try std.testing.expectEqual(@as(usize, 2), @as(usize, rp2.loaded.cdata.meshes_count));
    try expectAabbClose(aabb_before, try worldAabb(rp2.loaded.cdata, aa));
}

test "quantize: transform-animated nodes keep float positions" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/box.glb");
    defer loaded.deinit();

    (findNode(loaded.cdata, "BoxB") orelse return error.NoNode).mesh = null;
    const box = findNode(loaded.cdata, "BoxA") orelse return error.NoNode;

    // one fake channel animating BoxA's translation (cgltf_free owns the two
    // malloc'd arrays below, so no arena memory leaks into cgltf)
    const anims: [*]c.cgltf_animation = @ptrCast(@alignCast(
        std.c.malloc(@sizeOf(c.cgltf_animation)) orelse return error.OutOfMemory,
    ));
    anims[0] = std.mem.zeroes(c.cgltf_animation);
    const chans: [*]c.cgltf_animation_channel = @ptrCast(@alignCast(
        std.c.malloc(@sizeOf(c.cgltf_animation_channel)) orelse return error.OutOfMemory,
    ));
    chans[0] = std.mem.zeroes(c.cgltf_animation_channel);
    chans[0].target_node = box;
    chans[0].target_path = c.cgltf_animation_path_type_translation;
    anims[0].channels = @ptrCast(chans);
    anims[0].channels_count = 1;
    loaded.cdata.animations = @ptrCast(anims);
    loaded.cdata.animations_count = 1;

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expectEqual(@as(u32, 0), res.quantized_positions);
    const pos = firstAttrAcc(loaded.cdata, c.cgltf_attribute_type_position) orelse return error.NoPosition;
    try std.testing.expectEqual(@as(c.cgltf_component_type, c.cgltf_component_type_r_32f), pos.component_type);
}

// ---------------------------------------------------------------------------
// EXT_meshopt_compression end to end (DamagedHelmet)
// ---------------------------------------------------------------------------

/// JSON chunk of a GLB (unvalidated; tests only run it on our own output).
fn glbJson(bytes: []const u8) ![]const u8 {
    if (bytes.len < 20) return error.BadGlb;
    const jlen: usize = std.mem.readInt(u32, bytes[12..16], .little);
    if (20 + jlen > bytes.len) return error.BadGlb;
    return bytes[20 .. 20 + jlen];
}

fn jsonU64(v: std.json.Value) !u64 {
    return switch (v) {
        .integer => |i| @intCast(i),
        .float => |f| @intFromFloat(f),
        else => error.BadJson,
    };
}

/// Raw (or, for compressed views, compressed-payload) bytes of a parsed view.
fn parsedViewBytes(data: *c.cgltf_data, i: usize) ![]const u8 {
    const views = sl(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count);
    if (i >= views.len) return error.BadView;
    const v = &views[i];
    if (v.has_meshopt_compression != 0) {
        const m = v.meshopt_compression;
        const b = m.buffer orelse return error.NoPayload;
        const bd = b.*.data orelse return error.NoPayload;
        const base: [*]const u8 = @ptrCast(bd);
        const off: usize = @intCast(m.offset);
        const sz: usize = @intCast(m.size);
        const bsize: usize = @intCast(b.*.size);
        if (off > bsize or sz > bsize - off) return error.BadPayload;
        return (base + off)[0..sz];
    }
    if (v.data) |d| {
        const p: [*]const u8 = @ptrCast(d);
        return p[0..v.size];
    }
    const b = v.buffer orelse return error.NoPayload;
    const bd = b.*.data orelse return error.NoPayload;
    const base: [*]const u8 = @ptrCast(bd);
    const bsize: usize = @intCast(b.*.size);
    const off: usize = @intCast(v.offset);
    const sz: usize = @intCast(v.size);
    if (off > bsize or sz > bsize - off) return error.BadPayload;
    return (base + off)[0 .. off + sz];
}

/// First accessor for (mesh, prim, attribute name) in lockstep-walked cdata.
fn primAttrAcc(data: *c.cgltf_data, mi: usize, pi: usize, name: []const u8) ?*c.cgltf_accessor {
    const meshes = sl(c.cgltf_mesh, data.meshes, data.meshes_count);
    if (mi >= meshes.len) return null;
    const prims = sl(c.cgltf_primitive, meshes[mi].primitives, meshes[mi].primitives_count);
    if (pi >= prims.len) return null;
    for (sl(c.cgltf_attribute, prims[pi].attributes, prims[pi].attributes_count)) |*at| {
        if (@intFromPtr(at.name) == 0) continue;
        if (!std.mem.eql(u8, std.mem.span(at.name), name)) continue;
        return @ptrCast(at.data);
    }
    return null;
}

fn unpackFloats(a: std.mem.Allocator, acc: *const c.cgltf_accessor) ![]f32 {
    var cp = acc.*;
    const ncomp = numComponents(cp.type);
    const out = try a.alloc(f32, @as(usize, @intCast(acc.count)) * ncomp);
    if (cp.stride == 0) cp.stride = c.cgltf_calc_size(cp.type, cp.component_type);
    const got = c.cgltf_accessor_unpack_floats(&cp, out.ptr, out.len);
    if (got < out.len) return error.UnpackFailed;
    return out;
}

/// Spec-shape assertions on the emitted JSON: extension objects, decompressed
/// byteLength, extensionsUsed + extensionsRequired, fallback buffer.
fn expectMeshoptJson(json_bytes: []const u8, n_views: usize) !void {
    const a = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(std.json.Value, a, json_bytes, .{});
    defer parsed.deinit();
    const root = parsed.value.object.get("bufferViews") orelse return error.NoViews;
    try std.testing.expectEqual(n_views, root.array.items.len);

    var n_mc: usize = 0;
    for (root.array.items) |vj| {
        const vo = vj.object;
        const exts = vo.get("extensions") orelse continue;
        const mcj = exts.object.get("EXT_meshopt_compression") orelse continue;
        n_mc += 1;
        const mco = mcj.object;
        const byte_stride = try jsonU64(mco.get("byteStride") orelse return error.NoField);
        const count = try jsonU64(mco.get("count") orelse return error.NoField);
        _ = try jsonU64(mco.get("buffer") orelse return error.NoField);
        _ = try jsonU64(mco.get("byteOffset") orelse return error.NoField);
        _ = try jsonU64(mco.get("byteLength") orelse return error.NoField);
        const mode = mco.get("mode") orelse return error.NoField;
        try std.testing.expect(mode == .string);
        const ok_mode = std.mem.eql(u8, mode.string, "ATTRIBUTES") or
            std.mem.eql(u8, mode.string, "TRIANGLES") or
            std.mem.eql(u8, mode.string, "INDICES");
        try std.testing.expect(ok_mode);
        if (mco.get("filter")) |f| {
            try std.testing.expect(f == .string);
            try std.testing.expect(std.mem.eql(u8, f.string, "OCTAHEDRAL"));
        }
        // Parent byteLength reports the DECOMPRESSED size loaders allocate.
        const parent_len = try jsonU64(vo.get("byteLength") orelse return error.NoField);
        try std.testing.expectEqual(byte_stride * count, parent_len);
    }
    try std.testing.expect(n_mc > 0);

    for ([_]struct { key: []const u8 }{ .{ .key = "extensionsUsed" }, .{ .key = "extensionsRequired" } }) |k| {
        const arr = parsed.value.object.get(k.key) orelse return error.NoExts;
        var found = false;
        for (arr.array.items) |e| {
            if (e == .string and std.mem.eql(u8, e.string, "EXT_meshopt_compression")) found = true;
        }
        try std.testing.expect(found);
    }

    // Fallback buffer: no uri, tagged, big enough for the decompressed views.
    const buffers = parsed.value.object.get("buffers") orelse return error.NoBuffers;
    try std.testing.expectEqual(@as(usize, 2), buffers.array.items.len);
    const fb = buffers.array.items[1].object;
    try std.testing.expect(fb.get("uri") == null);
    const fb_ext = fb.get("extensions") orelse return error.NoExts;
    const fb_mc = fb_ext.object.get("EXT_meshopt_compression") orelse return error.NoExts;
    const fb_flag = fb_mc.object.get("fallback") orelse return error.NoExts;
    try std.testing.expect(fb_flag == .bool and fb_flag.bool);
}

/// Index component read with a runtime stride.
fn readIdx(raw: []const u8, s: usize, k: usize) u32 {
    return switch (s) {
        1 => raw[k],
        2 => std.mem.readInt(u16, raw[k * 2 ..][0..2], .little),
        else => std.mem.readInt(u32, raw[k * 4 ..][0..4], .little),
    };
}

/// Decode every compressed view and check it against the ORIGINAL input data,
/// correlated by (mesh, primitive, attribute) path (quantize appends pools, so
/// pool indices do not line up). Vertex payloads re-encode to themselves
/// (codec fixpoint); triangle lists compare rotation-insensitively (the
/// encoder rotates within a triangle, winding preserved); normalized integer
/// data dequantizes back to the original floats within tolerance.
fn expectMeshoptDecodes(a: std.mem.Allocator, orig: *c.cgltf_data, comp: *c.cgltf_data) !void {
    try std.testing.expectEqual(orig.meshes_count, comp.meshes_count);

    // Payload-level checks: no cross-file correlation needed.
    const views = sl(c.cgltf_buffer_view, comp.buffer_views, comp.buffer_views_count);
    for (views, 0..) |*v, i| {
        if (v.has_meshopt_compression == 0) continue;
        const m = v.meshopt_compression;
        const stride: usize = @intCast(m.stride);
        const count: usize = @intCast(m.count);
        const payload = try parsedViewBytes(comp, i);

        if (m.mode == c.cgltf_meshopt_compression_mode_attributes) {
            const dec = try a.alloc(u8, count * stride);
            defer a.free(dec);
            try mc.decodeVertices(dec, payload, count, stride);
            const re = try mc.encodeVertices(a, dec, count, stride);
            defer a.free(re);
            try std.testing.expectEqualSlices(u8, payload, re);

            if (m.filter == c.cgltf_meshopt_compression_filter_octahedral) {
                try mc.decodeFilterOct(dec, count, stride);
                var k: usize = 0;
                while (k < count) : (k += 1) {
                    const x: f32 = @as(f32, @floatFromInt(std.mem.readInt(i16, dec[k * stride ..][0..2], .little))) / 32767.0;
                    const y: f32 = @as(f32, @floatFromInt(std.mem.readInt(i16, dec[k * stride + 2 ..][0..2], .little))) / 32767.0;
                    const z: f32 = @as(f32, @floatFromInt(std.mem.readInt(i16, dec[k * stride + 4 ..][0..2], .little))) / 32767.0;
                    try std.testing.expectApproxEqAbs(1.0, @sqrt(x * x + y * y + z * z), 0.02);
                }
            }
        }
    }

    // Value checks against the original input, per (mesh, prim, attribute).
    const om = sl(c.cgltf_mesh, orig.meshes, orig.meshes_count);
    const cm = sl(c.cgltf_mesh, comp.meshes, comp.meshes_count);
    for (om, 0..) |_, mi| {
        const oprims = sl(c.cgltf_primitive, om[mi].primitives, om[mi].primitives_count);
        const cprims = sl(c.cgltf_primitive, cm[mi].primitives, cm[mi].primitives_count);
        try std.testing.expectEqual(oprims.len, cprims.len);
        for (oprims, 0..) |_, pi| {
            // Indices: rotation-insensitive triple sets (or exact sequences).
            if (@intFromPtr(oprims[pi].indices) != 0) {
                const oa: *c.cgltf_accessor = @ptrCast(oprims[pi].indices);
                const ca: *c.cgltf_accessor = @ptrCast(cprims[pi].indices);
                const cvi = ptrIndex(c.cgltf_buffer_view, comp.buffer_views, comp.buffer_views_count, ca.buffer_view) orelse return error.NoAcc;
                const cv = &sl(c.cgltf_buffer_view, comp.buffer_views, comp.buffer_views_count)[cvi];
                if (cv.has_meshopt_compression != 0) {
                    const mcc = cv.meshopt_compression;
                    const s_new: usize = @intCast(mcc.stride);
                    const n: usize = @intCast(mcc.count);
                    try std.testing.expectEqual(oa.count, n);
                    const s_orig: usize = @intCast(c.cgltf_calc_size(oa.type, oa.component_type));
                    const ovi = ptrIndex(c.cgltf_buffer_view, orig.buffer_views, orig.buffer_views_count, oa.buffer_view) orelse return error.NoAcc;
                    const raw_o = try parsedViewBytes(orig, ovi);
                    try std.testing.expectEqual(n * s_orig, raw_o.len);
                    const payload = try parsedViewBytes(comp, cvi);
                    const dec = try a.alloc(u8, n * s_new);
                    defer a.free(dec);
                    const seq = mcc.mode == c.cgltf_meshopt_compression_mode_indices;
                    try mc.decodeIndices(dec, payload, n, s_new, seq);
                    if (seq) {
                        for (0..n) |k| try std.testing.expectEqual(readIdx(raw_o, s_orig, k), readIdx(dec, s_new, k));
                    } else {
                        try std.testing.expectEqual(@as(usize, 0), n % 3);
                        var t: usize = 0;
                        while (t < n) : (t += 3) {
                            var got = [_]u32{ readIdx(dec, s_new, t), readIdx(dec, s_new, t + 1), readIdx(dec, s_new, t + 2) };
                            var want = [_]u32{ readIdx(raw_o, s_orig, t), readIdx(raw_o, s_orig, t + 1), readIdx(raw_o, s_orig, t + 2) };
                            std.mem.sort(u32, &got, {}, std.sort.asc(u32));
                            std.mem.sort(u32, &want, {}, std.sort.asc(u32));
                            try std.testing.expectEqualSlices(u32, &want, &got);
                        }
                    }
                }
            }
            // Attributes: float data compares exactly, normalized integer
            // data dequantizes back within its quantization tolerance.
            for ([_]struct { name: []const u8, is_position: bool }{ .{ .name = "POSITION", .is_position = true }, .{ .name = "NORMAL", .is_position = false }, .{ .name = "TANGENT", .is_position = false }, .{ .name = "TEXCOORD_0", .is_position = false }, .{ .name = "TEXCOORD_1", .is_position = false } }) |attr| {
                const oa = primAttrAcc(orig, mi, pi, attr.name) orelse continue;
                const ca = primAttrAcc(comp, mi, pi, attr.name) orelse return error.NoAcc;
                const cvi = ptrIndex(c.cgltf_buffer_view, comp.buffer_views, comp.buffer_views_count, ca.buffer_view) orelse return error.NoAcc;
                const cv = &sl(c.cgltf_buffer_view, comp.buffer_views, comp.buffer_views_count)[cvi];
                if (cv.has_meshopt_compression == 0) continue;
                const mcc = cv.meshopt_compression;
                const cstride: usize = @intCast(mcc.stride);
                const ccount: usize = @intCast(mcc.count);
                try std.testing.expectEqual(oa.count, ccount);
                const of = try unpackFloats(a, oa);
                defer a.free(of);
                const payload = try parsedViewBytes(comp, cvi);
                const dec = try a.alloc(u8, ccount * cstride);
                defer a.free(dec);
                try mc.decodeVertices(dec, payload, ccount, cstride);
                if (mcc.filter == c.cgltf_meshopt_compression_filter_octahedral) try mc.decodeFilterOct(dec, ccount, cstride);
                const ncomp = numComponents(ca.type);
                const ccomp = ca.component_type;
                // Original per-component bounds (only POSITION accessors
                // carry min/max; UVs normalize against these same bounds).
                var omn = [_]f32{ 0, 0, 0, 0 };
                var omx = [_]f32{ 0, 0, 0, 0 };
                for (0..ncomp) |ax| {
                    omn[ax] = of[ax];
                    omx[ax] = of[ax];
                }
                for (1..ccount) |k| {
                    for (0..ncomp) |ax| {
                        const v = of[k * ncomp + ax];
                        if (v < omn[ax]) omn[ax] = v;
                        if (v > omx[ax]) omx[ax] = v;
                    }
                }
                for (0..ccount) |k| {
                    for (0..ncomp) |ax| {
                        const want = of[k * ncomp + ax];
                        if (ccomp == c.cgltf_component_type_r_32f) {
                            const got = std.mem.readInt(u32, dec[k * cstride + ax * 4 ..][0..4], .little);
                            try std.testing.expectEqual(@as(u32, @bitCast(want)), got);
                        } else {
                            const is_signed = ccomp == c.cgltf_component_type_r_16 or ccomp == c.cgltf_component_type_r_8;
                            if (!is_signed and ccomp != c.cgltf_component_type_r_16u and ccomp != c.cgltf_component_type_r_8u) return error.BadComp;
                            const code: f32 = if (is_signed)
                                @as(f32, @floatFromInt(std.mem.readInt(i16, dec[k * cstride + ax * 2 ..][0..2], .little))) / 32767.0
                            else
                                @as(f32, @floatFromInt(std.mem.readInt(u16, dec[k * cstride + ax * 2 ..][0..2], .little))) / 65535.0;
                            // POSITION dequantizes through the accessor
                            // bounds (== original bounds); UVs through the
                            // original bounds; snorm through itself.
                            const lo = if (attr.is_position) ca.min[ax] else omn[ax];
                            const hi = if (attr.is_position) ca.max[ax] else omx[ax];
                            const orange = hi - lo;
                            const got = if (is_signed) code else if (orange > 0) lo + code * orange else lo;
                            // 14-bit positions, 12-bit UVs / oct normals.
                            const tol: f32 = if (attr.is_position) @max(orange / 4096.0, 1e-6) else if (!is_signed) @max(orange / 2048.0, 1e-6) else 0.02;
                            try std.testing.expectApproxEqAbs(want, got, tol);
                        }
                    }
                }
            }
        }
    }
}

fn meshoptHelmetOn() !void {
    const a = std.testing.allocator;
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var orig_l = try parse_mod.loadFile(io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer orig_l.deinit();

    var loaded = try parse_mod.loadFile(io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded.deinit();

    const res = try run(aa, loaded.cdata, loaded.map, .{ .meshopt_compression = true });
    try std.testing.expect(!res.meshopt_no_codec);
    try std.testing.expect(res.meshopt_views > 0);
    std.debug.print("quantize+meshopt helmet: meshopt_views={d}\n", .{res.meshopt_views});

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    // Deterministic: serializing the same cdata twice is byte-identical.
    const out_again = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    try std.testing.expectEqualSlices(u8, out, out_again);

    var rp = try reparse(aa, "quantize-meshopt-helmet.glb", out);
    defer {
        rp.loaded.deinit();
        rp.tmp.cleanup();
    }
    // JSON check against the emitted (kept) view count, not the pool count.
    try expectMeshoptJson(try glbJson(out), rp.loaded.cdata.buffer_views_count);

    // cgltf validates our stride/count/mode/filter declarations.
    try std.testing.expectEqual(
        @as(c_uint, c.cgltf_result_success),
        @as(c_uint, c.cgltf_validate(rp.loaded.cdata)),
    );
    // NOTE: value checks run on the REPARSED output: only there do the
    // extension's (buffer, byteOffset) references resolve to real bytes.
    // (The reparse inflates meshopt views at load, so the payload loops
    // inside become no-ops — inflated-data checks live in parse/write
    // tests; here we pin the inflate itself.)
    try expectMeshoptDecodes(aa, orig_l.cdata, rp.loaded.cdata);
    for (sl(c.cgltf_buffer_view, rp.loaded.cdata.buffer_views, rp.loaded.cdata.buffer_views_count)) |*v| {
        try std.testing.expectEqual(@as(c_int, 0), v.has_meshopt_compression);
    }
    try std.testing.expectEqual(orig_l.cdata.meshes_count, rp.loaded.cdata.meshes_count);
}

fn meshoptHelmetNoCodec() !void {
    const a = std.testing.allocator;
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded.deinit();
    const res = try run(aa, loaded.cdata, loaded.map, .{ .meshopt_compression = true });
    try std.testing.expect(res.meshopt_no_codec);
    try std.testing.expectEqual(@as(u32, 0), res.meshopt_views);

    // The flag is a pure no-op: output identical to the plain quantize path.
    const out_on = try write_mod.serialize(aa, loaded.cdata, loaded.map);

    var loaded2 = try parse_mod.loadFile(io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded2.deinit();
    _ = try run(aa, loaded2.cdata, loaded2.map, .{});
    const out_off = try write_mod.serialize(aa, loaded2.cdata, loaded2.map);
    try std.testing.expectEqualSlices(u8, out_on, out_off);
}

test "quantize meshopt_compression end to end" {
    if (mc.have_codec) {
        try meshoptHelmetOn();
    } else {
        try meshoptHelmetNoCodec();
    }
}
