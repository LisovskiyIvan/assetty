//! Shared geometry builder for the cdata-level ops (`weld`, `join`, ...).
//!
//! An op reads the *old* geometry out of the mapped GLB, computes the new
//! element streams in Zig-owned memory, and registers them with a `Builder`.
//! `Builder` grows the BIN payload and appends buffer views / accessors to the
//! cgltf pools exactly once, at `finish()`.
//!
//! # Why the pool growth is a single step at the end
//!
//! cgltf stores references between pool elements as raw pointers (`accessor*`,
//! `buffer_view*`), and pointer identity is how the writer's reachability GC
//! maps a reference back to a pool index. Reallocating a pool mid-run would
//! invalidate every pointer held elsewhere, so all new elements are kept in
//! Zig-side arrays and flushed in one pass:
//!
//!  1. copy the old BIN bytes into a bigger allocation (`old_size` + aligned
//!     new section) and point `buffers[0].data` at it,
//!  2. allocate a bigger `buffer_views` array, copy the old entries, remap
//!     every `buffer_view*` reference in the graph, append the new views,
//!  3. same for `accessors` (their `buffer_view` pointers point into the new
//!     views array),
//!  4. free the old pool arrays with cgltf's own allocator.
//!
//! Everything the op registered is then reachable through `resolve()`, which
//! maps the Zig-side accessor pointer to its slot in the new pool.
//!
//! Orphaned old accessors / views are simply left in the pools: the writer's
//! GC drops anything no longer referenced when the asset is serialized.

const std = @import("std");
const c = @import("cgltf");
const builtin = @import("builtin");

comptime {
    if (builtin.cpu.arch.endian() != .little) {
        @compileError("geometry builder assumes a little-endian host (GLB payload)");
    }
}

// ---------------------------------------------------------------------------
// cgltf helpers
// ---------------------------------------------------------------------------

pub fn sl(comptime T: type, ptr: [*c]T, n: usize) []T {
    if (n == 0 or @intFromPtr(ptr) == 0) return &.{};
    return ptr[0..n];
}

