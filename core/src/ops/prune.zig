const std = @import("std");
const model = @import("../gltf/model.zig");

/// Remove unused graph elements: unreachable nodes, unused meshes, materials,
/// textures, images, samplers. Skins are kept as-is; while the asset has any
/// skins, node pruning is skipped (model does not track joint lists).
pub const Removed = struct {
    nodes: u32 = 0,
    meshes: u32 = 0,
    materials: u32 = 0,
    textures: u32 = 0,
    images: u32 = 0,
    samplers: u32 = 0,
};

pub const Result = struct {
    asset: model.Asset,
    removed: Removed = .{},
};

fn markSubtree(asset: model.Asset, used_nodes: []bool, root: u32, stack: []u32) void {
    var sp: usize = 0;
    stack[sp] = root;
    sp += 1;
    while (sp > 0) {
        sp -= 1;
        const ni = stack[sp];
        if (used_nodes[ni]) continue;
        used_nodes[ni] = true;
        const node = asset.nodes[ni];
        for (node.children) |ch| {
            if (ch < used_nodes.len and sp < stack.len) {
                stack[sp] = ch;
                sp += 1;
            }
        }
    }
}

pub fn run(a: std.mem.Allocator, asset: model.Asset) !Result {
    const nn = asset.nodes.len;
    const used_nodes = try a.alloc(bool, nn);
    const used_meshes = try a.alloc(bool, asset.meshes.len);
    const used_materials = try a.alloc(bool, asset.materials.len);
    const used_textures = try a.alloc(bool, asset.textures.len);
    const used_images = try a.alloc(bool, asset.images.len);
    const used_samplers = try a.alloc(bool, asset.samplers.len);
    @memset(used_nodes, false);
    @memset(used_meshes, false);
    @memset(used_materials, false);
    @memset(used_textures, false);
    @memset(used_images, false);
    @memset(used_samplers, false);

    const stack = try a.alloc(u32, nn + 1);
    const allow_node_prune = asset.skins.len == 0;

    for (asset.scenes) |scene| {
        for (scene.roots) |root| {
            if (root < nn) markSubtree(asset, used_nodes, root, stack);
        }
    }
    // animation targets are live even when unreachable from scenes
    if (allow_node_prune) {
        for (asset.animations) |anim| {
            for (anim.targets) |t| {
                if (t < nn) markSubtree(asset, used_nodes, t, stack);
            }
        }
    } else {
        @memset(used_nodes, true);
    }

    for (used_nodes, 0..) |u, i| {
        if (!u) continue;
        if (asset.nodes[i].mesh) |mi| {
            if (mi < used_meshes.len) used_meshes[mi] = true;
        }
    }
    for (used_meshes, 0..) |u, i| {
        if (!u) continue;
        for (asset.meshes[i].primitives) |p| {
            if (p.material) |mat| {
                if (mat < used_materials.len) used_materials[mat] = true;
            }
        }
    }
    for (used_materials, 0..) |u, i| {
        if (!u) continue;
        const mat = asset.materials[i];
        inline for (@typeInfo(model.Material).@"struct".field_names, @typeInfo(model.Material).@"struct".field_types) |fname, ftype| {
            if (ftype == ?model.TextureInfo) {
                if (@field(mat, fname)) |ti| {
                    if (ti.texture < used_textures.len) used_textures[ti.texture] = true;
                }
            }
        }
    }
    for (used_textures, 0..) |u, i| {
        if (!u) continue;
        const tex = asset.textures[i];
        if (tex.image) |im| {
            if (im < used_images.len) used_images[im] = true;
        }
        if (tex.sampler) |s| {
            if (s < used_samplers.len) used_samplers[s] = true;
        }
    }

    // --- compact pools with remap tables ---
    const node_map = try remap(a, used_nodes);
    const mesh_map = try remap(a, used_meshes);
    const material_map = try remap(a, used_materials);
    const texture_map = try remap(a, used_textures);
    const image_map = try remap(a, used_images);
    const sampler_map = try remap(a, used_samplers);

    const removed: Removed = .{
        .nodes = @intCast(countRemoved(used_nodes)),
        .meshes = @intCast(countRemoved(used_meshes)),
        .materials = @intCast(countRemoved(used_materials)),
        .textures = @intCast(countRemoved(used_textures)),
        .images = @intCast(countRemoved(used_images)),
        .samplers = @intCast(countRemoved(used_samplers)),
    };

    // nodes
    const new_nodes = try a.alloc(model.Node, node_map.len);
    for (node_map, 0..) |old_i, new_i| {
        const n = asset.nodes[old_i];
        const children = try a.alloc(u32, n.children.len);
        var cn: usize = 0;
        for (n.children) |ch| {
            if (nodeMapGet(node_map, ch)) |nc| {
                children[cn] = nc;
                cn += 1;
            }
        }
        new_nodes[new_i] = .{
            .name = n.name,
            .children = children[0..cn],
            .mesh = remapOpt(mesh_map, n.mesh),
            .skin = n.skin, // skins untouched
            .translation = n.translation,
            .rotation = n.rotation,
            .scale = n.scale,
            .has_matrix = n.has_matrix,
            .matrix = n.matrix,
        };
    }

    // meshes
    const new_meshes = try a.alloc(model.Mesh, mesh_map.len);
    for (mesh_map, 0..) |old_i, new_i| {
        const m = asset.meshes[old_i];
        const prims = try a.alloc(model.Primitive, m.primitives.len);
        for (m.primitives, 0..) |p, j| {
            prims[j] = .{
                .mode = p.mode,
                .attributes = p.attributes,
                .vertex_count = p.vertex_count,
                .index_count = p.index_count,
                .indexed = p.indexed,
                .material = remapOpt(material_map, p.material),
            };
        }
        new_meshes[new_i] = .{ .name = m.name, .primitives = prims };
    }

    // materials
    const new_materials = try a.alloc(model.Material, material_map.len);
    for (material_map, 0..) |old_i, new_i| {
        var mat = asset.materials[old_i];
        inline for (@typeInfo(model.Material).@"struct".field_names, @typeInfo(model.Material).@"struct".field_types) |fname, ftype| {
            if (ftype == ?model.TextureInfo) {
                if (@field(mat, fname)) |*ti| {
                    ti.texture = texture_map[ti.texture];
                }
            }
        }
        new_materials[new_i] = mat;
    }

    // textures
    const new_textures = try a.alloc(model.Texture, texture_map.len);
    for (texture_map, 0..) |old_i, new_i| {
        const t = asset.textures[old_i];
        new_textures[new_i] = .{
            .name = t.name,
            .image = remapOpt(image_map, t.image),
            .sampler = remapOpt(sampler_map, t.sampler),
        };
    }

    // images
    const new_images = try a.alloc(model.Image, image_map.len);
    for (image_map, 0..) |old_i, new_i| new_images[new_i] = asset.images[old_i];

    // samplers
    const new_samplers = try a.alloc(model.Sampler, sampler_map.len);
    for (sampler_map, 0..) |old_i, new_i| new_samplers[new_i] = asset.samplers[old_i];

    // scenes
    const new_scenes = try a.alloc(model.Scene, asset.scenes.len);
    for (asset.scenes, 0..) |s, i| {
        const roots = try a.alloc(u32, s.roots.len);
        var rn: usize = 0;
        for (s.roots) |r| {
            if (nodeMapGet(node_map, r)) |nr| {
                roots[rn] = nr;
                rn += 1;
            }
        }
        new_scenes[i] = .{ .name = s.name, .roots = roots[0..rn] };
    }

    // animations: remap targets (all targets are kept by construction)
    const new_anims = try a.alloc(model.Animation, asset.animations.len);
    for (asset.animations, 0..) |an, i| {
        const targets = try a.alloc(u32, an.targets.len);
        var tn: usize = 0;
        for (an.targets) |t| {
            if (nodeMapGet(node_map, t)) |nt| {
                targets[tn] = nt;
                tn += 1;
            }
        }
        new_anims[i] = .{
            .name = an.name,
            .channels = an.channels,
            .samplers = an.samplers,
            .duration = an.duration,
            .targets = targets[0..tn],
        };
    }

    return .{
        .asset = .{
            .generator = asset.generator,
            .version = asset.version,
            .copyright = asset.copyright,
            .scenes = new_scenes,
            .nodes = new_nodes,
            .meshes = new_meshes,
            .materials = new_materials,
            .textures = new_textures,
            .images = new_images,
            .samplers = new_samplers,
            .animations = new_anims,
            .skins = asset.skins,
            .buffers = asset.buffers,
            .extensions_used = asset.extensions_used,
            .extensions_required = asset.extensions_required,
            .is_glb = asset.is_glb,
            .json_size = asset.json_size,
            .bin_size = asset.bin_size,
            .file_size = asset.file_size,
        },
        .removed = removed,
    };
}

