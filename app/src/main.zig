//! assetty desktop app: a nanoui window showing the web frontend, with the
//! glTF toolkit exposed to it through `Backend`.
//!
//! The web UI runs in the system webview: WKWebView on macOS, WebView2 on
//! Windows (nanoui 0.10+), WebKitGTK on Linux (nanoui 0.12+). A machine whose
//! runtime webview is missing (no WebView2 on Windows, no WebKitGTK on
//! Linux) falls back to a native window pointing at the CLI, where the full
//! toolkit stays available.
//!
//! Headless checks nanoui understands:
//!   assetty-app --nanoui-eval='...' --nanoui-wait=2
//!   assetty-app --nanoui-generate=app/web       (writes nanoui.js/d.ts)
//! `--nanoui-snapshot` needs a native-UI window, so it does not apply here.
const std = @import("std");
const builtin = @import("builtin");
const nanoui = @import("nanoui");
const native_open = @import("native_open.zig");

const has_page = nanoui.Call != void;

pub fn run(init: std.process.Init) !u8 {
    defer native_open.deinit();
    // Resolve document arguments before the installed bundle switches to its
    // writable data directory. CLI commands never enter this function.
    var args = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
    defer args.deinit();
    _ = args.skip();
    const cwd = try std.process.currentPathAlloc(init.io, init.gpa);
    defer init.gpa.free(cwd);
    while (args.next()) |arg| {
        if (!native_open.isSupportedPath(arg)) continue;
        const path = try std.fs.path.resolve(init.gpa, &.{ cwd, arg });
        // The defer is scoped to the loop body: the copy is released at the
        // end of this iteration, not when the app exits.
        defer init.gpa.free(path);
        try native_open.enqueue(init.gpa, path);
    }
    try @import("paths.zig").prepare(init);
    if (has_page) return runPage(init);
    return runNative(init);
}

fn runPage(init: std.process.Init) !u8 {
    const backend_mod = @import("backend.zig");
    const events = @import("events.zig");
    const assets = @import("assets.zig");

    const app = try nanoui.App.create(init, .{ .name = "assetty" });
    defer app.destroy();
    native_open.install(app);

    var backend = backend_mod.Backend{ .gpa = init.gpa, .io = init.io };
    // Before `destroy`: a delivery still queued after this must not touch the app.
    defer backend.shutdown();
    try app.bind(&backend);

    // Events first: the generated client carries their declarations.
    try app.registerEvent(events.Progress);
    try app.registerEvent(events.Log);
    try app.registerEvent(events.OptimizeDone);
    try app.registerEvent(events.LodsDone);
    try app.registerEvent(events.ExportDone);
    try app.registerEvent(events.TextureEncodeDone);
    try app.registerEvent(events.TexturePreviewDone);

    const w = try app.newWindow(.{
        .title = "assetty",
        .width = 1400,
        .height = 900,
        .min_width = 900,
        .min_height = 600,
        .content = .{ .page = .{
            .url = "/",
            .assets = assets.list,
        } },
    });

    // No runtime webview (Windows without the WebView2 runtime, Linux without
    // WebKitGTK 2.40+): nanoui keeps the window but shows its own notice view
    // instead of a page (`page == null`). Swap it for ours, which points at
    // the CLI.
    const no_webview = builtin.os.tag == .windows or builtin.os.tag == .linux;
    if (no_webview and w.page == null) {
        w.close();
        try showNotice(app);
    }

    try app.run();
    return 0;
}

/// Native fallback where there is no webview: a window pointing at the CLI.
fn runNative(init: std.process.Init) !u8 {
    const app = try nanoui.App.create(init, .{ .name = "assetty" });
    defer app.destroy();

    try showNotice(app);

    try app.run();
    return 0;
}

fn showNotice(app: *nanoui.App) !void {
    var notice: Notice = .{};
    _ = try app.newWindow(.{
        .title = "assetty",
        .width = 640,
        .height = 320,
        .content = .{ .view = nanoui.ui.View.init(&notice, Notice.view) },
    });
}

const Notice = struct {
    fn view(_: *Notice, c: *nanoui.ui.Context) void {
        nanoui.ui.column(c, .{ .width = .fill, .height = .fill, .align_items = .center, .justify = .center, .gap = 8 });
        defer nanoui.ui.end(c);
        nanoui.ui.heading(c, "assetty");
        nanoui.ui.label(c, "The web UI needs a system webview,");
        nanoui.ui.label(c, "which this platform has none of.");
        nanoui.ui.label(c, "Use the CLI: info | optimize | textures | presets");
    }
};
