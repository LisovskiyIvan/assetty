//! Document-open bridge: Finder Open With, double-click, Dock drop, argv.
//!
//! nanoui's `App.create` installs its own `NSApplicationDelegate`; the modern
//! `application:openURLs:` path is wired through nanoui's public
//! `App.onOpenFiles` — no delegate patching, no ObjC.
//!
//! Parent wiring:
//!   0. argv `.glb` (before the macOS cwd anchor): `enqueue(a, path)`
//!   1. after `App.create`, before `App.run`: `install(app)`
//!   2. when the webview is ready (polled): `take(allocator)`
//!   3. `defer native_open.deinit()` next to `app.destroy()`
//!
//! Only `.glb` is queued. Pre-webview events are kept (up to `max_pending`),
//! so cold-start opens are never lost. Main thread only.
const std = @import("std");
const nanoui = @import("nanoui");

/// Open paths kept before the webview drains them; the earliest win, the
/// rest drop instead of growing without bound.
pub const max_pending: usize = 16;

/// The only extension the viewer opens (matched case-insensitively).
pub const supported_ext = ".glb";

var queue: std.ArrayList([]u8) = .empty;
var queue_gpa: ?std.mem.Allocator = null;
var installed = false;

/// Non-empty, NUL-free, `.glb` in any case. Pure and portable.
pub fn isSupportedPath(path: []const u8) bool {
    if (path.len == 0) return false;
    if (std.mem.indexOfScalar(u8, path, 0) != null) return false;
    if (path.len < supported_ext.len) return false;
    return std.ascii.eqlIgnoreCase(path[path.len - supported_ext.len ..], supported_ext);
}

/// Paths currently waiting for `take`.
pub fn pendingCount() usize {
    return queue.items.len;
}

/// Registers `onOpenFiles`. Call once, after `App.create`, before `App.run`.
/// Idempotent. The first allocator seen — here or in `enqueue` (argv runs
/// before the macOS cwd anchor) — owns every queued copy.
pub fn install(app: *nanoui.App) void {
    if (installed) return;
    installed = true;
    if (queue_gpa == null) queue_gpa = app.gpa;
    app.onOpenFiles(@ptrCast(app), &handleOpenFiles);
}

/// Frees pending strings and the queue buffer; resets for reuse.
pub fn deinit() void {
    if (queue_gpa) |g| {
        for (queue.items) |p| g.free(p);
        queue.deinit(g);
    }
    queue = .empty;
    queue_gpa = null;
    installed = false;
}

/// Drains the queue: each entry owned by `a` (free entries, then the slice).
/// On OOM mid-copy the moved entries belong to the result and the queue
/// keeps the rest.
pub fn take(a: std.mem.Allocator) ![][]u8 {
    const out = try a.alloc([]u8, queue.items.len);
    errdefer a.free(out);
    var moved: usize = 0;
    errdefer {
        for (out[0..moved]) |p| a.free(p);
    }
    const gpa = queue_gpa;
    for (queue.items, 0..) |p, i| {
        out[i] = try a.dupe(u8, p);
        moved = i + 1;
    }
    if (gpa) |g| {
        for (queue.items) |p| g.free(p);
    }
    queue.clearRetainingCapacity();
    return out;
}

/// Queues one path (argv, before `install`): validated, copied at once. The
/// first allocator seen owns every queued copy. Over `max_pending` the newest
/// paths drop silently; non-`.glb` is ignored, never an error.
pub fn enqueue(a: std.mem.Allocator, path: []const u8) !void {
    if (!isSupportedPath(path)) return;
    if (queue.items.len >= max_pending) return;
    if (queue_gpa == null) queue_gpa = a;
    const gpa = queue_gpa.?;
    const copy = try gpa.dupe(u8, path);
    errdefer gpa.free(copy);
    try queue.append(gpa, copy);
}

fn handleOpenFiles(_: *anyopaque, paths: []const []const u8) void {
    for (paths) |p| pushValidated(p);
}

fn pushValidated(path: []const u8) void {
    const gpa = queue_gpa orelse return;
    enqueue(gpa, path) catch {};
}

test "isSupportedPath only accepts .glb" {
    const t = std.testing;
    try t.expect(isSupportedPath("model.glb"));
    try t.expect(isSupportedPath("/tmp/Hello.GLB"));
    try t.expect(isSupportedPath("a.Glb"));
    try t.expect(isSupportedPath(".glb"));
    try t.expect(!isSupportedPath("model.gltf"));
    try t.expect(!isSupportedPath("model.glb.bak"));
    try t.expect(!isSupportedPath("modelglb"));
    try t.expect(!isSupportedPath(""));
    try t.expect(!isSupportedPath("glb"));
    try t.expect(!isSupportedPath("model.glb "));
    try t.expect(!isSupportedPath("model.glb/"));
    try t.expect(!isSupportedPath("mo\x00del.glb"));
}

test "queue is bounded, keeps earliest, take transfers ownership" {
    const t = std.testing;
    queue_gpa = t.allocator;
    defer deinit();

    pushValidated("b.gltf"); // filtered, never queued
    var i: usize = 0;
    while (i < max_pending + 4) : (i += 1) {
        var buf: [32]u8 = undefined;
        const p = try std.fmt.bufPrint(&buf, "m{d}.glb", .{i});
        pushValidated(p);
    }
    try t.expectEqual(max_pending, pendingCount());

    const got = try take(t.allocator);
    defer {
        for (got) |p| t.allocator.free(p);
        t.allocator.free(got);
    }
    try t.expectEqual(max_pending, got.len);
    try t.expectEqualStrings("m0.glb", got[0]);
    try t.expectEqualStrings("m15.glb", got[max_pending - 1]);
    try t.expectEqual(@as(usize, 0), pendingCount());

    const again = try take(t.allocator);
    defer t.allocator.free(again);
    try t.expectEqual(@as(usize, 0), again.len);
}

test "enqueue before install owns the queue, take drains it" {
    const t = std.testing;
    defer deinit();

    try enqueue(t.allocator, "first.glb");
    try enqueue(t.allocator, "skip.gltf"); // filtered, no slot taken
    try t.expectEqual(@as(usize, 1), pendingCount());

    const got = try take(t.allocator);
    defer {
        for (got) |p| t.allocator.free(p);
        t.allocator.free(got);
    }
    try t.expectEqual(@as(usize, 1), got.len);
    try t.expectEqualStrings("first.glb", got[0]);
    try t.expectEqual(@as(usize, 0), pendingCount());
}
