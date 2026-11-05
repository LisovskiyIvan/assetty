//! The IPC service bound to the page: file browsing, glTF inspection, the
//! optimize pipeline and texture encoding.
//!
//! Every method is a thin wrapper around an `*Impl` function. The impls take
//! an allocator instead of a `*Call`, so tests cover them without a
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
const builtin = @import("builtin");
const core = @import("core");
const nanoui = @import("nanoui");
const config = @import("config");
const json = @import("json.zig");
const events = @import("events.zig");
const update = @import("update.zig");

/// Page IPC (`nanoui.Call`) exists wherever pages do (macOS, Windows, Linux
/// since nanoui 0.12's WebKitGTK backend): there it carries the call's arena
/// and window. Where pages don't exist it is `void` and bound methods are
/// never invoked; the wrappers still analyze on every platform, so they take
/// this mirror of the fields they use instead.
const has_page = nanoui.Call != void;
const Call = if (has_page) nanoui.Call else struct {
    arena: std.mem.Allocator,
    window: ?*nanoui.Window = null,
};

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
        .openDialogAt = .{"dir"},
        .dropFile = .{ "name", "b64" },
        .pickSavePath = .{"name"},
        .exportTo = .{ "src", "dst" },
        .listDir = .{"path"},
        .info = .{"path"},
        .loadBytes = .{"path"},
        .optimize = .{ "path", "preset" },
        .optimizeCustom = .{ "path", "spec" },
        .optimizeLODs = .{ "path", "spec", "ratios" },
        .textures = .{"path"},
        .textureEncode = .{ "path", "index", "settings" },
        .texturePreview = .{ "path", "index", "settings" },
        .discardFile = .{"path"},
        .presetLoad = .{"name"},
        .presetSave = .{ "name", "zon" },
        .presetSaveJson = .{ "name", "json" },
        .presetDelete = .{"name"},
        .settingsLoad = .{},
        .settingsSave = .{"text"},
        .appInfo = .{},
        .updateCheck = .{},
        .updateApply = .{},
    };

    // ---- browse -----------------------------------------------------------

    /// Native open panel: `{"path":"<abs>"}` on a pick, `{"path":null}` on
    /// cancel. Runs modally on the main thread, like every bound method.
    pub fn openDialog(self: *Backend, call: *Call) !json.Raw {
        return self.openDialogImpl(call.arena, null);
    }

    /// Same as `openDialog`, but the panel starts in `dir` when it names an
    /// existing directory; a missing/non-directory/null/blank `dir` falls
    /// back to the default location silently.
    pub fn openDialogAt(self: *Backend, call: *Call, dir: ?[]const u8) !json.Raw {
        return self.openDialogImpl(call.arena, dir);
    }

    /// Saves a dropped file (the page holds only its bytes, not a path) into
    /// `<out_dir>/drops/` so it can be opened through the normal path-based
    /// flow: `{"path":"<abs>"}`. `name` is the browser file name (sanitized,
    /// `model.glb` when blank); `b64` the file's base64 bytes. Synchronous on
    /// the main thread — fine for moderate sizes, megabyte-scale drops may
    /// stall the UI for a beat.
    pub fn dropFile(self: *Backend, call: *Call, name: []const u8, b64: []const u8) !json.Raw {
        return self.dropFileImpl(call.arena, name, b64);
    }

    /// Native save panel: `{"path":"<abs>"}` on a pick, `{"path":null}` on
    /// cancel. `name` is the file name the panel starts with (the caller's
    /// basename, or `default_save_name` when null/blank). Runs modally on the
    /// main thread, like every bound method. Headless testing is impossible
    /// (it blocks on the user), so tests cover `saveFileName` + `pathResultRaw`.
    pub fn pickSavePath(self: *Backend, call: *Call, name: ?[]const u8) !json.Raw {
        return self.pickSavePathImpl(call.arena, name);
    }

    /// Copies the file `src` to `dst` in the background: answers
    /// `{"started":true}` at once, then `exportDone`. Missing parents of
    /// `dst` are created; `dst == src` is refused; overwriting is allowed (the
    /// page confirms first). Shares the pipeline gate: short, but keeps one
    /// writer at a time.
    pub fn exportTo(self: *Backend, call: *Call, src: []const u8, dst: []const u8) !json.Raw {
        if (self.busy()) return json.errorRaw(call.arena, "busy", .{});
        return self.launch(call.arena, Target.of(call.window), .export_file, src, null, 0, dst);
    }

    /// Lists a directory: `{"path":..,"entries":[{"name","dir","size"}]}`.
    pub fn listDir(self: *Backend, call: *Call, path: []const u8) !json.Raw {
        return self.listDirImpl(call.arena, path);
    }

    // ---- inspect ----------------------------------------------------------

    /// `assetty info <path> --json`.
    pub fn info(self: *Backend, call: *Call, path: []const u8) !json.Raw {
        return self.infoImpl(call.arena, path);
    }

    /// Raw file bytes as base64: `{"size":N,"b64":".."}`.
    pub fn loadBytes(self: *Backend, call: *Call, path: []const u8) !json.Raw {
        return self.loadBytesImpl(call.arena, path);
    }

    // ---- pipeline ---------------------------------------------------------

    /// Runs `preset` in the background into
    /// `.zig-cache/assetty-app/opt_<ts>.glb` and answers `{"started":true}` at
    /// once; each step arrives as a `progress` event and the report as
    /// `optimizeDone`. `{"error":..}` comes back synchronously for a bad
    /// preset, an unreadable path or a job already running.
    pub fn optimize(self: *Backend, call: *Call, path: []const u8, preset: []const u8) !json.Raw {
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
    pub fn optimizeCustom(self: *Backend, call: *Call, path: []const u8, spec: []const u8) !json.Raw {
        if (self.busy()) return json.errorRaw(call.arena, "busy", .{});
        const resolved = specPresetOrMessage(call.arena, spec);
        const p = switch (resolved) {
            .preset => |p2| p2,
            .err => |msg| return json.errorRaw(call.arena, "{s}", .{msg}),
        };
        return self.launch(call.arena, Target.of(call.window), .optimize, path, p, 0, null);
    }

    /// Generates LODs from one source: runs the pipeline N times FROM THE
    /// SOURCE (never compounded) with the same spec but `simplify.target_ratio`
    /// overridden per rung, into `<stem>_lod<NN>.glb` files (`NN` is
    /// `round(ratio*100)`, e.g. `helmet_lod50.glb`).
    ///
    /// `spec` is the same JSON text `optimizeCustom` takes; `ratios` is a JSON
    /// array of fractions (`[0.5,0.25,0.1]`, null/blank for the default) with
    /// one simplified output per entry. Values outside `(0,1)` are dropped
    /// (`1.0` is the base file — the regular run result — not an LOD),
    /// duplicates (after `round(ratio*100)`) collapse, the ladder runs
    /// descending. A spec without a simplify step still gains one (backend
    /// defaults + the rung's `target_ratio`) — for the LODs only.
    ///
    /// Answers `{"started":true}` at once like `optimize`; each rung's steps
    /// arrive as `progress` events and the ladder as `lodsDone`. Shares the
    /// pipeline gate: one job at a time, same cancel/shutdown semantics.
    pub fn optimizeLODs(
        self: *Backend,
        call: *Call,
        path: []const u8,
        spec: []const u8,
        ratios: ?[]const u8,
    ) !json.Raw {
        if (self.busy()) return json.errorRaw(call.arena, "busy", .{});
        const resolved = specPresetOrMessage(call.arena, spec);
        const base = switch (resolved) {
            .preset => |p2| p2,
            .err => |msg| return json.errorRaw(call.arena, "{s}", .{msg}),
        };
        const ladder = parseLodRatios(call.arena, ratios) catch
            return json.errorRaw(call.arena, "invalid ratios", .{});
        if (ladder.len == 0) return json.errorRaw(call.arena, "no valid ratios", .{});
        return self.launchLods(call.arena, Target.of(call.window), path, base, ladder);
    }

    // ---- textures ---------------------------------------------------------

    /// `assetty textures <path> --json`.
    pub fn textures(self: *Backend, call: *Call, path: []const u8) !json.Raw {
        return self.texturesImpl(call.arena, path);
    }

    /// Encodes image `index` to KTX2 in the background: answers
    /// `{"started":true}` at once, then `textureEncodeDone` with the size, the
    /// PSNR, the VRAM it now needs and paths to the before/after PNGs.
    /// `settings` is a JSON object string with per-call overrides for this one
    /// image — `{"format":"etc1s"|"uastc","quality":N,"max_size":N,
    /// "generate_mips":bool,"normal_map":bool}`; omitted keys keep the host
    /// defaults (the Textures tab sends the row's effective params).
    pub fn textureEncode(
        self: *Backend,
        call: *Call,
        path: []const u8,
        index: u32,
        settings: ?[]const u8,
    ) !json.Raw {
        if (self.busy()) return json.errorRaw(call.arena, "busy", .{});
        return self.launch(call.arena, Target.of(call.window), .texture_encode, path, null, index, settings);
    }

    /// Renders image `index` as a PNG the page can show: answers
    /// `{"started":true}` at once, then `texturePreviewDone` with
    /// `{"ok":true,"index":N,"b64":"<base64 PNG>","width":W,"height":H}`.
    ///
    /// Async like `textureEncode`: decode (stb/basisu) plus PNG encode of a
    /// 2K texture is seconds, not milliseconds, so it must not run on the main
    /// thread.
    /// `settings` is accepted for call-shape symmetry with `textureEncode`
    /// (the page sends the row's params to both) but ignored: a preview
    /// renders the decoded image, which no encode setting changes.
    pub fn texturePreview(
        self: *Backend,
        call: *Call,
        path: []const u8,
        index: u32,
        settings: ?[]const u8,
    ) !json.Raw {
        _ = settings;
        if (self.previewBusy()) return json.errorRaw(call.arena, "busy", .{});
        return self.launch(call.arena, Target.of(call.window), .texture_preview, path, null, index, null);
    }

    /// Deletes a finished result file and forgets it: `{"ok":true}`. Only
    /// files strictly under `out_dir` may go (see `discardFileImpl`); anything
    /// else is refused, and a file that is already gone counts as discarded.
    /// Synchronous on the main thread — a single unlink, no pipeline work.
    pub fn discardFile(self: *Backend, call: *Call, path: []const u8) !json.Raw {
        return discardFileImpl(self.io, call.arena, path);
    }

    // ---- presets ----------------------------------------------------------

    /// Every preset on disk, sorted by name: built-ins (`presets/*.zon`) and
    /// user presets (`presets/*.json`):
    /// `[{"name":"desktop","kind":"builtin","file":"desktop.zon"}, ...]`.
    /// A hand-placed `.json` beside a `.zon` shadows it (the UI can never
    /// create this: saving refuses built-in names); the loader prefers the
    /// `.json` text too, so the two stay consistent.
    pub fn presets(self: *Backend, call: *Call) !json.Raw {
        return self.presetsImpl(call.arena);
    }

    /// The raw text of `presets/<name>.json` (user preset) or
    /// `presets/<name>.zon` (built-in): JSON wins when both exist.
    pub fn presetLoad(self: *Backend, call: *Call, name: []const u8) ![]const u8 {
        return self.presetLoadImpl(call.arena, name);
    }

    /// Writes `presets/<name>.zon`; true on success.
    pub fn presetSave(self: *Backend, call: *Call, name: []const u8, zon: []const u8) !bool {
        return self.presetSaveImpl(call.arena, name, zon);
    }

    /// Validates `preset_json` as a `{"name","steps"}` preset (the same spec
    /// validator `optimizeCustom` uses) and writes it atomically to
    /// `presets/<name>.json`: `{"ok":true}` or `{"error":".."}`.
    /// Overwriting your own preset is fine; built-in names (anything with a
    /// `.zon` beside it) are refused.
    pub fn presetSaveJson(self: *Backend, call: *Call, name: []const u8, preset_json: []const u8) !json.Raw {
        return self.presetSaveJsonImpl(call.arena, name, preset_json);
    }

    /// Deletes `presets/<name>.json`: `{"ok":true}` or `{"error":".."}`.
    /// Built-ins (`.zon`) are refused — and so are names with nothing on disk.
    pub fn presetDelete(self: *Backend, call: *Call, name: []const u8) !json.Raw {
        return self.presetDeleteImpl(call.arena, name);
    }

    /// Settings blob (`assetty.settings.json` in the cwd) as raw JSON; `{}`
    /// when the file is absent or does not hold valid JSON. The schema is the
    /// frontend's business.
    pub fn settingsLoad(self: *Backend, call: *Call) !json.Raw {
        return self.settingsLoadFrom(call.arena, settings_file);
    }

    /// Validates `text` as JSON and replaces the settings file atomically:
    /// `{"ok":true}` or `{"error":".."}`.
    pub fn settingsSave(self: *Backend, call: *Call, text: []const u8) !json.Raw {
        return self.settingsSaveTo(call.arena, settings_file, text);
    }

    // ---- update -----------------------------------------------------------

    /// This build's identity: `{"version","repo","platform","arch","asset"}`.
    /// The Settings tab shows it next to the update button; `asset` is the
    /// release artifact this platform installs (see `update.assetFor`).
    pub fn appInfo(self: *Backend, call: *Call) !json.Raw {
        return self.appInfoImpl(call.arena);
    }

    /// Compares this build to the release feed's manifest: `{"available",
    /// "current","version","asset","download_url","notes_url"}` or
    /// `{"error":..}` when the feed is unreachable. Synchronous (curl,
    /// 30s cap) — the button awaits it directly.
    pub fn updateCheck(self: *Backend, call: *Call) !json.Raw {
        return self.updateCheckImpl(call.arena, null);
    }

    /// Downloads the newer release, verifies, installs over this program,
    /// relaunches it and quits so the update takes effect at once:
    /// `{"installed":true,"version":"..","restarted":true}`;
    /// `{"installed":false,...,"restarted":false}` when already current;
    /// `{"error":..}` on failure. `restarted` is false when the new program
    /// could not be spawned — the install still stands, the user relaunches
    /// by hand. Synchronous — the UI blocks during download, like it does
    /// for a native file dialog.
    pub fn updateApply(self: *Backend, call: *Call) !json.Raw {
        return self.updateApplyImpl(call.arena, Target.of(call.window), null, null, null);
    }

    // ---- implementations --------------------------------------------------

    fn openDialogImpl(self: *Backend, a: std.mem.Allocator, dir: ?[]const u8) !json.Raw {
        // nanoui's dialog module owns the NSOpenPanel: NSOpenPanel on macOS,
        // the desktop portal on Linux, the common item dialog on Windows. It
        // is documented for use from a bound method (main thread, runModal).
        // `directory` seeds the panel's starting folder when non-empty.
        const start = self.resolveOpenDir(dir);
        const paths = nanoui.dialog.open(self.gpa, .{
            .title = "Open model",
            .directory = start orelse "",
            .extensions = &.{ "glb", "gltf" },
        }) catch null;
        defer {
            if (paths) |p| nanoui.dialog.freePaths(self.gpa, p);
        }
        const picked: ?[]const u8 = if (paths) |p| (if (p.len > 0) p[0] else null) else null;
        return pathResultRaw(a, picked);
    }

    /// Validates a starting directory for the open panel: the trimmed `dir`
    /// when it opens as a directory, null otherwise (missing, not a
    /// directory, blank). Never errors — callers fall back silently.
    fn resolveOpenDir(self: *Backend, dir: ?[]const u8) ?[]const u8 {
        const d = std.mem.trim(u8, dir orelse return null, " \t\r\n");
        if (d.len == 0) return null;
        var h = std.Io.Dir.cwd().openDir(self.io, d, .{}) catch return null;
        h.close(self.io);
        return d;
    }

    /// Decodes `b64` and writes it to `<out_dir>/drops/<epoch_ms>_<name>`:
    /// `{"path":"<abs>"}`. Every allocation comes from `a` (the call's
    /// arena); source files are never touched — only the drops dir is
    /// written. Errors come back as `{"error":..}`.
    fn dropFileImpl(self: *Backend, a: std.mem.Allocator, name: []const u8, b64: []const u8) !json.Raw {
        const max_b64: usize = std.base64.standard.Encoder.calcSize(max_load_bytes);
        if (b64.len > max_b64) return json.errorRaw(a, "drop too large ({d} bytes of base64)", .{b64.len});
        const decoded_len = std.base64.standard.Decoder.calcSizeForSlice(b64) catch
            return json.errorRaw(a, "invalid base64", .{});
        const bytes = try a.alloc(u8, decoded_len);
        std.base64.standard.Decoder.decode(bytes, b64) catch
            return json.errorRaw(a, "invalid base64", .{});

        const safe = try sanitizeDropName(a, name);
        const nanos: u64 = @intCast(@max(0, std.Io.Clock.real.now(self.io).nanoseconds));
        const rel = try std.fmt.allocPrint(
            a,
            "{s}/drops/{d}_{s}",
            .{ out_dir, @divTrunc(nanos, std.time.ns_per_ms), safe },
        );
        const parent = std.fs.path.dirname(rel) orelse return json.errorRaw(a, "bad drop path", .{});
        std.Io.Dir.cwd().createDirPath(self.io, parent) catch |err|
            return json.errorRaw(a, "drops dir: {s}", .{@errorName(err)});
        std.Io.Dir.cwd().writeFile(self.io, .{ .sub_path = rel, .data = bytes }) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ rel, @errorName(err) });
        const abs = std.Io.Dir.cwd().realPathFileAlloc(self.io, rel, a) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ rel, @errorName(err) });
        return pathResultRaw(a, abs);
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
        return self.runPipelineTo(a, path, p, out_path, sinks);
    }

    /// Same as `runPipeline` but into the caller's `out_path` (the LOD ladder
    /// names its own files). `out_dir` must already exist.
    fn runPipelineTo(
        self: *Backend,
        a: std.mem.Allocator,
        path: []const u8,
        p: core.preset.Preset,
        out_path: []const u8,
        sinks: Sinks,
    ) PipelineOutcome {
        const rep = switch (self.execPipeline(a, path, p, out_path, sinks)) {
            .done => |r| r,
            .failed => |msg| {
                sinks.logFmt("optimize failed: {s}", .{msg});
                return .{ .failed = msg };
            },
            .out_of_memory => return .out_of_memory,
        };
        sinks.logFmt("optimize \"{s}\" -> {s}", .{ p.name, out_path });

        var aw: std.Io.Writer.Allocating = .init(a);
        defer aw.deinit();
        json.writeOptimize(&aw.writer, path, out_path, p, rep) catch return .out_of_memory;
        const report = aw.toOwnedSlice() catch return .out_of_memory;
        return .{ .done = .{ .out_path = out_path, .report = json.raw(report) } };
    }

    /// Runs the pipeline once, into `out_path`. The report comes back
    /// arena-owned for the caller to mine (LOD ladders read `after`/`total_secs`
    /// off it; single runs format it as JSON).
    fn execPipeline(
        self: *Backend,
        a: std.mem.Allocator,
        path: []const u8,
        p: core.preset.Preset,
        out_path: []const u8,
        sinks: Sinks,
    ) ExecOutcome {
        const rep = core.runner.run(self.io, a, path, .{
            .preset = p,
            .out_path = out_path,
            .progress = sinks.progress,
            .progress_ctx = sinks.progress_ctx,
        }) catch |err| {
            const msg = std.fmt.allocPrint(a, "{s}: {s}", .{ path, @errorName(err) }) catch return .out_of_memory;
            return .{ .failed = msg };
        };
        return .{ .done = rep };
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

    fn presetsImpl(self: *Backend, a: std.mem.Allocator) !json.Raw {
        return self.presetsIn(a, "presets");
    }

    /// Lists the presets found in `dir`: one `{"name","kind","file"}` row per
    /// stem, sorted by name. `dir` is `"presets"` live; tests inject a scratch
    /// dir with the same layout.
    fn presetsIn(self: *Backend, a: std.mem.Allocator, dir: []const u8) !json.Raw {
        const Entry = struct { name: []const u8, kind: []const u8, file: []const u8 };
        var list: std.ArrayList(Entry) = .empty;
        var d = std.Io.Dir.cwd().openDir(self.io, dir, .{ .iterate = true }) catch return json.raw("[]");
        defer d.close(self.io);
        var it = d.iterate();
        while (it.next(self.io) catch null) |e| {
            if (e.kind != .file and e.kind != .sym_link) continue;
            var stem: ?[]const u8 = null;
            var kind: ?[]const u8 = null;
            if (std.mem.endsWith(u8, e.name, ".zon")) {
                stem = e.name[0 .. e.name.len - ".zon".len];
                kind = "builtin";
            } else if (std.mem.endsWith(u8, e.name, ".json")) {
                stem = e.name[0 .. e.name.len - ".json".len];
                kind = "user";
            } else continue;
            if (!validPresetName(stem.?)) continue;
            try list.append(a, .{
                .name = try a.dupe(u8, stem.?),
                .kind = kind.?,
                .file = try a.dupe(u8, e.name),
            });
        }
        std.mem.sort(Entry, list.items, {}, struct {
            fn lt(_: void, x: Entry, y: Entry) bool {
                if (!std.mem.eql(u8, x.name, y.name)) return std.mem.lessThan(u8, x.name, y.name);
                // "builtin" < "user": the last row of a stem run wins below,
                // so a hand-placed `.json` shadows a same-stem `.zon`.
                return std.mem.lessThan(u8, x.kind, y.kind);
            }
        }.lt);

        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        const w = &aw.writer;
        try w.writeByte('[');
        var first = true;
        var i: usize = 0;
        while (i < list.items.len) {
            var j = i;
            while (j + 1 < list.items.len and std.mem.eql(u8, list.items[j + 1].name, list.items[i].name)) j += 1;
            const e = list.items[j];
            if (!first) try w.writeByte(',');
            first = false;
            try w.writeAll("{\"name\":");
            try json.jsonStr(w, e.name);
            try w.writeAll(",\"kind\":");
            try json.jsonStr(w, e.kind);
            try w.writeAll(",\"file\":");
            try json.jsonStr(w, e.file);
            try w.writeByte('}');
            i = j + 1;
        }
        try w.writeByte(']');
        return json.raw(try aw.toOwnedSlice());
    }

    fn presetLoadImpl(self: *Backend, a: std.mem.Allocator, name: []const u8) ![]const u8 {
        return self.presetLoadFrom(a, "presets", name);
    }

    /// Raw text of `<dir>/<name>.json`, falling back to `<dir>/<name>.zon`.
    /// `dir` is `"presets"` live; tests inject a scratch dir.
    fn presetLoadFrom(self: *Backend, a: std.mem.Allocator, dir: []const u8, name: []const u8) ![]const u8 {
        if (!validPresetName(name)) return error.InvalidPresetName;
        const jpath = try std.fmt.allocPrint(a, "{s}/{s}.json", .{ dir, name });
        if (std.Io.Dir.cwd().readFileAlloc(self.io, jpath, a, .limited(max_text_bytes))) |text| {
            return text;
        } else |err| {
            if (err == error.OutOfMemory) return error.OutOfMemory;
        }
        const zpath = try std.fmt.allocPrint(a, "{s}/{s}.zon", .{ dir, name });
        return std.Io.Dir.cwd().readFileAlloc(self.io, zpath, a, .limited(max_text_bytes)) catch |err| switch (err) {
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

    fn presetSaveJsonImpl(self: *Backend, a: std.mem.Allocator, name: []const u8, preset_json: []const u8) !json.Raw {
        return self.presetSaveJsonTo(a, "presets", name, preset_json);
    }

    /// Validates `preset_json` and writes it atomically to
    /// `<dir>/<name>.json`. `dir` is `"presets"` live; tests inject a scratch
    /// dir (created up front — the atomic rename needs its parent to exist).
    fn presetSaveJsonTo(self: *Backend, a: std.mem.Allocator, dir: []const u8, name: []const u8, preset_json: []const u8) !json.Raw {
        if (!validPresetName(name)) return error.InvalidPresetName;
        const zpath = try std.fmt.allocPrint(a, "{s}/{s}.zon", .{ dir, name });
        if (std.Io.Dir.cwd().statFile(self.io, zpath, .{})) |_| {
            return json.errorRaw(a, "cannot overwrite builtin preset \"{s}\"", .{name});
        } else |_| {}
        if (preset_json.len > max_text_bytes) return json.errorRaw(a, "preset too large", .{});
        switch (specPresetOrMessage(a, preset_json)) {
            .preset => {},
            .err => |msg| return json.errorRaw(a, "{s}", .{msg}),
        }
        const jpath = try std.fmt.allocPrint(a, "{s}/{s}.json", .{ dir, name });
        var atomic = std.Io.Dir.cwd().createFileAtomic(self.io, jpath, .{ .replace = true }) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ jpath, @errorName(err) });
        defer atomic.deinit(self.io);

        var buf: [8192]u8 = undefined;
        var fw = atomic.file.writer(self.io, &buf);
        fw.interface.writeAll(preset_json) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ jpath, @errorName(err) });
        fw.flush() catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ jpath, @errorName(err) });
        atomic.replace(self.io) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ jpath, @errorName(err) });
        return json.raw("{\"ok\":true}");
    }

    fn presetDeleteImpl(self: *Backend, a: std.mem.Allocator, name: []const u8) !json.Raw {
        return self.presetDeleteFrom(a, "presets", name);
    }

    /// Deletes `<dir>/<name>.json`. `dir` is `"presets"` live; tests inject a
    /// scratch dir with the same layout.
    fn presetDeleteFrom(self: *Backend, a: std.mem.Allocator, dir: []const u8, name: []const u8) !json.Raw {
        if (!validPresetName(name)) return error.InvalidPresetName;
        const zpath = try std.fmt.allocPrint(a, "{s}/{s}.zon", .{ dir, name });
        if (std.Io.Dir.cwd().statFile(self.io, zpath, .{})) |_| {
            return json.errorRaw(a, "cannot delete builtin preset \"{s}\"", .{name});
        } else |_| {}
        const jpath = try std.fmt.allocPrint(a, "{s}/{s}.json", .{ dir, name });
        std.Io.Dir.cwd().deleteFile(self.io, jpath) catch |err| {
            if (err == error.FileNotFound)
                return json.errorRaw(a, "preset \"{s}\" not found", .{name});
            return json.errorRaw(a, "{s}: {s}", .{ jpath, @errorName(err) });
        };
        return json.raw("{\"ok\":true}");
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

    // ---- update impls -----------------------------------------------------

    fn appInfoImpl(self: *Backend, a: std.mem.Allocator) !json.Raw {
        _ = self;
        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        const w = &aw.writer;
        try w.writeAll("{\"version\":");
        try json.jsonStr(w, config.version);
        try w.writeAll(",\"repo\":");
        try json.jsonStr(w, config.repo);
        try w.print(",\"platform\":\"{s}\",\"arch\":\"{s}\",\"asset\":", .{ @tagName(builtin.os.tag), @tagName(builtin.cpu.arch) });
        try json.jsonStr(w, update.asset_name);
        try w.writeByte('}');
        return json.raw(try aw.toOwnedSlice());
    }

    /// `feed` overrides the repo's release feed (tests pass a `file://`
    /// dir); null means the default.
    fn updateCheckImpl(self: *Backend, a: std.mem.Allocator, feed: ?[]const u8) !json.Raw {
        const f = feed orelse try update.feedDefault(a, config.repo);
        const c = update.check(a, self.io, f, config.repo, update.asset_name, update.comparable(config.version)) catch |err|
            return json.errorRaw(a, "update check: {s}", .{@errorName(err)});
        var aw: std.Io.Writer.Allocating = .init(a);
        errdefer aw.deinit();
        const w = &aw.writer;
        try w.print("{{\"available\":{s},\"current\":", .{if (c.available) "true" else "false"});
        try json.jsonStr(w, c.current);
        try w.writeAll(",\"version\":");
        try json.jsonStr(w, c.version);
        try w.writeAll(",\"asset\":");
        try json.jsonStr(w, c.asset);
        try w.writeAll(",\"download_url\":");
        try json.jsonStr(w, c.download_url);
        try w.writeAll(",\"notes_url\":");
        try json.jsonStr(w, c.notes_url);
        try w.writeByte('}');
        return json.raw(try aw.toOwnedSlice());
    }

    /// `feed`/`exe`/`cache_dir` override the live paths (tests inject a
    /// feed dir, a scratch program and a scratch cache); nulls resolve to
    /// the release feed, the running program and the system cache dir.
    /// `target` carries the window/app to quit after the reply is out; a
    /// null app (tests) skips the quit while still exercising the spawn.
    fn updateApplyImpl(
        self: *Backend,
        a: std.mem.Allocator,
        target: Target,
        feed: ?[]const u8,
        exe: ?[]const u8,
        cache_dir: ?[]const u8,
    ) !json.Raw {
        const f = feed orelse try update.feedDefault(a, config.repo);
        const program = exe orelse try std.process.executablePathAlloc(self.io, a);
        const cache = cache_dir orelse try nanoui.path(a, .cache, "assetty");
        switch (update.apply(a, self.io, f, config.repo, update.asset_name, update.comparable(config.version), program, cache)) {
            .installed => |i| {
                // Spawn now (its success is known synchronously and reported
                // back) but quit only after the reply reaches the page: the
                // quit is posted to the main thread, which runs it once this
                // binding's reply is delivered. `Backend.shutdown` (deferred
                // in `main`) then turns late job deliveries into no-ops.
                const restarted = update.relaunch(self.io, program);
                if (restarted) quitSoon(target);
                var aw: std.Io.Writer.Allocating = .init(a);
                errdefer aw.deinit();
                try aw.writer.print("{{\"installed\":true,\"version\":", .{});
                try json.jsonStr(&aw.writer, i.version);
                try aw.writer.print(",\"restarted\":{s}}}", .{if (restarted) "true" else "false"});
                return json.raw(try aw.toOwnedSlice());
            },
            .up_to_date => |u| {
                var aw: std.Io.Writer.Allocating = .init(a);
                errdefer aw.deinit();
                try aw.writer.writeAll("{\"installed\":false,\"version\":");
                try json.jsonStr(&aw.writer, u.version);
                try aw.writer.writeAll(",\"restarted\":false}");
                return json.raw(try aw.toOwnedSlice());
            },
            .failed => |msg| return json.errorRaw(a, "{s}", .{msg}),
        }
    }

    /// Quits the app on the main thread, soon: posted (not called) so the
    /// binding's `{installed:true}` reply is delivered to the page first and
    /// the fresh program takes over after. No-op without an app (tests).
    fn quitSoon(target: Target) void {
        const app = target.app orelse return;
        nanoui.App.onMain(app, quitApp);
    }

    fn quitApp(ctx: ?*anyopaque) callconv(.c) void {
        const app: *nanoui.App = @ptrCast(@alignCast(ctx.?));
        app.quit();
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
        _ = self.spawn(target, kind, path, p, index, extra, null) catch |err| switch (err) {
            error.Busy => return json.errorRaw(a, "busy", .{}),
            error.OutOfMemory => return error.OutOfMemory,
            error.SpawnFailed => return json.errorRaw(a, "cannot start a worker thread", .{}),
        };
        return json.raw(started_reply);
    }

    /// Validates `path`, hands the LOD ladder to a worker and answers
    /// `{"started":true}`. `ladder` is already parsed, filtered and sorted
    /// (see `parseLodRatios`); the worker deep-copies it again via `spawn`.
    fn launchLods(
        self: *Backend,
        a: std.mem.Allocator,
        target: Target,
        path: []const u8,
        p: core.preset.Preset,
        ladder: []const f32,
    ) !json.Raw {
        if (self.busy()) return json.errorRaw(a, "busy", .{});
        _ = std.Io.Dir.cwd().statFile(self.io, path, .{}) catch |err|
            return json.errorRaw(a, "{s}: {s}", .{ path, @errorName(err) });
        _ = self.spawn(target, .optimize_lods, path, p, 0, null, ladder) catch |err| switch (err) {
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
        ratios: ?[]const f32,
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
        // The LOD ladder; null for every other kind.
        const ratios_copy: ?[]f32 = if (ratios) |r| try gpa.dupe(f32, r) else null;
        errdefer {
            if (ratios_copy) |copy| gpa.free(copy);
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
            .ratios = ratios_copy,
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

const JobKind = enum { optimize, optimize_lods, texture_encode, texture_preview, export_file };

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

    fn progress(ctx: ?*anyopaque, step: []const u8, pct: f32, sub: ?core.runner.ProgressSub) void {
        const self: *WindowSink = @ptrCast(@alignCast(ctx orelse return));
        events.Progress.emit(self.window, .{
            .step = step,
            .pct = pct,
            .sub = if (sub) |s| .{ .label = s.label, .done = s.done, .total = s.total } else null,
        });
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

/// How one pipeline execution ended. The report is arena-owned.
const ExecOutcome = union(enum) {
    done: core.runner.Report,
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

// ---- LOD ladders ------------------------------------------------------------

// One finished ladder rung, owned by the job (`Job.destroy` frees `out_path`).
const LodOwned = struct {
    ratio: f32,
    out_path: []u8,
    disk_bytes: u64,
    triangles: u64,
    secs: f64,
};

/// Default ladder when the binding gets null/blank ratios: the simplified
/// rungs only — the base file is the regular run result.
const default_lod_ladder = [_]f32{ 0.5, 0.25, 0.1 };

/// Parses the `ratios` argument of `optimizeLODs`: a JSON array of fractions.
/// Null/blank means the default ladder. Non-numbers are skipped; values
/// outside `(0,1)` are dropped; the rest is sorted descending with
/// `round(x*100)` duplicates collapsed (one file per `<stem>_lod<NN>.glb` name).
fn parseLodRatios(a: std.mem.Allocator, text: ?[]const u8) error{ OutOfMemory, InvalidRatios }![]f32 {
    const t = std.mem.trim(u8, text orelse "", " \t\r\n");
    if (t.len == 0) return try a.dupe(f32, &default_lod_ladder);
    var parsed = std.json.parseFromSlice(std.json.Value, a, t, .{}) catch
        return error.InvalidRatios;
    defer parsed.deinit();
    const items = switch (parsed.value) {
        .array => |arr| arr.items,
        else => return error.InvalidRatios,
    };
    var out: std.ArrayList(f32) = .empty;
    for (items) |item| {
        const r: f32 = switch (item) {
            .float => |f| std.math.lossyCast(f32, f),
            .integer => |i| @floatFromInt(i),
            else => continue,
        };
        if (!(r > 0 and r < 1)) continue;
        try out.append(a, r);
    }
    const ladder = try out.toOwnedSlice(a);
    std.mem.sort(f32, ladder, {}, struct {
        fn lt(_: void, x: f32, y: f32) bool {
            return x > y;
        }
    }.lt);
    // Collapse `round(x*100)` duplicates (they would share a file name).
    var n: usize = 0;
    var prev_pct: ?u32 = null;
    for (ladder) |r| {
        const pct: u32 = @intFromFloat(@round(r * 100));
        if (prev_pct == pct) continue;
        prev_pct = pct;
        ladder[n] = r;
        n += 1;
    }
    return ladder[0..n];
}

/// Clones `base` with `simplify.target_ratio = ratio`. When the spec has no
/// simplify step, one is appended with the backend defaults (simplify is the
/// canonical last step, so appending keeps the order). Step slices are
/// shallow-copied (texture overrides stay shared, read-only during the run).
fn lodPresetFor(a: std.mem.Allocator, base: core.preset.Preset, ratio: f32) !core.preset.Preset {
    const steps = try a.dupe(core.preset.Step, base.steps);
    for (steps) |*s| {
        if (s.* == .simplify) {
            s.simplify.target_ratio = ratio;
            return .{ .name = base.name, .target = base.target, .steps = steps };
        }
    }
    const grown = try a.alloc(core.preset.Step, steps.len + 1);
    @memcpy(grown[0..steps.len], steps);
    const d = core.preset.SimplifyParams{};
    grown[steps.len] = .{ .simplify = .{
        .target_ratio = ratio,
        .error_tolerance = d.error_tolerance,
        .aggressive = d.aggressive,
        .lock_borders = d.lock_borders,
        .use_attributes = d.use_attributes,
        .weight_normal = d.weight_normal,
        .weight_uv = d.weight_uv,
    } };
    return .{ .name = base.name, .target = base.target, .steps = grown };
}

/// `<out_dir>/<stem>_lod<NN>.glb`: `stem` is the source's file stem,
/// `NN` is `round(ratio*100)` (`box_lod50.glb`).
fn lodOutName(a: std.mem.Allocator, src_path: []const u8, ratio: f32) ![]u8 {
    const base = std.fs.path.basename(src_path);
    const stem = std.fs.path.stem(base);
    const clean = if (stem.len == 0) "model" else stem;
    const pct: u32 = @intFromFloat(@round(ratio * 100));
    return try std.fmt.allocPrint(a, "{s}/{s}_lod{d}.glb", .{ out_dir, clean, pct });
}

/// One finished ladder rung with arena-owned paths (the sync entry point the
/// tests use: same semantics as the worker's loop, minus progress).
const LodItem = struct {
    ratio: f32,
    out_path: []const u8,
    disk_bytes: u64,
    triangles: u64,
    secs: f64,
};

const LodSyncOutcome = union(enum) {
    done: []LodItem,
    failed: []const u8,
    out_of_memory,
};

/// Runs the whole ladder synchronously, on the calling thread: the entry
/// point the tests (and any non-UI caller) use. Every rung starts from `path`
/// (the source is never modified); `ratios` must already be parsed, filtered
/// and sorted (see `parseLodRatios`).
fn lodRunSync(
    self: *Backend,
    a: std.mem.Allocator,
    path: []const u8,
    base: core.preset.Preset,
    ratios: []const f32,
    sinks: Sinks,
) LodSyncOutcome {
    std.Io.Dir.cwd().createDirPath(self.io, out_dir) catch |err| {
        const msg = std.fmt.allocPrint(a, "out dir: {s}", .{@errorName(err)}) catch return .out_of_memory;
        return .{ .failed = msg };
    };
    var out: std.ArrayList(LodItem) = .empty;
    errdefer out.deinit(a);
    for (ratios) |ratio| {
        const preset = lodPresetFor(a, base, ratio) catch return .out_of_memory;
        const out_path = lodOutName(a, path, ratio) catch return .out_of_memory;
        const rep = switch (self.execPipeline(a, path, preset, out_path, sinks)) {
            .done => |r| r,
            .failed => |msg| return .{ .failed = msg },
            .out_of_memory => return .out_of_memory,
        };
        const st = std.Io.Dir.cwd().statFile(self.io, out_path, .{}) catch |err| {
            const msg = std.fmt.allocPrint(a, "{s}: {s}", .{ out_path, @errorName(err) }) catch return .out_of_memory;
            return .{ .failed = msg };
        };
        out.append(a, .{
            .ratio = ratio,
            .out_path = out_path,
            .disk_bytes = st.size,
            .triangles = rep.after.triangles,
            .secs = rep.total_secs,
        }) catch return .out_of_memory;
    }
    return .{ .done = out.toOwnedSlice(a) catch return .out_of_memory };
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
    /// Extra argument: the `export_file` destination, or the `texture_encode`
    /// settings JSON text; null for every other kind.
    arg: ?[]u8 = null,
    /// The LOD ladder for `optimize_lods` (job-owned copy); null otherwise.
    ratios: ?[]f32 = null,
    /// LOD progress frame: `lod_done` rungs of `lod_total` finished. Step
    /// progress without its own sub (everything but the textures step) is
    /// forwarded with `sub = {label:"lods", done, total}`; the textures
    /// step's own `{label:"texture"}` sub passes through unchanged.
    lod_done: u32 = 0,
    lod_total: u32 = 0,
    /// Set by the worker before it posts: null means it failed, see `err`.
    result: ?Result = null,
    /// Failure message, formatted in place: the error path never allocates.
    err_buf: [512]u8 = undefined,
    err_len: usize = 0,

    const Result = union(enum) {
        /// `{"out_path","report"}`: the written file and its report JSON.
        optimize: struct { out_path: []u8, report: []u8 },
        /// One LOD ladder: a rung per ratio, in ladder (descending) order.
        lods: []LodOwned,
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
            .optimize_lods => self.runOptimizeLods(),
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

    /// The whole LOD ladder, on this thread: one pipeline run per ratio, every
    /// run from the SOURCE file. Files land in `out_dir` as `<stem>_lod<NN>.glb`.
    fn runOptimizeLods(self: *Job) void {
        const base = self.preset orelse return self.fail("no preset", .{});
        const ratios = self.ratios orelse return self.fail("no ratios", .{});
        std.Io.Dir.cwd().createDirPath(self.io, out_dir) catch |e|
            return self.fail("out dir: {s}", .{@errorName(e)});
        self.lod_total = @intCast(ratios.len);

        var owned: std.ArrayList(LodOwned) = .empty;
        errdefer {
            for (owned.items) |item| self.gpa.free(item.out_path);
            owned.deinit(self.gpa);
        }
        for (ratios, 0..) |ratio, i| {
            self.lod_done = @intCast(i);
            const rung = self.runSingleLod(base, ratio) orelse return; // fail() already recorded
            owned.append(self.gpa, rung) catch {
                self.gpa.free(rung.out_path);
                return self.fail("out of memory", .{});
            };
        }
        self.result = .{ .lods = owned.toOwnedSlice(self.gpa) catch
            return self.fail("out of memory", .{}) };
    }

    /// One ladder rung: clone `base` with `simplify.target_ratio = ratio` (or
    /// gain a default simplify step), run it from the source, adopt the file
    /// path into `gpa`. Null when the rung failed (the reason is recorded).
    fn runSingleLod(self: *Job, base: core.preset.Preset, ratio: f32) ?LodOwned {
        var arena: std.heap.ArenaAllocator = .init(self.gpa);
        defer arena.deinit();
        const a = arena.allocator();
        const preset = lodPresetFor(a, base, ratio) catch return self.failOOM();
        const out_path = lodOutName(a, self.path, ratio) catch return self.failOOM();
        const rep = switch (self.backend.execPipeline(a, self.path, preset, out_path, self.sinks())) {
            .done => |r| r,
            .failed => |msg| {
                self.sinks().logFmt("lods failed: {s}", .{msg});
                return self.failMsg(msg);
            },
            .out_of_memory => return self.failOOM(),
        };
        const st = std.Io.Dir.cwd().statFile(self.io, out_path, .{}) catch |e| {
            self.fail("{s}: {s}", .{ out_path, @errorName(e) });
            return null;
        };
        const owned_path = self.gpa.dupe(u8, out_path) catch return self.failOOM();
        return .{
            .ratio = ratio,
            .out_path = owned_path,
            .disk_bytes = st.size,
            .triangles = rep.after.triangles,
            .secs = rep.total_secs,
        };
    }

    fn failOOM(self: *Job) ?LodOwned {
        self.fail("out of memory", .{});
        return null;
    }

    fn failMsg(self: *Job, msg: []const u8) ?LodOwned {
        self.fail("{s}", .{msg});
        return null;
    }

    fn runTextureEncode(self: *Job) void {
        var arena: std.heap.ArenaAllocator = .init(self.gpa);
        defer arena.deinit();
        const outcome = encodeTexture(self.io, arena.allocator(), self.path, self.index, self.arg) catch
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

    fn onProgress(ctx: ?*anyopaque, step: []const u8, pct: f32, sub: ?core.runner.ProgressSub) void {
        const self: *Job = @ptrCast(@alignCast(ctx orelse return));
        self.postProgress(step, pct, sub);
    }

    fn onLog(ctx: ?*anyopaque, line: []const u8) void {
        const self: *Job = @ptrCast(@alignCast(ctx orelse return));
        self.postLog(line);
    }

    /// `step` points into this job's arena, which ends with the run: copy it
    /// and hand it to the main thread. `sub` is plain counters (the label is
    /// a static token), so it copies by value. LOD rungs without their own
    /// sub travel with `{label:"lods"}` so the page can frame them.
    fn postProgress(self: *Job, step: []const u8, pct: f32, sub: ?core.runner.ProgressSub) void {
        const app = self.target.app orelse return;
        const window = self.target.window orelse return;
        const copy = self.gpa.dupe(u8, step) catch return;
        const eff_sub: ?core.runner.ProgressSub = if (sub) |s| s else if (self.kind == .optimize_lods)
            .{ .label = "lods", .done = self.lod_done, .total = self.lod_total }
        else
            null;
        const posted = postToMain(ProgressMsg, self.gpa, .{
            .gpa = self.gpa,
            .app = app,
            .window = window,
            .step = copy,
            .pct = pct,
            .sub = if (eff_sub) |s| .{ .label = s.label, .done = s.done, .total = s.total } else null,
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
        if (self.ratios) |r| gpa.free(r);
        if (self.result) |res| switch (res) {
            .optimize => |o| {
                gpa.free(o.out_path);
                gpa.free(o.report);
            },
            .lods => |items| {
                for (items) |item| gpa.free(item.out_path);
                gpa.free(items);
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
    sub: ?events.ProgressSub = null,

    fn run(ctx: ?*anyopaque) callconv(.c) void {
        const self: *ProgressMsg = @ptrCast(@alignCast(ctx));
        const gpa = self.gpa;
        defer gpa.destroy(self);
        defer gpa.free(self.step);
        if (shutting_down.load(.acquire)) return;
        if (!windowAlive(self.app, self.window)) return;
        events.Progress.emit(self.window, .{ .step = self.step, .pct = self.pct, .sub = self.sub });
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
            .lods => |items| {
                // `items` (and their paths) die with `job.destroy()` below;
                // the event serializes synchronously, so borrowing is safe.
                const payload = job.gpa.alloc(events.LodsItemPayload, items.len) catch {
                    events.LodsDone.emit(window, .{ .ok = false, .@"error" = "out of memory" });
                    return;
                };
                for (items, 0..) |item, i| payload[i] = .{
                    .ratio = item.ratio,
                    .out_path = item.out_path,
                    .disk_bytes = item.disk_bytes,
                    .triangles = item.triangles,
                    .secs = item.secs,
                };
                events.LodsDone.emit(window, .{ .ok = true, .results = payload });
                job.gpa.free(payload);
            },
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
        .optimize_lods => events.LodsDone.emit(window, .{
            .ok = false,
            .@"error" = if (job.err_len > 0) job.err() else "lods failed",
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
    const steps = try gpa.dupe(core.preset.Step, p.steps);
    errdefer gpa.free(steps);
    // Override AND rule slices (and their name strings) point into the call's
    // arena, which dies with the call; the job outlives it, so deep-copy them.
    for (steps) |*s| {
        if (s.* == .textures) {
            if (s.textures.overrides.len > 0) {
                const ov = try gpa.dupe(core.preset.TextureOverride, s.textures.overrides);
                errdefer gpa.free(ov);
                for (ov) |*o| {
                    if (o.name.len > 0) o.name = try gpa.dupe(u8, o.name);
                }
                s.textures.overrides = ov;
            }
            if (s.textures.rules.len > 0) {
                const rl = try gpa.dupe(core.preset.TexRule, s.textures.rules);
                errdefer gpa.free(rl);
                for (rl) |*r| {
                    if (r.name.len > 0) r.name = try gpa.dupe(u8, r.name);
                }
                s.textures.rules = rl;
            }
        }
    }
    return .{ .name = name, .target = p.target, .steps = steps };
}

fn freePreset(gpa: std.mem.Allocator, p: core.preset.Preset) void {
    for (p.steps) |s| {
        if (s == .textures) {
            for (s.textures.overrides) |o| {
                if (o.name.len > 0) gpa.free(o.name);
            }
            if (s.textures.overrides.len > 0) gpa.free(s.textures.overrides);
            for (s.textures.rules) |r| {
                if (r.name.len > 0) gpa.free(r.name);
            }
            if (s.textures.rules.len > 0) gpa.free(s.textures.rules);
        }
    }
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
/// before/after PNGs. `settings_text` carries optional per-call overrides
/// (see `parseEncodeOverride`).
fn encodeTexture(
    io: std.Io,
    a: std.mem.Allocator,
    path: []const u8,
    index: u32,
    settings_text: ?[]const u8,
) error{OutOfMemory}!EncodeOutcome {
    var loaded = core.parse.loadFile(io, a, path) catch |err|
        return .{ .failed = try std.fmt.allocPrint(a, "{s}: {s}", .{ path, @errorName(err) }) };
    defer loaded.deinit();
    if (index >= loaded.asset.images.len)
        return .{ .failed = try std.fmt.allocPrint(a, "image {d} out of range ({d} images)", .{ index, loaded.asset.images.len }) };

    const ov = parseEncodeOverride(a, settings_text);
    const enc = encodeImage(a, loaded.asset.images[index], index, ov) catch |err| switch (err) {
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

/// Per-call override for a single-image encode: present fields replace the
/// host defaults; absent keys keep them (including the name-based normal-map
/// detection).
const EncodeOverride = struct {
    mode: ?core.encode_ktx.Mode = null,
    quality: ?u8 = null,
    max_size: ?u32 = null,
    generate_mips: ?bool = null,
    normal_map: ?bool = null,
};

/// Parses the `settings` argument of `textureEncode`: a JSON object string
/// with `format` ("etc1s"/"uastc"; "auto" and unknown strings keep the
/// default), `quality`, `max_size`, `generate_mips`, `normal_map`. Lenient
/// like the step specs: invalid JSON, wrong types or unknown keys leave the
/// default in place instead of failing the encode.
fn parseEncodeOverride(a: std.mem.Allocator, text: ?[]const u8) EncodeOverride {
    var ov: EncodeOverride = .{};
    const t = std.mem.trim(u8, text orelse return ov, " \t\r\n");
    if (t.len == 0) return ov;
    var parsed = std.json.parseFromSlice(std.json.Value, a, t, .{}) catch return ov;
    defer parsed.deinit();
    const fields = switch (parsed.value) {
        .object => |o| o,
        else => return ov,
    };
    if (fields.get("format")) |f| {
        switch (f) {
            .string => |s| {
                if (std.mem.eql(u8, s, "uastc")) ov.mode = .uastc;
                if (std.mem.eql(u8, s, "etc1s")) ov.mode = .etc1s;
            },
            else => {},
        }
    }
    if (fields.get("quality")) |q| {
        switch (q) {
            .integer => |i| ov.quality = std.math.cast(u8, i),
            else => {},
        }
    }
    if (fields.get("max_size")) |m| {
        switch (m) {
            .integer => |i| ov.max_size = std.math.cast(u32, i),
            else => {},
        }
    }
    if (fields.get("generate_mips")) |g| {
        switch (g) {
            .bool => |b| ov.generate_mips = b,
            else => {},
        }
    }
    if (fields.get("normal_map")) |nm| {
        switch (nm) {
            .bool => |b| ov.normal_map = b,
            else => {},
        }
    }
    return ov;
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

/// Longest sanitized drop name, in bytes (not glyphs).
const max_drop_name: usize = 120;

/// Sanitizes a browser file name for `<out_dir>/drops/`: strips path
/// components (both `/` and `\` separators), keeps only `[A-Za-z0-9._-]`
/// (anything else becomes `_`), caps the length, and falls back to
/// `model.glb` when nothing usable remains (blank, all stripped, `.`/`..`).
fn sanitizeDropName(a: std.mem.Allocator, name: []const u8) ![]const u8 {
    const trimmed = std.mem.trim(u8, name, " \t\r\n");
    // Basename over both separators: browsers send bare names, but a hostile
    // or odd page could send a path.
    var base = trimmed;
    if (std.mem.lastIndexOfAny(u8, base, "/\\")) |i| base = base[i + 1 ..];
    const capped = base[0..@min(base.len, max_drop_name)];
    const buf = try a.alloc(u8, capped.len);
    var n: usize = 0;
    for (capped) |ch| {
        const ok = std.ascii.isAlphanumeric(ch) or ch == '.' or ch == '_' or ch == '-';
        buf[n] = if (ok) ch else '_';
        n += 1;
    }
    const out = buf[0..n];
    if (out.len == 0 or std.mem.eql(u8, out, ".") or std.mem.eql(u8, out, "..")) {
        a.free(buf);
        return try a.dupe(u8, "model.glb");
    }
    // A name of only dots (e.g. "...") is harmless on disk, keep it.
    return out;
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

/// Deletes a finished result file: `{"ok":true}`. Safety first — both
/// `out_dir` and the target are resolved to canonical absolute paths and the
/// target must sit strictly under `out_dir` (prefix + separator + longer),
/// so `..`, symlinks and absolute escapes cannot reach anything else. A file
/// that is already gone (unresolvable or unlink reports it missing) counts as
/// discarded: the UI treats discard as idempotent.
fn discardFileImpl(io: std.Io, a: std.mem.Allocator, path: []const u8) !json.Raw {
    const trimmed = std.mem.trim(u8, path, " \t\r\n");
    if (trimmed.len == 0) return json.errorRaw(a, "empty path", .{});
    const out_abs = std.Io.Dir.cwd().realPathFileAlloc(io, out_dir, a) catch
        return json.errorRaw(a, "only results in .zig-cache/assetty-app can be discarded", .{});
    const target_abs = std.Io.Dir.cwd().realPathFileAlloc(io, trimmed, a) catch
        return json.raw("{\"ok\":true}");
    if (!isUnderDir(target_abs, out_abs))
        return json.errorRaw(a, "only results in .zig-cache/assetty-app can be discarded", .{});
    std.Io.Dir.cwd().deleteFile(io, target_abs) catch |err| {
        if (err == error.FileNotFound) return json.raw("{\"ok\":true}");
        return json.errorRaw(a, "{s}: {s}", .{ trimmed, @errorName(err) });
    };
    return json.raw("{\"ok\":true}");
}

/// Strict containment: `target` is longer than `dir`, starts with it, and the
/// next byte is a separator — so `dir` itself and `dir-sibling` never match.
fn isUnderDir(target: []const u8, dir: []const u8) bool {
    if (target.len <= dir.len) return false;
    if (!std.mem.startsWith(u8, target, dir)) return false;
    return target[dir.len] == std.fs.path.sep;
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
///
/// Shared with the CLI: the parse lives in `core.spec_json`, this is a thin
/// error-set alias so the call sites below keep their `SpecError` type.
/// TODO(cleanup): retire the dead parser helpers left below
/// (`presetFromSpecValue`, `stepFromSpec`, `SpecParams`,
/// `parseTextureOverrides`) once the app's spec tests move to core.
fn customPresetFromSpec(
    a: std.mem.Allocator,
    spec: []const u8,
    detail: *[]const u8,
) SpecError!core.preset.Preset {
    return core.spec_json.parseSpec(a, spec, detail);
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
            steps[n] = try stepFromSpec(a, kind, params, detail);
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

    /// `"none"`/`"zstd"`; anything unrecognised falls back to `.none` (the
    /// byte-compat default).
    fn supercompressionField(self: *SpecParams, name: []const u8) SpecError!?core.encode_ktx.Supercompression {
        const s = switch (self.get(name) orelse return null) {
            .string => |s| s,
            else => return self.bad(),
        };
        return std.meta.stringToEnum(core.encode_ktx.Supercompression, s) orelse .none;
    }
};

/// Parse the textures step's `overrides` array (see the pipeline contract).
/// Lenient on purpose: a missing/non-array value means no overrides, a
/// non-object item is skipped, and a mistyped field keeps its default.
/// Unknown keys are ignored, like the step params themselves. An unknown
/// format string leaves the override's format unset (it must not silently
/// become `.auto`, which is a real value here).
fn parseTextureOverrides(a: std.mem.Allocator, v: ?std.json.Value) SpecError![]core.preset.TextureOverride {
    const items = switch (v orelse return &.{}) {
        .array => |arr| arr.items,
        else => return &.{},
    };
    var out: std.ArrayList(core.preset.TextureOverride) = .empty;
    for (items) |item| {
        const fields = switch (item) {
            .object => |o| o,
            else => continue,
        };
        var o: core.preset.TextureOverride = .{};
        if (fields.get("image")) |iv| {
            if (iv == .integer) o.image = std.math.cast(u32, iv.integer);
        }
        if (fields.get("name")) |nv| {
            if (nv == .string) o.name = try a.dupe(u8, nv.string);
        }
        if (fields.get("skip")) |sv| {
            if (sv == .bool) o.skip = sv.bool;
        }
        if (fields.get("format")) |fv| {
            if (fv == .string) {
                if (std.meta.stringToEnum(core.preset.TextureFormat, fv.string)) |f| o.format = f;
            }
        }
        if (fields.get("quality")) |qv| {
            if (qv == .integer) o.quality = std.math.cast(u8, qv.integer);
        }
        if (fields.get("max_size")) |mv| {
            if (mv == .integer) o.max_size = std.math.cast(u32, mv.integer);
        }
        if (fields.get("generate_mips")) |gv| {
            if (gv == .bool) o.generate_mips = gv.bool;
        }
        if (fields.get("normal_map")) |nmv| {
            if (nmv == .bool) o.normal_map = nmv.bool;
        }
        if (fields.get("supercompression")) |scv| {
            if (scv == .string) {
                if (std.meta.stringToEnum(core.encode_ktx.Supercompression, scv.string)) |s| o.supercompression = s;
            }
        }
        try out.append(a, o);
    }
    if (out.items.len == 0) return &.{};
    return try out.toOwnedSlice(a);
}

fn stepFromSpec(
    a: std.mem.Allocator,
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
                .animations = (try r.boolField("animations")) orelse d.animations,
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
                .supercompression = (try r.supercompressionField("supercompression")) orelse d.supercompression,
                .overrides = try parseTextureOverrides(a, r.get("overrides")),
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
fn encodeImage(a: std.mem.Allocator, img: core.model.Image, idx: u32, ov: EncodeOverride) !?EncodedPixels {
    const bytes = img.data orelse return null;
    const dec = core.decode.decodeRgba(a, bytes) orelse return null;

    const is_normal = ov.normal_map orelse
        (if (img.name) |n| containsIgnoreCase(n, "normal") else false);
    var opts: core.encode_ktx.Options = .{ .normal_map = is_normal };
    if (ov.mode) |m| opts.mode = m;
    if (ov.quality) |q| opts.quality = q;
    if (ov.max_size) |ms| opts.max_size = ms;
    if (ov.generate_mips) |g| opts.generate_mips = g;

    // `max_size` is a downscale: fit here so the round-trip check below can
    // compare against the *encoded* dimensions (core encode() would resize
    // internally and the mismatch would read as "not encodable").
    var px = dec.pixels;
    var w = dec.width;
    var h = dec.height;
    const req_max = opts.max_size;
    if (opts.max_size > 0 and (w > opts.max_size or h > opts.max_size)) {
        const fitted = core.mips.fitMaxSize(a, px, w, h, opts.max_size) catch return null;
        px = fitted.pixels;
        w = fitted.w;
        h = fitted.h;
        opts.max_size = 0;
    }

    const out = try core.encode_ktx.encode(a, px, w, h, opts);
    const rt = try core.encode_ktx.decodeToRgba(a, out.ktx2);
    if (rt.width != w or rt.height != h) return null;

    const levels = mipLevelsFor(w, h);
    const vram_before = core.formats.mipChainBytes(w, h, 37, levels); // VK_FORMAT_R8G8B8A8_UNORM
    return .{
        .result = .{
            .index = idx,
            .name = img.name,
            .width = w,
            .height = h,
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
            .psnr_db = core.encode_ktx.psnr(px, rt.pixels),
        },
        .before = .{ .rgba = px, .width = w, .height = h },
        .after = .{ .rgba = rt.pixels, .width = rt.width, .height = rt.height },
        .mode = opts.mode,
        .quality = opts.quality,
        .max_size = req_max,
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

test "presets impl lists builtins with kind and file" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    const r = try b.presetsImpl(arena.allocator());
    var parsed = try std.json.parseFromSlice(std.json.Value, arena.allocator(), r.text, .{});
    defer parsed.deinit();
    const items = switch (parsed.value) {
        .array => |arr| arr.items,
        else => return error.TestUnexpectedResult,
    };
    try testing.expect(items.len >= 3);
    // Sorted by name: desktop first, with its kind and file.
    const first = items[0].object;
    try testing.expectEqualStrings("desktop", first.get("name").?.string);
    try testing.expectEqualStrings("builtin", first.get("kind").?.string);
    try testing.expectEqualStrings("desktop.zon", first.get("file").?.string);
}

test "presetLoad impl rejects traversal" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    var b = testBackend();
    try testing.expectError(error.InvalidPresetName, b.presetLoadImpl(arena.allocator(), "../build"));
}

/// Scratch preset dir with the live layout: one built-in `.zon`, room for
/// user `.json` files. The atomic rename needs the dir to exist up front.
fn seedPresetDir(a: std.mem.Allocator, tmp: *std.testing.TmpDir) ![]const u8 {
    const dir = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/presets", .{tmp.sub_path[0..]});
    try std.Io.Dir.cwd().createDirPath(testing.io, dir);
    try std.Io.Dir.cwd().writeFile(testing.io, .{
        .sub_path = try std.fmt.allocPrint(a, "{s}/base.zon", .{dir}),
        .data = ".{ .name = \"base\" }",
    });
    return dir;
}

const user_preset_json =
    \\{"name": "mine", "steps": [{"prune": {"unused_nodes": true}}, {"join": {}}]}
;

test "user presets: save, list, load, delete round-trip" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir = try seedPresetDir(a, &tmp);

    const saved = try b.presetSaveJsonTo(a, dir, "mine", user_preset_json);
    try testing.expectEqualStrings("{\"ok\":true}", saved.text);
    // The bytes actually landed on disk, untouched by the backend.
    const on_disk = try std.Io.Dir.cwd().readFileAlloc(testing.io, try std.fmt.allocPrint(a, "{s}/mine.json", .{dir}), a, .limited(max_text_bytes));
    try testing.expectEqualStrings(user_preset_json, on_disk);

    const listed = try b.presetsIn(a, dir);
    try testing.expect(std.mem.indexOf(u8, listed.text, "{\"name\":\"base\",\"kind\":\"builtin\",\"file\":\"base.zon\"}") != null);
    try testing.expect(std.mem.indexOf(u8, listed.text, "{\"name\":\"mine\",\"kind\":\"user\",\"file\":\"mine.json\"}") != null);

    // The loader prefers the `.json` text — which is what `optimizeCustom`
    // accepts as a spec.
    const loaded = try b.presetLoadFrom(a, dir, "mine");
    try testing.expectEqualStrings(user_preset_json, loaded);
    const base_text = try b.presetLoadFrom(a, dir, "base");
    try testing.expectEqualStrings(".{ .name = \"base\" }", base_text);

    // Overwriting your own preset is fine.
    const again = try b.presetSaveJsonTo(a, dir, "mine", user_preset_json);
    try testing.expectEqualStrings("{\"ok\":true}", again.text);

    const deleted = try b.presetDeleteFrom(a, dir, "mine");
    try testing.expectEqualStrings("{\"ok\":true}", deleted.text);
    try testing.expectError(error.PresetNotFound, b.presetLoadFrom(a, dir, "mine"));
}

test "user presets: garbage fails validation, builtins are read-only" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const dir = try seedPresetDir(a, &tmp);

    for ([_][]const u8{
        "not json",
        "{\"name\":\"x\"}",
        "{\"name\":\"x\",\"steps\":[]}",
        "{\"name\":\"x\",\"steps\":[{\"frobnicate\":{}}]}",
        "{\"name\":\"x\",\"steps\":[{\"weld\":{\"tolerance\":\"far\"}}]}",
    }) |bad| {
        const r = try b.presetSaveJsonTo(a, dir, "mine", bad);
        try testing.expect(std.mem.indexOf(u8, r.text, "\"error\"") != null);
    }
    // Nothing landed on disk.
    try testing.expectError(error.FileNotFound, std.Io.Dir.cwd().statFile(testing.io, try std.fmt.allocPrint(a, "{s}/mine.json", .{dir}), .{}));

    // Built-in names are refused for save and delete alike.
    const save_builtin = try b.presetSaveJsonTo(a, dir, "base", user_preset_json);
    try testing.expect(std.mem.indexOf(u8, save_builtin.text, "builtin") != null);
    const delete_builtin = try b.presetDeleteFrom(a, dir, "base");
    try testing.expect(std.mem.indexOf(u8, delete_builtin.text, "builtin") != null);
    // ... and unknown names have nothing to delete.
    const delete_missing = try b.presetDeleteFrom(a, dir, "ghost");
    try testing.expect(std.mem.indexOf(u8, delete_missing.text, "not found") != null);

    // The name sanitizer: slashes, dots and blanks never become paths.
    for ([_][]const u8{ "", "../build", "a/b", "has space", "semi;colon" }) |bad_name| {
        try testing.expectError(error.InvalidPresetName, b.presetSaveJsonTo(a, dir, bad_name, user_preset_json));
        try testing.expectError(error.InvalidPresetName, b.presetDeleteFrom(a, dir, bad_name));
        try testing.expectError(error.InvalidPresetName, b.presetLoadFrom(a, dir, bad_name));
    }
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

test "appInfo reports the build version and this platform's asset" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    const r = try b.appInfoImpl(a);
    var parsed = try std.json.parseFromSlice(std.json.Value, a, r.text, .{});
    defer parsed.deinit();
    const o = parsed.value.object;
    try testing.expectEqualStrings(config.version, o.get("version").?.string);
    try testing.expectEqualStrings(config.repo, o.get("repo").?.string);
    try testing.expectEqualStrings(@tagName(builtin.os.tag), o.get("platform").?.string);
    try testing.expectEqualStrings(update.asset_name, o.get("asset").?.string);
}

/// A feed dir holding only `manifest.json` (check never downloads archives).
fn writeFeedManifest(a: std.mem.Allocator, feed: []const u8, version: []const u8) !void {
    const sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const text = try std.fmt.allocPrint(a, "{{\"version\":\"{s}\",\"files\":{{\"{s}\":{{\"sha256\":\"{s}\"}}}}}}", .{ version, update.asset_name, sha });
    try std.Io.Dir.cwd().writeFile(testing.io, .{ .sub_path = try std.fmt.allocPrint(a, "{s}/manifest.json", .{feed}), .data = text });
}

test "updateCheck finds a newer file feed, quiet when current" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const feed = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/feed", .{tmp.sub_path[0..]});
    try std.Io.Dir.cwd().createDirPath(testing.io, feed);
    try writeFeedManifest(a, feed, "9.9.9");
    const url = try std.fmt.allocPrint(a, "file://{s}", .{try std.Io.Dir.cwd().realPathFileAlloc(testing.io, feed, a)});

    const hit = try b.updateCheckImpl(a, url);
    {
        var parsed = try std.json.parseFromSlice(std.json.Value, a, hit.text, .{});
        defer parsed.deinit();
        const o = parsed.value.object;
        try testing.expect(o.get("available").?.bool);
        try testing.expectEqualStrings("9.9.9", o.get("version").?.string);
        try testing.expectEqualStrings(update.asset_name, o.get("asset").?.string);
        try testing.expect(std.mem.indexOf(u8, o.get("download_url").?.string, update.asset_name) != null);
        try testing.expect(std.mem.indexOf(u8, o.get("notes_url").?.string, "releases/tag/v9.9.9") != null);
    }

    try writeFeedManifest(a, feed, update.comparable(config.version));
    const miss = try b.updateCheckImpl(a, url);
    {
        var parsed = try std.json.parseFromSlice(std.json.Value, a, miss.text, .{});
        defer parsed.deinit();
        try testing.expect(!parsed.value.object.get("available").?.bool);
    }
}

test "updateApply reports up-to-date without touching the exe" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const feed = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/feed", .{tmp.sub_path[0..]});
    try std.Io.Dir.cwd().createDirPath(testing.io, feed);
    try writeFeedManifest(a, feed, update.comparable(config.version));
    const url = try std.fmt.allocPrint(a, "file://{s}", .{try std.Io.Dir.cwd().realPathFileAlloc(testing.io, feed, a)});

    // Neither path exists: the up-to-date short-circuit must not read them.
    const r = try b.updateApplyImpl(a, .{}, url, "/nonexistent/assetty", "/nonexistent/cache");
    var parsed = try std.json.parseFromSlice(std.json.Value, a, r.text, .{});
    defer parsed.deinit();
    const o = parsed.value.object;
    try testing.expect(!o.get("installed").?.bool);
    try testing.expectEqualStrings(update.comparable(config.version), o.get("version").?.string);
}

test "updateApply installs, relaunches the probe and reports restarted" {
    if (builtin.os.tag == .windows) return error.SkipZigTest; // the fake program is a shell script
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const feed = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/feed", .{tmp.sub_path[0..]});
    try std.Io.Dir.cwd().createDirPath(testing.io, feed);
    const root = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}", .{tmp.sub_path[0..]});
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(testing.io, root, a);
    const marker = try std.fmt.allocPrint(a, "{s}/impl-relaunched", .{abs});
    // The impl always installs this platform's release artifact.
    const asset = update.asset_name;
    const program_text = try std.fmt.allocPrint(a,
        \\#!/bin/sh
        \\if [ "$1" = "--version" ]; then echo "assetty 9.9.9"; else echo launched > "{s}"; fi
        \\
    , .{marker});
    // A release newer than any dev build: a shell-built archive (tar for
    // .tar.gz, zip for the macOS/Windows artifact) plus a manifest for it.
    const pack = try std.fmt.allocPrint(a, "{s}/pack/app-9.9.9", .{abs});
    try std.Io.Dir.cwd().createDirPath(testing.io, pack);
    const packed_prog = try std.fmt.allocPrint(a, "{s}/assetty-test-prog", .{pack});
    try std.Io.Dir.cwd().writeFile(testing.io, .{ .sub_path = packed_prog, .data = program_text, .flags = .{ .permissions = .fromMode(0o755) } });
    const archive = try std.fmt.allocPrint(a, "{s}/{s}", .{ feed, asset });
    if (std.mem.endsWith(u8, asset, ".tar.gz")) {
        const argv: []const []const u8 = &.{ "/usr/bin/tar", "-czf", archive, "-C", try std.fmt.allocPrint(a, "{s}/pack", .{abs}), "app-9.9.9" };
        const r = try std.process.run(a, testing.io, .{ .argv = argv, .stdout_limit = .limited(1 << 20), .stderr_limit = .limited(1 << 20) });
        if (!r.term.success()) return error.SkipZigTest;
    } else {
        const argv: []const []const u8 = &.{ "/usr/bin/zip", "-jq", archive, packed_prog };
        const r = std.process.run(a, testing.io, .{ .argv = argv, .stdout_limit = .limited(1 << 20), .stderr_limit = .limited(1 << 20) }) catch return error.SkipZigTest;
        if (!r.term.success()) return error.SkipZigTest;
    }
    const bytes = try std.Io.Dir.cwd().readFileAlloc(testing.io, archive, a, .limited(1 << 20));
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    try writeFeedManifestFor(a, feed, asset, "9.9.9", &std.fmt.bytesToHex(digest, .lower));

    const url = try std.fmt.allocPrint(a, "file://{s}", .{try std.Io.Dir.cwd().realPathFileAlloc(testing.io, feed, a)});
    const exe = try std.fmt.allocPrint(a, "{s}/assetty-test-prog", .{abs});
    try std.Io.Dir.cwd().writeFile(testing.io, .{ .sub_path = exe, .data = "#!/bin/sh\necho \"assetty 0.1.0\"\n", .flags = .{ .permissions = .fromMode(0o755) } });
    const cache = try std.fmt.allocPrint(a, "{s}/cache", .{abs});
    try std.Io.Dir.cwd().createDirPath(testing.io, cache);

    // No window/app in tests: the quit post is skipped, the spawn is real.
    const r = try b.updateApplyImpl(a, .{}, url, exe, cache);
    var parsed = try std.json.parseFromSlice(std.json.Value, a, r.text, .{});
    defer parsed.deinit();
    const o = parsed.value.object;
    try testing.expect(o.get("installed").?.bool);
    try testing.expectEqualStrings("9.9.9", o.get("version").?.string);
    try testing.expect(o.get("restarted").?.bool);

    // The swap landed and the staged probe actually got launched detached.
    const said = try std.process.run(a, testing.io, .{ .argv = &.{ exe, "--version" }, .stdout_limit = .limited(1 << 20), .stderr_limit = .limited(1 << 20) });
    try testing.expect(std.mem.indexOf(u8, said.stdout, "9.9.9") != null);
    var i: u32 = 0;
    while (i < 50) : (i += 1) {
        std.Io.Dir.cwd().access(testing.io, marker, .{}) catch {
            testing.io.sleep(.fromMilliseconds(100), .awake) catch {};
            continue;
        };
        break;
    } else return error.Timeout;
}

/// A manifest naming one archive at `version` with the given sha hex.
fn writeFeedManifestFor(a: std.mem.Allocator, feed: []const u8, asset: []const u8, version: []const u8, sha_hex: []const u8) !void {
    const text = try std.fmt.allocPrint(a, "{{\"version\":\"{s}\",\"files\":{{\"{s}\":{{\"sha256\":\"{s}\"}}}}}}", .{ version, asset, sha_hex });
    try std.Io.Dir.cwd().writeFile(testing.io, .{ .sub_path = try std.fmt.allocPrint(a, "{s}/manifest.json", .{feed}), .data = text });
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

test "sanitizeDropName strips paths and weird chars" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    try testing.expectEqualStrings("box.glb", try sanitizeDropName(a, "../../etc/box.glb"));
    try testing.expectEqualStrings("model.glb", try sanitizeDropName(a, "C:\\Users\\x\\model.glb"));
    try testing.expectEqualStrings("my_model__1_.glb", try sanitizeDropName(a, "my model (1).glb"));
    try testing.expectEqualStrings("model.glb", try sanitizeDropName(a, ""));
    try testing.expectEqualStrings("model.glb", try sanitizeDropName(a, "   "));
    try testing.expectEqualStrings("model.glb", try sanitizeDropName(a, ".."));
    try testing.expectEqualStrings("model.glb", try sanitizeDropName(a, "."));
    try testing.expectEqualStrings("model.glb", try sanitizeDropName(a, "../"));
    // Length capped at max_drop_name bytes.
    const long = try a.alloc(u8, 200);
    @memset(long, 'a');
    const capped = try sanitizeDropName(a, long);
    try testing.expectEqual(max_drop_name, capped.len);
}

test "dropFile writes bytes under out_dir/drops and reads back" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    const fixture = try std.Io.Dir.cwd().readFileAlloc(testing.io, "test/fixtures/box.glb", a, .limited(64 << 20));
    const b64 = try a.alloc(u8, std.base64.standard.Encoder.calcSize(fixture.len));
    _ = std.base64.standard.Encoder.encode(b64, fixture);

    const r = try b.dropFileImpl(a, "../weird name (1).glb", b64);
    try testing.expect(std.mem.startsWith(u8, r.text, "{\"path\":\""));

    const Parsed = struct { path: []const u8 };
    const parsed = try std.json.parseFromSlice(Parsed, a, r.text, .{});
    defer parsed.deinit();
    const path = parsed.value.path;
    // Lands in the drops dir, keeps a sanitized tail of the browser name.
    try testing.expect(std.mem.indexOf(u8, path, "drops") != null);
    try testing.expect(std.mem.endsWith(u8, path, "_weird_name__1_.glb"));
    try testing.expect(std.fs.path.isAbsolute(path));

    const back = try std.Io.Dir.cwd().readFileAlloc(testing.io, path, a, .limited(64 << 20));
    try testing.expectEqualSlices(u8, fixture, back);
    std.Io.Dir.cwd().deleteFile(testing.io, path) catch {};

    // A blank name falls back to model.glb.
    const r2 = try b.dropFileImpl(a, "  ", b64);
    const parsed2 = try std.json.parseFromSlice(Parsed, a, r2.text, .{});
    defer parsed2.deinit();
    try testing.expect(std.mem.endsWith(u8, parsed2.value.path, "_model.glb"));
    std.Io.Dir.cwd().deleteFile(testing.io, parsed2.value.path) catch {};
}

test "dropFile rejects invalid base64" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    for ([_][]const u8{ "!!!", "####", "a" }) |bad| {
        const r = try b.dropFileImpl(a, "box.glb", bad);
        try testing.expect(std.mem.indexOf(u8, r.text, "\"error\"") != null);
        try testing.expect(std.mem.indexOf(u8, r.text, "invalid base64") != null);
    }
}

test "resolveOpenDir accepts only existing directories" {
    var b = testBackend();
    try testing.expectEqualStrings("presets", b.resolveOpenDir("presets").?);
    try testing.expectEqualStrings("presets", b.resolveOpenDir("  presets\n").?);
    try testing.expect(b.resolveOpenDir(null) == null);
    try testing.expect(b.resolveOpenDir("   ") == null);
    try testing.expect(b.resolveOpenDir("test/fixtures/nope-dir") == null);
    // A file is not a directory.
    try testing.expect(b.resolveOpenDir("test/fixtures/box.glb") == null);
}

test "progress payload omits a null sub and carries a set one" {
    var plain_buf: [128]u8 = undefined;
    var plain_w = std.Io.Writer.fixed(&plain_buf);
    try std.json.Stringify.value(.{ .step = "textures", .pct = @as(f32, 0.5) }, .{}, &plain_w);

    var bare_buf: [128]u8 = undefined;
    var bare_w = std.Io.Writer.fixed(&bare_buf);
    try std.json.Stringify.value(events.ProgressPayload{ .step = "textures", .pct = 0.5 }, .{}, &bare_w);
    // Byte-compatible with the pre-sub shape: no "sub" key at all.
    try testing.expectEqualStrings(plain_w.buffered(), bare_w.buffered());
    try testing.expect(std.mem.indexOf(u8, bare_w.buffered(), "sub") == null);

    var sub_buf: [256]u8 = undefined;
    var sub_w = std.Io.Writer.fixed(&sub_buf);
    try std.json.Stringify.value(events.ProgressPayload{
        .step = "textures",
        .pct = 0.5,
        .sub = .{ .label = "texture", .done = 3, .total = 7 },
    }, .{}, &sub_w);
    try testing.expect(std.mem.indexOf(
        u8,
        sub_w.buffered(),
        "\"sub\":{\"label\":\"texture\",\"done\":3,\"total\":7}",
    ) != null);
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

// ---- discardFile ------------------------------------------------------------

test "discardFile deletes a result inside out_dir and is idempotent" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    try std.Io.Dir.cwd().createDirPath(testing.io, out_dir);
    const rel = out_dir ++ "/discard_test_tmp.glb";
    try std.Io.Dir.cwd().writeFile(testing.io, .{ .sub_path = rel, .data = "opt-bytes" });
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(testing.io, rel, a);

    const r = try discardFileImpl(testing.io, a, abs);
    try testing.expectEqualStrings("{\"ok\":true}", r.text);
    // Gone from disk.
    try testing.expectError(error.FileNotFound, std.Io.Dir.cwd().statFile(testing.io, abs, .{}));
    // Second call: already gone, still ok.
    const r2 = try discardFileImpl(testing.io, a, abs);
    try testing.expectEqualStrings("{\"ok\":true}", r2.text);
    // A relative in-dir path resolves the same way.
    try std.Io.Dir.cwd().writeFile(testing.io, .{ .sub_path = rel, .data = "opt-bytes" });
    const r3 = try discardFileImpl(testing.io, a, rel);
    try testing.expectEqualStrings("{\"ok\":true}", r3.text);
}

test "discardFile refuses paths outside out_dir" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const refused = "only results in .zig-cache/assetty-app can be discarded";
    for ([_][]const u8{ "test/fixtures/box.glb", "/etc", out_dir }) |p| {
        const r = try discardFileImpl(testing.io, a, p);
        try testing.expect(std.mem.indexOf(u8, r.text, refused) != null);
    }
    // Nothing was touched: the fixture still reads.
    const bytes = try std.Io.Dir.cwd().readFileAlloc(testing.io, "test/fixtures/box.glb", a, .limited(64 << 20));
    try testing.expect(bytes.len > 0);
    // Blank paths are refused, not deleted.
    const blank = try discardFileImpl(testing.io, a, "   ");
    try testing.expect(std.mem.indexOf(u8, blank.text, "\"error\"") != null);
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
    try testing.expectEqual(defaults.animations, p.steps[0].prune.animations);
    try testing.expect(p.steps[0].prune.animations);
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

test "custom spec maps prune animations flag" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    const p = try customPresetFromSpec(a, "{\"steps\":[{\"prune\":{\"animations\":false}}]}", &detail);
    try testing.expectEqual(@as(usize, 1), p.steps.len);
    try testing.expect(!p.steps[0].prune.animations);
    // other prune fields keep defaults
    const d = core.preset.PruneParams{};
    try testing.expectEqual(d.unused_nodes, p.steps[0].prune.unused_nodes);

    // mistyped animations is a BadParam naming the step
    try testing.expectError(
        error.BadParam,
        customPresetFromSpec(a, "{\"steps\":[{\"prune\":{\"animations\":\"no\"}}]}", &detail),
    );
    try testing.expectEqualStrings("prune", detail);
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

test "custom spec maps textures overrides" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const spec =
        \\{"steps":[{
        \\  "textures":{
        \\    "format":"auto","quality":128,"max_size":0,"generate_mips":true,
        \\    "overrides":[
        \\      {"image":2,"format":"uastc","quality":200,"max_size":512,"generate_mips":true,"skip":false,"normal_map":true},
        \\      {"name":"basecolor","max_size":1024},
        \\      {"image":5,"skip":true}
        \\    ]
        \\  }
        \\}]}
    ;
    var detail: []const u8 = "";
    const p = try customPresetFromSpec(a, spec, &detail);
    try testing.expectEqual(@as(usize, 1), p.steps.len);
    const tex = p.steps[0].textures;
    try testing.expectEqual(@as(usize, 3), tex.overrides.len);

    try testing.expectEqual(@as(?u32, 2), tex.overrides[0].image);
    try testing.expectEqual(core.preset.TextureFormat.uastc, tex.overrides[0].format.?);
    try testing.expectEqual(@as(?u8, 200), tex.overrides[0].quality);
    try testing.expectEqual(@as(?u32, 512), tex.overrides[0].max_size);
    try testing.expectEqual(@as(?bool, true), tex.overrides[0].generate_mips);
    try testing.expectEqual(@as(?bool, true), tex.overrides[0].normal_map);
    try testing.expect(!tex.overrides[0].skip);

    try testing.expectEqualStrings("basecolor", tex.overrides[1].name);
    try testing.expectEqual(@as(?u32, 1024), tex.overrides[1].max_size);
    try testing.expectEqual(@as(?u32, null), tex.overrides[1].image);

    try testing.expect(tex.overrides[2].skip);

    // The effective resolution matches the pipeline's (last wins).
    const eff = core.runner.resolveTextureOverride(tex, 2, "helmet_base", null);
    try testing.expectEqual(core.preset.TextureFormat.uastc, eff.format);
    try testing.expectEqual(@as(u8, 200), eff.quality);

    // overrides on non-textures steps are ignored (unknown keys pass through).
    var detail2: []const u8 = "";
    const p2 = try customPresetFromSpec(a, "{\"steps\":[{\"prune\":{\"overrides\":[{\"image\":0}]}}]}", &detail2);
    try testing.expect(p2.steps[0].prune.unused_nodes);
}

test "custom spec maps textures supercompression" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // Step-level opt-in plus a per-image opt-out.
    var detail: []const u8 = "";
    const p = try customPresetFromSpec(
        a,
        "{\"steps\":[{\"textures\":{\"format\":\"uastc\",\"supercompression\":\"zstd\",\"overrides\":[{\"image\":1,\"supercompression\":\"none\"}]}}]}",
        &detail,
    );
    const tex = p.steps[0].textures;
    try testing.expectEqual(core.encode_ktx.Supercompression.zstd, tex.supercompression);
    try testing.expectEqual(@as(usize, 1), tex.overrides.len);
    try testing.expectEqual(@as(?core.encode_ktx.Supercompression, .none), tex.overrides[0].supercompression);

    // Omitted → none; unknown string → none (byte-compat default, not error).
    for ([_][]const u8{
        "{\"steps\":[{\"textures\":{}}]}",
        "{\"steps\":[{\"textures\":{\"supercompression\":\"bogus\"}}]}",
    }) |s| {
        var d: []const u8 = "";
        const q = try customPresetFromSpec(a, s, &d);
        try testing.expectEqual(core.encode_ktx.Supercompression.none, q.steps[0].textures.supercompression);
    }

    // Unknown string inside an override leaves it unset.
    var d3: []const u8 = "";
    const r = try customPresetFromSpec(
        a,
        "{\"steps\":[{\"textures\":{\"overrides\":[{\"name\":\"n\",\"supercompression\":\"bogus\"}]}}]}",
        &d3,
    );
    try testing.expectEqual(@as(?core.encode_ktx.Supercompression, null), r.steps[0].textures.overrides[0].supercompression);
}

test "custom spec maps textures rules" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    const p = try customPresetFromSpec(
        a,
        "{\"steps\":[{\"textures\":{\"format\":\"auto\",\"apply_rules\":true,\"reencode_ktx2\":true,\"rules\":[{\"slot\":\"normal\",\"format\":\"uastc\",\"srgb\":false},{\"name\":\"_BC\",\"format\":\"etc1s\",\"skip\":true}]}}]}",
        &detail,
    );
    const tex = p.steps[0].textures;
    try testing.expect(tex.apply_rules);
    try testing.expect(tex.reencode_ktx2);
    try testing.expectEqual(@as(usize, 2), tex.rules.len);
    try testing.expectEqual(@as(?core.preset.TexSlot, .normal), tex.rules[0].slot);
    try testing.expectEqual(@as(?bool, false), tex.rules[0].srgb);
    try testing.expectEqualStrings("_BC", tex.rules[1].name);
    try testing.expect(tex.rules[1].skip);

    // Resolution through the live path: normal slot beats the _BC name rule.
    const normal_bit: u8 = @as(u8, 1) << 1;
    const eff = core.runner.resolveTextureFull(tex, 0, "wall_BC", null, .{ .slots = normal_bit, .min_side = 512 });
    try testing.expectEqual(core.preset.TextureFormat.uastc, eff.format);

    // Defaults stay off (legacy byte-compat).
    var d2: []const u8 = "";
    const q = try customPresetFromSpec(a, "{\"steps\":[{\"textures\":{}}]}", &d2);
    try testing.expect(!q.steps[0].textures.apply_rules);
    try testing.expect(!q.steps[0].textures.reencode_ktx2);
    try testing.expectEqual(@as(usize, 0), q.steps[0].textures.rules.len);
}

test "custom spec ignores malformed override items gracefully" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // Non-object items dropped; mistyped fields keep defaults; unknown keys
    // and unknown format strings ignored; out-of-range ints ignored.
    const spec =
        \\{"steps":[{
        \\  "textures":{"overrides":[
        \\    42,
        \\    {"image":"two","quality":"high","bogus_key":1,"format":"bogus"},
        \\    {"image":9999999999,"quality":300},
        \\    {"name":"ok","skip":true}
        \\  ]}
        \\}]}
    ;
    var detail: []const u8 = "";
    const p = try customPresetFromSpec(a, spec, &detail);
    const tex = p.steps[0].textures;
    try testing.expectEqual(@as(usize, 3), tex.overrides.len);
    // First kept item: everything malformed → all defaults.
    try testing.expectEqual(@as(?u32, null), tex.overrides[0].image);
    try testing.expectEqual(@as(?u8, null), tex.overrides[0].quality);
    try testing.expectEqual(@as(?core.preset.TextureFormat, null), tex.overrides[0].format);
    try testing.expect(!tex.overrides[0].skip);
    // Second kept item: out-of-range ints ignored, not errors.
    try testing.expectEqual(@as(?u32, null), tex.overrides[1].image);
    try testing.expectEqual(@as(?u8, null), tex.overrides[1].quality);
    // Third kept item is intact.
    try testing.expectEqualStrings("ok", tex.overrides[2].name);
    try testing.expect(tex.overrides[2].skip);

    // Non-array overrides and null both mean "none", not an error.
    for ([_][]const u8{
        "{\"steps\":[{\"textures\":{\"overrides\":\"nope\"}}]}",
        "{\"steps\":[{\"textures\":{\"overrides\":null}}]}",
        "{\"steps\":[{\"textures\":{}}]}",
    }) |s| {
        var d: []const u8 = "";
        const q = try customPresetFromSpec(a, s, &d);
        try testing.expectEqual(@as(usize, 0), q.steps[0].textures.overrides.len);
    }
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

// ---- LOD ladders ------------------------------------------------------------

test "lod ratios parse, filter, sort and dedupe" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // Null/blank means the default ladder (simplified rungs only).
    for ([_]?[]const u8{ null, "", "   " }) |t| {
        const ladder = try parseLodRatios(a, t);
        try testing.expectEqualSlices(f32, &[_]f32{ 0.5, 0.25, 0.1 }, ladder);
    }

    // Sorted descending, (0,1) only, non-numbers dropped.
    const ladder = try parseLodRatios(a, "[0.1, 1.0, 0.5, 0, -2, \"x\", null, 2]");
    try testing.expectEqualSlices(f32, &[_]f32{ 0.5, 0.1 }, ladder);

    // round(x*100) duplicates collapse to one rung (one file name).
    const deduped = try parseLodRatios(a, "[0.501, 0.499, 0.25]");
    try testing.expectEqual(@as(usize, 2), deduped.len);
    try testing.expectEqual(@as(f32, 0.25), deduped[1]);

    // Garbage is rejected; an all-dropped ladder is empty (binding refuses it).
    try testing.expectError(error.InvalidRatios, parseLodRatios(a, "not json"));
    try testing.expectError(error.InvalidRatios, parseLodRatios(a, "{\"a\":1}"));
    try testing.expectEqual(@as(usize, 0), (try parseLodRatios(a, "[1.0, 0]")).len);
}

test "lod preset overrides the simplify ratio, or appends the step" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // A spec with simplify keeps every param, only the ratio moves.
    var detail: []const u8 = "";
    const with_simp = try customPresetFromSpec(
        a,
        "{\"steps\":[{\"prune\":{}},{\"simplify\":{\"target_ratio\":0.9,\"aggressive\":true}}]}",
        &detail,
    );
    const over = try lodPresetFor(a, with_simp, 0.25);
    try testing.expectEqual(@as(usize, 2), over.steps.len);
    try testing.expectEqual(@as(f32, 0.25), over.steps[1].simplify.target_ratio);
    try testing.expect(over.steps[1].simplify.aggressive);

    // A spec without simplify gains one with the backend defaults + the ratio.
    const bare = try customPresetFromSpec(a, "{\"steps\":[{\"prune\":{}}]}", &detail);
    const forced = try lodPresetFor(a, bare, 0.5);
    try testing.expectEqual(@as(usize, 2), forced.steps.len);
    try testing.expectEqual(core.preset.StepKind.simplify, std.meta.activeTag(forced.steps[1]));
    try testing.expectEqual(@as(f32, 0.5), forced.steps[1].simplify.target_ratio);
    const d = core.preset.SimplifyParams{};
    try testing.expectEqual(d.error_tolerance, forced.steps[1].simplify.error_tolerance);
    try testing.expectEqual(d.lock_borders, forced.steps[1].simplify.lock_borders);
}

test "lod output names encode the source stem and the ratio" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    try testing.expectEqualStrings(
        ".zig-cache/assetty-app/box_lod50.glb",
        try lodOutName(a, "test/fixtures/box.glb", 0.5),
    );
    try testing.expectEqualStrings(
        ".zig-cache/assetty-app/DamagedHelmet_lod10.glb",
        try lodOutName(a, "/models/DamagedHelmet.glb", 0.101),
    );
}

test "lod ladder on box.glb writes two files with descending triangles" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    // The 12-tri box is already minimal (core's own box test expects only
    // `after <= before`), so both rungs keep 12: the ladder is honored in
    // the files it writes and the ratios it records, not in fewer triangles.
    var detail: []const u8 = "";
    const base = try customPresetFromSpec(
        a,
        "{\"steps\":[{\"simplify\":{\"target_ratio\":0.9}}]}",
        &detail,
    );
    const ladder = try parseLodRatios(a, "[0.5,0.25]");

    const outcome = lodRunSync(&b, a, "test/fixtures/box.glb", base, ladder, .{});
    const items = switch (outcome) {
        .done => |items| items,
        .failed => |msg| {
            std.debug.print("lod run failed: {s}\n", .{msg});
            return error.TestUnexpectedResult;
        },
        .out_of_memory => return error.OutOfMemory,
    };
    try testing.expectEqual(@as(usize, 2), items.len);
    try testing.expectEqual(@as(f32, 0.5), items[0].ratio);
    try testing.expectEqual(@as(f32, 0.25), items[1].ratio);

    // Both files exist, parse, and honor the ladder: counts never grow from
    // rung to rung and never exceed the source.
    for (items) |item| {
        const st = try std.Io.Dir.cwd().statFile(testing.io, item.out_path, .{});
        try testing.expectEqual(st.size, item.disk_bytes);
        try testing.expect(st.size > 0);
        var loaded = try core.parse.loadFile(testing.io, a, item.out_path);
        defer loaded.deinit();
        try testing.expect(loaded.asset.meshes.len > 0);
    }
    try testing.expect(items[0].triangles >= items[1].triangles);
    try testing.expect(items[1].triangles <= 12);
    try testing.expect(items[0].secs >= 0);
    try testing.expect(items[1].secs >= 0);
    try testing.expect(std.mem.endsWith(u8, items[0].out_path, "box_lod50.glb"));
    try testing.expect(std.mem.endsWith(u8, items[1].out_path, "box_lod25.glb"));
}

test "lod ladder on the helmet decimates strictly per rung" {
    // box.glb is already minimal, so this proves the ladder honors the ratios
    // geometrically: every rung starts from the source and lands near its own
    // target (simplify-only spec, no textures to keep it fast).
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var detail: []const u8 = "";
    const base = try customPresetFromSpec(
        a,
        "{\"steps\":[{\"simplify\":{\"target_ratio\":0.9,\"error_tolerance\":10.0}}]}",
        &detail,
    );
    const ladder = try parseLodRatios(a, "[0.5,0.25]");

    const outcome = lodRunSync(&b, a, "test/fixtures/real/DamagedHelmet.glb", base, ladder, .{});
    const items = switch (outcome) {
        .done => |items| items,
        .failed => |msg| {
            std.debug.print("lod run failed: {s}\n", .{msg});
            return error.TestUnexpectedResult;
        },
        .out_of_memory => return error.OutOfMemory,
    };
    try testing.expectEqual(@as(usize, 2), items.len);
    try testing.expect(items[0].triangles > items[1].triangles);
    try testing.expect(items[1].triangles < 15452);
    try testing.expect(std.mem.endsWith(u8, items[0].out_path, "DamagedHelmet_lod50.glb"));
    try testing.expect(std.mem.endsWith(u8, items[1].out_path, "DamagedHelmet_lod25.glb"));
}

test "lod ladder forces a simplify step when the spec has none" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    var detail: []const u8 = "";
    const base = try customPresetFromSpec(a, "{\"steps\":[{\"prune\":{}}]}", &detail);
    const ladder = try parseLodRatios(a, "[0.5,0.25]");

    const outcome = lodRunSync(&b, a, "test/fixtures/box.glb", base, ladder, .{});
    const items = switch (outcome) {
        .done => |items| items,
        .failed => |msg| {
            std.debug.print("lod run failed: {s}\n", .{msg});
            return error.TestUnexpectedResult;
        },
        .out_of_memory => return error.OutOfMemory,
    };
    // The forced simplify step ran (prune-only spec still yields LOD files).
    try testing.expectEqual(@as(usize, 2), items.len);
    for (items) |item| {
        const st = try std.Io.Dir.cwd().statFile(testing.io, item.out_path, .{});
        try testing.expect(st.size > 0);
        try testing.expect(item.triangles <= 12);
    }
}

test "optimizeLODs binding validates before spawning" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var b = testBackend();

    // A bad spec is rejected the same way `optimizeCustom` rejects it.
    const bad = specPresetOrMessage(a, "{\"steps\":[]}");
    try testing.expect(bad == .err);
    try testing.expectEqualStrings("no steps", bad.err);
    try testing.expect(!b.busy());

    // Bad ratios text is rejected; an all-dropped ladder is empty (refused).
    try testing.expectError(error.InvalidRatios, parseLodRatios(a, "nope"));
    try testing.expectEqual(@as(usize, 0), (try parseLodRatios(a, "[1.0]")).len);
    try testing.expect(!b.busy());

    // An occupied gate answers busy.
    var occupied: Job = undefined;
    b.job = &occupied;
    defer b.job = null;
    const ladder = try parseLodRatios(a, null);
    var detail: []const u8 = "";
    const base = try customPresetFromSpec(a, "{\"steps\":[{\"prune\":{}}]}", &detail);
    const busy_reply = try b.launchLods(a, .{}, "test/fixtures/box.glb", base, ladder);
    try testing.expectEqualStrings("{\"error\":\"busy\"}", busy_reply.text);
}

test "lodsDone payload carries the documented shape" {
    var buf: [512]u8 = undefined;
    var ok_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.LodsItemPayload{
        .ratio = 0.5,
        .out_path = ".zig-cache/assetty-app/box_lod50.glb",
        .disk_bytes = 2048,
        .triangles = 6,
        .secs = 0.42,
    }, .{}, &ok_w);
    try testing.expect(std.mem.indexOf(u8, ok_w.buffered(), "\"ratio\":0.5") != null);

    var done_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.LodsDonePayload{
        .ok = true,
        .results = &.{.{
            .ratio = 0.5,
            .out_path = ".zig-cache/assetty-app/box_lod50.glb",
            .disk_bytes = 2048,
            .triangles = 6,
            .secs = 0.42,
        }},
    }, .{}, &done_w);
    try testing.expectEqualStrings(
        "{\"ok\":true,\"results\":[{\"ratio\":0.5,\"out_path\":\".zig-cache/assetty-app/box_lod50.glb\"," ++
            "\"disk_bytes\":2048,\"triangles\":6,\"secs\":0.420}]}",
        done_w.buffered(),
    );

    var err_w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(events.LodsDonePayload{ .ok = false, .@"error" = "boom" }, .{}, &err_w);
    try testing.expectEqualStrings("{\"ok\":false,\"error\":\"boom\"}", err_w.buffered());
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
    // Scalar snapshot of a `.texture` result (its strings die with the job).
    mode: ?core.encode_ktx.Mode = null,
    quality: u8 = 0,
    max_size: u32 = 0,
    mips: bool = true,

    fn collect(ctx: ?*anyopaque, job: *Job) void {
        const self: *Collector = @ptrCast(@alignCast(ctx orelse return));
        self.mutex.lock();
        self.ok = job.result != null;
        if (job.result) |res| switch (res) {
            .optimize => |o| self.report = testing.allocator.dupe(u8, o.report) catch null,
            .lods => {},
            .texture => |t| {
                self.mode = t.mode;
                self.quality = t.quality;
                self.max_size = t.max_size;
                self.mips = t.generate_mips;
            },
            .preview, .exported => {},
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

test "textureEncode honors the settings payload" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var b = testBackend();
    var got: Collector = .{};
    b.on_job_done = &Collector.collect;
    b.on_job_done_ctx = &got;
    defer b.on_job_done = null;

    const reply = try b.launch(a, .{}, .texture_encode, "test/fixtures/box.glb", null, 0, "{\"format\":\"uastc\",\"quality\":200,\"max_size\":64,\"generate_mips\":false,\"nope\":1}");
    try testing.expectEqualStrings("{\"started\":true}", reply.text);

    got.wait();
    try testing.expect(got.ok);
    try testing.expect(!b.busy());
    try testing.expectEqual(core.encode_ktx.Mode.uastc, got.mode.?);
    try testing.expectEqual(@as(u8, 200), got.quality);
    try testing.expectEqual(@as(u32, 64), got.max_size);
    try testing.expect(!got.mips);
}

test "textureEncode without settings keeps the defaults" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var b = testBackend();
    var got: Collector = .{};
    b.on_job_done = &Collector.collect;
    b.on_job_done_ctx = &got;
    defer b.on_job_done = null;

    // Empty string, garbage, and null must all resolve to the defaults.
    for ([_]?[]const u8{ null, "", "not json", "[1,2]" }) |s| {
        got = .{};
        const reply = try b.launch(a, .{}, .texture_encode, "test/fixtures/box.glb", null, 0, s);
        try testing.expectEqualStrings("{\"started\":true}", reply.text);
        got.wait();
        try testing.expect(got.ok);
        try testing.expectEqual(core.encode_ktx.Mode.etc1s, got.mode.?);
        try testing.expectEqual(@as(u8, 128), got.quality);
        try testing.expectEqual(@as(u32, 0), got.max_size);
        try testing.expect(got.mips);
    }
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

    switch (try encodeTexture(testing.io, a, "test/fixtures/box.glb", 999, null)) {
        .failed => |msg| try testing.expect(std.mem.indexOf(u8, msg, "out of range") != null),
        else => return error.TestUnexpectedResult,
    }
}

test "texture encode writes before/after pngs and reports the settings" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    switch (try encodeTexture(testing.io, a, "test/fixtures/box.glb", 0, null)) {
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
