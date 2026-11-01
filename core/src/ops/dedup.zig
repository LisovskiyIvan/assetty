//! Duplicate elimination on parsed cgltf data.
//!
//! `run` rewrites references in place so that identical accessors, materials
//! and meshes all point at one representative (the lowest pool index).  The
//! duplicate pool entries are *not* removed or freed: the writer's
//! reachability GC drops them when the asset is serialized.
//!
//! Comparison is byte-exact for accessor payloads (stride/offset normalized:
//! two accessors with the same logical elements but different views, offsets
//! or strides still match) and field-exact for materials/meshes.

const std = @import("std");
const c = @import("cgltf");

pub const Options = struct {
    accessors: bool = true,
    meshes: bool = true,
    materials: bool = true,
};

pub const Result = struct {
    removed_accessors: u32 = 0,
    removed_meshes: u32 = 0,
    removed_materials: u32 = 0,
};

// ---------------------------------------------------------------------------
// helpers
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

fn componentSize(t: c.cgltf_component_type) usize {
    return switch (t) {
        1 => 1, // BYTE
        2 => 1, // UNSIGNED_BYTE
        3 => 2, // SHORT
        4 => 2, // UNSIGNED_SHORT
        5 => 4, // UNSIGNED_INT
        6 => 4, // FLOAT
        else => 4,
    };
}

fn strSame(a: [*c]const u8, b: [*c]const u8) bool {
    const an = @intFromPtr(a) == 0;
    const bn = @intFromPtr(b) == 0;
    if (an or bn) return an == bn;
    return std.mem.eql(u8, std.mem.span(a), std.mem.span(b));
}

fn f32Same(x: f32, y: f32) bool {
    return @as(u32, @bitCast(x)) == @as(u32, @bitCast(y));
}

fn f32SliceSame(x: []const f32, y: []const f32) bool {
    if (x.len != y.len) return false;
    for (x, y) |a, b| {
        if (!f32Same(a, b)) return false;
    }
    return true;
}

/// payload bytes of a buffer view (buffer data is mapped into the source file)
fn viewData(vp: [*c]c.cgltf_buffer_view) ?[]const u8 {
    if (@intFromPtr(vp) == 0) return null;
    const v: *const c.cgltf_buffer_view = @ptrCast(vp);
    if (v.data) |d| {
        const p: [*]const u8 = @ptrCast(d);
        return p[0..v.size];
    }
    if (@intFromPtr(v.buffer) == 0) return null;
    const bd = v.buffer.*.data orelse return null;
    if (v.offset > v.buffer.*.size) return null;
    if (v.size > v.buffer.*.size - v.offset) return null;
    const p: [*]const u8 = @ptrCast(bd);
    return p[v.offset .. v.offset + v.size];
}

/// A strided element stream over a buffer view (or the sparse sub-ranges).
const Stream = struct {
    data: []const u8 = &.{},
    elem: usize = 0,
    stride: usize = 0,
    count: usize = 0,

    fn init(view: [*c]c.cgltf_buffer_view, offset: usize, count: usize, elem: usize, stride: usize) ?Stream {
        if (count == 0 or elem == 0) return .{ .elem = elem, .stride = stride, .count = 0 };
        const d = viewData(view) orelse return null;
        if (offset > d.len) return null;
        const span = std.math.mul(usize, count - 1, stride) catch return null;
        const need = std.math.add(usize, span, elem) catch return null;
        if (need > d.len - offset) return null;
        return .{ .data = d[offset..], .elem = elem, .stride = stride, .count = count };
    }

    fn at(self: Stream, i: usize) []const u8 {
        return self.data[i * self.stride ..][0..self.elem];
    }

    fn same(x: Stream, y: Stream) bool {
        if (x.count != y.count or x.elem != y.elem) return false;
        for (0..x.count) |i| {
            if (!std.mem.eql(u8, x.at(i), y.at(i))) return false;
        }
        return true;
    }
};

// ---------------------------------------------------------------------------
// accessors
// ---------------------------------------------------------------------------

const KeyBuf = [168]u8;

