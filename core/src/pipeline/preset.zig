//! Pipeline presets: a preset is a zon file listing the steps of an asset
//! pipeline together with their parameters. The runner (future work) executes
//! the steps in order; this module only defines, parses and prints them.
//!
//! # Zon syntax
//!
//! A preset is a single zon struct literal with three fields:
//!   * `.name`   - free-form label (usually the file stem),
//!   * `.target` - one of `.mobile`, `.desktop`, `.web`,
//!   * `.steps`  - array of tagged-union steps, executed top to bottom.
//!
//! Every step is `.{ .<step> = .{ <params> } }`. Omitted params take the
//! defaults declared on the param struct, so `.prune = .{}` means
//! "prune with defaults". `.join = .{}` is the only form for join (it has no
//! parameters). Step names and order are validated by the runner, not here.
//!
//! ```zon
//! .{
//!     .name = "mobile",
//!     .target = .mobile,
//!     .steps = .{
//!         .{ .prune = .{} },
//!         .{ .dedup = .{ .meshes = false } },
//!         .{ .weld = .{ .tolerance = 0.0 } },
//!         .{ .join = .{} },
//!         .{ .textures = .{
//!             .format = .astc,
//!             .quality = 160,
//!             .rdo_lambda = 1.0,
//!             .normal_maps_renormalize = true,
//!             .generate_mips = true,
//!             .max_size = 2048,
//!         } },
//!         .{ .quantize = .{
//!             .position_bits = 14,
//!             .normal_oct = true,
//!             .uv_bits = 12,
//!             .meshopt_compression = true,
//!         } },
//!         .{ .simplify = .{
//!             .target_ratio = 0.5,
//!             .error_tolerance = 0.001,
//!             .aggressive = false,
//!             .lock_borders = true,
//!         } },
//!     },
//! }
//! ```
//!
//! Enums use zon enum literals (`.astc`, `.auto`, ...). Floats must be written
//! with a decimal point (`1.0`, not `1`). Integers must fit the field type
//! (`quality` is `u8`, `max_size` is `u32`, `*_bits` are `u5`).
//!
//! # Memory
//!
//! `parse`/`loadFile` allocate the whole preset - the `name` string and the
//! `steps` slice - from the allocator they are given. Pass an arena (or free
//! nothing and reuse the allocator); there is no `deinit` because the result is
//! a flat, arena-shaped value.
//!
//! Parsing is delegated to `std.zon.parse.fromSlice`, which understands
//! struct/array literals, enum literals, tagged union fields and field
//! defaults - everything the schema below uses.

const std = @import("std");
const Allocator = std.mem.Allocator;

/// Build target a preset is tuned for.
pub const Target = enum { mobile, desktop, web };

/// Texture container/format. `.auto` resolves to the platform default through
/// `resolveFormat`.
pub const TextureFormat = enum { astc, bc7, etc1s, uastc, auto };

pub const PruneParams = struct {
    /// Drop nodes not referenced by any scene.
    unused_nodes: bool = true,
    /// Drop materials not referenced by any primitive.
    unused_materials: bool = true,
    /// Drop images/textures/samplers not referenced by any material.
    unused_textures: bool = true,
    /// Drop ALL animations (gltfpack-style strip). Animation channel targets
    /// are regular nodes: scene-graph nodes always stay, nodes referenced
    /// only by a stripped animation are pruned as unused. Skins untouched.
    animations: bool = true,
};

pub const DedupParams = struct {
    accessors: bool = true,
    meshes: bool = true,
    materials: bool = true,
};

pub const WeldParams = struct {
    /// Merge distance for welding duplicated vertices. 0 = exact match only.
    tolerance: f32 = 0.0,
};

/// Merge primitives that share one material into a single primitive.
pub const JoinParams = struct {};

pub const QuantizeParams = struct {
    /// Positions are quantized to this many bits (meshoptimizer).
    position_bits: u5 = 14,
    /// Normals stored octahedral-encoded.
    normal_oct: bool = true,
    /// UVs are quantized to this many bits.
    uv_bits: u5 = 12,
    /// Legacy no-op (kept so old presets still parse and old UIs keep
    /// compiling); the real switch is `meshopt_compression` below.
    compress: bool = true,
    /// Emit EXT_meshopt_compression on the resulting buffers (gltfpack -cc
    /// style). Output requires an EXT_meshopt_compression-capable loader.
    meshopt_compression: bool = false,
};

