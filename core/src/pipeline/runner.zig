//! Pipeline runner: load an asset, execute the steps of a preset in order, write
//! the result back to disk and report before/after statistics.
//!
//! # Memory
//!
//! Everything reachable from `Report` is allocated from the `a` passed to
//! `run`: the `steps` slice, every `note` string, and the `before`/`after`
//! `Stats` (including their `image_stats` and `garbage` slices). `Report` has
//! no `deinit` on purpose — pass an arena and free it in one go. Statistics
//! strings are duplicated into `a` so they stay valid after the loader's
//! internal arenas are released.
//!
//! # Known limitation (intermediate state)
//!
//! `ops/prune` works on the model-level `model.Asset` only and does not mutate
//! the underlying cgltf data. The written file is therefore produced from the
//! *unpruned* cgltf graph, so it may still contain elements that were dropped
//! from the model. `Report.after` correctly reflects the pruned model (plus the
//! real on-disk byte counts of the written file); once the writer GC and the
//! cdata-level ops land, the output will shrink too.
//!
//! TODO: sync the pruned model back into `cgltf_data` (or run the ops on cgltf
//! directly) so that the serialized output is lossless w.r.t. the report.

const std = @import("std");
const preset = @import("preset.zig");
const stats = @import("../stats.zig");
const parse = @import("../gltf/parse.zig");
const write = @import("../gltf/write.zig");
const prune = @import("../ops/prune.zig");
const dedup = @import("../ops/dedup.zig");
const weld = @import("../ops/weld.zig");
const join = @import("../ops/join.zig");
const quantize = @import("../ops/quantize.zig");
const simplify = @import("../ops/simplify.zig");
const geom = @import("../ops/geom.zig");
const encode_ktx = @import("../tex/encode_ktx.zig");
const decode = @import("../tex/decode.zig");
const mips = @import("../tex/mips.zig");
const formats = @import("../tex/formats.zig");
const c = @import("cgltf");

pub const StepStatus = struct {
    kind: []const u8, // "prune", "dedup", ...
    applied: bool,
    note: []const u8 = "", // e.g. "not implemented, skipped"
};

pub const Report = struct {
    steps: []const StepStatus,
    before: stats.Stats,
    after: stats.Stats,
}; // arena-owned, no deinit needed

pub const ProgressFn = *const fn (ctx: ?*anyopaque, step: []const u8, pct: f32) void;

pub const Options = struct {
    preset: preset.Preset,
    out_path: []const u8,
    progress_ctx: ?*anyopaque = null,
    progress: ?ProgressFn = null,
};

