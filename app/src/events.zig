//! Typed events pushed from Zig to the page (`window.nanoui.on("<name>")`).
//!
//! Pages (and their typed IPC) exist where nanoui has a webview (macOS,
//! Windows, Linux since 0.12's WebKitGTK backend): elsewhere `Call` and
//! `Event` are `void`. The payload structs below stay shared — tests and the
//! background-job code construct them on every platform — while the `Event`
//! bindings degrade to a no-op `emit` where pages don't exist.
const std = @import("std");
const nanoui = @import("nanoui");
const json = @import("json.zig");

const has_page = nanoui.Call != void;

fn Ev(comptime name: []const u8, comptime P: type) type {
    if (has_page) return nanoui.Event(name, P);
    return struct {
        pub fn emit(_: *nanoui.Window, _: P) void {}
        pub fn broadcast(_: *nanoui.App, _: P) void {}
    };
}

/// One pipeline step finished (or started): `pct` is 0..1. `sub` is present
/// only for steps that report finer-grained progress (the textures step's
/// per-image counter); it is omitted from the JSON entirely when null, so
/// payloads without it stay byte-identical to before.
pub const ProgressPayload = struct {
    step: []const u8,
    pct: f32,
    sub: ?ProgressSub = null,

    pub fn jsonStringify(self: ProgressPayload, jws: anytype) !void {
        // `step`/`pct` go through std.json, exactly as the derived
        // serialization did before `sub` existed; `sub` is appended only
        // when present, so sub-less payloads keep today's wire shape.
        const w = jws.writer;
        try w.writeAll("{\"step\":");
        try std.json.Stringify.encodeJsonString(self.step, .{}, w);
        try w.writeAll(",\"pct\":");
        try std.json.Stringify.value(self.pct, .{}, w);
        if (self.sub) |s| {
            try w.writeAll(",\"sub\":{\"label\":");
            try std.json.Stringify.encodeJsonString(s.label, .{}, w);
            try w.print(",\"done\":{d},\"total\":{d}}}", .{ s.done, s.total });
        } else {
            try w.writeByte('}');
        }
    }
};

/// Finer-grained progress inside one step: `label` is a stable ASCII token
/// ("texture") the page maps to a localized frame.
pub const ProgressSub = struct {
    label: []const u8,
    done: u32,
    total: u32,
};
pub const Progress = Ev("progress", ProgressPayload);

/// A line for the app's log pane.
pub const LogPayload = struct {
    line: []const u8,
};
pub const Log = Ev("log", LogPayload);

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
pub const OptimizeDone = Ev("optimizeDone", OptimizeDonePayload);