pub const SimplifyParams = struct {
    /// Fraction of triangles to keep (0..1).
    target_ratio: f32 = 0.5,
    /// Maximum allowed geometric error relative to mesh extent.
    error_tolerance: f32 = 0.001,
    /// Allow more aggressive collapses (faster, lower quality).
    aggressive: bool = false,
    /// Never collapse or move boundary edges.
    lock_borders: bool = true,
    /// Seam-aware simplification: normal/UV error is part of the collapse cost.
    use_attributes: bool = false,
    /// Weight of the normal attribute error (per component).
    weight_normal: f32 = 1.0,
    /// Weight of the TEXCOORD_0 attribute error (per component).
    weight_uv: f32 = 1.0,
};

/// KTX2 payload supercompression for the textures step. `zstd` compresses the
/// UASTC payload (supercompressionScheme=2, −20–40% file size, no VRAM change;
/// needs a KTX2 zstd-capable loader). Ignored for ETC1S. Default none keeps
/// existing presets byte-identical.
pub const Supercompression = @import("../tex/encode_ktx.zig").Supercompression;

pub const TextureParams = struct {
    /// `auto` = ASTC (mobile), BC7 (desktop), ETC1S (web).
    format: TextureFormat = .auto,
    /// Encoder quality knob, 0..255 (ETC1S/generic use it directly).
    quality: u8 = 128,
    /// Rate-distortion trade-off for ETC1S/UASTC; higher = smaller, worse.
    rdo_lambda: f32 = 1.0,
    /// Re-normalize normal maps after compression.
    normal_maps_renormalize: bool = true,
    generate_mips: bool = true,
    /// Downscale textures larger than this. 0 = no limit.
    max_size: u32 = 0,
    /// zstd supercompression of the UASTC KTX2 payload.
    supercompression: Supercompression = .none,
    /// Per-image overrides, applied in array order (last match wins).
    overrides: []const TextureOverride = &.{},
};

/// One entry of `TextureParams.overrides`. Every field is optional: only the
/// present ones replace the step's base params for the matched image. An entry
/// matching no image is ignored.
pub const TextureOverride = struct {
    /// 0-based index into model.images (the indices `info` reports).
    image: ?u32 = null,
    /// Substring matched (case-insensitive) against image name/uri.
    name: []const u8 = "",
    /// Leave the image as-is: original bytes preserved, not encoded.
    skip: bool = false,
    format: ?TextureFormat = null,
    quality: ?u8 = null,
    max_size: ?u32 = null,
    generate_mips: ?bool = null,
    normal_map: ?bool = null,
    supercompression: ?Supercompression = null,
};

/// One pipeline step. The active field selects the operation.
pub const Step = union(enum) {
    prune: PruneParams,
    dedup: DedupParams,
    weld: WeldParams,
    join: JoinParams,
    quantize: QuantizeParams,
    simplify: SimplifyParams,
    textures: TextureParams,
};

/// Tag of `Step`, handy for tests and the CLI.
pub const StepKind = std.meta.Tag(Step);

pub const Preset = struct {
    name: []const u8 = "",
    target: Target = .desktop,
    steps: []const Step = &.{},
};

/// Errors surfaced by `parse`/`loadFile`. Zon syntax/type problems collapse to
/// `InvalidPreset` after the detailed diagnostics have been logged.
pub const Error = error{ OutOfMemory, InvalidPreset };

/// Upper bound on a preset file. Presets are tiny; anything bigger is a mistake
/// (e.g. accidentally pointing at a .glb).
pub const max_file_bytes: usize = 1 << 20;

/// Parse preset zon text. Allocated strings and the `steps` slice are owned by
/// the caller's allocator `a` (an arena is the natural fit).
pub fn parse(a: Allocator, bytes: []const u8) Error!Preset {
    return parseInner(a, bytes, true);
}

/// `report` controls whether a zon syntax/type failure is logged through
/// `std.log.err` (with line/column diagnostics) before `InvalidPreset` is
/// returned. Tests and batch callers pass false.
fn parseInner(a: Allocator, bytes: []const u8, report: bool) Error!Preset {
    const source = try a.dupeSentinel(u8, bytes, 0);
    defer a.free(source);

    var diagnostics: std.zon.parse.Diagnostics = undefined;
    return std.zon.parse.fromSlice(Preset, .{
        .gpa = a,
        .arena = a,
        .source = source,
        .diagnostics = &diagnostics,
    }) catch |err| switch (err) {
        error.OutOfMemory => error.OutOfMemory,
        error.ParseZon => {
            if (report) diagnostics.log("<preset>");
            return error.InvalidPreset;
        },
    };
}