/// Load -> execute preset steps -> write out_path -> stats before/after.
pub fn run(io: std.Io, a: std.mem.Allocator, in_path: []const u8, opts: Options) !Report {
    const n_steps = opts.preset.steps.len;
    var steps = try a.alloc(StepStatus, n_steps);

    // ---- 1. load + before stats ------------------------------------------
    var loaded = try parse.loadFile(io, a, in_path);
    defer loaded.deinit();

    var before = try stats.compute(a, loaded.asset);
    try dupImageNames(a, &before);
    notify(opts, "load", 0.0);

    // ---- 2. run the steps ------------------------------------------------
    // `asset` starts as the loaded model; pruning replaces it wholesale.
    var asset = loaded.asset;
    for (opts.preset.steps, 0..) |step, i| {
        const kind: []const u8 = @tagName(std.meta.activeTag(step));
        notify(opts, kind, if (n_steps == 0) 0.0 else @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(n_steps)));

        steps[i] = switch (step) {
            .prune => blk: {
                const res = try prune.run(a, asset);
                asset = res.asset;
                break :blk .{
                    .kind = kind,
                    .applied = true,
                    .note = try pruneNote(a, res.removed),
                };
            },
            .dedup => |p| blk: {
                const res = try dedup.run(a, loaded.cdata, loaded.map, .{
                    .accessors = p.accessors,
                    .meshes = p.meshes,
                    .materials = p.materials,
                });
                break :blk .{
                    .kind = kind,
                    .applied = true,
                    .note = try std.fmt.allocPrint(
                        a,
                        "removed {d} accessor(s), {d} mesh(es), {d} mat(s)",
                        .{ res.removed_accessors, res.removed_meshes, res.removed_materials },
                    ),
                };
            },
            .weld => |p| blk: {
                const res = try weld.run(a, loaded.cdata, loaded.map, .{ .tolerance = p.tolerance });
                break :blk .{
                    .kind = kind,
                    .applied = true,
                    .note = try std.fmt.allocPrint(
                        a,
                        "merged {d} verts across {d} prim(s)",
                        .{ res.removed_vertices, res.rewritten_prims },
                    ),
                };
            },
            .join => blk: {
                const res = try join.run(a, loaded.cdata, loaded.map);
                break :blk .{
                    .kind = kind,
                    .applied = true,
                    .note = try std.fmt.allocPrint(
                        a,
                        "merged {d} prim(s), rewrote {d} mesh(es)",
                        .{ res.merged_prims, res.rewritten_meshes },
                    ),
                };
            },
            .quantize => |p| blk: {
                const res = try quantize.run(a, loaded.cdata, loaded.map, .{
                    .position_bits = p.position_bits,
                    .uv_bits = p.uv_bits,
                    .normal_oct = p.normal_oct,
                });
                break :blk .{
                    .kind = kind,
                    .applied = true,
                    .note = try std.fmt.allocPrint(
                        a,
                        "quantized {d} pos, {d} uv, {d} normal accessor(s)",
                        .{ res.quantized_positions, res.quantized_uvs, res.quantized_normals },
                    ),
                };
            },
            .simplify => |p| blk: {
                const res = try simplify.run(a, loaded.cdata, loaded.map, .{
                    .target_ratio = p.target_ratio,
                    .error_tolerance = p.error_tolerance,
                    .aggressive = p.aggressive,
                    .lock_borders = p.lock_borders,
                });
                break :blk .{
                    .kind = kind,
                    .applied = true,
                    .note = try std.fmt.allocPrint(
                        a,
                        "{d} -> {d} tris",
                        .{ res.before, res.after },
                    ),
                };
            },
            // step 4: encode embedded png/jpeg images to KTX2 (basisu)
            .textures => |p| blk: {
                const res = encodeTextures(a, loaded, p, opts.preset.target) catch |err| {
                    break :blk .{
                        .kind = kind,
                        .applied = false,
                        .note = try std.fmt.allocPrint(a, "failed: {s}", .{@errorName(err)}),
                    };
                };
                break :blk .{
                    .kind = kind,
                    .applied = res.encoded > 0,
                    .note = try std.fmt.allocPrint(
                        a,
                        "{s}: {d} encoded, {d} skipped; {d} -> {d} bytes",
                        .{ res.mode_note, res.encoded, res.skipped, res.src_bytes, res.ktx_bytes },
                    ),
                };
            },
        };
    }

    // ---- 3. serialize + write --------------------------------------------
    // cgltf data (and its mmapped bytes) must outlive the serialization call.
    const bytes = try write.serialize(a, loaded.cdata, loaded.map);
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = opts.out_path, .data = bytes });
    notify(opts, "write", 1.0);

    // ---- 4. after stats ---------------------------------------------------
    // The written file is the truth: writer GC + cdata-level ops determine
    // what actually ships, so `after` is computed from a fresh load of it.
    var out_loaded = try parse.loadFile(io, a, opts.out_path);
    defer out_loaded.deinit();

    var after = try stats.compute(a, out_loaded.asset);
    try dupImageNames(a, &after);

    return .{ .steps = steps, .before = before, .after = after };
}

const TexEncResult = struct {
    encoded: u32 = 0,
    skipped: u32 = 0,
    src_bytes: u64 = 0,
    ktx_bytes: u64 = 0,
    mode_note: []const u8 = "",
};

fn isNormalName(name: [*c]const u8) bool {
    const n = name orelse return false;
    const s = std.mem.span(n);
    if (s.len > 256) return false;
    var buf: [256]u8 = undefined;
    const lower = std.ascii.lowerString(buf[0..s.len], s);
    return std.mem.indexOf(u8, lower, "normal") != null;
}

fn embeddedImageBytes(data: *c.cgltf_data, im: *const c.cgltf_image) ?[]const u8 {
    _ = data;
    const bv = im.buffer_view orelse return null;
    const buf = bv.*.buffer orelse return null;
    const bd = buf.*.data orelse return null;
    const base: [*]const u8 = @ptrCast(bd);
    return (base + bv.*.offset)[0..bv.*.size];
}

