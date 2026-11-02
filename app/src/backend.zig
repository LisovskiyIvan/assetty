//! The IPC service bound to the page: file browsing, glTF inspection, the
//! optimize pipeline, texture encoding, diff and lint.
//!
//! Every method is a thin wrapper around an `*Impl` function. The impls take
//! an allocator instead of a `*nanoui.Call`, so tests cover them without a
//! webview. Results that must keep the CLI's JSON shape are returned as
//! `json.Raw` (pre-formatted).
const std = @import("std");
const core = @import("core");
const nanoui = @import("nanoui");
const json = @import("json.zig");
const events = @import("events.zig");

const max_load_bytes: usize = 512 * 1024 * 1024;
const max_text_bytes: usize = 1 << 20;

pub const Backend = struct {
    gpa: std.mem.Allocator,
    io: std.Io,

    pub const nanoui_params = .{
        .listDir = .{"path"},
        .info = .{"path"},
        .loadBytes = .{"path"},
        .optimize = .{ "path", "preset" },
        .textures = .{"path"},
        .textureEncode = .{ "path", "index" },
        .diff = .{ "a", "b" },
        .lint = .{ "path", "budgetJson" },
        .presetLoad = .{"name"},
        .presetSave = .{ "name", "zon" },
    };

    // ---- browse -----------------------------------------------------------

    /// Lists a directory: `{"path":..,"entries":[{"name","dir","size"}]}`.
    pub fn listDir(self: *Backend, call: *nanoui.Call, path: []const u8) !json.Raw {
        return self.listDirImpl(call.arena, path);
    }

    // ---- inspect ----------------------------------------------------------

    /// `assetty info <path> --json`.
    pub fn info(self: *Backend, call: *nanoui.Call, path: []const u8) !json.Raw {
        return self.infoImpl(call.arena, path);
    }

    /// Raw file bytes as base64: `{"size":N,"b64":".."}`.
    pub fn loadBytes(self: *Backend, call: *nanoui.Call, path: []const u8) !json.Raw {
        return self.loadBytesImpl(call.arena, path);
    }

    // ---- pipeline ---------------------------------------------------------

    /// Runs `preset` into `.zig-cache/assetty-app/opt_<ts>.glb`, reporting
    /// each step through the `progress` event; returns the report JSON.
    pub fn optimize(self: *Backend, call: *nanoui.Call, path: []const u8, preset: []const u8) !json.Raw {
        return self.optimizeImpl(call.arena, call.window, path, preset);
    }

    // ---- textures ---------------------------------------------------------

    /// `assetty textures <path> --json`.
    pub fn textures(self: *Backend, call: *nanoui.Call, path: []const u8) !json.Raw {
        return self.texturesImpl(call.arena, path);
    }

    /// `assetty textures <path> --encode <index> --json`.
    pub fn textureEncode(self: *Backend, call: *nanoui.Call, path: []const u8, index: u32) !json.Raw {
        return self.textureEncodeImpl(call.arena, path, index);
    }

    // ---- report -----------------------------------------------------------

    /// `assetty diff <a> <b> --json`.
    pub fn diff(self: *Backend, call: *nanoui.Call, a: []const u8, b: []const u8) !json.Raw {
        return self.diffImpl(call.arena, a, b);
    }

    /// `assetty lint <path> --budget <json> --json`; `budget_json` is either
    /// the budget JSON itself or a path to it.
    pub fn lint(self: *Backend, call: *nanoui.Call, path: []const u8, budget_json: []const u8) !json.Raw {
        return self.lintImpl(call.arena, path, budget_json);
    }

    // ---- presets ----------------------------------------------------------

    /// Preset names found in `presets/*.zon`, sorted.
    pub fn presets(self: *Backend, call: *nanoui.Call) ![]const []const u8 {
        return self.presetsImpl(call.arena);
    }

    /// The `.zon` text of `presets/<name>.zon`.
    pub fn presetLoad(self: *Backend, call: *nanoui.Call, name: []const u8) ![]const u8 {
        return self.presetLoadImpl(call.arena, name);
    }

    /// Writes `presets/<name>.zon`; true on success.
    pub fn presetSave(self: *Backend, call: *nanoui.Call, name: []const u8, zon: []const u8) !bool {
        return self.presetSaveImpl(call.arena, name, zon);
    }

    // ---- implementations --------------------------------------------------

    fn listDirImpl(self: *Backend, a: std.mem.Allocator, path: []const u8) !json.Raw {
        const dir_path = if (path.len == 0) "." else path;
        var dir = std.Io.Dir.cwd().openDir(self.io, dir_path, .{ .iterate = true }) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ dir_path, @errorName(err) });
        defer dir.close(self.io);

        const Entry = struct { name: []const u8, dir: bool, size: u64 };
        var entries: std.ArrayList(Entry) = .empty;
        var it = dir.iterate();
        while (it.next(self.io) catch |err| return json.errorRaw(a, "{s}: {s}", .{ dir_path, @errorName(err) })) |e| {
            const is_dir = e.kind == .directory;
            var size: u64 = 0;
            if (!is_dir) {
                if (dir.statFile(self.io, e.name, .{})) |st| size = st.size else |_| {}
            }
            try entries.append(a, .{ .name = try a.dupe(u8, e.name), .dir = is_dir, .size = size });
        }
        std.mem.sort(Entry, entries.items, {}, struct {
            fn lt(_: void, x: Entry, y: Entry) bool {
                if (x.dir != y.dir) return x.dir;
                return std.mem.lessThan(u8, x.name, y.name);
            }
        }.lt);

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        const w = &aw.writer;
        try w.writeAll("{\"path\":");
        try json.jsonStr(w, dir_path);
        try w.writeAll(",\"entries\":[");
        for (entries.items, 0..) |e, i| {
            if (i > 0) try w.writeByte(',');
            try w.writeAll("{\"name\":");
            try json.jsonStr(w, e.name);
            try w.print(",\"dir\":{s},\"size\":{d}}}", .{ if (e.dir) "true" else "false", e.size });
        }
        try w.writeAll("]}");
        return json.raw(try aw.toOwnedSlice());
    }

    fn infoImpl(self: *Backend, a: std.mem.Allocator, path: []const u8) !json.Raw {
        var loaded = core.parse.loadFile(self.io, a, path) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        defer loaded.deinit();
        const st = core.stats.compute(a, loaded.asset) catch |err|
            return json.errorRaw(a, "stats {s}: {s}", .{ path, @errorName(err) });

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        try json.writeInfo(&aw.writer, path, loaded.asset, st);
        return json.raw(try aw.toOwnedSlice());
    }

    fn loadBytesImpl(self: *Backend, a: std.mem.Allocator, path: []const u8) !json.Raw {
        const bytes = std.Io.Dir.cwd().readFileAlloc(self.io, path, a, .limited(max_load_bytes)) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });

        const b64 = try a.alloc(u8, std.base64.standard.Encoder.calcSize(bytes.len));
        const encoded = std.base64.standard.Encoder.encode(b64, bytes);

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        const w = &aw.writer;
        try w.print("{{\"size\":{d},\"b64\":\"{s}\"}}", .{ bytes.len, encoded });
        return json.raw(try aw.toOwnedSlice());
    }

    const ProgressCtx = struct {
        window: ?*nanoui.Window,

        fn report(ctx: ?*anyopaque, step: []const u8, pct: f32) void {
            const self: *ProgressCtx = @ptrCast(@alignCast(ctx orelse return));
            const win = self.window orelse return;
            events.Progress.emit(win, .{ .step = step, .pct = pct });
        }
    };

    fn optimizeImpl(
        self: *Backend,
        a: std.mem.Allocator,
        window: ?*nanoui.Window,
        path: []const u8,
        preset_spec: []const u8,
    ) !json.Raw {
        const p = resolvePreset(self.io, a, preset_spec) catch |err| switch (err) {
            error.UnknownPreset => return json.errorRaw(a, "unknown preset '{s}'", .{preset_spec}),
            else => return json.errorRaw(a, "preset '{s}': {s}", .{ preset_spec, @errorName(err) }),
        };

        const nanos: u64 = @intCast(@max(0, std.Io.Clock.real.now(self.io).nanoseconds));
        const out_path = std.fmt.allocPrint(a, ".zig-cache/assetty-app/opt_{d}.glb", .{nanos}) catch
            return json.errorRaw(a, "out of memory", .{});
        std.Io.Dir.cwd().createDirPath(self.io, ".zig-cache/assetty-app") catch |err|
            return json.errorRaw(a, "out dir: {s}", .{@errorName(err)});

        var ctx: ProgressCtx = .{ .window = window };
        const rep = core.runner.run(self.io, a, path, .{
            .preset = p,
            .out_path = out_path,
            .progress = &ProgressCtx.report,
            .progress_ctx = &ctx,
        }) catch |err| {
            if (window) |win| {
                const line = try std.fmt.allocPrint(a, "optimize failed: {s}: {s}", .{ path, @errorName(err) });
                events.Log.emit(win, .{ .line = line });
            }
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        };
        if (window) |win| {
            const line = try std.fmt.allocPrint(a, "optimize \"{s}\" -> {s}", .{ p.name, out_path });
            events.Log.emit(win, .{ .line = line });
        }

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        try json.writeOptimize(&aw.writer, path, out_path, p, rep);
        return json.raw(try aw.toOwnedSlice());
    }

    fn texturesImpl(self: *Backend, a: std.mem.Allocator, path: []const u8) !json.Raw {
        var loaded = core.parse.loadFile(self.io, a, path) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        defer loaded.deinit();
        const st = core.stats.compute(a, loaded.asset) catch |err|
            return json.errorRaw(a, "stats {s}: {s}", .{ path, @errorName(err) });

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        try json.writeTextures(&aw.writer, path, loaded.asset, st, null, null);
        return json.raw(try aw.toOwnedSlice());
    }

    fn textureEncodeImpl(self: *Backend, a: std.mem.Allocator, path: []const u8, index: u32) !json.Raw {
        var loaded = core.parse.loadFile(self.io, a, path) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        defer loaded.deinit();
        if (index >= loaded.asset.images.len)
            return json.errorRaw(a, "image {d} out of range ({d} images)", .{ index, loaded.asset.images.len });
        const st = core.stats.compute(a, loaded.asset) catch |err|
            return json.errorRaw(a, "stats {s}: {s}", .{ path, @errorName(err) });

        const enc = encodeImage(a, loaded.asset.images[index], index) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => null,
        };

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        try json.writeTextures(&aw.writer, path, loaded.asset, st, index, enc);
        return json.raw(try aw.toOwnedSlice());
    }

    fn diffImpl(self: *Backend, a: std.mem.Allocator, old_path: []const u8, new_path: []const u8) !json.Raw {
        var old = core.parse.loadFile(self.io, a, old_path) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ old_path, @errorName(err) });
        defer old.deinit();
        var new = core.parse.loadFile(self.io, a, new_path) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ new_path, @errorName(err) });
        defer new.deinit();

        const rep = core.diff.compare(a, old.asset, new.asset) catch |err|
            return json.errorRaw(a, "diff: {s}", .{@errorName(err)});

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        try core.diff.reportJson(&aw.writer, rep);
        return json.raw(try aw.toOwnedSlice());
    }

    fn lintImpl(self: *Backend, a: std.mem.Allocator, path: []const u8, budget_json: []const u8) !json.Raw {
        const trimmed = std.mem.trimStart(u8, budget_json, " \t\r\n");
        const bytes = if (std.mem.startsWith(u8, trimmed, "{"))
            trimmed
        else
            std.Io.Dir.cwd().readFileAlloc(self.io, budget_json, a, .limited(max_text_bytes)) catch |err|
                return json.errorRaw(a, "budget {s}: {s}", .{ budget_json, @errorName(err) });

        var budget = core.lint.parseBudget(a, bytes) catch
            return json.errorRaw(a, "invalid budget", .{});
        defer budget.deinit(a);

        var loaded = core.parse.loadFile(self.io, a, path) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        defer loaded.deinit();
        const st = core.stats.compute(a, loaded.asset) catch |err|
            return json.errorRaw(a, "stats {s}: {s}", .{ path, @errorName(err) });
        const vs = core.lint.check(a, st, budget) catch |err|
            return json.errorRaw(a, "lint: {s}", .{@errorName(err)});

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        try json.writeLint(&aw.writer, path, vs);
        return json.raw(try aw.toOwnedSlice());
    }

    fn presetsImpl(self: *Backend, a: std.mem.Allocator) ![]const []const u8 {
        var names: std.ArrayList([]const u8) = .empty;
        var dir = std.Io.Dir.cwd().openDir(self.io, "presets", .{ .iterate = true }) catch return &.{};
        defer dir.close(self.io);
        var it = dir.iterate();
        while (it.next(self.io) catch null) |e| {
            if (e.kind != .file and e.kind != .sym_link) continue;
            if (!std.mem.endsWith(u8, e.name, ".zon")) continue;
            const stem = e.name[0 .. e.name.len - ".zon".len];
            if (!validPresetName(stem)) continue;
            try names.append(a, try a.dupe(u8, stem));
        }
        std.mem.sort([]const u8, names.items, {}, struct {
            fn lt(_: void, x: []const u8, y: []const u8) bool {
                return std.mem.lessThan(u8, x, y);
            }
        }.lt);
        return names.items;
    }

    fn presetLoadImpl(self: *Backend, a: std.mem.Allocator, name: []const u8) ![]const u8 {
        if (!validPresetName(name)) return error.InvalidPresetName;
        var buf: [128]u8 = undefined;
        const path = try std.fmt.bufPrint(&buf, "presets/{s}.zon", .{name});
        return std.Io.Dir.cwd().readFileAlloc(self.io, path, a, .limited(max_text_bytes)) catch |err| switch (err) {
            error.OutOfMemory => error.OutOfMemory,
            else => error.PresetNotFound,
        };
    }

    fn presetSaveImpl(self: *Backend, a: std.mem.Allocator, name: []const u8, zon: []const u8) !bool {
        _ = a;
        if (!validPresetName(name)) return error.InvalidPresetName;
        var buf: [128]u8 = undefined;
        const path = try std.fmt.bufPrint(&buf, "presets/{s}.zon", .{name});
        std.Io.Dir.cwd().writeFile(self.io, .{ .sub_path = path, .data = zon }) catch return false;
        return true;
    }
};

