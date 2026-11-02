//! The IPC service bound to the page: file browsing, glTF inspection, the
//! optimize pipeline, texture encoding, diff and lint.
//!
//! Every method is a thin wrapper around an `*Impl` function. The impls take
//! an allocator instead of a `*nanoui.Call`, so tests cover them without a
//! webview. Results that must keep the CLI's JSON shape are returned as
//! `json.Raw` (pre-formatted).
//!
//! # Long jobs
//!
//! Bound methods run on the main thread, so anything that takes seconds
//! (basisu, meshopt) would freeze the webview. `optimize`, `optimizeCustom`,
//! `textureEncode` and `texturePreview` therefore only validate their
//! arguments, hand the work to a worker thread and answer `{"started":true}`;
//! the result arrives as the `optimizeDone` / `textureEncodeDone` /
//! `texturePreviewDone` event. See "background jobs" below.
const std = @import("std");
const core = @import("core");
const nanoui = @import("nanoui");
const json = @import("json.zig");
const events = @import("events.zig");

const max_load_bytes: usize = 512 * 1024 * 1024;
const max_text_bytes: usize = 1 << 20;

/// Allocator for everything a background job owns across threads: the `Job`
/// struct, its path/preset copies, the per-run arena (weld keys, decoded
/// pixels), report buffers and the messages posted to the main thread.
///
/// `init.gpa` is the debug `std.heap.SafeAllocator` (leak-checking), and a job
/// is deliberately *not* waited for at exit: the detached worker can still be
/// halfway through a basisu encode while the process is already tearing down,
/// so every allocation it holds at that moment would be reported as a leak.
/// `c_allocator` is thread-safe, has no leak checker and needs no teardown
/// ordering, which is exactly what a fire-and-forget worker wants.
const job_gpa: std.mem.Allocator = std.heap.c_allocator;

/// Longest side of the PNG a `texturePreview` event carries. The IPC message
/// is a single JS string (base64 PNG); 1024 keeps it around a megabyte even
/// for photos, which is what the preview pane shows anyway.
const preview_max_dim: u32 = 1024;

/// Where the app drops its outputs, relative to the working directory.
const out_dir = ".zig-cache/assetty-app";

/// File name the save panel starts with when the caller suggests none.
const default_save_name = "model.opt.glb";

/// Opaque, frontend-owned settings file. The backend never interprets the
/// JSON inside: any object the UI wants (theme, optimize defaults, ...) goes
/// here, and loading/saving is all this file does.
const settings_file = "assetty.settings.json";

