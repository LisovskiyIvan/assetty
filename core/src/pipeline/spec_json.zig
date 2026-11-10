//! JSON step-spec presets: the machine-readable twin of `preset.zig`'s zon
//! presets. The desktop app's per-step UI speaks this shape
//! (`{"steps":[{"prune":{}}, ...]}`), and so does the CLI's `--preset file.json`.
//!
//! A spec is a JSON object with a required `"steps"` array and two optional
//! fields: `"name"` (preset label, defaults to `"custom"`) and `"target"`
//! (one of `"mobile"`, `"desktop"`, `"web"`; defaults to `"desktop"`).
//!
//! ```json
//! {"name": "mine", "target": "mobile", "steps": [
//!   {"prune": {"animations": false}},
//!   {"quantize": {"position_bits": 14}}
//! ]}
//! ```
//!
//! Steps may be listed in any order; the result is always reordered into the
//! canonical execution order (`prune` first, `simplify` last). Omitted params
//! take the defaults declared on the param structs in `preset.zig`.
//!
//! Like the zon parser, everything reachable from the result is allocated from
//! the caller's allocator `a` (an arena is the natural fit); there is no
//! `deinit`. `spec` may also be a JSON *string* holding the spec text (the
//! shape the app's IPC bridge sometimes delivers).
const std = @import("std");
const preset = @import("preset.zig");

const Allocator = std.mem.Allocator;

/// Errors surfaced by `parseSpec`/`parseSpecFile`. `detail` (the out-param of
/// both) names the offending step for `UnknownStep`/`BadParam` (and the field
/// for a mistyped top-level `"name"`/`"target"`).
pub const SpecError = error{ OutOfMemory, InvalidSpec, NoSteps, UnknownStep, BadParam };

/// `parseSpecFile` additionally fails with `ReadFailed` when the file is
/// missing, too large (`preset.max_file_bytes`) or unreadable.
pub const FileError = SpecError || error{ReadFailed};

/// Build a preset from a JSON spec. `detail` receives the offending step name
/// for `UnknownStep`/`BadParam` (empty otherwise).
pub fn parseSpec(a: Allocator, spec: []const u8, detail: *[]const u8) SpecError!preset.Preset {
    const text = std.mem.trim(u8, spec, " \t\r\n");
    if (text.len == 0) return error.NoSteps;

    if (text[0] == '"') {
        // A JSON string value: unwrap it and parse the text it contains.
        var outer = std.json.parseFromSlice(std.json.Value, a, text, .{}) catch
            return error.InvalidSpec;
        defer outer.deinit();
        const inner = switch (outer.value) {
            .string => |s| std.mem.trim(u8, s, " \t\r\n"),
            else => return error.InvalidSpec,
        };
        if (inner.len == 0) return error.NoSteps;
        var parsed = std.json.parseFromSlice(std.json.Value, a, inner, .{}) catch
            return error.InvalidSpec;
        defer parsed.deinit();
        return presetFromSpecValue(a, parsed.value, detail);
    }

    var parsed = std.json.parseFromSlice(std.json.Value, a, text, .{}) catch
        return error.InvalidSpec;
    defer parsed.deinit();
    return presetFromSpecValue(a, parsed.value, detail);
}

/// Read `path` and parse it as a JSON spec. `detail` behaves as in `parseSpec`.
pub fn parseSpecFile(io: std.Io, a: Allocator, path: []const u8, detail: *[]const u8) FileError!preset.Preset {
    const bytes = std.Io.Dir.cwd().readFileAllocOptions(
        io,
        path,
        a,
        .limited(preset.max_file_bytes),
        .of(u8),
        0,
    ) catch return error.ReadFailed;
    defer a.free(bytes);
    return parseSpec(a, bytes, detail);
}

/// Canonical execution order: a spec may list its steps in any order.
/// `animops` runs before `quantize` (cleaned tracks improve the dequant
/// bake census); `compress` runs last, over the final geometry.
pub const step_order = [_]preset.StepKind{
    .prune, .dedup, .weld, .join, .textures, .animops, .quantize, .simplify, .compress,
};

