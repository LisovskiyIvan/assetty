//! Hand-rolled JSON writers shared by the app's backend methods.
//!
//! nanoui serialises a bound method's return value with `std.json`; methods
//! that need a bespoke shape (the same ones the CLI prints) build the text
//! here and return it wrapped in `Raw`, which `std.json` emits verbatim.
const std = @import("std");
const core = @import("core");

/// Pre-formatted JSON, emitted as-is by nanoui's reply writer.
/// (The generated `nanoui.d.ts` describes it by its Zig fields; the value on
/// the wire is the JSON text itself.)
pub const Raw = struct {
    text: []const u8,

    pub fn jsonStringify(self: Raw, jws: anytype) !void {
        try jws.writer.writeAll(self.text);
    }
};

pub fn raw(text: []const u8) Raw {
    return .{ .text = text };
}

/// `{"error":"<message>"}` allocated from `a`.
pub fn errorRaw(a: std.mem.Allocator, comptime fmt: []const u8, args: anytype) !Raw {
    var aw: std.Io.Writer.Allocating = .init(a);
    errdefer aw.deinit();
    try aw.writer.writeAll("{\"error\":");
    var buf: [512]u8 = undefined;
    try jsonStr(&aw.writer, std.fmt.bufPrint(&buf, fmt, args) catch "error");
    try aw.writer.writeByte('}');
    return raw(try aw.toOwnedSlice());
}

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

fn deltaPct(before: u64, after: u64) ?f64 {
    if (before == 0) return if (after == 0) @as(f64, 0) else null;
    const b: f64 = @floatFromInt(before);
    const af: f64 = @floatFromInt(after);
    return (af - b) / b * 100.0;
}

fn deltaJson(w: anytype, before: u64, after: u64) !void {
    try w.print("{{\"before\":{d},\"after\":{d},\"pct\":", .{ before, after });
    if (deltaPct(before, after)) |p| {
        try w.print("{d:.2}", .{p});
    } else {
        try w.writeAll("null");
    }
    try w.writeByte('}');
}

/// `assetty info <file> --json` (see cli/src/main.zig).
pub fn writeInfo(w: anytype, path: []const u8, asset: core.model.Asset, st: core.stats.Stats) !void {
    try w.writeAll("{\n  \"file\": ");
    try jsonStr(w, path);
    try w.print(",\n  \"container\": \"{s}\",\n", .{if (asset.is_glb) "glb" else "gltf"});
    try w.writeAll("  \"generator\": ");
    try jsonStrOpt(w, asset.generator);
    try w.writeAll(",\n  \"version\": ");
    try jsonStrOpt(w, asset.version);

    try w.writeAll(",\n  \"extensions_used\": [");
    for (asset.extensions_used, 0..) |e, i| {
        if (i > 0) try w.writeByte(',');
        try jsonStr(w, e);
    }
    try w.writeAll("],\n  \"extensions_required\": [");
    for (asset.extensions_required, 0..) |e, i| {
        if (i > 0) try w.writeByte(',');
        try jsonStr(w, e);
    }
    try w.writeAll("]");

    const json_pct: f64 = if (st.disk_total > 0)
        @as(f64, @floatFromInt(st.disk_json)) / @as(f64, @floatFromInt(st.disk_total)) * 100
    else
        0;
    try w.print(",\n  \"counts\": {{\"scenes\":{d},\"nodes\":{d},\"meshes\":{d},\"primitives\":{d},\"materials\":{d},\"textures\":{d},\"images\":{d},\"animations\":{d},\"skins\":{d},\"joints\":{d}}}", .{ st.scenes, st.nodes, st.meshes, st.primitives, st.materials, st.textures, st.images, st.animations, st.skins, st.joints_total });
    try w.print(",\n  \"geometry\": {{\"triangles\":{d},\"vertices\":{d},\"mesh_instances\":{d},\"draw_calls\":{d}}}", .{ st.triangles, st.vertices, st.mesh_instances, st.draw_calls });
    try w.print(",\n  \"disk\": {{\"total\":{d},\"json\":{d},\"bin\":{d},\"json_pct\":{d:.1}}}", .{ st.disk_total, st.disk_json, st.disk_bin, json_pct });

    try w.print(",\n  \"vram\": {{\"total_est\":{d},\"images\":[", .{st.vram_total});
    for (st.image_stats, 0..) |im, i| {
        if (i > 0) try w.writeByte(',');
        try w.print("\n    {{\"index\":{d},\"name\":", .{im.index});
        try jsonStrOpt(w, im.name);
        try w.print(",\"format\":\"{s}\",\"width\":{d},\"height\":{d},\"vram\":{d},\"disk\":{d},\"has_mips\":{s}}}", .{ im.format_label, im.width, im.height, im.vram, im.disk_bytes, if (im.has_mips) "true" else "false" });
    }
    try w.writeAll("\n  ]}");

    try w.writeAll(",\n  \"garbage\": {\"unused_nodes\":");
    try idxList(w, st.garbage.unused_nodes);
    try w.writeAll(",\"unused_materials\":");
    try idxList(w, st.garbage.unused_materials);
    try w.writeAll(",\"unused_textures\":");
    try idxList(w, st.garbage.unused_textures);
    try w.writeAll(",\"unused_images\":");
    try idxList(w, st.garbage.unused_images);
    try w.writeAll(",\"no_mips_images\":");
    try idxList(w, st.garbage.no_mips_images);
    try w.writeAll(",\"uncompressed_embedded\":");
    try idxList(w, st.garbage.uncompressed_embedded);
    try w.writeAll("}\n}\n");
}

