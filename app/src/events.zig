//! Typed events pushed from Zig to the page (`window.nanoui.on("<name>")`).
const nanoui = @import("nanoui");
const json = @import("json.zig");

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

/// A background `optimize`/`optimizeCustom` finished: `{"ok":true,
/// "out_path":"..","report":<report>}` or `{"ok":false,"error":".."}`.
/// `report` is the same object `assetty optimize --json` prints, emitted
/// verbatim (hence `json.Raw`, not a string).
pub const OptimizeDonePayload = struct {
    ok: bool,
    out_path: ?[]const u8 = null,
    report: ?json.Raw = null,
    @"error": ?[]const u8 = null,

    pub fn jsonStringify(self: OptimizeDonePayload, jws: anytype) !void {
        const w = jws.writer;
        if (self.ok) {
            try w.writeAll("{\"ok\":true,\"out_path\":");
            try json.jsonStr(w, self.out_path orelse "");
            try w.writeAll(",\"report\":");
            try w.writeAll(if (self.report) |r| r.text else "null");
            try w.writeByte('}');
        } else {
            try w.writeAll("{\"ok\":false,\"error\":");
            try json.jsonStr(w, self.@"error" orelse "optimize failed");
            try w.writeByte('}');
        }
    }
};
pub const OptimizeDone = nanoui.Event("optimizeDone", OptimizeDonePayload);

/// A background `textureEncode` finished: `{"ok":true,"index":N,
/// "ktx2_size":..,"psnr":..,"vram_after":..}` or `{"ok":false,"index":N,
/// "error":".."}`.
pub const TextureEncodeDonePayload = struct {
    ok: bool,
    index: u32,
    ktx2_size: u64 = 0,
    psnr: f32 = 0,
    vram_after: u64 = 0,
    @"error": ?[]const u8 = null,

    pub fn jsonStringify(self: TextureEncodeDonePayload, jws: anytype) !void {
        const w = jws.writer;
        if (self.ok) {
            try w.print(
                "{{\"ok\":true,\"index\":{d},\"ktx2_size\":{d},\"psnr\":{d:.2},\"vram_after\":{d}}}",
                .{ self.index, self.ktx2_size, self.psnr, self.vram_after },
            );
        } else {
            try w.print("{{\"ok\":false,\"index\":{d},\"error\":", .{self.index});
            try json.jsonStr(w, self.@"error" orelse "encode failed");
            try w.writeByte('}');
        }
    }
};
pub const TextureEncodeDone = nanoui.Event("textureEncodeDone", TextureEncodeDonePayload);
