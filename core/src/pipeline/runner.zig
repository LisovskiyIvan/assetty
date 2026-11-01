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
            // Not wired yet; the progress callback still fires for them.
            .weld, .join, .quantize, .simplify, .textures => .{
                .kind = kind,
                .applied = false,
                .note = "not implemented, skipped",
            },
        };
    }

    // ---- 3. serialize + write --------------------------------------------
    // cgltf data (and its mmapped bytes) must outlive the serialization call.
    const bytes = try write.serialize(a, loaded.cdata, loaded.map);
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = opts.out_path, .data = bytes });
    notify(opts, "write", 1.0);

    // ---- 4. after stats ---------------------------------------------------
    // Model-level fields come from the processed model (spec-correct), while
    // byte counts come from the file we just wrote (what actually ships).
    var after = try stats.compute(a, asset);
    try dupImageNames(a, &after);

    var out_loaded = try parse.loadFile(io, a, opts.out_path);
    defer out_loaded.deinit();

    var scratch = std.heap.ArenaAllocator.init(a);
    defer scratch.deinit();
    const out_st = try stats.compute(scratch.allocator(), out_loaded.asset);
    after.disk_json = out_st.disk_json;
    after.disk_bin = out_st.disk_bin;
    after.disk_total = out_st.disk_total;

    return .{ .steps = steps, .before = before, .after = after };
}

fn notify(opts: Options, step: []const u8, pct: f32) void {
    if (opts.progress) |cb| cb(opts.progress_ctx, step, pct);
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

test "run skips unimplemented steps" {
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
    try testing.expect(!rep.steps[0].applied);
    try testing.expectEqualStrings("not implemented, skipped", rep.steps[0].note);
    try testing.expectEqualStrings("textures", rep.steps[1].kind);
    try testing.expect(!rep.steps[1].applied);
}