fn validPresetName(name: []const u8) bool {
    if (name.len == 0 or name.len > 64) return false;
    for (name) |ch| {
        if (!std.ascii.isAlphanumeric(ch) and ch != '_' and ch != '-') return false;
    }
    return true;
}

/// Bare name -> `presets/<name>.zon`, then `test/<name>.zon`, then a built-in
/// platform default (same order as the CLI).
fn resolvePreset(io: std.Io, a: std.mem.Allocator, spec: []const u8) !core.preset.Preset {
    if (std.mem.indexOfScalar(u8, spec, '/') != null or std.mem.endsWith(u8, spec, ".zon")) {
        return core.preset.loadFile(io, a, spec);
    }
    var buf: [256]u8 = undefined;
    const path = core.preset.defaultPath(spec, &buf);
    if (path.len > 0) {
        if (core.preset.loadFile(io, a, path)) |p| return p else |_| {}
    }
    var test_buf: [256]u8 = undefined;
    const test_path = std.fmt.bufPrint(&test_buf, "test/{s}.zon", .{spec}) catch "";
    if (test_path.len > 0) {
        if (core.preset.loadFile(io, a, test_path)) |p| return p else |_| {}
    }
    const target = std.meta.stringToEnum(core.preset.Target, spec) orelse return error.UnknownPreset;
    return core.preset.platformDefaults(target);
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
    return @as(u32, 32 - @clz(m)) + 1;
}

