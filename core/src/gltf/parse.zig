const std = @import("std");
const c = @import("cgltf");
const model = @import("model.zig");
const decode = @import("../tex/decode.zig");
const formats = @import("../tex/formats.zig");
const mc = @import("../ops/meshopt.zig");

pub const Error = error{
    NotGltf,
    Unsupported,
    InvalidGlb,
    AccessorOutOfRange,
    DecodeFailed,
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
        const remaining = bytes.len - off - 8;
        // A chunk that claims more bytes than the file holds is truncated:
        // stop scanning instead of walking into a misaligned header.
        if (@as(usize, clen) > remaining) break;
        switch (ctype) {
            0x4E4F534A => out.json = clen, // JSON
            0x004E4942 => out.bin = clen, // BIN
            else => {},
        }
        off += 8 + @as(usize, clen);
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
    // Empty files cannot be GLB/gltf: fail cleanly instead of mapping a
    // zero-length region (length-0 mappings are not portable).
    if (size == 0) {
        file.close(io);
        return Error.InvalidGlb;
    }
    var mm = std.Io.File.MemoryMap.create(io, file, .{
        .len = size,
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

    // Meshopt-compressed input is inflated here, once, so every downstream
    // consumer (ops, writer, info) sees plain buffer views: the payload is
    // decoded into cgltf-owned memory (cgltf_free releases it with the same
    // hooks), the view flag is cleared, and nodes/TRS are untouched.
    try inflateMeshopt(cdata.?);

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
        if (d.len >= 12 and std.mem.eql(u8, d[0..4], "RIFF") and std.mem.eql(u8, d[8..12], "WEBP")) return .webp;
    }
    const m = mime_type orelse return .other;
    const s = std.mem.span(m);
    if (std.mem.eql(u8, s, "image/png")) return .png;
    if (std.mem.eql(u8, s, "image/jpeg")) return .jpeg;
    if (std.mem.eql(u8, s, "image/webp")) return .webp;
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

/// Pool index of `p` in `base[0..count]`, or null when `p` is null, misaligned
/// or outside the pool (corrupt input). Never subtracts raw pointers.
fn ptrIndex(comptime T: type, base: [*c]T, count: usize, p: [*c]T) ?u32 {
    if (count == 0 or @intFromPtr(base) == 0 or @intFromPtr(p) == 0) return null;
    const b: usize = @intFromPtr(base);
    const q: usize = @intFromPtr(p);
    if (q < b) return null;
    const off = q - b;
    if (off % @sizeOf(T) != 0) return null;
    const i = off / @sizeOf(T);
    if (i >= count) return null;
    return std.math.cast(u32, i);
}

/// Raw bytes of a buffer view, overflow-safe. Null when the buffer data is
/// not loaded (external uri) or the view runs past its buffer.
fn viewBytesChecked(v: *const c.cgltf_buffer_view) ?[]const u8 {
    if (v.data) |d| {
        const p: [*]const u8 = @ptrCast(d);
        return p[0..v.size];
    }
    if (@intFromPtr(v.buffer) == 0) return null;
    const bd = v.buffer.*.data orelse return null;
    const bsize: usize = @intCast(v.buffer.*.size);
    const off: usize = @intCast(v.offset);
    const sz: usize = @intCast(v.size);
    if (off > bsize or sz > bsize - off) return null;
    const p: [*]const u8 = @ptrCast(bd);
    return p[off .. off + sz];
}

/// Allocate decoded-view bytes through cgltf's hooks (libc malloc when the
/// options carry no allocator), so `cgltf_free` — which releases `view.data`
/// with `memory.free_func` — stays balanced.
fn mcAlloc(data: *c.cgltf_data, n: usize) ?[*]u8 {
    const mem = data.memory;
    if (mem.alloc_func) |f| {
        const p = f(mem.user_data, n) orelse return null;
        return @ptrCast(p);
    }
    const p = std.c.malloc(n) orelse return null;
    return @ptrCast(p);
}

fn mcFree(data: *c.cgltf_data, p: [*]u8) void {
    const mem = data.memory;
    if (mem.free_func) |f| {
        f(mem.user_data, p);
    } else {
        std.c.free(p);
    }
}

/// Inflate every EXT_meshopt_compression view in place: decode the payload
/// into cgltf-owned memory, point the view at it, clear the flag. Nodes/TRS
/// are untouched (pure buffer inflation). Views that fail to decode abort
/// the load — half-inflated geometry must never reach the ops.
fn inflateMeshopt(data: *c.cgltf_data) Error!void {
    var any = false;
    for (sl(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count)) |*v| {
        if (v.has_meshopt_compression != 0) {
            any = true;
            break;
        }
    }
    if (!any) return;
    if (!mc.have_codec) return error.Unsupported;
    var inflated: usize = 0;
    for (sl(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count)) |*v| {
        if (v.has_meshopt_compression == 0) continue;
        const e = &v.meshopt_compression;
        const src_buf = e.buffer orelse return error.InvalidGlb;
        const bd = src_buf.*.data orelse return error.InvalidGlb;
        const bsize: usize = @intCast(src_buf.*.size);
        const off: usize = @intCast(e.offset);
        const sz: usize = @intCast(e.size);
        if (off > bsize or sz > bsize - off) return error.InvalidGlb;
        const base: [*]const u8 = @ptrCast(bd);
        const src = base[off .. off + sz];
        const stride: usize = @intCast(e.stride);
        const count: usize = @intCast(e.count);
        if (stride == 0 or count == 0) return error.InvalidGlb;
        const total = std.math.mul(usize, count, stride) catch return error.InvalidGlb;
        const vsize: usize = @intCast(v.size);
        // cgltf's fixup already asserted size == stride * count; re-check
        // (overflow-safe) since ReleaseFast trusts every slice below.
        if (total != vsize) return error.InvalidGlb;

        const mem = mcAlloc(data, total) orelse return error.OutOfMemory;
        const dst = mem[0..total];
        const failed = blk: {
            if (e.mode == c.cgltf_meshopt_compression_mode_attributes) {
                mc.decodeVertices(dst, src, count, stride) catch break :blk true;
                const f = e.filter;
                if (f == c.cgltf_meshopt_compression_filter_octahedral) {
                    mc.decodeFilterOct(dst, count, stride) catch break :blk true;
                } else if (f == c.cgltf_meshopt_compression_filter_quaternion) {
                    mc.decodeFilterQuat(dst, count, stride) catch break :blk true;
                } else if (f == c.cgltf_meshopt_compression_filter_exponential) {
                    mc.decodeFilterExp(dst, count, stride) catch break :blk true;
                } else if (f == c.cgltf_meshopt_compression_filter_color) {
                    mc.decodeFilterColor(dst, count, stride) catch break :blk true;
                } else if (f != c.cgltf_meshopt_compression_filter_none) {
                    break :blk true;
                }
            } else if (e.mode == c.cgltf_meshopt_compression_mode_triangles) {
                if (e.filter != c.cgltf_meshopt_compression_filter_none) break :blk true;
                mc.decodeIndices(dst, src, count, stride, false) catch break :blk true;
            } else if (e.mode == c.cgltf_meshopt_compression_mode_indices) {
                if (e.filter != c.cgltf_meshopt_compression_filter_none) break :blk true;
                mc.decodeIndices(dst, src, count, stride, true) catch break :blk true;
            } else {
                break :blk true;
            }
            break :blk false;
        };
        if (failed) {
            mcFree(data, mem);
            return error.DecodeFailed;
        }
        v.data = mem;
        v.has_meshopt_compression = 0;
        // The stale placeholder (buffer/offset) is dead — every reader
        // prefers v.data, and cgltf_validate still sees the consistent
        // original layout. The writer re-emits these views as plain data.
        inflated += 1;
    }
    if (inflated > 0) trimDeadBuffers(data);
}

/// Drop trailing buffers referenced only by inflated (data-carrying) views:
/// a meshopt file's placeholder buffer is dead once its views carry decoded
/// bytes. The array itself is never reallocated, so stale pointers stay
/// valid — the count just hides them, and `cgltf_free` still releases the
/// whole array. Only dataless, uri-less buffers are trimmed, so no payload
/// is orphaned and single-buffer downstream ops (quantize `meshopt_compression`
/// anchors new payloads at buffer 0) keep working.
fn trimDeadBuffers(data: *c.cgltf_data) void {
    while (data.buffers_count > 1) {
        const last: usize = data.buffers_count - 1;
        const buf: *c.cgltf_buffer = @ptrCast(&data.buffers[last]);
        if (@intFromPtr(buf.data) != 0) break;
        if (@intFromPtr(buf.uri) != 0) break;
        var pinned = false;
        for (sl(c.cgltf_buffer_view, data.buffer_views, data.buffer_views_count)) |*v| {
            if (v.data != null) continue; // inflated: self-contained
            if (@intFromPtr(v.buffer) == @intFromPtr(buf)) {
                pinned = true;
                break;
            }
        }
        if (pinned) break;
        data.buffers_count = last;
    }
}

/// Every accessor with plain (uncompressed, loaded) buffer data must fit in
/// its view. Skips views that are missing, draco-compressed (payload sizes
/// differ from decoded sizes), or extension-owned — those stay
/// downstream-checked. (Meshopt views are inflated at load, so they validate
/// as plain views here.)
fn validateAccessors(data: *c.cgltf_data) Error!void {
    for (sl(c.cgltf_accessor, data.accessors, data.accessors_count)) |*acc| {
        const bv_ptr = acc.buffer_view orelse continue; // viewless: nothing to bound
        const bv: *const c.cgltf_buffer_view = @ptrCast(bv_ptr);
        if (bv.has_meshopt_compression != 0) continue;
        const bytes = viewBytesChecked(bv) orelse continue; // unloaded (external uri): lenient
        const count: usize = @intCast(acc.count);
        // A view-backed accessor with no elements is corrupt (the schema
        // minimum is 1); this also pins down negative JSON counts, which
        // cgltf's float-to-unsigned cast resolves differently per CPU.
        if (count == 0) return Error.AccessorOutOfRange;
        const elem: usize = @intCast(c.cgltf_calc_size(acc.type, acc.component_type));
        if (elem == 0) continue;
        const stride: usize = if (acc.stride != 0) @intCast(acc.stride) else elem;
        if (stride < elem) return Error.AccessorOutOfRange;
        const span = std.math.mul(usize, count - 1, stride) catch return Error.AccessorOutOfRange;
        const need = std.math.add(usize, span, elem) catch return Error.AccessorOutOfRange;
        const off: usize = @intCast(acc.offset);
        if (off > bytes.len or need > bytes.len - off) return Error.AccessorOutOfRange;
    }
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

/// cgltf stores the component type as its own enum (`r_8` = 1 … `r_32f` = 6),
/// not as the glTF JSON number. An unknown value means a corrupt accessor:
/// it is rejected instead of being reinterpreted as float32.
fn convComponent(t: c.cgltf_component_type) !model.ComponentType {
    return switch (t) {
        1 => .i8, // BYTE
        2 => .u8, // UNSIGNED_BYTE
        3 => .i16, // SHORT
        4 => .u16, // UNSIGNED_SHORT
        5 => .u32, // UNSIGNED_INT
        6 => .f32, // FLOAT
        else => error.InvalidGlb,
    };
}

fn convDim(t: c.cgltf_type) !model.Dim {
    return switch (t) {
        1 => .scalar,
        2 => .vec2,
        3 => .vec3,
        4 => .vec4,
        5 => .mat2,
        6 => .mat3,
        7 => .mat4,
        else => error.InvalidGlb,
    };
}

fn semanticOf(attr_type: c_uint) model.Semantic {
    return switch (attr_type) {
        1 => .position,
        2 => .normal,
        3 => .tangent,
        4 => .texcoord,
        5 => .color,
        6 => .joints,
        7 => .weights,
        else => .other,
    };
}

fn convTextureView(view: *const c.cgltf_texture_view, maps: *Maps) !?model.TextureInfo {
    const tex = view.texture orelse return null;
    const idx = maps.textures.get(tex) orelse return null;
    return .{ .texture = idx, .texcoord = std.math.cast(u32, @max(view.texcoord, 0)) orelse return error.AccessorOutOfRange };
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

    // Malformed files can declare accessor counts/offsets that no buffer
    // holds (negative JSON counts wrap to huge unsigned values). Reject them
    // here — ReleaseFast disables OOB checks, so every downstream slice
    // trusts these bounds.
    try validateAccessors(data);

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
        if (m.has_clearcoat != 0) {
            mat.extensions.clearcoat_texture = try convTextureView(&m.clearcoat.clearcoat_texture, &maps);
            mat.extensions.clearcoat_roughness_texture = try convTextureView(&m.clearcoat.clearcoat_roughness_texture, &maps);
        }
        if (m.has_sheen != 0) {
            mat.extensions.sheen_color_texture = try convTextureView(&m.sheen.sheen_color_texture, &maps);
            mat.extensions.sheen_roughness_texture = try convTextureView(&m.sheen.sheen_roughness_texture, &maps);
        }
        if (m.has_transmission != 0) {
            mat.extensions.transmission_texture = try convTextureView(&m.transmission.transmission_texture, &maps);
        }
        if (m.has_specular != 0) {
            mat.extensions.specular_texture = try convTextureView(&m.specular.specular_texture, &maps);
            mat.extensions.specular_color_texture = try convTextureView(&m.specular.specular_color_texture, &maps);
        }
        if (m.has_iridescence != 0) {
            mat.extensions.iridescence_texture = try convTextureView(&m.iridescence.iridescence_texture, &maps);
            mat.extensions.iridescence_thickness_texture = try convTextureView(&m.iridescence.iridescence_thickness_texture, &maps);
        }
        if (m.has_volume != 0) {
            mat.extensions.volume_thickness_texture = try convTextureView(&m.volume.thickness_texture, &maps);
        }
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
            // buffer->data points into the mmap after cgltf_load_buffers.
            // Malformed files can declare out-of-range offset/size pairs;
            // validate (overflow-safe) and leave the image dataless instead
            // of slicing out of bounds (ReleaseFast has no OOB checks).
            if (view.buffer) |buf| {
                if (buf.*.data) |bd| {
                    const bsize: usize = @intCast(buf.*.size);
                    const off: usize = @intCast(view.offset);
                    const sz: usize = @intCast(view.size);
                    if (off <= bsize and sz <= bsize - off) {
                        const base: [*]const u8 = @ptrCast(bd);
                        img.data = (base + off)[0..sz];
                        img.disk_bytes = view.size;
                    }
                }
            }
        }
        img.mime = sniffMime(img.data, im.mime_type);
        if (img.data) |d| {
            if (formats.parseHeader(d)) |h| {
                img.has_ktx2 = true;
                img.mime = .ktx2;
                img.vk_format = h.vk_format;
                img.mip_levels = h.mip_levels;
                img.width = h.width;
                img.height = h.height;
                img.components = 0;
                img.has_dims = h.width > 0 and h.height > 0;
                if (img.vk_format == 0) img.color_model = formats.dfdColorModel(d);
            } else if (decode.infoFromMemory(d)) |info| {
                img.width = info.width;
                img.height = info.height;
                img.components = info.components;
                img.has_dims = true;
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
        // core source wins; fallback to webp/basisu extension images
        var img: ?*c.cgltf_image = null;
        if (@intFromPtr(t.image) != 0) {
            img = t.image;
        } else if (@intFromPtr(t.webp_image) != 0) {
            img = t.webp_image;
        } else if (@intFromPtr(t.basisu_image) != 0) {
            img = t.basisu_image;
        }
        textures[i] = .{
            .name = try dupName(a, t.name),
            .image = if (img) |im| maps.images.get(im) else null,
            .sampler = if (t.sampler) |s| maps.samplers.get(s) else null,
        };
    }
    out.textures = textures;

    // --- image slots: which material binding(s) sample each image ---------
    // A texture shared by several bindings sets several bits; texture rules
    // (strictest first: normal > arm > occlusion > emissive > base_color)
    // decide the winner. Cutout marks base-color images of BLEND/MASK
    // materials (pixel-alpha analysis is a backlog item).
    for (materials) |mat| {
        const bindings = [_]struct { ti: ?model.TextureInfo, slot: model.ImageSlot }{
            .{ .ti = mat.base_color_texture, .slot = .base_color },
            .{ .ti = mat.metallic_roughness_texture, .slot = .metallic_roughness },
            .{ .ti = mat.normal_texture, .slot = .normal },
            .{ .ti = mat.occlusion_texture, .slot = .occlusion },
            .{ .ti = mat.emissive_texture, .slot = .emissive },
        };
        for (bindings) |b| {
            const ti = b.ti orelse continue;
            if (ti.texture >= textures.len) continue;
            const img_idx = textures[ti.texture].image orelse continue;
            if (img_idx >= images.len) continue;
            images[img_idx].setSlot(b.slot);
        }
        if (mat.base_color_texture) |ti| {
            if (mat.alpha_mode != .opaque_ and ti.texture < textures.len) {
                if (textures[ti.texture].image) |img_idx| {
                    if (img_idx < images.len) images[img_idx].cutout = true;
                }
            }
        }
    }

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
                    .semantic = semanticOf(attr.type),
                    .semantic_index = std.math.cast(u32, @max(attr.index, 0)) orelse return error.AccessorOutOfRange,
                    .count = std.math.cast(u32, acc.*.count) orelse return error.AccessorOutOfRange,
                    .component = try convComponent(acc.*.component_type),
                    .dim = try convDim(acc.*.type),
                };
                if (attr.type == 1) vertex_count = std.math.cast(u32, acc.*.count) orelse return error.AccessorOutOfRange;
            }
            prims[j] = .{
                .mode = convMode(p.type),
                .attributes = attrs,
                .index_count = if (p.indices) |ix| std.math.cast(u32, ix.*.count) orelse return error.AccessorOutOfRange else 0,
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
        var cn: usize = 0;
        for (sl([*c]c.cgltf_node, n.children, n.children_count)) |ch| {
            // Corrupt refs (pointers outside the node pool) are dropped
            // instead of remapping to node 0.
            if (@intFromPtr(ch) == 0) continue;
            if (maps.nodes.get(ch)) |idx| {
                children[cn] = idx;
                cn += 1;
            }
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
            .children = children[0..cn],
            .mesh = if (n.mesh) |m| maps.meshes.get(m) else null,
            .skin = if (n.skin) |s| ptrIndex(c.cgltf_skin, data.skins, data.skins_count, s) else null,
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
        var rn: usize = 0;
        for (sl([*c]c.cgltf_node, s.nodes, s.nodes_count)) |n| {
            // Corrupt refs (pointers outside the node pool) are dropped
            // instead of remapping to node 0.
            if (@intFromPtr(n) == 0) continue;
            if (maps.nodes.get(n)) |idx| {
                roots[rn] = idx;
                rn += 1;
            }
        }
        scenes[i] = .{ .name = try dupName(a, s.name), .roots = roots[0..rn] };
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
            .channels = std.math.cast(u32, an.channels_count) orelse return error.AccessorOutOfRange,
            .samplers = std.math.cast(u32, an.samplers_count) orelse return error.AccessorOutOfRange,
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
            .joints = std.math.cast(u32, sk.joints_count) orelse return error.AccessorOutOfRange,
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
        9984 => .nearest_mipmap_nearest,
        9985 => .linear_mipmap_nearest,
        9986 => .nearest_mipmap_linear,
        9987 => .linear_mipmap_linear,
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

test "loadFile inflates meshopt views to plain data" {
    // Real-world meshopt fixture (Arena rock, 4 compressed views, no
    // images): the loader must decode every view so ops see plain data.
    const io = std.testing.io;
    const a = std.testing.allocator;
    var loaded = try loadFile(io, a, "test/fixtures/compressed/rock_mc.glb");
    defer loaded.deinit();

    // No compressed view survives: every view carries decoded bytes.
    for (sl(c.cgltf_buffer_view, loaded.cdata.buffer_views, loaded.cdata.buffer_views_count)) |*v| {
        try std.testing.expectEqual(@as(c_int, 0), v.has_meshopt_compression);
        try std.testing.expect(@intFromPtr(v.data) != 0);
    }
    // The dead placeholder buffer is trimmed: single-buffer downstream.
    try std.testing.expectEqual(@as(usize, 1), loaded.cdata.buffers_count);
    // Accessor metadata is untouched by the inflation (pure buffer swap).
    try std.testing.expectEqual(@as(usize, 4), loaded.cdata.accessors_count);
    const accs = sl(c.cgltf_accessor, loaded.cdata.accessors, loaded.cdata.accessors_count);
    try std.testing.expectEqual(@as(usize, 3219), accs[0].count);
    try std.testing.expectEqual(@as(usize, 3219), accs[1].count);
    try std.testing.expectEqual(@as(usize, 3219), accs[2].count);
    try std.testing.expectEqual(@as(usize, 5151), accs[3].count);
    // Decompressed view sizes match stride * count (f32x3, f32x3, f32x2, u16).
    const views = sl(c.cgltf_buffer_view, loaded.cdata.buffer_views, loaded.cdata.buffer_views_count);
    try std.testing.expectEqual(@as(usize, 3219 * 12), views[0].size);
    try std.testing.expectEqual(@as(usize, 3219 * 12), views[1].size);
    try std.testing.expectEqual(@as(usize, 3219 * 8), views[2].size);
    try std.testing.expectEqual(@as(usize, 5151 * 2), views[3].size);
    // Model level: node name, mesh shape, primitive counts preserved.
    try std.testing.expectEqual(@as(usize, 1), loaded.asset.nodes.len);
    try std.testing.expectEqualStrings("Rocks", loaded.asset.nodes[0].name.?);
    try std.testing.expectEqual(@as(usize, 1), loaded.asset.meshes.len);
    const prim = loaded.asset.meshes[0].primitives[0];
    try std.testing.expectEqual(@as(u32, 3219), prim.vertex_count);
    try std.testing.expectEqual(@as(u32, 5151), prim.index_count);
    try std.testing.expect(prim.indexed);
    // The inflated scene validates clean.
    try std.testing.expectEqual(
        @as(c_uint, c.cgltf_result_success),
        @as(c_uint, c.cgltf_validate(loaded.cdata)),
    );
}

test "webp image sniffs mime and dims" {
    const io = std.testing.io;
    const a = std.testing.allocator;
    var loaded = try loadFile(io, a, "test/fixtures/webp/image_webp.glb");
    defer loaded.deinit();
    try std.testing.expectEqual(@as(usize, 1), loaded.asset.images.len);
    const img = loaded.asset.images[0];
    try std.testing.expectEqual(model.Mime.webp, img.mime);
    try std.testing.expect(img.has_dims);
    try std.testing.expectEqual(@as(u32, 8), img.width);
    try std.testing.expectEqual(@as(u32, 8), img.height);
}

test "image slots and cutout from material bindings" {
    const io = std.testing.io;
    const a = std.testing.allocator;
    const dir = ".zig-cache/parse-slots";
    try std.Io.Dir.cwd().createDirPath(io, dir);
    defer std.Io.Dir.cwd().deleteTree(io, dir) catch {};

    const px = [_]u8{ 1, 2, 3, 4, 5, 6, 7, 8 };
    const json =
        \\{"asset":{"version":"2.0"},"images":[
        \\ {"name":"wall_BC","bufferView":0,"mimeType":"image/png"},
        \\ {"name":"wall_NRM","bufferView":1,"mimeType":"image/png"},
        \\ {"name":"lone","bufferView":2,"mimeType":"image/png"}],
        \\"textures":[{"source":0},{"source":1}],
        \\"materials":[{"name":"m","alphaMode":"MASK",
        \\ "pbrMetallicRoughness":{"baseColorTexture":{"index":0},"metallicRoughnessTexture":{"index":1}},
        \\ "normalTexture":{"index":1}}],
        \\"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":8},{"buffer":0,"byteOffset":8,"byteLength":8},{"buffer":0,"byteOffset":16,"byteLength":8}],
        \\"buffers":[{"byteLength":24}]}
    ;
    const jp = std.mem.alignForward(usize, json.len, 4);
    const total: usize = 12 + 8 + jp + 8 + 24;
    const glb = try a.alloc(u8, total);
    defer a.free(glb);
    @memset(glb, 0);
    std.mem.writeInt(u32, glb[0..4], 0x46546C67, .little);
    std.mem.writeInt(u32, glb[4..8], 2, .little);
    std.mem.writeInt(u32, glb[8..12], @intCast(total), .little);
    std.mem.writeInt(u32, glb[12..16], @intCast(jp), .little);
    std.mem.writeInt(u32, glb[16..20], 0x4E4F534A, .little);
    @memset(glb[20 .. 20 + jp], ' ');
    @memcpy(glb[20 .. 20 + json.len], json);
    const bh = 20 + jp;
    std.mem.writeInt(u32, glb[bh..][0..4], 24, .little);
    std.mem.writeInt(u32, glb[bh + 4 ..][0..4], 0x004E4942, .little);
    for (0..3) |i| @memcpy(glb[bh + 8 + i * 8 ..][0..8], &px);

    const path = dir ++ "/slots.glb";
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = path, .data = glb });

    var loaded = try loadFile(io, a, path);
    defer loaded.deinit();
    try std.testing.expectEqual(@as(usize, 3), loaded.asset.images.len);

    const M = @import("model.zig");
    const bit = struct {
        fn b(s: M.ImageSlot) u8 {
            return @as(u8, 1) << @backingInt(s);
        }
    }.b;
    // wall_BC: base color of a MASK material -> base bit + cutout
    try std.testing.expectEqual(bit(.base_color), loaded.asset.images[0].slots);
    try std.testing.expect(loaded.asset.images[0].cutout);
    // wall_NRM: MR + normal bindings -> both bits, no cutout
    try std.testing.expectEqual(bit(.metallic_roughness) | bit(.normal), loaded.asset.images[1].slots);
    try std.testing.expect(!loaded.asset.images[1].cutout);
    // lone: unbound -> no slots
    try std.testing.expectEqual(@as(u8, 0), loaded.asset.images[2].slots);
    try std.testing.expect(!loaded.asset.images[2].cutout);
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

test "loadFile rejects corrupt inputs without crashing" {
    // Fuzz regression: every input here must return an error (never crash or
    // hang), even under ReleaseFast where OOB checks are disabled. Mirrors
    // the `test/fuzz_corpus.py` classes at a size that keeps `zig build test` fast.
    const io = std.testing.io;
    const a = std.testing.allocator;
    const dir = ".zig-cache/fuzz-regression";

    std.Io.Dir.cwd().createDirPath(io, dir) catch {};
    defer std.Io.Dir.cwd().deleteTree(io, dir) catch {};

    const valid = try std.Io.Dir.cwd().readFileAlloc(io, "test/fixtures/box.glb", a, .limited(1 << 20));
    defer a.free(valid);

    const Case = struct { name: []const u8, make: *const fn (std.mem.Allocator, []const u8) anyerror![]u8, ok: bool };
    const cases = [_]Case{
        .{ .name = "valid", .make = &copyCase, .ok = true },
        .{ .name = "empty", .make = &emptyCase, .ok = false },
        .{ .name = "short", .make = &shortCase, .ok = false },
        .{ .name = "bad-magic", .make = &badMagicCase, .ok = false },
        .{ .name = "bad-version", .make = &badVersionCase, .ok = false },
        .{ .name = "huge-chunk-len", .make = &hugeChunkLenCase, .ok = false },
        .{ .name = "bad-chunk-type", .make = &badChunkTypeCase, .ok = false },
        .{ .name = "neg-count", .make = &negCountCase, .ok = false },
        // Lenient below: corrupt but safely degradable (dataless views are
        // skipped, the GC walk is cycle-safe, `{}` is an empty asset).
        .{ .name = "huge-bytelength", .make = &hugeByteLengthCase, .ok = true },
        .{ .name = "huge-byteoffset", .make = &hugeByteOffsetCase, .ok = true },
        .{ .name = "bad-buffer-view-ref", .make = &badBufferViewRefCase, .ok = false },
        // cgltf rejects self-parenting, so cycles never reach the model;
        // markSubtree stays cycle-safe as defense in depth.
        .{ .name = "cyclic-children", .make = &cyclicChildrenCase, .ok = false },
        .{ .name = "empty-json", .make = &emptyJsonCase, .ok = true },
        .{ .name = "json-array", .make = &jsonArrayCase, .ok = false },
    };

    var path_buf: [256]u8 = undefined;
    for (cases) |cs| {
        const path = try std.fmt.bufPrint(&path_buf, "{s}/{s}.glb", .{ dir, cs.name });
        const bytes = try cs.make(a, valid);
        defer a.free(bytes);
        try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = path, .data = bytes });
        if (cs.ok) {
            var loaded = loadFile(io, a, path) catch |err| {
                std.debug.print("fuzz-case {s}: UNEXPECTED {s}\n", .{ cs.name, @errorName(err) });
                return err;
            };
            loaded.deinit();
        } else {
            const res = loadFile(io, a, path);
            if (res) |loaded_const| {
                var loaded = loaded_const;
                loaded.deinit();
                std.debug.print("fuzz-case {s}: PARSED (unexpected)\n", .{cs.name});
                // Lenient parse of garbage is allowed only when the result is
                // still structurally sound; these cases must not parse cleanly.
                return error.ExpectedLoadFailure;
            } else |_| {
                // Expected: corrupt input rejected (or degraded) without crashing.
            }
        }
    }
}