pub fn isStepName(name: []const u8) bool {
    for (step_order) |kind| {
        if (std.mem.eql(u8, name, @tagName(kind))) return true;
    }
    return false;
}

fn presetFromSpecValue(
    a: Allocator,
    v: std.json.Value,
    detail: *[]const u8,
) SpecError!preset.Preset {
    const obj = switch (v) {
        .object => |o| o,
        else => return error.InvalidSpec,
    };
    const raw_steps = obj.get("steps") orelse return error.NoSteps;
    const items = switch (raw_steps) {
        .array => |arr| arr.items,
        else => return error.InvalidSpec,
    };
    if (items.len == 0) return error.NoSteps;

    // Optional "name": any string, default "custom".
    var name: []const u8 = "custom";
    if (obj.get("name")) |nv| {
        switch (nv) {
            .string => |s| name = try a.dupe(u8, s),
            else => {
                detail.* = "name";
                return error.BadParam;
            },
        }
    }

    // Optional "target": one of the Target tags, default .desktop.
    var target: preset.Target = .desktop;
    if (obj.get("target")) |tv| {
        switch (tv) {
            .string => |s| {
                target = std.meta.stringToEnum(preset.Target, s) orelse {
                    detail.* = "target";
                    return error.BadParam;
                };
            },
            else => {
                detail.* = "target";
                return error.BadParam;
            },
        }
    }

    // Validate every entry up front so an unknown kind is reported with its
    // name instead of failing halfway through an ordered build.
    for (items) |item| {
        const fields = switch (item) {
            .object => |o| o,
            else => return error.InvalidSpec,
        };
        var seen = false;
        var it = fields.iterator();
        while (it.next()) |entry| {
            if (!isStepName(entry.key_ptr.*)) {
                detail.* = try a.dupe(u8, entry.key_ptr.*);
                return error.UnknownStep;
            }
            seen = true;
        }
        if (!seen) {
            detail.* = "step";
            return error.UnknownStep;
        }
    }

    const steps = try a.alloc(preset.Step, items.len);
    var n: usize = 0;
    for (step_order) |kind| {
        for (items) |item| {
            const params = item.object.get(@tagName(kind)) orelse continue;
            steps[n] = try stepFromSpec(a, kind, params, detail);
            n += 1;
        }
    }
    return .{ .name = name, .target = target, .steps = steps[0..n] };
}

/// Typed readers over one step's params object. Omitted fields yield `null`,
/// which the caller turns into the param struct's own default.
const SpecParams = struct {
    kind: preset.StepKind,
    fields: ?std.json.ObjectMap,
    detail: *[]const u8,

    fn bad(self: *SpecParams) SpecError {
        self.detail.* = @tagName(self.kind);
        return error.BadParam;
    }

    fn get(self: *SpecParams, name: []const u8) ?std.json.Value {
        const fields = self.fields orelse return null;
        return fields.get(name);
    }

    fn boolField(self: *SpecParams, name: []const u8) SpecError!?bool {
        return switch (self.get(name) orelse return null) {
            .bool => |b| b,
            else => self.bad(),
        };
    }

    fn intField(self: *SpecParams, comptime T: type, name: []const u8) SpecError!?T {
        return switch (self.get(name) orelse return null) {
            .integer => |i| std.math.cast(T, i) orelse self.bad(),
            else => self.bad(),
        };
    }

    fn floatField(self: *SpecParams, name: []const u8) SpecError!?f32 {
        return switch (self.get(name) orelse return null) {
            .float => |f| std.math.lossyCast(f32, f),
            .integer => |i| @floatFromInt(i),
            else => self.bad(),
        };
    }

    /// `"auto"`/`"etc1s"`/`"uastc"` (and the other preset formats); anything
    /// unrecognised falls back to `.auto`.
    fn formatField(self: *SpecParams, name: []const u8) SpecError!?preset.TextureFormat {
        const s = switch (self.get(name) orelse return null) {
            .string => |s| s,
            else => return self.bad(),
        };
        return std.meta.stringToEnum(preset.TextureFormat, s) orelse .auto;
    }

    /// `"none"`/`"zstd"`; anything unrecognised falls back to `.none` (the
    /// byte-compat default).
    fn supercompressionField(self: *SpecParams, name: []const u8) SpecError!?preset.Supercompression {
        const s = switch (self.get(name) orelse return null) {
            .string => |s| s,
            else => return self.bad(),
        };
        return std.meta.stringToEnum(preset.Supercompression, s) orelse .none;
    }
};

