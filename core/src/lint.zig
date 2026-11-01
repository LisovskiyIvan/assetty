//! Asset budgets: limits on triangle/vertex/draw-call/VRAM counts, texture
//! size and image formats. Produces a violation list suitable for CI.
//!
//! Budget files are flat JSON objects, e.g.:
//!
//!     {
//!       "max_triangles": 100000,
//!       "max_vertices": 50000,
//!       "max_draw_calls": 64,
//!       "max_vram_bytes": 16777216,
//!       "max_texture_size": 2048,
//!       "require_mips": true,
//!       "allowed_image_formats": ["ktx2"]
//!     }
//!
//! All fields are optional. `allowed_image_formats` accepts "png", "jpeg",
//! "ktx2", "other" (or the matching MIME types); an empty list allows all.

const std = @import("std");
const model = @import("gltf/model.zig");
const stats = @import("stats.zig");

pub const Budget = struct {
    max_triangles: ?u64 = null,
    max_vertices: ?u64 = null,
    max_draw_calls: ?u64 = null,
    max_vram_bytes: ?u64 = null,
    max_texture_size: ?u32 = null,
    require_mips: bool = false,
    /// Empty = all formats allowed.
    allowed_image_formats: []const []const u8 = &.{},

    /// Only valid for budgets produced by `parseBudget`.
    pub fn deinit(self: *Budget, a: std.mem.Allocator) void {
        for (self.allowed_image_formats) |f| a.free(f);
        if (self.allowed_image_formats.len > 0) a.free(self.allowed_image_formats);
        self.* = .{};
    }
};

pub const Violation = struct {
    /// Stable machine-readable rule id: "max_triangles", "max_vertices",
    /// "max_draw_calls", "max_vram_bytes", "format_not_allowed",
    /// "missing_mips", "texture_too_large".
    code: []const u8,
    message: []const u8,
    /// Image index for image-level rules, null for totals.
    index: ?u32 = null,
};

pub const ParseError = error{InvalidBudget} || std.mem.Allocator.Error;

/// Parse a flat budget JSON document. Caller owns the result (`Budget.deinit`).
pub fn parseBudget(a: std.mem.Allocator, bytes: []const u8) !Budget {
    var parsed = std.json.parseFromSlice(std.json.Value, a, bytes, .{}) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidBudget,
    };
    defer parsed.deinit();

    const obj = switch (parsed.value) {
        .object => |o| o,
        else => return error.InvalidBudget,
    };

    var b: Budget = .{};
    errdefer b.deinit(a);

    b.max_triangles = try getU64(obj, "max_triangles");
    b.max_vertices = try getU64(obj, "max_vertices");
    b.max_draw_calls = try getU64(obj, "max_draw_calls");
    b.max_vram_bytes = try getU64(obj, "max_vram_bytes");

    if (try getU64(obj, "max_texture_size")) |v| {
        if (v > std.math.maxInt(u32)) return error.InvalidBudget;
        b.max_texture_size = @intCast(v);
    }

    if (obj.get("require_mips")) |v| {
        b.require_mips = switch (v) {
            .bool => |x| x,
            else => return error.InvalidBudget,
        };
    }

    if (obj.get("allowed_image_formats")) |v| {
        switch (v) {
            .array => |arr| {
                var list: std.ArrayList([]const u8) = .empty;
                errdefer list.deinit(a);
                for (arr.items) |item| {
                    const s = switch (item) {
                        .string => |x| x,
                        else => return error.InvalidBudget,
                    };
                    const norm = normalizeFormat(s) orelse return error.InvalidBudget;
                    try list.append(a, try a.dupe(u8, norm));
                }
                b.allowed_image_formats = try list.toOwnedSlice(a);
            },
            .null => {},
            else => return error.InvalidBudget,
        }
    }

    return b;
}

fn normalizeFormat(s: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, s, "png") or std.mem.eql(u8, s, "image/png")) return "png";
    if (std.mem.eql(u8, s, "jpeg") or std.mem.eql(u8, s, "jpg") or std.mem.eql(u8, s, "image/jpeg")) return "jpeg";
    if (std.mem.eql(u8, s, "ktx2") or std.mem.eql(u8, s, "image/ktx2")) return "ktx2";
    if (std.mem.eql(u8, s, "other")) return "other";
    return null;
}

