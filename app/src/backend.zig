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
        .openDialog = .{},
        .listDir = .{"path"},
        .info = .{"path"},
        .loadBytes = .{"path"},
        .optimize = .{ "path", "preset" },
        .optimizeCustom = .{ "path", "spec" },
        .textures = .{"path"},
        .textureEncode = .{ "path", "index" },
        .diff = .{ "a", "b" },
        .lint = .{ "path", "budgetJson" },
        .presetLoad = .{"name"},
        .presetSave = .{ "name", "zon" },
    };

    // ---- browse -----------------------------------------------------------

    /// Native open panel: `{"path":"<abs>"}` on a pick, `{"path":null}` on
    /// cancel. Runs modally on the main thread, like every bound method.
    pub fn openDialog(self: *Backend, call: *nanoui.Call) !json.Raw {
        return self.openDialogImpl(call.arena);
    }

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

    /// Same pipeline as `optimize`, but the steps come from the frontend's
    /// per-step UI as a JSON spec (`{"steps":[{"prune":{}}, ...]}`); the spec
    /// is either that JSON text or a JSON string containing it.
    pub fn optimizeCustom(self: *Backend, call: *nanoui.Call, path: []const u8, spec: []const u8) !json.Raw {
        return self.optimizeCustomImpl(call.arena, call.window, path, spec);
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

    fn openDialogImpl(self: *Backend, a: std.mem.Allocator) !json.Raw {
        // nanoui's dialog module owns the NSOpenPanel: NSOpenPanel on macOS,
        // the desktop portal on Linux, the common item dialog on Windows. It
        // is documented for use from a bound method (main thread, runModal).
        const paths = nanoui.dialog.open(self.gpa, .{
            .title = "Open model",
            .extensions = &.{ "glb", "gltf" },
        }) catch null;
        defer {
            if (paths) |p| nanoui.dialog.freePaths(self.gpa, p);
        }
        const picked: ?[]const u8 = if (paths) |p| (if (p.len > 0) p[0] else null) else null;
        return pathResultRaw(a, picked);
    }

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
        return self.runPipeline(a, window, path, p);
    }

    fn optimizeCustomImpl(
        self: *Backend,
        a: std.mem.Allocator,
        window: ?*nanoui.Window,
        path: []const u8,
        spec: []const u8,
    ) !json.Raw {
        var detail: []const u8 = "";
        const p = customPresetFromSpec(a, spec, &detail) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            error.NoSteps => return json.errorRaw(a, "no steps", .{}),
            error.UnknownStep => return json.errorRaw(a, "unknown step '{s}'", .{detail}),
            error.BadParam => return json.errorRaw(a, "bad params for '{s}'", .{detail}),
            error.InvalidSpec => return json.errorRaw(a, "invalid spec", .{}),
        };
        return self.runPipeline(a, window, path, p);
    }

    /// The shared tail of `optimize`/`optimizeCustom`: run `p` into
    /// `.zig-cache/assetty-app/opt_<ts>.glb`, report progress, format the JSON.
    fn runPipeline(
        self: *Backend,
        a: std.mem.Allocator,
        window: ?*nanoui.Window,
        path: []const u8,
        p: core.preset.Preset,
    ) !json.Raw {
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

/// `{"path":"<abs>"}` or `{"path":null}`: the `openDialog` reply.
fn pathResultRaw(a: std.mem.Allocator, path: ?[]const u8) !json.Raw {
    var aw: std.Io.Writer.Allocating = .init(a);
    errdefer aw.deinit();
    try aw.writer.writeAll("{\"path\":");
    try json.jsonStrOpt(&aw.writer, path);
    try aw.writer.writeByte('}');
    return json.raw(try aw.toOwnedSlice());
}

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

// ---- custom step specs ----------------------------------------------------

const SpecError = error{ OutOfMemory, InvalidSpec, NoSteps, UnknownStep, BadParam };

/// Canonical execution order: a spec may list its steps in any order.
const step_order = [_]core.preset.StepKind{
    .prune, .dedup, .weld, .join, .textures, .quantize, .simplify,
};

fn isStepName(name: []const u8) bool {
    for (step_order) |kind| {
        if (std.mem.eql(u8, name, @tagName(kind))) return true;
    }
    return false;
}

/// Build a preset from the frontend's per-step JSON spec. `spec` is either the
/// JSON text itself (`{"steps":[...]}`) or a JSON string holding that text
/// (`"{\"steps\":[...]}"`), whichever form the bridge delivers. `detail`
/// receives the offending step name for `UnknownStep`/`BadParam`.
fn customPresetFromSpec(
    a: std.mem.Allocator,
    spec: []const u8,
    detail: *[]const u8,
) SpecError!core.preset.Preset {
    const text = std.mem.trim(u8, spec, " \t\r\n");
    if (text.len == 0) return error.NoSteps;

    if (text[0] == '"') {
        // A JSON string value: unwrap it and parse the text it contains.
        var outer = std.json.parseFromSlice(std.json.Value, a, text, .{}) catch
            return error.InvalidSpec;
        defer outer.deinit();
        const inner = switch (outer.value) {
            .string => |s| std.mem.trim(u8, s, " \t\r\n"),
            else => return error.InvalidSpec,
        };
        if (inner.len == 0) return error.NoSteps;
        var parsed = std.json.parseFromSlice(std.json.Value, a, inner, .{}) catch
            return error.InvalidSpec;
        defer parsed.deinit();
        return presetFromSpecValue(a, parsed.value, detail);
    }

    var parsed = std.json.parseFromSlice(std.json.Value, a, text, .{}) catch
        return error.InvalidSpec;
    defer parsed.deinit();
    return presetFromSpecValue(a, parsed.value, detail);
}

fn presetFromSpecValue(
    a: std.mem.Allocator,
    v: std.json.Value,
    detail: *[]const u8,
) SpecError!core.preset.Preset {
    const obj = switch (v) {
        .object => |o| o,
        else => return error.InvalidSpec,
    };
    const raw_steps = obj.get("steps") orelse return error.NoSteps;
    const items = switch (raw_steps) {
        .array => |arr| arr.items,
        else => return error.InvalidSpec,
    };
    if (items.len == 0) return error.NoSteps;

    // Validate every entry up front so an unknown kind is reported with its
    // name instead of failing halfway through an ordered build.
    for (items) |item| {
        const fields = switch (item) {
            .object => |o| o,
            else => return error.InvalidSpec,
        };
        var seen = false;
        var it = fields.iterator();
        while (it.next()) |entry| {
            if (!isStepName(entry.key_ptr.*)) {
                detail.* = try a.dupe(u8, entry.key_ptr.*);
                return error.UnknownStep;
            }
            seen = true;
        }
        if (!seen) {
            detail.* = "step";
            return error.UnknownStep;
        }
    }

    const steps = try a.alloc(core.preset.Step, items.len);
    var n: usize = 0;
    for (step_order) |kind| {
        for (items) |item| {
            const params = item.object.get(@tagName(kind)) orelse continue;
            steps[n] = try stepFromSpec(kind, params, detail);
            n += 1;
        }
    }
    return .{ .name = "custom", .target = .desktop, .steps = steps[0..n] };
}

/// Typed readers over one step's params object. Omitted fields yield `null`,
/// which the caller turns into the param struct's own default.
const SpecParams = struct {
    kind: core.preset.StepKind,
    fields: ?std.json.ObjectMap,
    detail: *[]const u8,

    fn bad(self: *SpecParams) SpecError {
        self.detail.* = @tagName(self.kind);
        return error.BadParam;
    }

    fn get(self: *SpecParams, name: []const u8) ?std.json.Value {
        const fields = self.fields orelse return null;
        return fields.get(name);
    }

    fn boolField(self: *SpecParams, name: []const u8) SpecError!?bool {
        return switch (self.get(name) orelse return null) {
            .bool => |b| b,
            else => self.bad(),
        };
    }

    fn intField(self: *SpecParams, comptime T: type, name: []const u8) SpecError!?T {
        return switch (self.get(name) orelse return null) {
            .integer => |i| std.math.cast(T, i) orelse self.bad(),
            else => self.bad(),
        };
    }

    fn floatField(self: *SpecParams, name: []const u8) SpecError!?f32 {
        return switch (self.get(name) orelse return null) {
            .float => |f| std.math.lossyCast(f32, f),
            .integer => |i| @floatFromInt(i),
            else => self.bad(),
        };
    }

    /// `"auto"`/`"etc1s"`/`"uastc"` (and the other preset formats); anything
    /// unrecognised falls back to `.auto`.
    fn formatField(self: *SpecParams, name: []const u8) SpecError!?core.preset.TextureFormat {
        const s = switch (self.get(name) orelse return null) {
            .string => |s| s,
            else => return self.bad(),
        };
        return std.meta.stringToEnum(core.preset.TextureFormat, s) orelse .auto;
    }
};

fn stepFromSpec(
    kind: core.preset.StepKind,
    v: std.json.Value,
    detail: *[]const u8,
) SpecError!core.preset.Step {
    var r: SpecParams = .{ .kind = kind, .fields = null, .detail = detail };
    switch (v) {
        .object => |o| r.fields = o,
        .null => {}, // `{"prune": null}` == `{"prune": {}}`
        else => {
            detail.* = @tagName(kind);
            return error.BadParam;
        },
    }

    return switch (kind) {
        .prune => blk: {
            const d = core.preset.PruneParams{};
            break :blk .{ .prune = .{
                .unused_nodes = (try r.boolField("unused_nodes")) orelse d.unused_nodes,
                .unused_materials = (try r.boolField("unused_materials")) orelse d.unused_materials,
                .unused_textures = (try r.boolField("unused_textures")) orelse d.unused_textures,
            } };
        },
        .dedup => blk: {
            const d = core.preset.DedupParams{};
            break :blk .{ .dedup = .{
                .accessors = (try r.boolField("accessors")) orelse d.accessors,
                .meshes = (try r.boolField("meshes")) orelse d.meshes,
                .materials = (try r.boolField("materials")) orelse d.materials,
            } };
        },
        .weld => blk: {
            const d = core.preset.WeldParams{};
            break :blk .{ .weld = .{
                .tolerance = (try r.floatField("tolerance")) orelse d.tolerance,
            } };
        },
        .join => .{ .join = .{} },
        .textures => blk: {
            const d = core.preset.TextureParams{};
            break :blk .{ .textures = .{
                .format = (try r.formatField("format")) orelse d.format,
                .quality = (try r.intField(u8, "quality")) orelse d.quality,
                .rdo_lambda = (try r.floatField("rdo_lambda")) orelse d.rdo_lambda,
                .normal_maps_renormalize = (try r.boolField("normal_maps_renormalize")) orelse d.normal_maps_renormalize,
                .generate_mips = (try r.boolField("generate_mips")) orelse d.generate_mips,
                .max_size = (try r.intField(u32, "max_size")) orelse d.max_size,
            } };
        },
        .quantize => blk: {
            const d = core.preset.QuantizeParams{};
            break :blk .{ .quantize = .{
                .position_bits = (try r.intField(u5, "position_bits")) orelse d.position_bits,
                .normal_oct = (try r.boolField("normal_oct")) orelse d.normal_oct,
                .uv_bits = (try r.intField(u5, "uv_bits")) orelse d.uv_bits,
                .compress = (try r.boolField("compress")) orelse d.compress,
            } };
        },
        .simplify => blk: {
            const d = core.preset.SimplifyParams{};
            break :blk .{ .simplify = .{
                .target_ratio = (try r.floatField("target_ratio")) orelse d.target_ratio,
                .error_tolerance = (try r.floatField("error_tolerance")) orelse d.error_tolerance,
                .aggressive = (try r.boolField("aggressive")) orelse d.aggressive,
                .lock_borders = (try r.boolField("lock_borders")) orelse d.lock_borders,
            } };
        },
    };
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

test "openDialog json shape for pick and cancel" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const picked = try pathResultRaw(a, "/tmp/models/box.glb");
    try testing.expectEqualStrings("{\"path\":\"/tmp/models/box.glb\"}", picked.text);

    const canceled = try pathResultRaw(a, null);
    try testing.expectEqualStrings("{\"path\":null}", canceled.text);

    // Escapes go through json.jsonStrOpt.
    const weird = try pathResultRaw(a, "/tmp/a\"b.glb");
    try testing.expectEqualStrings("{\"path\":\"/tmp/a\\\"b.glb\"}", weird.text);
}

// ---- custom step specs ----------------------------------------------------

fn specKinds(p: core.preset.Preset, buf: *[16]core.preset.StepKind) []const core.preset.StepKind {
    for (p.steps, 0..) |s, i| buf[i] = std.meta.activeTag(s);
    return buf[0..p.steps.len];
}

test "custom spec maps steps in canonical order with params" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();

    const spec =
        \\{"steps":[
        \\  {"simplify":{"target_ratio":0.25,"aggressive":true}},
        \\  {"textures":{"format":"uastc","quality":160,"max_size":2048}},
        \\  {"weld":{"tolerance":0.25}},
        \\  {"prune":{}}
        \\]}
    ;

    var detail: []const u8 = "";
    const p = try customPresetFromSpec(arena.allocator(), spec, &detail);

    try testing.expectEqualStrings("custom", p.name);
    try testing.expectEqual(core.preset.Target.desktop, p.target);
    try testing.expectEqual(@as(usize, 4), p.steps.len);

    var kinds_buf: [16]core.preset.StepKind = undefined;
    try testing.expectEqualSlices(core.preset.StepKind, &.{
        .prune, .weld, .textures, .simplify,
    }, specKinds(p, &kinds_buf));

    // Explicit values land on the right fields.
    try testing.expectEqual(@as(f32, 0.25), p.steps[1].weld.tolerance);
    try testing.expectEqual(core.preset.TextureFormat.uastc, p.steps[2].textures.format);
    try testing.expectEqual(@as(u8, 160), p.steps[2].textures.quality);
    try testing.expectEqual(@as(u32, 2048), p.steps[2].textures.max_size);
    try testing.expectEqual(@as(f32, 0.25), p.steps[3].simplify.target_ratio);
    try testing.expect(p.steps[3].simplify.aggressive);

    // Omitted params keep the preset.zig defaults.
    const defaults = core.preset.PruneParams{};
    try testing.expectEqual(defaults.unused_nodes, p.steps[0].prune.unused_nodes);
    try testing.expectEqual(defaults.unused_materials, p.steps[0].prune.unused_materials);
    try testing.expectEqual(defaults.unused_textures, p.steps[0].prune.unused_textures);
    const tex_defaults = core.preset.TextureParams{};
    try testing.expectEqual(tex_defaults.rdo_lambda, p.steps[2].textures.rdo_lambda);
    try testing.expectEqual(tex_defaults.generate_mips, p.steps[2].textures.generate_mips);
    try testing.expectEqual(tex_defaults.normal_maps_renormalize, p.steps[2].textures.normal_maps_renormalize);
    const simp_defaults = core.preset.SimplifyParams{};
    try testing.expectEqual(simp_defaults.error_tolerance, p.steps[3].simplify.error_tolerance);
    try testing.expectEqual(simp_defaults.lock_borders, p.steps[3].simplify.lock_borders);
}