/// Known keys of a `rules` entry. Anything else is a typo: reject it instead
/// of silently ignoring the entry's intent.
fn isRuleKey(k: []const u8) bool {
    for ([_][]const u8{
        "slot",             "name",   "priority", "format",   "quality",  "rdo_lambda",
        "supercompression", "srgb",   "max_size", "min_side", "max_side", "generate_mips",
        "normal_map",       "cutout", "skip",
    }) |known| {
        if (std.mem.eql(u8, k, known)) return true;
    }
    return false;
}

/// Known keys of an `overrides` entry. Anything else is a typo: reject it
/// instead of silently ignoring the entry's intent.
fn isOverrideKey(k: []const u8) bool {
    for ([_][]const u8{
        "image",    "name",          "skip",       "format",           "quality", "rdo_lambda",
        "max_size", "generate_mips", "normal_map", "supercompression",
    }) |known| {
        if (std.mem.eql(u8, k, known)) return true;
    }
    return false;
}

/// Parse the textures step's `rules` array (first match wins). Lenient like
/// `overrides`: missing/non-array means no rules, non-object items are
/// skipped, mistyped fields keep their default (unset). Unknown keys are an
/// error (named in `detail`). An unknown `format`/`slot` string leaves the
/// field unset.
fn parseTextureRules(a: Allocator, v: ?std.json.Value, detail: *[]const u8) SpecError![]preset.TexRule {
    const items = switch (v orelse return &.{}) {
        .array => |arr| arr.items,
        else => return &.{},
    };
    var out: std.ArrayList(preset.TexRule) = .empty;
    for (items) |item| {
        const fields = switch (item) {
            .object => |o| o,
            else => continue,
        };
        var kit = fields.iterator();
        while (kit.next()) |entry| {
            if (!isRuleKey(entry.key_ptr.*)) {
                detail.* = try a.dupe(u8, entry.key_ptr.*);
                return error.BadParam;
            }
        }
        var r: preset.TexRule = .{};
        if (fields.get("slot")) |sv| {
            if (sv == .string) {
                if (std.meta.stringToEnum(preset.TexSlot, sv.string)) |s| r.slot = s;
            }
        }
        if (fields.get("name")) |nv| {
            if (nv == .string) r.name = try a.dupe(u8, nv.string);
        }
        if (fields.get("priority")) |pv| {
            if (pv == .integer) r.priority = std.math.cast(i16, pv.integer) orelse 0;
        }
        if (fields.get("format")) |fv| {
            if (fv == .string) {
                if (std.meta.stringToEnum(preset.TextureFormat, fv.string)) |f| r.format = f;
            }
        }
        if (fields.get("quality")) |qv| {
            if (qv == .integer) r.quality = std.math.cast(u8, qv.integer);
        }
        if (fields.get("rdo_lambda")) |lv| {
            switch (lv) {
                .float => |f| r.rdo_lambda = std.math.lossyCast(f32, f),
                .integer => |i| r.rdo_lambda = @floatFromInt(i),
                else => {},
            }
        }
        if (fields.get("supercompression")) |scv| {
            if (scv == .string) {
                if (std.meta.stringToEnum(preset.Supercompression, scv.string)) |s| r.supercompression = s;
            }
        }
        if (fields.get("srgb")) |sv| {
            if (sv == .bool) r.srgb = sv.bool;
        }
        if (fields.get("max_size")) |mv| {
            if (mv == .integer) r.max_size = std.math.cast(u32, mv.integer);
        }
        if (fields.get("min_side")) |mv| {
            if (mv == .integer) r.min_side = std.math.cast(u32, mv.integer);
        }
        if (fields.get("max_side")) |mv| {
            if (mv == .integer) r.max_side = std.math.cast(u32, mv.integer);
        }
        if (fields.get("generate_mips")) |gv| {
            if (gv == .bool) r.generate_mips = gv.bool;
        }
        if (fields.get("normal_map")) |nmv| {
            if (nmv == .bool) r.normal_map = nmv.bool;
        }
        if (fields.get("cutout")) |cv| {
            if (cv == .bool) r.cutout = cv.bool;
        }
        if (fields.get("skip")) |sv| {
            if (sv == .bool) r.skip = sv.bool;
        }
        try out.append(a, r);
    }
    if (out.items.len == 0) return &.{};
    return try out.toOwnedSlice(a);
}
/// Lenient on purpose: a missing/non-array value means no overrides, a
/// non-object item is skipped, and a mistyped field keeps its default.
/// Unknown keys are an error (named in `detail`). An unknown
/// format string leaves the override's format unset (it must not silently
/// become `.auto`, which is a real value here).
fn parseTextureOverrides(a: Allocator, v: ?std.json.Value, detail: *[]const u8) SpecError![]preset.TextureOverride {
    const items = switch (v orelse return &.{}) {
        .array => |arr| arr.items,
        else => return &.{},
    };
    var out: std.ArrayList(preset.TextureOverride) = .empty;
    for (items) |item| {
        const fields = switch (item) {
            .object => |o| o,
            else => continue,
        };
        var kit = fields.iterator();
        while (kit.next()) |entry| {
            if (!isOverrideKey(entry.key_ptr.*)) {
                detail.* = try a.dupe(u8, entry.key_ptr.*);
                return error.BadParam;
            }
        }
        var o: preset.TextureOverride = .{};
        if (fields.get("image")) |iv| {
            if (iv == .integer) o.image = std.math.cast(u32, iv.integer);
        }
        if (fields.get("name")) |nv| {
            if (nv == .string) o.name = try a.dupe(u8, nv.string);
        }
        if (fields.get("skip")) |sv| {
            if (sv == .bool) o.skip = sv.bool;
        }
        if (fields.get("format")) |fv| {
            if (fv == .string) {
                if (std.meta.stringToEnum(preset.TextureFormat, fv.string)) |f| o.format = f;
            }
        }
        if (fields.get("quality")) |qv| {
            if (qv == .integer) o.quality = std.math.cast(u8, qv.integer);
        }
        if (fields.get("rdo_lambda")) |lv| {
            o.rdo_lambda = switch (lv) {
                .float => |f| std.math.lossyCast(f32, f),
                .integer => |i| @floatFromInt(i),
                else => null,
            };
        }
        if (fields.get("max_size")) |mv| {
            if (mv == .integer) o.max_size = std.math.cast(u32, mv.integer);
        }
        if (fields.get("generate_mips")) |gv| {
            if (gv == .bool) o.generate_mips = gv.bool;
        }
        if (fields.get("normal_map")) |nmv| {
            if (nmv == .bool) o.normal_map = nmv.bool;
        }
        if (fields.get("supercompression")) |scv| {
            if (scv == .string) {
                if (std.meta.stringToEnum(preset.Supercompression, scv.string)) |s| o.supercompression = s;
            }
        }
        try out.append(a, o);
    }
    if (out.items.len == 0) return &.{};
    return try out.toOwnedSlice(a);
}