/// fields that must match for two accessors to be considered duplicates
fn accessorKey(acc: *const c.cgltf_accessor) KeyBuf {
    var k: KeyBuf = @splat(0);
    std.mem.writeInt(u32, k[0..4], acc.component_type, .little);
    std.mem.writeInt(u32, k[4..8], acc.type, .little);
    std.mem.writeInt(u64, k[8..16], acc.count, .little);
    k[16] = @as(u8, @intFromBool(acc.is_sparse != 0)) |
        @as(u8, @intFromBool(acc.normalized != 0)) << 1 |
        @as(u8, @intFromBool(acc.has_min != 0)) << 2 |
        @as(u8, @intFromBool(acc.has_max != 0)) << 3;
    const ncomp = numComponents(acc.type);
    if (acc.has_min != 0) {
        const b = std.mem.sliceAsBytes(acc.min[0..ncomp]);
        @memcpy(k[24..][0..b.len], b);
    }
    if (acc.has_max != 0) {
        const b = std.mem.sliceAsBytes(acc.max[0..ncomp]);
        @memcpy(k[24 + 64 ..][0..b.len], b);
    }
    return k;
}

fn accessorContentSame(x: *const c.cgltf_accessor, y: *const c.cgltf_accessor) bool {
    const elem: usize = @intCast(c.cgltf_calc_size(x.type, x.component_type));
    if (elem == 0) return false;
    const sx = if (x.stride != 0) @as(usize, @intCast(x.stride)) else elem;
    const sy = if (y.stride != 0) @as(usize, @intCast(y.stride)) else elem;
    const xs = Stream.init(x.buffer_view, @intCast(x.offset), @intCast(x.count), elem, sx) orelse return false;
    const ys = Stream.init(y.buffer_view, @intCast(y.offset), @intCast(y.count), elem, sy) orelse return false;
    if (!Stream.same(xs, ys)) return false;

    if (x.is_sparse != 0) {
        const isz = componentSize(x.sparse.indices_component_type);
        const ixs = Stream.init(
            x.sparse.indices_buffer_view,
            @intCast(x.sparse.indices_byte_offset),
            @intCast(x.sparse.count),
            isz,
            isz,
        ) orelse return false;
        const iys = Stream.init(
            y.sparse.indices_buffer_view,
            @intCast(y.sparse.indices_byte_offset),
            @intCast(y.sparse.count),
            isz,
            isz,
        ) orelse return false;
        if (!Stream.same(ixs, iys)) return false;

        const vxs = Stream.init(
            x.sparse.values_buffer_view,
            @intCast(x.sparse.values_byte_offset),
            @intCast(x.sparse.count),
            elem,
            elem,
        ) orelse return false;
        const vys = Stream.init(
            y.sparse.values_buffer_view,
            @intCast(y.sparse.values_byte_offset),
            @intCast(y.sparse.count),
            elem,
            elem,
        ) orelse return false;
        if (!Stream.same(vxs, vys)) return false;
    }
    return true;
}

fn fixAccessorRef(
    data: *c.cgltf_data,
    accs: []c.cgltf_accessor,
    rep: []const u32,
    slot: *[*c]c.cgltf_accessor,
) void {
    const p = slot.*;
    if (@intFromPtr(p) == 0) return;
    const i = ptrIndex(c.cgltf_accessor, data.accessors, data.accessors_count, p) orelse return;
    slot.* = &accs[rep[i]];
}

fn fixAttributeRefs(
    data: *c.cgltf_data,
    accs: []c.cgltf_accessor,
    rep: []const u32,
    attrs: [*c]c.cgltf_attribute,
    count: usize,
) void {
    for (sl(c.cgltf_attribute, attrs, count)) |*at| {
        fixAccessorRef(data, accs, rep, &at.data);
    }
}