test "custom spec accepts a json string value" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // The bridge may hand over `spec` already encoded as a JSON string.
    const inner = "{\"steps\":[{\"dedup\":{\"meshes\":false}},{\"join\":{}}]}";
    var buf: [256]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(inner, .{}, &w);

    var detail: []const u8 = "";
    const p = try customPresetFromSpec(a, w.buffered(), &detail);
    try testing.expectEqual(@as(usize, 2), p.steps.len);
    try testing.expect(!p.steps[0].dedup.meshes);
    try testing.expect(p.steps[0].dedup.accessors);
    try testing.expectEqual(core.preset.StepKind.dedup, std.meta.activeTag(p.steps[0]));
    try testing.expectEqual(core.preset.StepKind.join, std.meta.activeTag(p.steps[1]));
}

test "custom spec rejects unknown step kinds by name" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    try testing.expectError(
        error.UnknownStep,
        customPresetFromSpec(a, "{\"steps\":[{\"bperfume\":{}}]}", &detail),
    );
    try testing.expect(std.mem.indexOf(u8, detail, "bperfume") != null);

    var b = testBackend();
    const r = try b.optimizeCustomImpl(a, null, "test/fixtures/box.glb", "{\"steps\":[{\"bperfume\":{}}]}");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"error\"") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "unknown") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "bperfume") != null);
}

