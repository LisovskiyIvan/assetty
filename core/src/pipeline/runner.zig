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
    /// Wall time spent inside this step's dispatch, in seconds.
    secs: f32 = 0,
};

pub const Report = struct {
    steps: []const StepStatus,
    before: stats.Stats,
    after: stats.Stats,
    /// Per-image outcomes of the textures step, in image order. Empty when the
    /// preset has no textures step or no overrides. Arena-owned like the rest.
    texture_images: []const TextureImageOutcome = &.{},
    /// Wall time of the whole run: load + steps + serialize/write, in seconds.
    total_secs: f64 = 0,
}; // arena-owned, no deinit needed

pub const ProgressFn = *const fn (ctx: ?*anyopaque, step: []const u8, pct: f32, sub: ?ProgressSub) void;

/// Optional per-step detail for a progress update, e.g. the textures step's
/// "texture 3/7" counter. `label` is a stable ASCII token the page maps to a
/// localized frame ("texture"); the callback must be thread-safe, as the
/// parallel encode loop reports completions from worker threads.
pub const ProgressSub = struct {
    label: []const u8,
    done: u32,
    total: u32,
};

/// Where a run is inside its preset: which step is encoding, out of how many.
/// Lets a long step (textures) interpolate `pct` between its own start and
/// the next step's.
pub const ProgScope = struct {
    opts: Options,
    index: usize,
    n_steps: usize,
};

pub const Options = struct {
    preset: preset.Preset,
    out_path: []const u8,
    progress_ctx: ?*anyopaque = null,
    progress: ?ProgressFn = null,
};

/// Load -> execute preset steps -> write out_path -> stats before/after.
pub fn run(io: std.Io, a: std.mem.Allocator, in_path: []const u8, opts: Options) !Report {
    const t_start = nowNs(io);
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
    var tex_images: []const TextureImageOutcome = &.{};

    for (opts.preset.steps, 0..) |step, i| {
        const kind: []const u8 = @tagName(std.meta.activeTag(step));
        notify(opts, kind, if (n_steps == 0) 0.0 else @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(n_steps)));

        const t_step = nowNs(io);
        steps[i] = switch (step) {
            .prune => |p| blk: {
                const res = try prune.run(a, asset, .{ .animations = p.animations });
                asset = res.asset;
                if (!p.animations) {
                    // model-level strip is not enough: the writer serializes
                    // the cgltf graph, so drop the animations there too. The
                    // writer's reachability GC then drops the orphaned sampler
                    // accessors and buffer views on its own. Any cdata op
                    // order is safe: quantize/etc. only touch accessors, and
                    // stripping later just unreferences them.
                    loaded.cdata.animations_count = 0;
                }
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
                    .use_attributes = p.use_attributes,
                    .weight_normal = p.weight_normal,
                    .weight_uv = p.weight_uv,
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
                const res = encodeTextures(a, loaded, p, opts.preset.target, .{
                    .opts = opts,
                    .index = i,
                    .n_steps = n_steps,
                }) catch |err| {
                    break :blk .{
                        .kind = kind,
                        .applied = false,
                        .note = try std.fmt.allocPrint(a, "failed: {s}", .{@errorName(err)}),
                    };
                };
                tex_images = res.details;
                break :blk .{
                    .kind = kind,
                    .applied = res.encoded > 0,
                    .note = try std.fmt.allocPrint(
                        a,
                        "{s}: {d} encoded, {d} skipped{s}; {d} -> {d} bytes",
                        .{ res.mode_note, res.encoded, res.skipped, if (res.mixed) " (mixed, see texture_images)" else "", res.src_bytes, res.ktx_bytes },
                    ),
                };
            },
        };
        steps[i].secs = @floatCast(secsBetween(t_step, nowNs(io)));
    }

    // ---- 3. serialize + write --------------------------------------------
    // cgltf data (and its mmapped bytes) must outlive the serialization call.
    const bytes = try write.serialize(a, loaded.cdata, loaded.map);
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = opts.out_path, .data = bytes });
    notify(opts, "write", 1.0);
    const t_end = nowNs(io);

    // ---- 4. after stats ---------------------------------------------------
    // The written file is the truth: writer GC + cdata-level ops determine
    // what actually ships, so `after` is computed from a fresh load of it.
    var out_loaded = try parse.loadFile(io, a, opts.out_path);
    defer out_loaded.deinit();

    var after = try stats.compute(a, out_loaded.asset);
    try dupImageNames(a, &after);

    return .{
        .steps = steps,
        .before = before,
        .after = after,
        .texture_images = tex_images,
        .total_secs = secsBetween(t_start, t_end),
    };
}

/// Monotonic wall clock, in nanoseconds (`awake` = excludes system sleep).
fn nowNs(io: std.Io) i96 {
    return std.Io.Clock.Timestamp.now(io, .awake).raw.nanoseconds;
}

fn secsBetween(t0: i96, t1: i96) f64 {
    return @as(f64, @floatFromInt(t1 - t0)) / @as(f64, std.time.ns_per_s);
}

const TexEncResult = struct {
    encoded: u32 = 0,
    skipped: u32 = 0,
    src_bytes: u64 = 0,
    ktx_bytes: u64 = 0,
    mode_note: []const u8 = "",
    /// True when an override changed an effective format or skipped an image.
    mixed: bool = false,
    details: []const TextureImageOutcome = &.{},
};

/// One row of the textures step's per-image report: which image, whether it
/// was left as-is, and the effective format (`@tagName` of the resolved
/// `TextureFormat`, or `"as-is"` when skipped).
pub const TextureImageOutcome = struct {
    index: u32,
    name: ?[]const u8 = null,
    skipped: bool = false,
    format: []const u8 = "",
};

/// Base `TextureParams` with every matching override applied in array order
/// (last match wins). `normal_map` is the explicit override, if any; null
/// means "auto-detect from the image name".
pub const EffectiveTex = struct {
    skip: bool = false,
    format: preset.TextureFormat,
    quality: u8,
    max_size: u32,
    generate_mips: bool,
    normal_map: ?bool = null,
};

