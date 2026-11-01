//! Structured diff between two parsed glTF assets.
//!
//! Matching rules: items are matched by name when both sides carry a non-null
//! name; otherwise by their index. Unmatched old items are reported as
//! `removed`, unmatched new items as `added`, matched items whose compared
//! fields differ as `changed` (with the list of changed field names).
//!
//! All allocations come from the allocator passed to `compare`. `Report`
//! borrows `name` slices from the input assets, so the assets must outlive the
//! report. Call `Report.deinit(a)` when not using an arena.

const std = @import("std");
const model = @import("gltf/model.zig");

pub const Entry = struct {
    index: u32,
    name: ?[]const u8,
};

pub const ChangedEntry = struct {
    index: u32,
    name: ?[]const u8,
    fields: []const []const u8,
};

pub const Category = struct {
    added: []const Entry = &.{},
    removed: []const Entry = &.{},
    changed: []const ChangedEntry = &.{},

    pub fn isEmpty(self: Category) bool {
        return self.added.len == 0 and self.removed.len == 0 and self.changed.len == 0;
    }

    fn deinit(self: *Category, a: std.mem.Allocator) void {
        for (self.changed) |ch| {
            if (ch.fields.len > 0) a.free(ch.fields);
        }
        if (self.changed.len > 0) a.free(self.changed);
        if (self.added.len > 0) a.free(self.added);
        if (self.removed.len > 0) a.free(self.removed);
        self.* = .{};
    }
};

pub const Report = struct {
    nodes: Category = .{},
    meshes: Category = .{},
    materials: Category = .{},
    textures: Category = .{},
    images: Category = .{},
    animations: Category = .{},
    skins: Category = .{},

    pub fn deinit(self: *Report, a: std.mem.Allocator) void {
        self.nodes.deinit(a);
        self.meshes.deinit(a);
        self.materials.deinit(a);
        self.textures.deinit(a);
        self.images.deinit(a);
        self.animations.deinit(a);
        self.skins.deinit(a);
    }

    pub fn added(self: Report) usize {
        return self.nodes.added.len + self.meshes.added.len + self.materials.added.len +
            self.textures.added.len + self.images.added.len + self.animations.added.len +
            self.skins.added.len;
    }

    pub fn removed(self: Report) usize {
        return self.nodes.removed.len + self.meshes.removed.len + self.materials.removed.len +
            self.textures.removed.len + self.images.removed.len + self.animations.removed.len +
            self.skins.removed.len;
    }

    pub fn changed(self: Report) usize {
        return self.nodes.changed.len + self.meshes.changed.len + self.materials.changed.len +
            self.textures.changed.len + self.images.changed.len + self.animations.changed.len +
            self.skins.changed.len;
    }

    pub fn totalChanges(self: Report) usize {
        return self.added() + self.removed() + self.changed();
    }
};

/// Compare two assets. Caller owns the report (see `Report.deinit`).
pub fn compare(a: std.mem.Allocator, old: model.Asset, new: model.Asset) !Report {
    var rep: Report = .{};
    errdefer rep.deinit(a);
    rep.nodes = try diffCategory(model.Node, a, old.nodes, new.nodes, nodeFields);
    rep.meshes = try diffCategory(model.Mesh, a, old.meshes, new.meshes, meshFields);
    rep.materials = try diffCategory(model.Material, a, old.materials, new.materials, materialFields);
    rep.textures = try diffCategory(model.Texture, a, old.textures, new.textures, textureFields);
    rep.images = try diffCategory(model.Image, a, old.images, new.images, imageFields);
    rep.animations = try diffCategory(model.Animation, a, old.animations, new.animations, animationFields);
    rep.skins = try diffCategory(model.Skin, a, old.skins, new.skins, skinFields);
    return rep;
}

fn findUnusedByName(comptime T: type, new: []const T, name: []const u8, used: []const bool) ?u32 {
    for (new, 0..) |item, j| {
        if (used[j]) continue;
        const nm = item.name orelse continue;
        if (std.mem.eql(u8, nm, name)) return @intCast(j);
    }
    return null;
}

