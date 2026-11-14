//! GLB writer: serialize a parsed cgltf scene back into a self-contained GLB.
//!
//! The goal is *structural* losslessness (plus strict GLB spec compliance),
//! not byte equality with the input file: cgltf normalizes formatting and
//! drops information it does not model.  Writing the output of a parse a
//! second time must, however, be byte-identical to the first write
//! (idempotence), which is what the tests below check.

const std = @import("std");
const c = @import("cgltf");
const geom = @import("../ops/geom.zig");

pub const Error = error{
    /// Not representable as a single-buffer GLB (writer-produced meshopt
    /// output without exactly one real buffer, unsupported geometry).
    Unsupported,
    /// Buffer or image data has not been loaded (missing / truncated file,
    /// external uri whose payload could not be read).
    InvalidData,
} || std.mem.Allocator.Error;

// ---------------------------------------------------------------------------
// small cgltf helpers
// ---------------------------------------------------------------------------

fn cstr(p: [*c]const u8) ?[]const u8 {
    if (@intFromPtr(p) == 0) return null;
    const s = std.mem.span(p);
    return if (s.len == 0) null else s;
}

fn componentTypeInt(t: c.cgltf_component_type) u32 {
    return switch (t) {
        1 => 5120, // BYTE
        2 => 5121, // UNSIGNED_BYTE
        3 => 5122, // SHORT
        4 => 5123, // UNSIGNED_SHORT
        5 => 5125, // UNSIGNED_INT
        6 => 5126, // FLOAT
        else => 5126,
    };
}

fn typeName(t: c.cgltf_type) []const u8 {
    return switch (t) {
        1 => "SCALAR",
        2 => "VEC2",
        3 => "VEC3",
        4 => "VEC4",
        5 => "MAT2",
        6 => "MAT3",
        7 => "MAT4",
        else => "SCALAR",
    };
}

// ---------------------------------------------------------------------------
// JSON emitter
// ---------------------------------------------------------------------------

const Out = struct {
    a: std.mem.Allocator,
    buf: std.ArrayList(u8) = .empty,
    /// comma state of every open container (false = nothing written yet)
    stack: std.ArrayList(bool) = .empty,

    fn raw(self: *Out, s: []const u8) !void {
        try self.buf.appendSlice(self.a, s);
    }

    fn fmt(self: *Out, comptime f: []const u8, args: anytype) !void {
        try self.buf.print(self.a, f, args);
    }

    fn sep(self: *Out) !void {
        if (self.stack.items.len == 0) return;
        const last = &self.stack.items[self.stack.items.len - 1];
        if (last.*) try self.raw(",") else last.* = true;
    }

    fn beginObj(self: *Out) !void {
        try self.raw("{");
        try self.stack.append(self.a, false);
    }

    fn endObj(self: *Out) !void {
        _ = self.stack.pop();
        try self.raw("}");
    }

    fn beginArr(self: *Out) !void {
        try self.raw("[");
        try self.stack.append(self.a, false);
    }

    fn endArr(self: *Out) !void {
        _ = self.stack.pop();
        try self.raw("]");
    }

    fn key(self: *Out, name: []const u8) !void {
        try self.sep();
        try self.str(name);
        try self.raw(":");
    }

    fn item(self: *Out) !void {
        try self.sep();
    }

    fn str(self: *Out, s: []const u8) !void {
        try self.raw("\"");
        var start: usize = 0;
        for (s, 0..) |ch, i| {
            var esc: ?[]const u8 = null;
            switch (ch) {
                '"' => esc = "\\\"",
                '\\' => esc = "\\\\",
                '\n' => esc = "\\n",
                '\r' => esc = "\\r",
                '\t' => esc = "\\t",
                0x08 => esc = "\\b",
                0x0C => esc = "\\f",
                else => {
                    if (ch >= 0x20) continue;
                },
            }
            if (i > start) try self.raw(s[start..i]);
            if (esc) |e| {
                try self.raw(e);
            } else {
                try self.fmt("\\u{x:0>4}", .{ch});
            }
            start = i + 1;
        }
        if (start < s.len) try self.raw(s[start..]);
        try self.raw("\"");
    }

    fn int(self: *Out, v: anytype) !void {
        try self.fmt("{d}", .{v});
    }

    fn float(self: *Out, v: f32) !void {
        // NaN/Inf are not valid JSON and signal corrupt input: fail the
        // serialize instead of silently emitting 0.
        if (!std.math.isFinite(v)) return error.InvalidData;
        try self.fmt("{d}", .{v});
    }

    fn floatAff(self: *Out, v: anytype) !void {
        try self.float(@floatCast(v));
    }

    fn floatArr(self: *Out, vals: anytype) !void {
        try self.beginArr();
        for (vals) |v| {
            try self.item();
            try self.floatAff(v);
        }
        try self.endArr();
    }

    fn intArr(self: *Out, vals: []const u32) !void {
        try self.beginArr();
        for (vals) |v| {
            try self.item();
            try self.int(v);
        }
        try self.endArr();
    }

    fn strArr(self: *Out, vals: []const []const u8) !void {
        try self.beginArr();
        for (vals) |v| {
            try self.item();
            try self.str(v);
        }
        try self.endArr();
    }
};

fn isEmptyObjSlice(s: []const u8) bool {
    for (s) |ch| {
        if (ch != ' ' and ch != '\t' and ch != '\n' and ch != '\r') return false;
    }
    return true;
}

/// Entries of an extensionsUsed/Required list that survive emission: the
/// meshopt declaration is dropped once its views are inflated to plain data.
fn keptExtCount(list: [*c][*c]u8, n: usize, has_mc: bool) usize {
    if (has_mc) return n;
    var n_kept: usize = 0;
    for (geom.sl([*c]u8, @ptrCast(list), n)) |p| {
        if (std.mem.eql(u8, cstr(p) orelse "", "EXT_meshopt_compression")) continue;
        n_kept += 1;
    }
    return n_kept;
}

fn writeExtras(o: *Out, extras: *const c.cgltf_extras) !void {
    const p = extras.data;
    if (@intFromPtr(p) == 0) return;
    const s = std.mem.span(p);
    if (s.len == 0) return;
    try o.key("extras");
    try o.raw(s);
}

fn writeRawExtensions(o: *Out, exts: [*c]c.cgltf_extension, count: usize) !void {
    if (count == 0) return;
    try o.key("extensions");
    try o.beginObj();
    for (geom.sl(c.cgltf_extension, exts, count)) |*e| {
        const name = cstr(e.name) orelse continue;
        const data = if (@intFromPtr(e.data) != 0) std.mem.span(e.data) else "{}";
        if (isEmptyObjSlice(data)) {
            try o.key(name);
            try o.raw("{}");
            continue;
        }
        try o.key(name);
        try o.raw(data);
    }
    try o.endObj();
}

// ---------------------------------------------------------------------------
// writer context
// ---------------------------------------------------------------------------

const Bounds = struct {
    min: [16]f32 = undefined,
    max: [16]f32 = undefined,
};

// ---------------------------------------------------------------------------
// reachability GC
//
// Before emitting anything we compute, for every cgltf pool, which entries are
// actually referenced by the output.  Unreferenced (garbage) entries are
// skipped entirely: no JSON, no BIN bytes.  `rank` maps an old pool index to
// its new emitted index (`dropped` when the entry is not kept).
// ---------------------------------------------------------------------------

/// value stored in `Pool.rank` for entries that are not emitted
const dropped = std.math.maxInt(u32);

const Pool = struct {
    keep: []bool,
    rank: []u32,

    fn init(a: std.mem.Allocator, n: usize) !Pool {
        const keep = try a.alloc(bool, n);
        @memset(keep, false);
        const rank = try a.alloc(u32, n);
        @memset(rank, dropped);
        return .{ .keep = keep, .rank = rank };
    }

    fn finalize(self: *Pool) void {
        var next: u32 = 0;
        for (self.keep, 0..) |k, i| {
            if (!k) continue;
            self.rank[i] = next;
            next += 1;
        }
    }

    fn count(self: *const Pool) usize {
        var n: usize = 0;
        for (self.keep) |k| {
            if (k) n += 1;
        }
        return n;
    }
};

const Keep = struct {
    nodes: Pool,
    meshes: Pool,
    materials: Pool,
    textures: Pool,
    images: Pool,
    samplers: Pool,
    cameras: Pool,
    lights: Pool,
    accessors: Pool,
    views: Pool,

    fn compute(a: std.mem.Allocator, d: *c.cgltf_data) !Keep {
        var k = Keep{
            .nodes = try Pool.init(a, d.nodes_count),
            .meshes = try Pool.init(a, d.meshes_count),
            .materials = try Pool.init(a, d.materials_count),
            .textures = try Pool.init(a, d.textures_count),
            .images = try Pool.init(a, d.images_count),
            .samplers = try Pool.init(a, d.samplers_count),
            .cameras = try Pool.init(a, d.cameras_count),
            .lights = try Pool.init(a, d.lights_count),
            .accessors = try Pool.init(a, d.accessors_count),
            .views = try Pool.init(a, d.buffer_views_count),
        };

        // Without any scene/animation/skin anchor there is no graph to reason
        // about: keep everything (the writer used to emit every pool element
        // and must stay lossless for such inputs).
        const anchored = d.scenes_count > 0 or d.animations_count > 0 or d.skins_count > 0;

        const stack = try a.alloc(u32, d.nodes_count + 1);

        // nodes reachable from scene roots
        if (d.scenes_count > 0) {
            for (geom.sl(c.cgltf_scene, d.scenes, d.scenes_count)) |*s| {
                for (geom.sl([*c]c.cgltf_node, s.nodes, s.nodes_count)) |np| {
                    markSubtree(k.nodes.keep, stack, d, np);
                }
            }
        }
        // animation channels target live nodes even when unreachable from a scene
        for (geom.sl(c.cgltf_animation, d.animations, d.animations_count)) |*an| {
            for (geom.sl(c.cgltf_animation_channel, an.channels, an.channels_count)) |*ch| {
                if (@intFromPtr(ch.target_node) != 0) markSubtree(k.nodes.keep, stack, d, ch.target_node);
            }
        }
        // skins are always emitted, so their joints must stay addressable
        for (geom.sl(c.cgltf_skin, d.skins, d.skins_count)) |*sk| {
            for (geom.sl([*c]c.cgltf_node, sk.joints, sk.joints_count)) |jp| markSubtree(k.nodes.keep, stack, d, jp);
            if (@intFromPtr(sk.skeleton) != 0) markSubtree(k.nodes.keep, stack, d, sk.skeleton);
        }
        if (!anchored) {
            @memset(k.nodes.keep, true);
            @memset(k.meshes.keep, true);
        }

        // meshes referenced by kept nodes
        for (geom.sl(c.cgltf_node, d.nodes, d.nodes_count), 0..) |*n, ni| {
            if (!k.nodes.keep[ni]) continue;
            if (geom.ptrIndex(c.cgltf_mesh, d.meshes, d.meshes_count, n.mesh)) |mi| k.meshes.keep[mi] = true;
        }

        // materials + accessors referenced by kept meshes
        var draco_views: std.ArrayList(usize) = .empty;
        var draco_accs: std.ArrayList(usize) = .empty;
        defer draco_views.deinit(a);
        defer draco_accs.deinit(a);

        for (geom.sl(c.cgltf_mesh, d.meshes, d.meshes_count), 0..) |*m, mi| {
            if (!k.meshes.keep[mi]) continue;
            for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
                for (geom.sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                    markAccessor(&k, d, at.data);
                }
                markAccessor(&k, d, p.indices);
                for (geom.sl(c.cgltf_morph_target, p.targets, p.targets_count)) |*t| {
                    for (geom.sl(c.cgltf_attribute, t.attributes, t.attributes_count)) |*at| {
                        markAccessor(&k, d, at.data);
                    }
                }
                if (geom.ptrIndex(c.cgltf_material, d.materials, d.materials_count, p.material)) |mat_i| k.materials.keep[mat_i] = true;
                for (geom.sl(c.cgltf_material_mapping, p.mappings, p.mappings_count)) |*mp| {
                    if (geom.ptrIndex(c.cgltf_material, d.materials, d.materials_count, mp.material)) |mat_i| k.materials.keep[mat_i] = true;
                }
                if (p.has_draco_mesh_compression != 0) {
                    for (geom.sl(c.cgltf_attribute, p.draco_mesh_compression.attributes, p.draco_mesh_compression.attributes_count)) |*at| {
                        if (geom.ptrIndex(c.cgltf_accessor, d.accessors, d.accessors_count, at.data)) |ai| try draco_accs.append(a, ai);
                    }
                    if (geom.ptrIndex(c.cgltf_buffer_view, d.buffer_views, d.buffer_views_count, p.draco_mesh_compression.buffer_view)) |vi| {
                        try draco_views.append(a, vi);
                    }
                }
            }
        }

        // instancing attributes live on kept nodes
        for (geom.sl(c.cgltf_node, d.nodes, d.nodes_count), 0..) |*n, ni| {
            if (!k.nodes.keep[ni]) continue;
            if (n.has_mesh_gpu_instancing != 0) {
                for (geom.sl(c.cgltf_attribute, n.mesh_gpu_instancing.attributes, n.mesh_gpu_instancing.attributes_count)) |*at| {
                    markAccessor(&k, d, at.data);
                }
            }
            if (geom.ptrIndex(c.cgltf_camera, d.cameras, d.cameras_count, n.camera)) |ci| k.cameras.keep[ci] = true;
            if (geom.ptrIndex(c.cgltf_light, d.lights, d.lights_count, n.light)) |li| k.lights.keep[li] = true;
        }

        // animation + skin accessors (all animations and skins are emitted)
        for (geom.sl(c.cgltf_animation, d.animations, d.animations_count)) |*an| {
            for (geom.sl(c.cgltf_animation_sampler, an.samplers, an.samplers_count)) |*s| {
                markAccessor(&k, d, s.input);
                markAccessor(&k, d, s.output);
            }
        }
        for (geom.sl(c.cgltf_skin, d.skins, d.skins_count)) |*sk| {
            markAccessor(&k, d, sk.inverse_bind_matrices);
        }
        for (draco_accs.items) |ai| k.accessors.keep[ai] = true;

        // textures referenced by kept materials
        for (geom.sl(c.cgltf_material, d.materials, d.materials_count), 0..) |*m, mi| {
            if (!k.materials.keep[mi]) continue;
            markMaterialTextures(&k, d, m);
        }

        // images/samplers referenced by kept textures
        for (geom.sl(c.cgltf_texture, d.textures, d.textures_count), 0..) |*t, ti| {
            if (!k.textures.keep[ti]) continue;
            markImage(&k, d, t.image);
            markImage(&k, d, t.basisu_image);
            markImage(&k, d, t.webp_image);
            if (geom.ptrIndex(c.cgltf_sampler, d.samplers, d.samplers_count, t.sampler)) |si| k.samplers.keep[si] = true;
        }

        // buffer views used by kept accessors / images
        for (geom.sl(c.cgltf_accessor, d.accessors, d.accessors_count), 0..) |*acc, ai| {
            if (!k.accessors.keep[ai]) continue;
            markView(&k, d, acc.buffer_view);
            if (acc.is_sparse != 0) {
                markView(&k, d, acc.sparse.indices_buffer_view);
                markView(&k, d, acc.sparse.values_buffer_view);
            }
        }
        for (geom.sl(c.cgltf_image, d.images, d.images_count), 0..) |*im, ii| {
            if (!k.images.keep[ii]) continue;
            markView(&k, d, im.buffer_view);
        }
        for (draco_views.items) |vi| k.views.keep[vi] = true;

        k.nodes.finalize();
        k.meshes.finalize();
        k.materials.finalize();
        k.textures.finalize();
        k.images.finalize();
        k.samplers.finalize();
        k.cameras.finalize();
        k.lights.finalize();
        k.accessors.finalize();
        k.views.finalize();
        return k;
    }
};