/// Resolve the effective params for image `index` with optional cgltf
/// `name`/`uri`. A matching item's present fields replace the base params;
/// `skip` is a plain bool so the last matching item's value wins. An item
/// with neither `image` nor `name` matches nothing.
pub fn resolveTextureOverride(p: preset.TextureParams, index: u32, name: ?[]const u8, uri: ?[]const u8) EffectiveTex {
    var eff: EffectiveTex = .{
        .format = p.format,
        .quality = p.quality,
        .max_size = p.max_size,
        .generate_mips = p.generate_mips,
    };
    for (p.overrides) |o| {
        if (!overrideMatches(o, index, name, uri)) continue;
        eff.skip = o.skip;
        if (o.format) |f| eff.format = f;
        if (o.quality) |q| eff.quality = q;
        if (o.max_size) |m| eff.max_size = m;
        if (o.generate_mips) |g| eff.generate_mips = g;
        if (o.normal_map) |n| eff.normal_map = n;
    }
    return eff;
}

fn overrideMatches(o: preset.TextureOverride, index: u32, name: ?[]const u8, uri: ?[]const u8) bool {
    var has_selector = false;
    if (o.image) |ix| {
        has_selector = true;
        if (ix != index) return false;
    }
    if (o.name.len > 0) {
        has_selector = true;
        if (!nameOrUriContains(name, uri, o.name)) return false;
    }
    return has_selector;
}

fn nameOrUriContains(name: ?[]const u8, uri: ?[]const u8, needle: []const u8) bool {
    if (name) |n| if (containsIgnoreCase(n, needle)) return true;
    if (uri) |u| if (containsIgnoreCase(u, needle)) return true;
    return false;
}

fn containsIgnoreCase(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0) return true;
    if (needle.len > haystack.len) return false;
    var i: usize = 0;
    while (i + needle.len <= haystack.len) : (i += 1) {
        var ok = true;
        for (needle, 0..) |nc, j| {
            if (std.ascii.toLower(haystack[i + j]) != std.ascii.toLower(nc)) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }
    return false;
}

/// `[*c]` cgltf string to a slice; null stays null.
fn cStr(s: [*c]const u8) ?[]const u8 {
    const p = s orelse return null;
    return std.mem.span(p);
}

fn dupCStr(a: std.mem.Allocator, s: [*c]const u8) !?[]const u8 {
    const p = s orelse return null;
    return try a.dupe(u8, std.mem.span(p));
}

/// Base-format mode mapping (shared by every image without a format override).
fn modeForFormat(f: preset.TextureFormat, target: preset.Target) encode_ktx.Mode {
    return switch (f) {
        // ETC1S transcodes to ASTC/ETC2/BC1-5 at load — the compact choice
        .etc1s, .astc => .etc1s,
        // UASTC transcodes to BC7 (quality path)
        .uastc, .bc7 => .uastc,
        .auto => switch (target) {
            .desktop => .uastc,
            .mobile, .web => .etc1s,
        },
    };
}

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

/// An image that got a KTX2 buffer view; applied to the cgltf graph on the
/// main thread once every view exists.
const PendingView = struct { img: *c.cgltf_image, view_idx: usize, normal: bool };

/// Outer concurrency for the per-image encode phase: at most 4 workers.
/// Measured (10-core macOS arm64, 5x2048px ETC1S + 5-image UASTC models):
/// 4 outer x 8 inner beats 5-10 outer x 1-2 inner by 1.5-2x and ties 3-6
/// outer x 6-8 inner within noise. basisu's pool threads block enough that
/// ~3x oversubscription keeps all cores fed, while inner < 4 starves
/// per-image scaling — so the cap stays small and inner stays at 8.
/// Tune via basset_basisu_set_max_threads / ASSETTY_TEX_{OUTER,INNER}.
const max_parallel_encodes = 4;

/// Test/debug override for the outer worker count (ASSETTY_TEX_OUTER=N).
/// Unset or unparsable means the default cap (see `encodeThreadCount`).
fn envOuterOverride() ?usize {
    const v = std.c.getenv("ASSETTY_TEX_OUTER") orelse return null;
    return std.fmt.parseInt(usize, std.mem.span(v), 10) catch null;
}

/// Test/debug override for the per-encode basisu thread count
/// (ASSETTY_TEX_INNER=N). Unset or unparsable means the default of 8.
fn envInnerOverride() ?usize {
    const v = std.c.getenv("ASSETTY_TEX_INNER") orelse return null;
    return std.fmt.parseInt(usize, std.mem.span(v), 10) catch null;
}

/// One image to encode, in `cdata.images` order, with its resolved params.
const ImageJob = struct {
    bytes: []const u8,
    mode: encode_ktx.Mode,
    quality: u8,
    max_size: u32,
    generate_mips: bool,
    /// Value for the encode call's `normal_map` (override or auto path).
    normal_map: bool,
    srgb: bool,
    /// Effective normal flag, for the buffer-view bookkeeping.
    normal: bool,
    rdo_lambda: f32,
};

const EncOutcome = struct {
    /// KTX2 bytes owned by `std.heap.c_allocator`, freed by the joining thread.
    ktx2: []u8 = &.{},
    src_bytes: u64 = 0,
    err: ?anyerror = null,
};

const ParCtx = struct {
    jobs: []const ImageJob,
    /// Work-stealing cursor: workers claim the next image index, so uneven
    /// image sizes balance out without chunking.
    next: std.atomic.Value(usize) = .init(0),
    outs: []EncOutcome,
    /// Textures-step scope for per-completion progress; null in unit tests.
    prog: ?ProgScope = null,
    total: u32 = 0,
    /// Images disposed so far (pre-skipped slots start the count; workers add
    /// each finished encode). Only touched via atomics: workers race here.
    done: std.atomic.Value(u32) = .init(0),
};

const Worker = struct {
    ctx: *ParCtx,
    /// Scratch arena per worker. Arenas are not thread-safe and the caller's
    /// `a` may be one, so each worker gets its own over `std.heap.c_allocator`
    /// and is reset between images; only the final KTX2 bytes are copied out
    /// (into c_allocator) and handed to the main thread.
    arena: std.heap.ArenaAllocator,
};