fn stepFromSpec(
    a: Allocator,
    kind: preset.StepKind,
    v: std.json.Value,
    detail: *[]const u8,
) SpecError!preset.Step {
    var r: SpecParams = .{ .kind = kind, .fields = null, .detail = detail };
    switch (v) {
        .object => |o| r.fields = o,
        .null => {}, // `{"prune": null}` == `{"prune": {}}`
        else => {
            detail.* = @tagName(kind);
            return error.BadParam;
        },
    }

    return switch (kind) {
        .prune => blk: {
            const d = preset.PruneParams{};
            break :blk .{ .prune = .{
                .unused_nodes = (try r.boolField("unused_nodes")) orelse d.unused_nodes,
                .unused_materials = (try r.boolField("unused_materials")) orelse d.unused_materials,
                .unused_textures = (try r.boolField("unused_textures")) orelse d.unused_textures,
                .animations = (try r.boolField("animations")) orelse d.animations,
            } };
        },
        .dedup => blk: {
            const d = preset.DedupParams{};
            break :blk .{ .dedup = .{
                .accessors = (try r.boolField("accessors")) orelse d.accessors,
                .meshes = (try r.boolField("meshes")) orelse d.meshes,
                .materials = (try r.boolField("materials")) orelse d.materials,
            } };
        },
        .weld => blk: {
            const d = preset.WeldParams{};
            break :blk .{ .weld = .{
                .tolerance = (try r.floatField("tolerance")) orelse d.tolerance,
            } };
        },
        .join => .{ .join = .{} },
        .textures => blk: {
            const d = preset.TextureParams{};
            break :blk .{ .textures = .{
                .format = (try r.formatField("format")) orelse d.format,
                .quality = (try r.intField(u8, "quality")) orelse d.quality,
                .rdo_lambda = (try r.floatField("rdo_lambda")) orelse d.rdo_lambda,
                .normal_maps_renormalize = (try r.boolField("normal_maps_renormalize")) orelse d.normal_maps_renormalize,
                .generate_mips = (try r.boolField("generate_mips")) orelse d.generate_mips,
                .max_size = (try r.intField(u32, "max_size")) orelse d.max_size,
                .supercompression = (try r.supercompressionField("supercompression")) orelse d.supercompression,
                .apply_rules = (try r.boolField("apply_rules")) orelse d.apply_rules,
                .reencode_ktx2 = (try r.boolField("reencode_ktx2")) orelse d.reencode_ktx2,
                .rules = try parseTextureRules(a, r.get("rules"), detail),
                .overrides = try parseTextureOverrides(a, r.get("overrides"), detail),
            } };
        },
        .quantize => blk: {
            const d = preset.QuantizeParams{};
            break :blk .{ .quantize = .{
                .position_bits = (try r.intField(u5, "position_bits")) orelse d.position_bits,
                .normal_oct = (try r.boolField("normal_oct")) orelse d.normal_oct,
                .uv_bits = (try r.intField(u5, "uv_bits")) orelse d.uv_bits,
                .compress = (try r.boolField("compress")) orelse d.compress,
                .meshopt_compression = (try r.boolField("meshopt_compression")) orelse d.meshopt_compression,
            } };
        },
        .simplify => blk: {
            const d = preset.SimplifyParams{};
            break :blk .{ .simplify = .{
                .target_ratio = (try r.floatField("target_ratio")) orelse d.target_ratio,
                .error_tolerance = (try r.floatField("error_tolerance")) orelse d.error_tolerance,
                .aggressive = (try r.boolField("aggressive")) orelse d.aggressive,
                .lock_borders = (try r.boolField("lock_borders")) orelse d.lock_borders,
                .use_attributes = (try r.boolField("use_attributes")) orelse d.use_attributes,
                .weight_normal = (try r.floatField("weight_normal")) orelse d.weight_normal,
                .weight_uv = (try r.floatField("weight_uv")) orelse d.weight_uv,
            } };
        },
        .compress => .{ .compress = .{} },
        .animops => blk: {
            const d = preset.AnimopsParams{};
            break :blk .{ .animops = .{
                .remove_constant_tracks = (try r.boolField("remove_constant_tracks")) orelse d.remove_constant_tracks,
                .epsilon = (try r.floatField("epsilon")) orelse d.epsilon,
            } };
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const testing = std.testing;

fn specKinds(p: preset.Preset, buf: *[16]preset.StepKind) []const preset.StepKind {
    for (p.steps, 0..) |s, i| buf[i] = std.meta.activeTag(s);
    return buf[0..p.steps.len];
}

test "spec maps steps in canonical order with params" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();

    const spec =
        \\{"steps":[
        \\  {"simplify":{"target_ratio":0.25,"aggressive":true}},
        \\  {"textures":{"format":"uastc","quality":160,"max_size":2048}},
        \\  {"weld":{"tolerance":0.25}},
        \\  {"prune":{}}
        \\]}
    ;

    var detail: []const u8 = "";
    const p = try parseSpec(arena.allocator(), spec, &detail);

    try testing.expectEqualStrings("custom", p.name);
    try testing.expectEqual(preset.Target.desktop, p.target);
    try testing.expectEqual(@as(usize, 4), p.steps.len);

    var kinds_buf: [16]preset.StepKind = undefined;
    try testing.expectEqualSlices(preset.StepKind, &.{
        .prune, .weld, .textures, .simplify,
    }, specKinds(p, &kinds_buf));

    try testing.expectEqual(@as(f32, 0.25), p.steps[1].weld.tolerance);
    try testing.expectEqual(preset.TextureFormat.uastc, p.steps[2].textures.format);
    try testing.expectEqual(@as(u8, 160), p.steps[2].textures.quality);
    try testing.expectEqual(@as(u32, 2048), p.steps[2].textures.max_size);
    try testing.expectEqual(@as(f32, 0.25), p.steps[3].simplify.target_ratio);
    try testing.expect(p.steps[3].simplify.aggressive);

    const defaults = preset.PruneParams{};
    try testing.expectEqual(defaults.unused_nodes, p.steps[0].prune.unused_nodes);
    try testing.expect(p.steps[0].prune.animations);
}

test "spec honours name and target fields" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    const p = try parseSpec(a, "{\"name\":\"mine\",\"target\":\"mobile\",\"steps\":[{\"join\":{}}]}", &detail);
    try testing.expectEqualStrings("mine", p.name);
    try testing.expectEqual(preset.Target.mobile, p.target);

    // Bad target names the field.
    try testing.expectError(
        error.BadParam,
        parseSpec(a, "{\"target\":\"ps5\",\"steps\":[{\"join\":{}}]}", &detail),
    );
    try testing.expectEqualStrings("target", detail);

    // A mistyped name names the field too.
    try testing.expectError(
        error.BadParam,
        parseSpec(a, "{\"name\":42,\"steps\":[{\"join\":{}}]}", &detail),
    );
    try testing.expectEqualStrings("name", detail);
}

test "spec accepts a json string value" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const inner = "{\"steps\":[{\"dedup\":{\"meshes\":false}},{\"join\":{}}]}";
    var buf: [256]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try std.json.Stringify.value(inner, .{}, &w);

    var detail: []const u8 = "";
    const p = try parseSpec(a, w.buffered(), &detail);
    try testing.expectEqual(@as(usize, 2), p.steps.len);
    try testing.expect(!p.steps[0].dedup.meshes);
    try testing.expect(p.steps[0].dedup.accessors);
}