/// returns slice where result[new_index] = old_index, only for used entries
fn remap(a: std.mem.Allocator, used: []const bool) ![]u32 {
    var out: std.ArrayList(u32) = .empty;
    for (used, 0..) |u, i| {
        if (u) try out.append(a, @intCast(i));
    }
    return out.toOwnedSlice(a);
}

fn countRemoved(used: []const bool) usize {
    var n: usize = 0;
    for (used) |u| {
        if (!u) n += 1;
    }
    return n;
}

/// position of old index in remap slice (linear scan; pools are small)
fn nodeMapGet(map: []const u32, old: u32) ?u32 {
    for (map, 0..) |o, new_i| {
        if (o == old) return @intCast(new_i);
    }
    return null;
}

fn remapOpt(map: []const u32, old: ?u32) ?u32 {
    const o = old orelse return null;
    return nodeMapGet(map, o);
}

// --- tests ---

fn testAsset() model.Asset {
    return .{
        .scenes = &.{.{ .roots = &.{0} }},
        .nodes = &.{
            .{ .name = "root", .children = &.{1} },
            .{ .name = "used", .mesh = 0 },
            .{ .name = "orphan" },
        },
        .meshes = &.{
            .{ .name = "m", .primitives = &.{.{ .material = 0, .vertex_count = 3 }} },
            .{ .name = "orphan_mesh", .primitives = &.{.{ .material = 1 }} },
        },
        .materials = &.{
            .{ .name = "mat0", .base_color_texture = .{ .texture = 0 } },
            .{ .name = "mat_orphan" },
        },
        .textures = &.{
            .{ .image = 0, .sampler = 0 },
            .{ .image = 1 },
        },
        .images = &.{
            .{ .mime = .png, .name = "img0" },
            .{ .mime = .png, .name = "img_orphan" },
        },
        .samplers = &.{.{}, .{}},
        .animations = &.{
            .{ .name = "spin", .channels = 1, .targets = &.{1} },
            .{ .name = "orphan_anim", .channels = 1, .targets = &.{} },
        },
    };
}

