//! Primitive joining on parsed cgltf data.
//!
//! Within one mesh, primitives that share a material and expose the same
//! attribute layout (same semantics, component types and dimensions; vertex /
//! index counts may differ) are concatenated into a single primitive: each
//! attribute stream is appended and the index buffers are merged with a
//! per-source vertex offset. Only indexed triangle primitives take part.
//!
//! The merged accessors are registered with `geom.Builder` and flushed once at
//! the end of `run`; the replaced primitives' accessors stay in the pools
//! (orphaned) and are dropped by the writer's GC pass.

const std = @import("std");
const c = @import("cgltf");
const geom = @import("geom.zig");

pub const Result = struct {
    /// primitives merged away
    merged_prims: u32 = 0,
    /// meshes that ended up with a single merged primitive (i.e. every mesh
    /// whose primitive array was rebuilt because at least one group merged)
    rewritten_meshes: u32 = 0,
};

const PendingPrim = struct {
    prim: *c.cgltf_primitive,
    attrs: []*c.cgltf_accessor,
    indices: *c.cgltf_accessor,
};

/// Join: within each mesh, merge primitives that share the same material and
/// are all triangles, concatenating attribute streams + offset indices.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8) !Result {
    _ = file_bytes; // buffer payloads are already mapped (cgltf_load_buffers)

    var res: Result = .{};
    if (data.meshes_count == 0 or data.buffers_count == 0) return res;

    var b = geom.Builder.init(a, data) catch |err| switch (err) {
        error.NoBuffer => return res,
        else => |e| return e,
    };
    defer b.deinit();

    var pending: std.ArrayList(PendingPrim) = .empty;
    defer pending.deinit(a);

    for (geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        try joinMesh(a, &b, m, &pending, &res);
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

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

const AttrInfo = struct {
    name: []const u8,
    ty: c_uint,
    idx: c_int,
    ct: c_uint,
    dim: c_uint,
    norm: bool,
};

fn attrLessThan(_: void, x: AttrInfo, y: AttrInfo) bool {
    const ord = std.mem.order(u8, x.name, y.name);
    if (ord != .eq) return ord == .lt;
    if (x.ty != y.ty) return x.ty < y.ty;
    return x.idx < y.idx;
}

fn collectAttrs(a: std.mem.Allocator, p: *const c.cgltf_primitive) ![]AttrInfo {
    const n: usize = @intCast(p.attributes_count);
    const out = try a.alloc(AttrInfo, n);
    for (geom.sl(c.cgltf_attribute, p.attributes, n), 0..) |*at, k| {
        const acc: *const c.cgltf_accessor = @ptrCast(at.data);
        out[k] = .{
            .name = if (at.name) |nm| std.mem.span(nm) else "",
            .ty = @intCast(at.type),
            .idx = at.index,
            .ct = @intCast(acc.component_type),
            .dim = @intCast(acc.type),
            .norm = acc.normalized != 0,
        };
    }
    std.mem.sort(AttrInfo, out, {}, attrLessThan);
    return out;
}

fn buildSig(a: std.mem.Allocator, infos: []const AttrInfo) ![]u8 {
    var buf: std.ArrayList(u8) = .empty;
    errdefer buf.deinit(a);
    var tmp: [13]u8 = undefined;
    for (infos) |in| {
        try buf.appendSlice(a, in.name);
        try buf.append(a, 0);
        std.mem.writeInt(u32, tmp[0..4], in.ty, .little);
        std.mem.writeInt(i32, tmp[4..8], in.idx, .little);
        std.mem.writeInt(u32, tmp[8..12], in.ct, .little);
        tmp[12] = @intFromBool(in.norm);
        try buf.appendSlice(a, &tmp);
        var d2: [4]u8 = undefined;
        std.mem.writeInt(u32, &d2, in.dim, .little);
        try buf.appendSlice(a, &d2);
    }
    return buf.toOwnedSlice(a);
}

/// Indexed triangle primitive that can be concatenated with others.
fn eligible(p: *const c.cgltf_primitive) bool {
    if (p.type != 5) return false; // cgltf_primitive_type_triangles
    if (@intFromPtr(p.indices) == 0) return false;
    if (p.targets_count > 0 or p.has_draco_mesh_compression != 0 or p.mappings_count > 0) return false;

    const n: usize = @intCast(p.attributes_count);
    if (n == 0) return false;
    for (geom.sl(c.cgltf_attribute, p.attributes, n)) |*at| {
        if (@intFromPtr(at.data) == 0) return false;
        const acc: *const c.cgltf_accessor = @ptrCast(at.data);
        if (acc.count == 0) return false;
        if (geom.Stream.init(acc) == null) return false;
    }
    const ir = geom.IndexReader.init(@ptrCast(p.indices)) orelse return false;
    if (ir.count() == 0 or ir.count() % 3 != 0) return false;
    return true;
}

fn findAttr(p: *const c.cgltf_primitive, name: []const u8, ty: c_uint, idx: c_int) ?*const c.cgltf_accessor {
    for (geom.sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
        const nm = if (at.name) |n| std.mem.span(n) else "";
        if (@as(c_uint, @intCast(at.type)) != ty or at.index != idx) continue;
        if (!std.mem.eql(u8, nm, name)) continue;
        return @ptrCast(at.data);
    }
    return null;
}

const Group = struct {
    material: [*c]c.cgltf_material,
    sig: []u8,
    prims: std.ArrayList(u32) = .empty,

    fn deinit(self: *Group, a: std.mem.Allocator) void {
        a.free(self.sig);
        self.prims.deinit(a);
    }
};

fn emptyMaterial(x: [*c]c.cgltf_material) bool {
    return @intFromPtr(x) == 0;
}

fn joinMesh(
    a: std.mem.Allocator,
    b: *geom.Builder,
    m: *c.cgltf_mesh,
    pending: *std.ArrayList(PendingPrim),
    res: *Result,
) !void {
    const n: usize = @intCast(m.primitives_count);
    if (n < 2) return;
    const prims = geom.sl(c.cgltf_primitive, m.primitives, n);

    var groups: std.ArrayList(Group) = .empty;
    defer {
        for (groups.items) |*g| g.deinit(a);
        groups.deinit(a);
    }

    for (prims, 0..) |*p, i| {
        if (!eligible(p)) continue;
        const infos = try collectAttrs(a, p);
        defer a.free(infos);
        const sig = try buildSig(a, infos);

        var hit: ?*Group = null;
        for (groups.items) |*g| {
            const same_mat = if (emptyMaterial(g.material) and emptyMaterial(p.material))
                true
            else
                g.material == p.material;
            if (same_mat and std.mem.eql(u8, g.sig, sig)) {
                hit = g;
                break;
            }
        }
        if (hit) |g| {
            a.free(sig);
            try g.prims.append(a, @intCast(i));
        } else {
            var g = Group{ .material = p.material, .sig = sig };
            try g.prims.append(a, @intCast(i));
            try groups.append(a, g);
        }
    }

    var any = false;
    for (groups.items) |*g| {
        if (g.prims.items.len > 1) any = true;
    }
    if (!any) return;

    // --- merge every multi-primitive group --------------------------------
    const drop = try a.alloc(bool, n);
    defer a.free(drop);
    @memset(drop, false);

    const repl = try a.alloc(?c.cgltf_primitive, n);
    defer a.free(repl);
    @memset(repl, null);

    const Built = struct {
        slot: usize,
        attrs: []*c.cgltf_accessor,
        indices: *c.cgltf_accessor,
    };
    var built: std.ArrayList(Built) = .empty;
    defer built.deinit(a);

    var merged_away: u32 = 0;
    for (groups.items) |*g| {
        if (g.prims.items.len < 2) continue;
        const merged = try mergeGroup(a, b, prims, g.prims.items);
        const slot = g.prims.items[0];
        repl[slot] = merged.prim;
        for (g.prims.items[1..]) |pi| drop[pi] = true;
        merged_away += @intCast(g.prims.items.len - 1);
        try built.append(a, .{ .slot = slot, .attrs = merged.attrs, .indices = merged.indices });
    }

    // --- rebuild this mesh's primitive array ------------------------------
    var keep: usize = 0;
    for (drop) |d| {
        if (!d) keep += 1;
    }
    const arr = try geom.cgltfAlloc(c.cgltf_primitive, b.data, keep);
    const new_of = try a.alloc(usize, n);
    defer a.free(new_of);
    @memset(new_of, std.math.maxInt(usize));
    var k: usize = 0;
    for (0..n) |i| {
        if (drop[i]) continue;
        arr[k] = repl[i] orelse prims[i];
        new_of[i] = k;
        k += 1;
    }

    m.primitives = @ptrCast(arr.ptr);
    m.primitives_count = keep;

    for (built.items) |it| {
        const slot = new_of[it.slot];
        try pending.append(a, .{ .prim = &arr[slot], .attrs = it.attrs, .indices = it.indices });
    }

    res.merged_prims += merged_away;
    res.rewritten_meshes += 1;
}

const Merged = struct {
    prim: c.cgltf_primitive,
    attrs: []*c.cgltf_accessor,
    indices: *c.cgltf_accessor,
};

fn mergeGroup(
    a: std.mem.Allocator,
    b: *geom.Builder,
    prims: []c.cgltf_primitive,
    members: []const u32,
) !Merged {
    const first = &prims[members[0]];
    const nattr: usize = @intCast(first.attributes_count);

    var total_v: usize = 0;
    var total_i: usize = 0;
    for (members) |mi| {
        const p = &prims[mi];
        total_v += attrCount(p);
        total_i += @intCast(p.indices.*.count);
    }

    // --- concatenated index buffer ---------------------------------------
    const out_idx = try a.alloc(u32, total_i);
    defer a.free(out_idx);
    var io: usize = 0;
    var voff: u32 = 0;
    for (members) |mi| {
        const p = &prims[mi];
        const ir = geom.IndexReader.init(@ptrCast(p.indices)) orelse return error.InvalidPrimitive;
        const ic = ir.count();
        for (0..ic) |i| out_idx[io + i] = ir.get(i) + voff;
        io += ic;
        voff += @intCast(attrCount(p));
    }

    // --- concatenated attribute streams ----------------------------------
    const new_attrs = try a.alloc(*c.cgltf_accessor, nattr);
    defer a.free(new_attrs);
    const first_attrs = geom.sl(c.cgltf_attribute, first.attributes, nattr);
    for (first_attrs, 0..) |*at, k| {
        const name = if (at.name) |nm| std.mem.span(nm) else "";
        const ty: c_uint = @intCast(at.type);
        const acc0: *const c.cgltf_accessor = @ptrCast(at.data);
        const elem: usize = @intCast(c.cgltf_calc_size(acc0.type, acc0.component_type));

        const len = std.math.mul(usize, total_v, elem) catch return error.OutOfMemory;
        const bytes = try a.alloc(u8, len);
        defer a.free(bytes);
        var o: usize = 0;
        for (members) |mi| {
            const p = &prims[mi];
            const acc = findAttr(p, name, ty, at.index) orelse return error.InvalidPrimitive;
            const s = geom.Stream.init(acc) orelse return error.InvalidPrimitive;
            if (s.elem != elem) return error.InvalidPrimitive;
            for (0..s.count) |v| {
                @memcpy(bytes[o..][0..elem], s.at(v));
                o += elem;
            }
        }

        const ncomp = geom.numComponents(acc0.type);
        var bnd: ?geom.Bounds = null;
        if (ty == 1 and acc0.component_type == 6) { // POSITION + FLOAT
            bnd = geom.f32Bounds(bytes, elem, total_v, ncomp);
        }
        const vi = try b.addView(bytes, 34962);
        new_attrs[k] = try b.addAccessor(
            vi,
            0,
            acc0.component_type,
            acc0.type,
            total_v,
            acc0.normalized != 0,
            if (bnd) |x| x.min[0..ncomp] else null,
            if (bnd) |x| x.max[0..ncomp] else null,
        );
    }

    const idx_acc = try b.addIndices(out_idx);

    // reuse the first primitive's attribute array: its `data` slots are
    // repointed to the new accessors once the builder is flushed.
    var merged = first.*;
    merged.indices = null;
    merged.attributes = first.attributes;
    merged.attributes_count = first.attributes_count;

    return .{ .prim = merged, .attrs = try a.dupe(*c.cgltf_accessor, new_attrs), .indices = idx_acc };
}

fn attrCount(p: *const c.cgltf_primitive) usize {
    const n: usize = @intCast(p.attributes_count);
    if (n == 0) return 0;
    const at = &geom.sl(c.cgltf_attribute, p.attributes, n)[0];
    const acc: *const c.cgltf_accessor = @ptrCast(at.data);
    return @intCast(acc.count);
}

// ===========================================================================
// tests
// ===========================================================================

const write_mod = @import("../gltf/write.zig");
const parse_mod = @import("../gltf/parse.zig");
const weld_mod = @import("weld.zig");

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

fn meshAt(data: *c.cgltf_data, i: usize) *c.cgltf_mesh {
    return &geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count)[i];
}

