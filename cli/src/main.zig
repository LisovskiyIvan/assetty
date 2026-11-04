const std = @import("std");
const core = @import("core");

const usage =
    \\assetty — glTF/GLB asset toolkit
    \\
    \\Usage:
    \\  assetty                    (no args) — open the desktop app
    \\  assetty app | --app        — open the desktop app
    \\  assetty info <file.glb> [--json]
    \\  assetty diff <old.glb> <new.glb> [--json]
    \\  assetty lint <file-or-dir> --budget <budget.json> [--json]
    \\  assetty textures <file.glb> [--encode N] [--json]
    \\  assetty presets
    \\  assetty optimize <file.glb> --preset <name|path.zon> [-o <out.glb>] [--report <r.json>] [--strip-animations]
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

pub fn run(init: std.process.Init) !u8 {
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
        .diff => try cmdDiff(init, args[1..]),
        .lint => try cmdLint(init, args[1..]),
        .textures => try cmdTextures(init, args[1..]),
        .presets => try cmdPresets(),
        .optimize => try cmdOptimize(init, args[1..]),
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

const Cmd = enum { info, diff, lint, textures, presets, optimize, help, unknown };

fn cmdId(s: []const u8) Cmd {
    if (std.mem.eql(u8, s, "info")) return .info;
    if (std.mem.eql(u8, s, "diff")) return .diff;
    if (std.mem.eql(u8, s, "lint")) return .lint;
    if (std.mem.eql(u8, s, "textures")) return .textures;
    if (std.mem.eql(u8, s, "presets")) return .presets;
    if (std.mem.eql(u8, s, "optimize")) return .optimize;
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
                im.format_label,
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
        try w.print(",\"format\":\"{s}\",\"width\":{d},\"height\":{d},\"vram\":{d},\"disk\":{d},\"has_mips\":{s}}}", .{ im.format_label, im.width, im.height, im.vram, im.disk_bytes, if (im.has_mips) "true" else "false" });
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

fn containsIgnoreCase(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0) return true;
    if (needle.len > haystack.len) return false;
    var i: usize = 0;
    while (i + needle.len <= haystack.len) : (i += 1) {
        if (std.ascii.eqlIgnoreCase(haystack[i .. i + needle.len], needle)) return true;
    }
    return false;
}

fn mipLevelsFor(w: u32, h: u32) u32 {
    const m = @max(w, h);
    if (m == 0) return 1;
    return @as(u32, 32 - @clz(m)) + 1; // floor(log2(m)) + 1
}

fn cmdTextures(init: std.process.Init, args: []const []const u8) !u8 {
    const gpa = init.gpa;
    var path: ?[]const u8 = null;
    var encode_idx: ?u32 = null;
    var as_json = false;

    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const a = args[i];
        if (std.mem.eql(u8, a, "--json")) {
            as_json = true;
        } else if (std.mem.eql(u8, a, "--encode")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("textures: --encode needs an image index\n", .{});
                return 2;
            }
            encode_idx = std.fmt.parseInt(u32, args[i], 10) catch {
                std.debug.print("textures: --encode expects a number, got '{s}'\n", .{args[i]});
                return 2;
            };
        } else if (std.mem.startsWith(u8, a, "--encode=")) {
            const v = a["--encode=".len..];
            encode_idx = std.fmt.parseInt(u32, v, 10) catch {
                std.debug.print("textures: --encode expects a number, got '{s}'\n", .{v});
                return 2;
            };
        } else if (!std.mem.startsWith(u8, a, "--")) {
            if (path == null) path = a;
        }
    }

    const file_path = path orelse {
        std.debug.print("textures: missing <file.glb>\n", .{});
        return 2;
    };

    var loaded = core.parse.loadFile(init.io, gpa, file_path) catch |err| {
        std.debug.print("textures: {s}: {s}\n", .{ file_path, @errorName(err) });
        return 2;
    };
    defer loaded.deinit();

    var arena2 = std.heap.ArenaAllocator.init(gpa);
    defer arena2.deinit();
    const a = arena2.allocator();
    const st = try core.stats.compute(a, loaded.asset);

    var encode_res: ?EncodeResult = null;
    if (encode_idx) |idx| {
        if (idx >= loaded.asset.images.len) {
            std.debug.print("textures: image {d} out of range (file has {d})\n", .{ idx, loaded.asset.images.len });
            return 2;
        }
        encode_res = runEncode(a, loaded.asset.images[idx], idx) catch |err| {
            std.debug.print("textures: encode [{d}]: {s}\n", .{ idx, @errorName(err) });
            return 2;
        };
    }

    var stdout_buf: [64 * 1024]u8 = undefined;
    var wtr = std.Io.File.stdout().writer(init.io, &stdout_buf);
    const w = &wtr.interface;

    if (as_json) {
        try printTexturesJson(w, file_path, loaded.asset, st, encode_idx, encode_res);
    } else {
        try printTexturesHuman(w, file_path, loaded.asset, st, encode_idx, encode_res);
    }
    try w.flush();
    return 0;
}

