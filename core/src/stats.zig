const std = @import("std");
const model = @import("gltf/model.zig");

pub const ImageStat = struct {
    index: u32,
    name: ?[]const u8,
    mime: model.Mime,
    width: u32 = 0,
    height: u32 = 0,
    has_dims: bool = false,
    /// bytes/pixel estimate for GPU upload (step 1: RGBA8)
    bpp: u32 = 4,
    /// w*h*bpp * (mips ? 1.33 : 1)
    vram: u64 = 0,
    has_mips: bool = false,
    disk_bytes: u64 = 0,
};

pub const Garbage = struct {
    unused_nodes: []const u32 = &.{},
    unused_materials: []const u32 = &.{},
    unused_textures: []const u32 = &.{},
    unused_images: []const u32 = &.{},
    /// png/jpg: no mip chain inside source glb
    no_mips_images: []const u32 = &.{},
    /// uncompressed png/jpeg embedded in GLB (should be ktx2)
    uncompressed_embedded: []const u32 = &.{},
};

pub const Stats = struct {
    triangles: u64 = 0,
    vertices: u64 = 0,
    primitives: u64 = 0,
    mesh_instances: u64 = 0,
    /// instanced primitives — per node
    draw_calls: u64 = 0,
    scenes: u64 = 0,
    nodes: u64 = 0,
    meshes: u64 = 0,
    materials: u64 = 0,
    textures: u64 = 0,
    images: u64 = 0,
    animations: u64 = 0,
    skins: u64 = 0,
    joints_total: u64 = 0,
    disk_json: u64 = 0,
    disk_bin: u64 = 0,
    disk_total: u64 = 0,
    vram_total: u64 = 0,
    image_stats: []const ImageStat = &.{},
    garbage: Garbage = .{},
};

pub fn trianglesOf(p: model.Primitive) u64 {
    const n: u64 = if (p.indexed) p.index_count else p.vertex_count;
    return switch (p.mode) {
        .triangles => n / 3,
        .triangle_strip, .triangle_fan => if (n >= 3) n - 2 else 0,
        else => 0,
    };
}