pub const Backend = struct {
    gpa: std.mem.Allocator,
    io: std.Io,
    /// The background run in flight, if any: `optimize`/`optimizeCustom` and
    /// `textureEncode` share this one gate.
    job: ?*Job = null,
    /// previews gate separately from pipeline jobs
    preview_job: ?*Job = null,
    job_lock: Gate = .{},
    /// Test seam: receives a finished job instead of the main-thread queue.
    on_job_done: ?*const fn (ctx: ?*anyopaque, job: *Job) void = null,
    on_job_done_ctx: ?*anyopaque = null,

    pub const nanoui_params = .{
        .openDialog = .{},
        .pickSavePath = .{"name"},
        .exportTo = .{ "src", "dst" },
        .listDir = .{"path"},
        .info = .{"path"},
        .loadBytes = .{"path"},
        .optimize = .{ "path", "preset" },
        .optimizeCustom = .{ "path", "spec" },
        .textures = .{"path"},
        .textureEncode = .{ "path", "index" },
        .texturePreview = .{ "path", "index" },
        .diff = .{ "a", "b" },
        .lint = .{ "path", "budgetJson" },
        .presetLoad = .{"name"},
        .presetSave = .{ "name", "zon" },
        .settingsLoad = .{},
        .settingsSave = .{"text"},
    };

    // ---- browse -----------------------------------------------------------

    /// Native open panel: `{"path":"<abs>"}` on a pick, `{"path":null}` on
    /// cancel. Runs modally on the main thread, like every bound method.
    pub fn openDialog(self: *Backend, call: *nanoui.Call) !json.Raw {
        return self.openDialogImpl(call.arena);
    }

    /// Native save panel: `{"path":"<abs>"}` on a pick, `{"path":null}` on
    /// cancel. `name` is the file name the panel starts with (the caller's
    /// basename, or `default_save_name` when null/blank). Runs modally on the
    /// main thread, like every bound method. Headless testing is impossible
    /// (it blocks on the user), so tests cover `saveFileName` + `pathResultRaw`.
    pub fn pickSavePath(self: *Backend, call: *nanoui.Call, name: ?[]const u8) !json.Raw {
        return self.pickSavePathImpl(call.arena, name);
    }

    /// Copies the file `src` to `dst` in the background: answers
    /// `{"started":true}` at once, then `exportDone`. Missing parents of
    /// `dst` are created; `dst == src` is refused; overwriting is allowed (the
    /// page confirms first). Shares the pipeline gate: short, but keeps one
    /// writer at a time.
    pub fn exportTo(self: *Backend, call: *nanoui.Call, src: []const u8, dst: []const u8) !json.Raw {
        if (self.busy()) return json.errorRaw(call.arena, "busy", .{});
        return self.launch(call.arena, Target.of(call.window), .export_file, src, null, 0, dst);
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

    /// Runs `preset` in the background into
    /// `.zig-cache/assetty-app/opt_<ts>.glb` and answers `{"started":true}` at
    /// once; each step arrives as a `progress` event and the report as
    /// `optimizeDone`. `{"error":..}` comes back synchronously for a bad
    /// preset, an unreadable path or a job already running.
    pub fn optimize(self: *Backend, call: *nanoui.Call, path: []const u8, preset: []const u8) !json.Raw {
        if (self.busy()) return json.errorRaw(call.arena, "busy", .{});
        const resolved = resolvePresetOrMessage(self.io, call.arena, preset);
        const p = switch (resolved) {
            .preset => |p2| p2,
            .err => |msg| return json.errorRaw(call.arena, "{s}", .{msg}),
        };
        return self.launch(call.arena, Target.of(call.window), .optimize, path, p, 0, null);
    }

    /// Same as `optimize`, but the steps come from the frontend's per-step UI
    /// as a JSON spec (`{"steps":[{"prune":{}}, ...]}`); the spec is either
    /// that JSON text or a JSON string containing it.
    pub fn optimizeCustom(self: *Backend, call: *nanoui.Call, path: []const u8, spec: []const u8) !json.Raw {
        if (self.busy()) return json.errorRaw(call.arena, "busy", .{});
        const resolved = specPresetOrMessage(call.arena, spec);
        const p = switch (resolved) {
            .preset => |p2| p2,
            .err => |msg| return json.errorRaw(call.arena, "{s}", .{msg}),
        };
        return self.launch(call.arena, Target.of(call.window), .optimize, path, p, 0, null);
    }

    // ---- textures ---------------------------------------------------------

    /// `assetty textures <path> --json`.
    pub fn textures(self: *Backend, call: *nanoui.Call, path: []const u8) !json.Raw {
        return self.texturesImpl(call.arena, path);
    }

    /// Encodes image `index` to KTX2 in the background: answers
    /// `{"started":true}` at once, then `textureEncodeDone` with the size, the
    /// PSNR, the VRAM it now needs and paths to the before/after PNGs.
    pub fn textureEncode(self: *Backend, call: *nanoui.Call, path: []const u8, index: u32) !json.Raw {
        if (self.busy()) return json.errorRaw(call.arena, "busy", .{});
        return self.launch(call.arena, Target.of(call.window), .texture_encode, path, null, index, null);
    }

    /// Renders image `index` as a PNG the page can show: answers
    /// `{"started":true}` at once, then `texturePreviewDone` with
    /// `{"ok":true,"index":N,"b64":"<base64 PNG>","width":W,"height":H}`.
    ///
    /// Async like `textureEncode`: decode (stb/basisu) plus PNG encode of a
    /// 2K texture is seconds, not milliseconds, so it must not run on the main
    /// thread.
    pub fn texturePreview(self: *Backend, call: *nanoui.Call, path: []const u8, index: u32) !json.Raw {
        if (self.previewBusy()) return json.errorRaw(call.arena, "busy", .{});
        return self.launch(call.arena, Target.of(call.window), .texture_preview, path, null, index, null);
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

    /// Settings blob (`assetty.settings.json` in the cwd) as raw JSON; `{}`
    /// when the file is absent or does not hold valid JSON. The schema is the
    /// frontend's business.
    pub fn settingsLoad(self: *Backend, call: *nanoui.Call) !json.Raw {
        return self.settingsLoadFrom(call.arena, settings_file);
    }

    /// Validates `text` as JSON and replaces the settings file atomically:
    /// `{"ok":true}` or `{"error":".."}`.
    pub fn settingsSave(self: *Backend, call: *nanoui.Call, text: []const u8) !json.Raw {
        return self.settingsSaveTo(call.arena, settings_file, text);
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

    fn pickSavePathImpl(self: *Backend, a: std.mem.Allocator, name: ?[]const u8) !json.Raw {
        // Same ownership as `openDialogImpl`: the dialog allocates with
        // `self.gpa`, the reply is rendered into the call's arena.
        const picked: ?[]const u8 = blk: {
            const p = nanoui.dialog.save(self.gpa, .{
                .title = "Export model",
                .name = saveFileName(name),
                .extensions = &.{"glb"},
            }) catch break :blk null;
            break :blk p;
        };
        defer if (picked) |p| self.gpa.free(p);
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

    fn optimizeImpl(
        self: *Backend,
        a: std.mem.Allocator,
        window: ?*nanoui.Window,
        path: []const u8,
        preset_spec: []const u8,
    ) !json.Raw {
        const resolved = resolvePresetOrMessage(self.io, a, preset_spec);
        const p = switch (resolved) {
            .preset => |p2| p2,
            .err => |msg| return json.errorRaw(a, "{s}", .{msg}),
        };
        return self.pipelineReply(a, window, path, p);
    }

    fn optimizeCustomImpl(
        self: *Backend,
        a: std.mem.Allocator,
        window: ?*nanoui.Window,
        path: []const u8,
        spec: []const u8,
    ) !json.Raw {
        const resolved = specPresetOrMessage(a, spec);
        const p = switch (resolved) {
            .preset => |p2| p2,
            .err => |msg| return json.errorRaw(a, "{s}", .{msg}),
        };
        return self.pipelineReply(a, window, path, p);
    }

    /// Runs the pipeline right here, on the calling thread: the synchronous
    /// entry point the tests (and any non-UI caller) use.
    fn pipelineReply(
        self: *Backend,
        a: std.mem.Allocator,
        window: ?*nanoui.Window,
        path: []const u8,
        p: core.preset.Preset,
    ) !json.Raw {
        var sink: WindowSink = undefined;
        const sinks: Sinks = if (window) |w| blk: {
            sink = .{ .window = w };
            break :blk sink.sinks();
        } else .{};
        return switch (self.runPipeline(a, path, p, sinks)) {
            .done => |d| d.report,
            .failed => |msg| json.errorRaw(a, "{s}", .{msg}),
            .out_of_memory => error.OutOfMemory,
        };
    }

    /// The shared tail of `optimize`/`optimizeCustom`: run `p` into
    /// `.zig-cache/assetty-app/opt_<ts>.glb`, report through `sinks`, format
    /// the JSON. Every allocation comes from `a`.
    fn runPipeline(
        self: *Backend,
        a: std.mem.Allocator,
        path: []const u8,
        p: core.preset.Preset,
        sinks: Sinks,
    ) PipelineOutcome {
        const nanos: u64 = @intCast(@max(0, std.Io.Clock.real.now(self.io).nanoseconds));
        const out_path = std.fmt.allocPrint(a, "{s}/opt_{d}.glb", .{ out_dir, nanos }) catch
            return .out_of_memory;
        std.Io.Dir.cwd().createDirPath(self.io, out_dir) catch |err| {
            const msg = std.fmt.allocPrint(a, "out dir: {s}", .{@errorName(err)}) catch return .out_of_memory;
            sinks.logFmt("optimize failed: {s}", .{msg});
            return .{ .failed = msg };
        };

        const rep = core.runner.run(self.io, a, path, .{
            .preset = p,
            .out_path = out_path,
            .progress = sinks.progress,
            .progress_ctx = sinks.progress_ctx,
        }) catch |err| {
            const msg = std.fmt.allocPrint(a, "{s}: {s}", .{ path, @errorName(err) }) catch return .out_of_memory;
            sinks.logFmt("optimize failed: {s}", .{msg});
            return .{ .failed = msg };
        };
        sinks.logFmt("optimize \"{s}\" -> {s}", .{ p.name, out_path });

        var aw: std.Io.Writer.Allocating = .init(a);
        defer aw.deinit();
        json.writeOptimize(&aw.writer, path, out_path, p, rep) catch return .out_of_memory;
        const report = aw.toOwnedSlice() catch return .out_of_memory;
        return .{ .done = .{ .out_path = out_path, .report = json.raw(report) } };
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

    /// Read settings from an arbitrary path (the bound method binds
    /// `settings_file`; tests inject temp paths). Missing/unreadable/invalid
    /// content collapses to `{}` so the page always gets parseable JSON.
    fn settingsLoadFrom(self: *Backend, a: std.mem.Allocator, path: []const u8) !json.Raw {
        const text = std.Io.Dir.cwd().readFileAlloc(self.io, path, a, .limited(max_text_bytes)) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return json.raw("{}"),
        };
        var parsed = std.json.parseFromSlice(std.json.Value, a, text, .{}) catch
            return json.raw("{}");
        parsed.deinit();
        return json.raw(text);
    }

    /// Validate-then-atomic-write. The temp file lives next to the destination
    /// and is renamed over it, so a crash mid-write cannot truncate the
    /// settings (or leave invalid JSON behind).
    fn settingsSaveTo(self: *Backend, a: std.mem.Allocator, path: []const u8, text: []const u8) !json.Raw {
        if (text.len > max_text_bytes) return json.errorRaw(a, "settings too large", .{});
        var parsed = std.json.parseFromSlice(std.json.Value, a, text, .{}) catch
            return json.errorRaw(a, "invalid settings JSON", .{});
        parsed.deinit();

        var atomic = std.Io.Dir.cwd().createFileAtomic(self.io, path, .{ .replace = true }) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        defer atomic.deinit(self.io);

        var buf: [8192]u8 = undefined;
        var fw = atomic.file.writer(self.io, &buf);
        fw.interface.writeAll(text) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        fw.flush() catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        atomic.replace(self.io) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        return json.raw("{\"ok\":true}");
    }

    // ---- background jobs --------------------------------------------------

    /// Validates `path`, then hands the run to a worker and answers
    /// `{"started":true}`. Everything the worker needs is deep-copied: the
    /// caller's arena dies with the call.
    fn launch(
        self: *Backend,
        a: std.mem.Allocator,
        target: Target,
        kind: JobKind,
        path: []const u8,
        p: ?core.preset.Preset,
        index: u32,
        extra: ?[]const u8,
    ) !json.Raw {
        if (self.busy() and kind != .texture_preview) return json.errorRaw(a, "busy", .{});
        if (kind == .texture_preview and self.previewBusy()) return json.errorRaw(a, "busy", .{});
        // Cheap readability check now, so a mistyped path is an immediate
        // `{"error":..}` instead of an event a second later.
        _ = std.Io.Dir.cwd().statFile(self.io, path, .{}) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        _ = self.spawn(target, kind, path, p, index, extra) catch |err| switch (err) {
            error.Busy => return json.errorRaw(a, "busy", .{}),
            error.OutOfMemory => return error.OutOfMemory,
            error.SpawnFailed => return json.errorRaw(a, "cannot start a worker thread", .{}),
        };
        return json.raw(started_reply);
    }

    /// One job at a time per gate: pipeline jobs (optimize/encode) and
    /// previews gate separately — a slow preview must not block a run.
    fn busy(self: *Backend) bool {
        self.job_lock.lock();
        defer self.job_lock.unlock();
        return self.job != null;
    }

    fn previewBusy(self: *Backend) bool {
        self.job_lock.lock();
        defer self.job_lock.unlock();
        return self.preview_job != null;
    }

    fn spawn(
        self: *Backend,
        target: Target,
        kind: JobKind,
        path: []const u8,
        p: ?core.preset.Preset,
        index: u32,
        extra: ?[]const u8,
    ) SpawnError!*Job {
        self.job_lock.lock();
        defer self.job_lock.unlock();
        const is_preview = kind == .texture_preview;
        const slot = if (is_preview) &self.preview_job else &self.job;
        if (slot.* != null) return error.Busy;

        // `job_gpa`, not `self.gpa`: this struct and everything it deep-copies
        // outlives the call and may outlive the process's leak checker.
        const gpa = job_gpa;
        const path_copy = try gpa.dupe(u8, path);
        errdefer gpa.free(path_copy);
        const preset_copy: ?core.preset.Preset = if (p) |preset| try clonePreset(gpa, preset) else null;
        errdefer {
            if (preset_copy) |copy| freePreset(gpa, copy);
        }
        // `export_file`'s destination; null for every other kind.
        const extra_copy: ?[]u8 = if (extra) |e| try gpa.dupe(u8, e) else null;
        errdefer {
            if (extra_copy) |copy| gpa.free(copy);
        }

        const job = try gpa.create(Job);
        errdefer gpa.destroy(job);
        job.* = .{
            .backend = self,
            .gpa = gpa,
            .io = self.io,
            .kind = kind,
            .index = index,
            .target = target,
            .path = path_copy,
            .preset = preset_copy,
            .arg = extra_copy,
        };

        // The gate is closed before the worker exists: a job that finishes
        // immediately must still find (and clear) its own entry.
        slot.* = job;
        const thread = std.Thread.spawn(.{}, Job.run, .{job}) catch |err| {
            slot.* = null;
            return switch (err) {
                error.OutOfMemory => error.OutOfMemory,
                else => error.SpawnFailed,
            };
        };
        // Detached: a quit must not wait for a running encode. `shutdown`
        // makes the late delivery a no-op instead.
        thread.detach();
        return job;
    }

    /// Clears the gate. Runs on the main thread, right before the result is
    /// emitted, so an event handler may start the next job.
    fn releaseJob(self: *Backend, job: *Job) void {
        self.job_lock.lock();
        defer self.job_lock.unlock();
        // preview jobs have their own gate: they must not block a pipeline run
        if (job.kind == .texture_preview) {
            if (self.preview_job == job) self.preview_job = null;
        } else {
            if (self.job == job) self.job = null;
        }
    }

    /// Worker thread: runs the delivery, which hops to the main thread.
    fn deliver(self: *Backend, job: *Job) void {
        if (self.on_job_done) |cb| return cb(self.on_job_done_ctx, job);
        nanoui.App.onMain(job, delivered);
    }

    /// Drops the app's claim on finished jobs: call before `App.destroy`.
    /// A run still in flight is not waited for (it may take a minute); its
    /// delivery is skipped and the process is ending anyway.
    pub fn shutdown(_: *Backend) void {
        shutting_down.store(true, .release);
    }
};

/// The `{"started":true}` reply of every background method.
const started_reply = "{\"started\":true}";

const JobKind = enum { optimize, texture_encode, texture_preview, export_file };

/// Guards `Backend.job`. Critical sections are a pointer compare, so a spin
/// lock is plenty (and `std.Io.Mutex` would need an `Io` in a `.c` callback).
const Gate = struct {
    state: std.atomic.Mutex = .unlocked,

    fn lock(self: *Gate) void {
        while (!self.state.tryLock()) std.atomic.spinLoopHint();
    }

    fn unlock(self: *Gate) void {
        self.state.unlock();
    }
};

const SpawnError = error{ Busy, OutOfMemory, SpawnFailed };

/// Where a job's events go: the page's window and, through it, the app. Both
/// are null in tests, which use `Backend.on_job_done` instead.
const Target = struct {
    window: ?*nanoui.Window = null,
    app: ?*nanoui.App = null,

    fn of(window: ?*nanoui.Window) Target {
        const w = window orelse return .{};
        return .{ .window = w, .app = w.app };
    }
};

/// Set by `Backend.shutdown` before the windows are torn down: a delivery that
/// runs after it must not touch the app any more.
var shutting_down: std.atomic.Value(bool) = .init(false);

/// Progress and log sinks for one pipeline run. The sync entry points emit
/// straight to the page; the worker copies into the main thread's queue.
const Sinks = struct {
    progress: ?core.runner.ProgressFn = null,
    progress_ctx: ?*anyopaque = null,
    log: ?*const fn (ctx: ?*anyopaque, line: []const u8) void = null,
    log_ctx: ?*anyopaque = null,

    fn logFmt(self: Sinks, comptime fmt: []const u8, args: anytype) void {
        const f = self.log orelse return;
        var buf: [1024]u8 = undefined;
        const line = std.fmt.bufPrint(&buf, fmt, args) catch return;
        f(self.log_ctx, line);
    }
};

/// Sinks that emit on the calling thread: bound methods and tests.
const WindowSink = struct {
    window: *nanoui.Window,

    fn sinks(self: *WindowSink) Sinks {
        return .{
            .progress = &progress,
            .progress_ctx = self,
            .log = &log,
            .log_ctx = self,
        };
    }

    fn progress(ctx: ?*anyopaque, step: []const u8, pct: f32) void {
        const self: *WindowSink = @ptrCast(@alignCast(ctx orelse return));
        events.Progress.emit(self.window, .{ .step = step, .pct = pct });
    }

    fn log(ctx: ?*anyopaque, line: []const u8) void {
        const self: *WindowSink = @ptrCast(@alignCast(ctx orelse return));
        events.Log.emit(self.window, .{ .line = line });
    }
};

/// How a pipeline run ended. Both `out_path` and `report` come from the
/// caller's allocator.
const PipelineOutcome = union(enum) {
    done: struct { out_path: []const u8, report: json.Raw },
    /// Human-readable reason, already formatted the way replies want it.
    failed: []const u8,
    out_of_memory,
};

/// A resolved preset, or the text of the error reply.
const Resolved = union(enum) {
    preset: core.preset.Preset,
    err: []const u8,
};

/// `resolvePreset` with the CLI's wording, for an `{"error":..}` reply.
fn resolvePresetOrMessage(io: std.Io, a: std.mem.Allocator, spec: []const u8) Resolved {
    return .{ .preset = resolvePreset(io, a, spec) catch |err| {
        if (err == error.UnknownPreset)
            return .{ .err = std.fmt.allocPrint(a, "unknown preset '{s}'", .{spec}) catch "unknown preset" };
        return .{ .err = std.fmt.allocPrint(a, "preset '{s}': {s}", .{ spec, @errorName(err) }) catch "bad preset" };
    } };
}

/// `customPresetFromSpec` with the frontend's wording, for an error reply.
fn specPresetOrMessage(a: std.mem.Allocator, spec: []const u8) Resolved {
    var detail: []const u8 = "";
    return .{ .preset = customPresetFromSpec(a, spec, &detail) catch |err| switch (err) {
        error.OutOfMemory => return .{ .err = "out of memory" },
        error.NoSteps => return .{ .err = "no steps" },
        error.UnknownStep => return .{ .err = std.fmt.allocPrint(a, "unknown step '{s}'", .{detail}) catch "unknown step" },
        error.BadParam => return .{ .err = std.fmt.allocPrint(a, "bad params for '{s}'", .{detail}) catch "bad params" },
        error.InvalidSpec => return .{ .err = "invalid spec" },
    } };
}

// ---- background jobs ------------------------------------------------------

/// One background run. The main thread owns `Backend.job`; the worker owns
/// everything else, writes `result` (or the message in `err_buf`) and posts.
const Job = struct {
    backend: *Backend,
    /// `job_gpa` (`c_allocator`): thread-safe and leak-checker-free, because
    /// the worker allocates and frees across threads and may outlive main.
    gpa: std.mem.Allocator,
    io: std.Io,
    kind: JobKind,
    index: u32 = 0,
    target: Target = .{},
    /// Deep copy of the call's path (the call's arena dies with the method).
    path: []u8,
    /// Deep copy of the resolved preset; null for `texture_encode`.
    preset: ?core.preset.Preset = null,
    /// Second path argument; the `export_file` destination, else null.
    arg: ?[]u8 = null,
    /// Set by the worker before it posts: null means it failed, see `err`.
    result: ?Result = null,
    /// Failure message, formatted in place: the error path never allocates.
    err_buf: [512]u8 = undefined,
    err_len: usize = 0,

    const Result = union(enum) {
        /// `{"out_path","report"}`: the written file and its report JSON.
        optimize: struct { out_path: []u8, report: []u8 },
        /// `{"src","dst"}`: the copied file and where it landed.
        exported: struct { src: []u8, dst: []u8 },
        /// The numbers `textureEncodeDone` carries.
        texture: Encoded,
        /// The base64 PNG `texturePreviewDone` carries.
        preview: Preview,
    };

    /// Thread entry.
    fn run(self: *Job) void {
        switch (self.kind) {
            .optimize => self.runOptimize(),
            .texture_encode => self.runTextureEncode(),
            .texture_preview => self.runTexturePreview(),
            .export_file => self.runExport(),
        }
        self.backend.deliver(self);
    }

    /// The whole pipeline, on this thread, with an arena of its own: the
    /// report is copied into `gpa` before it is torn down.
    fn runOptimize(self: *Job) void {
        var arena: std.heap.ArenaAllocator = .init(self.gpa);
        defer arena.deinit();
        const p = self.preset orelse return self.fail("no preset", .{});
        switch (self.backend.runPipeline(arena.allocator(), self.path, p, self.sinks())) {
            .done => |d| {
                const out_path = self.gpa.dupe(u8, d.out_path) catch return self.fail("out of memory", .{});
                const report = self.gpa.dupe(u8, d.report.text) catch {
                    self.gpa.free(out_path);
                    return self.fail("out of memory", .{});
                };
                self.result = .{ .optimize = .{ .out_path = out_path, .report = report } };
            },
            .failed => |msg| self.fail("{s}", .{msg}),
            .out_of_memory => self.fail("out of memory", .{}),
        }
    }

    fn runTextureEncode(self: *Job) void {
        var arena: std.heap.ArenaAllocator = .init(self.gpa);
        defer arena.deinit();
        const outcome = encodeTexture(self.io, arena.allocator(), self.path, self.index) catch
            return self.fail("out of memory", .{});
        switch (outcome) {
            // The two paths point into the arena, which dies here: the job's
            // result must own them before that.
            .done => |d| {
                const owned = self.adoptEncoded(d) orelse return self.fail("out of memory", .{});
                self.result = .{ .texture = owned };
            },
            .skipped => self.fail("image {d} is not encodable (external or unsupported format)", .{self.index}),
            .failed => |msg| self.fail("{s}", .{msg}),
        }
    }

    /// Copies an arena-owned `Encoded` into `gpa`. Null on OOM.
    fn adoptEncoded(self: *Job, d: Encoded) ?Encoded {
        var out = d;
        out.before_png = self.gpa.dupe(u8, d.before_png) catch return null;
        out.after_png = self.gpa.dupe(u8, d.after_png) catch {
            self.gpa.free(out.before_png);
            return null;
        };
        return out;
    }

    fn runTexturePreview(self: *Job) void {
        var arena: std.heap.ArenaAllocator = .init(self.gpa);
        defer arena.deinit();
        const outcome = previewTexture(self.io, arena.allocator(), self.path, self.index) catch
            return self.fail("out of memory", .{});
        switch (outcome) {
            .done => |p| {
                const b64 = self.gpa.dupe(u8, p.b64) catch return self.fail("out of memory", .{});
                self.result = .{ .preview = .{
                    .index = p.index,
                    .b64 = b64,
                    .width = p.width,
                    .height = p.height,
                } };
            },
            .failed => |msg| self.fail("{s}", .{msg}),
        }
    }

    /// Copies `path` to `arg`: short, but still off the main thread so a big
    /// model cannot stall the page, and behind the pipeline gate so an export
    /// cannot race a run writing the same cache file.
    fn runExport(self: *Job) void {
        const dst = self.arg orelse return self.fail("no destination", .{});
        var arena: std.heap.ArenaAllocator = .init(self.gpa);
        defer arena.deinit();
        if (copyExport(self.io, arena.allocator(), self.path, dst)) |msg|
            return self.fail("{s}", .{msg});
        const src_copy = self.gpa.dupe(u8, self.path) catch return self.fail("out of memory", .{});
        const dst_copy = self.gpa.dupe(u8, dst) catch {
            self.gpa.free(src_copy);
            return self.fail("out of memory", .{});
        };
        self.result = .{ .exported = .{ .src = src_copy, .dst = dst_copy } };
    }

    fn sinks(self: *Job) Sinks {
        return .{
            .progress = &onProgress,
            .progress_ctx = self,
            .log = &onLog,
            .log_ctx = self,
        };
    }

    fn onProgress(ctx: ?*anyopaque, step: []const u8, pct: f32) void {
        const self: *Job = @ptrCast(@alignCast(ctx orelse return));
        self.postProgress(step, pct);
    }

    fn onLog(ctx: ?*anyopaque, line: []const u8) void {
        const self: *Job = @ptrCast(@alignCast(ctx orelse return));
        self.postLog(line);
    }

    /// `step` points into this job's arena, which ends with the run: copy it
    /// and hand it to the main thread.
    fn postProgress(self: *Job, step: []const u8, pct: f32) void {
        const app = self.target.app orelse return;
        const window = self.target.window orelse return;
        const copy = self.gpa.dupe(u8, step) catch return;
        const posted = postToMain(ProgressMsg, self.gpa, .{
            .gpa = self.gpa,
            .app = app,
            .window = window,
            .step = copy,
            .pct = pct,
        });
        if (!posted) self.gpa.free(copy);
    }

    fn postLog(self: *Job, line: []const u8) void {
        const app = self.target.app orelse return;
        const window = self.target.window orelse return;
        const copy = self.gpa.dupe(u8, line) catch return;
        const posted = postToMain(LogMsg, self.gpa, .{
            .gpa = self.gpa,
            .app = app,
            .window = window,
            .line = copy,
        });
        if (!posted) self.gpa.free(copy);
    }

    fn fail(self: *Job, comptime fmt: []const u8, args: anytype) void {
        self.result = null;
        const text: []const u8 = std.fmt.bufPrint(&self.err_buf, fmt, args) catch "";
        self.err_len = text.len;
    }

    fn err(self: *const Job) []const u8 {
        return self.err_buf[0..self.err_len];
    }

    /// Frees the job and everything it owns, from whichever thread holds it.
    fn destroy(self: *Job) void {
        const gpa = self.gpa;
        if (self.preset) |p| freePreset(gpa, p);
        gpa.free(self.path);
        if (self.arg) |extra| gpa.free(extra);
        if (self.result) |res| switch (res) {
            .optimize => |o| {
                gpa.free(o.out_path);
                gpa.free(o.report);
            },
            .exported => |e| {
                gpa.free(e.src);
                gpa.free(e.dst);
            },
            .texture => |t| {
                gpa.free(t.before_png);
                gpa.free(t.after_png);
            },
            .preview => |p| gpa.free(p.b64),
        };
        gpa.destroy(self);
    }
};

/// Runs `Msg.run` on the main thread soon: `nanoui.App.onMain` is
/// `dispatch_async_f` on the main queue, the only thread the page (and the
/// window list) may be touched from. False when out of memory.
fn postToMain(comptime Msg: type, gpa: std.mem.Allocator, msg: Msg) bool {
    const p = gpa.create(Msg) catch return false;
    p.* = msg;
    nanoui.App.onMain(p, Msg.run);
    return true;
}

const ProgressMsg = struct {
    /// The job's allocator: allocation and free stay on the same one.
    gpa: std.mem.Allocator,
    app: *nanoui.App,
    window: *nanoui.Window,
    step: []u8,
    pct: f32,

    fn run(ctx: ?*anyopaque) callconv(.c) void {
        const self: *ProgressMsg = @ptrCast(@alignCast(ctx));
        const gpa = self.gpa;
        defer gpa.destroy(self);
        defer gpa.free(self.step);
        if (shutting_down.load(.acquire)) return;
        if (!windowAlive(self.app, self.window)) return;
        events.Progress.emit(self.window, .{ .step = self.step, .pct = self.pct });
    }
};

const LogMsg = struct {
    gpa: std.mem.Allocator,
    app: *nanoui.App,
    window: *nanoui.Window,
    line: []u8,

    fn run(ctx: ?*anyopaque) callconv(.c) void {
        const self: *LogMsg = @ptrCast(@alignCast(ctx));
        const gpa = self.gpa;
        defer gpa.destroy(self);
        defer gpa.free(self.line);
        if (shutting_down.load(.acquire)) return;
        if (!windowAlive(self.app, self.window)) return;
        events.Log.emit(self.window, .{ .line = self.line });
    }
};

/// Main thread: clears the gate and emits the job's event.
fn delivered(ctx: ?*anyopaque) callconv(.c) void {
    const job: *Job = @ptrCast(@alignCast(ctx));
    job.backend.releaseJob(job);
    defer job.destroy();
    if (shutting_down.load(.acquire)) return;
    const window = liveWindow(job) orelse return;
    if (job.result) |result| {
        switch (result) {
            .optimize => |o| events.OptimizeDone.emit(window, .{
                .ok = true,
                .out_path = o.out_path,
                .report = json.raw(o.report),
            }),
            .texture => |t| events.TextureEncodeDone.emit(window, .{
                .ok = true,
                .index = t.index,
                .ktx2_size = t.ktx2_size,
                .psnr = t.psnr,
                .vram_after = t.vram_after,
                .before_png = t.before_png,
                .after_png = t.after_png,
                .width = t.width,
                .height = t.height,
                .mip_levels = t.mip_levels,
                .format = t.format_label,
                .settings = .{
                    .format = if (t.mode == .uastc) "uastc" else "etc1s",
                    .quality = t.quality,
                    .max_size = t.max_size,
                    .generate_mips = t.generate_mips,
                },
            }),
            .preview => |p| events.TexturePreviewDone.emit(window, .{
                .ok = true,
                .index = p.index,
                .b64 = p.b64,
                .width = p.width,
                .height = p.height,
            }),
            .exported => |e| events.ExportDone.emit(window, .{
                .ok = true,
                .src = e.src,
                .dst = e.dst,
            }),
        }
    } else {
        emitFailure(job, window);
    }
}

fn emitFailure(job: *Job, window: *nanoui.Window) void {
    switch (job.kind) {
        .optimize => events.OptimizeDone.emit(window, .{
            .ok = false,
            .@"error" = if (job.err_len > 0) job.err() else "optimize failed",
        }),
        .texture_encode => events.TextureEncodeDone.emit(window, .{
            .ok = false,
            .index = job.index,
            .@"error" = if (job.err_len > 0) job.err() else "encode failed",
        }),
        .texture_preview => events.TexturePreviewDone.emit(window, .{
            .ok = false,
            .index = job.index,
            .@"error" = if (job.err_len > 0) job.err() else "preview failed",
        }),
        .export_file => events.ExportDone.emit(window, .{
            .ok = false,
            .@"error" = if (job.err_len > 0) job.err() else "export failed",
        }),
    }
}

/// The job's window, if it is still open. Main thread only, and pointers are
/// compared before anything is dereferenced: a closed window is gone.
fn liveWindow(job: *const Job) ?*nanoui.Window {
    const app = job.target.app orelse return null;
    const window = job.target.window orelse return null;
    if (windowAlive(app, window)) return window;
    return null;
}

/// Whether `window` is still in the app's list. It is removed (and freed) when
/// it closes, so the main thread can tell without touching the window itself.
fn windowAlive(app: *nanoui.App, window: *nanoui.Window) bool {
    for (app.windows.items) |live| {
        if (live == window) return true;
    }
    return false;
}

fn clonePreset(gpa: std.mem.Allocator, p: core.preset.Preset) !core.preset.Preset {
    const name = try gpa.dupe(u8, p.name);
    errdefer gpa.free(name);
    return .{ .name = name, .target = p.target, .steps = try gpa.dupe(core.preset.Step, p.steps) };
}

fn freePreset(gpa: std.mem.Allocator, p: core.preset.Preset) void {
    gpa.free(p.name);
    gpa.free(p.steps);
}

// ---- texture encode -------------------------------------------------------

const EncodeOutcome = union(enum) {
    done: Encoded,
    /// Not encodable: an external image or an unsupported pixel format.
    skipped,
    /// Human-readable reason (arena-owned).
    failed: []const u8,
};

/// What `textureEncodeDone` reports: the encoded size and quality numbers plus
/// the before/after PNGs the page shows side by side.
///
/// `before_png`/`after_png` point at bytes; coming out of `encodeTexture` they
/// are arena-owned, `Job.adoptEncoded` moves them to the job's allocator.
const Encoded = struct {
    index: u32,
    ktx2_size: u64,
    psnr: f32,
    vram_after: u64,
    before_png: []const u8,
    after_png: []const u8,
    /// Source dimensions (what `before_png` shows).
    width: u32,
    height: u32,
    mip_levels: u32,
    /// "ETC1S" / "UASTC" / ... (static, never freed).
    format_label: []const u8,
    /// Settings actually used; also echoed in the event payload.
    mode: core.encode_ktx.Mode,
    quality: u8,
    max_size: u32,
    generate_mips: bool,
};

/// Load `path`, encode image `index` to KTX2, measure it and write the
/// before/after PNGs.
fn encodeTexture(io: std.Io, a: std.mem.Allocator, path: []const u8, index: u32) error{OutOfMemory}!EncodeOutcome {
    var loaded = core.parse.loadFile(io, a, path) catch |err|
        return .{ .failed = try std.fmt.allocPrint(a, "{s}: {s}", .{ path, @errorName(err) }) };
    defer loaded.deinit();
    if (index >= loaded.asset.images.len)
        return .{ .failed = try std.fmt.allocPrint(a, "image {d} out of range ({d} images)", .{ index, loaded.asset.images.len }) };

    const enc = encodeImage(a, loaded.asset.images[index], index) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return .{ .failed = try std.fmt.allocPrint(a, "encode {d}: {s}", .{ index, @errorName(err) }) },
    };
    const e = enc orelse return .skipped;

    const nanos: u64 = @intCast(@max(0, std.Io.Clock.real.now(io).nanoseconds));
    const before_png = writePngFile(io, a, "before", nanos, e.before) catch |err|
        return .{ .failed = try std.fmt.allocPrint(a, "write before png: {s}", .{@errorName(err)}) };
    const after_png = writePngFile(io, a, "after", nanos, e.after) catch |err|
        return .{ .failed = try std.fmt.allocPrint(a, "write after png: {s}", .{@errorName(err)}) };

    return .{ .done = .{
        .index = e.result.index,
        .ktx2_size = e.result.ktx2_bytes,
        .psnr = e.result.psnr_db,
        .vram_after = e.result.vram_after,
        .before_png = before_png,
        .after_png = after_png,
        .width = e.result.width,
        .height = e.result.height,
        .mip_levels = e.result.mip_levels,
        .format_label = e.result.format_label,
        .mode = e.mode,
        .quality = e.quality,
        .max_size = e.max_size,
        .generate_mips = e.generate_mips,
    } };
}

/// Writes `<out_dir>/tex_<ts>_<tag>.png` and returns the absolute path (the
/// page loads it through the `nanoui://` scheme, which wants a real path).
fn writePngFile(
    io: std.Io,
    a: std.mem.Allocator,
    tag: []const u8,
    nanos: u64,
    px: Pixels,
) ![]const u8 {
    std.Io.Dir.cwd().createDirPath(io, out_dir) catch {};
    const rel = try std.fmt.allocPrint(a, "{s}/tex_{d}_{s}.png", .{ out_dir, nanos, tag });
    const png = try core.decode.encodePngRgba(a, px.rgba, px.width, px.height);
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = rel, .data = png });
    return std.Io.Dir.cwd().realPathFileAlloc(io, rel, a);
}

// ---- texture preview ------------------------------------------------------

const PreviewOutcome = union(enum) {
    done: Preview,
    /// Human-readable reason (arena-owned).
    failed: []const u8,
};

/// What `texturePreviewDone` reports: a base64 PNG the page can show.
const Preview = struct { index: u32, b64: []const u8, width: u32, height: u32 };

/// Load `path`, decode image `index` (stb for png/jpeg, basisu for ktx2),
/// downscale to `preview_max_dim` and return it as base64 PNG.
fn previewTexture(io: std.Io, a: std.mem.Allocator, path: []const u8, index: u32) error{OutOfMemory}!PreviewOutcome {
    var loaded = core.parse.loadFile(io, a, path) catch |err|
        return .{ .failed = try std.fmt.allocPrint(a, "{s}: {s}", .{ path, @errorName(err) }) };
    defer loaded.deinit();
    if (index >= loaded.asset.images.len)
        return .{ .failed = try std.fmt.allocPrint(a, "image {d} out of range ({d} images)", .{ index, loaded.asset.images.len }) };

    const img = loaded.asset.images[index];
    const bytes = img.data orelse
        return .{ .failed = try std.fmt.allocPrint(a, "image {d} has no embedded bytes (external uri)", .{index}) };

    const px: Pixels = if (img.has_ktx2) blk: {
        const rt = core.encode_ktx.decodeToRgba(a, bytes) catch
            return .{ .failed = try std.fmt.allocPrint(a, "decode ktx2 {d}: unsupported or corrupt", .{index}) };
        break :blk .{ .rgba = rt.pixels, .width = rt.width, .height = rt.height };
    } else blk: {
        const dec = core.decode.decodeRgba(a, bytes) orelse
            return .{ .failed = try std.fmt.allocPrint(a, "decode image {d}: unsupported format", .{index}) };
        break :blk .{ .rgba = dec.pixels, .width = dec.width, .height = dec.height };
    };

    // The IPC carries one JS string: keep the PNG around a megabyte.
    const small = core.mips.fitMaxSize(a, px.rgba, px.width, px.height, preview_max_dim) catch
        return .{ .failed = try std.fmt.allocPrint(a, "downscale image {d}: invalid pixels", .{index}) };
    const png = core.decode.encodePngRgba(a, small.pixels, small.w, small.h) catch
        return .{ .failed = try std.fmt.allocPrint(a, "encode png {d}: invalid pixels", .{index}) };

    const b64 = try a.alloc(u8, std.base64.standard.Encoder.calcSize(png.len));
    _ = std.base64.standard.Encoder.encode(b64, png);
    return .{ .done = .{ .index = index, .b64 = b64, .width = small.w, .height = small.h } };
}

/// `{"path":"<abs>"}` or `{"path":null}`: the `openDialog`/`pickSavePath` reply.
fn pathResultRaw(a: std.mem.Allocator, path: ?[]const u8) !json.Raw {
    var aw: std.Io.Writer.Allocating = .init(a);
    errdefer aw.deinit();
    try aw.writer.writeAll("{\"path\":");
    try json.jsonStrOpt(&aw.writer, path);
    try aw.writer.writeByte('}');
    return json.raw(try aw.toOwnedSlice());
}

/// Suggested file name for the save panel: the caller's (base)name, or
/// `default_save_name` when it suggests nothing.
fn saveFileName(name: ?[]const u8) []const u8 {
    if (name) |n| {
        const trimmed = std.mem.trim(u8, n, " \t\r\n");
        if (trimmed.len > 0) return trimmed;
    }
    return default_save_name;
}

/// Copies `src` to `dst` for `exportTo`: missing parents of `dst` are
/// created, overwriting is allowed, `dst == src` is refused. Null on success,
/// otherwise an arena-owned reason. Reads only: `src` is opened read-only and
/// never modified (every pipeline output lands in `out_dir` instead).
fn copyExport(io: std.Io, a: std.mem.Allocator, src: []const u8, dst: []const u8) ?[]const u8 {
    if (src.len == 0 or dst.len == 0) return a.dupe(u8, "empty path") catch "out of memory";
    if (std.mem.eql(u8, src, dst)) return a.dupe(u8, "source and destination are the same file") catch "out of memory";
    _ = std.Io.Dir.cwd().updateFile(io, src, std.Io.Dir.cwd(), dst, .{ .make_path = true, .replace = true }) catch |err| {
        return std.fmt.allocPrint(a, "{s} -> {s}: {s}", .{ src, dst, @errorName(err) }) catch "out of memory";
    };
    return null;
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
                .use_attributes = (try r.boolField("use_attributes")) orelse d.use_attributes,
                .weight_normal = (try r.floatField("weight_normal")) orelse d.weight_normal,
                .weight_uv = (try r.floatField("weight_uv")) orelse d.weight_uv,
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

/// RGBA8 pixels plus their dimensions. Arena-owned in `encodeImage`.
const Pixels = struct { rgba: []const u8, width: u32, height: u32 };

/// What `encodeImage` hands back: the report numbers plus both pixel buffers,
/// so the caller can write the before/after PNGs.
const EncodedPixels = struct {
    result: json.EncodeResult,
    /// Source RGBA.
    before: Pixels,
    /// RGBA decoded back from the KTX2 (same dimensions unless max_size
    /// downscaled the encode).
    after: Pixels,
    mode: core.encode_ktx.Mode,
    quality: u8,
    max_size: u32,
    generate_mips: bool,
};

/// Decode image `idx` to RGBA, encode to KTX2, decode back, measure PSNR.
/// Null when the image is not decodable (external/unsupported).
fn encodeImage(a: std.mem.Allocator, img: core.model.Image, idx: u32) !?EncodedPixels {
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
        .result = .{
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
        },
        .before = .{ .rgba = dec.pixels, .width = dec.width, .height = dec.height },
        .after = .{ .rgba = rt.pixels, .width = rt.width, .height = rt.height },
        .mode = opts.mode,
        .quality = opts.quality,
        .max_size = opts.max_size,
        .generate_mips = opts.generate_mips,
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

test "settings: save/load round-trip and atomic file on disk" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/settings.json", .{tmp.sub_path[0..]});

    const text = "{\"theme\":\"dark\",\"optimize\":{\"target_ratio\":0.25},\"n\":[1,2,3]}";
    const saved = try b.settingsSaveTo(a, path, text);
    try testing.expectEqualStrings("{\"ok\":true}", saved.text);

    // The bytes actually landed on disk, untouched by the backend.
    const on_disk = try std.Io.Dir.cwd().readFileAlloc(testing.io, path, a, .limited(max_text_bytes));
    try testing.expectEqualStrings(text, on_disk);

    const loaded = try b.settingsLoadFrom(a, path);
    try testing.expectEqualStrings(text, loaded.text);
}

test "settings: invalid JSON is rejected and the old file survives" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/settings.json", .{tmp.sub_path[0..]});

    try testing.expectEqualStrings("{\"ok\":true}", (try b.settingsSaveTo(a, path, "{\"theme\":\"light\"}")).text);

    const bad = try b.settingsSaveTo(a, path, "{\"theme\":");
    try testing.expect(std.mem.indexOf(u8, bad.text, "\"error\"") != null);
    // Not truncated, not replaced.
    const on_disk = try std.Io.Dir.cwd().readFileAlloc(testing.io, path, a, .limited(max_text_bytes));
    try testing.expectEqualStrings("{\"theme\":\"light\"}", on_disk);
}

test "settings: missing file loads as an empty object" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const path = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/absent.json", .{tmp.sub_path[0..]});

    const loaded = try b.settingsLoadFrom(a, path);
    try testing.expectEqualStrings("{}", loaded.text);
}

