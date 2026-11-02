//! The web frontend served to the app's webview.
//!
//! build.zig scans `app/web/dist`, copies every file into the generated
//! `dist_assets` module and embeds it, so the binary is self-contained and
//! Vite's hashed names need no list here.
const std = @import("std");
const nanoui = @import("nanoui");
const dist = @import("dist_assets");

fn build(comptime entries: []const dist.Entry) [entries.len]nanoui.Asset {
    var out: [entries.len]nanoui.Asset = undefined;
    for (entries, 0..) |e, i| out[i] = .{ .path = e.url, .data = e.data };
    return out;
}

/// Served at `nanoui://localhost<path>`; `/` is rewritten to `/index.html`.
pub const list: []const nanoui.Asset = &build(&dist.entries);

test "dist assets are listed with leading slashes" {
    try std.testing.expect(list.len >= 1);
    for (list) |a| try std.testing.expect(a.path.len > 0 and a.path[0] == '/');
}
