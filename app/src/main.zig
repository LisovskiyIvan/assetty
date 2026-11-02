//! assetty desktop app: a nanoui window showing the web frontend, with the
//! glTF toolkit exposed to it through `Backend`.
//!
//! Headless checks nanoui understands:
//!   assetty-app --nanoui-eval='...' --nanoui-wait=2
//!   assetty-app --nanoui-generate=app/web       (writes nanoui.js/d.ts)
//! `--nanoui-snapshot` needs a native-UI window, so it does not apply here.
const std = @import("std");
const nanoui = @import("nanoui");
const backend_mod = @import("backend.zig");
const events = @import("events.zig");
const assets = @import("assets.zig");

pub fn run(init: std.process.Init) !u8 {
    const app = try nanoui.App.create(init, .{ .name = "assetty" });
    defer app.destroy();

    var backend = backend_mod.Backend{ .gpa = init.gpa, .io = init.io };
    // Before `destroy`: a delivery still queued after this must not touch the app.
    defer backend.shutdown();
    try app.bind(&backend);

    // Events first: the generated client carries their declarations.
    try app.registerEvent(events.Progress);
    try app.registerEvent(events.Log);
    try app.registerEvent(events.OptimizeDone);
    try app.registerEvent(events.TextureEncodeDone);
    try app.registerEvent(events.TexturePreviewDone);

    _ = try app.newWindow(.{
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

    try app.run();
    return 0;
}