fn rewriteAccessorRefs(data: *c.cgltf_data, accs: []c.cgltf_accessor, rep: []const u32) void {
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            fixAttributeRefs(data, accs, rep, p.attributes, p.attributes_count);
            fixAccessorRef(data, accs, rep, &p.indices);
            for (sl(c.cgltf_morph_target, p.targets, p.targets_count)) |*t| {
                fixAttributeRefs(data, accs, rep, t.attributes, t.attributes_count);
            }
            if (p.has_draco_mesh_compression != 0) {
                fixAttributeRefs(
                    data,
                    accs,
                    rep,
                    p.draco_mesh_compression.attributes,
                    p.draco_mesh_compression.attributes_count,
                );
            }
        }
    }
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*n| {
        if (n.has_mesh_gpu_instancing != 0) {
            fixAttributeRefs(
                data,
                accs,
                rep,
                n.mesh_gpu_instancing.attributes,
                n.mesh_gpu_instancing.attributes_count,
            );
        }
    }
    for (sl(c.cgltf_animation, data.animations, data.animations_count)) |*an| {
        for (sl(c.cgltf_animation_sampler, an.samplers, an.samplers_count)) |*s| {
            fixAccessorRef(data, accs, rep, &s.input);
            fixAccessorRef(data, accs, rep, &s.output);
        }
    }
    for (sl(c.cgltf_skin, data.skins, data.skins_count)) |*sk| {
        fixAccessorRef(data, accs, rep, &sk.inverse_bind_matrices);
    }
}

fn dedupAccessors(a: std.mem.Allocator, data: *c.cgltf_data) !u32 {
    const n: usize = @intCast(data.accessors_count);
    if (n < 2) return 0;
    const accs = sl(c.cgltf_accessor, data.accessors, n);
    const rep = try a.alloc(u32, n);

    var buckets: std.AutoHashMapUnmanaged(u64, std.ArrayList(u32)) = .empty;
    defer {
        var it = buckets.valueIterator();
        while (it.next()) |list| list.deinit(a);
        buckets.deinit(a);
    }

    var removed: u32 = 0;
    for (accs, 0..) |*acc, i| {
        const key = accessorKey(acc);
        const h = std.hash.Wyhash.hash(0x51ed270b, &key);
        const gop = try buckets.getOrPut(a, h);
        if (!gop.found_existing) gop.value_ptr.* = .empty;

        var match: ?u32 = null;
        for (gop.value_ptr.items) |j| {
            const cand = &accs[j];
            if (!std.mem.eql(u8, &accessorKey(cand), &key)) continue;
            if (!accessorContentSame(cand, acc)) continue;
            match = j;
            break;
        }
        if (match) |j| {
            rep[i] = j;
            removed += 1;
        } else {
            rep[i] = @intCast(i);
            try gop.value_ptr.append(a, @intCast(i));
        }
    }

    if (removed == 0) return 0;
    rewriteAccessorRefs(data, accs, rep);
    return removed;
}

// ---------------------------------------------------------------------------
// materials
// ---------------------------------------------------------------------------

fn textureViewSame(x: *const c.cgltf_texture_view, y: *const c.cgltf_texture_view) bool {
    if ((@intFromPtr(x.texture) == 0) != (@intFromPtr(y.texture) == 0)) return false;
    if (@intFromPtr(x.texture) != 0 and x.texture != y.texture) return false;
    if (x.texcoord != y.texcoord) return false;
    if (!f32Same(x.scale, y.scale)) return false;
    if ((x.has_transform != 0) != (y.has_transform != 0)) return false;
    if (x.has_transform != 0) {
        if (!f32SliceSame(&x.transform.offset, &y.transform.offset)) return false;
        if (!f32SliceSame(&x.transform.scale, &y.transform.scale)) return false;
        if (!f32Same(x.transform.rotation, y.transform.rotation)) return false;
        if ((x.transform.has_texcoord != 0) != (y.transform.has_texcoord != 0)) return false;
        if (x.transform.texcoord != y.transform.texcoord) return false;
    }
    return true;
}

fn extrasSame(x: *const c.cgltf_extras, y: *const c.cgltf_extras) bool {
    return strSame(x.data, y.data);
}

fn extensionsSame(
    xp: [*c]c.cgltf_extension,
    xc: usize,
    yp: [*c]c.cgltf_extension,
    yc: usize,
) bool {
    if (xc != yc) return false;
    for (sl(c.cgltf_extension, xp, xc), sl(c.cgltf_extension, yp, yc)) |*xe, *ye| {
        if (!strSame(xe.name, ye.name)) return false;
        if (!strSame(xe.data, ye.data)) return false;
    }
    return true;
}