/// decode -> (downscale) -> basisu encode for one image, all scratch from
/// `scratch`. The returned KTX2 is a c_allocator copy so it outlives the arena.
fn encodeOneJob(scratch: std.mem.Allocator, job: ImageJob) EncOutcome {
    const dec = decode.decodeRgba(scratch, job.bytes) orelse return .{ .err = error.ImageDecode };

    var px = dec.pixels;
    var w = dec.width;
    var h = dec.height;
    if (job.max_size > 0 and (w > job.max_size or h > job.max_size)) {
        const fit = mips.fitMaxSize(scratch, px, w, h, job.max_size) catch |err| return .{ .err = err };
        px = fit.pixels;
        w = fit.w;
        h = fit.h;
    }

    const out = encode_ktx.encode(scratch, px, w, h, .{
        .mode = job.mode,
        .quality = job.quality,
        .rdo_lambda = job.rdo_lambda,
        .normal_map = job.normal_map,
        .generate_mips = job.generate_mips,
        .max_size = 0, // already downscaled
        .srgb = job.srgb,
    }) catch |err| return .{ .err = err };

    const owned = std.heap.c_allocator.dupe(u8, out.ktx2) catch return .{ .err = error.OutOfMemory };
    return .{ .ktx2 = owned, .src_bytes = job.bytes.len };
}

fn workerMain(w: *Worker) void {
    const ctx = w.ctx;
    const scratch = w.arena.allocator();
    while (true) {
        const i = ctx.next.fetchAdd(1, .monotonic);
        if (i >= ctx.jobs.len) return;
        ctx.outs[i] = encodeOneJob(scratch, ctx.jobs[i]);
        _ = w.arena.reset(.retain_capacity);
        // One completion tick per finished encode (failures count too: the
        // join loop reclassifies them as skips). Concurrent workers may emit
        // out of order; the page keeps the max `done` it has seen.
        const d = ctx.done.fetchAdd(1, .monotonic) + 1;
        emitTexProgress(ctx.prog, d, ctx.total);
    }
}

/// Number of outer encode threads to use: at most `max_parallel_encodes` and
/// never more than there are images (or CPUs).
fn encodeThreadCount(n_images: usize) usize {
    if (n_images <= 1) return 1;
    const cpus = std.Thread.getCpuCount() catch 1;
    return @min(@min(cpus, max_parallel_encodes), n_images);
}

fn encodeTextures(
    a: std.mem.Allocator,
    loaded: parse.Loaded,
    p: preset.TextureParams,
    target: preset.Target,
    prog: ?ProgScope,
) !TexEncResult {
    return encodeTexturesWith(a, loaded, p, target, max_parallel_encodes, prog);
}

