//! Golden statistics for the real-world fixtures in `test/fixtures/real/`.
//!
//! The numbers below were generated from the actual files and then checked by
//! hand against the model metadata shipped with glTF-Sample-Assets (mesh /
//! primitive / texture counts, animation and skin counts).  If `stats.zig` or
//! `parse.zig` drifts, these tests fail loudly.

const std = @import("std");
const parse = @import("gltf/parse.zig");
const stats = @import("stats.zig");

const Golden = struct {
    name: []const u8,
    role: []const u8,
    triangles: u64,
    vertices: u64,
    draw_calls: u64,
    meshes: u64,
    primitives: u64,
    materials: u64,
    textures: u64,
    images: u64,
    animations: u64,
    skins: u64,
};

const table = [_]Golden{
    .{ .name = "AntiqueCamera.glb", .role = "multiple meshes, PBR textures", .triangles = 20066, .vertices = 21178, .draw_calls = 2, .meshes = 2, .primitives = 2, .materials = 2, .textures = 6, .images = 6, .animations = 0, .skins = 0 },
    .{ .name = "BoomBox.glb", .role = "single PBR mesh", .triangles = 6036, .vertices = 3575, .draw_calls = 1, .meshes = 1, .primitives = 1, .materials = 1, .textures = 4, .images = 4, .animations = 0, .skins = 0 },
    .{ .name = "Box.glb", .role = "minimal untextured box", .triangles = 12, .vertices = 24, .draw_calls = 1, .meshes = 1, .primitives = 1, .materials = 1, .textures = 0, .images = 0, .animations = 0, .skins = 0 },
    .{ .name = "BoxTextured.glb", .role = "minimal textured box", .triangles = 12, .vertices = 24, .draw_calls = 1, .meshes = 1, .primitives = 1, .materials = 1, .textures = 1, .images = 1, .animations = 0, .skins = 0 },
    .{ .name = "BrainStem.glb", .role = "skinned + morph animation, 59 primitives", .triangles = 61666, .vertices = 34159, .draw_calls = 59, .meshes = 1, .primitives = 59, .materials = 59, .textures = 0, .images = 0, .animations = 1, .skins = 1 },
    .{ .name = "CesiumMan.glb", .role = "skinned + animation", .triangles = 4672, .vertices = 3273, .draw_calls = 1, .meshes = 1, .primitives = 1, .materials = 1, .textures = 1, .images = 1, .animations = 1, .skins = 1 },
    .{ .name = "DamagedHelmet.glb", .role = "single PBR mesh, 5 textures", .triangles = 15452, .vertices = 14556, .draw_calls = 1, .meshes = 1, .primitives = 1, .materials = 1, .textures = 5, .images = 5, .animations = 0, .skins = 0 },
    .{ .name = "Fox.glb", .role = "skinned, 3 animations", .triangles = 576, .vertices = 1728, .draw_calls = 1, .meshes = 1, .primitives = 1, .materials = 1, .textures = 1, .images = 1, .animations = 3, .skins = 1 },
    .{ .name = "IridescenceLamp.glb", .role = "KHR_materials_iridescence, 3 meshes", .triangles = 18866, .vertices = 10683, .draw_calls = 3, .meshes = 3, .primitives = 3, .materials = 3, .textures = 3, .images = 3, .animations = 0, .skins = 0 },
    .{ .name = "Lantern.glb", .role = "3 meshes, shared material", .triangles = 5394, .vertices = 4145, .draw_calls = 3, .meshes = 3, .primitives = 3, .materials = 1, .textures = 4, .images = 4, .animations = 0, .skins = 0 },
    .{ .name = "MetalRoughSpheres.glb", .role = "material grid stress test, 5 meshes", .triangles = 501776, .vertices = 255914, .draw_calls = 5, .meshes = 5, .primitives = 5, .materials = 1, .textures = 2, .images = 2, .animations = 0, .skins = 0 },
    .{ .name = "SheenWoodLeatherSofa.glb", .role = "KHR_materials_sheen, 6 meshes", .triangles = 46492, .vertices = 139476, .draw_calls = 6, .meshes = 6, .primitives = 6, .materials = 6, .textures = 15, .images = 13, .animations = 0, .skins = 0 },
};

fn checkRow(io: std.Io, a: std.mem.Allocator, g: Golden) !void {
    const path = try std.fmt.allocPrint(a, "test/fixtures/real/{s}", .{g.name});
    var loaded = try parse.loadFile(io, a, path);
    defer loaded.deinit();
    const st = try stats.compute(a, loaded.asset);

    std.debug.print("golden: {s} ({s})\n", .{ g.name, g.role });
    try std.testing.expectEqual(g.triangles, st.triangles);
    try std.testing.expectEqual(g.vertices, st.vertices);
    try std.testing.expectEqual(g.draw_calls, st.draw_calls);
    try std.testing.expectEqual(g.meshes, st.meshes);
    try std.testing.expectEqual(g.primitives, st.primitives);
    try std.testing.expectEqual(g.materials, st.materials);
    try std.testing.expectEqual(g.textures, st.textures);
    try std.testing.expectEqual(g.images, st.images);
    try std.testing.expectEqual(g.animations, st.animations);
    try std.testing.expectEqual(g.skins, st.skins);
}

test "golden stats: real fixtures" {
    const a = std.testing.allocator;
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();

    for (table) |g| {
        try checkRow(io, arena.allocator(), g);
    }
}

test "golden stats: fixture set is complete" {
    const a = std.testing.allocator;
    const io = std.testing.io;
    var dir = try std.Io.Dir.cwd().openDir(io, "test/fixtures/real", .{ .iterate = true });
    defer dir.close(io);
    var it = dir.iterate();
    var count: usize = 0;
    while (try it.next(io)) |ent| {
        if (ent.kind == .file and std.mem.endsWith(u8, ent.name, ".glb")) count += 1;
    }
    try std.testing.expectEqual(table.len, count);
    _ = a;
}

test "golden stats: DamagedHelmet has no garbage" {
    const a = std.testing.allocator;
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    var loaded = try parse.loadFile(io, a, "test/fixtures/real/DamagedHelmet.glb");
    defer loaded.deinit();
    const st = try stats.compute(arena.allocator(), loaded.asset);

    // 1 mesh / 1 primitive / 5 standard PBR textures
    try std.testing.expectEqual(@as(u64, 1), st.meshes);
    try std.testing.expectEqual(@as(u64, 1), st.primitives);
    try std.testing.expectEqual(@as(u64, 5), st.textures);

    try std.testing.expectEqual(@as(usize, 0), st.garbage.unused_nodes.len);
    try std.testing.expectEqual(@as(usize, 0), st.garbage.unused_materials.len);
    try std.testing.expectEqual(@as(usize, 0), st.garbage.unused_textures.len);
    try std.testing.expectEqual(@as(usize, 0), st.garbage.unused_images.len);
}