fn materialSame(x: *const c.cgltf_material, y: *const c.cgltf_material) bool {
    const flag_fields = .{
        "has_pbr_metallic_roughness",
        "has_pbr_specular_glossiness",
        "has_clearcoat",
        "has_transmission",
        "has_volume",
        "has_ior",
        "has_specular",
        "has_sheen",
        "has_emissive_strength",
        "has_iridescence",
        "has_diffuse_transmission",
        "has_anisotropy",
        "has_dispersion",
    };
    inline for (flag_fields) |f| {
        if ((@field(x, f) != 0) != (@field(y, f) != 0)) return false;
    }
    if ((x.double_sided != 0) != (y.double_sided != 0)) return false;
    if ((x.unlit != 0) != (y.unlit != 0)) return false;
    if (x.alpha_mode != y.alpha_mode) return false;
    if (!f32Same(x.alpha_cutoff, y.alpha_cutoff)) return false;
    if (!f32SliceSame(&x.emissive_factor, &y.emissive_factor)) return false;
    if (!textureViewSame(&x.normal_texture, &y.normal_texture)) return false;
    if (!textureViewSame(&x.occlusion_texture, &y.occlusion_texture)) return false;
    if (!textureViewSame(&x.emissive_texture, &y.emissive_texture)) return false;

    if (x.has_pbr_metallic_roughness != 0) {
        const xp = &x.pbr_metallic_roughness;
        const yp = &y.pbr_metallic_roughness;
        if (!f32SliceSame(&xp.base_color_factor, &yp.base_color_factor)) return false;
        if (!f32Same(xp.metallic_factor, yp.metallic_factor)) return false;
        if (!f32Same(xp.roughness_factor, yp.roughness_factor)) return false;
        if (!textureViewSame(&xp.base_color_texture, &yp.base_color_texture)) return false;
        if (!textureViewSame(&xp.metallic_roughness_texture, &yp.metallic_roughness_texture)) return false;
    }
    if (x.has_pbr_specular_glossiness != 0) {
        const xp = &x.pbr_specular_glossiness;
        const yp = &y.pbr_specular_glossiness;
        if (!f32SliceSame(&xp.diffuse_factor, &yp.diffuse_factor)) return false;
        if (!f32SliceSame(&xp.specular_factor, &yp.specular_factor)) return false;
        if (!f32Same(xp.glossiness_factor, yp.glossiness_factor)) return false;
        if (!textureViewSame(&xp.diffuse_texture, &yp.diffuse_texture)) return false;
        if (!textureViewSame(&xp.specular_glossiness_texture, &yp.specular_glossiness_texture)) return false;
    }
    if (x.has_clearcoat != 0) {
        const xp = &x.clearcoat;
        const yp = &y.clearcoat;
        if (!f32Same(xp.clearcoat_factor, yp.clearcoat_factor)) return false;
        if (!f32Same(xp.clearcoat_roughness_factor, yp.clearcoat_roughness_factor)) return false;
        if (!textureViewSame(&xp.clearcoat_texture, &yp.clearcoat_texture)) return false;
        if (!textureViewSame(&xp.clearcoat_roughness_texture, &yp.clearcoat_roughness_texture)) return false;
        if (!textureViewSame(&xp.clearcoat_normal_texture, &yp.clearcoat_normal_texture)) return false;
    }
    if (x.has_transmission != 0) {
        if (!f32Same(x.transmission.transmission_factor, y.transmission.transmission_factor)) return false;
        if (!textureViewSame(&x.transmission.transmission_texture, &y.transmission.transmission_texture)) return false;
    }
    if (x.has_volume != 0) {
        const xp = &x.volume;
        const yp = &y.volume;
        if (!f32Same(xp.thickness_factor, yp.thickness_factor)) return false;
        if (!f32Same(xp.attenuation_distance, yp.attenuation_distance)) return false;
        if (!f32SliceSame(&xp.attenuation_color, &yp.attenuation_color)) return false;
        if (!textureViewSame(&xp.thickness_texture, &yp.thickness_texture)) return false;
    }
    if (x.has_ior != 0) {
        if (!f32Same(x.ior.ior, y.ior.ior)) return false;
    }
    if (x.has_specular != 0) {
        const xp = &x.specular;
        const yp = &y.specular;
        if (!f32Same(xp.specular_factor, yp.specular_factor)) return false;
        if (!f32SliceSame(&xp.specular_color_factor, &yp.specular_color_factor)) return false;
        if (!textureViewSame(&xp.specular_texture, &yp.specular_texture)) return false;
        if (!textureViewSame(&xp.specular_color_texture, &yp.specular_color_texture)) return false;
    }
    if (x.has_sheen != 0) {
        const xp = &x.sheen;
        const yp = &y.sheen;
        if (!f32SliceSame(&xp.sheen_color_factor, &yp.sheen_color_factor)) return false;
        if (!f32Same(xp.sheen_roughness_factor, yp.sheen_roughness_factor)) return false;
        if (!textureViewSame(&xp.sheen_color_texture, &yp.sheen_color_texture)) return false;
        if (!textureViewSame(&xp.sheen_roughness_texture, &yp.sheen_roughness_texture)) return false;
    }
    if (x.has_emissive_strength != 0) {
        if (!f32Same(x.emissive_strength.emissive_strength, y.emissive_strength.emissive_strength)) return false;
    }
    if (x.has_iridescence != 0) {
        const xp = &x.iridescence;
        const yp = &y.iridescence;
        if (!f32Same(xp.iridescence_factor, yp.iridescence_factor)) return false;
        if (!f32Same(xp.iridescence_ior, yp.iridescence_ior)) return false;
        if (!f32Same(xp.iridescence_thickness_min, yp.iridescence_thickness_min)) return false;
        if (!f32Same(xp.iridescence_thickness_max, yp.iridescence_thickness_max)) return false;
        if (!textureViewSame(&xp.iridescence_texture, &yp.iridescence_texture)) return false;
        if (!textureViewSame(&xp.iridescence_thickness_texture, &yp.iridescence_thickness_texture)) return false;
    }
    if (x.has_diffuse_transmission != 0) {
        const xp = &x.diffuse_transmission;
        const yp = &y.diffuse_transmission;
        if (!f32Same(xp.diffuse_transmission_factor, yp.diffuse_transmission_factor)) return false;
        if (!f32SliceSame(&xp.diffuse_transmission_color_factor, &yp.diffuse_transmission_color_factor)) return false;
        if (!textureViewSame(&xp.diffuse_transmission_texture, &yp.diffuse_transmission_texture)) return false;
        if (!textureViewSame(&xp.diffuse_transmission_color_texture, &yp.diffuse_transmission_color_texture)) return false;
    }
    if (x.has_anisotropy != 0) {
        const xp = &x.anisotropy;
        const yp = &y.anisotropy;
        if (!f32Same(xp.anisotropy_strength, yp.anisotropy_strength)) return false;
        if (!f32Same(xp.anisotropy_rotation, yp.anisotropy_rotation)) return false;
        if (!textureViewSame(&xp.anisotropy_texture, &yp.anisotropy_texture)) return false;
    }
    if (x.has_dispersion != 0) {
        if (!f32Same(x.dispersion.dispersion, y.dispersion.dispersion)) return false;
    }

    if (!extrasSame(&x.extras, &y.extras)) return false;
    if (!extensionsSame(x.extensions, x.extensions_count, y.extensions, y.extensions_count)) return false;
    return true;
}