test "spec maps textures overrides" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const spec =
        \\{"steps":[{
        \\  "textures":{
        \\    "format":"auto","quality":128,"max_size":0,"generate_mips":true,
        \\    "overrides":[
        \\      {"image":2,"format":"uastc","quality":200,"max_size":512,"generate_mips":true,"skip":false,"normal_map":true},
        \\      {"name":"basecolor","max_size":1024},
        \\      {"image":5,"skip":true}
        \\    ]
        \\  }
        \\}]}
    ;
    var detail: []const u8 = "";
    const p = try parseSpec(a, spec, &detail);
    try testing.expectEqual(@as(usize, 1), p.steps.len);
    const tex = p.steps[0].textures;
    try testing.expectEqual(@as(usize, 3), tex.overrides.len);
    try testing.expectEqual(@as(?u32, 2), tex.overrides[0].image);
    try testing.expectEqual(preset.TextureFormat.uastc, tex.overrides[0].format.?);
    try testing.expectEqual(@as(?u8, 200), tex.overrides[0].quality);
    try testing.expectEqual(@as(?f32, null), tex.overrides[0].rdo_lambda);
    try testing.expectEqualStrings("basecolor", tex.overrides[1].name);
    try testing.expect(tex.overrides[2].skip);

    // rdo_lambda parses from float and integer JSON numbers; others stay null.
    var d2: []const u8 = "";
    const q = try parseSpec(a, "{\"steps\":[{\"textures\":{\"overrides\":[{\"image\":0,\"rdo_lambda\":0.5},{\"image\":1,\"rdo_lambda\":2}]}}]}", &d2);
    try testing.expectEqual(@as(?f32, 0.5), q.steps[0].textures.overrides[0].rdo_lambda);
    try testing.expectEqual(@as(?f32, 2.0), q.steps[0].textures.overrides[1].rdo_lambda);
}