fn diffCategory(
    comptime T: type,
    a: std.mem.Allocator,
    old: []const T,
    new: []const T,
    comptime fieldsFn: fn (std.mem.Allocator, T, T) anyerror![]const []const u8,
) !Category {
    const new_used = try a.alloc(bool, new.len);
    defer if (new_used.len > 0) a.free(new_used);
    @memset(new_used, false);
    const old_to_new = try a.alloc(i64, old.len);
    defer if (old_to_new.len > 0) a.free(old_to_new);
    @memset(old_to_new, -1);

    // pass 1: match by name (both sides named)
    for (old, 0..) |o, i| {
        const on = o.name orelse continue;
        if (findUnusedByName(T, new, on, new_used)) |j| {
            old_to_new[i] = @intCast(j);
            new_used[j] = true;
        }
    }
    // pass 2: match unnamed leftovers by index
    for (old, 0..) |o, i| {
        if (old_to_new[i] != -1) continue;
        if (o.name != null) continue; // named but unmatched -> removed
        if (i >= new.len or new_used[i]) continue;
        old_to_new[i] = @intCast(i);
        new_used[i] = true;
    }

    var added: std.ArrayList(Entry) = .empty;
    var removed: std.ArrayList(Entry) = .empty;
    var changed: std.ArrayList(ChangedEntry) = .empty;
    errdefer {
        if (added.capacity > 0) added.deinit(a);
        if (removed.capacity > 0) removed.deinit(a);
        for (changed.items) |c| {
            if (c.fields.len > 0) a.free(c.fields);
        }
        if (changed.capacity > 0) changed.deinit(a);
    }

    for (new, 0..) |n, j| {
        if (new_used[j]) continue;
        try added.append(a, .{ .index = @intCast(j), .name = n.name });
    }
    for (old, 0..) |o, i| {
        if (old_to_new[i] == -1) {
            try removed.append(a, .{ .index = @intCast(i), .name = o.name });
            continue;
        }
        const j: usize = @intCast(old_to_new[i]);
        const fields = try fieldsFn(a, o, new[j]);
        if (fields.len == 0) {
            a.free(fields);
            continue;
        }
        try changed.append(a, .{ .index = @intCast(i), .name = o.name, .fields = fields });
    }

    return .{
        .added = try added.toOwnedSlice(a),
        .removed = try removed.toOwnedSlice(a),
        .changed = try changed.toOwnedSlice(a),
    };
}

// --- per-type comparisons ---------------------------------------------------

fn eqf(x: f32, y: f32) bool {
    return x == y;
}

fn eqf3(x: [3]f32, y: [3]f32) bool {
    return eqf(x[0], y[0]) and eqf(x[1], y[1]) and eqf(x[2], y[2]);
}

fn eqf4(x: [4]f32, y: [4]f32) bool {
    return eqf(x[0], y[0]) and eqf(x[1], y[1]) and eqf(x[2], y[2]) and eqf(x[3], y[3]);
}

fn eqTex(x: ?model.TextureInfo, y: ?model.TextureInfo) bool {
    const l = x orelse return y == null;
    const r = y orelse return false;
    return l.texture == r.texture and l.texcoord == r.texcoord;
}

fn hashBytes(data: ?[]const u8) u64 {
    var h = std.hash.Wyhash.init(0);
    if (data) |d| h.update(d);
    return h.final();
}

fn nodeFields(a: std.mem.Allocator, o: model.Node, n: model.Node) ![]const []const u8 {
    var l: std.ArrayList([]const u8) = .empty;
    if (!eqf3(o.translation, n.translation)) try l.append(a, "translation");
    if (!eqf4(o.rotation, n.rotation)) try l.append(a, "rotation");
    if (!eqf3(o.scale, n.scale)) try l.append(a, "scale");
    if (o.has_matrix != n.has_matrix) {
        try l.append(a, "has_matrix");
    } else if (o.has_matrix and !std.mem.eql(f32, &o.matrix, &n.matrix)) {
        try l.append(a, "matrix");
    }
    if (o.mesh != n.mesh) try l.append(a, "mesh");
    if (o.skin != n.skin) try l.append(a, "skin");
    if (o.children.len != n.children.len) {
        try l.append(a, "children_count");
    } else if (!std.mem.eql(u32, o.children, n.children)) {
        try l.append(a, "children");
    }
    return l.toOwnedSlice(a);
}