fn markSubtree(keep_nodes: []bool, stack: []u32, d: *c.cgltf_data, root: [*c]c.cgltf_node) void {
    if (@intFromPtr(root) == 0 or stack.len == 0) return;
    const ri = geom.ptrIndex(c.cgltf_node, d.nodes, d.nodes_count, root) orelse return;
    if (keep_nodes[ri]) return;
    keep_nodes[ri] = true;
    var sp: usize = 0;
    stack[sp] = ri;
    sp += 1;
    const nodes = geom.sl(c.cgltf_node, d.nodes, d.nodes_count);
    while (sp > 0) {
        sp -= 1;
        const n = &nodes[stack[sp]];
        for (geom.sl([*c]c.cgltf_node, n.children, n.children_count)) |ch| {
            if (@intFromPtr(ch) == 0) continue;
            const ci = geom.ptrIndex(c.cgltf_node, d.nodes, d.nodes_count, ch) orelse continue;
            if (keep_nodes[ci]) continue;
            keep_nodes[ci] = true;
            // every node is pushed at most once, so this cannot overflow
            stack[sp] = ci;
            sp += 1;
        }
    }
}

fn markAccessor(k: *Keep, d: *c.cgltf_data, p: [*c]c.cgltf_accessor) void {
    if (@intFromPtr(p) == 0) return;
    if (geom.ptrIndex(c.cgltf_accessor, d.accessors, d.accessors_count, p)) |ai| k.accessors.keep[ai] = true;
}

fn markView(k: *Keep, d: *c.cgltf_data, p: [*c]c.cgltf_buffer_view) void {
    if (@intFromPtr(p) == 0) return;
    if (geom.ptrIndex(c.cgltf_buffer_view, d.buffer_views, d.buffer_views_count, p)) |vi| k.views.keep[vi] = true;
}

fn markImage(k: *Keep, d: *c.cgltf_data, p: [*c]c.cgltf_image) void {
    if (@intFromPtr(p) == 0) return;
    if (geom.ptrIndex(c.cgltf_image, d.images, d.images_count, p)) |ii| k.images.keep[ii] = true;
}

/// every texture_view field of a material (core + typed extensions)
fn materialTextureViews(m: *const c.cgltf_material) [21]*const c.cgltf_texture_view {
    return .{
        &m.pbr_metallic_roughness.base_color_texture,
        &m.pbr_metallic_roughness.metallic_roughness_texture,
        &m.normal_texture,
        &m.occlusion_texture,
        &m.emissive_texture,
        &m.pbr_specular_glossiness.diffuse_texture,
        &m.pbr_specular_glossiness.specular_glossiness_texture,
        &m.clearcoat.clearcoat_texture,
        &m.clearcoat.clearcoat_roughness_texture,
        &m.clearcoat.clearcoat_normal_texture,
        &m.transmission.transmission_texture,
        &m.volume.thickness_texture,
        &m.specular.specular_texture,
        &m.specular.specular_color_texture,
        &m.sheen.sheen_color_texture,
        &m.sheen.sheen_roughness_texture,
        &m.iridescence.iridescence_texture,
        &m.iridescence.iridescence_thickness_texture,
        &m.diffuse_transmission.diffuse_transmission_texture,
        &m.diffuse_transmission.diffuse_transmission_color_texture,
        &m.anisotropy.anisotropy_texture,
    };
}

fn markMaterialTextures(k: *Keep, d: *c.cgltf_data, m: *const c.cgltf_material) void {
    for (materialTextureViews(m)) |v| {
        if (@intFromPtr(v.texture) == 0) continue;
        if (geom.ptrIndex(c.cgltf_texture, d.textures, d.textures_count, v.texture)) |ti| k.textures.keep[ti] = true;
    }
}

const Ctx = struct {
    a: std.mem.Allocator,
    d: *c.cgltf_data,
    view_off: []const u64,
    bin_len: u64,
    keep_stride: []const bool,
    bounds: []const ?Bounds,
    keep: *const Keep,
    /// per old view index: kept meshopt-compressed view (payload in BIN at
    /// view_off[i], decompressed layout at mc_ph[i] in the placeholder buffer)
    mc_view: []const bool,
    mc_ph: []const u64,
    ph_total: u64,
    placeholder_idx: u32,
    has_mc: bool,
    /// per cgltf image index: inlined external payload, if any
    img_extra: []const ?ImgExtra,
    /// parse-time image metadata (mime fallback), index-aligned or empty
    images: []const model.Image,
};

/// An image payload copied into the output BIN instead of kept as an
/// external uri: `index` is its emitted bufferView index.
const ImgExtra = struct {
    index: u32,
    off: u64,
    len: u64,
    mime: []const u8,
};

fn mimeString(m: model.Mime) []const u8 {
    return switch (m) {
        .png => "image/png",
        .jpeg => "image/jpeg",
        .webp => "image/webp",
        .ktx2 => "image/ktx2",
        .other => "application/octet-stream",
    };
}

/// Map an old pool index to the emitted index, or null when the entry was
/// garbage collected.
fn kept(rank: []const u32, i: u32) ?u32 {
    if (i >= rank.len) return null;
    const r = rank[i];
    return if (r == dropped) null else r;
}

fn ranked(comptime T: type, base: [*c]T, count: usize, p: [*c]T, rank: []const u32) ?u32 {
    const i = geom.ptrIndex(T, base, count, p) orelse return null;
    return kept(rank, i);
}

fn emitTextureView(o: *Out, ctx: *const Ctx, view: *const c.cgltf_texture_view) !void {
    if (@intFromPtr(view.texture) == 0) return;
    const ti = ranked(c.cgltf_texture, ctx.d.textures, ctx.d.textures_count, view.texture, ctx.keep.textures.rank) orelse return;
    try o.key("index");
    try o.int(ti);
    if (view.texcoord != 0) {
        try o.key("texCoord");
        try o.int(view.texcoord);
    }
    if (view.has_transform != 0) {
        try o.key("extensions");
        try o.beginObj();
        try o.key("KHR_texture_transform");
        try o.beginObj();
        try o.key("offset");
        try o.floatArr(view.transform.offset);
        try o.key("rotation");
        try o.floatAff(view.transform.rotation);
        try o.key("scale");
        try o.floatArr(view.transform.scale);
        if (view.transform.has_texcoord != 0) {
            try o.key("texCoord");
            try o.int(view.transform.texcoord);
        }
        try o.endObj();
        try o.endObj();
    }
}

fn emitNormalTexture(o: *Out, ctx: *const Ctx, view: *const c.cgltf_texture_view) !void {
    if (@intFromPtr(view.texture) == 0) return;
    try o.key("normalTexture");
    try o.beginObj();
    try emitTextureView(o, ctx, view);
    if (view.scale != 1.0) {
        try o.key("scale");
        try o.floatAff(view.scale);
    }
    try o.endObj();
}

fn emitOcclusionTexture(o: *Out, ctx: *const Ctx, view: *const c.cgltf_texture_view) !void {
    if (@intFromPtr(view.texture) == 0) return;
    try o.key("occlusionTexture");
    try o.beginObj();
    try emitTextureView(o, ctx, view);
    if (view.scale != 1.0) {
        try o.key("strength");
        try o.floatAff(view.scale);
    }
    try o.endObj();
}

fn emitTexInfoKey(o: *Out, ctx: *const Ctx, name: []const u8, view: *const c.cgltf_texture_view) !void {
    if (@intFromPtr(view.texture) == 0) return;
    try o.key(name);
    try o.beginObj();
    try emitTextureView(o, ctx, view);
    try o.endObj();
}

// ---------------------------------------------------------------------------
// per-object emitters
// ---------------------------------------------------------------------------

fn writeAsset(o: *Out, d: *c.cgltf_data) !void {
    const asset = &d.asset;
    try o.beginObj();
    if (cstr(asset.copyright)) |s| {
        try o.key("copyright");
        try o.str(s);
    }
    if (cstr(asset.generator)) |s| {
        try o.key("generator");
        try o.str(s);
    }
    try o.key("version");
    try o.str(cstr(asset.version) orelse "2.0");
    if (cstr(asset.min_version)) |s| {
        try o.key("minVersion");
        try o.str(s);
    }
    try writeRawExtensions(o, asset.extensions, asset.extensions_count);
    try writeExtras(o, &asset.extras);
    try o.endObj();
}