/// Read `path` from the cwd and parse it as a preset.
pub fn loadFile(io: std.Io, a: Allocator, path: []const u8) Error!Preset {
    const bytes = std.Io.Dir.cwd().readFileAllocOptions(
        io,
        path,
        a,
        .limited(max_file_bytes),
        .of(u8),
        0,
    ) catch |err| switch (err) {
        error.OutOfMemory => return error.OutOfMemory,
        else => return error.InvalidPreset,
    };
    defer a.free(bytes);
    return parse(a, bytes);
}

/// Write "presets/<name>.zon" into `buf`. Returns an empty slice if `buf` is
/// too small.
pub fn defaultPath(name: []const u8, buf: []u8) []const u8 {
    const out = std.fmt.bufPrint(buf, "presets/{s}.zon", .{name}) catch return buf[0..0];
    return out;
}

/// Resolve `.auto` to the target's texture format.
pub fn resolveFormat(target: Target, format: TextureFormat) TextureFormat {
    if (format != .auto) return format;
    return switch (target) {
        .mobile => .astc,
        .desktop => .bc7,
        .web => .etc1s,
    };
}

const mobile_steps = [_]Step{
    .{ .prune = .{} },
    .{ .dedup = .{} },
    .{ .weld = .{} },
    .{ .join = .{} },
    .{ .textures = .{
        .format = .astc,
        .quality = 160,
        .generate_mips = true,
        .max_size = 2048,
    } },
    .{ .quantize = .{} },
};

const desktop_steps = [_]Step{
    .{ .prune = .{} },
    .{ .dedup = .{} },
    .{ .weld = .{} },
    .{ .join = .{} },
    .{ .textures = .{
        .format = .bc7,
        .quality = 255,
        .generate_mips = true,
    } },
    .{ .quantize = .{} },
};

const web_steps = [_]Step{
    .{ .prune = .{} },
    .{ .dedup = .{} },
    .{ .weld = .{} },
    .{ .join = .{} },
    .{ .textures = .{
        .format = .etc1s,
        .rdo_lambda = 1.0,
        .generate_mips = true,
        .max_size = 1024,
    } },
    .{ .quantize = .{ .meshopt_compression = true } },
};

/// Built-in preset used when no preset file is supplied.
pub fn platformDefaults(target: Target) Preset {
    return switch (target) {
        .mobile => .{ .name = "mobile", .target = .mobile, .steps = &mobile_steps },
        .desktop => .{ .name = "desktop", .target = .desktop, .steps = &desktop_steps },
        .web => .{ .name = "web", .target = .web, .steps = &web_steps },
    };
}