/// Decode image `idx` to RGBA, encode to KTX2, decode back, measure PSNR.
/// Null when the image is not decodable (external/unsupported).
fn encodeImage(a: std.mem.Allocator, img: core.model.Image, idx: u32) !?json.EncodeResult {
    const bytes = img.data orelse return null;
    const dec = core.decode.decodeRgba(a, bytes) orelse return null;

    const is_normal = if (img.name) |n| containsIgnoreCase(n, "normal") else false;
    const opts: core.encode_ktx.Options = .{ .normal_map = is_normal };

    const out = try core.encode_ktx.encode(a, dec.pixels, dec.width, dec.height, opts);
    const rt = try core.encode_ktx.decodeToRgba(a, out.ktx2);
    if (rt.width != dec.width or rt.height != dec.height) return null;

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

// ---- tests ----------------------------------------------------------------

const testing = std.testing;

fn testBackend() Backend {
    return .{ .gpa = testing.allocator, .io = testing.io };
}

test "info impl matches the CLI json shape" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.infoImpl(arena.allocator(), "test/fixtures/box.glb");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"container\": \"glb\"") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"triangles\":") != null);
}

test "info impl reports load errors as json" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.infoImpl(arena.allocator(), "test/fixtures/nope.glb");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"error\"") != null);
}