test "spec maps quantize meshopt_compression" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    const d = try parseSpec(a, "{\"steps\":[{\"quantize\":{}}]}", &detail);
    try testing.expect(!d.steps[0].quantize.meshopt_compression);
    const e = try parseSpec(a, "{\"steps\":[{\"quantize\":{\"meshopt_compression\":true}}]}", &detail);
    try testing.expect(e.steps[0].quantize.meshopt_compression);
}

test "spec maps textures supercompression" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // Step-level opt-in plus a per-image opt-out.
    var detail: []const u8 = "";
    const p = try parseSpec(
        a,
        "{\"steps\":[{\"textures\":{\"format\":\"uastc\",\"supercompression\":\"zstd\",\"overrides\":[{\"image\":1,\"supercompression\":\"none\"}]}}]}",
        &detail,
    );
    const tex = p.steps[0].textures;
    try testing.expectEqual(preset.Supercompression.zstd, tex.supercompression);
    try testing.expectEqual(@as(usize, 1), tex.overrides.len);
    try testing.expectEqual(@as(?preset.Supercompression, .none), tex.overrides[0].supercompression);

    // Omitted → none; unknown string → none (byte-compat default, not error).
    for ([_][]const u8{
        "{\"steps\":[{\"textures\":{}}]}",
        "{\"steps\":[{\"textures\":{\"supercompression\":\"bogus\"}}]}",
    }) |s| {
        var d: []const u8 = "";
        const q = try parseSpec(a, s, &d);
        try testing.expectEqual(preset.Supercompression.none, q.steps[0].textures.supercompression);
    }
}

