//! Shared hand-rolled JSON primitives for the CLI and the app backend.
//!
//! Both writers build the same shapes (`info`, `textures`, `optimize`); these
//! helpers lived copy-pasted in `cli/src/main.zig` and `app/src/json.zig`.
//! Everything is generic over the writer (`w: anytype`) so `std.Io.Writer`
/// flavors and test buffers all work.
const std = @import("std");

pub fn jsonStr(w: anytype, s: []const u8) !void {
    try w.writeByte('"');
    for (s) |ch| switch (ch) {
        '"' => try w.writeAll("\\\""),
        '\\' => try w.writeAll("\\\\"),
        '\n' => try w.writeAll("\\n"),
        '\r' => try w.writeAll("\\r"),
        '\t' => try w.writeAll("\\t"),
        else => {
            if (ch < 0x20) {
                try w.print("\\u{x:0>4}", .{ch});
            } else try w.writeByte(ch);
        },
    };
    try w.writeByte('"');
}

pub fn jsonStrOpt(w: anytype, s: ?[]const u8) !void {
    if (s) |v| try jsonStr(w, v) else try w.writeAll("null");
}

pub fn idxList(w: anytype, list: []const u32) !void {
    try w.writeByte('[');
    for (list, 0..) |v, i| {
        if (i > 0) try w.writeByte(',');
        try w.print("{d}", .{v});
    }
    try w.writeByte(']');
}

pub fn deltaPct(before: u64, after: u64) ?f64 {
    if (before == 0) return if (after == 0) @as(f64, 0) else null;
    const b: f64 = @floatFromInt(before);
    const af: f64 = @floatFromInt(after);
    return (af - b) / b * 100.0;
}

pub fn deltaJson(w: anytype, before: u64, after: u64) !void {
    try w.print("{{\"before\":{d},\"after\":{d},\"pct\":", .{ before, after });
    if (deltaPct(before, after)) |p| {
        try w.print("{d:.2}", .{p});
    } else {
        try w.writeAll("null");
    }
    try w.writeByte('}');
}

test "json string escaping" {
    var buf: [64]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try jsonStr(&w, "a\"b\\c\nd");
    try std.testing.expectEqualStrings("\"a\\\"b\\\\c\\nd\"", w.buffered());
}

test "delta json null pct on zero before" {
    var buf: [64]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try deltaJson(&w, 0, 5);
    try std.testing.expectEqualStrings("{\"before\":0,\"after\":5,\"pct\":null}", w.buffered());
}