/// Human-readable dump: a header plus one line per step. Works with any writer
/// exposing `print` (e.g. `std.Io.Writer.fixed(...)`).
pub fn describe(p: Preset, w: anytype) !void {
    try w.print("preset \"{s}\" target={s} steps={d}\n", .{
        p.name,
        @tagName(p.target),
        p.steps.len,
    });
    for (p.steps, 0..) |step, i| {
        try w.print("  {d:>2}. ", .{i + 1});
        switch (step) {
            .prune => |v| {
                try w.print(
                    "prune     unused_nodes={} unused_materials={} unused_textures={} animations={}",
                    .{ v.unused_nodes, v.unused_materials, v.unused_textures, v.animations },
                );
                if (!v.animations) try w.writeAll(" strip_animations");
                try w.writeByte('\n');
            },
            .dedup => |v| try w.print(
                "dedup     accessors={} meshes={} materials={}\n",
                .{ v.accessors, v.meshes, v.materials },
            ),
            .weld => |v| try w.print("weld      tolerance={d}\n", .{v.tolerance}),
            .join => try w.print("join      (merge primitives sharing a material)\n", .{}),
            .quantize => |v| try w.print(
                "quantize  position_bits={d} normal_oct={} uv_bits={d} meshopt_compression={}\n",
                .{ v.position_bits, v.normal_oct, v.uv_bits, v.meshopt_compression },
            ),
            .simplify => |v| try w.print(
                "simplify  target_ratio={d} error_tolerance={d} aggressive={} lock_borders={} use_attributes={} weight_normal={d} weight_uv={d}\n",
                .{ v.target_ratio, v.error_tolerance, v.aggressive, v.lock_borders, v.use_attributes, v.weight_normal, v.weight_uv },
            ),
            .textures => |v| {
                try w.print(
                    "textures  format={s} quality={d} rdo_lambda={d} mips={} max_size={d} supercompression={s}",
                    .{
                        @tagName(v.format),
                        v.quality,
                        v.rdo_lambda,
                        v.generate_mips,
                        v.max_size,
                        @tagName(v.supercompression),
                    },
                );
                if (v.overrides.len > 0) try w.print(" overrides={d}", .{v.overrides.len});
                try w.writeByte('\n');
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const testing = std.testing;

fn expectFilePreset(path: []const u8) !Preset {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    errdefer arena.deinit();

    // Errors here (missing repo file) must fail the test loudly.
    return loadFile(testing.io, arena.allocator(), path) catch |err| {
        std.debug.print("preset file '{s}' could not be loaded: {s}\n", .{ path, @errorName(err) });
        return error.TestUnexpectedResult;
    };
}

fn kindsOf(p: Preset) []const StepKind {
    // Caller owns the memory; tests use a static buffer to stay allocator-free.
    const S = struct {
        var buf: [16]StepKind = undefined;
    };
    for (p.steps, 0..) |s, i| S.buf[i] = std.meta.activeTag(s);
    return S.buf[0..p.steps.len];
}

test "parse mobile preset file" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const p = loadFile(testing.io, arena.allocator(), "presets/mobile.zon") catch |err| {
        std.debug.print("presets/mobile.zon: {s}\n", .{@errorName(err)});
        return error.TestUnexpectedResult;
    };

    try testing.expectEqualStrings("mobile", p.name);
    try testing.expectEqual(Target.mobile, p.target);
    try testing.expectEqual(@as(usize, 6), p.steps.len);
    try testing.expectEqualSlices(StepKind, &.{
        .prune, .dedup, .weld, .join, .textures, .quantize,
    }, kindsOf(p));

    const tex = p.steps[4].textures;
    try testing.expectEqual(TextureFormat.astc, tex.format);
    try testing.expectEqual(@as(u8, 160), tex.quality);
    try testing.expect(tex.generate_mips);
    try testing.expectEqual(@as(u32, 2048), tex.max_size);

    const q = p.steps[5].quantize;
    try testing.expectEqual(@as(u5, 14), q.position_bits);
    try testing.expectEqual(@as(u5, 12), q.uv_bits);
    try testing.expect(q.compress); // legacy no-op, still parsed
    try testing.expect(!q.meshopt_compression); // opt-in, off in shipped zons
}

test "parse desktop preset file" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const p = loadFile(testing.io, arena.allocator(), "presets/desktop.zon") catch |err| {
        std.debug.print("presets/desktop.zon: {s}\n", .{@errorName(err)});
        return error.TestUnexpectedResult;
    };

    try testing.expectEqualStrings("desktop", p.name);
    try testing.expectEqual(Target.desktop, p.target);
    try testing.expectEqual(@as(usize, 6), p.steps.len);
    try testing.expectEqualSlices(StepKind, &.{
        .prune, .dedup, .weld, .join, .textures, .quantize,
    }, kindsOf(p));

    const tex = p.steps[4].textures;
    try testing.expectEqual(TextureFormat.bc7, tex.format);
    try testing.expectEqual(@as(u8, 255), tex.quality);
    try testing.expect(tex.generate_mips);
    try testing.expectEqual(@as(u32, 0), tex.max_size);
}

test "parse web preset file" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const p = loadFile(testing.io, arena.allocator(), "presets/web.zon") catch |err| {
        std.debug.print("presets/web.zon: {s}\n", .{@errorName(err)});
        return error.TestUnexpectedResult;
    };

    try testing.expectEqualStrings("web", p.name);
    try testing.expectEqual(Target.web, p.target);
    try testing.expectEqual(@as(usize, 6), p.steps.len);
    try testing.expectEqualSlices(StepKind, &.{
        .prune, .dedup, .weld, .join, .textures, .quantize,
    }, kindsOf(p));

    const tex = p.steps[4].textures;
    try testing.expectEqual(TextureFormat.etc1s, tex.format);
    try testing.expectEqual(@as(f32, 1.0), tex.rdo_lambda);
    try testing.expect(tex.generate_mips);
    try testing.expectEqual(@as(u32, 1024), tex.max_size);

    try testing.expect(p.steps[5].quantize.compress);
    try testing.expect(!p.steps[5].quantize.meshopt_compression);
}

test "parse honours defaults and overrides" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();

    const src =
        \\.{
        \\    .name = "custom",
        \\    .target = .web,
        \\    .steps = .{
        \\        .{ .prune = .{ .unused_nodes = false } },
        \\        .{ .join = .{} },
        \\        .{ .simplify = .{ .target_ratio = 0.25, .aggressive = true } },
        \\    },
        \\}
    ;

    const p = try parse(arena.allocator(), src);
    try testing.expectEqualStrings("custom", p.name);
    try testing.expectEqual(Target.web, p.target);
    try testing.expectEqual(@as(usize, 3), p.steps.len);

    // Defaults survive where the file says nothing.
    try testing.expect(!p.steps[0].prune.unused_nodes);
    try testing.expect(p.steps[0].prune.unused_materials);
    try testing.expectEqual(@as(f32, 0.25), p.steps[2].simplify.target_ratio);
    try testing.expect(p.steps[2].simplify.aggressive);
    try testing.expect(p.steps[2].simplify.lock_borders);
}

