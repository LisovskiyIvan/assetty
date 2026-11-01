const std = @import("std");
const core = @import("core");

const usage =
    \\basset — glTF/GLB asset toolkit
    \\
    \\Usage:
    \\  basset info <file.glb> [--json]
    \\  basset presets
    \\
    \\Exit codes: 0 ok, 1 lint violations, 2 error
;

fn jsonStr(w: anytype, s: []const u8) !void {
    try w.writeByte('"');
    for (s) |ch| switch (ch) {
        '"' => try w.writeAll("\\\""),
        '\\' => try w.writeAll("\\\\"),
        '\n' => try w.writeAll("\\n"),
        '\r' => try w.writeAll("\\r"),
        '\t' => try w.writeAll("\\t"),
        else => {
            if (ch < 0x20) {
                try w.print("\\u{x:0>4}", .{ch});
            } else try w.writeByte(ch);
        },
    };
    try w.writeByte('"');
}

fn jsonStrOpt(w: anytype, s: ?[]const u8) !void {
    if (s) |v| try jsonStr(w, v) else try w.writeAll("null");
}

fn idxList(w: anytype, list: []const u32) !void {
    try w.writeByte('[');
    for (list, 0..) |v, i| {
        if (i > 0) try w.writeByte(',');
        try w.print("{d}", .{v});
    }
    try w.writeByte(']');
}

pub fn main(init: std.process.Init) !u8 {
    const gpa = init.gpa;

    var it = try std.process.Args.Iterator.initAllocator(init.minimal.args, gpa);
    _ = it.skip(); // argv[0] = program name
    var args_list: std.ArrayList([]const u8) = .empty;
    while (it.next()) |arg| try args_list.append(gpa, arg);
    const args = args_list.items;

    if (args.len < 1) {
        std.debug.print("{s}\n", .{usage});
        return 2;
    }

    const code: u8 = switch (cmdId(args[0])) {
        .info => try cmdInfo(init, args[1..]),
        .presets => try cmdPresets(),
        .help => blk: {
            std.debug.print("{s}\n", .{usage});
            break :blk 0;
        },
        .unknown => blk: {
            std.debug.print("unknown command: {s}\n{s}\n", .{ args[0], usage });
            break :blk 2;
        },
    };
    std.process.exit(code);
}

const Cmd = enum { info, presets, help, unknown };

fn cmdId(s: []const u8) Cmd {
    if (std.mem.eql(u8, s, "info")) return .info;
    if (std.mem.eql(u8, s, "presets")) return .presets;
    if (std.mem.eql(u8, s, "help") or std.mem.eql(u8, s, "--help") or std.mem.eql(u8, s, "-h")) return .help;
    return .unknown;
}

fn hasFlag(args: []const []const u8, name: []const u8) bool {
    for (args) |a| {
        if (std.mem.eql(u8, a, name)) return true;
    }
    return false;
}

fn cmdInfo(init: std.process.Init, args: []const []const u8) !u8 {
    const gpa = init.gpa;
    var path: ?[]const u8 = null;
    for (args) |a| {
        if (!std.mem.startsWith(u8, a, "--")) {
            if (path == null) path = a;
        }
    }
    const file_path = path orelse {
        std.debug.print("info: missing <file>\n", .{});
        return 2;
    };
    const as_json = hasFlag(args, "--json");

    var loaded = core.parse.loadFile(init.io, gpa, file_path) catch |err| {
        std.debug.print("info: {s}: {s}\n", .{ file_path, @errorName(err) });
        return 2;
    };
    defer loaded.deinit();

    var arena2 = std.heap.ArenaAllocator.init(gpa);
    defer arena2.deinit();
    const st = try core.stats.compute(arena2.allocator(), loaded.asset);

    var stdout_buf: [64 * 1024]u8 = undefined;
    var wtr = std.Io.File.stdout().writer(init.io, &stdout_buf);
    const w = &wtr.interface;

    if (as_json) {
        try printJson(w, file_path, loaded.asset, st);
    } else {
        try printHuman(w, file_path, loaded.asset, st);
    }
    try w.flush();
    return 0;
}

