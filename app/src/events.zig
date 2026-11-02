//! Typed events pushed from Zig to the page (`window.nanoui.on("<name>")`).
const nanoui = @import("nanoui");

/// One pipeline step finished (or started): `pct` is 0..1.
pub const ProgressPayload = struct {
    step: []const u8,
    pct: f32,
};
pub const Progress = nanoui.Event("progress", ProgressPayload);

/// A line for the app's log pane.
pub const LogPayload = struct {
    line: []const u8,
};
pub const Log = nanoui.Event("log", LogPayload);