pub const EncodeResult = struct {
    index: u32,
    name: ?[]const u8,
    width: u32,
    height: u32,
    mode: core.encode_ktx.Mode,
    quality: u8,
    srgb: bool,
    normal_map: bool,
    src_disk_bytes: u64,
    ktx2_bytes: u64,
    format_label: []const u8,
    mip_levels: u32,
    vram_before: u64,
    vram_after: u64,
    psnr_db: f32,
};

/// `assetty textures <file> [--encode N] --json` (see cli/src/main.zig).
pub fn writeTextures(
    w: anytype,
    path: []const u8,
    asset: core.model.Asset,
    st: core.stats.Stats,
    encode_idx: ?u32,
    enc: ?EncodeResult,
) !void {
    try w.writeAll("{\n  \"file\": ");
    try jsonStr(w, path);
    try w.print(",\n  \"images_count\": {d},\n  \"vram_total_est\": {d},\n  \"images\": [", .{
        asset.images.len,
        st.vram_total,
    });
    for (st.image_stats, 0..) |im, i| {
        if (i > 0) try w.writeByte(',');
        try w.writeAll("\n    {\"index\":");
        try w.print("{d},\"name\":", .{im.index});
        try jsonStrOpt(w, im.name);
        try w.writeAll(",\"format\":");
        try jsonStr(w, im.format_label);
        try w.print(",\"width\":{d},\"height\":{d},\"disk\":{d},\"vram\":{d},\"has_mips\":{s}}}", .{
            im.width,
            im.height,
            im.disk_bytes,
            im.vram,
            if (im.has_mips) "true" else "false",
        });
    }
    try w.writeAll("\n  ]");

    if (encode_idx) |idx| {
        try w.print(",\n  \"encode_request\": {d}", .{idx});
        if (enc) |e| {
            try w.writeAll(",\n  \"encode\": {\"index\":");
            try w.print("{d},\"name\":", .{e.index});
            try jsonStrOpt(w, e.name);
            try w.writeAll(",\"mode\":\"");
            try w.writeAll(if (e.mode == .etc1s) "etc1s" else "uastc");
            try w.print("\",\"quality\":{d},\"srgb\":{s},\"normal_map\":{s}", .{
                e.quality,
                if (e.srgb) "true" else "false",
                if (e.normal_map) "true" else "false",
            });
            try w.print(",\"width\":{d},\"height\":{d},\"mip_levels\":{d},\"format\":", .{
                e.width, e.height, e.mip_levels,
            });
            try jsonStr(w, e.format_label);
            try w.print(",\"source_bytes\":{d},\"ktx2_bytes\":{d},\"vram_before\":{d},\"vram_after\":{d},\"psnr_db\":{d:.2}}}", .{
                e.src_disk_bytes,
                e.ktx2_bytes,
                e.vram_before,
                e.vram_after,
                e.psnr_db,
            });
        } else {
            try w.writeAll(",\n  \"encode\": null");
        }
    }
    try w.writeAll("\n}\n");
}

/// `assetty optimize <file> --preset <name> --json` (see cli/src/main.zig).
pub fn writeOptimize(
    w: anytype,
    file_path: []const u8,
    out_path: []const u8,
    p: core.preset.Preset,
    rep: core.runner.Report,
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
    // Per-image textures outcomes (only present when the preset used overrides).
    if (rep.texture_images.len > 0) {
        try w.writeAll(",\n  \"texture_images\": [");
        for (rep.texture_images, 0..) |im, i| {
            if (i > 0) try w.writeByte(',');
            try w.print("\n    {{\"index\":{d},\"name\":", .{im.index});
            try jsonStrOpt(w, im.name);
            try w.writeAll(",\"format\":");
            try jsonStr(w, im.format);
            try w.print(",\"skipped\":{s}}}", .{if (im.skipped) "true" else "false"});
        }
        try w.writeAll("\n  ]");
    }
    try w.print("}},\n  \"total_secs\": {d:.3}\n}}\n", .{rep.total_secs});
}

/// Lint result for one file: mirrors `assetty lint --json` for a single path.
pub fn writeLint(w: anytype, path: []const u8, vs: []const core.lint.Violation) !void {
    try w.writeAll("{\"file\": ");
    try jsonStr(w, path);
    try w.writeAll(", \"violations\": [");
    for (vs, 0..) |v, i| {
        if (i > 0) try w.writeByte(',');
        try w.writeAll("{\"code\": ");
        try jsonStr(w, v.code);
        try w.writeAll(", \"message\": ");
        try jsonStr(w, v.message);
        try w.writeAll(", \"index\": ");
        if (v.index) |ix| {
            try w.print("{d}", .{ix});
        } else {
            try w.writeAll("null");
        }
        try w.writeByte('}');
    }
    try w.print("],\n  \"total\": {d}\n}}\n", .{vs.len});
}

test "raw json is emitted verbatim" {
    var buf: [128]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(raw("{\"a\":1}"), .{}, &w);
    try std.testing.expectEqualStrings("{\"a\":1}", w.buffered());
}

test "json string escaping" {
    var buf: [64]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try jsonStr(&w, "a\"b\\c\nd");
    try std.testing.expectEqualStrings("\"a\\\"b\\\\c\\nd\"", w.buffered());
}
