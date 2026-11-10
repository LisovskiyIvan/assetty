//! Installed macOS apps keep user data outside the application bundle.
//! Raw/development binaries and the CLI retain their existing working paths.
const std = @import("std");
const builtin = @import("builtin");
const nanoui = @import("nanoui");

/// Written once by `prepare()` before any worker thread spawns, read-only
/// afterwards: `app.main` calls `prepare` before the window (and therefore any
/// background job) exists, so no worker can observe a half-written value.
/// Assign only in `prepare()` — never from a worker or a binding.
pub var output_dir: []const u8 = ".zig-cache/assetty-app";
/// Same contract as `output_dir`: set once in `prepare()`, only read later.
pub var settings_file: []const u8 = "assetty.settings.json";

pub fn prepare(init: std.process.Init) !void {
    if (builtin.os.tag != .macos) return;
    const a = init.arena.allocator();
    const exe = try std.process.executablePathAlloc(init.io, a);
    const parent = bundleParent(exe) orelse return;
    const old_cwd = try std.process.currentPathAlloc(init.io, a);
    const data = try nanoui.path(a, .data, "assetty");
    const cache = try nanoui.path(a, .cache, "assetty");
    const results = try std.fs.path.join(a, &.{ cache, "results" });
    try std.Io.Dir.cwd().createDirPath(init.io, data);
    try std.Io.Dir.cwd().createDirPath(init.io, results);

    // Copy, never move: older releases can still use the original files.
    // Existing destination files always win, including on repeated launches.
    try migrate(init.io, a, old_cwd, data);
    if (!std.mem.eql(u8, parent, old_cwd)) try migrate(init.io, a, parent, data);

    const data_z = try a.dupeSentinel(u8, data, 0);
    if (std.c.chdir(data_z) != 0) return error.ApplicationDataUnavailable;
    output_dir = results;
    settings_file = try std.fs.path.join(a, &.{ data, "assetty.settings.json" });
}

fn bundleParent(exe: []const u8) ?[]const u8 {
    const at = std.mem.lastIndexOf(u8, exe, "/Contents/MacOS/") orelse return null;
    const bundle = exe[0..at];
    if (!std.mem.endsWith(u8, bundle, ".app")) return null;
    const slash = std.mem.lastIndexOfScalar(u8, bundle, '/') orelse return null;
    return if (slash == 0) "/" else bundle[0..slash];
}

fn migrate(io: std.Io, a: std.mem.Allocator, old: []const u8, data: []const u8) !void {
    if (std.mem.eql(u8, old, data)) return;
    const source = try std.fs.path.join(a, &.{ old, "assetty.settings.json" });
    defer a.free(source);
    const dest = try std.fs.path.join(a, &.{ data, "assetty.settings.json" });
    defer a.free(dest);
    try copyMissing(io, a, source, dest);

    const old_presets = try std.fs.path.join(a, &.{ old, "presets" });
    defer a.free(old_presets);
    var dir = std.Io.Dir.cwd().openDir(io, old_presets, .{ .iterate = true }) catch |err| switch (err) {
        error.FileNotFound, error.AccessDenied, error.NotDir => return,
        else => return err,
    };
    defer dir.close(io);
    const new_presets = try std.fs.path.join(a, &.{ data, "presets" });
    defer a.free(new_presets);
    var it = dir.iterate();
    while (try it.next(io)) |entry| {
        if (entry.kind != .file) continue;
        if (!std.mem.endsWith(u8, entry.name, ".json") and !std.mem.endsWith(u8, entry.name, ".zon")) continue;
        try std.Io.Dir.cwd().createDirPath(io, new_presets);
        const src = try std.fs.path.join(a, &.{ old_presets, entry.name });
        defer a.free(src);
        const dst = try std.fs.path.join(a, &.{ new_presets, entry.name });
        defer a.free(dst);
        try copyMissing(io, a, src, dst);
    }
}

fn copyMissing(io: std.Io, a: std.mem.Allocator, src: []const u8, dst: []const u8) !void {
    const cwd = std.Io.Dir.cwd();
    if (cwd.statFile(io, dst, .{})) |_| return else |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    }
    const bytes = cwd.readFileAlloc(io, src, a, .limited(16 * 1024 * 1024)) catch |err| switch (err) {
        error.FileNotFound, error.AccessDenied, error.IsDir => return,
        else => return err,
    };
    defer a.free(bytes);
    var atomic = try cwd.createFileAtomic(io, dst, .{});
    defer atomic.deinit(io);
    var buffer: [8192]u8 = undefined;
    var writer = atomic.file.writer(io, &buffer);
    try writer.interface.writeAll(bytes);
    try writer.flush();
    atomic.link(io) catch |err| switch (err) {
        error.PathAlreadyExists => {},
        else => return err,
    };
}

test "bundle detection leaves raw binary and CLI paths alone" {
    const t = std.testing;
    try t.expectEqualStrings("/Applications", bundleParent("/Applications/assetty.app/Contents/MacOS/assetty").?);
    try t.expectEqualStrings("/Users/a/My Apps", bundleParent("/Users/a/My Apps/assetty.app/Contents/MacOS/assetty").?);
    try t.expect(bundleParent("/usr/local/bin/assetty") == null);
    try t.expect(bundleParent("/foo/Contents/MacOS/assetty") == null);
}

test "migration copies settings and presets without modifying or replacing originals" {
    const t = std.testing;
    const io = t.io;
    const a = t.allocator;
    var tmp = t.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.createDirPath(io, "old/presets");
    try tmp.dir.createDirPath(io, "data");
    try tmp.dir.writeFile(io, .{ .sub_path = "old/assetty.settings.json", .data = "{\"lang\":\"ru\"}" });
    try tmp.dir.writeFile(io, .{ .sub_path = "old/presets/custom.json", .data = "{\"name\":\"custom\"}" });
    const root = try tmp.dir.realPathFileAlloc(io, ".", a);
    defer a.free(root);
    const old = try std.fs.path.join(a, &.{ root, "old" });
    defer a.free(old);
    const data = try std.fs.path.join(a, &.{ root, "data" });
    defer a.free(data);
    try migrate(io, a, old, data);
    const copied = try tmp.dir.readFileAlloc(io, "data/assetty.settings.json", a, .limited(1024));
    defer a.free(copied);
    try t.expectEqualStrings("{\"lang\":\"ru\"}", copied);
    try tmp.dir.writeFile(io, .{ .sub_path = "data/assetty.settings.json", .data = "{\"lang\":\"en\"}" });
    try migrate(io, a, old, data);
    const kept = try tmp.dir.readFileAlloc(io, "data/assetty.settings.json", a, .limited(1024));
    defer a.free(kept);
    try t.expectEqualStrings("{\"lang\":\"en\"}", kept);
    const original = try tmp.dir.readFileAlloc(io, "old/assetty.settings.json", a, .limited(1024));
    defer a.free(original);
    try t.expectEqualStrings(copied, original);
    const preset = try tmp.dir.readFileAlloc(io, "data/presets/custom.json", a, .limited(1024));
    defer a.free(preset);
    try t.expectEqualStrings("{\"name\":\"custom\"}", preset);
}