/// `thread_cap` exists for tests: 1 forces the original fully sequential path.
fn encodeTexturesWith(
    a: std.mem.Allocator,
    loaded: parse.Loaded,
    p: preset.TextureParams,
    target: preset.Target,
    thread_cap: usize,
    prog: ?ProgScope,
) !TexEncResult {
    var res: TexEncResult = .{};
    const base_mode = modeForFormat(p.format, target);
    res.mode_note = switch (p.format) {
        .astc => "etc1s (transcode to astc at load)",
        .bc7 => "uastc (transcode to bc7 at load)",
        .etc1s => "etc1s",
        .uastc => "uastc",
        .auto => switch (base_mode) {
            .etc1s => "etc1s",
            .uastc => "uastc",
        },
    };

    var gb = try geom.Builder.init(a, loaded.cdata);
    defer gb.deinit();

    var pending: std.ArrayList(PendingView) = .empty;

    // Per-image report rows, only when overrides exist (the default path stays
    // allocation-free and the report shape unchanged).
    var details: std.ArrayList(TextureImageOutcome) = .empty;
    const details_ptr: ?*std.ArrayList(TextureImageOutcome) = if (p.overrides.len > 0) &details else null;

    const images = geom.sl(c.cgltf_image, loaded.cdata.images, loaded.cdata.images_count);
    var n_threads = @min(thread_cap, encodeThreadCount(images.len));
    if (envOuterOverride()) |o| n_threads = @max(1, @min(o, images.len));
    if (n_threads <= 1) {
        try encodeImagesSequential(a, loaded.cdata, p, target, images, &gb, &pending, &res, details_ptr, prog);
    } else {
        try encodeImagesParallel(a, loaded.cdata, p, target, images, &gb, &pending, &res, n_threads, details_ptr, prog);
    }
    if (details_ptr != null) res.details = try details.toOwnedSlice(a);

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

/// One detail row for the textures report. `format` is the effective format
/// tag, or `"as-is"` for skipped images.
fn appendDetail(
    a: std.mem.Allocator,
    details: ?*std.ArrayList(TextureImageOutcome),
    index: u32,
    name: [*c]const u8,
    skipped: bool,
    format: []const u8,
) !void {
    const d = details orelse return;
    try d.append(a, .{
        .index = index,
        .name = try dupCStr(a, name),
        .skipped = skipped,
        .format = format,
    });
}

/// One progress tick for the textures step: `done/total` images disposed
/// (encoded or skipped), `pct` interpolated inside the step's span. Null
/// scope (unit tests calling the encode directly) is a no-op.
fn emitTexProgress(prog: ?ProgScope, done: u32, total: u32) void {
    const ps = prog orelse return;
    if (total == 0) return;
    notifySub(ps.opts, "textures", subPct(ps.index, ps.n_steps, done, total), .{
        .label = "texture",
        .done = done,
        .total = total,
    });
}

/// Original one-image-at-a-time loop, kept for the single-image fast path and
/// as the reference behaviour (same allocations in `a`, same view order).
fn encodeImagesSequential(
    a: std.mem.Allocator,
    cd: *c.cgltf_data,
    p: preset.TextureParams,
    target: preset.Target,
    images: []c.cgltf_image,
    gb: *geom.Builder,
    pending: *std.ArrayList(PendingView),
    res: *TexEncResult,
    details: ?*std.ArrayList(TextureImageOutcome),
    prog: ?ProgScope,
) !void {
    const total: u32 = @intCast(images.len);
    var done: u32 = 0;
    // Pin the global basisu pool to the historical default so the sequential
    // reference is independent of whatever a previous parallel call set.
    encode_ktx.setMaxThreads(8);
    for (images, 0..) |*im, idx| {
        const index: u32 = @intCast(idx);
        const eff = resolveTextureOverride(p, index, cStr(im.name), cStr(im.uri));
        if (eff.skip) {
            res.skipped += 1;
            res.mixed = true;
            // Untouched: buffer_view still points at the source bytes.
            try appendDetail(a, details, index, im.name, true, "as-is");
            done += 1;
            emitTexProgress(prog, done, total);
            continue;
        }
        if (eff.format != p.format) res.mixed = true;
        const bytes = embeddedImageBytes(cd, im) orelse {
            res.skipped += 1;
            try appendDetail(a, details, index, im.name, true, "as-is");
            done += 1;
            emitTexProgress(prog, done, total);
            continue;
        };
        var dec = decode.decodeRgba(a, bytes) orelse {
            res.skipped += 1;
            try appendDetail(a, details, index, im.name, true, "as-is");
            done += 1;
            emitTexProgress(prog, done, total);
            continue;
        };
        defer dec.deinit(a);

        const auto_normal = isNormalName(im.name);
        const eff_normal: bool = eff.normal_map orelse auto_normal;
        var px = dec.pixels;
        var w = dec.width;
        var h = dec.height;
        if (eff.max_size > 0 and (w > eff.max_size or h > eff.max_size)) {
            const fit = try mips.fitMaxSize(a, px, w, h, eff.max_size);
            px = fit.pixels;
            w = fit.w;
            h = fit.h;
        }

        const out = encode_ktx.encode(a, px, w, h, .{
            .mode = modeForFormat(eff.format, target),
            .quality = eff.quality,
            .rdo_lambda = p.rdo_lambda,
            .normal_map = if (eff.normal_map) |o| o else (auto_normal and p.normal_maps_renormalize),
            .generate_mips = eff.generate_mips,
            .max_size = 0, // already downscaled
            .srgb = !eff_normal,
        }) catch {
            res.skipped += 1;
            try appendDetail(a, details, index, im.name, true, "as-is");
            done += 1;
            emitTexProgress(prog, done, total);
            continue;
        };

        res.src_bytes += bytes.len;
        res.ktx_bytes += out.ktx2.len;
        const vi = try gb.addView(out.ktx2, 0);
        try pending.append(a, .{ .img = im, .view_idx = vi, .normal = eff_normal });
        try appendDetail(a, details, index, im.name, false, @tagName(eff.format));
        res.encoded += 1;
        done += 1;
        emitTexProgress(prog, done, total);
    }
}

/// Decode + encode up to `n_threads` images concurrently, then append the
/// buffer views in IMAGE order on the main thread (the builder is single
/// threaded, and output order must not depend on completion order).
fn encodeImagesParallel(
    a: std.mem.Allocator,
    cd: *c.cgltf_data,
    p: preset.TextureParams,
    target: preset.Target,
    images: []c.cgltf_image,
    gb: *geom.Builder,
    pending: *std.ArrayList(PendingView),
    res: *TexEncResult,
    n_threads: usize,
    details: ?*std.ArrayList(TextureImageOutcome),
    prog: ?ProgScope,
) !void {
    const Slot = union(enum) { skip, job: usize };
    var slots = try a.alloc(Slot, images.len);
    @memset(slots, .skip);

    var jobs: std.ArrayList(ImageJob) = .empty;
    for (images, 0..) |*im, i| {
        const eff = resolveTextureOverride(p, @intCast(i), cStr(im.name), cStr(im.uri));
        if (eff.skip) {
            res.mixed = true;
            continue; // slot stays .skip; counted in the join loop below
        }
        const bytes = embeddedImageBytes(cd, im) orelse continue;
        if (eff.format != p.format) res.mixed = true;
        const auto_normal = isNormalName(im.name);
        const eff_normal: bool = eff.normal_map orelse auto_normal;
        slots[i] = .{ .job = jobs.items.len };
        try jobs.append(a, .{
            .bytes = bytes,
            .mode = modeForFormat(eff.format, target),
            .quality = eff.quality,
            .max_size = eff.max_size,
            .generate_mips = eff.generate_mips,
            .normal_map = if (eff.normal_map) |o| o else (auto_normal and p.normal_maps_renormalize),
            .srgb = !eff_normal,
            .normal = eff_normal,
            .rdo_lambda = p.rdo_lambda,
        });
    }
    if (jobs.items.len == 0) {
        res.skipped += @intCast(images.len);
        if (details) |d| {
            for (images, 0..) |*im, i|
                try appendDetail(a, d, @intCast(i), im.name, true, "as-is");
        }
        // Nothing to encode: the step is already fully disposed.
        emitTexProgress(prog, @intCast(images.len), @intCast(images.len));
        return;
    }

    var ctx: ParCtx = .{
        .jobs = jobs.items,
        .outs = try a.alloc(EncOutcome, jobs.items.len),
        .prog = prog,
        .total = @intCast(images.len),
    };
    @memset(ctx.outs, .{});
    // Slots skipped up front (no embedded bytes, explicit skip) count as
    // disposed before the workers start, so `done` ends at `total`.
    const pre: u32 = @intCast(images.len - jobs.items.len);
    ctx.done.store(pre, .monotonic);
    emitTexProgress(prog, pre, ctx.total);
    // Encoder/transcoder init is a global one-time cost; do it before spawning
    // so workers don't serialise on it.
    _ = encode_ktx.init();

    const n_workers = @min(n_threads, jobs.items.len);
    // basisu's per-encode pool size is global state: set once here, before
    // the workers spawn — never per-encode. Default 8 is the measured
    // optimum (see max_parallel_encodes); ASSETTY_TEX_INNER overrides it.
    const inner: usize = envInnerOverride() orelse 8;
    encode_ktx.setMaxThreads(@intCast(inner));
    const workers = try a.alloc(Worker, n_workers);
    for (workers) |*w| w.* = .{ .ctx = &ctx, .arena = .init(std.heap.c_allocator) };

    const handles = try a.alloc(?std.Thread, n_workers);
    var spawned: usize = 0;
    for (workers) |*w| {
        handles[spawned] = std.Thread.spawn(.{}, workerMain, .{w}) catch {
            // Out of threads: do that share of the work inline instead.
            workerMain(w);
            continue;
        };
        spawned += 1;
    }
    for (handles[0..spawned]) |h| h.?.join();

    // Every worker is done and its KTX2 bytes already live in c_allocator, so
    // the scratch arenas can go before the views are appended.
    for (workers) |*w| w.arena.deinit();
    defer for (ctx.outs) |o| {
        if (o.ktx2.len > 0) std.heap.c_allocator.free(o.ktx2);
    };

    for (images, 0..) |*im, i| {
        const index: u32 = @intCast(i);
        const j = switch (slots[i]) {
            .skip => {
                res.skipped += 1;
                try appendDetail(a, details, index, im.name, true, "as-is");
                continue;
            },
            .job => |idx| idx,
        };
        const out = ctx.outs[j];
        if (out.err) |err| {
            switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => {
                    res.skipped += 1;
                    try appendDetail(a, details, index, im.name, true, "as-is");
                    continue;
                },
            }
        }
        res.src_bytes += out.src_bytes;
        res.ktx_bytes += out.ktx2.len;
        const vi = try gb.addView(out.ktx2, 0);
        try pending.append(a, .{ .img = im, .view_idx = vi, .normal = jobs.items[j].normal });
        try appendDetail(a, details, index, im.name, false, @tagName(resolveTextureOverride(p, index, cStr(im.name), cStr(im.uri)).format));
        res.encoded += 1;
    }
}