fn getU64(obj: std.json.ObjectMap, name: []const u8) ParseError!?u64 {
    const v = obj.get(name) orelse return null;
    return switch (v) {
        .null => null,
        .integer => |i| if (i < 0) error.InvalidBudget else @intCast(i),
        .float => |f| blk: {
            if (!std.math.isFinite(f) or f < 0 or f > @as(f64, @floatFromInt(std.math.maxInt(u64)))) {
                break :blk error.InvalidBudget;
            }
            break :blk @intFromFloat(f);
        },
        else => error.InvalidBudget,
    };
}

fn formatAllowed(allowed: []const []const u8, mime: model.Mime) bool {
    if (allowed.len == 0) return true;
    const label = mime.label();
    for (allowed) |f| {
        if (std.mem.eql(u8, f, label)) return true;
    }
    return false;
}

/// Check computed stats against a budget. Violations are stable-sorted by code.
pub fn check(a: std.mem.Allocator, st: stats.Stats, b: Budget) ![]Violation {
    var list: std.ArrayList(Violation) = .empty;
    errdefer {
        for (list.items) |v| a.free(v.message);
        list.deinit(a);
    }

    if (b.max_triangles) |max| {
        if (st.triangles > max) {
            try list.append(a, .{ .code = "max_triangles", .message = try std.fmt.allocPrint(a, "triangles {d} > {d}", .{ st.triangles, max }) });
        }
    }
    if (b.max_vertices) |max| {
        if (st.vertices > max) {
            try list.append(a, .{ .code = "max_vertices", .message = try std.fmt.allocPrint(a, "vertices {d} > {d}", .{ st.vertices, max }) });
        }
    }
    if (b.max_draw_calls) |max| {
        if (st.draw_calls > max) {
            try list.append(a, .{ .code = "max_draw_calls", .message = try std.fmt.allocPrint(a, "draw calls {d} > {d}", .{ st.draw_calls, max }) });
        }
    }
    if (b.max_vram_bytes) |max| {
        if (st.vram_total > max) {
            try list.append(a, .{ .code = "max_vram_bytes", .message = try std.fmt.allocPrint(a, "vram {d} B > {d} B", .{ st.vram_total, max }) });
        }
    }

    for (st.image_stats) |im| {
        if (!formatAllowed(b.allowed_image_formats, im.mime)) {
            try list.append(a, .{
                .code = "format_not_allowed",
                .message = try std.fmt.allocPrint(a, "image[{d}] format {s} not allowed", .{ im.index, im.mime.label() }),
                .index = im.index,
            });
        }
        if (b.require_mips and !im.has_mips) {
            try list.append(a, .{
                .code = "missing_mips",
                .message = try std.fmt.allocPrint(a, "image[{d}] {s} has no mip chain", .{ im.index, im.mime.label() }),
                .index = im.index,
            });
        }
        if (b.max_texture_size) |max| {
            if (im.width > max or im.height > max) {
                try list.append(a, .{
                    .code = "texture_too_large",
                    .message = try std.fmt.allocPrint(a, "image[{d}] {d}x{d} > {d}", .{ im.index, im.width, im.height, max }),
                    .index = im.index,
                });
            }
        }
    }

    std.sort.block(Violation, list.items, {}, lessThanCode);
    return try list.toOwnedSlice(a);
}

fn lessThanCode(_: void, lhs: Violation, rhs: Violation) bool {
    return std.mem.lessThan(u8, lhs.code, rhs.code);
}

/// Free a violation slice returned by `check` (no-op under an arena).
pub fn freeViolations(a: std.mem.Allocator, vs: []Violation) void {
    for (vs) |v| a.free(v.message);
    if (vs.len > 0) a.free(vs);
}

// --- tests -----------------------------------------------------------------

const testing = std.testing;

fn testImage(index: u32, mime: model.Mime, w: u32, h: u32, mips: bool) stats.ImageStat {
    return .{
        .index = index,
        .name = null,
        .mime = mime,
        .width = w,
        .height = h,
        .has_mips = mips,
        .vram = @as(u64, w) * h * 4,
        .disk_bytes = 100,
    };
}