fn copyCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    return a.dupe(u8, valid);
}

fn emptyCase(a: std.mem.Allocator, _: []const u8) ![]u8 {
    return a.dupe(u8, &.{});
}

fn shortCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    return a.dupe(u8, valid[0..@min(valid.len, 13)]);
}

fn badMagicCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    const b = try a.dupe(u8, valid);
    @memcpy(b[0..4], "glFX");
    return b;
}

fn badVersionCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    const b = try a.dupe(u8, valid);
    std.mem.writeInt(u32, b[4..8], 1, .little);
    return b;
}

fn hugeChunkLenCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    const b = try a.dupe(u8, valid);
    if (b.len >= 20) std.mem.writeInt(u32, b[12..16], 0xFFFFFFFF, .little);
    return b;
}

fn badChunkTypeCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    const b = try a.dupe(u8, valid);
    if (b.len >= 20) std.mem.writeInt(u32, b[16..20], 0xDEADBEEF, .little);
    return b;
}

/// Replace the first `"count":<n>` with `"count":-1`.
fn negCountCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    return jsonPatch(a, valid, "\"count\":", "-1");
}

/// Replace the first `"byteLength":<n>` with the u32 max.
fn hugeByteLengthCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    return jsonPatch(a, valid, "\"byteLength\":", "4294967295");
}