fn notify(opts: Options, step: []const u8, pct: f32) void {
    if (opts.progress) |cb| cb(opts.progress_ctx, step, pct, null);
}

fn notifySub(opts: Options, step: []const u8, pct: f32, sub: ProgressSub) void {
    if (opts.progress) |cb| cb(opts.progress_ctx, step, pct, sub);
}

/// `pct` for `done/total` inside step `index` of `n_steps`: linearly between
/// that step's start and the next step's.
fn subPct(index: usize, n_steps: usize, done: u32, total: u32) f32 {
    if (n_steps == 0 or total == 0) return 0;
    const base: f32 = @as(f32, @floatFromInt(index)) / @as(f32, @floatFromInt(n_steps));
    const span: f32 = 1.0 / @as(f32, @floatFromInt(n_steps));
    return base + span * @as(f32, @floatFromInt(done)) / @as(f32, @floatFromInt(total));
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
    const total = r.nodes + r.meshes + r.materials + r.textures + r.images + r.samplers + r.animations;
    if (total == 0) return "nothing to remove";
    const base = try std.fmt.allocPrint(
        a,
        "removed {d} node(s), {d} mesh(es), {d} mat(s), {d} tex(s), {d} img(s), {d} sampler(s); model-level; cdata sync pending",
        .{ r.nodes, r.meshes, r.materials, r.textures, r.images, r.samplers },
    );
    if (r.animations == 0) return base;
    return std.fmt.allocPrint(a, "{s}; stripped {d} animation(s)", .{ base, r.animations });
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

fn progressCb(ctx: ?*anyopaque, step: []const u8, pct: f32, sub: ?ProgressSub) void {
    _ = sub;
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

    // Timings: every step measured, total covers load+steps+write.
    var step_secs: f64 = 0;
    for (rep.steps) |st| {
        try testing.expect(st.secs >= 0);
        step_secs += st.secs;
    }
    try testing.expect(rep.total_secs >= 0);
    try testing.expect(rep.total_secs >= step_secs - 1e-3);

    // Before/after stats are populated (box has geometry).
    try testing.expect(rep.before.triangles > 0);
    try testing.expect(rep.before.vertices > 0);
    try testing.expectEqual(rep.before.triangles, rep.after.triangles);
    try testing.expect(rep.after.disk_total > 0);
    // default prune keeps the fixture's animation
    try testing.expectEqual(@as(u64, 1), rep.before.animations);
    try testing.expectEqual(@as(u64, 1), rep.after.animations);

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

test "run: prune strips animations end to end" {
    const io = testing.io;
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // quantize BEFORE prune: animation-driven accessors are quantized first,
    // stripping later must still drop the animations without a panic.
    const steps = [_]preset.Step{ .{ .quantize = .{} }, .{ .prune = .{ .animations = false } } };
    const rep = try run(io, a, "test/fixtures/box.glb", .{
        .preset = .{ .name = "strip", .target = .desktop, .steps = &steps },
        .out_path = ".zig-cache/pipeline_runner_test_strip.glb",
    });
    defer std.Io.Dir.cwd().deleteFile(io, ".zig-cache/pipeline_runner_test_strip.glb") catch {};

    // the fixture is actually animated — otherwise this test proves nothing
    try testing.expectEqual(@as(u64, 1), rep.before.animations);
    try testing.expectEqual(@as(u64, 0), rep.after.animations);
    try testing.expect(std.mem.indexOf(u8, rep.steps[1].note, "stripped 1 animation") != null);

    var reloaded = try parse.loadFile(io, a, ".zig-cache/pipeline_runner_test_strip.glb");
    defer reloaded.deinit();
    try testing.expectEqual(@as(usize, 0), reloaded.asset.animations.len);
    // writer emitted no animations key at all
    const raw = try std.Io.Dir.cwd().readFileAlloc(io, ".zig-cache/pipeline_runner_test_strip.glb", a, .limited(16 << 20));
    try testing.expect(std.mem.indexOf(u8, raw, "\"animations\"") == null);
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

fn testNowMs() i64 {
    // Portable monotonic clock (`std.c.clock_gettime` is unavailable on
    // Windows; the old `std.time.milliTimestamp` is gone in 0.17).
    return std.Io.Timestamp.now(std.testing.io, .awake).toMilliseconds();
}

/// Minimal GLB with `pngs.len` embedded PNG images and no geometry.
fn testGlbWithImages(a: std.mem.Allocator, pngs: []const []const u8) ![]u8 {
    const names = try a.alloc([]const u8, pngs.len);
    for (names, 0..) |*n, i| n.* = try std.fmt.allocPrint(a, "tex{d}", .{i});
    return testGlbWithNamedImages(a, pngs, names);
}

fn testGlbWithNamedImages(a: std.mem.Allocator, pngs: []const []const u8, names: []const []const u8) ![]u8 {
    var offs = try a.alloc(usize, pngs.len);
    var bin_len: usize = 0;
    for (pngs, 0..) |png, i| {
        bin_len = std.mem.alignForward(usize, bin_len, 4);
        offs[i] = bin_len;
        bin_len += png.len;
    }
    const bin_padded = std.mem.alignForward(usize, bin_len, 4);

    var js: std.ArrayList(u8) = .empty;
    try js.appendSlice(a, "{\"asset\":{\"version\":\"2.0\"},\"images\":[");
    for (pngs, 0..) |_, i| {
        if (i != 0) try js.append(a, ',');
        try js.appendSlice(a, try std.fmt.allocPrint(
            a,
            "{{\"name\":\"{s}\",\"bufferView\":{d},\"mimeType\":\"image/png\"}}",
            .{ names[i], i },
        ));
    }
    try js.appendSlice(a, "],\"bufferViews\":[");
    for (pngs, 0..) |png, i| {
        if (i != 0) try js.append(a, ',');
        try js.appendSlice(a, try std.fmt.allocPrint(
            a,
            "{{\"buffer\":0,\"byteOffset\":{d},\"byteLength\":{d}}}",
            .{ offs[i], png.len },
        ));
    }
    try js.appendSlice(a, try std.fmt.allocPrint(
        a,
        "],\"buffers\":[{{\"byteLength\":{d}}}]}}",
        .{bin_padded},
    ));

    const json_padded = std.mem.alignForward(usize, js.items.len, 4);
    const out = try a.alloc(u8, 12 + 8 + json_padded + 8 + bin_padded);
    @memset(out, 0);
    std.mem.writeInt(u32, out[0..4], 0x46546C67, .little); // "glTF"
    std.mem.writeInt(u32, out[4..8], 2, .little);
    std.mem.writeInt(u32, out[8..12], @intCast(out.len), .little);
    std.mem.writeInt(u32, out[12..16], @intCast(json_padded), .little);
    std.mem.writeInt(u32, out[16..20], 0x4E4F534A, .little); // "JSON"
    @memset(out[20 .. 20 + json_padded], ' ');
    @memcpy(out[20 .. 20 + js.items.len], js.items);
    const bin_hdr = 20 + json_padded;
    std.mem.writeInt(u32, out[bin_hdr..][0..4], @intCast(bin_padded), .little);
    std.mem.writeInt(u32, out[bin_hdr + 4 ..][0..4], 0x004E4942, .little); // "BIN"
    for (pngs, 0..) |png, i| {
        const dst = out[bin_hdr + 8 + offs[i] ..][0..png.len];
        @memcpy(dst, png);
    }
    return out;
}

fn testGradient(a: std.mem.Allocator, w: u32, h: u32, seed: u8) ![]u8 {
    const px = try a.alloc(u8, @as(usize, w) * h * 4);
    for (0..h) |y| {
        for (0..w) |x| {
            const o = (y * w + x) * 4;
            px[o] = @intCast((x * 255) / @max(w - 1, 1));
            px[o + 1] = @intCast((y * 255) / @max(h - 1, 1));
            px[o + 2] = seed;
            px[o + 3] = 255;
        }
    }
    return px;
}

// Every encoded image must carry a KTX2 view, in image order, with strictly
// increasing BIN offsets, and (both paths pin the basisu pool to 8 threads,
// and basisu output is thread-count deterministic anyway) bytes identical to
// the sequential result.
test "textures: progress carries per-image done/total" {
    const io = testing.io;
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // Three small images: fast, but enough to tick the counter.
    const dim: u32 = 64;
    const pngs = try a.alloc([]const u8, 3);
    for (pngs, 0..) |*png, i| {
        const px = try testGradient(a, dim, dim, @intCast(41 * (i + 1)));
        png.* = try decode.encodePngRgba(a, px, dim, dim);
    }
    const in_path = ".zig-cache/pipeline_runner_texprog.glb";
    const out_path = ".zig-cache/pipeline_runner_texprog.opt.glb";
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = in_path, .data = try testGlbWithImages(a, pngs) });
    defer std.Io.Dir.cwd().deleteFile(io, in_path) catch {};
    defer std.Io.Dir.cwd().deleteFile(io, out_path) catch {};

    const Capture = struct {
        // Plain atomics: the parallel encode loop reports from workers.
        subs: std.atomic.Value(u32) = .init(0),
        total: std.atomic.Value(u32) = .init(0),
        saw_final: std.atomic.Value(bool) = .init(false),
        saw_label: std.atomic.Value(bool) = .init(false),
        bad_range: std.atomic.Value(bool) = .init(false),
        fn cb(ctx: ?*anyopaque, step: []const u8, pct: f32, sub: ?ProgressSub) void {
            _ = pct;
            if (!std.mem.eql(u8, step, "textures")) return;
            const s = sub orelse return;
            const self: *@This() = @ptrCast(@alignCast(ctx.?));
            _ = self.subs.fetchAdd(1, .monotonic);
            self.total.store(s.total, .monotonic);
            if (s.done > s.total) self.bad_range.store(true, .monotonic);
            if (s.done == s.total) self.saw_final.store(true, .monotonic);
            if (std.mem.eql(u8, s.label, "texture")) self.saw_label.store(true, .monotonic);
        }
    };
    var cap: Capture = .{};

    const steps = [_]preset.Step{.{ .textures = .{} }};
    const rep = try run(io, a, in_path, .{
        .preset = .{ .name = "texprog", .target = .mobile, .steps = &steps },
        .out_path = out_path,
        .progress_ctx = &cap,
        .progress = Capture.cb,
    });
    try testing.expect(rep.steps[0].applied);

    // At least one textures tick carried a sub counter that stayed in range
    // and ran to completion (3/3) with the stable "texture" label.
    try testing.expect(cap.subs.load(.monotonic) >= 3);
    try testing.expectEqual(@as(u32, 3), cap.total.load(.monotonic));
    try testing.expect(!cap.bad_range.load(.monotonic));
    try testing.expect(cap.saw_final.load(.monotonic));
    try testing.expect(cap.saw_label.load(.monotonic));
}

test "textures overrides: resolve order and matching" {
    const ovs = [_]preset.TextureOverride{
        .{ .image = 1, .format = .uastc, .quality = 200 },
        .{ .name = "BASE", .max_size = 512 },
        .{ .image = 1, .quality = 64 }, // last match wins for image 1
    };
    const p: preset.TextureParams = .{ .format = .etc1s, .quality = 128, .overrides = &ovs };

    // Image 1: #0 sets uastc/200, #2 overwrites quality → uastc/64.
    const e1 = resolveTextureOverride(p, 1, "tex1", null);
    try testing.expect(!e1.skip);
    try testing.expectEqual(preset.TextureFormat.uastc, e1.format);
    try testing.expectEqual(@as(u8, 64), e1.quality);
    try testing.expectEqual(@as(u32, 0), e1.max_size);

    // Name match is case-insensitive; image 7 is only hit by #1.
    const e2 = resolveTextureOverride(p, 7, "BaseColor_map", null);
    try testing.expectEqual(preset.TextureFormat.etc1s, e2.format);
    try testing.expectEqual(@as(u32, 512), e2.max_size);

    // Unmatched image keeps the base params.
    const e3 = resolveTextureOverride(p, 3, "other", "other.png");
    try testing.expectEqual(preset.TextureFormat.etc1s, e3.format);
    try testing.expectEqual(@as(u8, 128), e3.quality);

    // An item with neither selector matches nothing.
    const no_sel = [_]preset.TextureOverride{.{ .quality = 10 }};
    const pn: preset.TextureParams = .{ .quality = 128, .overrides = &no_sel };
    try testing.expectEqual(@as(u8, 128), resolveTextureOverride(pn, 0, "tex0", null).quality);

    // image+name in one item: both must match.
    const both = [_]preset.TextureOverride{.{ .image = 1, .name = "tex", .quality = 10 }};
    const pb: preset.TextureParams = .{ .quality = 128, .overrides = &both };
    try testing.expectEqual(@as(u8, 128), resolveTextureOverride(pb, 1, "other", null).quality);
    try testing.expectEqual(@as(u8, 128), resolveTextureOverride(pb, 2, "tex2", null).quality);
    try testing.expectEqual(@as(u8, 10), resolveTextureOverride(pb, 1, "tex1", null).quality);

    // skip follows the same last-wins rule as every other field.
    const skips = [_]preset.TextureOverride{ .{ .image = 0, .skip = true }, .{ .image = 0, .max_size = 64 } };
    const ps: preset.TextureParams = .{ .overrides = &skips };
    const es = resolveTextureOverride(ps, 0, null, null);
    try testing.expect(!es.skip);
    try testing.expectEqual(@as(u32, 64), es.max_size);
}

test "textures overrides: skip keeps source bytes, name override changes format" {
    const io = testing.io;
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const dim: u32 = 512;
    const pngs = try a.alloc([]const u8, 2);
    for (pngs, 0..) |*png, i| {
        const px = try testGradient(a, dim, dim, @intCast(31 * (i + 1)));
        png.* = try decode.encodePngRgba(a, px, dim, dim);
    }
    const names = [_][]const u8{ "albedo", "BaseColor_map" };

    const in_path = ".zig-cache/pipeline_runner_tex_ov.glb";
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = in_path, .data = try testGlbWithNamedImages(a, pngs, &names) });
    defer std.Io.Dir.cwd().deleteFile(io, in_path) catch {};

    // Baseline: no overrides, sequential.
    const base_params: preset.TextureParams = .{ .quality = 64, .generate_mips = false };
    var base_loaded = try parse.loadFile(io, a, in_path);
    defer base_loaded.deinit();
    const base = try encodeTexturesWith(a, base_loaded, base_params, .mobile, 1, null);
    try testing.expectEqual(@as(u32, 2), base.encoded);
    try testing.expectEqual(@as(u32, 0), base.skipped);
    try testing.expect(!base.mixed);
    try testing.expectEqual(@as(usize, 0), base.details.len);

    // Overrides: skip image 0, uastc + downscale for the basecolor image.
    const ovs = [_]preset.TextureOverride{
        .{ .image = 0, .skip = true },
        .{ .name = "basecolor", .format = .uastc, .max_size = 128 },
    };
    const ov_params: preset.TextureParams = .{ .quality = 64, .generate_mips = false, .overrides = &ovs };
    var ov_loaded = try parse.loadFile(io, a, in_path);
    defer ov_loaded.deinit();
    const ov = try encodeTexturesWith(a, ov_loaded, ov_params, .mobile, 1, null);
    try testing.expectEqual(@as(u32, 1), ov.encoded);
    try testing.expectEqual(@as(u32, 1), ov.skipped);
    try testing.expect(ov.mixed);
    try testing.expectEqual(@as(usize, 2), ov.details.len);
    try testing.expect(ov.details[0].skipped);
    try testing.expectEqualStrings("as-is", ov.details[0].format);
    try testing.expect(!ov.details[1].skipped);
    try testing.expectEqualStrings("uastc", ov.details[1].format);
    try testing.expectEqualStrings("BaseColor_map", ov.details[1].name.?);

    // Skipped image 0 is untouched: still PNG, bytes identical to the source.
    const ov_images = geom.sl(c.cgltf_image, ov_loaded.cdata.images, ov_loaded.cdata.images_count);
    try testing.expectEqualStrings("image/png", std.mem.span(ov_images[0].mime_type.?));
    const kept: *const c.cgltf_buffer_view = @ptrCast(ov_images[0].buffer_view.?);
    try testing.expectEqualSlices(u8, pngs[0], geom.viewData(kept).?);

    // Image 1 encoded as uastc, downscaled to max_size.
    try testing.expectEqualStrings("image/ktx2", std.mem.span(ov_images[1].mime_type.?));
    const enc_view: *const c.cgltf_buffer_view = @ptrCast(ov_images[1].buffer_view.?);
    const hdr = formats.parseHeader(geom.viewData(enc_view).?) orelse return error.TestUnexpectedResult;
    try testing.expectEqual(@as(u32, 128), hdr.width);
    try testing.expectEqual(@as(u32, 128), hdr.height);

    // Parallel path agrees with the sequential reference.
    var par_loaded = try parse.loadFile(io, a, in_path);
    defer par_loaded.deinit();
    const par = try encodeTexturesWith(a, par_loaded, ov_params, .mobile, 4, null);
    try testing.expectEqual(ov.encoded, par.encoded);
    try testing.expectEqual(ov.skipped, par.skipped);
    try testing.expectEqual(ov.details.len, par.details.len);
    for (ov.details, par.details) |x, y| {
        try testing.expectEqual(x.index, y.index);
        try testing.expectEqual(x.skipped, y.skipped);
        try testing.expectEqualStrings(x.format, y.format);
    }
    const par_images = geom.sl(c.cgltf_image, par_loaded.cdata.images, par_loaded.cdata.images_count);
    const par_view: *const c.cgltf_buffer_view = @ptrCast(par_images[1].buffer_view.?);
    try testing.expectEqualSlices(u8, geom.viewData(enc_view).?, geom.viewData(par_view).?);
}