fn fixMaterialRef(
    data: *c.cgltf_data,
    mats: []c.cgltf_material,
    rep: []const u32,
    slot: *[*c]c.cgltf_material,
) void {
    const p = slot.*;
    if (@intFromPtr(p) == 0) return;
    const i = ptrIndex(c.cgltf_material, data.materials, data.materials_count, p) orelse return;
    slot.* = &mats[rep[i]];
}

fn dedupMaterials(a: std.mem.Allocator, data: *c.cgltf_data) !u32 {
    const n: usize = @intCast(data.materials_count);
    if (n < 2) return 0;
    const mats = sl(c.cgltf_material, data.materials, n);
    const rep = try a.alloc(u32, n);

    var removed: u32 = 0;
    for (mats, 0..) |*m, i| {
        rep[i] = @intCast(i);
        var j: usize = 0;
        while (j < i) : (j += 1) {
            if (rep[j] != j) continue;
            if (!materialSame(&mats[j], m)) continue;
            rep[i] = rep[j];
            removed += 1;
            break;
        }
    }

    if (removed == 0) return 0;
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count)) |*m| {
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            fixMaterialRef(data, mats, rep, &p.material);
            for (sl(c.cgltf_material_mapping, p.mappings, p.mappings_count)) |*mp| {
                fixMaterialRef(data, mats, rep, &mp.material);
            }
        }
    }
    // material variants are addressed by primitives only; nothing else to fix
    return removed;
}