fn meshFields(a: std.mem.Allocator, o: model.Mesh, n: model.Mesh) ![]const []const u8 {
    var l: std.ArrayList([]const u8) = .empty;
    if (o.primitives.len != n.primitives.len) {
        try l.append(a, "primitive_count");
    }
    const count = @min(o.primitives.len, n.primitives.len);
    for (o.primitives[0..count], n.primitives[0..count], 0..) |op, np, k| {
        if (op.mode != np.mode) try l.append(a, try std.fmt.allocPrint(a, "primitives[{d}].mode", .{k}));
        if (op.vertex_count != np.vertex_count) try l.append(a, try std.fmt.allocPrint(a, "primitives[{d}].vertex_count", .{k}));
        if (op.index_count != np.index_count) try l.append(a, try std.fmt.allocPrint(a, "primitives[{d}].index_count", .{k}));
        if (op.indexed != np.indexed) try l.append(a, try std.fmt.allocPrint(a, "primitives[{d}].indexed", .{k}));
        if (op.material != np.material) try l.append(a, try std.fmt.allocPrint(a, "primitives[{d}].material", .{k}));
        if (!attributesEqual(op.attributes, np.attributes)) {
            try l.append(a, try std.fmt.allocPrint(a, "primitives[{d}].attributes", .{k}));
        }
    }
    return l.toOwnedSlice(a);
}

fn attributesEqual(o: []const model.Attribute, n: []const model.Attribute) bool {
    if (o.len != n.len) return false;
    for (o, n) |oa, na| {
        if (oa.semantic != na.semantic or
            oa.count != na.count or
            oa.component != na.component or
            oa.dim != na.dim) return false;
    }
    return true;
}

fn extensionsEqual(o: model.Extensions, n: model.Extensions) bool {
    const names = @typeInfo(model.Extensions).@"struct".field_names;
    inline for (names) |fname| {
        if (@field(o, fname) != @field(n, fname)) return false;
    }
    return true;
}

fn materialFields(a: std.mem.Allocator, o: model.Material, n: model.Material) ![]const []const u8 {
    var l: std.ArrayList([]const u8) = .empty;
    if (!eqf4(o.base_color_factor, n.base_color_factor)) try l.append(a, "base_color_factor");
    if (!eqf(o.metallic, n.metallic)) try l.append(a, "metallic");
    if (!eqf(o.roughness, n.roughness)) try l.append(a, "roughness");
    if (!eqTex(o.base_color_texture, n.base_color_texture)) try l.append(a, "base_color_texture");
    if (!eqTex(o.metallic_roughness_texture, n.metallic_roughness_texture)) try l.append(a, "metallic_roughness_texture");
    if (!eqTex(o.normal_texture, n.normal_texture)) try l.append(a, "normal_texture");
    if (!eqTex(o.occlusion_texture, n.occlusion_texture)) try l.append(a, "occlusion_texture");
    if (!eqTex(o.emissive_texture, n.emissive_texture)) try l.append(a, "emissive_texture");
    if (!eqf3(o.emissive_factor, n.emissive_factor)) try l.append(a, "emissive_factor");
    if (!eqf(o.normal_scale, n.normal_scale)) try l.append(a, "normal_scale");
    if (!eqf(o.occlusion_strength, n.occlusion_strength)) try l.append(a, "occlusion_strength");
    if (o.alpha_mode != n.alpha_mode) try l.append(a, "alpha_mode");
    if (!eqf(o.alpha_cutoff, n.alpha_cutoff)) try l.append(a, "alpha_cutoff");
    if (o.double_sided != n.double_sided) try l.append(a, "double_sided");
    if (o.has_pbr != n.has_pbr) try l.append(a, "has_pbr");
    if (!extensionsEqual(o.extensions, n.extensions)) try l.append(a, "extensions");
    return l.toOwnedSlice(a);
}