pub fn compute(a: std.mem.Allocator, asset: model.Asset) !Stats {
    var st: Stats = .{
        .scenes = asset.scenes.len,
        .nodes = asset.nodes.len,
        .meshes = asset.meshes.len,
        .materials = asset.materials.len,
        .textures = asset.textures.len,
        .images = asset.images.len,
        .animations = asset.animations.len,
        .skins = asset.skins.len,
        .disk_json = asset.json_size,
        .disk_bin = asset.bin_size,
        .disk_total = asset.file_size,
    };

    for (asset.meshes) |mesh| {
        for (mesh.primitives) |p| {
            st.primitives += 1;
            st.triangles += trianglesOf(p);
            st.vertices += p.vertex_count;
        }
    }

    // draw calls: instanced primitives
    for (asset.nodes) |node| {
        if (node.mesh) |mi| {
            st.mesh_instances += 1;
            st.draw_calls += asset.meshes[mi].primitives.len;
        }
    }
    for (asset.skins) |s| st.joints_total += s.joints;

    // image stats
    const image_stats = try a.alloc(ImageStat, asset.images.len);
    for (asset.images, 0..) |img, i| {
        var ist: ImageStat = .{
            .index = @intCast(i),
            .name = img.name,
            .mime = img.mime,
            .disk_bytes = img.disk_bytes,
            .width = img.width,
            .height = img.height,
            .has_dims = img.has_dims,
        };
        if (img.mime == .ktx2) ist.has_mips = true;
        ist.vram = @as(u64, ist.width) * ist.height * ist.bpp;
        if (ist.has_mips) ist.vram += ist.vram / 3;
        st.vram_total += ist.vram;
        image_stats[i] = ist;
    }
    st.image_stats = image_stats;

    // usage marks
    const used_nodes = try a.alloc(bool, asset.nodes.len);
    const used_materials = try a.alloc(bool, asset.materials.len);
    const used_textures = try a.alloc(bool, asset.textures.len);
    const used_images = try a.alloc(bool, asset.images.len);
    @memset(used_nodes, false);
    @memset(used_materials, false);
    @memset(used_textures, false);
    @memset(used_images, false);

    // materials via reachable nodes
    const stack = try a.alloc(u32, asset.nodes.len + 1);
    var sp: usize = 0;
    for (asset.scenes) |scene| {
        for (scene.roots) |root| {
            stack[sp] = root;
            sp += 1;
            while (sp > 0) {
                sp -= 1;
                const ni = stack[sp];
                if (used_nodes[ni]) continue;
                used_nodes[ni] = true;
                const node = asset.nodes[ni];
                if (node.mesh) |mi| {
                    for (asset.meshes[mi].primitives) |p| {
                        if (p.material) |mat| used_materials[mat] = true;
                    }
                }
                for (node.children) |ch| {
                    if (sp < stack.len) {
                        stack[sp] = ch;
                        sp += 1;
                    }
                }
            }
        }
    }
    // animation targets keep nodes alive
    for (asset.animations) |anim| {
        for (anim.targets) |t| {
            if (t < used_nodes.len and !used_nodes[t]) markSubtree(asset, used_nodes, t, stack);
        }
    }

    // textures used only by reachable materials; images only by reachable textures
    for (used_materials, 0..) |u, i| {
        if (!u) continue;
        model.markUsedTextures(asset.materials[i], used_textures);
    }
    for (used_textures, 0..) |u, i| {
        if (!u) continue;
        const tex = asset.textures[i];
        if (tex.image) |im| used_images[im] = true;
    }

    st.garbage = .{
        .unused_nodes = try collectIdx(a, u32, used_nodes),
        .unused_materials = try collectIdx(a, u32, used_materials),
        .unused_textures = try collectIdx(a, u32, used_textures),
        .unused_images = try collectIdx(a, u32, used_images),
    };

    var no_mips: std.ArrayList(u32) = .empty;
    var uncompressed: std.ArrayList(u32) = .empty;
    for (asset.images, 0..) |img, i| {
        switch (img.mime) {
            .png, .jpeg => {
                try no_mips.append(a, @intCast(i));
                if (asset.is_glb and img.data != null) try uncompressed.append(a, @intCast(i));
            },
            else => {},
        }
    }
    st.garbage.no_mips_images = try no_mips.toOwnedSlice(a);
    st.garbage.uncompressed_embedded = try uncompressed.toOwnedSlice(a);

    return st;
}

fn markSubtree(asset: model.Asset, used_nodes: []bool, root: u32, stack: []u32) void {
    var sp: usize = 0;
    stack[sp] = root;
    sp += 1;
    while (sp > 0) {
        sp -= 1;
        const ni = stack[sp];
        if (used_nodes[ni]) continue;
        used_nodes[ni] = true;
        for (asset.nodes[ni].children) |ch| {
            if (ch < used_nodes.len and sp < stack.len) {
                stack[sp] = ch;
                sp += 1;
            }
        }
    }
}

fn collectIdx(a: std.mem.Allocator, comptime T: type, used: []const bool) ![]const T {
    var list: std.ArrayList(T) = .empty;
    for (used, 0..) |u, i| {
        if (!u) try list.append(a, @intCast(i));
    }
    return try list.toOwnedSlice(a);
}

pub fn formatBytes(buf: []u8, bytes: u64) []const u8 {
    const f: f64 = @floatFromInt(bytes);
    if (bytes < 1024) return std.fmt.bufPrint(buf, "{d} B", .{bytes}) catch buf[0..0];
    if (bytes < 1024 * 1024) return std.fmt.bufPrint(buf, "{d:.1} KiB", .{f / 1024}) catch buf[0..0];
    if (bytes < 1024 * 1024 * 1024) return std.fmt.bufPrint(buf, "{d:.2} MiB", .{f / (1024 * 1024)}) catch buf[0..0];
    return std.fmt.bufPrint(buf, "{d:.2} GiB", .{f / (1024 * 1024 * 1024)}) catch buf[0..0];
}

test "triangles" {
    const p = model.Primitive{ .indexed = true, .index_count = 36 };
    try std.testing.expectEqual(@as(u64, 12), trianglesOf(p));
}