fn primAt(data: *c.cgltf_data, mesh: usize, prim: usize) *c.cgltf_primitive {
    const m = meshAt(data, mesh);
    return &geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)[prim];
}

fn attrAcc(p: *c.cgltf_primitive, name: []const u8) *const c.cgltf_accessor {
    for (geom.sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
        const n = at.name orelse continue;
        if (std.mem.eql(u8, std.mem.span(n), name)) {
            return @ptrCast(at.data);
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

test "join: fixture merges same-material primitives" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/weld_join_target.glb");
    defer loaded.deinit();
    const d = loaded.cdata;

    try std.testing.expectEqual(@as(usize, 4), meshAt(d, 0).primitives_count);
    // capture the two mergeable vertex streams for a value check
    const a_pos = try readFloats(aa, attrAcc(primAt(d, 0, 0), "POSITION"));
    const b_pos = try readFloats(aa, attrAcc(primAt(d, 0, 1), "POSITION"));
    const a_idx = try readIdx(aa, @ptrCast(primAt(d, 0, 0).indices));
    const b_idx = try readIdx(aa, @ptrCast(primAt(d, 0, 1).indices));

    const res = try run(aa, d, loaded.map);
    try std.testing.expectEqual(@as(u32, 1), res.merged_prims);
    try std.testing.expectEqual(@as(u32, 1), res.rewritten_meshes);
    try std.testing.expectEqual(@as(usize, 3), meshAt(d, 0).primitives_count);

    const mp = primAt(d, 0, 0);
    try std.testing.expectEqual(@as(usize, 24), attrAcc(mp, "POSITION").count);
    try std.testing.expectEqual(@as(usize, 36), @as(usize, @intCast(mp.indices.*.count)));
    // the merged prim keeps the first primitive's material
    try std.testing.expect(@intFromPtr(mp.material) == @intFromPtr(d.materials));

    // values: first 12 vertices from prim A, next 12 from prim B
    const m_pos = try readFloats(aa, attrAcc(mp, "POSITION"));
    try std.testing.expectEqualSlices(f32, a_pos, m_pos[0..a_pos.len]);
    try std.testing.expectEqualSlices(f32, b_pos, m_pos[a_pos.len..]);
    const m_idx = try readIdx(aa, @ptrCast(mp.indices));
    try std.testing.expectEqualSlices(u32, a_idx, m_idx[0..a_idx.len]);
    const shifted = try aa.alloc(u32, b_idx.len);
    for (b_idx, 0..) |v, i| shifted[i] = v + 12;
    try std.testing.expectEqualSlices(u32, shifted, m_idx[a_idx.len..]);

    // untouched prims: non-indexed stays non-indexed, other material untouched
    try std.testing.expect(primAt(d, 0, 1).indices == null);
    try std.testing.expectEqual(@as(usize, 3), @as(usize, @intCast(primAt(d, 0, 1).attributes_count)));
    try std.testing.expectEqual(@as(usize, 4), attrAcc(primAt(d, 0, 2), "POSITION").count);

    // second pass finds nothing to merge
    const res2 = try run(aa, d, loaded.map);
    try std.testing.expectEqual(@as(u32, 0), res2.merged_prims);
    try std.testing.expectEqual(@as(u32, 0), res2.rewritten_meshes);
}

test "join: serialized output round-trips and is byte-stable" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/weld_join_target.glb");
    defer loaded.deinit();

    const res = try run(aa, loaded.cdata, loaded.map);
    try std.testing.expectEqual(@as(u32, 1), res.merged_prims);

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    var p1 = try parseBytes(out);
    defer p1.deinit();

    const m = meshAt(p1.data, 0);
    // merged (pos/nrm/uv/idx) + non-indexed (pos/nrm/uv) + other material
    // (pos/nrm/uv/idx) = 11 accessors, one primitive per group
    try std.testing.expectEqual(@as(usize, 3), m.primitives_count);
    try std.testing.expectEqual(@as(usize, 11), p1.data.accessors_count);
    try std.testing.expectEqual(@as(usize, 2), p1.data.materials_count);

    const merged = primAt(p1.data, 0, 0);
    try std.testing.expectEqual(@as(usize, 24), attrAcc(merged, "POSITION").count);
    const idx = try readIdx(aa, @ptrCast(merged.indices));
    for (idx) |v| try std.testing.expect(v < 24);

    const out2 = try write_mod.serialize(aa, p1.data, out);
    try std.testing.expectEqualSlices(u8, out, out2);
}

test "join: clean asset is left byte-identical" {
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

    const res = try run(aa, loaded.cdata, loaded.map);
    try std.testing.expectEqual(@as(u32, 0), res.merged_prims);
    try std.testing.expectEqual(@as(u32, 0), res.rewritten_meshes);

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    try std.testing.expectEqualSlices(u8, reference, out);
}

test "join: real fixtures survive weld + join + write" {
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var dir = std.Io.Dir.cwd().openDir(io, "test/fixtures/real", .{ .iterate = true }) catch return;
    defer dir.close(io);
    var it = dir.iterate();
    var seen: usize = 0;
    while (try it.next(io)) |ent| {
        if (ent.kind != .file or !std.mem.endsWith(u8, ent.name, ".glb")) continue;
        const path = try std.fmt.allocPrint(aa, "test/fixtures/real/{s}", .{ent.name});

        var fa = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer fa.deinit();
        const a2 = fa.allocator();

        var loaded = parse_mod.loadFile(io, std.testing.allocator, path) catch continue;
        defer loaded.deinit();

        const w = weld_mod.run(a2, loaded.cdata, loaded.map, .{}) catch |err| {
            std.debug.print("weld {s}: {s}\n", .{ path, @errorName(err) });
            continue;
        };
        const j = run(a2, loaded.cdata, loaded.map) catch |err| {
            std.debug.print("join {s}: {s}\n", .{ path, @errorName(err) });
            continue;
        };
        std.debug.print("{s}: weld -{d} verts / {d} prims, join -{d} prims\n", .{
            ent.name, w.removed_vertices, w.rewritten_prims, j.merged_prims,
        });

        const out = write_mod.serialize(a2, loaded.cdata, loaded.map) catch |err| switch (err) {
            error.Unsupported => continue, // external buffer / meshopt
            else => return err,
        };

        // every index still addresses a vertex of its primitive
        for (geom.sl(c.cgltf_mesh, loaded.cdata.meshes, loaded.cdata.meshes_count)) |*m| {
            for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
                if (p.indices == null or p.attributes_count == 0) continue;
                const vcount = attrCount(p);
                for (0..@intCast(p.indices.*.count)) |i| {
                    const v = c.cgltf_accessor_read_index(p.indices, i);
                    try std.testing.expect(v < vcount);
                }
            }
        }

        var p1 = try parseBytes(out);
        defer p1.deinit();
        const out2 = try write_mod.serialize(a2, p1.data, out);
        try std.testing.expectEqualSlices(u8, out, out2);
        seen += 1;
    }
    try std.testing.expect(seen > 0);
}

test "join: weld then join end to end" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/weld_join_target.glb");
    defer loaded.deinit();

    const w = try weld_mod.run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expectEqual(@as(u32, 4), w.removed_vertices);

    const j = try run(aa, loaded.cdata, loaded.map);
    try std.testing.expectEqual(@as(u32, 1), j.merged_prims);

    const merged = primAt(loaded.cdata, 0, 0);
    try std.testing.expectEqual(@as(usize, 20), attrAcc(merged, "POSITION").count);
    try std.testing.expectEqual(@as(usize, 36), @as(usize, @intCast(merged.indices.*.count)));

    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    var p1 = try parseBytes(out);
    defer p1.deinit();
    const m = meshAt(p1.data, 0);
    var total_v: usize = 0;
    for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
        total_v += attrAcc(p, "POSITION").count;
    }
    try std.testing.expectEqual(@as(usize, 27), total_v);
    try std.testing.expectEqual(@as(usize, 3), m.primitives_count);

    const out2 = try write_mod.serialize(aa, p1.data, out);
    try std.testing.expectEqualSlices(u8, out, out2);
}