fn textureFields(a: std.mem.Allocator, o: model.Texture, n: model.Texture) ![]const []const u8 {
    var l: std.ArrayList([]const u8) = .empty;
    if (o.image != n.image) try l.append(a, "image");
    if (o.sampler != n.sampler) try l.append(a, "sampler");
    return l.toOwnedSlice(a);
}

fn imageFields(a: std.mem.Allocator, o: model.Image, n: model.Image) ![]const []const u8 {
    var l: std.ArrayList([]const u8) = .empty;
    if (o.mime != n.mime) try l.append(a, "mime");
    if (o.width != n.width) try l.append(a, "width");
    if (o.height != n.height) try l.append(a, "height");
    if ((o.data == null) != (n.data == null)) {
        try l.append(a, "image_bytes");
    } else if (o.data != null or n.data != null) {
        if (hashBytes(o.data) != hashBytes(n.data)) try l.append(a, "image_bytes");
    }
    const ou = o.uri orelse "";
    const nu = n.uri orelse "";
    if ((o.uri == null) != (n.uri == null) or !std.mem.eql(u8, ou, nu)) try l.append(a, "uri");
    return l.toOwnedSlice(a);
}

fn animationFields(a: std.mem.Allocator, o: model.Animation, n: model.Animation) ![]const []const u8 {
    var l: std.ArrayList([]const u8) = .empty;
    if (o.channels != n.channels) try l.append(a, "channels");
    if (o.samplers != n.samplers) try l.append(a, "samplers");
    if (o.duration != n.duration) try l.append(a, "duration");
    if (!std.mem.eql(u32, o.targets, n.targets)) try l.append(a, "targets");
    return l.toOwnedSlice(a);
}

fn skinFields(a: std.mem.Allocator, o: model.Skin, n: model.Skin) ![]const []const u8 {
    var l: std.ArrayList([]const u8) = .empty;
    if (o.joints != n.joints) try l.append(a, "joints");
    if (o.has_inverse_bind_matrices != n.has_inverse_bind_matrices) try l.append(a, "has_inverse_bind_matrices");
    return l.toOwnedSlice(a);
}

// --- output ----------------------------------------------------------------

