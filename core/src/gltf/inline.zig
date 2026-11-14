//! `.gltf` -> self-contained `.gltf` for the in-app viewer.
//!
//! Babylon loads in-memory bytes as a GLB binary, so a text `.gltf` is fed to
//! it as a `data:` string — which means every relative buffer/image uri must
//! already be inlined. The optimizer/CLI read resources through cgltf and the
//! writer (see `parse.zig` / `write.zig`); this module is only the preview
//! path, so it rewrites the JSON in place: each local uri becomes a base64
//! `data:` URL and the document is stringified back.
//!
//! Absolute URLs (`https://…`) are left alone — Babylon may fetch them, and
//! there is no local file to read. Unreadable local resources are an error:
//! previewing a model with missing textures should say so, not silently drop
//! them.

const std = @import("std");
const parse = @import("parse.zig");

pub const Error = error{
    /// The source is not a JSON glTF document.
    NotGltf,
    /// The inlined document or one resource exceeds the preview budget.
    ResourceTooLarge,
    /// A relative buffer/image uri cannot be read next to the .gltf.
    MissingResource,
} || std.mem.Allocator.Error;

/// Source .gltf JSON ceiling (matches the app's `max_load_bytes`).
pub const max_json_bytes: usize = 512 << 20;

/// Total budget for inlined resources: the result is base64-encoded once more
/// for IPC, so anything larger would not fit comfortably in the webview.
pub const max_total_bytes: usize = 256 << 20;

/// Reads `path` and returns a `.gltf` document whose local buffers/images are
/// base64 data uris. Allocations come from `a` (an arena is expected).
pub fn selfContained(a: std.mem.Allocator, io: std.Io, path: []const u8) ![]const u8 {
    const bytes = std.Io.Dir.cwd().readFileAlloc(io, path, a, .limited(max_json_bytes)) catch |err| switch (err) {
        error.StreamTooLong => return error.ResourceTooLarge,
        else => return err,
    };

    var root = std.json.parseFromSliceLeaky(std.json.Value, a, parse.stripBom(bytes), .{}) catch return error.NotGltf;
    if (root != .object) return error.NotGltf;

    const dir = std.fs.path.dirname(path);
    var total: usize = 0;
    var changed = false;
    for ([_][]const u8{ "buffers", "images" }) |key| {
        const list = root.object.getPtr(key) orelse continue;
        if (list.* != .array) continue;
        for (list.array.items) |*item| {
            if (item.* != .object) continue;
            const uri_ptr = item.object.getPtr("uri") orelse continue;
            const uri = switch (uri_ptr.*) {
                .string => |s| s,
                else => continue,
            };
            if (uri.len == 0) continue;
            if (std.mem.startsWith(u8, uri, "data:")) continue;
            if (std.mem.indexOf(u8, uri, "://") != null) continue;

            const decoded = try parse.percentDecode(a, uri);
            const src = if (dir) |d| try std.fs.path.join(a, &.{ d, decoded }) else decoded;
            const payload = std.Io.Dir.cwd().readFileAlloc(io, src, a, .limited(max_total_bytes)) catch |err| switch (err) {
                error.StreamTooLong => return error.ResourceTooLarge,
                else => return error.MissingResource,
            };
            total += payload.len;
            if (total > max_total_bytes) return error.ResourceTooLarge;

            const encoded = try a.alloc(u8, std.base64.standard.Encoder.calcSize(payload.len));
            _ = std.base64.standard.Encoder.encode(encoded, payload);
            const mime: []const u8 = if (std.mem.eql(u8, key, "images")) mimeForName(src) else "application/octet-stream";
            uri_ptr.* = .{ .string = try std.fmt.allocPrint(a, "data:{s};base64,{s}", .{ mime, encoded }) };
            changed = true;
        }
    }

    if (!changed) return bytes;
    var aw: std.Io.Writer.Allocating = .init(a);
    try std.json.Stringify.value(root, .{}, &aw.writer);
    return aw.toOwnedSlice();
}

/// Data-uri mime for an image file. `application/octet-stream` makes Babylon
/// sniff the bytes, which works for every format it decodes.
fn mimeForName(name: []const u8) []const u8 {
    const dot = std.mem.lastIndexOfScalar(u8, name, '.') orelse return "application/octet-stream";
    const ext = name[dot + 1 ..];
    if (std.ascii.eqlIgnoreCase(ext, "png")) return "image/png";
    if (std.ascii.eqlIgnoreCase(ext, "jpg") or std.ascii.eqlIgnoreCase(ext, "jpeg")) return "image/jpeg";
    if (std.ascii.eqlIgnoreCase(ext, "webp")) return "image/webp";
    if (std.ascii.eqlIgnoreCase(ext, "ktx2")) return "image/ktx2";
    return "application/octet-stream";
}

test "selfContained inlines local buffers and images" {
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const out = try selfContained(a, io, "test/fixtures/gltf/box/box.gltf");
    try std.testing.expect(std.mem.indexOf(u8, out, "\"uri\": \"box.bin\"") == null);
    try std.testing.expect(std.mem.indexOf(u8, out, "data:application/octet-stream;base64,") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "data:image/png;base64,") != null);

    // The rewritten document is still valid JSON with an asset block.
    var parsed = try std.json.parseFromSlice(std.json.Value, a, out, .{});
    defer parsed.deinit();
    try std.testing.expect(parsed.value == .object);
    try std.testing.expect(parsed.value.object.get("asset") != null);
}

test "selfContained reports a missing local resource" {
    const io = std.testing.io;
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const dir = ".zig-cache/inline-missing";
    try std.Io.Dir.cwd().createDirPath(io, dir);
    defer std.Io.Dir.cwd().deleteTree(io, dir) catch {};
    const path = dir ++ "/m.gltf";
    try std.Io.Dir.cwd().writeFile(io, .{
        .sub_path = path,
        .data = "{\"asset\":{\"version\":\"2.0\"},\"images\":[{\"uri\":\"nope.png\"}]}",
    });
    try std.testing.expectError(error.MissingResource, selfContained(a, io, path));
}