/// Replace the first `"byteOffset":<n>` with the u32 max.
fn hugeByteOffsetCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    return jsonPatch(a, valid, "\"byteOffset\":", "4294967295");
}

/// Point the first `"bufferView":<n>` far out of range.
fn badBufferViewRefCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    return jsonPatch(a, valid, "\"bufferView\":", "99999");
}

/// Make node 0 its own child (cycle must not hang the GC reachability walk).
fn cyclicChildrenCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    const parts = glbTestSplit(valid) orelse return error.BadFixture;
    const needle = "\"children\":[1,2,3]";
    const at = std.mem.indexOf(u8, parts.json, needle) orelse return error.BadFixture;
    const patched = try std.mem.concat(a, u8, &.{
        parts.json[0..at],
        "\"children\":[0]",
        parts.json[at + needle.len ..],
    });
    defer a.free(patched);
    return glbTestJoin(a, parts.hdr, patched, parts.bin);
}

fn emptyJsonCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    const parts = glbTestSplit(valid) orelse return error.BadFixture;
    return glbTestJoin(a, parts.hdr, "{}", parts.bin);
}

fn jsonArrayCase(a: std.mem.Allocator, valid: []const u8) ![]u8 {
    const parts = glbTestSplit(valid) orelse return error.BadFixture;
    return glbTestJoin(a, parts.hdr, "[]", parts.bin);
}