fn jsonStr(w: anytype, s: []const u8) !void {
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

fn jsonStrOpt(w: anytype, s: ?[]const u8) !void {
    if (s) |v| try jsonStr(w, v) else try w.writeAll("null");
}

fn printCategoryHuman(w: anytype, label: []const u8, c: Category) !void {
    if (c.isEmpty()) return;
    try w.print("{s}\n", .{label});
    for (c.added) |e| {
        try w.print("  + [{d}] ", .{e.index});
        try w.writeAll(e.name orelse "-");
        try w.writeByte('\n');
    }
    for (c.removed) |e| {
        try w.print("  - [{d}] ", .{e.index});
        try w.writeAll(e.name orelse "-");
        try w.writeByte('\n');
    }
    for (c.changed) |e| {
        try w.print("  ~ [{d}] ", .{e.index});
        try w.writeAll(e.name orelse "-");
        try w.writeAll(" (");
        for (e.fields, 0..) |f, i| {
            if (i > 0) try w.writeAll(", ");
            try w.writeAll(f);
        }
        try w.writeAll(")\n");
    }
}

/// Human-readable multi-line report.
pub fn summary(rep: Report, w: anytype) !void {
    if (rep.totalChanges() == 0) {
        try w.writeAll("no changes\n");
        return;
    }
    try w.print("diff: {d} added, {d} removed, {d} changed\n", .{ rep.added(), rep.removed(), rep.changed() });
    try printCategoryHuman(w, "nodes", rep.nodes);
    try printCategoryHuman(w, "meshes", rep.meshes);
    try printCategoryHuman(w, "materials", rep.materials);
    try printCategoryHuman(w, "textures", rep.textures);
    try printCategoryHuman(w, "images", rep.images);
    try printCategoryHuman(w, "animations", rep.animations);
    try printCategoryHuman(w, "skins", rep.skins);
}

fn printCategoryJson(w: anytype, c: Category) !void {
    try w.writeAll("{\"added\":[");
    for (c.added, 0..) |e, i| {
        if (i > 0) try w.writeByte(',');
        try w.print("{{\"index\":{d},\"name\":", .{e.index});
        try jsonStrOpt(w, e.name);
        try w.writeByte('}');
    }
    try w.writeAll("],\"removed\":[");
    for (c.removed, 0..) |e, i| {
        if (i > 0) try w.writeByte(',');
        try w.print("{{\"index\":{d},\"name\":", .{e.index});
        try jsonStrOpt(w, e.name);
        try w.writeByte('}');
    }
    try w.writeAll("],\"changed\":[");
    for (c.changed, 0..) |e, i| {
        if (i > 0) try w.writeByte(',');
        try w.print("{{\"index\":{d},\"name\":", .{e.index});
        try jsonStrOpt(w, e.name);
        try w.writeAll(",\"fields\":[");
        for (e.fields, 0..) |f, k| {
            if (k > 0) try w.writeByte(',');
            try jsonStr(w, f);
        }
        try w.writeAll("]}");
    }
    try w.writeAll("]}");
}

/// Hand-rolled JSON report (same writer contract as the CLI).
pub fn reportJson(w: anytype, rep: Report) !void {
    try w.writeAll("{\n  \"nodes\": ");
    try printCategoryJson(w, rep.nodes);
    try w.writeAll(",\n  \"meshes\": ");
    try printCategoryJson(w, rep.meshes);
    try w.writeAll(",\n  \"materials\": ");
    try printCategoryJson(w, rep.materials);
    try w.writeAll(",\n  \"textures\": ");
    try printCategoryJson(w, rep.textures);
    try w.writeAll(",\n  \"images\": ");
    try printCategoryJson(w, rep.images);
    try w.writeAll(",\n  \"animations\": ");
    try printCategoryJson(w, rep.animations);
    try w.writeAll(",\n  \"skins\": ");
    try printCategoryJson(w, rep.skins);
    try w.print(",\n  \"totals\": {{\"added\":{d},\"removed\":{d},\"changed\":{d}}}\n}}\n", .{ rep.added(), rep.removed(), rep.changed() });
}

// --- tests -----------------------------------------------------------------

fn emptyAsset() model.Asset {
    return .{};
}

test "diff: rename node, add mesh, change material, remove texture, change image bytes" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const old_asset = model.Asset{
        .nodes = &.{
            .{ .name = "Root", .translation = .{ 0, 0, 0 } },
            .{ .name = "Gone" },
        },
        .meshes = &.{},
        .materials = &.{
            .{ .name = "mat", .metallic = 1.0 },
        },
        .textures = &.{
            .{ .name = "tex", .image = 0 },
        },
        .images = &.{
            .{ .name = "img", .mime = .png, .data = "AAAA", .width = 4, .height = 4 },
        },
    };

    const new_asset = model.Asset{
        .nodes = &.{
            .{ .name = "Root", .translation = .{ 1, 0, 0 } },
            .{ .name = "Fresh" },
        },
        .meshes = &.{
            .{ .name = "NewMesh", .primitives = &.{.{ .vertex_count = 3, .index_count = 3, .indexed = true }} },
        },
        .materials = &.{
            .{ .name = "mat", .metallic = 0.5 },
        },
        .textures = &.{},
        .images = &.{
            .{ .name = "img", .mime = .png, .data = "BBBB", .width = 4, .height = 4 },
        },
    };

    const rep = try compare(arena, old_asset, new_asset);

    // nodes: Root changed translation; Gone removed; Fresh added
    try std.testing.expectEqual(@as(usize, 1), rep.nodes.changed.len);
    try std.testing.expectEqualStrings("Root", rep.nodes.changed[0].name.?);
    try std.testing.expectEqual(@as(usize, 1), rep.nodes.changed[0].fields.len);
    try std.testing.expectEqualStrings("translation", rep.nodes.changed[0].fields[0]);
    try std.testing.expectEqual(@as(usize, 1), rep.nodes.removed.len);
    try std.testing.expectEqualStrings("Gone", rep.nodes.removed[0].name.?);
    try std.testing.expectEqual(@as(usize, 1), rep.nodes.added.len);
    try std.testing.expectEqualStrings("Fresh", rep.nodes.added[0].name.?);

    // meshes: added
    try std.testing.expectEqual(@as(usize, 1), rep.meshes.added.len);
    try std.testing.expectEqualStrings("NewMesh", rep.meshes.added[0].name.?);

    // materials: metallic changed
    try std.testing.expectEqual(@as(usize, 1), rep.materials.changed.len);
    try std.testing.expectEqualStrings("metallic", rep.materials.changed[0].fields[0]);

    // textures: removed
    try std.testing.expectEqual(@as(usize, 1), rep.textures.removed.len);
    try std.testing.expectEqualStrings("tex", rep.textures.removed[0].name.?);

    // images: bytes changed
    try std.testing.expectEqual(@as(usize, 1), rep.images.changed.len);
    try std.testing.expectEqualStrings("image_bytes", rep.images.changed[0].fields[0]);
}