test "custom spec rejects empty and malformed specs" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    try testing.expectError(error.NoSteps, customPresetFromSpec(a, "{\"steps\":[]}", &detail));
    try testing.expectError(error.NoSteps, customPresetFromSpec(a, "{}", &detail));
    try testing.expectError(error.NoSteps, customPresetFromSpec(a, "   ", &detail));
    try testing.expectError(error.InvalidSpec, customPresetFromSpec(a, "not json", &detail));
    try testing.expectError(error.InvalidSpec, customPresetFromSpec(a, "[1,2]", &detail));

    var b = testBackend();
    const empty = try b.optimizeCustomImpl(a, null, "test/fixtures/box.glb", "{\"steps\":[]}");
    try testing.expectEqualStrings("{\"error\":\"no steps\"}", empty.text);
}

test "custom spec rejects bad params by step name" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    // Wrong type.
    try testing.expectError(
        error.BadParam,
        customPresetFromSpec(a, "{\"steps\":[{\"textures\":{\"quality\":\"high\"}}]}", &detail),
    );
    try testing.expectEqualStrings("textures", detail);

    // Out of range for u5.
    try testing.expectError(
        error.BadParam,
        customPresetFromSpec(a, "{\"steps\":[{\"quantize\":{\"uv_bits\":99}}]}", &detail),
    );
    try testing.expectEqualStrings("quantize", detail);

    // Unknown texture format strings fall back to .auto, not an error.
    const p = try customPresetFromSpec(
        a,
        "{\"steps\":[{\"textures\":{\"format\":\"bogus\"}}]}",
        &detail,
    );
    try testing.expectEqual(core.preset.TextureFormat.auto, p.steps[0].textures.format);
}