// ---------------------------------------------------------------------------
// meshes
// ---------------------------------------------------------------------------

fn attributeSame(x: *const c.cgltf_attribute, y: *const c.cgltf_attribute) bool {
    return x.data == y.data and x.type == y.type and x.index == y.index and strSame(x.name, y.name);
}

fn primitiveSame(x: *const c.cgltf_primitive, y: *const c.cgltf_primitive) bool {
    if (x.type != y.type) return false;
    if (x.indices != y.indices) return false;
    if (x.material != y.material) return false;
    if (x.attributes_count != y.attributes_count) return false;
    for (sl(c.cgltf_attribute, x.attributes, x.attributes_count), 0..) |*xa, k| {
        const ya = &sl(c.cgltf_attribute, y.attributes, y.attributes_count)[k];
        if (!attributeSame(xa, ya)) return false;
    }
    if (x.targets_count != y.targets_count) return false;
    for (sl(c.cgltf_morph_target, x.targets, x.targets_count), 0..) |*xt, k| {
        const yt = &sl(c.cgltf_morph_target, y.targets, y.targets_count)[k];
        if (xt.attributes_count != yt.attributes_count) return false;
        for (sl(c.cgltf_attribute, xt.attributes, xt.attributes_count), 0..) |*xa, ai| {
            const ya = &sl(c.cgltf_attribute, yt.attributes, yt.attributes_count)[ai];
            if (!attributeSame(xa, ya)) return false;
        }
    }
    if (!extrasSame(&x.extras, &y.extras)) return false;
    if (!extensionsSame(x.extensions, x.extensions_count, y.extensions, y.extensions_count)) return false;
    return true;
}

fn meshSame(x: *const c.cgltf_mesh, y: *const c.cgltf_mesh) bool {
    if (x.primitives_count != y.primitives_count) return false;
    for (sl(c.cgltf_primitive, x.primitives, x.primitives_count), 0..) |*xp, k| {
        const yp = &sl(c.cgltf_primitive, y.primitives, y.primitives_count)[k];
        if (!primitiveSame(xp, yp)) return false;
    }
    const xw = std.mem.sliceAsBytes(sl(c.cgltf_float, x.weights, x.weights_count));
    const yw = std.mem.sliceAsBytes(sl(c.cgltf_float, y.weights, y.weights_count));
    if (!std.mem.eql(u8, xw, yw)) return false;
    if (x.target_names_count != y.target_names_count) return false;
    for (sl([*c]u8, @ptrCast(x.target_names), x.target_names_count), 0..) |xp, k| {
        const yp = sl([*c]u8, @ptrCast(y.target_names), y.target_names_count)[k];
        if (!strSame(xp, yp)) return false;
    }
    if (!extrasSame(&x.extras, &y.extras)) return false;
    if (!extensionsSame(x.extensions, x.extensions_count, y.extensions, y.extensions_count)) return false;
    return true;
}

fn dedupMeshes(a: std.mem.Allocator, data: *c.cgltf_data) !u32 {
    const n: usize = @intCast(data.meshes_count);
    if (n < 2) return 0;
    const meshes = sl(c.cgltf_mesh, data.meshes, n);
    const rep = try a.alloc(u32, n);

    var removed: u32 = 0;
    for (meshes, 0..) |*m, i| {
        rep[i] = @intCast(i);
        var j: usize = 0;
        while (j < i) : (j += 1) {
            if (rep[j] != j) continue;
            if (!meshSame(&meshes[j], m)) continue;
            rep[i] = rep[j];
            removed += 1;
            break;
        }
    }

    if (removed == 0) return 0;
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*node| {
        const p = node.mesh;
        if (@intFromPtr(p) == 0) continue;
        const mi = ptrIndex(c.cgltf_mesh, data.meshes, data.meshes_count, p) orelse continue;
        node.mesh = &meshes[rep[mi]];
    }
    return removed;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/// In-place dedup on cgltf data: finds identical accessors / meshes / materials
/// and rewrites all references to a representative. Duplicates stay in the
/// cgltf pools (unreferenced) — the writer's GC pass drops them on output.
pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = file_bytes; // buffer payloads are already mapped (cgltf_load_buffers)

    var res: Result = .{};
    // order matters: meshes compare accessor/material *pointers*, so those
    // pools must be collapsed first.
    if (opts.accessors) res.removed_accessors = try dedupAccessors(a, data);
    if (opts.materials) res.removed_materials = try dedupMaterials(a, data);
    if (opts.meshes) res.removed_meshes = try dedupMeshes(a, data);
    return res;
}