const EncodeResult = struct {
    index: u32,
    name: ?[]const u8,
    width: u32,
    height: u32,
    mode: core.encode_ktx.Mode,
    quality: u8,
    srgb: bool,
    normal_map: bool,
    src_disk_bytes: u64,
    ktx2_bytes: u64,
    format_label: []const u8,
    mip_levels: u32,
    vram_before: u64,
    vram_after: u64,
    psnr_db: f32,
};

/// Decode image `img` to RGBA, encode it to KTX2, decode back and measure PSNR.
/// Returns null when the image is not decodable (missing/external/unsupported);
/// hard encoder failures surface as errors (CLI exit code 2).
fn runEncode(a: std.mem.Allocator, img: core.model.Image, idx: u32) !?EncodeResult {
    const bytes = img.data orelse {
        std.debug.print("  encode: [{d}] skipped: image data not embedded (uri)\n", .{idx});
        return null;
    };
    const dec = core.decode.decodeRgba(a, bytes) orelse {
        std.debug.print("  encode: [{d}] skipped: cannot decode source image ({s})\n", .{ idx, img.mime.label() });
        return null;
    };

    const is_normal = if (img.name) |n| containsIgnoreCase(n, "normal") else false;
    const opts: core.encode_ktx.Options = .{ .normal_map = is_normal };

    const out = try core.encode_ktx.encode(a, dec.pixels, dec.width, dec.height, opts);
    const rt = try core.encode_ktx.decodeToRgba(a, out.ktx2);
    if (rt.width != dec.width or rt.height != dec.height) {
        std.debug.print("  encode: [{d}] skipped: round-trip dims {d}x{d} != {d}x{d}\n", .{ idx, rt.width, rt.height, dec.width, dec.height });
        return null;
    }

    const levels = mipLevelsFor(dec.width, dec.height);
    const vram_before = core.formats.mipChainBytes(dec.width, dec.height, 37, levels); // VK_FORMAT_R8G8B8A8_UNORM
    return .{
        .index = idx,
        .name = img.name,
        .width = dec.width,
        .height = dec.height,
        .mode = opts.mode,
        .quality = opts.quality,
        .srgb = opts.srgb,
        .normal_map = is_normal,
        .src_disk_bytes = img.disk_bytes,
        .ktx2_bytes = out.ktx2.len,
        .format_label = out.format_label,
        .mip_levels = out.mip_levels,
        .vram_before = vram_before,
        .vram_after = out.ktx2.len,
        .psnr_db = core.encode_ktx.psnr(dec.pixels, rt.pixels),
    };
}