test "optimize impl runs a preset and reports deltas" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.optimizeImpl(arena.allocator(), null, "test/fixtures/box.glb", "noop");
    try testing.expect(std.mem.indexOf(u8, r.text, "\"steps\": [") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"deltas\":") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"output\": \".zig-cache/assetty-app/opt_") != null);
    // Per-step and whole-run timings ride along for the progress/timing UI.
    try testing.expect(std.mem.indexOf(u8, r.text, "\"secs\": ") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"total_secs\": ") != null);
    var parsed = try std.json.parseFromSlice(std.json.Value, arena.allocator(), r.text, .{});
    defer parsed.deinit();
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

test "saveFileName blanks fall back to the default" {
    try testing.expectEqualStrings("model.opt.glb", saveFileName(null));
    try testing.expectEqualStrings("model.opt.glb", saveFileName(""));
    try testing.expectEqualStrings("model.opt.glb", saveFileName("   "));
    try testing.expectEqualStrings("box.opt.glb", saveFileName("box.opt.glb"));
    try testing.expectEqualStrings("box.opt.glb", saveFileName("  box.opt.glb\n"));
}

/// Seeds `.zig-cache/tmp/<tmp>/in/box.glb` with the fixture bytes.
fn seedExportSrc(a: std.mem.Allocator, tmp: *std.testing.TmpDir) ![]const u8 {
    const src = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/in/box.glb", .{tmp.sub_path[0..]});
    const fixture = try std.Io.Dir.cwd().readFileAlloc(testing.io, "test/fixtures/box.glb", a, .limited(64 << 20));
    const parent = std.fs.path.dirname(src) orelse return error.TestUnexpectedResult;
    try std.Io.Dir.cwd().createDirPath(testing.io, parent);
    try std.Io.Dir.cwd().writeFile(testing.io, .{ .sub_path = src, .data = fixture });
    return src;
}