test "spec maps textures rules" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const spec =
        \\{"steps":[{
        \\  "textures":{
        \\    "format":"auto","apply_rules":true,"reencode_ktx2":true,
        \\    "rules":[
        \\      {"name":"height","skip":true},
        \\      {"slot":"normal","format":"uastc","rdo_lambda":0.5,"supercompression":"zstd","srgb":false,"normal_map":true},
        \\      {"slot":"base_color","cutout":true,"format":"uastc","srgb":true,"min_side":256,"max_side":4096},
        \\      {"name":"_BC","format":"etc1s","quality":200,"max_size":1024,"generate_mips":false}
        \\    ]
        \\  }
        \\}]}
    ;
    var detail: []const u8 = "";
    const p = try parseSpec(a, spec, &detail);
    const tex = p.steps[0].textures;
    try testing.expect(tex.apply_rules);
    try testing.expect(tex.reencode_ktx2);
    try testing.expectEqual(@as(usize, 4), tex.rules.len);
    try testing.expect(tex.rules[0].skip);
    try testing.expectEqual(@as(?preset.TexSlot, .normal), tex.rules[1].slot);
    try testing.expectEqual(@as(?f32, 0.5), tex.rules[1].rdo_lambda);
    try testing.expectEqual(@as(?bool, true), tex.rules[2].cutout);
    try testing.expectEqual(@as(?u32, 256), tex.rules[2].min_side);
    try testing.expectEqualStrings("_BC", tex.rules[3].name);

    // unknown slot string: field stays unset, rule kept
    const q = try parseSpec(a, "{\"steps\":[{\"textures\":{\"rules\":[{\"slot\":\"bogus\"}]}}]}", &detail);
    try testing.expectEqual(@as(usize, 1), q.steps[0].textures.rules.len);
    try testing.expectEqual(@as(?preset.TexSlot, null), q.steps[0].textures.rules[0].slot);
}