fn printHuman(w: anytype, path: []const u8, asset: core.model.Asset, st: core.stats.Stats) !void {
    var buf: [64]u8 = undefined;
    try w.print("{s}\n", .{path});
    try w.print("  container:  {s}\n", .{if (asset.is_glb) "glb" else "gltf"});
    if (asset.version) |v| try w.print("  version:    {s}\n", .{v});
    if (asset.generator) |g| try w.print("  generator:  {s}\n", .{g});
    try w.print("  size:       {s}", .{core.stats.formatBytes(&buf, st.disk_total)});
    if (asset.is_glb) {
        const pct: f64 = if (st.disk_total > 0) @as(f64, @floatFromInt(st.disk_json)) / @as(f64, @floatFromInt(st.disk_total)) * 100 else 0;
        try w.print("  (json {s} {d:.0}% / bin {s})", .{ core.stats.formatBytes(&buf, st.disk_json), pct, core.stats.formatBytes(buf[16..], st.disk_bin) });
    }
    try w.print("\n\n", .{});

    try w.print("geometry\n", .{});
    try w.print("  scenes: {d}  nodes: {d}  meshes: {d}  primitives: {d}  instances: {d}\n", .{ st.scenes, st.nodes, st.meshes, st.primitives, st.mesh_instances });
    try w.print("  triangles: {d}  vertices: {d}  draw calls: {d}\n", .{ st.triangles, st.vertices, st.draw_calls });
    try w.print("  materials: {d}  textures: {d}  images: {d}\n", .{ st.materials, st.textures, st.images });
    try w.print("  animations: {d}  skins: {d}  joints: {d}\n\n", .{ st.animations, st.skins, st.joints_total });

    if (st.vram_total > 0) {
        try w.print("vram (est, rgba8)\n", .{});
        try w.print("  total: {s}\n", .{core.stats.formatBytes(&buf, st.vram_total)});
        for (st.image_stats) |im| {
            try w.print("  [{d}] {s} {d}x{d} {s}  vram {s}  disk {s}  mips:{s}\n", .{
                im.index,
                im.name orelse "-",
                im.width,
                im.height,
                im.mime.label(),
                core.stats.formatBytes(&buf, im.vram),
                core.stats.formatBytes(buf[16..], im.disk_bytes),
                if (im.has_mips) "y" else "n",
            });
        }
        try w.print("\n", .{});
    }

    if (asset.extensions_required.len > 0) {
        try w.print("extensions required:", .{});
        for (asset.extensions_required) |e| try w.print(" {s}", .{e});
        try w.print("\n", .{});
    }

    const g = st.garbage;
    const problems: usize = g.unused_nodes.len + g.unused_materials.len + g.unused_textures.len + g.unused_images.len + g.uncompressed_embedded.len;
    if (problems == 0) {
        try w.print("no issues\n", .{});
        return;
    }
    try w.print("issues ({d})\n", .{problems});
    for (g.unused_nodes) |i| try w.print("  unused node   [{d}] {s}\n", .{ i, asset.nodes[i].name orelse "-" });
    for (g.unused_materials) |i| try w.print("  unused mat    [{d}] {s}\n", .{ i, asset.materials[i].name orelse "-" });
    for (g.unused_textures) |i| try w.print("  unused tex    [{d}]\n", .{i});
    for (g.unused_images) |i| try w.print("  unused image  [{d}]\n", .{i});
    for (g.uncompressed_embedded) |i| try w.print("  uncompr. png  [{d}] in glb — encode to ktx2\n", .{i});
}

fn printJson(w: anytype, path: []const u8, asset: core.model.Asset, st: core.stats.Stats) !void {
    try w.writeAll("{\n  \"file\": ");
    try jsonStr(w, path);
    try w.print(",\n  \"container\": \"{s}\",\n", .{if (asset.is_glb) "glb" else "gltf"});
    try w.writeAll("  \"generator\": ");
    try jsonStrOpt(w, asset.generator);
    try w.writeAll(",\n  \"version\": ");
    try jsonStrOpt(w, asset.version);

    try w.writeAll(",\n  \"extensions_used\": [");
    for (asset.extensions_used, 0..) |e, i| {
        if (i > 0) try w.writeByte(',');
        try jsonStr(w, e);
    }
    try w.writeAll("],\n  \"extensions_required\": [");
    for (asset.extensions_required, 0..) |e, i| {
        if (i > 0) try w.writeByte(',');
        try jsonStr(w, e);
    }
    try w.writeAll("]");

    const json_pct: f64 = if (st.disk_total > 0)
        @as(f64, @floatFromInt(st.disk_json)) / @as(f64, @floatFromInt(st.disk_total)) * 100
    else
        0;
    try w.print(",\n  \"counts\": {{\"scenes\":{d},\"nodes\":{d},\"meshes\":{d},\"primitives\":{d},\"materials\":{d},\"textures\":{d},\"images\":{d},\"animations\":{d},\"skins\":{d},\"joints\":{d}}}", .{ st.scenes, st.nodes, st.meshes, st.primitives, st.materials, st.textures, st.images, st.animations, st.skins, st.joints_total });
    try w.print(",\n  \"geometry\": {{\"triangles\":{d},\"vertices\":{d},\"mesh_instances\":{d},\"draw_calls\":{d}}}", .{ st.triangles, st.vertices, st.mesh_instances, st.draw_calls });
    try w.print(",\n  \"disk\": {{\"total\":{d},\"json\":{d},\"bin\":{d},\"json_pct\":{d:.1}}}", .{ st.disk_total, st.disk_json, st.disk_bin, json_pct });

    try w.print(",\n  \"vram\": {{\"total_est\":{d},\"images\":[", .{st.vram_total});
    for (st.image_stats, 0..) |im, i| {
        if (i > 0) try w.writeByte(',');
        try w.print("\n    {{\"index\":{d},\"name\":", .{im.index});
        try jsonStrOpt(w, im.name);
        try w.print(",\"mime\":\"{s}\",\"width\":{d},\"height\":{d},\"vram\":{d},\"disk\":{d},\"has_mips\":{s}}}", .{ im.mime.label(), im.width, im.height, im.vram, im.disk_bytes, if (im.has_mips) "true" else "false" });
    }
    try w.writeAll("\n  ]}");

    try w.writeAll(",\n  \"garbage\": {\"unused_nodes\":");
    try idxList(w, st.garbage.unused_nodes);
    try w.writeAll(",\"unused_materials\":");
    try idxList(w, st.garbage.unused_materials);
    try w.writeAll(",\"unused_textures\":");
    try idxList(w, st.garbage.unused_textures);
    try w.writeAll(",\"unused_images\":");
    try idxList(w, st.garbage.unused_images);
    try w.writeAll(",\"no_mips_images\":");
    try idxList(w, st.garbage.no_mips_images);
    try w.writeAll(",\"uncompressed_embedded\":");
    try idxList(w, st.garbage.uncompressed_embedded);
    try w.writeAll("}\n}\n");
}

fn cmdPresets() !u8 {
    // step 4: read presets/*.zon; built-ins for now
    const builtins = [_][]const u8{ "mobile", "desktop", "web" };
    for (builtins) |p| {
        std.debug.print("{s}\n", .{p});
    }
    return 0;
}