test "listDir impl lists and sorts entries" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.listDirImpl(arena.allocator(), "presets");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"name\":\"desktop.zon\"") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"dir\":false") != null);
}

test "presets impl returns preset names" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const names = try b.presetsImpl(arena.allocator());
    try testing.expect(names.len >= 3);
    try testing.expectEqualStrings("desktop", names[0]);
}

test "presetLoad impl rejects traversal" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    try testing.expectError(error.InvalidPresetName, b.presetLoadImpl(arena.allocator(), "../build"));
}

test "optimize impl runs a preset and reports deltas" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.optimizeImpl(arena.allocator(), null, "test/fixtures/box.glb", "noop");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"steps\": [") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"deltas\":") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"output\": \".zig-cache/assetty-app/opt_") != null);
}

test "textures impl on a fixture" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.texturesImpl(arena.allocator(), "test/fixtures/box.glb");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"images\": [") != null);
}

test "diff impl matches the CLI report" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.diffImpl(arena.allocator(), "test/fixtures/box.glb", "test/fixtures/box.glb");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"nodes\":") != null);
}

test "lint impl accepts inline budget json" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.lintImpl(arena.allocator(), "test/fixtures/box.glb", "{\"max_triangles\": 1}");
    try testing.expect(std.mem.indexOf(u8, r.text, "max_triangles") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"total\": 1") != null);
}

test "loadBytes impl returns base64" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.loadBytesImpl(arena.allocator(), "test/fixtures/box.glb");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"size\":") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"b64\":\"") != null);
}