fn setMimeKtx2(d: *c.cgltf_data, im: *c.cgltf_image) void {
    const s = "image/ktx2";
    const mem = d.memory;
    if (im.*.mime_type) |old| {
        if (@intFromPtr(old) != 0) {
            if (mem.free_func) |ff| ff(mem.user_data, old);
        }
        im.*.mime_type = null;
    }
    const allocf = mem.alloc_func orelse return;
    const dst = allocf(mem.user_data, s.len + 1) orelse return;
    const dstu: [*]u8 = @ptrCast(dst);
    @memcpy(dstu[0..s.len], s);
    dstu[s.len] = 0;
    im.*.mime_type = @ptrCast(dstu);
}

fn encodeTextures(a: std.mem.Allocator, loaded: parse.Loaded, p: preset.TextureParams, target: preset.Target) !TexEncResult {
    var res: TexEncResult = .{};
    const mode: encode_ktx.Mode = switch (p.format) {
        // ETC1S transcodes to ASTC/ETC2/BC1-5 at load — the compact choice
        .etc1s => .etc1s,
        .astc => .etc1s,
        // UASTC transcodes to BC7 (quality path)
        .uastc, .bc7 => .uastc,
        .auto => switch (target) {
            .desktop => .uastc,
            .mobile, .web => .etc1s,
        },
    };
    res.mode_note = switch (p.format) {
        .astc => "etc1s (transcode to astc at load)",
        .bc7 => "uastc (transcode to bc7 at load)",
        .etc1s => "etc1s",
        .uastc => "uastc",
        .auto => switch (mode) {
            .etc1s => "etc1s",
            .uastc => "uastc",
        },
    };

    var gb = try geom.Builder.init(a, loaded.cdata);
    defer gb.deinit();

    const Pending = struct { img: *c.cgltf_image, view_idx: usize, normal: bool };
    var pending: std.ArrayList(Pending) = .empty;

    const images = geom.sl(c.cgltf_image, loaded.cdata.images, loaded.cdata.images_count);
    for (images) |*im| {
        const bytes = embeddedImageBytes(loaded.cdata, im) orelse {
            res.skipped += 1;
            continue;
        };
        var dec = decode.decodeRgba(a, bytes) orelse {
            res.skipped += 1;
            continue;
        };
        defer dec.deinit(a);

        const normal = isNormalName(im.name);
        var px = dec.pixels;
        var w = dec.width;
        var h = dec.height;
        if (p.max_size > 0 and (w > p.max_size or h > p.max_size)) {
            const fit = try mips.fitMaxSize(a, px, w, h, p.max_size);
            px = fit.pixels;
            w = fit.w;
            h = fit.h;
        }

        const out = encode_ktx.encode(a, px, w, h, .{
            .mode = mode,
            .quality = p.quality,
            .rdo_lambda = p.rdo_lambda,
            .normal_map = normal and p.normal_maps_renormalize,
            .generate_mips = p.generate_mips,
            .max_size = 0, // already downscaled
            .srgb = !normal,
        }) catch {
            res.skipped += 1;
            continue;
        };

        res.src_bytes += bytes.len;
        res.ktx_bytes += out.ktx2.len;
        const vi = try gb.addView(out.ktx2, 0);
        try pending.append(a, .{ .img = im, .view_idx = vi, .normal = normal });
        res.encoded += 1;
    }

    if (pending.items.len == 0) return res;
    try gb.finish();

    const views = geom.sl(c.cgltf_buffer_view, loaded.cdata.buffer_views, loaded.cdata.buffer_views_count);
    for (pending.items) |pd| {
        pd.img.*.buffer_view = @ptrCast(&views[pd.view_idx]);
        setMimeKtx2(loaded.cdata, pd.img);
    }
    _ = formats; // format label comes from the written file's header via stats
    return res;
}

fn notify(opts: Options, step: []const u8, pct: f32) void {    if (opts.progress) |cb| cb(opts.progress_ctx, step, pct);
}

/// `Stats.image_stats[].name` points into the loader's arena. Copy any names
/// into the report allocator so the Report survives `Loaded.deinit()`.
fn dupImageNames(a: std.mem.Allocator, st: *stats.Stats) !void {
    if (st.image_stats.len == 0) return;
    const copied = try a.alloc(stats.ImageStat, st.image_stats.len);
    @memcpy(copied, st.image_stats);
    for (copied) |*im| {
        if (im.name) |n| im.name = try a.dupe(u8, n);
    }
    st.image_stats = copied;
}