test "textures: 4 images encode in parallel, image order preserved" {
    const io = testing.io;
    var arena: std.heap.ArenaAllocator = .init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const dim: u32 = 1024;
    const pngs = try a.alloc([]const u8, 4);
    for (pngs, 0..) |*png, i| {
        const px = try testGradient(a, dim, dim, @intCast(63 * (i + 1)));
        png.* = try decode.encodePngRgba(a, px, dim, dim);
    }

    const in_path = ".zig-cache/pipeline_runner_tex4.glb";
    const out_path = ".zig-cache/pipeline_runner_tex4.opt.glb";
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = in_path, .data = try testGlbWithImages(a, pngs) });
    defer std.Io.Dir.cwd().deleteFile(io, in_path) catch {};
    defer std.Io.Dir.cwd().deleteFile(io, out_path) catch {};

    // Sequential reference, in memory (thread cap 1 = the legacy path).
    const tex_params: preset.TextureParams = .{ .quality = 64, .generate_mips = false };
    var seq_loaded = try parse.loadFile(io, a, in_path);
    defer seq_loaded.deinit();
    const seq_t0 = testNowMs();
    const seq = try encodeTexturesWith(a, seq_loaded, tex_params, .mobile, 1, null);
    const seq_ms = testNowMs() - seq_t0;
    try testing.expectEqual(@as(u32, 4), seq.encoded);
    try testing.expectEqual(@as(u32, 0), seq.skipped);

    // End-to-end through the real pipeline (default thread cap): all four
    // encode, none skipped. The written file drops them again — they are not
    // referenced by any material — so the view checks below use the in-memory
    // graphs, which is where the encode step actually writes.
    const steps = [_]preset.Step{.{ .textures = tex_params }};
    const rep = try run(io, a, in_path, .{
        .preset = .{ .name = "tex4", .target = .mobile, .steps = &steps },
        .out_path = out_path,
    });
    try testing.expect(rep.steps[0].applied);
    try testing.expect(std.mem.indexOf(u8, rep.steps[0].note, "4 encoded, 0 skipped") != null);

    // Same images, in parallel, without the writer in the way.
    var par_loaded = try parse.loadFile(io, a, in_path);
    defer par_loaded.deinit();
    const par_t0 = testNowMs();
    const par = try encodeTexturesWith(a, par_loaded, tex_params, .mobile, 4, null);
    const par_ms = testNowMs() - par_t0;
    // Informational only (the CI box is not quiet), never asserted.
    std.debug.print("4x1024 encode: seq {d} ms, par {d} ms\n", .{ seq_ms, par_ms });
    try testing.expectEqual(seq.encoded, par.encoded);
    try testing.expectEqual(seq.skipped, par.skipped);
    try testing.expectEqual(seq.src_bytes, par.src_bytes);
    try testing.expectEqual(seq.ktx_bytes, par.ktx_bytes);

    const seq_images = geom.sl(c.cgltf_image, seq_loaded.cdata.images, seq_loaded.cdata.images_count);
    const par_images = geom.sl(c.cgltf_image, par_loaded.cdata.images, par_loaded.cdata.images_count);
    try testing.expectEqual(@as(usize, 4), seq_images.len);
    try testing.expectEqual(@as(usize, 4), par_images.len);

    var prev_offset: usize = 0;
    for (par_images, seq_images, 0..) |*im, *ref, i| {
        try testing.expect(im.buffer_view != null);
        const mime = std.mem.span(im.mime_type orelse return error.TestUnexpectedResult);
        try testing.expectEqualStrings("image/ktx2", mime);

        const view: *const c.cgltf_buffer_view = @ptrCast(im.buffer_view.?);
        const off: usize = @intCast(view.offset);
        if (i > 0) try testing.expect(off > prev_offset);
        prev_offset = off;

        const ref_view: *const c.cgltf_buffer_view = @ptrCast(ref.buffer_view.?);
        try testing.expectEqualSlices(u8, geom.viewData(ref_view).?, geom.viewData(view).?);
    }
}