test "parse meshopt_compression flag" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();

    // Default off; describe reports it.
    const d = try parse(arena.allocator(), ".{ .name = \"n\", .target = .web, .steps = .{ .{ .quantize = .{} } } }");
    try testing.expect(!d.steps[0].quantize.meshopt_compression);
    var buf: [256]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try describe(d, &w);
    try testing.expect(std.mem.indexOf(u8, w.buffered(), "meshopt_compression=false") != null);

    // Explicit opt-in parses.
    const e = try parse(arena.allocator(), ".{ .name = \"n\", .target = .web, .steps = .{ .{ .quantize = .{ .meshopt_compression = true } } } }");
    try testing.expect(e.steps[0].quantize.meshopt_compression);
}

test "parse prune animations flag defaults true" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();

    const d = try parse(arena.allocator(), ".{ .name = \"n\", .target = .web, .steps = .{ .{ .prune = .{} } } }");
    try testing.expect(d.steps[0].prune.animations);

    const s = try parse(arena.allocator(), ".{ .name = \"n\", .target = .web, .steps = .{ .{ .prune = .{ .animations = false } } } }");
    try testing.expect(!s.steps[0].prune.animations);

    // describe marks the strip.
    var buf: [512]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try describe(s, &w);
    try testing.expect(std.mem.indexOf(u8, w.buffered(), "strip_animations") != null);
}

test "parse textures supercompression zon round-trip" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();

    // Default: none (byte-compat for existing presets).
    const d = try parse(arena.allocator(), ".{ .name = \"n\", .target = .web, .steps = .{ .{ .textures = .{} } } }");
    try testing.expectEqual(Supercompression.none, d.steps[0].textures.supercompression);

    const src =
        \\.{
        \\    .name = "zc",
        \\    .target = .desktop,
        \\    .steps = .{
        \\        .{ .textures = .{
        \\            .format = .uastc,
        \\            .supercompression = .zstd,
        \\            .overrides = .{
        \\                .{ .name = "normal", .supercompression = .none },
        \\            },
        \\        } },
        \\    },
        \\}
    ;
    const p = try parse(arena.allocator(), src);
    const tex = p.steps[0].textures;
    try testing.expectEqual(Supercompression.zstd, tex.supercompression);
    try testing.expectEqual(@as(usize, 1), tex.overrides.len);
    try testing.expectEqual(@as(?Supercompression, .none), tex.overrides[0].supercompression);

    // describe reports it.
    var buf: [1024]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try describe(p, &w);
    try testing.expect(std.mem.indexOf(u8, w.buffered(), "supercompression=zstd") != null);
}

test "parse rejects garbage" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();

    try testing.expectError(error.InvalidPreset, parseInner(arena.allocator(), ".{ .target = .switch }", false));
    try testing.expectError(error.InvalidPreset, parseInner(arena.allocator(), "not zon at all", false));
}