test "export copies bytes and creates missing parents" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const src = try seedExportSrc(a, &tmp);
    const dst = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/deep/nested/model.opt.glb", .{tmp.sub_path[0..]});

    try testing.expect(copyExport(testing.io, a, src, dst) == null);

    const want = try std.Io.Dir.cwd().readFileAlloc(testing.io, "test/fixtures/box.glb", a, .limited(64 << 20));
    const got = try std.Io.Dir.cwd().readFileAlloc(testing.io, dst, a, .limited(64 << 20));
    try testing.expectEqualSlices(u8, want, got);
    // The source is untouched by the copy.
    const src_after = try std.Io.Dir.cwd().readFileAlloc(testing.io, src, a, .limited(64 << 20));
    try testing.expectEqualSlices(u8, want, src_after);
}

test "export refuses a self-copy and reports a missing source" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const src = try seedExportSrc(a, &tmp);

    const self_msg = copyExport(testing.io, a, src, src) orelse return error.TestUnexpectedResult;
    try testing.expect(std.mem.indexOf(u8, self_msg, "same file") != null);
    // Nothing was clobbered: the source still holds the fixture bytes.
    const want = try std.Io.Dir.cwd().readFileAlloc(testing.io, "test/fixtures/box.glb", a, .limited(64 << 20));
    const src_after = try std.Io.Dir.cwd().readFileAlloc(testing.io, src, a, .limited(64 << 20));
    try testing.expectEqualSlices(u8, want, src_after);

    const dst = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/out/model.opt.glb", .{tmp.sub_path[0..]});
    const missing_src = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/in/nope.glb", .{tmp.sub_path[0..]});
    const missing_msg = copyExport(testing.io, a, missing_src, dst) orelse return error.TestUnexpectedResult;
    try testing.expect(std.mem.indexOf(u8, missing_msg, "nope.glb") != null);

    const empty_msg = copyExport(testing.io, a, "", dst) orelse return error.TestUnexpectedResult;
    try testing.expect(std.mem.indexOf(u8, empty_msg, "empty path") != null);
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