/// Replace the JSON value after the first `key` with `replacement`, keeping
/// the GLB container otherwise identical (lengths are recomputed on join).
fn jsonPatch(a: std.mem.Allocator, valid: []const u8, key: []const u8, replacement: []const u8) ![]u8 {
    const parts = glbTestSplit(valid) orelse return error.BadFixture;
    const at = std.mem.indexOf(u8, parts.json, key) orelse return error.BadFixture;
    const val_at = at + key.len;
    // Skip the original number.
    var end = val_at;
    while (end < parts.json.len and (parts.json[end] == '-' or (parts.json[end] >= '0' and parts.json[end] <= '9'))) : (end += 1) {}
    if (end == val_at) return error.BadFixture;
    const patched = try std.mem.concat(a, u8, &.{ parts.json[0..val_at], replacement, parts.json[end..] });
    defer a.free(patched);
    return glbTestJoin(a, parts.hdr, patched, parts.bin);
}

const GlbTestParts = struct { hdr: []const u8, json: []const u8, bin: []const u8 };

fn glbTestSplit(data: []const u8) ?GlbTestParts {
    if (data.len < 20 or !std.mem.eql(u8, data[0..4], "glTF")) return null;
    const jlen = std.mem.readInt(u32, data[12..16], .little);
    if (20 + jlen > data.len) return null;
    const jstart: usize = 20;
    const bend: usize = jstart + jlen;
    var bin: []const u8 = &.{};
    if (bend + 8 <= data.len and std.mem.readInt(u32, data[bend + 4 ..][0..4], .little) == 0x004E4942) {
        const blen = std.mem.readInt(u32, data[bend..][0..4], .little);
        const bstart = bend + 8;
        if (bstart + blen <= data.len) bin = data[bstart .. bstart + blen];
    }
    return .{ .hdr = data[0..12], .json = data[jstart..bend], .bin = bin };
}