test "platformDefaults sanity" {
    const cases = [_]struct { target: Target, format: TextureFormat, max_size: u32, quality: u8 }{
        .{ .target = .mobile, .format = .astc, .max_size = 2048, .quality = 160 },
        .{ .target = .desktop, .format = .bc7, .max_size = 0, .quality = 255 },
        .{ .target = .web, .format = .etc1s, .max_size = 1024, .quality = 128 },
    };

    for (cases) |c| {
        const p = platformDefaults(c.target);
        try testing.expectEqual(c.target, p.target);
        try testing.expect(p.steps.len >= 6);
        try testing.expectEqual(StepKind.prune, std.meta.activeTag(p.steps[0]));
        try testing.expectEqual(StepKind.join, std.meta.activeTag(p.steps[3]));
        try testing.expectEqual(StepKind.textures, std.meta.activeTag(p.steps[4]));
        try testing.expectEqual(StepKind.quantize, std.meta.activeTag(p.steps[5]));

        const tex = p.steps[4].textures;
        try testing.expectEqual(c.format, tex.format);
        try testing.expectEqual(c.format, resolveFormat(c.target, .auto));
        try testing.expectEqual(c.max_size, tex.max_size);
        try testing.expectEqual(c.quality, tex.quality);
        try testing.expect(tex.generate_mips);

        // Simplify is deliberately opt-in: never a default step.
        for (p.steps) |s| try testing.expect(std.meta.activeTag(s) != .simplify);
    }

    // resolveFormat leaves explicit formats alone.
    try testing.expectEqual(TextureFormat.uastc, resolveFormat(.mobile, .uastc));
}

test "defaultPath" {
    var buf: [64]u8 = undefined;
    try testing.expectEqualStrings("presets/web.zon", defaultPath("web", &buf));
    var tiny: [4]u8 = undefined;
    try testing.expectEqual(@as(usize, 0), defaultPath("mobile", &tiny).len);
}

test "describe smoke test" {
    var buf: [2048]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);

    const p = platformDefaults(.mobile);
    try describe(p, &w);

    const out = w.buffered();
    try testing.expect(std.mem.indexOf(u8, out, "preset \"mobile\"") != null);
    try testing.expect(std.mem.indexOf(u8, out, "textures  format=astc") != null);
    try testing.expect(std.mem.indexOf(u8, out, "quantize  position_bits=14") != null);
    try testing.expectEqual(@as(usize, 7), std.mem.count(u8, out, "\n"));
}

test "parse textures overrides round-trip" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();

    const src =
        \\.{
        \\    .name = "ov",
        \\    .target = .desktop,
        \\    .steps = .{
        \\        .{ .textures = .{
        \\            .format = .auto,
        \\            .quality = 128,
        \\            .overrides = .{
        \\                .{ .image = 2, .format = .uastc, .quality = 200, .max_size = 512, .generate_mips = true, .normal_map = true },
        \\                .{ .name = "basecolor", .max_size = 1024 },
        \\                .{ .image = 5, .skip = true },
        \\            },
        \\        } },
        \\    },
        \\}
    ;

    const p = try parse(arena.allocator(), src);
    try testing.expectEqual(@as(usize, 1), p.steps.len);
    const tex = p.steps[0].textures;
    try testing.expectEqual(@as(usize, 3), tex.overrides.len);

    const o0 = tex.overrides[0];
    try testing.expectEqual(@as(?u32, 2), o0.image);
    try testing.expectEqual(TextureFormat.uastc, o0.format.?);
    try testing.expectEqual(@as(?u8, 200), o0.quality);
    try testing.expectEqual(@as(?u32, 512), o0.max_size);
    try testing.expectEqual(@as(?bool, true), o0.generate_mips);
    try testing.expectEqual(@as(?bool, true), o0.normal_map);
    try testing.expect(!o0.skip);

    const o1 = tex.overrides[1];
    try testing.expectEqual(@as(?u32, null), o1.image);
    try testing.expectEqualStrings("basecolor", o1.name);
    try testing.expectEqual(@as(?u32, 1024), o1.max_size);
    try testing.expectEqual(@as(?TextureFormat, null), o1.format);

    const o2 = tex.overrides[2];
    try testing.expectEqual(@as(?u32, 5), o2.image);
    try testing.expect(o2.skip);

    // describe reports the override count on the textures line.
    var buf: [1024]u8 = undefined;
    var w = std.Io.Writer.fixed(&buf);
    try describe(p, &w);
    try testing.expect(std.mem.indexOf(u8, w.buffered(), "overrides=3") != null);
}

test "parse textures without overrides defaults to empty" {
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const p = try parse(arena.allocator(), ".{ .name = \"n\", .target = .web, .steps = .{ .{ .textures = .{} } } }");
    try testing.expectEqual(@as(usize, 0), p.steps[0].textures.overrides.len);
}
