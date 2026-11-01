const std = @import("std");
const c = @import("cgltf");
const model = @import("model.zig");
const decode = @import("../tex/decode.zig");

pub const Error = error{
    NotGltf,
    Unsupported,
    InvalidGlb,
    AccessorOutOfRange,
} || std.mem.Allocator.Error;

pub const Loaded = struct {
    asset: model.Asset,
    /// raw cgltf data; buffer data points into `map`
    cdata: *c.cgltf_data,
    io: std.Io,
    mm: std.Io.File.MemoryMap,
    map: []const u8,
    arena_state: std.heap.ArenaAllocator,
    gpa: std.mem.Allocator,

    pub fn deinit(self: *Loaded) void {
        c.cgltf_free(self.cdata);
        self.mm.destroy(self.io);
        self.arena_state.deinit();
    }

    pub fn arena(self: *Loaded) std.mem.Allocator {
        return self.arena_state.allocator();
    }
};

const GlbChunks = struct { json: u64 = 0, bin: u64 = 0 };

fn scanGlbChunks(bytes: []const u8) GlbChunks {
    var out: GlbChunks = .{};
    if (bytes.len < 20) return out;
    const magic = std.mem.readInt(u32, bytes[0..4], .little);
    if (magic != 0x46546C67) return out; // 'glTF'
    var off: usize = 12;
    while (off + 8 <= bytes.len) {
        const clen = std.mem.readInt(u32, bytes[off..][0..4], .little);
        const ctype = std.mem.readInt(u32, bytes[off + 4 ..][0..4], .little);
        const body: usize = @min(@as(usize, clen), bytes.len - off - 8);
        switch (ctype) {
            0x4E4F534A => out.json = body, // JSON
            0x004E4942 => out.bin = body, // BIN
            else => {},
        }
        off += 8 + body;
    }
    return out;
}

pub fn loadFile(io: std.Io, gpa: std.mem.Allocator, path: []const u8) !Loaded {
    const file = try std.Io.Dir.cwd().openFile(io, path, .{});
    const st = blk: {
        const s = file.stat(io) catch |err| {
            file.close(io);
            return err;
        };
        break :blk s;
    };
    const size: usize = @intCast(st.size);
    var mm = std.Io.File.MemoryMap.create(io, file, .{
        .len = @max(size, 1),
        .protection = .{ .read = true },
    }) catch |err| {
        file.close(io);
        return err;
    };
    file.close(io);
    const map: []const u8 = mm.memory[0..size];

    errdefer mm.destroy(io);

    var options: c.cgltf_options = std.mem.zeroes(c.cgltf_options);
    var cdata: ?*c.cgltf_data = null;
    const res = c.cgltf_parse(&options, map.ptr, map.len, &cdata);
    if (res != c.cgltf_result_success or cdata == null) {
        return switch (res) {
            c.cgltf_result_unknown_format => Error.NotGltf,
            else => Error.InvalidGlb,
        };
    }
    errdefer c.cgltf_free(cdata);

    // GLB: zero-copy (buffer->data points into map). External uris are read
    // by cgltf; failure is non-fatal here (counts are still available).
    _ = c.cgltf_load_buffers(&options, cdata, map.ptr);

    var loaded = Loaded{
        .asset = .{},
        .cdata = cdata.?,
        .io = io,
        .mm = mm,
        .map = map,
        .arena_state = std.heap.ArenaAllocator.init(gpa),
        .gpa = gpa,
    };
    errdefer loaded.arena_state.deinit();

    const a = loaded.arena();
    loaded.asset = try convert(a, loaded.cdata, map);
    return loaded;
}

fn dupName(a: std.mem.Allocator, name: [*c]const u8) !?[]const u8 {
    const n = name orelse return null;
    if (std.mem.span(n).len == 0) return null;
    return try a.dupe(u8, std.mem.span(n));
}