fn printTexturesHuman(
    w: anytype,
    path: []const u8,
    asset: core.model.Asset,
    st: core.stats.Stats,
    encode_idx: ?u32,
    enc: ?EncodeResult,
) !void {
    var buf: [64]u8 = undefined;
    try w.print("{s}\n", .{path});
    try w.print("  images: {d}  textures: {d}  vram est: {s}\n\n", .{
        asset.images.len,
        asset.textures.len,
        core.stats.formatBytes(&buf, st.vram_total),
    });
    if (asset.images.len == 0) {
        try w.print("  (no images)\n", .{});
        return;
    }
    for (st.image_stats) |im| {
        if (im.has_dims) {
            try w.print("  [{d}] {s}  {d}x{d}  {s}", .{
                im.index, im.name orelse "-", im.width, im.height, im.format_label,
            });
        } else {
            try w.print("  [{d}] {s}  -  {s}", .{ im.index, im.name orelse "-", im.format_label });
        }
        try w.print("  disk {s}  vram {s}  mips {s}\n", .{
            core.stats.formatBytes(&buf, im.disk_bytes),
            core.stats.formatBytes(buf[16..], im.vram),
            if (im.has_mips) "y" else "n",
        });
    }
    if (encode_idx != null and enc == null) {
        // runEncode already printed the reason; nothing else to show.
        return;
    }
    const e = enc orelse return;
    const pct: f64 = if (e.src_disk_bytes > 0)
        @as(f64, @floatFromInt(e.ktx2_bytes)) / @as(f64, @floatFromInt(e.src_disk_bytes)) * 100.0
    else
        0;
    try w.print("\n  encode: [{d}] {s}  {d}x{d}  {s} q{d}{s}\n", .{
        e.index,
        e.name orelse "-",
        e.width,
        e.height,
        if (e.mode == .etc1s) "etc1s" else "uastc",
        e.quality,
        if (e.normal_map) "  normal-map" else "",
    });
    try w.print("    source:  {s} on disk\n", .{
        core.stats.formatBytes(&buf, e.src_disk_bytes),
    });
    try w.print("    ktx2:    {s}  ({d:.1}% of source)  {s}, {d} mip(s)\n", .{
        core.stats.formatBytes(buf[16..], e.ktx2_bytes),
        pct,
        e.format_label,
        e.mip_levels,
    });
    try w.print("    vram:    {s} rgba8+mips -> {s} ktx2 bytes\n", .{
        core.stats.formatBytes(buf[32..], e.vram_before),
        core.stats.formatBytes(&buf, e.vram_after),
    });
    try w.print("    psnr:    {d:.2} dB\n", .{e.psnr_db});
}

fn printTexturesJson(
    w: anytype,
    path: []const u8,
    asset: core.model.Asset,
    st: core.stats.Stats,
    encode_idx: ?u32,
    enc: ?EncodeResult,
) !void {
    try w.writeAll("{\n  \"file\": ");
    try jsonStr(w, path);
    try w.print(",\n  \"images_count\": {d},\n  \"vram_total_est\": {d},\n  \"images\": [", .{
        asset.images.len,
        st.vram_total,
    });
    for (st.image_stats, 0..) |im, i| {
        if (i > 0) try w.writeByte(',');
        try w.writeAll("\n    {\"index\":");
        try w.print("{d},\"name\":", .{im.index});
        try jsonStrOpt(w, im.name);
        try w.writeAll(",\"format\":");
        try jsonStr(w, im.format_label);
        try w.print(",\"width\":{d},\"height\":{d},\"disk\":{d},\"vram\":{d},\"has_mips\":{s}}}", .{
            im.width,
            im.height,
            im.disk_bytes,
            im.vram,
            if (im.has_mips) "true" else "false",
        });
    }
    try w.writeAll("\n  ]");

    if (encode_idx) |idx| {
        try w.print(",\n  \"encode_request\": {d}", .{idx});
        if (enc) |e| {
            try w.writeAll(",\n  \"encode\": {\"index\":");
            try w.print("{d},\"name\":", .{e.index});
            try jsonStrOpt(w, e.name);
            try w.writeAll(",\"mode\":\"");
            try w.writeAll(if (e.mode == .etc1s) "etc1s" else "uastc");
            try w.print("\",\"quality\":{d},\"srgb\":{s},\"normal_map\":{s}", .{
                e.quality,
                if (e.srgb) "true" else "false",
                if (e.normal_map) "true" else "false",
            });
            try w.print(",\"width\":{d},\"height\":{d},\"mip_levels\":{d},\"format\":", .{
                e.width, e.height, e.mip_levels,
            });
            try jsonStr(w, e.format_label);
            try w.print(",\"source_bytes\":{d},\"ktx2_bytes\":{d},\"vram_before\":{d},\"vram_after\":{d},\"psnr_db\":{d:.2}}}", .{
                e.src_disk_bytes,
                e.ktx2_bytes,
                e.vram_before,
                e.vram_after,
                e.psnr_db,
            });
        } else {
            try w.writeAll(",\n  \"encode\": null");
        }
    }
    try w.writeAll("\n}\n");
}

