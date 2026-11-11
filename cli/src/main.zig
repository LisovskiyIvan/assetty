const std = @import("std");
const core = @import("core");
const config = @import("config");

const usage =
    \\assetty — glTF/GLB asset toolkit
    \\
    \\Usage:
    \\  assetty                    (no args) — open the desktop app
    \\  assetty app | --app        — open the desktop app
    \\  assetty info <file.glb> [--json]
    \\  assetty textures <file.glb> [--encode N] [--json]
    \\  assetty presets
    \\  assetty optimize <file.glb> --preset <name|path.zon|path.json> [-o <out.glb>] [--report <r.json>] [--strip-animations]
    \\  assetty optimize <a.glb> <b.glb> ... --preset <name|path.zon|path.json> [--out-dir <dir>] [--report <r.json>] [--strip-animations]
    \\
    \\Batch: multiple inputs are processed one by one from their sources into
    \\--out-dir (default: each input's own directory) as <stem>.opt.glb; an
    \\output equal to its input is refused. -o/--out is single-input only.
    \\--report with one input writes that file's report object; with several it
    \\writes {"count","succeeded","failed","total_secs","files":[...]} where each
    \\entry is a report object or {"input","error"}. Failures never stop the
    \\batch; the exit code is 0 only when every file succeeds.
    \\
    \\Exit codes: 0 ok, 2 error
;

/// Shared JSON primitives (see core/src/json_util.zig): aliased so every
/// writer below emits byte-identical output to the app backend.
const jsonStr = core.json_util.jsonStr;
const jsonStrOpt = core.json_util.jsonStrOpt;
const idxList = core.json_util.idxList;
const deltaPct = core.json_util.deltaPct;
const deltaJson = core.json_util.deltaJson;

pub fn run(init: std.process.Init) !u8 {
    const gpa = init.gpa;

    var it = try std.process.Args.Iterator.initAllocator(init.minimal.args, gpa);
    defer it.deinit();
    _ = it.skip(); // argv[0] = program name
    var args_list: std.ArrayList([]const u8) = .empty;
    defer args_list.deinit(gpa);
    while (it.next()) |arg| try args_list.append(gpa, arg);
    const args = args_list.items;

    if (args.len < 1) {
        std.debug.print("{s}\n", .{usage});
        return 2;
    }
    const code: u8 = switch (cmdId(args[0])) {
        .info => try cmdInfo(init, args[1..]),
        .textures => try cmdTextures(init, args[1..]),
        .presets => try cmdPresets(init),
        .optimize => try cmdOptimize(init, args[1..]),
        .version => blk: {
            var stdout_buf: [256]u8 = undefined;
            var wtr = std.Io.File.stdout().writer(init.io, &stdout_buf);
            try wtr.interface.print("assetty {s}\n", .{config.version});
            try wtr.interface.flush();
            break :blk 0;
        },
        .help => blk: {
            var buffer: [4096]u8 = undefined;
            var output = std.Io.File.stdout().writer(init.io, &buffer);
            try output.interface.print("{s}\n", .{usage});
            try output.interface.flush();
            break :blk 0;
        },
        .unknown => blk: {
            std.debug.print("unknown command: {s}\n{s}\n", .{ args[0], usage });
            break :blk 2;
        },
    };
    // Returned, not exited: the caller (and its defers) owns process exit.
    return code;
}

/// Common file-load failures get an actionable message; everything else keeps
/// `@errorName`. `cmd` is the invoking subcommand (`info`, `textures`, ...).
fn reportLoadErr(cmd: []const u8, path: []const u8, err: anyerror) void {
    switch (err) {
        error.FileNotFound => std.debug.print("{s}: no such file: {s}\n", .{ cmd, path }),
        error.AccessDenied, error.PermissionDenied => std.debug.print("{s}: permission denied: {s}\n", .{ cmd, path }),
        error.NotGltf, error.InvalidGlb => std.debug.print("{s}: not a glTF/GLB file: {s}\n", .{ cmd, path }),
        else => std.debug.print("{s}: {s}: {s}\n", .{ cmd, path, @errorName(err) }),
    }
}

const Cmd = enum { info, textures, presets, optimize, version, help, unknown };

fn cmdId(s: []const u8) Cmd {
    if (std.mem.eql(u8, s, "info")) return .info;
    if (std.mem.eql(u8, s, "textures")) return .textures;
    if (std.mem.eql(u8, s, "presets")) return .presets;
    if (std.mem.eql(u8, s, "optimize")) return .optimize;
    if (std.mem.eql(u8, s, "version") or std.mem.eql(u8, s, "--version") or std.mem.eql(u8, s, "-V")) return .version;
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
        reportLoadErr("info", file_path, err);
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
        reportLoadErr("textures", file_path, err);
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

    const levels = core.formats.mipLevels(dec.width, dec.height);
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

fn cmdPresets(init: std.process.Init) !u8 {
    var arena = std.heap.ArenaAllocator.init(init.gpa);
    defer arena.deinit();
    const a = arena.allocator();

    // Live presets: every readable candidate dir (cwd first, then installed
    // layouts next to the binary), names de-duplicated and sorted — the same
    // `presets/<name>.zon|json` layout `Backend.presetsIn` lists.
    var names: std.ArrayList([]const u8) = .empty;
    collectPresetNames(init.io, a, &names, "presets");
    if (std.process.executablePathAlloc(init.io, a) catch null) |exe| {
        if (std.fs.path.dirname(exe)) |dir| {
            collectPresetNames(init.io, a, &names, std.fmt.allocPrint(a, "{s}/presets", .{dir}) catch dir);
            collectPresetNames(init.io, a, &names, std.fmt.allocPrint(a, "{s}/../presets", .{dir}) catch dir);
            collectPresetNames(init.io, a, &names, std.fmt.allocPrint(a, "{s}/../share/assetty/presets", .{dir}) catch dir);
        }
    }
    std.mem.sort([]const u8, names.items, {}, struct {
        fn lt(_: void, x: []const u8, y: []const u8) bool {
            return std.mem.lessThan(u8, x, y);
        }
    }.lt);

    var prev: ?[]const u8 = null;
    var shown: usize = 0;
    for (names.items) |n| {
        if (prev) |p| if (std.mem.eql(u8, p, n)) continue;
        prev = n;
        std.debug.print("{s}\n", .{n});
        shown += 1;
    }
    if (shown == 0) {
        // Last-resort fallback: the dir scan yielded nothing, so the command
        // never regresses to empty.
        for ([_][]const u8{ "mobile", "desktop", "web" }) |p| {
            std.debug.print("{s}\n", .{p});
        }
    }
    return 0;
}

/// Append the valid preset stems found in `dir` to `out`; a missing or
/// unreadable dir contributes nothing (callers fall back to built-ins).
fn collectPresetNames(io: std.Io, a: std.mem.Allocator, out: *std.ArrayList([]const u8), dir: []const u8) void {
    var d = std.Io.Dir.cwd().openDir(io, dir, .{ .iterate = true }) catch return;
    defer d.close(io);
    var it = d.iterate();
    while (it.next(io) catch null) |e| {
        if (e.kind != .file and e.kind != .sym_link) continue;
        const stem: ?[]const u8 = if (std.mem.endsWith(u8, e.name, ".zon"))
            e.name[0 .. e.name.len - ".zon".len]
        else if (std.mem.endsWith(u8, e.name, ".json"))
            e.name[0 .. e.name.len - ".json".len]
        else
            continue;
        if (!validPresetName(stem.?)) continue;
        out.append(a, a.dupe(u8, stem.?) catch continue) catch continue;
    }
}

fn validPresetName(name: []const u8) bool {
    if (name.len == 0 or name.len > 64) return false;
    for (name) |ch| {
        if (!std.ascii.isAlphanumeric(ch) and ch != '_' and ch != '-') return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// optimize
// ---------------------------------------------------------------------------

/// Resolve a `--preset` argument to a preset value.
///
/// * a path ending in `.json` is parsed as a JSON step spec (see
///   `core.spec_json`; `detail` names the offending step/field on failure);
/// * a path (contains `/`) or ending in `.zon` is loaded as-is;
/// * a bare name tries `presets/<name>.json`, then `presets/<name>.zon`, then
///   `test/<name>.zon` (the test presets live there), and finally falls back
///   to the built-in platform defaults when the name is
///   `mobile` / `desktop` / `web`.
///
/// Only a missing candidate file (`FileNotFound`) falls through to the next
/// one: any other error (unreadable/invalid file, bad spec) is returned with
/// the candidate path attached via `detail`, so the caller can report it.
fn resolvePreset(io: std.Io, a: std.mem.Allocator, spec: []const u8, detail: *[]const u8) !core.preset.Preset {
    if (std.mem.endsWith(u8, spec, ".json")) {
        return core.spec_json.parseSpecFile(io, a, spec, detail) catch |err| {
            if (detail.*.len == 0) detail.* = spec;
            return err;
        };
    }
    if (std.mem.indexOfScalar(u8, spec, '/') != null or std.mem.endsWith(u8, spec, ".zon")) {
        return core.preset.loadFile(io, a, spec) catch |err| {
            detail.* = spec;
            return err;
        };
    }

    var buf: [256]u8 = undefined;
    const jpath = std.fmt.bufPrint(&buf, "presets/{s}.json", .{spec}) catch "";
    if (jpath.len > 0) {
        if (std.Io.Dir.cwd().statFile(io, jpath, .{})) |_| {
            return core.spec_json.parseSpecFile(io, a, jpath, detail) catch |err| {
                if (detail.*.len == 0) {
                    detail.* = jpath;
                } else {
                    detail.* = std.fmt.allocPrint(a, "{s} ({s})", .{ jpath, detail.* }) catch jpath;
                }
                return err;
            };
        } else |err| {
            if (err != error.FileNotFound) {
                detail.* = jpath;
                return err;
            }
        }
    }

    const path = core.preset.defaultPath(spec, &buf);
    if (path.len > 0) {
        if (std.Io.Dir.cwd().statFile(io, path, .{})) |_| {
            return core.preset.loadFile(io, a, path) catch |err| {
                detail.* = path;
                return err;
            };
        } else |err| {
            if (err != error.FileNotFound) {
                detail.* = path;
                return err;
            }
        }
    }

    var test_buf: [256]u8 = undefined;
    const test_path = std.fmt.bufPrint(&test_buf, "test/{s}.zon", .{spec}) catch "";
    if (test_path.len > 0) {
        if (std.Io.Dir.cwd().statFile(io, test_path, .{})) |_| {
            return core.preset.loadFile(io, a, test_path) catch |err| {
                detail.* = test_path;
                return err;
            };
        } else |err| {
            if (err != error.FileNotFound) {
                detail.* = test_path;
                return err;
            }
        }
    }

    const target = std.meta.stringToEnum(core.preset.Target, spec) orelse return error.UnknownPreset;
    return core.preset.platformDefaults(target);
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
        } else if (st.failed) {
            // A failed step is not a skipped one: the output exists, but the
            // step did not do its job (textures stayed PNG, for example).
            try w.print("  [{s}] FAILED — {s}\n", .{ st.kind, st.note });
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

/// The optimize report JSON — one writer shared with the app backend (see
/// core/src/report_json.zig), so one consumer parses both.
const printOptimizeJson = core.report_json.writeOptimize;

/// Render one file's report object (see `printOptimizeJson`).
fn renderSingleReport(
    a: std.mem.Allocator,
    file_path: []const u8,
    out_path: []const u8,
    p: core.preset.Preset,
    rep: core.runner.Report,
) ![]u8 {
    var aw: std.Io.Writer.Allocating = .init(a);
    errdefer aw.deinit();
    try printOptimizeJson(&aw.writer, file_path, out_path, p, rep);
    return aw.toOwnedSlice();
}

/// Render `{"input","error"}` for a file the batch could not process.
fn renderErrorEntry(a: std.mem.Allocator, file_path: []const u8, err_name: []const u8) ![]u8 {
    var aw: std.Io.Writer.Allocating = .init(a);
    errdefer aw.deinit();
    const w = &aw.writer;
    try w.writeAll("{\"input\": ");
    try jsonStr(w, file_path);
    try w.writeAll(", \"error\": ");
    try jsonStr(w, err_name);
    try w.writeByte('}');
    return aw.toOwnedSlice();
}

/// `<stem>.opt.glb` inside `out_dir` (or the input's own directory when null).
fn batchOutPath(a: std.mem.Allocator, input: []const u8, out_dir: ?[]const u8) ![]u8 {
    const base = std.fs.path.basename(input);
    const stem = std.fs.path.stem(base);
    // Dotfiles (".glb") have no real stem — fall back like an empty one.
    const clean: []const u8 = if (stem.len == 0 or (base.len > 0 and base[0] == '.' and std.mem.eql(u8, stem, base)))
        "model"
    else
        stem;
    if (out_dir) |d| return std.fmt.allocPrint(a, "{s}/{s}.opt.glb", .{ d, clean });
    const dir = std.fs.path.dirname(input);
    if (dir == null or dir.?.len == 0) return std.fmt.allocPrint(a, "{s}.opt.glb", .{clean});
    return std.fmt.allocPrint(a, "{s}/{s}.opt.glb", .{ dir.?, clean });
}

fn cmdOptimize(init: std.process.Init, args: []const []const u8) !u8 {
    const gpa = init.gpa;
    const io = init.io;

    var inputs: std.ArrayList([]const u8) = .empty;
    var preset_spec: ?[]const u8 = null;
    var out_arg: ?[]const u8 = null;
    var out_dir_arg: ?[]const u8 = null;
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
        } else if (std.mem.eql(u8, a, "--out-dir")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("optimize: --out-dir needs a directory\n", .{});
                return 2;
            }
            out_dir_arg = args[i];
        } else if (std.mem.startsWith(u8, a, "--out-dir=")) {
            out_dir_arg = a["--out-dir=".len..];
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
            try inputs.append(gpa, a);
        }
    }

    if (inputs.items.len == 0) {
        std.debug.print("optimize: missing <file.glb>\n", .{});
        return 2;
    }
    if (inputs.items.len > 1 and out_arg != null) {
        std.debug.print("optimize: -o/--out takes a single input; use --out-dir for batch\n", .{});
        return 2;
    }
    const spec = preset_spec orelse {
        std.debug.print("optimize: missing --preset <name|path.zon|path.json>\n", .{});
        return 2;
    };

    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    var p = resolvePreset(io, a, spec, &detail) catch |err| switch (err) {
        error.UnknownPreset => {
            std.debug.print("optimize: unknown preset '{s}' (expected mobile/desktop/web, a .zon file or a .json spec)\n", .{spec});
            return 2;
        },
        error.OutOfMemory => return err,
        else => |e| {
            if (detail.len > 0) {
                std.debug.print("optimize: preset '{s}': {s} ('{s}')\n", .{ spec, @errorName(e), detail });
            } else {
                std.debug.print("optimize: preset '{s}': {s}\n", .{ spec, @errorName(e) });
            }
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

    if (inputs.items.len == 1) {
        return runSingle(init, a, inputs.items[0], out_arg, report_arg, p);
    }
    return runBatch(init, a, inputs.items, out_dir_arg, report_arg, p);
}

/// One file: the historical behavior. `out_override` is `-o/--out`, else
/// `<stem>.opt.glb` in the working directory.
fn runSingle(
    init: std.process.Init,
    a: std.mem.Allocator,
    file_path: []const u8,
    out_override: ?[]const u8,
    report_arg: ?[]const u8,
    p: core.preset.Preset,
) !u8 {
    const io = init.io;
    const out_path = out_override orelse blk: {
        const base = std.fs.path.basename(file_path);
        const ext = std.fs.path.extension(base);
        const stem = if (ext.len > 0) base[0 .. base.len - ext.len] else base;
        break :blk try std.fmt.allocPrint(a, "{s}.opt.glb", .{stem});
    };
    if (std.mem.eql(u8, out_path, file_path)) {
        std.debug.print("optimize: refusing to overwrite input {s}\n", .{file_path});
        return 2;
    }

    const rep = core.runner.run(io, a, file_path, .{
        .preset = p,
        .out_path = out_path,
    }) catch |err| {
        reportLoadErr("optimize", file_path, err);
        return 2;
    };

    var stdout_buf: [64 * 1024]u8 = undefined;
    var wtr = std.Io.File.stdout().writer(io, &stdout_buf);
    const w = &wtr.interface;
    try printOptimizeHuman(w, file_path, out_path, p, rep);
    try w.flush();
    warnFailedSteps(file_path, rep);

    if (report_arg) |rp| {
        const doc = try renderSingleReport(a, file_path, out_path, p, rep);
        std.Io.Dir.cwd().writeFile(io, .{ .sub_path = rp, .data = doc }) catch |err| {
            std.debug.print("optimize: report {s}: {s}\n", .{ rp, @errorName(err) });
            return 2;
        };
    }

    return 0;
}

/// A step that ran but failed (the textures could not be encoded, for
/// example) leaves a valid file on disk, but not the one the preset asked
/// for. Say so on stderr: stdout carries the report, stderr carries the
/// warning a script or a human notices.
fn warnFailedSteps(file_path: []const u8, rep: core.runner.Report) void {
    for (rep.steps) |st| {
        if (!st.failed) continue;
        std.debug.print("optimize: {s}: step '{s}' failed ({s}) — the output was written, but not as the preset asked\n", .{ file_path, st.kind, st.note });
    }
}

/// Many files: each runs from its own source into `--out-dir` (or the input's
/// directory) as `<stem>.opt.glb`. Failures are collected and reported, the
/// rest of the batch still runs; the exit code is 0 only when all succeed.
fn runBatch(
    init: std.process.Init,
    a: std.mem.Allocator,
    inputs: []const []const u8,
    out_dir_arg: ?[]const u8,
    report_arg: ?[]const u8,
    p: core.preset.Preset,
) !u8 {
    const io = init.io;
    if (out_dir_arg) |d| {
        std.Io.Dir.cwd().createDirPath(io, d) catch |err| {
            std.debug.print("optimize: out dir {s}: {s}\n", .{ d, @errorName(err) });
            return 2;
        };
    }

    var entries: std.ArrayList([]const u8) = .empty;
    var succeeded: usize = 0;
    var failed: usize = 0;
    var total_secs: f64 = 0;

    var stdout_buf: [64 * 1024]u8 = undefined;
    var wtr = std.Io.File.stdout().writer(io, &stdout_buf);
    const w = &wtr.interface;

    for (inputs) |file_path| {
        const out_path = batchOutPath(a, file_path, out_dir_arg) catch |err| {
            std.debug.print("optimize: {s}: {s}\n", .{ file_path, @errorName(err) });
            try entries.append(a, try renderErrorEntry(a, file_path, @errorName(err)));
            failed += 1;
            continue;
        };
        if (std.mem.eql(u8, out_path, file_path)) {
            std.debug.print("optimize: {s}: refusing to overwrite input\n", .{file_path});
            try entries.append(a, try renderErrorEntry(a, file_path, "OutputIsInput"));
            failed += 1;
            continue;
        }
        const rep = core.runner.run(io, a, file_path, .{
            .preset = p,
            .out_path = out_path,
        }) catch |err| {
            reportLoadErr("optimize", file_path, err);
            try entries.append(a, try renderErrorEntry(a, file_path, @errorName(err)));
            failed += 1;
            continue;
        };
        try printOptimizeHuman(w, file_path, out_path, p, rep);
        warnFailedSteps(file_path, rep);
        try entries.append(a, try renderSingleReport(a, file_path, out_path, p, rep));
        succeeded += 1;
        total_secs += rep.total_secs;
    }
    try w.print("{d} ok, {d} failed\n", .{ succeeded, failed });
    try w.flush();

    if (report_arg) |rp| {
        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        const jw = &aw.writer;
        try jw.print("{{\n  \"count\": {d},\n  \"succeeded\": {d},\n  \"failed\": {d},\n  \"total_secs\": {d:.3},\n  \"files\": [", .{
            inputs.len, succeeded, failed, total_secs,
        });
        for (entries.items, 0..) |doc, idx| {
            if (idx > 0) try jw.writeByte(',');
            try jw.writeByte('\n');
            try jw.writeAll("    ");
            for (doc) |ch| {
                try jw.writeByte(ch);
                if (ch == '\n') try jw.writeAll("    ");
            }
        }
        try jw.writeAll("\n  ]\n}\n");
        std.Io.Dir.cwd().writeFile(io, .{ .sub_path = rp, .data = aw.written() }) catch |err| {
            std.debug.print("optimize: report {s}: {s}\n", .{ rp, @errorName(err) });
            return 2;
        };
    }

    return if (failed == 0) 0 else 2;
}

// ---------------------------------------------------------------------------
// Tests (pure helpers + report shapes; end-to-end runs go through the binary)
// ---------------------------------------------------------------------------

const testing = std.testing;

test "batch out path uses the input dir and the .opt stem" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    try testing.expectEqualStrings("models/box.opt.glb", try batchOutPath(a, "models/box.glb", null));
    try testing.expectEqualStrings("box.opt.glb", try batchOutPath(a, "box.glb", null));
    try testing.expectEqualStrings("/tmp/batch/box.opt.glb", try batchOutPath(a, "models/box.glb", "/tmp/batch"));
    try testing.expectEqualStrings("model.opt.glb", try batchOutPath(a, ".glb", null));
}

test "single report carries secs, total_secs and always texture_images" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const steps = [_]core.runner.StepStatus{
        .{ .kind = "prune", .applied = true, .note = "removed 1 node(s)", .secs = 0.5 },
        .{ .kind = "textures", .applied = true, .note = "encoded 1 image(s)", .secs = 1.25 },
    };
    const images = [_]core.runner.TextureImageOutcome{
        .{ .index = 0, .name = "base", .skipped = false, .format = "uastc" },
    };
    const rep: core.runner.Report = .{
        .steps = &steps,
        .before = .{ .triangles = 100, .vertices = 50, .animations = 2 },
        .after = .{ .triangles = 50, .vertices = 25, .animations = 0 },
        .texture_images = &images,
        .total_secs = 1.75,
    };
    const p = core.preset.platformDefaults(.mobile);
    const doc = try renderSingleReport(a, "in.glb", "out.glb", p, rep);

    var parsed = try std.json.parseFromSlice(std.json.Value, a, doc, .{});
    defer parsed.deinit();
    const o = parsed.value.object;
    try testing.expectApproxEqAbs(@as(f64, 1.75), o.get("total_secs").?.float, 1e-3);
    try testing.expectEqual(@as(usize, 1), o.get("texture_images").?.array.items.len);
    const st = o.get("steps").?.array.items;
    try testing.expect(st[0].object.get("secs") != null);
    try testing.expect(st[1].object.get("images") != null);
    try testing.expect(o.get("deltas").?.object.get("animations") != null);
    try testing.expect(o.get("before") != null);
    try testing.expect(o.get("after") != null);
}

test "single report without overrides still lists empty texture_images" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const steps = [_]core.runner.StepStatus{
        .{ .kind = "prune", .applied = true, .note = "ok", .secs = 0.1 },
    };
    const rep: core.runner.Report = .{
        .steps = &steps,
        .before = .{},
        .after = .{},
        .total_secs = 0.1,
    };
    const p = core.preset.platformDefaults(.desktop);
    const doc = try renderSingleReport(a, "in.glb", "out.glb", p, rep);

    var parsed = try std.json.parseFromSlice(std.json.Value, a, doc, .{});
    defer parsed.deinit();
    const imgs = parsed.value.object.get("texture_images").?.array.items;
    try testing.expectEqual(@as(usize, 0), imgs.len);
}

test "batch error entry is a parseable input/error object" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const doc = try renderErrorEntry(a, "missing.glb", "FileNotFound");
    var parsed = try std.json.parseFromSlice(std.json.Value, a, doc, .{});
    defer parsed.deinit();
    try testing.expectEqualStrings("missing.glb", parsed.value.object.get("input").?.string);
    try testing.expectEqualStrings("FileNotFound", parsed.value.object.get("error").?.string);
}
