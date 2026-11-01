const std = @import("std");
// OWNED BY: subagent O4 (meshopt quantize/simplify). Replace entirely. Public API fixed.
const c = @import("cgltf");

pub const Options = struct {
    position_bits: u5 = 14,
    uv_bits: u5 = 12,
    normal_oct: bool = true,
    /// quantize in place: rewrite accessors as normalized u16/u8 (valid core
    /// glTF, no EXT_meshopt_compression yet)
    in_place: bool = true,
};

pub const Result = struct {
    quantized_positions: u32 = 0,
    quantized_uvs: u32 = 0,
    quantized_normals: u32 = 0,
};

pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = a;
    _ = data;
    _ = file_bytes;
    _ = opts;
    return .{};
}