/// A background `textureEncode` finished: `{"ok":true,"index":N,
/// "ktx2_size":..,"psnr":..,"vram_after":..,"before_png":"<abs>.png",
/// "after_png":"<abs>.png","width":W,"height":H,"mip_levels":N,
/// "format":"ETC1S","settings":{"format":"etc1s","quality":128,
/// "max_size":0,"generate_mips":true}}` or `{"ok":false,"index":N,
/// "error":".."}`.
///
/// `before_png`/`after_png` are the source pixels and the pixels decoded back
/// from the KTX2, both full resolution, written next to `opt_*.glb` in
/// `.zig-cache/assetty-app/`; `width`/`height` are the source dimensions.
pub const TextureEncodeDonePayload = struct {
    ok: bool,
    index: u32,
    ktx2_size: u64 = 0,
    psnr: f32 = 0,
    vram_after: u64 = 0,
    before_png: ?[]const u8 = null,
    after_png: ?[]const u8 = null,
    width: u32 = 0,
    height: u32 = 0,
    mip_levels: u32 = 0,
    /// `out.format_label` from basisu: "ETC1S", "UASTC", "BC7", ...
    format: ?[]const u8 = null,
    /// The settings the encoder actually ran with.
    settings: Settings = .{},
    @"error": ?[]const u8 = null,

    pub const Settings = struct {
        /// "etc1s" or "uastc".
        format: []const u8 = "etc1s",
        quality: u8 = 0,
        /// 0 = keep the source size.
        max_size: u32 = 0,
        generate_mips: bool = false,
    };

    pub fn jsonStringify(self: TextureEncodeDonePayload, jws: anytype) !void {
        const w = jws.writer;
        if (self.ok) {
            try w.print(
                "{{\"ok\":true,\"index\":{d},\"ktx2_size\":{d},\"psnr\":{d:.2},\"vram_after\":{d},\"before_png\":",
                .{ self.index, self.ktx2_size, self.psnr, self.vram_after },
            );
            try json.jsonStrOpt(w, self.before_png);
            try w.writeAll(",\"after_png\":");
            try json.jsonStrOpt(w, self.after_png);
            try w.print(",\"width\":{d},\"height\":{d},\"mip_levels\":{d},\"format\":", .{
                self.width, self.height, self.mip_levels,
            });
            try json.jsonStr(w, self.format orelse "");
            try w.writeAll(",\"settings\":{\"format\":");
            try json.jsonStr(w, self.settings.format);
            try w.print(",\"quality\":{d},\"max_size\":{d},\"generate_mips\":{s}", .{
                self.settings.quality,
                self.settings.max_size,
                if (self.settings.generate_mips) "true" else "false",
            });
            try w.writeAll("}}"); // close settings, close payload
        } else {
            try w.print("{{\"ok\":false,\"index\":{d},\"error\":", .{self.index});
            try json.jsonStr(w, self.@"error" orelse "encode failed");
            try w.writeByte('}');
        }
    }
};
pub const TextureEncodeDone = Ev("textureEncodeDone", TextureEncodeDonePayload);

/// A background `texturePreview` finished: `{"ok":true,"index":N,
/// "b64":"<base64 PNG>","width":W,"height":H}` or `{"ok":false,"index":N,
/// "error":".."}`. The preview is downscaled so the long side is at most
/// `backend.preview_max_dim` (1024) to keep the IPC message small.
pub const TexturePreviewDonePayload = struct {
    ok: bool,
    index: u32,
    b64: ?[]const u8 = null,
    width: u32 = 0,
    height: u32 = 0,
    @"error": ?[]const u8 = null,

    pub fn jsonStringify(self: TexturePreviewDonePayload, jws: anytype) !void {
        const w = jws.writer;
        if (self.ok) {
            try w.print("{{\"ok\":true,\"index\":{d},\"b64\":", .{self.index});
            try json.jsonStr(w, self.b64 orelse "");
            try w.print(",\"width\":{d},\"height\":{d}}}", .{ self.width, self.height });
        } else {
            try w.print("{{\"ok\":false,\"index\":{d},\"error\":", .{self.index});
            try json.jsonStr(w, self.@"error" orelse "preview failed");
            try w.writeByte('}');
        }
    }
};
pub const TexturePreviewDone = Ev("texturePreviewDone", TexturePreviewDonePayload);

/// A background `exportTo` finished: `{"ok":true,"src":"..","dst":".."}` or
/// `{"ok":false,"error":".."}`. The copy is byte-identical; the source the
/// pipeline ran on is never modified.
pub const ExportDonePayload = struct {
    ok: bool,
    src: ?[]const u8 = null,
    dst: ?[]const u8 = null,
    @"error": ?[]const u8 = null,

    pub fn jsonStringify(self: ExportDonePayload, jws: anytype) !void {
        const w = jws.writer;
        if (self.ok) {
            try w.writeAll("{\"ok\":true,\"src\":");
            try json.jsonStr(w, self.src orelse "");
            try w.writeAll(",\"dst\":");
            try json.jsonStr(w, self.dst orelse "");
            try w.writeByte('}');
        } else {
            try w.writeAll("{\"ok\":false,\"error\":");
            try json.jsonStr(w, self.@"error" orelse "export failed");
            try w.writeByte('}');
        }
    }
};
pub const ExportDone = Ev("exportDone", ExportDonePayload);