fn sniffMime(data: ?[]const u8, mime_type: [*c]const u8) model.Mime {
    if (data) |d| {
        if (d.len >= 8 and std.meta.eql(d[0..8].*, [8]u8{ 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A })) return .png;
        if (d.len >= 3 and d[0] == 0xFF and d[1] == 0xD8 and d[2] == 0xFF) return .jpeg;
        if (d.len >= 8 and std.meta.eql(d[0..8].*, [8]u8{ 0xAB, 'K', 'T', 'X', ' ', '2', '0', 0xBB })) return .ktx2;
    }
    const m = mime_type orelse return .other;
    const s = std.mem.span(m);
    if (std.mem.eql(u8, s, "image/png")) return .png;
    if (std.mem.eql(u8, s, "image/jpeg")) return .jpeg;
    if (std.mem.eql(u8, s, "image/ktx2")) return .ktx2;
    return .other;
}

const Maps = struct {
    nodes: std.AutoHashMapUnmanaged(*c.cgltf_node, u32) = .empty,
    meshes: std.AutoHashMapUnmanaged(*c.cgltf_mesh, u32) = .empty,
    materials: std.AutoHashMapUnmanaged(*c.cgltf_material, u32) = .empty,
    textures: std.AutoHashMapUnmanaged(*c.cgltf_texture, u32) = .empty,
    images: std.AutoHashMapUnmanaged(*c.cgltf_image, u32) = .empty,
    samplers: std.AutoHashMapUnmanaged(*c.cgltf_sampler, u32) = .empty,
};


fn sl(comptime T: type, ptr: [*c]T, n: usize) []T {
    if (n == 0 or @intFromPtr(ptr) == 0) return &.{};
    return ptr[0..n];
}

fn convMode(t: c_uint) model.Mode {
    return switch (t) {
        1 => .points,
        2 => .lines,
        3 => .line_loop,
        4 => .line_strip,
        5 => .triangles,
        6 => .triangle_strip,
        7 => .triangle_fan,
        else => .triangles,
    };
}

fn convComponent(t: c_uint) model.ComponentType {
    return switch (t) {
        5120 => .i8,
        5121 => .u8,
        5122 => .i16,
        5123 => .u16,
        5125 => .u32,
        5126 => .f32,
        else => .f32,
    };
}

fn convDim(t: c_uint) model.Dim {
    return switch (t) {
        1 => .scalar,
        2 => .vec2,
        3 => .vec3,
        4 => .vec4,
        5 => .mat2,
        6 => .mat3,
        7 => .mat4,
        else => .scalar,
    };
}

fn semanticOf(attr_type: c_uint, index: c_int) model.Semantic {
    return switch (attr_type) {
        1 => .position,
        2 => .normal,
        3 => .tangent,
        4 => if (index == 0) .texcoord_0 else if (index == 1) .texcoord_1 else .other,
        5 => .color_0,
        6 => .joints_0,
        7 => .weights_0,
        else => .other,
    };
}

fn convTextureView(view: *const c.cgltf_texture_view, maps: *Maps) !?model.TextureInfo {
    const tex = view.texture orelse return null;
    const idx = maps.textures.get(tex) orelse return null;
    return .{ .texture = idx, .texcoord = @intCast(@max(view.texcoord, 0)) };
}

fn markExt(exts: *model.Extensions, name: [*c]const u8) void {
    const n = name orelse return;
    const s = std.mem.span(n);
    const table = .{
        .{ "KHR_materials_pbrSpecularGlossiness", &exts.specular_glossiness },
        .{ "KHR_materials_unlit", &exts.unlit },
        .{ "KHR_materials_emissive_strength", &exts.emissive_strength },
        .{ "KHR_materials_clearcoat", &exts.clearcoat },
        .{ "KHR_materials_transmission", &exts.transmission },
        .{ "KHR_materials_volume", &exts.volume },
        .{ "KHR_materials_ior", &exts.ior },
        .{ "KHR_materials_specular", &exts.specular },
        .{ "KHR_materials_sheen", &exts.sheen },
        .{ "KHR_texture_transform", &exts.texture_transform },
        .{ "KHR_materials_iridescence", &exts.iridescence },
        .{ "KHR_materials_anisotropy", &exts.anisotropy },
    };
    inline for (table) |entry| {
        if (std.mem.eql(u8, s, entry[0])) entry[1].* = true;
    }
}