test "custom spec maps simplify attribute fields" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const spec =
        \\{"steps":[{"simplify":{"use_attributes":true,"weight_normal":2.0,"weight_uv":0.5}}]}
    ;
    var detail: []const u8 = "";
    const p = try customPresetFromSpec(a, spec, &detail);
    try testing.expectEqual(@as(usize, 1), p.steps.len);
    try testing.expect(p.steps[0].simplify.use_attributes);
    try testing.expectEqual(@as(f32, 2.0), p.steps[0].simplify.weight_normal);
    try testing.expectEqual(@as(f32, 0.5), p.steps[0].simplify.weight_uv);

    // Omitted → preset defaults (attributes off, weight 1).
    const d = core.preset.SimplifyParams{};
    var detail2: []const u8 = "";
    const p2 = try customPresetFromSpec(a, "{\"steps\":[{\"simplify\":{}}]}", &detail2);
    try testing.expectEqual(d.use_attributes, p2.steps[0].simplify.use_attributes);
    try testing.expectEqual(d.weight_normal, p2.steps[0].simplify.weight_normal);
    try testing.expectEqual(d.weight_uv, p2.steps[0].simplify.weight_uv);
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

// ---- background jobs ------------------------------------------------------

test "a second job answers busy instead of spawning" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var b = testBackend();
    var occupied: Job = undefined; // the gate only ever compares pointers
    b.job = &occupied;
    defer b.job = null;

    const r = try b.launch(a, .{}, .texture_encode, "test/fixtures/box.glb", null, 0, null);
    try testing.expectEqualStrings("{\"error\":\"busy\"}", r.text);
    try testing.expect(b.busy());
}