test "spec maps compress and animops with canonical order" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    // any input order -> canonical: animops before quantize, compress last
    const p = try parseSpec(a, "{\"steps\":[{\"compress\":{}},{\"quantize\":{}},{\"animops\":{\"remove_constant_tracks\":true,\"epsilon\":0.00001}}]}", &detail);
    try testing.expectEqual(@as(usize, 3), p.steps.len);
    var kinds_buf: [16]preset.StepKind = undefined;
    try testing.expectEqualSlices(preset.StepKind, &.{ .animops, .quantize, .compress }, specKinds(p, &kinds_buf));
    try testing.expect(p.steps[0].animops.remove_constant_tracks);
    try testing.expectApproxEqAbs(@as(f32, 1e-5), p.steps[0].animops.epsilon, 1e-9);

    // defaults: animops removes with 1e-5, compress takes null like {}
    const q = try parseSpec(a, "{\"steps\":[{\"animops\":null},{\"compress\":{}}]}", &detail);
    try testing.expect(q.steps[0].animops.remove_constant_tracks);
    try testing.expectApproxEqAbs(@as(f32, 1e-5), q.steps[0].animops.epsilon, 1e-9);

    // mistyped epsilon names the step
    try testing.expectError(
        error.BadParam,
        parseSpec(a, "{\"steps\":[{\"animops\":{\"epsilon\":\"tight\"}}]}", &detail),
    );
    try testing.expectEqualStrings("animops", detail);
}

test "spec rejects unknown step kinds by name" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    try testing.expectError(
        error.UnknownStep,
        parseSpec(a, "{\"steps\":[{\"bperfume\":{}}]}", &detail),
    );
    try testing.expect(std.mem.indexOf(u8, detail, "bperfume") != null);
}

test "spec rejects unknown override and rule keys by name" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    try testing.expectError(
        error.BadParam,
        parseSpec(a, "{\"steps\":[{\"textures\":{\"overrides\":[{\"image\":0,\"qualty\":200}]}}]}", &detail),
    );
    try testing.expectEqualStrings("qualty", detail);

    var detail2: []const u8 = "";
    try testing.expectError(
        error.BadParam,
        parseSpec(a, "{\"steps\":[{\"textures\":{\"rules\":[{\"slot\":\"normal\",\"skiped\":true}]}}]}", &detail2),
    );
    try testing.expectEqualStrings("skiped", detail2);
}

test "spec rejects empty and malformed specs" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    try testing.expectError(error.NoSteps, parseSpec(a, "{\"steps\":[]}", &detail));
    try testing.expectError(error.NoSteps, parseSpec(a, "{}", &detail));
    try testing.expectError(error.NoSteps, parseSpec(a, "   ", &detail));
    try testing.expectError(error.InvalidSpec, parseSpec(a, "not json", &detail));
    try testing.expectError(error.InvalidSpec, parseSpec(a, "[1,2]", &detail));
}

test "spec rejects bad params by step name" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var detail: []const u8 = "";
    try testing.expectError(
        error.BadParam,
        parseSpec(a, "{\"steps\":[{\"textures\":{\"quality\":\"high\"}}]}", &detail),
    );
    try testing.expectEqualStrings("textures", detail);

    try testing.expectError(
        error.BadParam,
        parseSpec(a, "{\"steps\":[{\"quantize\":{\"uv_bits\":99}}]}", &detail),
    );
    try testing.expectEqualStrings("quantize", detail);

    // Unknown texture format strings fall back to .auto, not an error.
    const p = try parseSpec(a, "{\"steps\":[{\"textures\":{\"format\":\"bogus\"}}]}", &detail);
    try testing.expectEqual(preset.TextureFormat.auto, p.steps[0].textures.format);
}