fn convert(a: std.mem.Allocator, data: *c.cgltf_data, map_bytes: []const u8) !model.Asset {
    var maps: Maps = .{};

    var out: model.Asset = .{
        .is_glb = map_bytes.len >= 4 and std.mem.readInt(u32, map_bytes[0..4], .little) == 0x46546C67,
        .generator = try dupName(a, data.asset.generator),
        .version = try dupName(a, data.asset.version),
        .copyright = try dupName(a, data.asset.copyright),
        .file_size = map_bytes.len,
    };
    const chunks = scanGlbChunks(map_bytes);
    out.json_size = chunks.json;
    out.bin_size = chunks.bin;

    // --- index maps (pointer -> index) ---
    for (sl(c.cgltf_node, data.nodes, data.nodes_count), 0..) |*n, i| try maps.nodes.put(a, n, @intCast(i));
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count), 0..) |*m, i| try maps.meshes.put(a, m, @intCast(i));
    for (sl(c.cgltf_material, data.materials, data.materials_count), 0..) |*m, i| try maps.materials.put(a, m, @intCast(i));
    for (sl(c.cgltf_texture, data.textures, data.textures_count), 0..) |*t, i| try maps.textures.put(a, t, @intCast(i));
    for (sl(c.cgltf_image, data.images, data.images_count), 0..) |*im, i| try maps.images.put(a, im, @intCast(i));
    for (sl(c.cgltf_sampler, data.samplers, data.samplers_count), 0..) |*s, i| try maps.samplers.put(a, s, @intCast(i));

    // --- materials ---
    const materials = try a.alloc(model.Material, data.materials_count);
    for (sl(c.cgltf_material, data.materials, data.materials_count), 0..) |*m, i| {
        var mat: model.Material = .{
            .name = try dupName(a, m.name),
            .alpha_mode = switch (@as(u32, m.alpha_mode)) {
                1 => .mask,
                2 => .blend,
                else => .opaque_,
            },
            .alpha_cutoff = @floatCast(m.alpha_cutoff),
            .double_sided = m.double_sided != 0,
            .has_pbr = m.has_pbr_metallic_roughness != 0,
        };
        if (m.has_pbr_metallic_roughness != 0) {
            const pbr = &m.pbr_metallic_roughness;
            for (pbr.base_color_factor, 0..) |v, k| mat.base_color_factor[k] = @floatCast(v);
            mat.metallic = @floatCast(pbr.metallic_factor);
            mat.roughness = @floatCast(pbr.roughness_factor);
            mat.base_color_texture = try convTextureView(&pbr.base_color_texture, &maps);
            mat.metallic_roughness_texture = try convTextureView(&pbr.metallic_roughness_texture, &maps);
        }
        mat.normal_texture = try convTextureView(&m.normal_texture, &maps);
        mat.occlusion_texture = try convTextureView(&m.occlusion_texture, &maps);
        mat.emissive_texture = try convTextureView(&m.emissive_texture, &maps);
        mat.normal_scale = @floatCast(m.normal_texture.scale);
        mat.occlusion_strength = @floatCast(m.occlusion_texture.scale);
        for (m.emissive_factor, 0..) |v, k| mat.emissive_factor[k] = @floatCast(v);
        for (sl(c.cgltf_extension, m.extensions, m.extensions_count)) |*ext| markExt(&mat.extensions, ext.name);
        if (m.unlit != 0) mat.extensions.unlit = true;
        materials[i] = mat;
    }
    out.materials = materials;

    // --- images (dims via header probe; ktx2 parsed directly) ---
    const images = try a.alloc(model.Image, data.images_count);
    for (sl(c.cgltf_image, data.images, data.images_count), 0..) |*im, i| {
        var img: model.Image = .{ .name = try dupName(a, im.name) };
        if (im.uri) |uri| {
            img.uri = try a.dupe(u8, std.mem.span(uri));
        }
        if (im.buffer_view) |bv| {
            const view = bv.*;
            if (view.data) |d| {
                const bytes: []const u8 = @as([*]const u8, @ptrCast(d))[0..view.size];
                img.data = bytes;
                img.disk_bytes = view.size;
            }
        }
        img.mime = sniffMime(img.data, im.mime_type);
        if (img.data) |d| {
            if (decode.infoFromMemory(d)) |info| {
                img.width = info.width;
                img.height = info.height;
                img.components = info.components;
                img.has_dims = true;
            } else if (img.mime == .ktx2 and d.len >= 24) {
                // KTX2 header: identifier[8], vkFormat u32, typeSize u32, pixelWidth u32, pixelHeight u32
                img.width = std.mem.readInt(u32, d[16..20], .little);
                img.height = std.mem.readInt(u32, d[20..24], .little);
                img.has_dims = img.width > 0 and img.height > 0;
            }
        }
        images[i] = img;
    }
    out.images = images;

    // --- samplers ---
    const samplers = try a.alloc(model.Sampler, data.samplers_count);
    for (sl(c.cgltf_sampler, data.samplers, data.samplers_count), 0..) |*s, i| {
        samplers[i] = .{
            .mag = convFilter(s.mag_filter),
            .min = convFilter(s.min_filter),
            .wrap_s = convWrap(s.wrap_s),
            .wrap_t = convWrap(s.wrap_t),
        };
    }
    out.samplers = samplers;

    // --- textures ---
    const textures = try a.alloc(model.Texture, data.textures_count);
    for (sl(c.cgltf_texture, data.textures, data.textures_count), 0..) |*t, i| {
        textures[i] = .{
            .name = try dupName(a, t.name),
            .image = if (t.image) |im| maps.images.get(im) else null,
            .sampler = if (t.sampler) |s| maps.samplers.get(s) else null,
        };
    }
    out.textures = textures;

    // --- meshes/primitives ---
    const meshes = try a.alloc(model.Mesh, data.meshes_count);
    for (sl(c.cgltf_mesh, data.meshes, data.meshes_count), 0..) |*m, i| {
        const prims = try a.alloc(model.Primitive, m.primitives_count);
        for (sl(c.cgltf_primitive, m.primitives, m.primitives_count), 0..) |*p, j| {
            const attrs = try a.alloc(model.Attribute, p.attributes_count);
            var vertex_count: u32 = 0;
            for (sl(c.cgltf_attribute, p.attributes, p.attributes_count), 0..) |*attr, k| {
                const acc = attr.data;
                attrs[k] = .{
                    .semantic = semanticOf(attr.type, attr.index),
                    .count = @intCast(acc.*.count),
                    .component = convComponent(acc.*.component_type),
                    .dim = convDim(acc.*.type),
                };
                if (attr.type == 1) vertex_count = @intCast(acc.*.count);
            }
            prims[j] = .{
                .mode = convMode(p.type),
                .attributes = attrs,
                .index_count = if (p.indices) |ix| @intCast(ix.*.count) else 0,
                .indexed = p.indices != null,
                .material = if (p.material) |mat| maps.materials.get(mat) else null,
            };
            prims[j].vertex_count = vertex_count;
        }
        meshes[i] = .{
            .name = try dupName(a, m.name),
            .primitives = prims,
        };
    }
    out.meshes = meshes;

    // --- nodes ---
    const nodes = try a.alloc(model.Node, data.nodes_count);
    for (sl(c.cgltf_node, data.nodes, data.nodes_count), 0..) |*n, i| {
        const children = try a.alloc(u32, n.children_count);
        for (sl([*c]c.cgltf_node, n.children, n.children_count), 0..) |ch, k| {
            children[k] = maps.nodes.get(ch) orelse continue;
        }
        var mtx: [16]f32 = undefined;
        for (n.matrix, 0..) |v, k| mtx[k] = @floatCast(v);
        var tr: [3]f32 = .{ 0, 0, 0 };
        var rot: [4]f32 = .{ 0, 0, 0, 1 };
        var scl: [3]f32 = .{ 1, 1, 1 };
        for (n.translation, 0..) |v, k| tr[k] = @floatCast(v);
        for (n.rotation, 0..) |v, k| rot[k] = @floatCast(v);
        for (n.scale, 0..) |v, k| scl[k] = @floatCast(v);
        nodes[i] = .{
            .name = try dupName(a, n.name),
            .children = children,
            .mesh = if (n.mesh) |m| maps.meshes.get(m) else null,
            .skin = if (n.skin) |s| @intCast(indexOf(data.skins, s)) else null,
            .translation = tr,
            .rotation = rot,
            .scale = scl,
            .has_matrix = n.has_matrix != 0,
            .matrix = mtx,
        };
    }
    out.nodes = nodes;

    // --- scenes ---
    const scenes = try a.alloc(model.Scene, data.scenes_count);
    for (sl(c.cgltf_scene, data.scenes, data.scenes_count), 0..) |*s, i| {
        const roots = try a.alloc(u32, s.nodes_count);
        for (sl([*c]c.cgltf_node, s.nodes, s.nodes_count), 0..) |n, k| {
            roots[k] = maps.nodes.get(n) orelse continue;
        }
        scenes[i] = .{ .name = try dupName(a, s.name), .roots = roots };
    }
    out.scenes = scenes;

    // --- animations ---
    const anims = try a.alloc(model.Animation, data.animations_count);
    for (sl(c.cgltf_animation, data.animations, data.animations_count), 0..) |*an, i| {
        var duration: ?f32 = null;
        for (sl(c.cgltf_animation_sampler, an.samplers, an.samplers_count)) |*s| {
            const input = s.input orelse continue;
            if (input.*.has_max != 0) {
                const d: f32 = @floatCast(input.*.max[0]);
                if (duration == null or d > duration.?) duration = d;
            }
        }
        anims[i] = .{
            .name = try dupName(a, an.name),
            .channels = @intCast(an.channels_count),
            .samplers = @intCast(an.samplers_count),
            .duration = duration,
        };
        var targets: std.ArrayList(u32) = .empty;
        for (sl(c.cgltf_animation_channel, an.channels, an.channels_count)) |*ch| {
            const tn = ch.target_node orelse continue;
            if (maps.nodes.get(tn)) |ti| try targets.append(a, ti);
        }
        anims[i].targets = try targets.toOwnedSlice(a);
    }
    out.animations = anims;

    // --- skins ---
    const skins = try a.alloc(model.Skin, data.skins_count);
    for (sl(c.cgltf_skin, data.skins, data.skins_count), 0..) |*sk, i| {
        skins[i] = .{
            .name = try dupName(a, sk.name),
            .joints = @intCast(sk.joints_count),
            .has_inverse_bind_matrices = sk.inverse_bind_matrices != null,
        };
    }
    out.skins = skins;

    // --- buffers ---
    const buffers = try a.alloc(model.Buffer, data.buffers_count);
    for (sl(c.cgltf_buffer, data.buffers, data.buffers_count), 0..) |*b, i| {
        buffers[i] = .{
            .name = try dupName(a, b.name),
            .byte_length = b.size,
            .uri = if (b.uri) |u| try a.dupe(u8, std.mem.span(u)) else null,
        };
    }
    out.buffers = buffers;

    // --- extensions ---
    const used = try a.alloc([]const u8, data.extensions_used_count);
    for (sl([*c]u8, @ptrCast(data.extensions_used), data.extensions_used_count), 0..) |e, i| used[i] = try a.dupe(u8, std.mem.span(e));
    out.extensions_used = used;
    const req = try a.alloc([]const u8, data.extensions_required_count);
    for (sl([*c]u8, @ptrCast(data.extensions_required), data.extensions_required_count), 0..) |e, i| req[i] = try a.dupe(u8, std.mem.span(e));
    out.extensions_required = req;

    return out;
}