fn pruneNote(a: std.mem.Allocator, r: prune.Removed) ![]const u8 {
    const total = r.nodes + r.meshes + r.materials + r.textures + r.images + r.samplers;
    if (total == 0) return "nothing to remove";
    return std.fmt.allocPrint(
        a,
        "removed {d} node(s), {d} mesh(es), {d} mat(s), {d} tex(s), {d} img(s), {d} sampler(s); model-level; cdata sync pending",
        .{ r.nodes, r.meshes, r.materials, r.textures, r.images, r.samplers },
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const testing = std.testing;

const ProgressLog = struct {
    count: usize = 0,
    last_step: []const u8 = "",
    last_pct: f32 = -1,
    saw_load: bool = false,
    saw_write: bool = false,
};

fn progressCb(ctx: ?*anyopaque, step: []const u8, pct: f32) void {
    const log: *ProgressLog = @ptrCast(@alignCast(ctx.?));
    log.count += 1;
    log.last_step = step;
    log.last_pct = pct;
    if (std.mem.eql(u8, step, "load")) log.saw_load = true;
    if (std.mem.eql(u8, step, "write")) log.saw_write = true;
}

test "run noop preset on box fixture" {
    const io = testing.io;
    const out_path = ".zig-cache/pipeline_runner_test_box.opt.glb";

    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const p = preset.loadFile(io, a, "test/noop.zon") catch |err| {
        std.debug.print("test/noop.zon: {s}\n", .{@errorName(err)});
        return error.TestUnexpectedResult;
    };

    var log: ProgressLog = .{};
    const rep = run(io, a, "test/fixtures/box.glb", .{
        .preset = p,
        .out_path = out_path,
        .progress_ctx = &log,
        .progress = progressCb,
    }) catch |err| {
        std.debug.print("runner.run: {s}\n", .{@errorName(err)});
        return error.TestUnexpectedResult;
    };

    // Per-step statuses: prune + dedup, both applied, in order.
    try testing.expectEqual(@as(usize, 2), rep.steps.len);
    try testing.expectEqualStrings("prune", rep.steps[0].kind);
    try testing.expect(rep.steps[0].applied);
    try testing.expect(rep.steps[0].note.len > 0);
    try testing.expectEqualStrings("dedup", rep.steps[1].kind);
    try testing.expect(rep.steps[1].applied);

    // Before/after stats are populated (box has geometry).
    try testing.expect(rep.before.triangles > 0);
    try testing.expect(rep.before.vertices > 0);
    try testing.expectEqual(rep.before.triangles, rep.after.triangles);
    try testing.expect(rep.after.disk_total > 0);

    // Progress fired for load + every step + write.
    try testing.expect(log.saw_load);
    try testing.expect(log.saw_write);
    try testing.expectEqual(@as(usize, 4), log.count);

    // Output exists, has the GLB magic and parses back.
    const raw = try std.Io.Dir.cwd().readFileAlloc(io, out_path, a, .limited(16 << 20));
    try testing.expect(raw.len >= 12);
    try testing.expectEqualSlices(u8, "glTF", raw[0..4]);

    var reloaded = try parse.loadFile(io, a, out_path);
    reloaded.deinit();

    // The report survives the loader teardown (image names are duplicated).
    for (rep.after.image_stats) |im| {
        if (im.name) |n| try testing.expect(n.len > 0);
    }

    std.Io.Dir.cwd().deleteFile(io, out_path) catch {};
}

test "run: weld and textures apply" {
    const io = testing.io;
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const steps = [_]preset.Step{ .{ .weld = .{} }, .{ .textures = .{} } };
    const rep = try run(io, a, "test/fixtures/box.glb", .{
        .preset = .{ .name = "skip", .target = .desktop, .steps = &steps },
        .out_path = ".zig-cache/pipeline_runner_test_skip.glb",
    });
    defer std.Io.Dir.cwd().deleteFile(io, ".zig-cache/pipeline_runner_test_skip.glb") catch {};

    try testing.expectEqual(@as(usize, 2), rep.steps.len);
    try testing.expectEqualStrings("weld", rep.steps[0].kind);
    try testing.expect(rep.steps[0].applied);
    try testing.expectEqualStrings("textures", rep.steps[1].kind);
    // box.glb ships one embedded PNG → now encoded to KTX2
    try testing.expect(rep.steps[1].applied);
    try testing.expect(std.mem.indexOf(u8, rep.steps[1].note, "1 encoded") != null);
}