test "prune removes orphans" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const res = try run(a, testAsset());
    try std.testing.expectEqual(@as(u32, 1), res.removed.nodes); // orphan node
    try std.testing.expectEqual(@as(u32, 1), res.removed.meshes);
    try std.testing.expectEqual(@as(u32, 1), res.removed.materials);
    try std.testing.expectEqual(@as(u32, 1), res.removed.textures);
    try std.testing.expectEqual(@as(u32, 1), res.removed.images);
    try std.testing.expectEqual(@as(u32, 1), res.removed.samplers);

    const out = res.asset;
    try std.testing.expectEqual(@as(usize, 2), out.nodes.len);
    try std.testing.expectEqualStrings("root", out.nodes[0].name.?);
    try std.testing.expectEqualStrings("used", out.nodes[1].name.?);
    try std.testing.expectEqual(@as(u32, 0), out.nodes[1].mesh.?);
    try std.testing.expectEqual(@as(u32, 0), out.meshes[0].primitives[0].material.?);
    try std.testing.expectEqual(@as(usize, 1), out.textures.len);
    try std.testing.expectEqual(@as(u32, 0), out.textures[0].image.?);
    try std.testing.expectEqual(@as(u32, 0), out.textures[0].sampler.?);
    // anim target remapped: old node 1 -> new 1
    try std.testing.expectEqual(@as(u32, 1), out.animations[0].targets[0]);
}

test "pruned asset has no garbage" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const stats = @import("../stats.zig");
    const res = try run(a, testAsset());
    const st = try stats.compute(a, res.asset);
    try std.testing.expectEqual(@as(usize, 0), st.garbage.unused_nodes.len);
    try std.testing.expectEqual(@as(usize, 0), st.garbage.unused_materials.len);
    try std.testing.expectEqual(@as(usize, 0), st.garbage.unused_textures.len);
    // no_mips still flags png
    try std.testing.expectEqual(@as(usize, 1), st.garbage.no_mips_images.len);
}