/// Pool index of `p` in `base[0..count]`, or null when `p` is null,
/// misaligned or outside the pool (corrupt input). Never subtracts raw
/// pointers.
pub fn ptrIndex(comptime T: type, base: [*c]T, count: usize, p: [*c]T) ?u32 {
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

pub fn numComponents(t: c.cgltf_type) usize {
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

pub fn componentSize(t: c.cgltf_component_type) usize {
    return switch (t) {
        1, 2 => 1, // BYTE, UNSIGNED_BYTE
        3, 4 => 2, // SHORT, UNSIGNED_SHORT
        5, 6 => 4, // UNSIGNED_INT, FLOAT
        else => 4,
    };
}

/// Payload bytes of a buffer view. `view.data` (meshopt / extension data)
/// overrides `buffer->data` exactly like cgltf does.
pub fn viewData(v: *const c.cgltf_buffer_view) ?[]const u8 {
    const size: usize = @intCast(v.size);
    if (v.data) |d| {
        const p: [*]const u8 = @ptrCast(d);
        return p[0..size];
    }
    if (@intFromPtr(v.buffer) == 0) return null;
    const bd = v.buffer.*.data orelse return null;
    const off: usize = @intCast(v.offset);
    const bsize: usize = @intCast(v.buffer.*.size);
    if (off > bsize or size > bsize - off) return null;
    const p: [*]const u8 = @ptrCast(bd);
    return p[off .. off + size];
}

/// Payload bytes of a buffer view, meshopt-aware. Writer-produced meshopt
/// views (`quantize` `meshopt_compression`) keep the COMPRESSED payload in
/// `data` while `size` reports the DECOMPRESSED length: the payload is sliced
/// by `meshopt_compression.size`, not by the view. (Parsed meshopt files are
/// inflated at load, so they never take this branch — only fresh op output
/// does.) Plain views behave exactly like `viewData`.
pub fn viewBytes(v: *const c.cgltf_buffer_view) ?[]const u8 {
    if (v.has_meshopt_compression != 0) {
        const d = v.data orelse return null;
        const p: [*]const u8 = @ptrCast(d);
        const n: usize = @intCast(v.meshopt_compression.size);
        return p[0..n];
    }
    return viewData(v);
}

/// Allocate raw bytes through cgltf's allocator hooks, so that `cgltf_free`
/// (which releases `buffer_view.data` with the same hooks) stays balanced.
/// Falls back to libc malloc when the data carries no allocator.
pub fn allocRaw(data: *const c.cgltf_data, n: usize) ?[*]u8 {
    const mem = data.memory;
    if (mem.alloc_func) |f| {
        const p = f(mem.user_data, n) orelse return null;
        return @ptrCast(p);
    }
    const p = std.c.malloc(n) orelse return null;
    return @ptrCast(p);
}

pub fn freeRaw(data: *const c.cgltf_data, p: anytype) void {
    const mem = data.memory;
    if (mem.free_func) |f| {
        f(mem.user_data, @ptrCast(@constCast(p)));
    } else {
        std.c.free(@ptrCast(@constCast(p)));
    }
}

/// A strided element stream over one accessor (stride 0 == natural).
pub const Stream = struct {
    data: []const u8 = &.{},
    elem: usize = 0,
    stride: usize = 0,
    count: usize = 0,

    pub fn init(acc: *const c.cgltf_accessor) ?Stream {
        if (acc.is_sparse != 0) return null;
        if (@intFromPtr(acc.buffer_view) == 0) return null;
        const view: *const c.cgltf_buffer_view = @ptrCast(acc.buffer_view);
        if (view.has_meshopt_compression != 0) return null;

        const elem: usize = @intCast(c.cgltf_calc_size(acc.type, acc.component_type));
        if (elem == 0) return null;
        const count: usize = @intCast(acc.count);
        // stride comes from the file: checked cast, corrupt values fail the stream.
        var stride: usize = std.math.cast(usize, acc.stride) orelse return null;
        if (stride == 0) stride = elem;

        const d = viewData(view) orelse return null;
        const off: usize = @intCast(acc.offset);
        if (count == 0) return .{ .elem = elem, .stride = stride, .count = 0 };
        if (off > d.len) return null;
        const span = std.math.mul(usize, count - 1, stride) catch return null;
        const need = std.math.add(usize, span, elem) catch return null;
        if (need > d.len - off) return null;
        return .{ .data = d[off..], .elem = elem, .stride = stride, .count = count };
    }

    pub fn at(self: Stream, i: usize) []const u8 {
        return self.data[i * self.stride ..][0..self.elem];
    }
};

/// Index accessor reader (UNSIGNED_BYTE / UNSIGNED_SHORT / UNSIGNED_INT).
pub const IndexReader = struct {
    s: Stream,
    ct: c.cgltf_component_type,

    pub fn init(acc: *const c.cgltf_accessor) ?IndexReader {
        const ct = acc.component_type;
        const esz: usize = switch (ct) {
            2 => 1, // UNSIGNED_BYTE
            4 => 2, // UNSIGNED_SHORT
            5 => 4, // UNSIGNED_INT
            else => return null,
        };
        const s = Stream.init(acc) orelse return null;
        if (s.elem != esz) return null;
        return .{ .s = s, .ct = ct };
    }

    pub fn count(self: IndexReader) usize {
        return self.s.count;
    }

    pub fn get(self: IndexReader, i: usize) u32 {
        const p = self.s.at(i);
        return switch (self.ct) {
            2 => p[0],
            4 => std.mem.readInt(u16, p[0..2], .little),
            else => std.mem.readInt(u32, p[0..4], .little),
        };
    }
};

pub fn readF32(p: []const u8, comp: usize) f32 {
    return @bitCast(std.mem.readInt(u32, p[comp * 4 ..][0..4], .little));
}

pub fn writeF32(p: []u8, comp: usize, v: f32) void {
    std.mem.writeInt(u32, p[comp * 4 ..][0..4], @bitCast(v), .little);
}

pub const Bounds = struct {
    min: [16]f32 = @splat(0),
    max: [16]f32 = @splat(0),
};

/// min/max over a tightly packed FLOAT element stream.
pub fn f32Bounds(bytes: []const u8, elem: usize, count: usize, ncomp: usize) ?Bounds {
    if (count == 0 or ncomp == 0 or ncomp > 16) return null;
    if (elem != ncomp * 4 or bytes.len < count * elem) return null;
    var out: Bounds = .{};
    for (0..ncomp) |k| {
        out.min[k] = readF32(bytes, k);
        out.max[k] = readF32(bytes, k);
    }
    var i: usize = 1;
    while (i < count) : (i += 1) {
        const base = i * elem;
        for (0..ncomp) |k| {
            const v = readF32(bytes[base..], k);
            if (v < out.min[k]) out.min[k] = v;
            if (v > out.max[k]) out.max[k] = v;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// cgltf-allocator backed pooling
// ---------------------------------------------------------------------------

/// Allocate with cgltf's own allocator so `cgltf_free` can release it.
pub fn cgltfAlloc(comptime T: type, d: *c.cgltf_data, n: usize) ![]T {
    const alloc_fn = d.memory.alloc_func orelse return error.NoCgltfAllocator;
    const bytes = std.math.mul(usize, @sizeOf(T), n) catch return error.OutOfMemory;
    const raw = alloc_fn(d.memory.user_data, bytes) orelse return error.OutOfMemory;
    const p: [*]T = @ptrCast(@alignCast(raw));
    return p[0..n];
}

pub fn cgltfFree(comptime T: type, d: *c.cgltf_data, ptr: [*c]T, n: usize) void {
    if (n == 0 or @intFromPtr(ptr) == 0) return;
    const free_fn = d.memory.free_func orelse return;
    free_fn(d.memory.user_data, @ptrCast(ptr));
}

/// Release a loaded buffer payload according to how cgltf acquired it.
fn releaseBuffer(d: *c.cgltf_data, buf: [*c]c.cgltf_buffer) void {
    const p = buf.*.data orelse return;
    switch (@as(u32, @intCast(buf.*.data_free_method))) {
        1 => { // cgltf_data_free_method_file_release
            if (d.file.release) |rel| {
                rel(&d.memory, &d.file, p, buf.*.size);
            } else if (d.memory.free_func) |free_fn| {
                free_fn(d.memory.user_data, p);
            }
        },
        2 => { // cgltf_data_free_method_memory_free
            if (d.memory.free_func) |free_fn| free_fn(d.memory.user_data, p);
        },
        else => {}, // points into the caller's file bytes (mmap): not ours
    }
}

// ---------------------------------------------------------------------------
// pointer remapping
// ---------------------------------------------------------------------------

/// Rewrite `slot.*` by the offset it had inside the old pool array, when it
/// points into that array. Pointers outside the pool are left untouched.
fn remapPtr(
    comptime T: type,
    old_base: [*c]T,
    old_count: usize,
    new_base: [*c]T,
    slot: *[*c]T,
) void {
    if (@intFromPtr(slot.*) == 0) return;
    if (old_count == 0 or @intFromPtr(old_base) == 0) return;
    const old_start: usize = @intFromPtr(old_base);
    const p: usize = @intFromPtr(slot.*);
    if (p < old_start) return;
    const off = p - old_start;
    if (off >= old_count * @sizeOf(T)) return;
    if (off % @sizeOf(T) != 0) return;
    slot.* = @ptrFromInt(@intFromPtr(new_base) + off);
}

fn remapAttrData(
    comptime T: type,
    old_base: [*c]T,
    old_count: usize,
    new_base: [*c]T,
    attrs: [*c]c.cgltf_attribute,
    n: usize,
) void {
    for (sl(c.cgltf_attribute, attrs, n)) |*at| {
        remapPtr(T, old_base, old_count, new_base, &at.data);
    }
}

fn remapAccessorRefs(
    d: *c.cgltf_data,
    old_base: [*c]c.cgltf_accessor,
    old_count: usize,
    new_base: [*c]c.cgltf_accessor,
) void {
    for (sl(c.cgltf_mesh, d.meshes, d.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            remapPtr(c.cgltf_accessor, old_base, old_count, new_base, &p.indices);
            remapAttrData(c.cgltf_accessor, old_base, old_count, new_base, p.attributes, p.attributes_count);
            for (sl(c.cgltf_morph_target, p.targets, p.targets_count)) |*t| {
                remapAttrData(c.cgltf_accessor, old_base, old_count, new_base, t.attributes, t.attributes_count);
            }
            if (p.has_draco_mesh_compression != 0) {
                remapAttrData(
                    c.cgltf_accessor,
                    old_base,
                    old_count,
                    new_base,
                    p.draco_mesh_compression.attributes,
                    p.draco_mesh_compression.attributes_count,
                );
            }
        }
    }
    for (sl(c.cgltf_node, d.nodes, d.nodes_count)) |*n| {
        if (n.has_mesh_gpu_instancing != 0) {
            remapAttrData(
                c.cgltf_accessor,
                old_base,
                old_count,
                new_base,
                n.mesh_gpu_instancing.attributes,
                n.mesh_gpu_instancing.attributes_count,
            );
        }
    }
    for (sl(c.cgltf_animation, d.animations, d.animations_count)) |*an| {
        for (sl(c.cgltf_animation_sampler, an.samplers, an.samplers_count)) |*s| {
            remapPtr(c.cgltf_accessor, old_base, old_count, new_base, &s.input);
            remapPtr(c.cgltf_accessor, old_base, old_count, new_base, &s.output);
        }
    }
    for (sl(c.cgltf_skin, d.skins, d.skins_count)) |*sk| {
        remapPtr(c.cgltf_accessor, old_base, old_count, new_base, &sk.inverse_bind_matrices);
    }
}

fn remapViewRefs(
    d: *c.cgltf_data,
    old_base: [*c]c.cgltf_buffer_view,
    old_count: usize,
    new_base: [*c]c.cgltf_buffer_view,
) void {
    for (sl(c.cgltf_accessor, d.accessors, d.accessors_count)) |*acc| {
        remapPtr(c.cgltf_buffer_view, old_base, old_count, new_base, &acc.buffer_view);
        if (acc.is_sparse != 0) {
            remapPtr(c.cgltf_buffer_view, old_base, old_count, new_base, &acc.sparse.indices_buffer_view);
            remapPtr(c.cgltf_buffer_view, old_base, old_count, new_base, &acc.sparse.values_buffer_view);
        }
    }
    for (sl(c.cgltf_image, d.images, d.images_count)) |*im| {
        remapPtr(c.cgltf_buffer_view, old_base, old_count, new_base, &im.buffer_view);
    }
    for (sl(c.cgltf_mesh, d.meshes, d.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            if (p.has_draco_mesh_compression != 0) {
                remapPtr(
                    c.cgltf_buffer_view,
                    old_base,
                    old_count,
                    new_base,
                    &p.draco_mesh_compression.buffer_view,
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Accessor / buffer-view pool regrow (shared by `quantize`, `simplify`).
//
// New entries are staged in Zig-side arrays and flushed into regrown cgltf
// pools once; every accessor / buffer-view reference in the graph is then
// remapped to the new arrays. The old pool arrays are released through
// cgltf's hooks; their string / extras pointers live on in the copied
// entries, so nothing is double-freed (`cgltf_free` only walks the arrays
// currently registered in `data`).
// ---------------------------------------------------------------------------

pub const Pool = struct {
    acc: std.ArrayListUnmanaged(c.cgltf_accessor) = .empty,
    view: std.ArrayListUnmanaged(c.cgltf_buffer_view) = .empty,

    pub fn deinit(self: *Pool, a: std.mem.Allocator) void {
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
/// regrown pools. `new_acc` holds copies of the old entries at the same
/// indices (appended entries last), same for `new_view`.
pub fn remapRefs(
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
/// No-op when the pool staged nothing.
pub fn commitPools(data: *c.cgltf_data, pool: *Pool) !void {
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
// Builder
// ---------------------------------------------------------------------------

/// Accumulates new geometry and flushes it into the cgltf data in one step.
///
/// `addView` / `addAccessor` return pool *indices* (views) and Zig-side
/// accessor pointers. The pointers are only turned into pool pointers by
/// `finish()`; use `resolve()` afterwards to write them into primitives.
///
/// Precondition: `data` comes from `cgltf_parse` (its pools and buffer payload
/// live on `data.memory`). `finish()` replaces the accessor / buffer_view
/// arrays and frees the old ones with that allocator — hand-built cgltf data
/// must allocate its pools the same way.
pub const Builder = struct {
    a: std.mem.Allocator,
    data: *c.cgltf_data,
    /// offset of the new BIN section inside `buffers[0]`
    base: usize = 0,
    bin: std.ArrayList(u8) = .empty,
    views: std.ArrayList(c.cgltf_buffer_view) = .empty,
    accs: std.ArrayList(*c.cgltf_accessor) = .empty,
    acc_view: std.ArrayList(usize) = .empty,
    acc_start: usize = 0,
    view_start: usize = 0,
    /// zig-owned accessor address -> new pool index, filled by `finish`
    final_map: std.AutoHashMapUnmanaged(usize, usize) = .empty,
    finished: bool = false,

    pub fn init(a: std.mem.Allocator, data: *c.cgltf_data) !Builder {
        if (data.buffers_count == 0) return error.NoBuffer;
        const b = &sl(c.cgltf_buffer, data.buffers, data.buffers_count)[0];
        return .{
            .a = a,
            .data = data,
            .base = std.mem.alignForward(usize, @intCast(b.size), 4),
            .acc_start = @intCast(data.accessors_count),
            .view_start = @intCast(data.buffer_views_count),
        };
    }

    pub fn deinit(self: *Builder) void {
        for (self.accs.items) |ap| self.a.destroy(ap);
        self.accs.deinit(self.a);
        self.acc_view.deinit(self.a);
        self.views.deinit(self.a);
        self.bin.deinit(self.a);
        self.final_map.deinit(self.a);
        self.* = undefined;
    }

    pub fn hasWork(self: *const Builder) bool {
        return self.views.items.len != 0;
    }

    /// Append `bytes` as a new buffer view; returns its (future) pool index.
    pub fn addView(self: *Builder, bytes: []const u8, target: c_uint) !usize {
        const pad = (4 - (self.bin.items.len % 4)) % 4;
        if (pad != 0) try self.bin.appendNTimes(self.a, 0, pad);
        const rel = self.bin.items.len;
        try self.bin.appendSlice(self.a, bytes);

        var v = std.mem.zeroes(c.cgltf_buffer_view);
        v.buffer = self.data.buffers; // buffers[0]
        v.offset = self.base + rel;
        v.size = bytes.len;
        v.type = switch (target) {
            34963 => 1, // ELEMENT_ARRAY_BUFFER
            34962 => 2, // ARRAY_BUFFER
            else => 0,
        };
        try self.views.append(self.a, v);
        return self.view_start + self.views.items.len - 1;
    }

    /// Append an accessor over an already-added view. `min`/`max` are only
    /// meaningful for POSITION; the returned pointer may be mutated (e.g. to
    /// fill in bounds) until `finish()`.
    pub fn addAccessor(
        self: *Builder,
        view_idx: usize,
        byte_offset: usize,
        component_type: c_uint,
        dim: c_uint,
        count: usize,
        normalized: bool,
        min: ?[]const f32,
        max: ?[]const f32,
    ) !*c.cgltf_accessor {
        const ap = try self.a.create(c.cgltf_accessor);
        errdefer self.a.destroy(ap);
        ap.* = std.mem.zeroes(c.cgltf_accessor);
        ap.component_type = component_type;
        ap.type = dim;
        ap.count = count;
        ap.offset = byte_offset;
        ap.normalized = @intFromBool(normalized);
        ap.stride = c.cgltf_calc_size(dim, component_type);
        if (min) |m| {
            ap.has_min = 1;
            for (m, 0..) |v, k| {
                if (k >= 16) break;
                ap.min[k] = v;
            }
        }
        if (max) |m| {
            ap.has_max = 1;
            for (m, 0..) |v, k| {
                if (k >= 16) break;
                ap.max[k] = v;
            }
        }
        try self.accs.append(self.a, ap);
        errdefer _ = self.accs.pop();
        try self.acc_view.append(self.a, view_idx);
        return ap;
    }

    /// Tightly packed FLOAT accessor (`dim` components per element).
    pub fn addF32(self: *Builder, flat: []const f32, dim: c_uint) !*c.cgltf_accessor {
        const vi = try self.addView(std.mem.sliceAsBytes(flat), 34962);
        const n = if (dim == 0) 0 else flat.len / dim;
        return self.addAccessor(vi, 0, 6, dim, n, false, null, null);
    }

    /// Index accessor, UNSIGNED_SHORT when the range allows it.
    pub fn addIndices(self: *Builder, idx: []const u32) !*c.cgltf_accessor {
        var max: u32 = 0;
        for (idx) |v| {
            if (v > max) max = v;
        }
        if (max <= 0xffff) return self.addU16Indices(idx);
        return self.addU32Indices(idx);
    }

    pub fn addU16Indices(self: *Builder, idx: []const u32) !*c.cgltf_accessor {
        const bytes = try self.a.alloc(u8, idx.len * 2);
        defer self.a.free(bytes);
        for (idx, 0..) |v, i| {
            if (v > 0xffff) return error.IndexTooLarge;
            std.mem.writeInt(u16, bytes[i * 2 ..][0..2], @intCast(v), .little);
        }
        const vi = try self.addView(bytes, 34963);
        return self.addAccessor(vi, 0, 4, 1, idx.len, false, null, null);
    }

    pub fn addU32Indices(self: *Builder, idx: []const u32) !*c.cgltf_accessor {
        const bytes = try self.a.alloc(u8, idx.len * 4);
        defer self.a.free(bytes);
        for (idx, 0..) |v, i| {
            std.mem.writeInt(u32, bytes[i * 4 ..][0..4], v, .little);
        }
        const vi = try self.addView(bytes, 34963);
        return self.addAccessor(vi, 0, 5, 1, idx.len, false, null, null);
    }

    /// Flush the new BIN section, buffer views and accessors into `data`.
    /// Safe to call when nothing was added (no-op).
    pub fn finish(self: *Builder) !void {
        if (self.finished) return;
        self.finished = true;
        if (self.views.items.len == 0) {
            // accessors can only be created over views registered here
            if (self.accs.items.len != 0) return error.AccessorWithoutView;
            return;
        }

        const d = self.data;
        const buffers = sl(c.cgltf_buffer, d.buffers, d.buffers_count);
        const buf = &buffers[0];

        // --- 1. grow the BIN payload --------------------------------------
        const old_size: usize = @intCast(buf.size);
        const total = self.base + self.bin.items.len;
        const new_data = try cgltfAlloc(u8, d, total);
        if (buf.data) |od| {
            const src: [*]const u8 = @ptrCast(od);
            const n = @min(old_size, total);
            @memcpy(new_data[0..n], src[0..n]);
        } else if (old_size != 0) {
            return error.MissingBufferData;
        }
        @memset(new_data[old_size..self.base], 0);
        @memcpy(new_data[self.base..], self.bin.items);
        releaseBuffer(d, buf);
        buf.data = @ptrCast(new_data.ptr);
        buf.size = total;
        buf.data_free_method = 2; // cgltf_data_free_method_memory_free

        // --- 2. grow the buffer_views pool --------------------------------
        const old_vn: usize = @intCast(d.buffer_views_count);
        const new_vn = old_vn + self.views.items.len;
        const new_views = try cgltfAlloc(c.cgltf_buffer_view, d, new_vn);
        if (old_vn > 0) @memcpy(new_views[0..old_vn], d.buffer_views[0..old_vn]);
        for (self.views.items, 0..) |v, k| new_views[old_vn + k] = v;

        const old_views = d.buffer_views;
        remapViewRefs(d, old_views, old_vn, @ptrCast(new_views.ptr));
        d.buffer_views = @ptrCast(new_views.ptr);
        d.buffer_views_count = new_vn;
        cgltfFree(c.cgltf_buffer_view, d, old_views, old_vn);

        // --- 3. grow the accessors pool -----------------------------------
        const old_an: usize = @intCast(d.accessors_count);
        const new_an = old_an + self.accs.items.len;
        const new_accs = try cgltfAlloc(c.cgltf_accessor, d, new_an);
        if (old_an > 0) @memcpy(new_accs[0..old_an], d.accessors[0..old_an]);
        for (self.accs.items, 0..) |ap, k| {
            const vi = self.acc_view.items[k];
            if (vi >= new_vn) return error.InvalidViewIndex;
            ap.buffer_view = @ptrCast(&new_views[vi]);
            new_accs[old_an + k] = ap.*;
            try self.final_map.put(self.a, @intFromPtr(ap), old_an + k);
        }

        const old_accs = d.accessors;
        remapAccessorRefs(d, old_accs, old_an, @ptrCast(new_accs.ptr));
        d.accessors = @ptrCast(new_accs.ptr);
        d.accessors_count = new_an;
        cgltfFree(c.cgltf_accessor, d, old_accs, old_an);
    }

    /// Map a registered accessor pointer to its slot in the (new) pool.
    /// Call only after `finish()`.
    pub fn resolve(self: *const Builder, ap: *c.cgltf_accessor) [*c]c.cgltf_accessor {
        if (self.final_map.get(@intFromPtr(ap))) |idx| {
            return @ptrCast(&self.data.accessors[idx]);
        }
        return @ptrCast(ap);
    }

    /// Pool index of the `k`-th registered accessor (after `finish()`).
    pub fn accIndex(self: *const Builder, k: usize) usize {
        return self.acc_start + k;
    }
};

// ===========================================================================
// tests
// ===========================================================================

extern fn malloc(size: usize) ?*anyopaque;
extern fn free(ptr: ?*anyopaque) void;

fn testAlloc(_: ?*anyopaque, size: c.cgltf_size) callconv(.c) ?*anyopaque {
    return malloc(size);
}

fn testFree(_: ?*anyopaque, ptr: ?*anyopaque) callconv(.c) void {
    free(ptr);
}

// Pool growth must rewrite *every* reference into the old arrays: primitives,
// sparse accessors, images, animation samplers and skin inverse bind matrices.
test "builder: pool regrow remaps all references" {
    var blob: [64]u8 = undefined;
    for (&blob, 0..) |*p, i| p.* = @intCast(i);

    var buffer = std.mem.zeroes(c.cgltf_buffer);
    buffer.size = blob.len;
    buffer.data = @ptrCast(&blob);
    buffer.data_free_method = 0; // caller-owned bytes, not cgltf's

    var data = std.mem.zeroes(c.cgltf_data);
    data.memory = .{ .alloc_func = testAlloc, .free_func = testFree, .user_data = null };

    // parsed cgltf data keeps its pools on cgltf's allocator: mirror that, the
    // builder frees the replaced arrays with the same allocator.
    const views = try cgltfAlloc(c.cgltf_buffer_view, &data, 2);
    views[0] = std.mem.zeroes(c.cgltf_buffer_view);
    views[1] = std.mem.zeroes(c.cgltf_buffer_view);
    const accs = try cgltfAlloc(c.cgltf_accessor, &data, 3);
    for (accs) |*a| a.* = std.mem.zeroes(c.cgltf_accessor);
    accs[0].component_type = 6; // FLOAT
    accs[0].type = 3; // VEC3
    accs[0].count = 1;
    accs[0].stride = 12;
    accs[0].buffer_view = &views[0];
    accs[1].component_type = 4; // UNSIGNED_SHORT
    accs[1].type = 1; // SCALAR
    accs[1].count = 3;
    accs[1].stride = 2;
    accs[1].buffer_view = &views[1];
    accs[2].component_type = 6;
    accs[2].type = 4; // VEC4
    accs[2].count = 1;
    accs[2].is_sparse = 1;
    accs[2].sparse.count = 1;
    accs[2].sparse.indices_buffer_view = &views[0];
    accs[2].sparse.values_buffer_view = &views[1];

    views[0].buffer = &buffer;
    views[0].offset = 0;
    views[0].size = 16;
    views[0].type = 2;
    views[1].buffer = &buffer;
    views[1].offset = 16;
    views[1].size = 16;
    views[1].type = 1;

    var image = std.mem.zeroes(c.cgltf_image);
    image.buffer_view = &views[0];

    var sampler = std.mem.zeroes(c.cgltf_animation_sampler);
    sampler.input = &accs[0];
    sampler.output = &accs[1];
    var anim = std.mem.zeroes(c.cgltf_animation);
    anim.samplers = &sampler;
    anim.samplers_count = 1;

    var skin = std.mem.zeroes(c.cgltf_skin);
    skin.inverse_bind_matrices = &accs[2];

    var attr = std.mem.zeroes(c.cgltf_attribute);
    attr.name = @constCast("POSITION");
    attr.type = 1;
    attr.data = &accs[0];
    var prim = std.mem.zeroes(c.cgltf_primitive);
    prim.type = 5;
    prim.attributes = &attr;
    prim.attributes_count = 1;
    prim.indices = &accs[1];
    var mesh = std.mem.zeroes(c.cgltf_mesh);
    mesh.primitives = &prim;
    mesh.primitives_count = 1;

    data.buffers = &buffer;
    data.buffers_count = 1;
    data.buffer_views = views.ptr;
    data.buffer_views_count = views.len;
    data.accessors = accs.ptr;
    data.accessors_count = accs.len;
    data.meshes = &mesh;
    data.meshes_count = 1;
    data.images = &image;
    data.images_count = 1;
    data.animations = &anim;
    data.animations_count = 1;
    data.skins = &skin;
    data.skins_count = 1;

    var b = try Builder.init(std.testing.allocator, &data);
    defer b.deinit();

    const flat = [_]f32{ 1, 2, 3, 4, 5, 6 };
    const vi = try b.addView(std.mem.sliceAsBytes(&flat), 34962);
    const ap = try b.addAccessor(vi, 0, 6, 3, 2, false, &.{ 1, 2, 3 }, &.{ 4, 5, 6 });
    try b.finish();

    // pools grew, old entries copied, new ones appended
    try std.testing.expectEqual(@as(usize, 3), data.buffer_views_count);
    try std.testing.expectEqual(@as(usize, 4), data.accessors_count);

    // every reference now points into the new pool arrays
    try std.testing.expect(@intFromPtr(image.buffer_view) == @intFromPtr(&data.buffer_views[0]));
    try std.testing.expect(@intFromPtr(prim.attributes[0].data) == @intFromPtr(&data.accessors[0]));
    try std.testing.expect(@intFromPtr(prim.indices) == @intFromPtr(&data.accessors[1]));
    try std.testing.expect(@intFromPtr(anim.samplers[0].input) == @intFromPtr(&data.accessors[0]));
    try std.testing.expect(@intFromPtr(anim.samplers[0].output) == @intFromPtr(&data.accessors[1]));
    try std.testing.expect(@intFromPtr(skin.inverse_bind_matrices) == @intFromPtr(&data.accessors[2]));
    try std.testing.expect(@intFromPtr(data.accessors[2].sparse.indices_buffer_view) == @intFromPtr(&data.buffer_views[0]));
    try std.testing.expect(@intFromPtr(data.accessors[2].sparse.values_buffer_view) == @intFromPtr(&data.buffer_views[1]));

    // old payload survives at its old offset, new payload is readable
    const old_bytes = viewData(@ptrCast(&data.buffer_views[0])).?;
    try std.testing.expectEqualSlices(u8, blob[0..16], old_bytes);
    const new_view: *const c.cgltf_buffer_view = @ptrCast(&data.buffer_views[2]);
    try std.testing.expectEqual(@as(usize, std.mem.alignForward(usize, blob.len, 4)), @as(usize, @intCast(new_view.offset)));
    try std.testing.expectEqualSlices(u8, std.mem.sliceAsBytes(&flat), viewData(new_view).?);
    try std.testing.expect(data.buffers[0].size >= new_view.offset + new_view.size);

    // the registered accessor resolves to its pool slot and keeps its values
    const resolved = b.resolve(ap);
    try std.testing.expect(@intFromPtr(resolved) == @intFromPtr(&data.accessors[3]));
    try std.testing.expect(@intFromPtr(resolved.*.buffer_view) == @intFromPtr(new_view));
    const s = Stream.init(@ptrCast(resolved)).?;
    try std.testing.expectEqual(@as(usize, 2), s.count);
    try std.testing.expectEqualSlices(f32, &flat, std.mem.bytesAsSlice(f32, std.mem.sliceAsBytes(&flat)));
    try std.testing.expect(readF32(s.at(0), 0) == 1 and readF32(s.at(1), 2) == 6);

    // sequential builders extend the buffer instead of clobbering it
    const base2 = data.buffers[0].size;
    var b2 = try Builder.init(std.testing.allocator, &data);
    defer b2.deinit();
    _ = try b2.addView(&[_]u8{ 7, 8, 9, 10 }, 34963);
    try b2.finish();
    try std.testing.expectEqual(@as(usize, 4), data.buffer_views_count);
    try std.testing.expectEqual(@as(usize, std.mem.alignForward(usize, base2, 4)), @as(usize, @intCast(data.buffer_views[3].offset)));
    try std.testing.expectEqualSlices(u8, std.mem.sliceAsBytes(&flat), viewData(&data.buffer_views[2]).?);

    // cgltf-owned allocations: release them ourselves (no cgltf_free here)
    cgltfFree(c.cgltf_buffer_view, &data, data.buffer_views, data.buffer_views_count);
    cgltfFree(c.cgltf_accessor, &data, data.accessors, data.accessors_count);
    if (data.buffers[0].data) |p| free(@ptrCast(p));
}