fn cmdPresets() !u8 {
    // step 4: read presets/*.zon; built-ins for now
    const builtins = [_][]const u8{ "mobile", "desktop", "web" };
    for (builtins) |p| {
        std.debug.print("{s}\n", .{p});
    }
    return 0;
}

fn cmdDiff(init: std.process.Init, args: []const []const u8) !u8 {
    const gpa = init.gpa;
    var files: [2][]const u8 = undefined;
    var n: usize = 0;
    for (args) |a| {
        if (std.mem.startsWith(u8, a, "--")) continue;
        if (n == 2) {
            std.debug.print("diff: expected exactly two files\n", .{});
            return 2;
        }
        files[n] = a;
        n += 1;
    }
    if (n != 2) {
        std.debug.print("diff: usage: assetty diff <old> <new> [--json]\n", .{});
        return 2;
    }
    const as_json = hasFlag(args, "--json");

    var old_loaded = core.parse.loadFile(init.io, gpa, files[0]) catch |err| {
        std.debug.print("diff: {s}: {s}\n", .{ files[0], @errorName(err) });
        return 2;
    };
    defer old_loaded.deinit();
    var new_loaded = core.parse.loadFile(init.io, gpa, files[1]) catch |err| {
        std.debug.print("diff: {s}: {s}\n", .{ files[1], @errorName(err) });
        return 2;
    };
    defer new_loaded.deinit();

    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const rep = core.diff.compare(arena.allocator(), old_loaded.asset, new_loaded.asset) catch |err| {
        std.debug.print("diff: {s}\n", .{@errorName(err)});
        return 2;
    };

    var stdout_buf: [64 * 1024]u8 = undefined;
    var wtr = std.Io.File.stdout().writer(init.io, &stdout_buf);
    const w = &wtr.interface;

    if (as_json) {
        try core.diff.reportJson(w, rep);
    } else {
        try core.diff.summary(rep, w);
    }
    try w.flush();
    return 0;
}

fn isGltfName(name: []const u8) bool {
    const ext = std.fs.path.extension(name);
    return std.ascii.eqlIgnoreCase(ext, ".glb") or std.ascii.eqlIgnoreCase(ext, ".gltf");
}

fn lessThanName(_: void, a: []const u8, b: []const u8) bool {
    return std.mem.lessThan(u8, a, b);
}

