//! The `optimize` report JSON — one writer for the CLI and the app.
//!
//! Both consumers parse the same document, so the shape lives here instead
//! of being written twice (the CLI's copy and the app backend's copy drifted
//! once already). The writer is generic over the sink (`w: anytype`), so a
//! file, a socket buffer and a test buffer all work.
const std = @import("std");
const runner = @import("pipeline/runner.zig");
const preset = @import("pipeline/preset.zig");

const jsonStr = @import("json_util.zig").jsonStr;
const jsonStrOpt = @import("json_util.zig").jsonStrOpt;
const deltaJson = @import("json_util.zig").deltaJson;

/// Writes the report of one optimize run. `file_path`/`out_path` are echoed
/// as the `input`/`output` fields.
pub fn writeOptimize(
    w: anytype,
    file_path: []const u8,
    out_path: []const u8,
    p: preset.Preset,
    rep: runner.Report,
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
        try w.print(", \"secs\": {d:.4}", .{st.secs});
        // A step that ran but failed ("textures" could not encode) is not the
        // same as one that was skipped: the caller must be able to tell.
        if (st.failed) try w.writeAll(", \"failed\": true");
        // The textures step also carries the per-image rows (same data as the
        // root `texture_images`, placed on the step where the page looks).
        if (std.mem.eql(u8, st.kind, "textures") and rep.texture_images.len > 0) {
            try w.writeAll(", \"images\": [");
            for (rep.texture_images, 0..) |im, j| {
                if (j > 0) try w.writeByte(',');
                try w.print("{{\"index\":{d},\"name\":", .{im.index});
                try jsonStrOpt(w, im.name);
                try w.writeAll(",\"format\":");
                try jsonStr(w, im.format);
                try w.print(",\"skipped\":{s}}}", .{if (im.skipped) "true" else "false"});
            }
            try w.writeByte(']');
        }
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
    try w.writeAll(",\n    \"animations\": ");
    try deltaJson(w, rep.before.animations, rep.after.animations);
    try w.writeAll("\n  },\n  \"before\": {\"triangles\":");
    try w.print("{d},\"vertices\":{d},\"draw_calls\":{d},\"vram\":{d},\"disk\":{d}", .{
        rep.before.triangles,
        rep.before.vertices,
        rep.before.draw_calls,
        rep.before.vram_total,
        rep.before.disk_total,
    });
    try w.writeAll("},\n  \"after\": {\"triangles\":");
    try w.print("{d},\"vertices\":{d},\"draw_calls\":{d},\"vram\":{d},\"disk\":{d}", .{
        rep.after.triangles,
        rep.after.vertices,
        rep.after.draw_calls,
        rep.after.vram_total,
        rep.after.disk_total,
    });
    // Per-image textures outcomes (empty when the preset used no overrides).
    try w.writeAll("},\n  \"texture_images\": [");
    for (rep.texture_images, 0..) |im, i| {
        if (i > 0) try w.writeByte(',');
        try w.print("\n    {{\"index\":{d},\"name\":", .{im.index});
        try jsonStrOpt(w, im.name);
        try w.writeAll(",\"format\":");
        try jsonStr(w, im.format);
        try w.print(",\"skipped\":{s}}}", .{if (im.skipped) "true" else "false"});
    }
    try w.writeAll("\n  ]");
    try w.print(",\n  \"total_secs\": {d:.3}\n}}\n", .{rep.total_secs});
}

test "optimize report carries the steps, deltas and per-image rows" {
    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    const p: preset.Preset = .{ .name = "mobile", .target = .mobile, .steps = &.{} };
    const rep: runner.Report = .{
        .steps = &.{.{ .kind = "prune", .applied = true, .note = "ok", .secs = 0.5 }},
        .before = .{},
        .after = .{},
        .texture_images = &.{.{ .index = 0, .name = "base", .format = "etc1s" }},
    };
    try writeOptimize(&w, "in.glb", "out.glb", p, rep);
    const text = w.buffered();
    try std.testing.expect(std.mem.indexOf(u8, text, "\"preset\": \"mobile\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "\"kind\": \"prune\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "\"texture_images\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, text, "\"total_secs\"") != null);
}

test "a failed step is marked as failed, a skipped one is not" {
    var buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    const p: preset.Preset = .{ .name = "mobile", .target = .mobile, .steps = &.{} };
    const rep: runner.Report = .{
        .steps = &.{
            .{ .kind = "prune", .applied = true, .note = "ok" },
            .{ .kind = "textures", .applied = false, .failed = true, .note = "failed: OutOfMemory" },
            .{ .kind = "join", .applied = false, .note = "not implemented, skipped" },
        },
        .before = .{},
        .after = .{},
    };
    try writeOptimize(&w, "in.glb", "out.glb", p, rep);
    const text = w.buffered();
    // The failed step carries the flag...
    try std.testing.expect(std.mem.indexOf(u8, text, "\"failed\": true") != null);
    // ...and it belongs to the textures step, not to the skipped one.
    const textures_at = std.mem.indexOf(u8, text, "\"kind\": \"textures\"").?;
    const failed_at = std.mem.indexOf(u8, text, "\"failed\": true").?;
    try std.testing.expect(textures_at < failed_at);
    // A skipped step is not a failed one: the flag appears exactly once.
    var count: usize = 0;
    var at: usize = 0;
    while (std.mem.indexOfPos(u8, text, at, "\"failed\": true")) |pos| : (at = pos + 1) count += 1;
    try std.testing.expectEqual(@as(usize, 1), count);
}