test "launch rejects an unreadable path without spawning" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var b = testBackend();
    const r = try b.launch(a, .{}, .texture_encode, "test/fixtures/nope.glb", null, 0, null);
    try testing.expect(std.mem.indexOf(u8, r.text, "\"error\"") != null);
    try testing.expect(std.mem.indexOf(u8, r.text, "nope.glb") != null);
    try testing.expect(!b.busy());
}

/// Stands in for the main-thread delivery: records what the worker produced.
const Collector = struct {
    mutex: Gate = .{},
    called: std.atomic.Value(bool) = .init(false),
    ok: bool = false,
    report: ?[]u8 = null,

    fn collect(ctx: ?*anyopaque, job: *Job) void {
        const self: *Collector = @ptrCast(@alignCast(ctx orelse return));
        self.mutex.lock();
        self.ok = job.result != null;
        if (job.result) |res| switch (res) {
            .optimize => |o| self.report = testing.allocator.dupe(u8, o.report) catch null,
            .texture, .preview, .exported => {},
        };
        self.mutex.unlock();
        job.backend.releaseJob(job);
        job.destroy();
        self.called.store(true, .release);
    }

    fn wait(self: *Collector) void {
        while (!self.called.load(.acquire)) std.atomic.spinLoopHint();
    }
};