fn lintOneFile(
    init: std.process.Init,
    gpa: std.mem.Allocator,
    path: []const u8,
    budget: core.lint.Budget,
    as_json: bool,
    first: bool,
    w: anytype,
) !usize {
    var loaded = try core.parse.loadFile(init.io, gpa, path);
    defer loaded.deinit();

    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const st = try core.stats.compute(arena.allocator(), loaded.asset);
    const vs = try core.lint.check(arena.allocator(), st, budget);

    if (as_json) {
        if (!first) try w.writeByte(',');
        try w.writeAll("{\"file\": ");
        try jsonStr(w, path);
        try w.writeAll(", \"violations\": [");
        for (vs, 0..) |v, i| {
            if (i > 0) try w.writeByte(',');
            try w.writeAll("{\"code\": ");
            try jsonStr(w, v.code);
            try w.writeAll(", \"message\": ");
            try jsonStr(w, v.message);
            try w.writeAll(", \"index\": ");
            if (v.index) |ix| {
                try w.print("{d}", .{ix});
            } else {
                try w.writeAll("null");
            }
            try w.writeByte('}');
        }
        try w.writeAll("]}");
    } else if (vs.len == 0) {
        try w.print("{s}: ok\n", .{path});
    } else {
        try w.print("{s}\n", .{path});
        for (vs) |v| {
            if (v.index) |ix| {
                try w.print("  [{d}] {s}: {s}\n", .{ ix, v.code, v.message });
            } else {
                try w.print("  {s}: {s}\n", .{ v.code, v.message });
            }
        }
    }
    return vs.len;
}

fn cmdLint(init: std.process.Init, args: []const []const u8) !u8 {
    const gpa = init.gpa;
    var path: ?[]const u8 = null;
    var budget_path: ?[]const u8 = null;
    var as_json = false;
    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const a = args[i];
        if (std.mem.eql(u8, a, "--json")) {
            as_json = true;
        } else if (std.mem.eql(u8, a, "--budget")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("lint: --budget needs a file\n", .{});
                return 2;
            }
            budget_path = args[i];
        } else if (std.mem.startsWith(u8, a, "--budget=")) {
            budget_path = a["--budget=".len..];
        } else if (!std.mem.startsWith(u8, a, "--")) {
            if (path == null) path = a;
        }
    }
    const p = path orelse {
        std.debug.print("lint: missing <file-or-dir>\n", .{});
        return 2;
    };
    const bp = budget_path orelse {
        std.debug.print("lint: missing --budget <budget.json>\n", .{});
        return 2;
    };

    const budget_bytes = std.Io.Dir.cwd().readFileAlloc(init.io, bp, gpa, .limited(1 << 20)) catch |err| {
        std.debug.print("lint: {s}: {s}\n", .{ bp, @errorName(err) });
        return 2;
    };
    defer gpa.free(budget_bytes);

    var budget = core.lint.parseBudget(gpa, budget_bytes) catch |err| {
        std.debug.print("lint: bad budget {s}: {s}\n", .{ bp, @errorName(err) });
        return 2;
    };
    defer budget.deinit(gpa);

    const st = std.Io.Dir.cwd().statFile(init.io, p, .{}) catch |err| {
        std.debug.print("lint: {s}: {s}\n", .{ p, @errorName(err) });
        return 2;
    };

    var stdout_buf: [64 * 1024]u8 = undefined;
    var wtr = std.Io.File.stdout().writer(init.io, &stdout_buf);
    const w = &wtr.interface;

    var total: usize = 0;
    var file_count: usize = 0;
    if (as_json) try w.writeAll("{\"files\":[");

    if (st.kind == .directory) {
        var dir = std.Io.Dir.cwd().openDir(init.io, p, .{ .iterate = true }) catch |err| {
            std.debug.print("lint: {s}: {s}\n", .{ p, @errorName(err) });
            return 2;
        };
        defer dir.close(init.io);

        var names: std.ArrayList([]const u8) = .empty;
        defer {
            for (names.items) |nm| gpa.free(nm);
            names.deinit(gpa);
        }
        var it = dir.iterate();
        while (it.next(init.io) catch |err| {
            std.debug.print("lint: {s}: {s}\n", .{ p, @errorName(err) });
            return 2;
        }) |entry| {
            if (entry.kind != .file) continue;
            if (!isGltfName(entry.name)) continue;
            try names.append(gpa, try gpa.dupe(u8, entry.name));
        }
        std.sort.block([]const u8, names.items, {}, lessThanName);

        for (names.items) |nm| {
            const full = try std.fs.path.join(gpa, &.{ p, nm });
            defer gpa.free(full);
            const count = lintOneFile(init, gpa, full, budget, as_json, file_count == 0, w) catch |err| {
                std.debug.print("lint: {s}: {s}\n", .{ full, @errorName(err) });
                return 2;
            };
            total += count;
            file_count += 1;
        }
    } else {
        const count = lintOneFile(init, gpa, p, budget, as_json, true, w) catch |err| {
            std.debug.print("lint: {s}: {s}\n", .{ p, @errorName(err) });
            return 2;
        };
        total += count;
        file_count += 1;
    }

    if (as_json) {
        try w.print("],\n  \"total\": {d}\n}}\n", .{total});
    } else if (total == 0) {
        try w.print("all {d} file(s) within budget\n", .{file_count});
    } else {
        try w.print("total: {d} violation(s) in {d} file(s)\n", .{ total, file_count });
    }
    try w.flush();
    return if (total > 0) 1 else 0;
}