fn glbTestJoin(a: std.mem.Allocator, hdr: []const u8, json: []const u8, bin: []const u8) ![]u8 {
    const jp = std.mem.alignForward(usize, json.len, 4);
    const bp = std.mem.alignForward(usize, bin.len, 4);
    const total_len: usize = 12 + 8 + jp + (if (bin.len > 0) 8 + bp else 0);
    const out = try a.alloc(u8, total_len);
    @memset(out, 0);
    @memcpy(out[0..4], hdr[0..4]);
    std.mem.writeInt(u32, out[4..8], 2, .little);
    std.mem.writeInt(u32, out[8..12], @intCast(total_len), .little);
    std.mem.writeInt(u32, out[12..16], @intCast(jp), .little);
    std.mem.writeInt(u32, out[16..20], 0x4E4F534A, .little);
    @memset(out[20 .. 20 + jp], ' ');
    @memcpy(out[20 .. 20 + json.len], json);
    if (bin.len > 0) {
        const bh = 20 + jp;
        std.mem.writeInt(u32, out[bh..][0..4], @intCast(bp), .little);
        std.mem.writeInt(u32, out[bh + 4 ..][0..4], 0x004E4942, .little);
        @memcpy(out[bh + 8 ..][0..bin.len], bin);
    }
    return out;
}
