const std = @import("std");

pub const Info = struct { width: u32, height: u32, components: u32 };

extern fn basset_image_info(data: [*]const u8, len: c_int, w: *c_int, h: *c_int, comp: *c_int) c_int;

/// Header-only probe (no pixel decode): PNG/JPG/...
pub fn infoFromMemory(bytes: []const u8) ?Info {
    if (bytes.len == 0) return null;
    var w: c_int = 0;
    var h: c_int = 0;
    var comp: c_int = 0;
    if (basset_image_info(bytes.ptr, @intCast(bytes.len), &w, &h, &comp) == 0) return null;
    if (w <= 0 or h <= 0) return null;
    return .{
        .width = @intCast(w),
        .height = @intCast(h),
        .components = @intCast(@max(comp, 1)),
    };
}

test "infoFromMemory invalid" {
    try std.testing.expect(infoFromMemory("nope") == null);
}