// ---------------------------------------------------------------------------
// optimize
// ---------------------------------------------------------------------------

/// Resolve a `--preset` argument to a preset value.
///
/// * a path (contains `/` or ends with `.zon`) is loaded as-is;
/// * a bare name tries `presets/<name>.zon`, then `test/<name>.zon` (the test
///   presets live there), and finally falls back to the built-in platform
///   defaults when the name is `.mobile` / `.desktop` / `.web`.
fn resolvePreset(io: std.Io, a: std.mem.Allocator, spec: []const u8) !core.preset.Preset {
    if (std.mem.indexOfScalar(u8, spec, '/') != null or std.mem.endsWith(u8, spec, ".zon")) {
        return core.preset.loadFile(io, a, spec);
    }

    var buf: [256]u8 = undefined;
    const path = core.preset.defaultPath(spec, &buf);
    if (path.len > 0) {
        if (core.preset.loadFile(io, a, path)) |p| {
            return p;
        } else |_| {}
    }

    var test_buf: [256]u8 = undefined;
    const test_path = std.fmt.bufPrint(&test_buf, "test/{s}.zon", .{spec}) catch "";
    if (test_path.len > 0) {
        if (core.preset.loadFile(io, a, test_path)) |p| {
            return p;
        } else |_| {}
    }

    const target = std.meta.stringToEnum(core.preset.Target, spec) orelse return error.UnknownPreset;
    return core.preset.platformDefaults(target);
}

fn deltaPct(before: u64, after: u64) ?f64 {
    if (before == 0) return if (after == 0) @as(f64, 0) else null;
    const b: f64 = @floatFromInt(before);
    const af: f64 = @floatFromInt(after);
    return (af - b) / b * 100.0;
}

fn printPct(w: anytype, before: u64, after: u64) !void {
    if (deltaPct(before, after)) |p| {
        if (p > 0) {
            try w.print("+{d:.1}%", .{p});
        } else {
            try w.print("{d:.1}%", .{p});
        }
    } else {
        try w.writeAll("n/a");
    }
}

fn printNumRow(w: anytype, label: []const u8, before: u64, after: u64) !void {
    try w.print("  {s:<14}{d:>12}{d:>12}   ", .{ label, before, after });
    try printPct(w, before, after);
    try w.writeByte('\n');
}

fn printByteRow(w: anytype, label: []const u8, before: u64, after: u64) !void {
    var b1: [32]u8 = undefined;
    var b2: [32]u8 = undefined;
    try w.print("  {s:<14}{s:>12}{s:>12}   ", .{
        label,
        core.stats.formatBytes(&b1, before),
        core.stats.formatBytes(&b2, after),
    });
    try printPct(w, before, after);
    try w.writeByte('\n');
}