test "diff: identical assets produce empty report" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const asset = model.Asset{
        .nodes = &.{.{ .name = "a" }, .{ .name = "b" }},
        .meshes = &.{.{ .name = "m" }},
        .materials = &.{.{ .name = "mat" }},
    };
    const rep = try compare(arena.allocator(), asset, asset);
    try std.testing.expectEqual(@as(usize, 0), rep.totalChanges());
    try std.testing.expect(rep.nodes.isEmpty());
}

test "diff: unnamed items match by index" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const old_asset = model.Asset{ .nodes = &.{ .{ .translation = .{ 0, 0, 0 } }, .{ .translation = .{ 0, 1, 0 } } } };
    const new_asset = model.Asset{ .nodes = &.{ .{ .translation = .{ 0, 0, 0 } }, .{ .translation = .{ 0, 2, 0 } } } };

    const rep = try compare(arena.allocator(), old_asset, new_asset);
    try std.testing.expectEqual(@as(usize, 0), rep.nodes.added.len);
    try std.testing.expectEqual(@as(usize, 0), rep.nodes.removed.len);
    try std.testing.expectEqual(@as(usize, 1), rep.nodes.changed.len);
    try std.testing.expectEqual(@as(u32, 1), rep.nodes.changed[0].index);
}

test "diff: report deinit with gpa frees everything" {
    var gpa_state = std.heap.DebugAllocator(.{}){};
    const gpa = gpa_state.allocator();

    const old_asset = model.Asset{
        .nodes = &.{.{ .name = "a" }},
        .images = &.{.{ .name = "i", .data = "x" }},
    };
    const new_asset = model.Asset{
        .nodes = &.{.{ .name = "a", .translation = .{ 1, 1, 1 } }},
        .images = &.{.{ .name = "i", .data = "y" }},
        .textures = &.{.{ .name = "t" }},
    };
    var rep = try compare(gpa, old_asset, new_asset);
    rep.deinit(gpa);
    try std.testing.expect(gpa_state.deinit() == .ok);
}

test "diff: summary and json smoke" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const old_asset = model.Asset{ .nodes = &.{.{ .name = "a" }} };
    const new_asset = model.Asset{ .nodes = &.{.{ .name = "b" }} };
    const rep = try compare(arena.allocator(), old_asset, new_asset);

    var out_buf: [4096]u8 = undefined;
    var w = std.Io.Writer.fixed(&out_buf);
    try summary(rep, &w);
    try std.testing.expect(std.mem.indexOf(u8, w.buffered(), "+ [0] b") != null);

    var jw = std.Io.Writer.fixed(&out_buf);
    try reportJson(&jw, rep);
    try std.testing.expect(std.mem.indexOf(u8, jw.buffered(), "\"totals\"") != null);
}

test "empty asset helper" {
    try std.testing.expectEqual(@as(usize, 0), emptyAsset().nodes.len);
}