test "optimizeCustom runs on a worker and delivers the report" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var b = testBackend();
    var got: Collector = .{};
    b.on_job_done = &Collector.collect;
    b.on_job_done_ctx = &got;
    defer b.on_job_done = null;
    defer if (got.report) |r| testing.allocator.free(r);

    const resolved = specPresetOrMessage(a, "{\"steps\":[{\"dedup\":{}},{\"quantize\":{}}]}");
    const p = switch (resolved) {
        .preset => |p2| p2,
        .err => |msg| {
            std.debug.print("spec rejected: {s}\n", .{msg});
            return error.TestUnexpectedResult;
        },
    };

    const reply = try b.launch(a, .{}, .optimize, "test/fixtures/box.glb", p, 0, null);
    try testing.expectEqualStrings("{\"started\":true}", reply.text);

    got.wait();
    try testing.expect(got.ok);
    // The gate is open again once the result is delivered.
    try testing.expect(!b.busy());
    const report = got.report orelse return error.TestUnexpectedResult;
    try testing.expect(std.mem.indexOf(u8, report, "\"preset\": \"custom\"") != null);
    try testing.expect(std.mem.indexOf(u8, report, "\"output\": \".zig-cache/assetty-app/opt_") != null);
}

test "texturePreview runs on a worker and delivers a result" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var b = testBackend();
    var got: Collector = .{};
    b.on_job_done = &Collector.collect;
    b.on_job_done_ctx = &got;
    defer b.on_job_done = null;

    const reply = try b.launch(a, .{}, .texture_preview, "test/fixtures/box.glb", null, 0, null);
    try testing.expectEqualStrings("{\"started\":true}", reply.text);

    got.wait();
    try testing.expect(got.ok);
    try testing.expect(!b.busy());
}

test "exportTo shares the pipeline gate and delivers on a worker" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // Occupied gate: the export answers busy instead of spawning.
    var b = testBackend();
    var occupied: Job = undefined;
    b.job = &occupied;
    defer b.job = null;
    const busy_reply = try b.launch(a, .{}, .export_file, "test/fixtures/box.glb", null, 0, "/tmp/nope.glb");
    try testing.expectEqualStrings("{\"error\":\"busy\"}", busy_reply.text);
    try testing.expect(b.busy());
    b.job = null;

    // Free gate: the copy runs on a worker and the gate reopens after.
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const src = try seedExportSrc(a, &tmp);
    const dst = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/out/model.opt.glb", .{tmp.sub_path[0..]});

    var got: Collector = .{};
    b.on_job_done = &Collector.collect;
    b.on_job_done_ctx = &got;
    defer b.on_job_done = null;

    const reply = try b.launch(a, .{}, .export_file, src, null, 0, dst);
    try testing.expectEqualStrings("{\"started\":true}", reply.text);

    got.wait();
    try testing.expect(got.ok);
    try testing.expect(!b.busy());

    const want = try std.Io.Dir.cwd().readFileAlloc(testing.io, src, a, .limited(64 << 20));
    const got_bytes = try std.Io.Dir.cwd().readFileAlloc(testing.io, dst, a, .limited(64 << 20));
    try testing.expectEqualSlices(u8, want, got_bytes);
}