fn printOptimizeHuman(
    w: anytype,
    file_path: []const u8,
    out_path: []const u8,
    p: core.preset.Preset,
    rep: core.runner.Report,
) !void {
    try w.print("preset \"{s}\" target={s} steps={d}\n", .{
        p.name,
        @tagName(p.target),
        p.steps.len,
    });
    for (rep.steps) |st| {
        if (st.applied) {
            try w.print("  [{s}] applied — {s}\n", .{ st.kind, st.note });
        } else {
            const note = if (std.mem.eql(u8, st.note, "not implemented, skipped"))
                "not implemented"
            else if (st.note.len == 0)
                "skipped"
            else
                st.note;
            try w.print("  [{s}] skipped — {s}\n", .{ st.kind, note });
        }
    }
    try w.print("\n{s} -> {s}\n\n", .{ file_path, out_path });
    try w.print("  {s:<14}{s:>12}{s:>12}\n", .{ "", "before", "after" });
    try printNumRow(w, "triangles", rep.before.triangles, rep.after.triangles);
    try printNumRow(w, "vertices", rep.before.vertices, rep.after.vertices);
    try printNumRow(w, "draw calls", rep.before.draw_calls, rep.after.draw_calls);
    try printByteRow(w, "vram est", rep.before.vram_total, rep.after.vram_total);
    try printByteRow(w, "disk size", rep.before.disk_total, rep.after.disk_total);
}

fn deltaJson(w: anytype, before: u64, after: u64) !void {
    try w.print("{{\"before\":{d},\"after\":{d},\"pct\":", .{ before, after });
    if (deltaPct(before, after)) |p| {
        try w.print("{d:.2}", .{p});
    } else {
        try w.writeAll("null");
    }
    try w.writeByte('}');
}

fn printOptimizeJson(
    w: anytype,
    file_path: []const u8,
    out_path: []const u8,
    p: core.preset.Preset,
    rep: core.runner.Report,
) !void {
    try w.writeAll("{\n  \"preset\": ");
    try jsonStr(w, p.name);
    try w.print(",\n  \"target\": \"{s}\"", .{@tagName(p.target)});
    try w.writeAll(",\n  \"input\": ");
    try jsonStr(w, file_path);
    try w.writeAll(",\n  \"output\": ");
    try jsonStr(w, out_path);

    try w.writeAll(",\n  \"steps\": [");
    for (rep.steps, 0..) |st, i| {
        if (i > 0) try w.writeByte(',');
        try w.writeAll("\n    {\"kind\": ");
        try jsonStr(w, st.kind);
        try w.print(", \"applied\": {s}, \"note\": ", .{if (st.applied) "true" else "false"});
        try jsonStr(w, st.note);
        try w.writeByte('}');
    }
    try w.writeAll("\n  ],\n  \"deltas\": {");

    try w.writeAll("\n    \"triangles\": ");
    try deltaJson(w, rep.before.triangles, rep.after.triangles);
    try w.writeAll(",\n    \"vertices\": ");
    try deltaJson(w, rep.before.vertices, rep.after.vertices);
    try w.writeAll(",\n    \"draw_calls\": ");
    try deltaJson(w, rep.before.draw_calls, rep.after.draw_calls);
    try w.writeAll(",\n    \"vram_bytes\": ");
    try deltaJson(w, rep.before.vram_total, rep.after.vram_total);
    try w.writeAll(",\n    \"disk_bytes\": ");
    try deltaJson(w, rep.before.disk_total, rep.after.disk_total);
    try w.writeAll("\n  }");
    if (rep.texture_images.len > 0) {
        try w.writeAll(",\n  \"texture_images\": [");
        for (rep.texture_images, 0..) |im, i| {
            if (i > 0) try w.writeByte(',');
            try w.print("\n    {{\"index\":{d},\"name\":", .{im.index});
            try jsonStrOpt(w, im.name);
            try w.writeAll(",\"format\":");
            try jsonStr(w, im.format);
            try w.print(",\"skipped\":{s}}}", .{if (im.skipped) "true" else "false"});
        }
        try w.writeAll("\n  ]");
    }
    try w.writeAll("\n}\n");
}