test "optimizeCustom runs the full pipeline and writes a parseable glb" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    const r = try b.optimizeCustomImpl(
        a,
        null,
        "test/fixtures/box.glb",
        "{\"steps\":[{\"quantize\":{}},{\"dedup\":{}}]}",
    );
    try testing.expect(std.mem.indexOf(u8, r.text, "\"error\"") == null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"preset\": \"custom\"") != null);
    // Canonical order regardless of the spec's order.
    const dedup_at = std.mem.indexOf(u8, r.text, "{\"kind\": \"dedup\"") orelse
        return error.TestUnexpectedResult;
    const quant_at = std.mem.indexOf(u8, r.text, "{\"kind\": \"quantize\"") orelse
        return error.TestUnexpectedResult;
    try testing.expect(dedup_at < quant_at);

    const Report = struct { output: []const u8 };
    const parsed = try std.json.parseFromSlice(Report, a, r.text, .{ .ignore_unknown_fields = true });
    defer parsed.deinit();

    var out = core.parse.loadFile(testing.io, a, parsed.value.output) catch |err| {
        std.debug.print("custom optimize output '{s}' unreadable: {s}\n", .{ parsed.value.output, @errorName(err) });
        return error.TestUnexpectedResult;
    };
    defer out.deinit();
    try testing.expect(out.asset.meshes.len > 0);
}