test "texture encode reports an out-of-range index" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    switch (try encodeTexture(testing.io, a, "test/fixtures/box.glb", 999)) {
        .failed => |msg| try testing.expect(std.mem.indexOf(u8, msg, "out of range") != null),
        else => return error.TestUnexpectedResult,
    }
}

test "texture encode writes before/after pngs and reports the settings" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    switch (try encodeTexture(testing.io, a, "test/fixtures/box.glb", 0)) {
        .done => |e| {
            // Absolute paths that actually exist and are real PNGs.
            try testing.expect(std.fs.path.isAbsolute(e.before_png));
            try testing.expect(std.fs.path.isAbsolute(e.after_png));
            try testing.expect(std.mem.endsWith(u8, e.before_png, "_before.png"));
            try testing.expect(std.mem.endsWith(u8, e.after_png, "_after.png"));

            for ([_][]const u8{ e.before_png, e.after_png }) |png_path| {
                const bytes = try std.Io.Dir.cwd().readFileAlloc(testing.io, png_path, a, .limited(4 << 20));
                try testing.expectEqualSlices(
                    u8,
                    &[_]u8{ 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A },
                    bytes[0..8],
                );
                const dec = core.decode.decodeRgba(a, bytes) orelse return error.TestUnexpectedResult;
                try testing.expectEqual(e.width, dec.width);
                try testing.expectEqual(e.height, dec.height);
            }

            // The payload echoes the settings the encoder ran with.
            try testing.expectEqual(core.encode_ktx.Mode.etc1s, e.mode);
            try testing.expectEqual(@as(u8, 128), e.quality);
            try testing.expectEqual(@as(u32, 0), e.max_size);
            try testing.expect(e.generate_mips);
            try testing.expect(e.format_label.len > 0);
            try testing.expect(e.mip_levels >= 1);
            try testing.expectEqual(@as(u32, 1), e.width);
            try testing.expectEqual(@as(u32, 1), e.height);
        },
        else => return error.TestUnexpectedResult,
    }
}

test "texturePreview renders a fixture image as base64 png" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    switch (try previewTexture(testing.io, a, "test/fixtures/box.glb", 0)) {
        .done => |p| {
            try testing.expectEqual(@as(u32, 0), p.index);
            try testing.expectEqual(@as(u32, 1), p.width);
            try testing.expectEqual(@as(u32, 1), p.height);
            // Base64 of the PNG signature.
            try testing.expect(std.mem.startsWith(u8, p.b64, "iVBORw0KGgo"));

            const n = try std.base64.standard.Decoder.calcSizeForSlice(p.b64);
            const png = try a.alloc(u8, n);
            try std.base64.standard.Decoder.decode(png, p.b64);
            const dec = core.decode.decodeRgba(a, png) orelse return error.TestUnexpectedResult;
            try testing.expectEqual(p.width, dec.width);
            try testing.expectEqual(p.height, dec.height);
        },
        else => return error.TestUnexpectedResult,
    }
}

test "texturePreview reports an out-of-range index" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    switch (try previewTexture(testing.io, a, "test/fixtures/box.glb", 999)) {
        .failed => |msg| try testing.expect(std.mem.indexOf(u8, msg, "out of range") != null),
        else => return error.TestUnexpectedResult,
    }
}

test "texturePreview downscales to the preview cap" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // A 2048² source is the case the cap exists for: preview_max_dim/2 halvings.
    const src = try a.alloc(u8, @as(usize, 2048) * 2048 * 4);
    @memset(src, 0x7F);
    var i: usize = 3;
    while (i < src.len) : (i += 4) src[i] = 0xFF;

    const small = try core.mips.fitMaxSize(a, src, 2048, 2048, preview_max_dim);
    try testing.expectEqual(@as(u32, preview_max_dim), small.w);
    try testing.expectEqual(@as(u32, preview_max_dim), small.h);

    // ...and the PNG of that is a few hundred KB, not tens of MB.
    const png = try core.decode.encodePngRgba(a, small.pixels, small.w, small.h);
    const b64_len = std.base64.standard.Encoder.calcSize(png.len);
    try testing.expect(b64_len < 8 << 20);
}

test "done event payloads carry the documented shapes" {
    var buf: [512]u8 = undefined;

    var ok_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.OptimizeDonePayload{
        .ok = true,
        .out_path = ".zig-cache/assetty-app/opt_1.glb",
        .report = json.raw("{\"preset\": \"custom\"}"),
    }, .{}, &ok_w);
    try testing.expectEqualStrings(
        "{\"ok\":true,\"out_path\":\".zig-cache/assetty-app/opt_1.glb\",\"report\":{\"preset\": \"custom\"}}",
        ok_w.buffered(),
    );

    var err_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.OptimizeDonePayload{ .ok = false, .@"error" = "boom" }, .{}, &err_w);
    try testing.expectEqualStrings("{\"ok\":false,\"error\":\"boom\"}", err_w.buffered());

    var tex_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.TextureEncodeDonePayload{
        .ok = true,
        .index = 2,
        .ktx2_size = 1024,
        .psnr = 41.5,
        .vram_after = 2048,
        .before_png = "/tmp/tex_1_before.png",
        .after_png = "/tmp/tex_1_after.png",
        .width = 512,
        .height = 256,
        .mip_levels = 10,
        .format = "ETC1S",
        .settings = .{ .format = "etc1s", .quality = 128, .max_size = 0, .generate_mips = true },
    }, .{}, &tex_w);
    try testing.expectEqualStrings(
        "{\"ok\":true,\"index\":2,\"ktx2_size\":1024,\"psnr\":41.50,\"vram_after\":2048," ++
            "\"before_png\":\"/tmp/tex_1_before.png\",\"after_png\":\"/tmp/tex_1_after.png\"," ++
            "\"width\":512,\"height\":256,\"mip_levels\":10,\"format\":\"ETC1S\"," ++
            "\"settings\":{\"format\":\"etc1s\",\"quality\":128,\"max_size\":0,\"generate_mips\":true}}",
        tex_w.buffered(),
    );

    var tex_err_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.TextureEncodeDonePayload{
        .ok = false,
        .index = 3,
        .@"error" = "image 3 out of range",
    }, .{}, &tex_err_w);
    try testing.expectEqualStrings(
        "{\"ok\":false,\"index\":3,\"error\":\"image 3 out of range\"}",
        tex_err_w.buffered(),
    );

    var prev_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.TexturePreviewDonePayload{
        .ok = true,
        .index = 1,
        .b64 = "iVBORw0KGgo",
        .width = 64,
        .height = 32,
    }, .{}, &prev_w);
    try testing.expectEqualStrings(
        "{\"ok\":true,\"index\":1,\"b64\":\"iVBORw0KGgo\",\"width\":64,\"height\":32}",
        prev_w.buffered(),
    );

    var prev_err_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.TexturePreviewDonePayload{
        .ok = false,
        .index = 4,
        .@"error" = "decode image 4: unsupported format",
    }, .{}, &prev_err_w);
    try testing.expectEqualStrings(
        "{\"ok\":false,\"index\":4,\"error\":\"decode image 4: unsupported format\"}",
        prev_err_w.buffered(),
    );

    var exp_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.ExportDonePayload{
        .ok = true,
        .src = ".zig-cache/assetty-app/opt_1.glb",
        .dst = "/tmp/model.opt.glb",
    }, .{}, &exp_w);
    try testing.expectEqualStrings(
        "{\"ok\":true,\"src\":\".zig-cache/assetty-app/opt_1.glb\",\"dst\":\"/tmp/model.opt.glb\"}",
        exp_w.buffered(),
    );

    var exp_err_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.ExportDonePayload{
        .ok = false,
        .@"error" = "source and destination are the same file",
    }, .{}, &exp_err_w);
    try testing.expectEqualStrings(
        "{\"ok\":false,\"error\":\"source and destination are the same file\"}",
        exp_err_w.buffered(),
    );
}
