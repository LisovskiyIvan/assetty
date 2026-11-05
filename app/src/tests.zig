//! `zig build test` entry point for the app: backend impls and JSON writers.
const std = @import("std");

test {
    _ = @import("json.zig");
    _ = @import("assets.zig");
    _ = @import("update.zig");
    _ = @import("backend.zig");
}