fn writeBuffer(o: *Out, ctx: *const Ctx, b: *const c.cgltf_buffer) !void {
    try o.beginObj();
    if (cstr(b.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    // The output is a single-buffer GLB: its bytes live in the BIN chunk, so
    // an input uri (external .bin / data:) is never carried over.
    try o.key("byteLength");
    try o.int(ctx.bin_len);
    try writeRawExtensions(o, b.extensions, b.extensions_count);
    try writeExtras(o, &b.extras);
    try o.endObj();
}

fn mcModeLabel(mode: c.cgltf_meshopt_compression_mode) []const u8 {
    if (mode == c.cgltf_meshopt_compression_mode_attributes) return "ATTRIBUTES";
    if (mode == c.cgltf_meshopt_compression_mode_triangles) return "TRIANGLES";
    return "INDICES";
}

fn mcFilterLabel(filter: c.cgltf_meshopt_compression_filter) ?[]const u8 {
    if (filter == c.cgltf_meshopt_compression_filter_none) return null;
    if (filter == c.cgltf_meshopt_compression_filter_octahedral) return "OCTAHEDRAL";
    if (filter == c.cgltf_meshopt_compression_filter_quaternion) return "QUATERNION";
    if (filter == c.cgltf_meshopt_compression_filter_exponential) return "EXPONENTIAL";
    return "COLOR";
}

fn writeBufferView(o: *Out, ctx: *const Ctx, i: usize, v: *const c.cgltf_buffer_view) !void {
    if (i < ctx.mc_view.len and ctx.mc_view[i]) return writeMeshoptBufferView(o, ctx, i, v);
    try o.beginObj();
    if (cstr(v.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    if (ctx.d.buffers_count > 0) {
        // Single-buffer output: the BIN chunk holds every kept view, so all
        // of them address buffer 0 (stale placeholder pointers on inflated
        // meshopt input are ignored; writer-produced mc views take the
        // dedicated branch above and never reach this).
        try o.key("buffer");
        try o.int(0);
    } else if (geom.ptrIndex(c.cgltf_buffer, ctx.d.buffers, ctx.d.buffers_count, v.buffer)) |bi| {
        try o.key("buffer");
        try o.int(bi);
    }
    try o.key("byteOffset");
    try o.int(ctx.view_off[i]);
    try o.key("byteLength");
    try o.int(v.size);
    if (i < ctx.keep_stride.len and ctx.keep_stride[i] and v.stride != 0) {
        try o.key("byteStride");
        try o.int(v.stride);
    }
    switch (v.type) {
        1 => {
            try o.key("target");
            try o.int(@as(u32, 34963));
        },
        2 => {
            try o.key("target");
            try o.int(@as(u32, 34962));
        },
        else => {},
    }
    try writeRawExtensions(o, v.extensions, v.extensions_count);
    try writeExtras(o, &v.extras);
    try o.endObj();
}

/// A meshopt-compressed view: `buffer`/`byteOffset`/`byteLength` describe the
/// DECOMPRESSED layout in the placeholder buffer; the extension object points
/// at the compressed payload in buffer 0 (the GLB BIN chunk).
fn writeMeshoptBufferView(o: *Out, ctx: *const Ctx, i: usize, v: *const c.cgltf_buffer_view) !void {
    const e = v.meshopt_compression;
    const stride: usize = @intCast(e.stride);
    const is_attr = e.mode == c.cgltf_meshopt_compression_mode_attributes;
    try o.beginObj();
    if (cstr(v.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    try o.key("buffer");
    try o.int(ctx.placeholder_idx);
    try o.key("byteOffset");
    try o.int(ctx.mc_ph[i]);
    // Decompressed size: stride * count (== v.size for our outputs).
    try o.key("byteLength");
    try o.int(v.size);
    if (is_attr) {
        // Emit byteStride only when it differs from the natural accessor
        // stride (index views must not carry byteStride at all).
        var natural: ?usize = null;
        for (geom.sl(c.cgltf_accessor, ctx.d.accessors, ctx.d.accessors_count), 0..) |*acc, ai| {
            if (!ctx.keep.accessors.keep[ai] or acc.buffer_view != v) continue;
            natural = c.cgltf_calc_size(acc.type, acc.component_type);
            break;
        }
        if (natural == null or natural.? != stride) {
            try o.key("byteStride");
            try o.int(stride);
        }
    }
    switch (v.type) {
        1 => {
            try o.key("target");
            try o.int(@as(u32, 34963));
        },
        2 => {
            try o.key("target");
            try o.int(@as(u32, 34962));
        },
        else => {},
    }
    try o.key("extensions");
    try o.beginObj();
    try o.key("EXT_meshopt_compression");
    try o.beginObj();
    try o.key("buffer");
    try o.int(@as(u32, 0));
    try o.key("byteOffset");
    try o.int(ctx.view_off[i]);
    try o.key("byteLength");
    try o.int(e.size);
    try o.key("byteStride");
    try o.int(stride);
    try o.key("count");
    try o.int(e.count);
    try o.key("mode");
    try o.str(mcModeLabel(e.mode));
    if (mcFilterLabel(e.filter)) |f| {
        try o.key("filter");
        try o.str(f);
    }
    try o.endObj();
    // Raw view extensions alongside ours (not produced by our op, but a
    // parsed file could carry both — keep them, don't clobber).
    for (geom.sl(c.cgltf_extension, v.extensions, v.extensions_count)) |*re| {
        const name = cstr(re.name) orelse continue;
        if (std.mem.eql(u8, name, "EXT_meshopt_compression")) continue;
        const edata = if (@intFromPtr(re.data) != 0) std.mem.span(re.data) else "{}";
        try o.key(name);
        try o.raw(if (isEmptyObjSlice(edata)) "{}" else edata);
    }
    try o.endObj();
    try writeExtras(o, &v.extras);
    try o.endObj();
}

fn writeAccessor(o: *Out, ctx: *const Ctx, i: usize, acc: *const c.cgltf_accessor) !void {
    try o.beginObj();
    if (cstr(acc.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    if (geom.ptrIndex(c.cgltf_buffer_view, ctx.d.buffer_views, ctx.d.buffer_views_count, acc.buffer_view)) |bi| {
        if (kept(ctx.keep.views.rank, bi)) |bv| {
            try o.key("bufferView");
            try o.int(bv);
        }
    }
    if (acc.offset != 0) {
        try o.key("byteOffset");
        try o.int(acc.offset);
    }
    try o.key("componentType");
    try o.int(componentTypeInt(acc.component_type));
    if (acc.normalized != 0) {
        try o.key("normalized");
        try o.raw("true");
    }
    try o.key("count");
    try o.int(acc.count);
    try o.key("type");
    try o.str(typeName(acc.type));

    const ncomp = geom.numComponents(acc.type);
    const bnd: ?Bounds = if (i < ctx.bounds.len) ctx.bounds[i] else null;

    if (acc.has_min != 0) {
        try o.key("min");
        try o.beginArr();
        for (0..ncomp) |k| {
            try o.item();
            try o.floatAff(acc.min[k]);
        }
        try o.endArr();
    } else if (bnd) |b| {
        try o.key("min");
        try o.beginArr();
        for (0..ncomp) |k| {
            try o.item();
            try o.float(b.min[k]);
        }
        try o.endArr();
    }
    if (acc.has_max != 0) {
        try o.key("max");
        try o.beginArr();
        for (0..ncomp) |k| {
            try o.item();
            try o.floatAff(acc.max[k]);
        }
        try o.endArr();
    } else if (bnd) |b| {
        try o.key("max");
        try o.beginArr();
        for (0..ncomp) |k| {
            try o.item();
            try o.float(b.max[k]);
        }
        try o.endArr();
    }

    if (acc.is_sparse != 0) {
        try o.key("sparse");
        try o.beginObj();
        try o.key("count");
        try o.int(acc.sparse.count);
        try o.key("indices");
        try o.beginObj();
        if (geom.ptrIndex(c.cgltf_buffer_view, ctx.d.buffer_views, ctx.d.buffer_views_count, acc.sparse.indices_buffer_view)) |bi| {
            if (kept(ctx.keep.views.rank, bi)) |bv| {
                try o.key("bufferView");
                try o.int(bv);
            }
        }
        try o.key("byteOffset");
        try o.int(acc.sparse.indices_byte_offset);
        try o.key("componentType");
        try o.int(componentTypeInt(acc.sparse.indices_component_type));
        try o.endObj();
        try o.key("values");
        try o.beginObj();
        if (geom.ptrIndex(c.cgltf_buffer_view, ctx.d.buffer_views, ctx.d.buffer_views_count, acc.sparse.values_buffer_view)) |bi| {
            if (kept(ctx.keep.views.rank, bi)) |bv| {
                try o.key("bufferView");
                try o.int(bv);
            }
        }
        try o.key("byteOffset");
        try o.int(acc.sparse.values_byte_offset);
        try o.endObj();
        try o.endObj();
    }

    try writeRawExtensions(o, acc.extensions, acc.extensions_count);
    try writeExtras(o, &acc.extras);
    try o.endObj();
}

fn writeImage(o: *Out, ctx: *const Ctx, im: *const c.cgltf_image, index: usize) !void {
    try o.beginObj();
    if (cstr(im.name)) |s| {
        try o.key("name");
        try o.str(s);
    }

    var view_index: ?u32 = null;
    var mime: ?[]const u8 = null;
    if (index < ctx.img_extra.len) {
        if (ctx.img_extra[index]) |ex| {
            view_index = ex.index;
            mime = ex.mime;
        }
    }
    if (view_index == null) {
        if (geom.ptrIndex(c.cgltf_buffer_view, ctx.d.buffer_views, ctx.d.buffer_views_count, im.buffer_view)) |bi| {
            if (kept(ctx.keep.views.rank, bi)) |bv| view_index = bv;
        }
    }

    if (view_index) |bv| {
        // A bufferView makes the GLB self-contained; the uri is superseded
        // (glTF allows exactly one of the two).
        try o.key("bufferView");
        try o.int(bv);
    } else if (cstr(im.uri)) |s| {
        // Only absolute URLs survive without payload (never fetched here).
        try o.key("uri");
        try o.str(s);
    }

    if (mime == null) mime = cstr(im.mime_type);
    if (mime == null and view_index != null and index < ctx.images.len) {
        mime = mimeString(ctx.images[index].mime);
    }
    if (mime) |s| {
        try o.key("mimeType");
        try o.str(s);
    }
    try writeRawExtensions(o, im.extensions, im.extensions_count);
    try writeExtras(o, &im.extras);
    try o.endObj();
}

fn writeSampler(o: *Out, s: *const c.cgltf_sampler) !void {
    try o.beginObj();
    if (cstr(s.name)) |n| {
        try o.key("name");
        try o.str(n);
    }
    if (s.mag_filter != 0) {
        try o.key("magFilter");
        try o.int(s.mag_filter);
    }
    if (s.min_filter != 0) {
        try o.key("minFilter");
        try o.int(s.min_filter);
    }
    try o.key("wrapS");
    try o.int(s.wrap_s);
    try o.key("wrapT");
    try o.int(s.wrap_t);
    try writeRawExtensions(o, s.extensions, s.extensions_count);
    try writeExtras(o, &s.extras);
    try o.endObj();
}

fn writeTexture(o: *Out, ctx: *const Ctx, t: *const c.cgltf_texture) !void {
    try o.beginObj();
    if (cstr(t.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    if (ranked(c.cgltf_image, ctx.d.images, ctx.d.images_count, t.image, ctx.keep.images.rank)) |ii| {
        try o.key("source");
        try o.int(ii);
    }
    if (ranked(c.cgltf_sampler, ctx.d.samplers, ctx.d.samplers_count, t.sampler, ctx.keep.samplers.rank)) |si| {
        try o.key("sampler");
        try o.int(si);
    }
    if (t.has_basisu != 0 or t.has_webp != 0 or t.extensions_count > 0) {
        try o.key("extensions");
        try o.beginObj();
        if (t.has_basisu != 0) {
            try o.key("KHR_texture_basisu");
            try o.beginObj();
            if (ranked(c.cgltf_image, ctx.d.images, ctx.d.images_count, t.basisu_image, ctx.keep.images.rank)) |ii| {
                try o.key("source");
                try o.int(ii);
            }
            try o.endObj();
        }
        if (t.has_webp != 0) {
            try o.key("EXT_texture_webp");
            try o.beginObj();
            if (ranked(c.cgltf_image, ctx.d.images, ctx.d.images_count, t.webp_image, ctx.keep.images.rank)) |ii| {
                try o.key("source");
                try o.int(ii);
            }
            try o.endObj();
        }
        for (geom.sl(c.cgltf_extension, t.extensions, t.extensions_count)) |*e| {
            const name = cstr(e.name) orelse continue;
            const data = if (@intFromPtr(e.data) != 0) std.mem.span(e.data) else "{}";
            try o.key(name);
            try o.raw(if (isEmptyObjSlice(data)) "{}" else data);
        }
        try o.endObj();
    }
    try writeExtras(o, &t.extras);
    try o.endObj();
}

fn writeMaterial(o: *Out, ctx: *const Ctx, m: *const c.cgltf_material) !void {
    try o.beginObj();
    if (cstr(m.name)) |s| {
        try o.key("name");
        try o.str(s);
    }

    if (m.has_pbr_metallic_roughness != 0) {
        const pbr = &m.pbr_metallic_roughness;
        try o.key("pbrMetallicRoughness");
        try o.beginObj();
        try o.key("baseColorFactor");
        try o.floatArr(pbr.base_color_factor);
        try o.key("metallicFactor");
        try o.floatAff(pbr.metallic_factor);
        try o.key("roughnessFactor");
        try o.floatAff(pbr.roughness_factor);
        try emitTexInfoKey(o, ctx, "baseColorTexture", &pbr.base_color_texture);
        try emitTexInfoKey(o, ctx, "metallicRoughnessTexture", &pbr.metallic_roughness_texture);
        try o.endObj();
    }

    try emitNormalTexture(o, ctx, &m.normal_texture);
    try emitOcclusionTexture(o, ctx, &m.occlusion_texture);
    try emitTexInfoKey(o, ctx, "emissiveTexture", &m.emissive_texture);

    try o.key("emissiveFactor");
    try o.floatArr(m.emissive_factor);

    switch (m.alpha_mode) {
        1 => {
            try o.key("alphaMode");
            try o.str("MASK");
        },
        2 => {
            try o.key("alphaMode");
            try o.str("BLEND");
        },
        else => {},
    }
    if (m.alpha_mode == 1 and m.alpha_cutoff != 0.5) {
        try o.key("alphaCutoff");
        try o.floatAff(m.alpha_cutoff);
    }
    if (m.double_sided != 0) {
        try o.key("doubleSided");
        try o.raw("true");
    }

    // typed KHR_materials_* extensions
    var any_ext = m.unlit != 0 or
        m.has_pbr_specular_glossiness != 0 or
        m.has_clearcoat != 0 or
        m.has_transmission != 0 or
        m.has_volume != 0 or
        m.has_ior != 0 or
        m.has_specular != 0 or
        m.has_sheen != 0 or
        m.has_emissive_strength != 0 or
        m.has_iridescence != 0 or
        m.has_diffuse_transmission != 0 or
        m.has_anisotropy != 0 or
        m.has_dispersion != 0;
    if (m.extensions_count > 0) any_ext = true;

    if (any_ext) {
        try o.key("extensions");
        try o.beginObj();

        if (m.has_pbr_specular_glossiness != 0) {
            const sg = &m.pbr_specular_glossiness;
            try o.key("KHR_materials_pbrSpecularGlossiness");
            try o.beginObj();
            try o.key("diffuseFactor");
            try o.floatArr(sg.diffuse_factor);
            try o.key("specularFactor");
            try o.floatArr(sg.specular_factor);
            try o.key("glossinessFactor");
            try o.floatAff(sg.glossiness_factor);
            try emitTexInfoKey(o, ctx, "diffuseTexture", &sg.diffuse_texture);
            try emitTexInfoKey(o, ctx, "specularGlossinessTexture", &sg.specular_glossiness_texture);
            try o.endObj();
        }
        if (m.unlit != 0) {
            try o.key("KHR_materials_unlit");
            try o.raw("{}");
        }
        if (m.has_emissive_strength != 0) {
            try o.key("KHR_materials_emissive_strength");
            try o.beginObj();
            try o.key("emissiveStrength");
            try o.floatAff(m.emissive_strength.emissive_strength);
            try o.endObj();
        }
        if (m.has_clearcoat != 0) {
            const cc = &m.clearcoat;
            try o.key("KHR_materials_clearcoat");
            try o.beginObj();
            try o.key("clearcoatFactor");
            try o.floatAff(cc.clearcoat_factor);
            try o.key("clearcoatRoughnessFactor");
            try o.floatAff(cc.clearcoat_roughness_factor);
            try emitTexInfoKey(o, ctx, "clearcoatTexture", &cc.clearcoat_texture);
            try emitTexInfoKey(o, ctx, "clearcoatRoughnessTexture", &cc.clearcoat_roughness_texture);
            try emitTexInfoKey(o, ctx, "clearcoatNormalTexture", &cc.clearcoat_normal_texture);
            try o.endObj();
        }
        if (m.has_transmission != 0) {
            try o.key("KHR_materials_transmission");
            try o.beginObj();
            try o.key("transmissionFactor");
            try o.floatAff(m.transmission.transmission_factor);
            try emitTexInfoKey(o, ctx, "transmissionTexture", &m.transmission.transmission_texture);
            try o.endObj();
        }
        if (m.has_volume != 0) {
            const vol = &m.volume;
            try o.key("KHR_materials_volume");
            try o.beginObj();
            try o.key("thicknessFactor");
            try o.floatAff(vol.thickness_factor);
            try emitTexInfoKey(o, ctx, "thicknessTexture", &vol.thickness_texture);
            try o.key("attenuationDistance");
            try o.floatAff(vol.attenuation_distance);
            try o.key("attenuationColor");
            try o.floatArr(vol.attenuation_color);
            try o.endObj();
        }
        if (m.has_ior != 0) {
            try o.key("KHR_materials_ior");
            try o.beginObj();
            try o.key("ior");
            try o.floatAff(m.ior.ior);
            try o.endObj();
        }
        if (m.has_specular != 0) {
            const sp = &m.specular;
            try o.key("KHR_materials_specular");
            try o.beginObj();
            try o.key("specularFactor");
            try o.floatAff(sp.specular_factor);
            try emitTexInfoKey(o, ctx, "specularTexture", &sp.specular_texture);
            try o.key("specularColorFactor");
            try o.floatArr(sp.specular_color_factor);
            try emitTexInfoKey(o, ctx, "specularColorTexture", &sp.specular_color_texture);
            try o.endObj();
        }
        if (m.has_sheen != 0) {
            const sh = &m.sheen;
            try o.key("KHR_materials_sheen");
            try o.beginObj();
            try o.key("sheenColorFactor");
            try o.floatArr(sh.sheen_color_factor);
            try emitTexInfoKey(o, ctx, "sheenColorTexture", &sh.sheen_color_texture);
            try o.key("sheenRoughnessFactor");
            try o.floatAff(sh.sheen_roughness_factor);
            try emitTexInfoKey(o, ctx, "sheenRoughnessTexture", &sh.sheen_roughness_texture);
            try o.endObj();
        }
        if (m.has_iridescence != 0) {
            const ir = &m.iridescence;
            try o.key("KHR_materials_iridescence");
            try o.beginObj();
            try o.key("iridescenceFactor");
            try o.floatAff(ir.iridescence_factor);
            try emitTexInfoKey(o, ctx, "iridescenceTexture", &ir.iridescence_texture);
            try o.key("iridescenceIor");
            try o.floatAff(ir.iridescence_ior);
            try o.key("iridescenceThicknessMinimum");
            try o.floatAff(ir.iridescence_thickness_min);
            try o.key("iridescenceThicknessMaximum");
            try o.floatAff(ir.iridescence_thickness_max);
            try emitTexInfoKey(o, ctx, "iridescenceThicknessTexture", &ir.iridescence_thickness_texture);
            try o.endObj();
        }
        if (m.has_diffuse_transmission != 0) {
            const dt = &m.diffuse_transmission;
            try o.key("KHR_materials_diffuse_transmission");
            try o.beginObj();
            try o.key("diffuseTransmissionFactor");
            try o.floatAff(dt.diffuse_transmission_factor);
            try emitTexInfoKey(o, ctx, "diffuseTransmissionTexture", &dt.diffuse_transmission_texture);
            try o.key("diffuseTransmissionColorFactor");
            try o.floatArr(dt.diffuse_transmission_color_factor);
            try emitTexInfoKey(o, ctx, "diffuseTransmissionColorTexture", &dt.diffuse_transmission_color_texture);
            try o.endObj();
        }
        if (m.has_anisotropy != 0) {
            const an = &m.anisotropy;
            try o.key("KHR_materials_anisotropy");
            try o.beginObj();
            try o.key("anisotropyStrength");
            try o.floatAff(an.anisotropy_strength);
            try o.key("anisotropyRotation");
            try o.floatAff(an.anisotropy_rotation);
            try emitTexInfoKey(o, ctx, "anisotropyTexture", &an.anisotropy_texture);
            try o.endObj();
        }
        if (m.has_dispersion != 0) {
            try o.key("KHR_materials_dispersion");
            try o.beginObj();
            try o.key("dispersion");
            try o.floatAff(m.dispersion.dispersion);
            try o.endObj();
        }

        for (geom.sl(c.cgltf_extension, m.extensions, m.extensions_count)) |*e| {
            const name = cstr(e.name) orelse continue;
            const data = if (@intFromPtr(e.data) != 0) std.mem.span(e.data) else "{}";
            try o.key(name);
            try o.raw(if (isEmptyObjSlice(data)) "{}" else data);
        }
        try o.endObj();
    }

    try writeExtras(o, &m.extras);
    try o.endObj();
}

fn writeAttributes(o: *Out, ctx: *const Ctx, attrs: [*c]c.cgltf_attribute, count: usize) !void {
    try o.beginObj();
    for (geom.sl(c.cgltf_attribute, attrs, count)) |*a| {
        const name = cstr(a.name) orelse continue;
        const ai = ranked(c.cgltf_accessor, ctx.d.accessors, ctx.d.accessors_count, a.data, ctx.keep.accessors.rank) orelse continue;
        try o.key(name);
        try o.int(ai);
    }
    try o.endObj();
}

fn writePrimitive(o: *Out, ctx: *const Ctx, p: *const c.cgltf_primitive) !void {
    try o.beginObj();
    const mode: u32 = if (p.type == 0) 4 else @intCast(p.type - 1);
    if (mode != 4) {
        try o.key("mode");
        try o.int(mode);
    }
    try o.key("attributes");
    try writeAttributes(o, ctx, p.attributes, p.attributes_count);
    if (ranked(c.cgltf_accessor, ctx.d.accessors, ctx.d.accessors_count, p.indices, ctx.keep.accessors.rank)) |ii| {
        try o.key("indices");
        try o.int(ii);
    }
    if (ranked(c.cgltf_material, ctx.d.materials, ctx.d.materials_count, p.material, ctx.keep.materials.rank)) |mi| {
        try o.key("material");
        try o.int(mi);
    }
    if (p.targets_count > 0) {
        try o.key("targets");
        try o.beginArr();
        for (geom.sl(c.cgltf_morph_target, p.targets, p.targets_count)) |*t| {
            try o.item();
            try writeAttributes(o, ctx, t.attributes, t.attributes_count);
        }
        try o.endArr();
    }
    try writeRawExtensions(o, p.extensions, p.extensions_count);
    try writeExtras(o, &p.extras);
    try o.endObj();
}

fn writeMesh(o: *Out, ctx: *const Ctx, m: *const c.cgltf_mesh) !void {
    try o.beginObj();
    if (cstr(m.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    try o.key("primitives");
    try o.beginArr();
    for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
        try o.item();
        try writePrimitive(o, ctx, p);
    }
    try o.endArr();
    if (m.weights_count > 0) {
        try o.key("weights");
        try o.beginArr();
        for (geom.sl(c.cgltf_float, m.weights, m.weights_count)) |w| {
            try o.item();
            try o.floatAff(w);
        }
        try o.endArr();
    }
    if (@intFromPtr(m.extras.data) != 0) {
        try writeExtras(o, &m.extras);
    } else if (m.target_names_count > 0) {
        try o.key("extras");
        try o.beginObj();
        try o.key("targetNames");
        try o.beginArr();
        for (geom.sl([*c]u8, @ptrCast(m.target_names), m.target_names_count)) |p| {
            try o.item();
            try o.str(cstr(p) orelse "");
        }
        try o.endArr();
        try o.endObj();
    }
    try writeRawExtensions(o, m.extensions, m.extensions_count);
    try o.endObj();
}

fn writeCamera(o: *Out, cam: *const c.cgltf_camera) !void {
    try o.beginObj();
    if (cstr(cam.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    switch (cam.type) {
        1 => {
            const p = &cam.data.perspective;
            try o.key("type");
            try o.str("perspective");
            try o.key("perspective");
            try o.beginObj();
            try o.key("yfov");
            try o.floatAff(p.yfov);
            try o.key("znear");
            try o.floatAff(p.znear);
            if (p.has_aspect_ratio != 0) {
                try o.key("aspectRatio");
                try o.floatAff(p.aspect_ratio);
            }
            if (p.has_zfar != 0) {
                try o.key("zfar");
                try o.floatAff(p.zfar);
            }
            try writeExtras(o, &p.extras);
            try o.endObj();
        },
        2 => {
            const p = &cam.data.orthographic;
            try o.key("type");
            try o.str("orthographic");
            try o.key("orthographic");
            try o.beginObj();
            try o.key("xmag");
            try o.floatAff(p.xmag);
            try o.key("ymag");
            try o.floatAff(p.ymag);
            try o.key("znear");
            try o.floatAff(p.znear);
            try o.key("zfar");
            try o.floatAff(p.zfar);
            try writeExtras(o, &p.extras);
            try o.endObj();
        },
        else => {},
    }
    try writeRawExtensions(o, cam.extensions, cam.extensions_count);
    try writeExtras(o, &cam.extras);
    try o.endObj();
}

fn writeNode(o: *Out, ctx: *const Ctx, n: *const c.cgltf_node) !void {
    try o.beginObj();
    if (cstr(n.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    if (ranked(c.cgltf_mesh, ctx.d.meshes, ctx.d.meshes_count, n.mesh, ctx.keep.meshes.rank)) |mi| {
        try o.key("mesh");
        try o.int(mi);
    }
    if (geom.ptrIndex(c.cgltf_skin, ctx.d.skins, ctx.d.skins_count, n.skin)) |si| {
        try o.key("skin");
        try o.int(si);
    }
    if (ranked(c.cgltf_camera, ctx.d.cameras, ctx.d.cameras_count, n.camera, ctx.keep.cameras.rank)) |ci| {
        try o.key("camera");
        try o.int(ci);
    }
    if (n.children_count > 0) {
        try o.key("children");
        try o.beginArr();
        for (geom.sl([*c]c.cgltf_node, n.children, n.children_count)) |ch| {
            const ci = ranked(c.cgltf_node, ctx.d.nodes, ctx.d.nodes_count, ch, ctx.keep.nodes.rank) orelse continue;
            try o.item();
            try o.int(ci);
        }
        try o.endArr();
    }
    if (n.has_matrix != 0) {
        try o.key("matrix");
        try o.floatArr(n.matrix);
    } else {
        if (n.has_translation != 0) {
            try o.key("translation");
            try o.floatArr(n.translation);
        }
        if (n.has_rotation != 0) {
            try o.key("rotation");
            try o.floatArr(n.rotation);
        }
        if (n.has_scale != 0) {
            try o.key("scale");
            try o.floatArr(n.scale);
        }
    }
    if (n.weights_count > 0) {
        try o.key("weights");
        try o.beginArr();
        for (geom.sl(c.cgltf_float, n.weights, n.weights_count)) |w| {
            try o.item();
            try o.floatAff(w);
        }
        try o.endArr();
    }
    // extensions: KHR_lights_punctual + EXT_mesh_gpu_instancing + unknowns
    const has_ext = @intFromPtr(n.light) != 0 or n.has_mesh_gpu_instancing != 0 or n.extensions_count > 0;
    if (has_ext) {
        try o.key("extensions");
        try o.beginObj();
        if (@intFromPtr(n.light) != 0) {
            const li = ranked(c.cgltf_light, ctx.d.lights, ctx.d.lights_count, n.light, ctx.keep.lights.rank) orelse 0;
            try o.key("KHR_lights_punctual");
            try o.beginObj();
            try o.key("light");
            try o.int(li);
            try o.endObj();
        }
        if (n.has_mesh_gpu_instancing != 0) {
            try o.key("EXT_mesh_gpu_instancing");
            try o.beginObj();
            try o.key("attributes");
            try writeAttributes(o, ctx, n.mesh_gpu_instancing.attributes, n.mesh_gpu_instancing.attributes_count);
            try o.endObj();
        }
        for (geom.sl(c.cgltf_extension, n.extensions, n.extensions_count)) |*e| {
            const name = cstr(e.name) orelse continue;
            const data = if (@intFromPtr(e.data) != 0) std.mem.span(e.data) else "{}";
            try o.key(name);
            try o.raw(if (isEmptyObjSlice(data)) "{}" else data);
        }
        try o.endObj();
    }
    try writeExtras(o, &n.extras);
    try o.endObj();
}

fn writeScene(o: *Out, ctx: *const Ctx, s: *const c.cgltf_scene) !void {
    try o.beginObj();
    if (cstr(s.name)) |n| {
        try o.key("name");
        try o.str(n);
    }
    var kept_roots: usize = 0;
    for (geom.sl([*c]c.cgltf_node, s.nodes, s.nodes_count)) |np| {
        const ni = geom.ptrIndex(c.cgltf_node, ctx.d.nodes, ctx.d.nodes_count, np) orelse continue;
        if (kept(ctx.keep.nodes.rank, ni) != null) kept_roots += 1;
    }
    if (kept_roots > 0) {
        try o.key("nodes");
        try o.beginArr();
        for (geom.sl([*c]c.cgltf_node, s.nodes, s.nodes_count)) |np| {
            const ni = ranked(c.cgltf_node, ctx.d.nodes, ctx.d.nodes_count, np, ctx.keep.nodes.rank) orelse continue;
            try o.item();
            try o.int(ni);
        }
        try o.endArr();
    }
    try writeRawExtensions(o, s.extensions, s.extensions_count);
    try writeExtras(o, &s.extras);
    try o.endObj();
}

fn writeSkin(o: *Out, ctx: *const Ctx, sk: *const c.cgltf_skin) !void {
    try o.beginObj();
    if (cstr(sk.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    if (ranked(c.cgltf_accessor, ctx.d.accessors, ctx.d.accessors_count, sk.inverse_bind_matrices, ctx.keep.accessors.rank)) |ai| {
        try o.key("inverseBindMatrices");
        try o.int(ai);
    }
    if (ranked(c.cgltf_node, ctx.d.nodes, ctx.d.nodes_count, sk.skeleton, ctx.keep.nodes.rank)) |ni| {
        try o.key("skeleton");
        try o.int(ni);
    }
    try o.key("joints");
    try o.beginArr();
    for (geom.sl([*c]c.cgltf_node, sk.joints, sk.joints_count)) |jp| {
        const ji = ranked(c.cgltf_node, ctx.d.nodes, ctx.d.nodes_count, jp, ctx.keep.nodes.rank) orelse continue;
        try o.item();
        try o.int(ji);
    }
    try o.endArr();
    try writeRawExtensions(o, sk.extensions, sk.extensions_count);
    try writeExtras(o, &sk.extras);
    try o.endObj();
}

fn writeAnimation(o: *Out, ctx: *const Ctx, an: *const c.cgltf_animation) !void {
    try o.beginObj();
    if (cstr(an.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    try o.key("channels");
    try o.beginArr();
    for (geom.sl(c.cgltf_animation_channel, an.channels, an.channels_count)) |*ch| {
        try o.item();
        try o.beginObj();
        if (geom.ptrIndex(c.cgltf_animation_sampler, an.samplers, an.samplers_count, ch.sampler)) |si| {
            try o.key("sampler");
            try o.int(si);
        }
        try o.key("target");
        try o.beginObj();
        if (geom.ptrIndex(c.cgltf_node, ctx.d.nodes, ctx.d.nodes_count, ch.target_node)) |ni| {
            if (kept(ctx.keep.nodes.rank, ni)) |nn| {
                try o.key("node");
                try o.int(nn);
            }
        }
        const path: []const u8 = switch (ch.target_path) {
            1 => "translation",
            2 => "rotation",
            3 => "scale",
            4 => "weights",
            else => "translation",
        };
        try o.key("path");
        try o.str(path);
        try o.endObj();
        try writeRawExtensions(o, ch.extensions, ch.extensions_count);
        try writeExtras(o, &ch.extras);
        try o.endObj();
    }
    try o.endArr();

    try o.key("samplers");
    try o.beginArr();
    for (geom.sl(c.cgltf_animation_sampler, an.samplers, an.samplers_count)) |*s| {
        try o.item();
        try o.beginObj();
        if (ranked(c.cgltf_accessor, ctx.d.accessors, ctx.d.accessors_count, s.input, ctx.keep.accessors.rank)) |ai| {
            try o.key("input");
            try o.int(ai);
        }
        if (ranked(c.cgltf_accessor, ctx.d.accessors, ctx.d.accessors_count, s.output, ctx.keep.accessors.rank)) |ai| {
            try o.key("output");
            try o.int(ai);
        }
        const interp: []const u8 = switch (s.interpolation) {
            1 => "STEP",
            2 => "CUBICSPLINE",
            else => "LINEAR",
        };
        if (s.interpolation != 0) {
            try o.key("interpolation");
            try o.str(interp);
        }
        try writeRawExtensions(o, s.extensions, s.extensions_count);
        try writeExtras(o, &s.extras);
        try o.endObj();
    }
    try o.endArr();

    try writeExtras(o, &an.extras);
    try writeRawExtensions(o, an.extensions, an.extensions_count);
    try o.endObj();
}

fn writeLight(o: *Out, l: *const c.cgltf_light) !void {
    try o.beginObj();
    if (cstr(l.name)) |s| {
        try o.key("name");
        try o.str(s);
    }
    try o.key("color");
    try o.floatArr(l.color);
    try o.key("intensity");
    try o.floatAff(l.intensity);
    const kind: ?[]const u8 = switch (l.type) {
        1 => "directional",
        2 => "point",
        3 => "spot",
        else => null,
    };
    if (kind) |k| {
        try o.key("type");
        try o.str(k);
    }
    if (l.type == 3) {
        try o.key("range");
        try o.floatAff(l.range);
        try o.key("spot");
        try o.beginObj();
        try o.key("innerConeAngle");
        try o.floatAff(l.spot_inner_cone_angle);
        try o.key("outerConeAngle");
        try o.floatAff(l.spot_outer_cone_angle);
        try o.endObj();
    } else if (l.type == 2 and l.range != 0) {
        try o.key("range");
        try o.floatAff(l.range);
    }
    try writeExtras(o, &l.extras);
    try o.endObj();
}

// ---------------------------------------------------------------------------
// bounds computation (POSITION must always carry min/max)
// ---------------------------------------------------------------------------

fn computeBounds(a: std.mem.Allocator, acc: *const c.cgltf_accessor) !Bounds {
    const ncomp = geom.numComponents(acc.type);
    const total = @as(usize, @intCast(acc.count)) * ncomp;
    if (total == 0) return error.Unsupported;
    const tmp = try a.alloc(f32, total);
    // cgltf fills accessor->stride during parse; default 0 means tightly packed
    var acc2 = acc.*;
    if (acc2.stride == 0) acc2.stride = c.cgltf_calc_size(acc2.type, acc2.component_type);
    const got = c.cgltf_accessor_unpack_floats(&acc2, tmp.ptr, total);
    if (got < total) return error.Unsupported;
    var out: Bounds = .{};
    for (0..ncomp) |k| {
        out.min[k] = tmp[k];
        out.max[k] = tmp[k];
    }
    var e: usize = 1;
    while (e < acc.count) : (e += 1) {
        for (0..ncomp) |k| {
            const v = tmp[e * ncomp + k];
            if (v < out.min[k]) out.min[k] = v;
            if (v > out.max[k]) out.max[k] = v;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/// Serialize `data` (parsed from `file_bytes`) into a self-contained GLB.
///
/// All allocations are made with `a`. Returns `error.Unsupported` when the
/// asset cannot be represented as a single-buffer GLB (writer-produced
/// meshopt output without exactly one real buffer). External buffers and
/// images are copied into the BIN chunk; when one has no loaded payload,
/// `error.InvalidData` is returned instead of emitting a dangling uri.
/// Inflated meshopt input (decoded at parse) serializes as plain views.
pub fn serialize(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8) ![]u8 {
    return serializeWithImages(a, data, file_bytes, &.{});
}

/// `serialize` plus parse-time image metadata: image `index` in `images`
/// (index-aligned with `data.images`) supplies payloads for external uris and
/// a mime fallback. An empty slice keeps the plain cgltf behavior.
pub fn serializeWithImages(
    a: std.mem.Allocator,
    data: *c.cgltf_data,
    file_bytes: []const u8,
    asset_images: []const model.Image,
) ![]u8 {
    _ = file_bytes;

    // --- reachability GC: which pool entries are actually referenced? ---
    const keep = try Keep.compute(a, data);

    // --- meshopt layout: placeholder offsets for compressed views ---------
    const mc_view = try a.alloc(bool, data.buffer_views_count);
    @memset(mc_view, false);
    const mc_ph = try a.alloc(u64, data.buffer_views_count);
    @memset(mc_ph, 0);
    var ph_total: u64 = 0;
    var has_mc = false;
    for (geom.sl(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count), 0..) |*v, i| {
        if (!keep.views.keep[i] or v.has_meshopt_compression == 0) continue;
        mc_view[i] = true;
        has_mc = true;
        const rem = ph_total % 4;
        if (rem != 0) ph_total += 4 - rem;
        mc_ph[i] = ph_total;
        ph_total += v.size;
    }
    // The compressed payloads live in buffer 0 (the BIN chunk): without any
    // real buffer there is nowhere to point the extension objects.
    if (has_mc and data.buffers_count == 0) return error.Unsupported;
    if (has_mc) {
        // Writer-produced meshopt output needs exactly one real buffer (the
        // BIN payloads) plus the appended placeholder.
        if (data.buffers_count != 1) return error.Unsupported;
    }
    // Plain path (!has_mc): the BIN chunk below carries every kept view's
    // bytes (inflated meshopt views, concatenated multi-buffer input), so a
    // single output buffer suffices however many inputs were parsed.

    // --- BIN chunk: copy every kept buffer view, 4-byte aligned ---
    const view_off = try a.alloc(u64, data.buffer_views_count);
    @memset(view_off, 0);
    var bin: std.ArrayList(u8) = .empty;
    for (geom.sl(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count), 0..) |*v, i| {
        if (!keep.views.keep[i]) continue;
        const rem = bin.items.len % 4;
        if (rem != 0) {
            try bin.resize(a, bin.items.len + (4 - rem));
            @memset(bin.items[bin.items.len - (4 - rem) ..], 0);
        }
        view_off[i] = bin.items.len;
        const bytes = geom.viewBytes(v) orelse return error.InvalidData;
        try bin.appendSlice(a, bytes);
    }

    // --- external image payloads: buffer views appended after the kept ones
    const aligned_images: []const model.Image =
        if (asset_images.len == data.images_count) asset_images else &.{};
    const img_extra = try a.alloc(?ImgExtra, data.images_count);
    @memset(img_extra, null);
    var extra_views: u32 = 0;
    for (geom.sl(c.cgltf_image, data.images, data.images_count), 0..) |*im, i| {
        if (!keep.images.keep[i]) continue;
        var has_view = false;
        if (geom.ptrIndex(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count, im.buffer_view)) |bi| {
            has_view = kept(keep.views.rank, bi) != null;
        }
        if (has_view) continue; // embedded payload already copied above

        var payload: ?[]const u8 = null;
        var mime: []const u8 = mimeString(.other);
        if (i < aligned_images.len) {
            payload = aligned_images[i].data;
            if (aligned_images[i].mime != .other) mime = mimeString(aligned_images[i].mime);
        }
        if (cstr(im.mime_type)) |s| {
            if (payload != null and std.mem.eql(u8, mime, mimeString(.other))) mime = s;
        }
        if (payload) |bytes| {
            const rem = bin.items.len % 4;
            if (rem != 0) {
                try bin.resize(a, bin.items.len + (4 - rem));
                @memset(bin.items[bin.items.len - (4 - rem) ..], 0);
            }
            img_extra[i] = .{
                .index = @intCast(keep.views.count() + extra_views),
                .off = bin.items.len,
                .len = bytes.len,
                .mime = mime,
            };
            extra_views += 1;
            try bin.appendSlice(a, bytes);
            continue;
        }
        // No payload and no local reference: an absolute URL can ship as a
        // uri, anything else would dangle relative to the new output file.
        const uri = cstr(im.uri) orelse return error.InvalidData;
        if (std.mem.indexOf(u8, uri, "://") == null and !std.mem.startsWith(u8, uri, "data:")) {
            return error.InvalidData;
        }
    }

    // --- byteStride: emit only when it differs from an accessor's natural stride ---
    const keep_stride = try a.alloc(bool, data.buffer_views_count);
    @memset(keep_stride, false);
    for (geom.sl(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count), 0..) |*v, i| {
        if (!keep.views.keep[i]) continue;
        if (v.stride == 0) continue;
        for (geom.sl(c.cgltf_accessor, data.accessors, data.accessors_count), 0..) |*acc, ai| {
            if (!keep.accessors.keep[ai]) continue;
            if (acc.buffer_view == v) {
                const natural = c.cgltf_calc_size(acc.type, acc.component_type);
                if (natural != v.stride) {
                    keep_stride[i] = true;
                    break;
                }
            }
        }
    }

    // --- mark POSITION accessors, compute missing min/max ---
    const acc_count: usize = @intCast(data.accessors_count);
    const is_position = try a.alloc(bool, acc_count);
    @memset(is_position, false);
    for (geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count), 0..) |*m, mi| {
        if (!keep.meshes.keep[mi]) continue;
        for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            for (geom.sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                if (at.type == 1) {
                    if (geom.ptrIndex(c.cgltf_accessor, data.accessors, data.accessors_count, at.data)) |ai| is_position[ai] = true;
                }
            }
            for (geom.sl(c.cgltf_morph_target, p.targets, p.targets_count)) |*t| {
                for (geom.sl(c.cgltf_attribute, t.attributes, t.attributes_count)) |*at| {
                    if (at.type == 1) {
                        if (geom.ptrIndex(c.cgltf_accessor, data.accessors, data.accessors_count, at.data)) |ai| is_position[ai] = true;
                    }
                }
            }
        }
    }
    const bounds = try a.alloc(?Bounds, acc_count);
    @memset(bounds, null);
    for (geom.sl(c.cgltf_accessor, data.accessors, data.accessors_count), 0..) |*acc, i| {
        if (!keep.accessors.keep[i]) continue;
        if (is_position[i] and (acc.has_min == 0 or acc.has_max == 0)) {
            bounds[i] = try computeBounds(a, acc);
        }
    }

    const ctx = Ctx{
        .a = a,
        .d = data,
        .view_off = view_off,
        .bin_len = bin.items.len,
        .keep_stride = keep_stride,
        .bounds = bounds,
        .keep = &keep,
        .mc_view = mc_view,
        .mc_ph = mc_ph,
        .ph_total = ph_total,
        .placeholder_idx = @intCast(data.buffers_count),
        .has_mc = has_mc,
        .img_extra = img_extra,
        .images = aligned_images,
    };

    // --- JSON chunk ---
    var o = Out{ .a = a };
    try o.beginObj();

    try o.key("asset");
    try writeAsset(&o, data);

    if (geom.ptrIndex(c.cgltf_scene, data.scenes, data.scenes_count, data.scene)) |si| {
        try o.key("scene");
        try o.int(si);
    }

    if (data.scenes_count > 0) {
        try o.key("scenes");
        try o.beginArr();
        for (geom.sl(c.cgltf_scene, data.scenes, data.scenes_count)) |*s| {
            try o.item();
            try writeScene(&o, &ctx, s);
        }
        try o.endArr();
    }
    if (keep.nodes.count() > 0) {
        try o.key("nodes");
        try o.beginArr();
        for (geom.sl(c.cgltf_node, data.nodes, data.nodes_count), 0..) |*n, i| {
            if (!keep.nodes.keep[i]) continue;
            try o.item();
            try writeNode(&o, &ctx, n);
        }
        try o.endArr();
    }
    if (keep.meshes.count() > 0) {
        try o.key("meshes");
        try o.beginArr();
        for (geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count), 0..) |*m, i| {
            if (!keep.meshes.keep[i]) continue;
            try o.item();
            try writeMesh(&o, &ctx, m);
        }
        try o.endArr();
    }
    if (keep.materials.count() > 0) {
        try o.key("materials");
        try o.beginArr();
        for (geom.sl(c.cgltf_material, data.materials, data.materials_count), 0..) |*m, i| {
            if (!keep.materials.keep[i]) continue;
            try o.item();
            try writeMaterial(&o, &ctx, m);
        }
        try o.endArr();
    }
    if (keep.accessors.count() > 0) {
        try o.key("accessors");
        try o.beginArr();
        for (geom.sl(c.cgltf_accessor, data.accessors, data.accessors_count), 0..) |*acc, i| {
            if (!keep.accessors.keep[i]) continue;
            try o.item();
            try writeAccessor(&o, &ctx, i, acc);
        }
        try o.endArr();
    }
    if (keep.views.count() > 0 or extra_views > 0) {
        try o.key("bufferViews");
        try o.beginArr();
        for (geom.sl(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count), 0..) |*v, i| {
            if (!keep.views.keep[i]) continue;
            try o.item();
            try writeBufferView(&o, &ctx, i, v);
        }
        // Image payloads inlined above: plain appends, no accessor points here.
        for (img_extra) |maybe| {
            const ex = maybe orelse continue;
            try o.item();
            try o.beginObj();
            try o.key("buffer");
            try o.int(0);
            try o.key("byteOffset");
            try o.int(ex.off);
            try o.key("byteLength");
            try o.int(ex.len);
            try o.endObj();
        }
        try o.endArr();
    }
    if (data.buffers_count > 0 or bin.items.len > 0) {
        try o.key("buffers");
        try o.beginArr();
        if (data.buffers_count == 0) {
            // Image-only asset: the inlined payload still needs an owner.
            try o.item();
            try o.beginObj();
            try o.key("byteLength");
            try o.int(ctx.bin_len);
            try o.endObj();
        } else if (ctx.has_mc) {
            for (geom.sl(c.cgltf_buffer, data.buffers, data.buffers_count)) |*b| {
                try o.item();
                try writeBuffer(&o, &ctx, b);
            }
            // Fallback buffer backing the decompressed layout (no URI, no
            // BIN data): loaders with the extension ignore it, loaders
            // without it fail on extensionsRequired, as the spec requires.
            try o.item();
            try o.beginObj();
            try o.key("byteLength");
            try o.int(ctx.ph_total);
            try o.key("extensions");
            try o.beginObj();
            try o.key("EXT_meshopt_compression");
            try o.beginObj();
            try o.key("fallback");
            try o.raw("true");
            try o.endObj();
            try o.endObj();
            try o.endObj();
        } else {
            // Single-buffer output: the BIN chunk holds every kept view, so
            // one entry (buffer 0's name/extras) describes it. Inflated
            // meshopt input drops its dead placeholder buffer here.
            try o.item();
            const b0: *c.cgltf_buffer = @ptrCast(&data.buffers[0]);
            try writeBuffer(&o, &ctx, b0);
        }
        try o.endArr();
    }
    if (keep.images.count() > 0) {
        try o.key("images");
        try o.beginArr();
        for (geom.sl(c.cgltf_image, data.images, data.images_count), 0..) |*im, i| {
            if (!keep.images.keep[i]) continue;
            try o.item();
            try writeImage(&o, &ctx, im, i);
        }
        try o.endArr();
    }
    if (keep.textures.count() > 0) {
        try o.key("textures");
        try o.beginArr();
        for (geom.sl(c.cgltf_texture, data.textures, data.textures_count), 0..) |*t, i| {
            if (!keep.textures.keep[i]) continue;
            try o.item();
            try writeTexture(&o, &ctx, t);
        }
        try o.endArr();
    }
    if (keep.samplers.count() > 0) {
        try o.key("samplers");
        try o.beginArr();
        for (geom.sl(c.cgltf_sampler, data.samplers, data.samplers_count), 0..) |*s, i| {
            if (!keep.samplers.keep[i]) continue;
            try o.item();
            try writeSampler(&o, s);
        }
        try o.endArr();
    }
    if (keep.cameras.count() > 0) {
        try o.key("cameras");
        try o.beginArr();
        for (geom.sl(c.cgltf_camera, data.cameras, data.cameras_count), 0..) |*cam, i| {
            if (!keep.cameras.keep[i]) continue;
            try o.item();
            try writeCamera(&o, cam);
        }
        try o.endArr();
    }
    if (data.skins_count > 0) {
        try o.key("skins");
        try o.beginArr();
        for (geom.sl(c.cgltf_skin, data.skins, data.skins_count)) |*sk| {
            try o.item();
            try writeSkin(&o, &ctx, sk);
        }
        try o.endArr();
    }
    if (data.animations_count > 0) {
        try o.key("animations");
        try o.beginArr();
        for (geom.sl(c.cgltf_animation, data.animations, data.animations_count)) |*an| {
            try o.item();
            try writeAnimation(&o, &ctx, an);
        }
        try o.endArr();
    }

    // top-level extensions: KHR_lights_punctual + unknown
    if (keep.lights.count() > 0 or data.data_extensions_count > 0 or data.variants_count > 0) {
        try o.key("extensions");
        try o.beginObj();
        if (data.variants_count > 0) {
            try o.key("KHR_materials_variants");
            try o.beginObj();
            try o.key("variants");
            try o.beginArr();
            for (geom.sl(c.cgltf_material_variant, data.variants, data.variants_count)) |*v| {
                try o.item();
                try o.beginObj();
                if (cstr(v.name)) |n| {
                    try o.key("name");
                    try o.str(n);
                }
                try writeExtras(&o, &v.extras);
                try o.endObj();
            }
            try o.endArr();
            try o.endObj();
        }
        if (keep.lights.count() > 0) {
            try o.key("KHR_lights_punctual");
            try o.beginObj();
            try o.key("lights");
            try o.beginArr();
            for (geom.sl(c.cgltf_light, data.lights, data.lights_count), 0..) |*l, i| {
                if (!keep.lights.keep[i]) continue;
                try o.item();
                try writeLight(&o, l);
            }
            try o.endArr();
            try o.endObj();
        }
        for (geom.sl(c.cgltf_extension, data.data_extensions, data.data_extensions_count)) |*e| {
            const name = cstr(e.name) orelse continue;
            const data_js = if (@intFromPtr(e.data) != 0) std.mem.span(e.data) else "{}";
            try o.key(name);
            try o.raw(if (isEmptyObjSlice(data_js)) "{}" else data_js);
        }
        try o.endObj();
    }

    try writeExtras(&o, &data.extras);

    // Inflated meshopt input serializes as plain views: drop the extension
    // declaration (writer-produced mc output keeps it verbatim).
    if (keptExtCount(data.extensions_used, data.extensions_used_count, ctx.has_mc) > 0) {
        try o.key("extensionsUsed");
        try o.beginArr();
        for (geom.sl([*c]u8, @ptrCast(data.extensions_used), data.extensions_used_count)) |p| {
            const s = cstr(p) orelse "";
            if (!ctx.has_mc and std.mem.eql(u8, s, "EXT_meshopt_compression")) continue;
            try o.item();
            try o.str(s);
        }
        try o.endArr();
    }
    if (keptExtCount(data.extensions_required, data.extensions_required_count, ctx.has_mc) > 0) {
        try o.key("extensionsRequired");
        try o.beginArr();
        for (geom.sl([*c]u8, @ptrCast(data.extensions_required), data.extensions_required_count)) |p| {
            const s = cstr(p) orelse "";
            if (!ctx.has_mc and std.mem.eql(u8, s, "EXT_meshopt_compression")) continue;
            try o.item();
            try o.str(s);
        }
        try o.endArr();
    }

    try o.endObj();

    const json = o.buf.items;
    const json_pad = (4 - (json.len % 4)) % 4;
    const bin_pad = (4 - (bin.items.len % 4)) % 4;
    const has_bin = data.buffers_count > 0 or bin.items.len > 0;
    const total = 12 + 8 + json.len + json_pad + (if (has_bin) 8 + bin.items.len + bin_pad else 0);

    const out = try a.alignedAlloc(u8, .@"8", total);
    var w: usize = 0;

    var tmp4: [4]u8 = undefined;
    std.mem.writeInt(u32, &tmp4, 0x46546C67, .little); // 'glTF'
    @memcpy(out[w .. w + 4], &tmp4);
    w += 4;
    std.mem.writeInt(u32, &tmp4, 2, .little);
    @memcpy(out[w .. w + 4], &tmp4);
    w += 4;
    std.mem.writeInt(u32, &tmp4, @intCast(total), .little);
    @memcpy(out[w .. w + 4], &tmp4);
    w += 4;

    std.mem.writeInt(u32, &tmp4, @intCast(json.len + json_pad), .little);
    @memcpy(out[w .. w + 4], &tmp4);
    w += 4;
    std.mem.writeInt(u32, &tmp4, 0x4E4F534A, .little); // 'JSON'
    @memcpy(out[w .. w + 4], &tmp4);
    w += 4;
    @memcpy(out[w .. w + json.len], json);
    w += json.len;
    @memset(out[w .. w + json_pad], 0x20);
    w += json_pad;

    if (has_bin) {
        std.mem.writeInt(u32, &tmp4, @intCast(bin.items.len + bin_pad), .little);
        @memcpy(out[w .. w + 4], &tmp4);
        w += 4;
        std.mem.writeInt(u32, &tmp4, 0x004E4942, .little); // 'BIN\0'
        @memcpy(out[w .. w + 4], &tmp4);
        w += 4;
        @memcpy(out[w .. w + bin.items.len], bin.items);
        w += bin.items.len;
        @memset(out[w .. w + bin_pad], 0);
        w += bin_pad;
    }

    std.debug.assert(w == total);
    return out;
}

// ===========================================================================
// tests
// ===========================================================================

const parse_mod = @import("parse.zig");
const model = @import("model.zig");

fn entryLessThan(_: void, a: []const u8, b: []const u8) bool {
    return std.mem.lessThan(u8, a, b);
}

fn collectGlbs(a: std.mem.Allocator, io: std.Io, dir_path: []const u8) ![][]const u8 {
    var list: std.ArrayList([]const u8) = .empty;
    var dir = std.Io.Dir.cwd().openDir(io, dir_path, .{ .iterate = true }) catch return &.{};
    defer dir.close(io);
    var it = dir.iterate();
    while (try it.next(io)) |ent| {
        if (ent.kind != .file) continue;
        if (!std.mem.endsWith(u8, ent.name, ".glb")) continue;
        try list.append(a, try std.fmt.allocPrint(a, "{s}/{s}", .{ dir_path, ent.name }));
    }
    const out = try list.toOwnedSlice(a);
    std.mem.sort([]const u8, out, {}, entryLessThan);
    return out;
}

const Parsed = struct {
    data: *c.cgltf_data,

    fn deinit(self: *Parsed) void {
        c.cgltf_free(self.data);
    }
};

fn parseBytes(gpa: std.mem.Allocator, bytes: []const u8) !Parsed {
    _ = gpa;
    var options: c.cgltf_options = std.mem.zeroes(c.cgltf_options);
    var data: ?*c.cgltf_data = null;
    const res = c.cgltf_parse(&options, bytes.ptr, bytes.len, &data);
    if (res != c.cgltf_result_success or data == null) return error.ParseFailed;
    errdefer c.cgltf_free(data);
    const lres = c.cgltf_load_buffers(&options, data, null);
    if (lres != c.cgltf_result_success) return error.LoadFailed;
    return .{ .data = data.? };
}

fn readLogFloats(a: std.mem.Allocator, acc: *const c.cgltf_accessor) ![]f32 {
    const ncomp = geom.numComponents(acc.type);
    const total = @as(usize, @intCast(acc.count)) * ncomp;
    const buf = try a.alloc(f32, total);
    const got = c.cgltf_accessor_unpack_floats(acc, buf.ptr, total);
    return buf[0..got];
}

const Snapshot = struct {
    /// attribute names joined with '\x00'
    prim_attrs: []const u8 = &.{},
    prim_counts: []const u32 = &.{},
    tex_bindings: []const f32 = &.{},
};

fn snapshot(a: std.mem.Allocator, data: *c.cgltf_data, keep: *const Keep) !Snapshot {
    var attrs: std.ArrayList(u8) = .empty;
    var counts: std.ArrayList(u32) = .empty;
    for (geom.sl(c.cgltf_mesh, data.meshes, data.meshes_count), 0..) |*m, mi| {
        if (!keep.meshes.keep[mi]) continue;
        for (geom.sl(c.cgltf_primitive, m.primitives, m.primitives_count)) |*p| {
            for (geom.sl(c.cgltf_attribute, p.attributes, p.attributes_count)) |*at| {
                const name = cstr(at.name) orelse "";
                try attrs.appendSlice(a, name);
                try attrs.append(a, 0);
                try counts.append(a, if (at.data != null) @intCast(at.data.*.count) else 0);
            }
        }
    }
    var bindings: std.ArrayList(f32) = .empty;
    for (geom.sl(c.cgltf_material, data.materials, data.materials_count), 0..) |*m, mi| {
        if (!keep.materials.keep[mi]) continue;
        const views = [_]*const c.cgltf_texture_view{
            &m.pbr_metallic_roughness.base_color_texture,
            &m.pbr_metallic_roughness.metallic_roughness_texture,
            &m.normal_texture,
            &m.occlusion_texture,
            &m.emissive_texture,
        };
        for (views) |v| {
            if (ranked(c.cgltf_texture, data.textures, data.textures_count, v.texture, keep.textures.rank)) |ti| {
                try bindings.append(a, @floatFromInt(ti));
                try bindings.append(a, @floatFromInt(v.texcoord));
            } else {
                try bindings.append(a, -1);
                try bindings.append(a, -1);
            }
            try bindings.append(a, @floatCast(v.scale));
        }
    }
    return .{
        .prim_attrs = try attrs.toOwnedSlice(a),
        .prim_counts = try counts.toOwnedSlice(a),
        .tex_bindings = try bindings.toOwnedSlice(a),
    };
}

fn compareStructure(a: std.mem.Allocator, orig: *c.cgltf_data, new: *c.cgltf_data) !void {
    // the writer emits exactly the reachable subset of the input pools
    const ok = try Keep.compute(a, orig);

    try std.testing.expectEqual(orig.scenes_count, new.scenes_count);
    try std.testing.expectEqual(ok.nodes.count(), new.nodes_count);
    try std.testing.expectEqual(ok.meshes.count(), new.meshes_count);
    try std.testing.expectEqual(ok.materials.count(), new.materials_count);
    try std.testing.expectEqual(ok.textures.count(), new.textures_count);
    try std.testing.expectEqual(ok.images.count(), new.images_count);
    try std.testing.expectEqual(ok.samplers.count(), new.samplers_count);
    try std.testing.expectEqual(ok.cameras.count(), new.cameras_count);
    try std.testing.expectEqual(ok.accessors.count(), new.accessors_count);
    try std.testing.expectEqual(ok.views.count(), new.buffer_views_count);
    try std.testing.expectEqual(orig.animations_count, new.animations_count);
    try std.testing.expectEqual(orig.skins_count, new.skins_count);
    try std.testing.expectEqual(orig.buffers_count, new.buffers_count);

    // buffer view payload bytes (kept views in pool order)
    var nvi: usize = 0;
    for (geom.sl(c.cgltf_buffer_view, orig.buffer_views, orig.buffer_views_count), 0..) |*ov, i| {
        if (!ok.views.keep[i]) continue;
        const nv = &geom.sl(c.cgltf_buffer_view, new.buffer_views, new.buffer_views_count)[nvi];
        nvi += 1;
        try std.testing.expectEqual(ov.size, nv.size);
        const ob = geom.viewBytes(ov) orelse return error.InvalidData;
        const nb = geom.viewBytes(nv) orelse return error.InvalidData;
        try std.testing.expectEqualSlices(u8, ob, nb);
    }

    // accessors (kept accessors in pool order)
    var nai: usize = 0;
    for (geom.sl(c.cgltf_accessor, orig.accessors, orig.accessors_count), 0..) |*oa, i| {
        if (!ok.accessors.keep[i]) continue;
        const na = &geom.sl(c.cgltf_accessor, new.accessors, new.accessors_count)[nai];
        nai += 1;
        try std.testing.expectEqual(oa.component_type, na.component_type);
        try std.testing.expectEqual(oa.type, na.type);
        try std.testing.expectEqual(oa.count, na.count);
        try std.testing.expectEqual(oa.normalized, na.normalized);
        try std.testing.expectEqual(oa.is_sparse, na.is_sparse);
        const nc = geom.numComponents(oa.type);
        if (oa.has_min != 0) {
            try std.testing.expect(na.has_min != 0);
            for (0..nc) |k| try std.testing.expectEqual(oa.min[k], na.min[k]);
        }
        if (oa.has_max != 0) {
            try std.testing.expect(na.has_max != 0);
            for (0..nc) |k| try std.testing.expectEqual(oa.max[k], na.max[k]);
        }
        if (oa.buffer_view != null) {
            const oi = ranked(c.cgltf_buffer_view, orig.buffer_views, orig.buffer_views_count, oa.buffer_view, ok.views.rank).?;
            const ni = geom.ptrIndex(c.cgltf_buffer_view, new.buffer_views, new.buffer_views_count, na.buffer_view).?;
            try std.testing.expectEqual(oi, ni);
        }
        // values must round-trip exactly
        const of = try readLogFloats(a, oa);
        const nf = try readLogFloats(a, na);
        try std.testing.expectEqualSlices(f32, of, nf);
    }

    // primitive attribute semantics + counts
    const nk = try Keep.compute(a, new);
    const so = try snapshot(a, orig, &ok);
    const sn = try snapshot(a, new, &nk);
    try std.testing.expectEqualSlices(u8, so.prim_attrs, sn.prim_attrs);
    try std.testing.expectEqualSlices(u32, so.prim_counts, sn.prim_counts);
    try std.testing.expectEqualSlices(f32, so.tex_bindings, sn.tex_bindings);

    // index/vertex counts per primitive
    var nmi: usize = 0;
    for (geom.sl(c.cgltf_mesh, orig.meshes, orig.meshes_count), 0..) |*om, mi| {
        if (!ok.meshes.keep[mi]) continue;
        const nm = &geom.sl(c.cgltf_mesh, new.meshes, new.meshes_count)[nmi];
        nmi += 1;
        try std.testing.expectEqual(om.primitives_count, nm.primitives_count);
        for (geom.sl(c.cgltf_primitive, om.primitives, om.primitives_count), 0..) |*op, pi| {
            const np = &geom.sl(c.cgltf_primitive, nm.primitives, nm.primitives_count)[pi];
            try std.testing.expectEqual(op.type, np.type);
            const oic: u64 = if (op.indices != null) @intCast(op.indices.*.count) else 0;
            const nic: u64 = if (np.indices != null) @intCast(np.indices.*.count) else 0;
            try std.testing.expectEqual(oic, nic);
        }
    }

    // animations: channel counts + sampler counts
    for (geom.sl(c.cgltf_animation, orig.animations, orig.animations_count), 0..) |*oa, i| {
        const na = &geom.sl(c.cgltf_animation, new.animations, new.animations_count)[i];
        try std.testing.expectEqual(oa.channels_count, na.channels_count);
        try std.testing.expectEqual(oa.samplers_count, na.samplers_count);
    }

    // skins: joint counts
    for (geom.sl(c.cgltf_skin, orig.skins, orig.skins_count), 0..) |*os, i| {
        const ns = &geom.sl(c.cgltf_skin, new.skins, new.skins_count)[i];
        try std.testing.expectEqual(os.joints_count, ns.joints_count);
    }
}

fn checkFile(a: std.mem.Allocator, gpa: std.mem.Allocator, path: []const u8) !void {
    const io = std.testing.io;
    var loaded = try parse_mod.loadFile(io, gpa, path);
    defer loaded.deinit();

    const out1 = try serialize(a, loaded.cdata, loaded.map);
    var p1 = try parseBytes(gpa, out1);
    defer p1.deinit();

    const out2 = try serialize(a, p1.data, out1);
    if (!std.mem.eql(u8, out1, out2)) {
        // show the first difference to make debugging tractable
        var idx: usize = 0;
        while (idx < @min(out1.len, out2.len) and out1[idx] == out2[idx]) : (idx += 1) {}
        std.debug.print("idempotence mismatch in {s} at byte {d} (len {d} vs {d})\n", .{ path, idx, out1.len, out2.len });
        const lo = if (idx > 80) idx - 80 else 0;
        const hi1 = @min(out1.len, idx + 120);
        const hi2 = @min(out2.len, idx + 120);
        std.debug.print("out1: {s}\n", .{out1[lo..hi1]});
        std.debug.print("out2: {s}\n", .{out2[lo..hi2]});
        return error.NotIdempotent;
    }

    try compareStructure(a, loaded.cdata, p1.data);
}

test "glb writer: box fixture" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try checkFile(arena.allocator(), std.testing.allocator, "test/fixtures/box.glb");
}

test "glb writer: gc drops unreachable pools" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, std.testing.allocator, "test/fixtures/dup.glb");
    defer loaded.deinit();
    // the fixture has one garbage node -> garbage mesh -> garbage accessors
    try std.testing.expect(loaded.cdata.meshes_count > 1);

    const out1 = try serialize(aa, loaded.cdata, loaded.map);
    var p1 = try parseBytes(std.testing.allocator, out1);
    defer p1.deinit();

    try std.testing.expect(p1.data.accessors_count < loaded.cdata.accessors_count);
    try std.testing.expect(p1.data.meshes_count < loaded.cdata.meshes_count);
    try std.testing.expect(p1.data.materials_count < loaded.cdata.materials_count);
    try std.testing.expect(p1.data.nodes_count < loaded.cdata.nodes_count);
    try std.testing.expect(p1.data.buffer_views_count < loaded.cdata.buffer_views_count);
    // the two reachable duplicate meshes survive (only dedup can collapse them)
    try std.testing.expectEqual(@as(usize, 2), p1.data.meshes_count);

    const out2 = try serialize(aa, p1.data, out1);
    try std.testing.expectEqualSlices(u8, out1, out2);
}

test "glb writer: real fixtures round-trip" {
    const a = std.testing.allocator;
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const aa = arena.allocator();

    const files = try collectGlbs(aa, io, "test/fixtures/real");
    if (files.len == 0) {
        std.debug.print("no real fixtures found, skipping\n", .{});
        return;
    }
    for (files) |path| {
        std.debug.print("round-trip: {s}\n", .{path});
        var fa = std.heap.ArenaAllocator.init(a);
        defer fa.deinit();
        try checkFile(fa.allocator(), a, path);
    }
}

test "glb writer: gltf external buffer and image are inlined" {
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    var loaded = try parse_mod.loadFile(io, std.testing.allocator, "test/fixtures/gltf/box/box.gltf");
    defer loaded.deinit();

    const out = try serializeWithImages(aa, loaded.cdata, loaded.map, loaded.asset.images);
    try std.testing.expect(std.mem.indexOf(u8, out, "\"uri\"") == null);
    try std.testing.expect(std.mem.indexOf(u8, out, "image/png") != null);

    var p = try parseBytes(std.testing.allocator, out);
    defer p.deinit();
    try std.testing.expectEqual(@as(usize, 1), p.data.images_count);
    const im = &geom.sl(c.cgltf_image, p.data.images, p.data.images_count)[0];
    try std.testing.expect(im.buffer_view != null);
    try std.testing.expect(@intFromPtr(im.uri) == 0);

    // Re-serializing the produced GLB is byte-identical.
    const out2 = try serialize(aa, p.data, out);
    try std.testing.expectEqualSlices(u8, out, out2);
}

test "glb writer: external buffers are inlined, missing payload is refused" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const aa = arena.allocator();

    // A .gltf-style buffer: the uri is dropped from the output, and a view
    // that cannot be resolved fails instead of producing a dangling file.
    var buf = c.cgltf_buffer{ .uri = @constCast("buffer.bin") };
    var views: [0]c.cgltf_buffer_view = .{};
    var data = std.mem.zeroes(c.cgltf_data);
    data.buffers = @ptrCast(&buf);
    data.buffers_count = 1;
    data.buffer_views = @ptrCast(&views);
    data.buffer_views_count = 0;
    const out = try serialize(aa, &data, "");
    try std.testing.expect(std.mem.indexOf(u8, out, "\"uri\"") == null);

    var payload = [4]u8{ 1, 2, 3, 4 };
    buf.size = payload.len;
    var bv = std.mem.zeroes(c.cgltf_buffer_view);
    bv.buffer = &buf;
    bv.size = payload.len;
    var acc = std.mem.zeroes(c.cgltf_accessor);
    acc.component_type = 6; // FLOAT
    acc.type = 1; // SCALAR
    acc.count = 1;
    acc.buffer_view = &bv;
    var attr = std.mem.zeroes(c.cgltf_attribute);
    attr.name = @constCast("POSITION");
    attr.type = 1;
    attr.data = &acc;
    var prim = std.mem.zeroes(c.cgltf_primitive);
    prim.type = 5;
    prim.attributes = &attr;
    prim.attributes_count = 1;
    var mesh = std.mem.zeroes(c.cgltf_mesh);
    mesh.primitives = &prim;
    mesh.primitives_count = 1;
    var node = std.mem.zeroes(c.cgltf_node);
    node.mesh = &mesh;
    var node_ptr: [*c]c.cgltf_node = &node;
    var scene = std.mem.zeroes(c.cgltf_scene);
    scene.nodes = @ptrCast(&node_ptr);
    scene.nodes_count = 1;
    data.scene = &scene;
    data.scenes = &scene;
    data.scenes_count = 1;
    data.nodes = &node;
    data.nodes_count = 1;
    data.buffer_views = @ptrCast(&bv);
    data.buffer_views_count = 1;
    data.accessors = &acc;
    data.accessors_count = 1;
    data.meshes = &mesh;
    data.meshes_count = 1;
    try std.testing.expectError(error.InvalidData, serialize(aa, &data, ""));

    // Loaded payload: the same graph serializes, with the bytes in the BIN.
    buf.data = @ptrCast(&payload);
    const out2 = try serialize(aa, &data, "");
    try std.testing.expect(std.mem.indexOf(u8, out2, "\"uri\"") == null);
    try std.testing.expect(std.mem.indexOf(u8, out2, "\"bufferViews\"") != null);
}

test {
    _ = @import("../golden.zig");
}

test "glb writer: computes missing POSITION min/max" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // three vec3 positions
    var positions = [9]f32{ -1, 0, 5, 2, -3, 1, 0, 4, -2 };

    var buf = std.mem.zeroes(c.cgltf_buffer);
    buf.size = @sizeOf(@TypeOf(positions));
    buf.data = @ptrCast(&positions);

    var bv = std.mem.zeroes(c.cgltf_buffer_view);
    bv.buffer = &buf;
    bv.size = buf.size;
    bv.type = 2; // ARRAY_BUFFER

    var acc = std.mem.zeroes(c.cgltf_accessor);
    acc.component_type = 6; // FLOAT
    acc.type = 3; // VEC3
    acc.count = 3;
    acc.buffer_view = &bv;

    var attr = std.mem.zeroes(c.cgltf_attribute);
    attr.name = @constCast("POSITION");
    attr.type = 1;
    attr.data = &acc;

    var prim = std.mem.zeroes(c.cgltf_primitive);
    prim.type = 5; // triangles
    prim.attributes = &attr;
    prim.attributes_count = 1;

    var mesh = std.mem.zeroes(c.cgltf_mesh);
    mesh.primitives = &prim;
    mesh.primitives_count = 1;

    var data = std.mem.zeroes(c.cgltf_data);
    data.buffers = &buf;
    data.buffers_count = 1;
    data.buffer_views = &bv;
    data.buffer_views_count = 1;
    data.accessors = &acc;
    data.accessors_count = 1;
    data.meshes = &mesh;
    data.meshes_count = 1;

    const out = try serialize(a, &data, "");
    // GLB header / chunk sanity
    try std.testing.expectEqual(@as(u32, 0x46546C67), std.mem.readInt(u32, out[0..4], .little));
    try std.testing.expectEqual(@as(u32, 2), std.mem.readInt(u32, out[4..8], .little));
    try std.testing.expectEqual(@as(u32, @intCast(out.len)), std.mem.readInt(u32, out[8..12], .little));
    const jlen = std.mem.readInt(u32, out[12..16], .little);
    try std.testing.expectEqual(@as(u32, 0x4E4F534A), std.mem.readInt(u32, out[16..20], .little));
    try std.testing.expectEqual(@as(u32, 0), jlen % 4);
    const boff = 20 + jlen;
    try std.testing.expectEqual(@as(u32, 0x004E4942), std.mem.readInt(u32, out[boff + 4 ..][0..4], .little));
    try std.testing.expectEqual(@as(u32, 0), out.len - boff - 8 - std.mem.readInt(u32, out[boff..][0..4], .little));

    var p = try parseBytes(std.testing.allocator, out);
    defer p.deinit();
    const na = &geom.sl(c.cgltf_accessor, p.data.accessors, p.data.accessors_count)[0];
    try std.testing.expect(na.has_min != 0 and na.has_max != 0);
    try std.testing.expectEqualSlices(f32, &.{ -1, -3, -2 }, na.min[0..3]);
    try std.testing.expectEqualSlices(f32, &.{ 2, 4, 5 }, na.max[0..3]);

    // idempotent
    const out2 = try serialize(a, p.data, out);
    try std.testing.expectEqualSlices(u8, out, out2);
}

test "glb writer: meshopt input serializes as plain views" {
    // Fixture is inflated at load (see parse test): output must be a plain
    // single-buffer GLB with no meshopt declarations, carrying the same
    // values, and re-serializing must be byte-identical.
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var loaded = try parse_mod.loadFile(std.testing.io, a, "test/fixtures/compressed/rock_mc.glb");
    defer loaded.deinit();

    const out1 = try serialize(a, loaded.cdata, loaded.map);
    try std.testing.expect(std.mem.indexOf(u8, out1, "EXT_meshopt_compression") == null);

    var p1 = try parseBytes(std.testing.allocator, out1);
    defer p1.deinit();
    try std.testing.expectEqual(
        @as(c_uint, c.cgltf_result_success),
        @as(c_uint, c.cgltf_validate(p1.data)),
    );
    // Dead placeholder buffer is dropped: exactly one buffer, plain views.
    try std.testing.expectEqual(@as(usize, 1), p1.data.buffers_count);
    for (geom.sl(c.cgltf_buffer_view, p1.data.buffer_views, p1.data.buffer_views_count)) |*v| {
        try std.testing.expectEqual(@as(c_int, 0), v.has_meshopt_compression);
    }
    try std.testing.expectEqual(@as(usize, 0), p1.data.extensions_used_count);
    try std.testing.expectEqual(@as(usize, 0), p1.data.extensions_required_count);

    // Values survive the inflate -> serialize loop exactly (f32 positions /
    // normals / uvs unpack identically; u16 indices compare as floats too).
    try std.testing.expectEqual(loaded.cdata.accessors_count, p1.data.accessors_count);
    const oa = geom.sl(c.cgltf_accessor, loaded.cdata.accessors, loaded.cdata.accessors_count);
    const na = geom.sl(c.cgltf_accessor, p1.data.accessors, p1.data.accessors_count);
    for (oa, na) |*o, *n| {
        try std.testing.expectEqual(o.count, n.count);
        try std.testing.expectEqual(o.component_type, n.component_type);
        try std.testing.expectEqual(o.type, n.type);
        const of = try readLogFloats(a, o);
        const nf = try readLogFloats(a, n);
        try std.testing.expectEqualSlices(f32, of, nf);
    }

    const out2 = try serialize(a, p1.data, out1);
    try std.testing.expectEqualSlices(u8, out1, out2);
}