fn cmdOptimize(init: std.process.Init, args: []const []const u8) !u8 {
    const gpa = init.gpa;
    const io = init.io;

    var input: ?[]const u8 = null;
    var preset_spec: ?[]const u8 = null;
    var out_arg: ?[]const u8 = null;
    var report_arg: ?[]const u8 = null;
    var strip_animations = false;

    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const a = args[i];
        if (std.mem.eql(u8, a, "--preset") or std.mem.eql(u8, a, "-p")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("optimize: {s} needs a value\n", .{a});
                return 2;
            }
            preset_spec = args[i];
        } else if (std.mem.startsWith(u8, a, "--preset=")) {
            preset_spec = a["--preset=".len..];
        } else if (std.mem.eql(u8, a, "-o") or std.mem.eql(u8, a, "--out")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("optimize: {s} needs a file\n", .{a});
                return 2;
            }
            out_arg = args[i];
        } else if (std.mem.startsWith(u8, a, "--out=")) {
            out_arg = a["--out=".len..];
        } else if (std.mem.eql(u8, a, "--report")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("optimize: --report needs a file\n", .{});
                return 2;
            }
            report_arg = args[i];
        } else if (std.mem.startsWith(u8, a, "--report=")) {
            report_arg = a["--report=".len..];
        } else if (std.mem.eql(u8, a, "--strip-animations")) {
            strip_animations = true;
        } else if (!std.mem.startsWith(u8, a, "-")) {
            if (input == null) input = a;
        }
    }

    const file_path = input orelse {
        std.debug.print("optimize: missing <file.glb>\n", .{});
        return 2;
    };
    const spec = preset_spec orelse {
        std.debug.print("optimize: missing --preset <name|path.zon>\n", .{});
        return 2;
    };

    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const a = arena.allocator();

    var p = resolvePreset(io, a, spec) catch |err| switch (err) {
        error.UnknownPreset => {
            std.debug.print("optimize: unknown preset '{s}' (expected mobile/desktop/web or a .zon file)\n", .{spec});
            return 2;
        },
        error.OutOfMemory => return err,
        else => |e| {
            std.debug.print("optimize: preset '{s}': {s}\n", .{ spec, @errorName(e) });
            return 2;
        },
    };

    // Convenience override: strip every animation from whichever prune steps
    // the preset carries. Composes with --preset (built-in or .zon file).
    if (strip_animations) {
        const steps = try a.dupe(core.preset.Step, p.steps);
        for (steps) |*s| switch (s.*) {
            .prune => |*pp| pp.animations = false,
            else => {},
        };
        p.steps = steps;
    }

    const out_path = out_arg orelse blk: {
        const base = std.fs.path.basename(file_path);
        const ext = std.fs.path.extension(base);
        const stem = if (ext.len > 0) base[0 .. base.len - ext.len] else base;
        break :blk try std.fmt.allocPrint(a, "{s}.opt.glb", .{stem});
    };

    const rep = core.runner.run(io, a, file_path, .{
        .preset = p,
        .out_path = out_path,
    }) catch |err| {
        std.debug.print("optimize: {s}: {s}\n", .{ file_path, @errorName(err) });
        return 2;
    };

    var stdout_buf: [64 * 1024]u8 = undefined;
    var wtr = std.Io.File.stdout().writer(io, &stdout_buf);
    const w = &wtr.interface;
    try printOptimizeHuman(w, file_path, out_path, p, rep);
    try w.flush();

    if (report_arg) |rp| {
        var json_buf: [16 * 1024]u8 = undefined;
        var jw = std.Io.Writer.fixed(&json_buf);
        printOptimizeJson(&jw, file_path, out_path, p, rep) catch |err| {
            std.debug.print("optimize: report {s}: {s}\n", .{ rp, @errorName(err) });
            return 2;
        };
        std.Io.Dir.cwd().writeFile(io, .{ .sub_path = rp, .data = jw.buffered() }) catch |err| {
            std.debug.print("optimize: report {s}: {s}\n", .{ rp, @errorName(err) });
            return 2;
        };
    }

    return 0;
}