// ===========================================================================
// tests
// ===========================================================================

const write_mod = @import("../gltf/write.zig");
const parse_mod = @import("../gltf/parse.zig");

fn parseBytes(bytes: []const u8) !*c.cgltf_data {
    var options: c.cgltf_options = std.mem.zeroes(c.cgltf_options);
    var data: ?*c.cgltf_data = null;
    const res = c.cgltf_parse(&options, bytes.ptr, bytes.len, &data);
    if (res != c.cgltf_result_success or data == null) return error.ParseFailed;
    if (c.cgltf_load_buffers(&options, data, null) != c.cgltf_result_success) {
        c.cgltf_free(data);
        return error.LoadFailed;
    }
    return data.?;
}

test "dedup: duplicate-heavy fixture" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/dup.glb");
    defer loaded.deinit();

    const before_acc = loaded.cdata.accessors_count;
    const before_meshes = loaded.cdata.meshes_count;
    const before_mats = loaded.cdata.materials_count;

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expectEqual(@as(u32, 4), res.removed_accessors);
    try std.testing.expectEqual(@as(u32, 1), res.removed_meshes);
    try std.testing.expectEqual(@as(u32, 2), res.removed_materials);

    // references must now point at the representatives
    const nodes = sl(c.cgltf_node, loaded.cdata.nodes, loaded.cdata.nodes_count);
    try std.testing.expect(nodes[1].mesh == nodes[2].mesh);
    const meshes = sl(c.cgltf_mesh, loaded.cdata.meshes, loaded.cdata.meshes_count);
    const p0 = &sl(c.cgltf_primitive, meshes[0].primitives, meshes[0].primitives_count)[0];
    const p1 = &sl(c.cgltf_primitive, meshes[1].primitives, meshes[1].primitives_count)[0];
    try std.testing.expect(p0.indices == p1.indices);
    try std.testing.expect(p0.material == p1.material);
    const a0 = &sl(c.cgltf_attribute, p0.attributes, p0.attributes_count)[0];
    const a1 = &sl(c.cgltf_attribute, p1.attributes, p1.attributes_count)[0];
    try std.testing.expect(a0.data == a1.data);

    // the writer GC turns unreferenced duplicates into a smaller asset
    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    const parsed = try parseBytes(out);
    defer c.cgltf_free(parsed);
    try std.testing.expect(parsed.accessors_count < before_acc);
    try std.testing.expect(parsed.meshes_count < before_meshes);
    try std.testing.expect(parsed.materials_count < before_mats);
    try std.testing.expectEqual(@as(usize, 4), parsed.accessors_count);
    try std.testing.expectEqual(@as(usize, 1), parsed.meshes_count);
    try std.testing.expectEqual(@as(usize, 1), parsed.materials_count);

    // and the deduped result is byte-stable through the writer
    const out2 = try write_mod.serialize(aa, parsed, out);
    try std.testing.expectEqualSlices(u8, out, out2);
}

test "dedup: clean asset has nothing to remove" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/real/Box.glb");
    defer loaded.deinit();

    const res = try run(aa, loaded.cdata, loaded.map, .{});
    try std.testing.expectEqual(@as(u32, 0), res.removed_accessors);
    try std.testing.expectEqual(@as(u32, 0), res.removed_meshes);
    try std.testing.expectEqual(@as(u32, 0), res.removed_materials);

    var arena2 = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena2.deinit();
    const aa2 = arena2.allocator();
    var fresh = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/real/Box.glb");
    defer fresh.deinit();

    const ref = try write_mod.serialize(aa2, fresh.cdata, fresh.map);
    const out = try write_mod.serialize(aa, loaded.cdata, loaded.map);
    try std.testing.expectEqualSlices(u8, ref, out);
}