fn convFilter(v: c_uint) model.Filter {
    return switch (v) {
        9728 => .nearest,
        9729 => .linear,
        else => .unknown,
    };
}

fn convWrap(v: c_uint) model.Wrap {
    return switch (v) {
        33071 => .clamp_to_edge,
        33648 => .mirrored_repeat,
        10497 => .repeat,
        else => .unknown,
    };
}

fn indexOf(skins: [*]const c.cgltf_skin, ptr: *const c.cgltf_skin) usize {
    const byte_off = @intFromPtr(ptr) - @intFromPtr(skins);
    return byte_off / @sizeOf(c.cgltf_skin);
}

test "scanGlbChunks" {
    var buf: [24]u8 = undefined;
    std.mem.writeInt(u32, buf[0..4], 0x46546C67, .little);
    std.mem.writeInt(u32, buf[4..8], 2, .little);
    std.mem.writeInt(u32, buf[8..12], 16, .little);
    std.mem.writeInt(u32, buf[12..16], 4, .little);
    std.mem.writeInt(u32, buf[16..20], 0x004E4942, .little);
    const chunks = scanGlbChunks(&buf);
    try std.testing.expectEqual(@as(u64, 4), chunks.bin);
    try std.testing.expectEqual(@as(u64, 0), chunks.json);
}
