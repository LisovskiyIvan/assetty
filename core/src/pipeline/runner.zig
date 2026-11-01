// OWNED BY: subagent O2 (pipeline runner). Replace this file entirely. Do not change the public API below.
const std = @import("std");
const preset = @import("preset.zig");
const stats = @import("../stats.zig");

pub const StepStatus = struct {
    kind: []const u8, // "prune", "dedup", ...
    applied: bool,
    note: []const u8 = "", // e.g. "not implemented, skipped"
};

pub const Report = struct {
    steps: []const StepStatus,
    before: stats.Stats,
    after: stats.Stats,
    /// allocation: arena-owned, no deinit needed
};

pub const ProgressFn = *const fn (ctx: ?*anyopaque, step: []const u8, pct: f32) void;

pub const Options = struct {
    preset: preset.Preset,
    out_path: []const u8,
    progress_ctx: ?*anyopaque = null,
    progress: ?ProgressFn = null,
};

/// Load -> execute preset steps -> write out_path -> stats before/after.
pub fn run(io: std.Io, a: std.mem.Allocator, in_path: []const u8, opts: Options) !Report {
    _ = io;
    _ = a;
    _ = in_path;
    _ = opts;
    return error.NotImplemented;
}