test "parseBudget: full document" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const json =
        \\{"max_triangles":100000,"max_vertices":50000,"max_draw_calls":64,
        \\ "max_vram_bytes":16777216,"max_texture_size":2048,
        \\ "require_mips":true,"allowed_image_formats":["ktx2","image/png"]}
    ;
    var b = try parseBudget(a, json);
    try testing.expectEqual(@as(?u64, 100000), b.max_triangles);
    try testing.expectEqual(@as(?u64, 50000), b.max_vertices);
    try testing.expectEqual(@as(?u64, 64), b.max_draw_calls);
    try testing.expectEqual(@as(?u64, 16777216), b.max_vram_bytes);
    try testing.expectEqual(@as(?u32, 2048), b.max_texture_size);
    try testing.expect(b.require_mips);
    try testing.expectEqual(@as(usize, 2), b.allowed_image_formats.len);
    try testing.expectEqualStrings("ktx2", b.allowed_image_formats[0]);
    try testing.expectEqualStrings("png", b.allowed_image_formats[1]);
    b.deinit(a);
}

test "parseBudget: empty object and bad values" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const b = try parseBudget(a, "{}");
    try testing.expectEqual(@as(?u64, null), b.max_triangles);
    try testing.expect(!b.require_mips);
    try testing.expectEqual(@as(usize, 0), b.allowed_image_formats.len);

    try testing.expectError(error.InvalidBudget, parseBudget(a, "[]"));
    try testing.expectError(error.InvalidBudget, parseBudget(a, "{\"max_triangles\":\"lots\"}"));
    try testing.expectError(error.InvalidBudget, parseBudget(a, "{\"allowed_image_formats\":[\"bmp\"]}"));
    try testing.expectError(error.InvalidBudget, parseBudget(a, "{ nope"));
}

test "check: totals over budget" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const st = stats.Stats{ .triangles = 200, .vertices = 300, .draw_calls = 10, .vram_total = 4096 };
    const b = Budget{
        .max_triangles = 100,
        .max_vertices = 250,
        .max_draw_calls = 20,
        .max_vram_bytes = 2048,
    };
    const vs = try check(a, st, b);
    try testing.expectEqual(@as(usize, 3), vs.len);
    // stable-sorted by code
    try testing.expectEqualStrings("max_triangles", vs[0].code);
    try testing.expectEqualStrings("max_vertices", vs[1].code);
    try testing.expectEqualStrings("max_vram_bytes", vs[2].code);
}

test "check: image rules" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const imgs = [_]stats.ImageStat{
        testImage(0, .png, 512, 512, false),
        testImage(1, .ktx2, 4096, 1024, true),
        testImage(2, .jpeg, 64, 64, false),
    };
    const st = stats.Stats{ .image_stats = &imgs, .vram_total = 100 };

    const b = Budget{
        .require_mips = true,
        .max_texture_size = 2048,
        .allowed_image_formats = &.{"ktx2"},
    };
    const vs = try check(a, st, b);

    var counts = std.StringHashMap(usize).init(a);
    for (vs) |v| {
        const gop = try counts.getOrPut(v.code);
        if (!gop.found_existing) gop.value_ptr.* = 0;
        gop.value_ptr.* += 1;
    }
    try testing.expectEqual(@as(usize, 2), counts.get("format_not_allowed").?);
    try testing.expectEqual(@as(usize, 2), counts.get("missing_mips").?);
    try testing.expectEqual(@as(usize, 1), counts.get("texture_too_large").?);

    // sorted by code
    for (vs[1..], vs[0 .. vs.len - 1]) |cur, prev| {
        try testing.expect(std.mem.order(u8, prev.code, cur.code) != .gt);
    }
}

test "check: empty budget allows everything" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const imgs = [_]stats.ImageStat{testImage(0, .png, 8192, 8192, false)};
    const st = stats.Stats{ .triangles = 1_000_000, .image_stats = &imgs };
    const vs = try check(a, st, .{});
    try testing.expectEqual(@as(usize, 0), vs.len);
}

test "check: gpa ownership" {
    var gpa_state = std.heap.DebugAllocator(.{}){};
    const gpa = gpa_state.allocator();

    var b = try parseBudget(gpa, "{\"max_triangles\":1,\"allowed_image_formats\":[\"ktx2\"]}");
    const imgs = [_]stats.ImageStat{testImage(0, .png, 4, 4, false)};
    const vs = try check(gpa, .{ .triangles = 2, .image_stats = &imgs }, b);
    freeViolations(gpa, vs);
    b.deinit(gpa);
    try testing.expect(gpa_state.deinit() == .ok);
}
