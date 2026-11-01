const std = @import("std");

pub const Semantic = enum {
    position,
    normal,
    tangent,
    texcoord_0,
    texcoord_1,
    color_0,
    joints_0,
    weights_0,
    other,

    pub fn label(self: Semantic) []const u8 {
        return switch (self) {
            .position => "POSITION",
            .normal => "NORMAL",
            .tangent => "TANGENT",
            .texcoord_0 => "TEXCOORD_0",
            .texcoord_1 => "TEXCOORD_1",
            .color_0 => "COLOR_0",
            .joints_0 => "JOINTS_0",
            .weights_0 => "WEIGHTS_0",
            .other => "OTHER",
        };
    }
};

pub const ComponentType = enum(u8) {
    i8,
    u8,
    i16,
    u16,
    u32,
    f32,

    pub fn byteSize(self: ComponentType) u32 {
        return switch (self) {
            .i8, .u8 => 1,
            .i16, .u16 => 2,
            .u32, .f32 => 4,
        };
    }

    pub fn label(self: ComponentType) []const u8 {
        return switch (self) {
            .i8 => "i8",
            .u8 => "u8",
            .i16 => "i16",
            .u16 => "u16",
            .u32 => "u32",
            .f32 => "f32",
        };
    }
};

pub const Dim = enum(u8) { scalar, vec2, vec3, vec4, mat2, mat3, mat4 };

pub fn dimComponents(d: Dim) u32 {
    return switch (d) {
        .scalar => 1,
        .vec2 => 2,
        .vec3 => 3,
        .vec4 => 4,
        .mat2 => 4,
        .mat3 => 9,
        .mat4 => 16,
    };
}

pub const Mode = enum {
    points,
    lines,
    line_loop,
    line_strip,
    triangles,
    triangle_strip,
    triangle_fan,
};

pub const Attribute = struct {
    semantic: Semantic,
    count: u32,
    component: ComponentType,
    dim: Dim,
};

pub const Primitive = struct {
    mode: Mode = .triangles,
    attributes: []const Attribute = &.{},
    vertex_count: u32 = 0,
    index_count: u32 = 0,
    indexed: bool = false,
    /// null = default material
    material: ?u32 = null,
};

pub const Mesh = struct {
    name: ?[]const u8 = null,
    primitives: []const Primitive = &.{},
};

pub const TextureInfo = struct {
    texture: u32,
    texcoord: u32 = 0,
};

pub const AlphaMode = enum { opaque_, mask, blend };

pub const Extensions = struct {
    specular_glossiness: bool = false,
    unlit: bool = false,
    emissive_strength: bool = false,
    clearcoat: bool = false,
    transmission: bool = false,
    volume: bool = false,
    ior: bool = false,
    specular: bool = false,
    sheen: bool = false,
    texture_transform: bool = false,
    iridescence: bool = false,
    anisotropy: bool = false,
};

pub const Material = struct {
    name: ?[]const u8 = null,
    base_color_factor: [4]f32 = .{ 1, 1, 1, 1 },
    metallic: f32 = 1,
    roughness: f32 = 1,
    base_color_texture: ?TextureInfo = null,
    metallic_roughness_texture: ?TextureInfo = null,
    normal_texture: ?TextureInfo = null,
    occlusion_texture: ?TextureInfo = null,
    emissive_texture: ?TextureInfo = null,
    emissive_factor: [3]f32 = .{ 0, 0, 0 },
    normal_scale: f32 = 1,
    occlusion_strength: f32 = 1,
    alpha_mode: AlphaMode = .opaque_,
    alpha_cutoff: f32 = 0.5,
    double_sided: bool = false,
    has_pbr: bool = true,
    extensions: Extensions = .{},
};

pub const Mime = enum {
    png,
    jpeg,
    ktx2,
    other,

    pub fn label(self: Mime) []const u8 {
        return switch (self) {
            .png => "png",
            .jpeg => "jpeg",
            .ktx2 => "ktx2",
            .other => "other",
        };
    }
};

pub const Image = struct {
    name: ?[]const u8 = null,
    mime: Mime = .other,
    /// bytes from embedded bufferView, null if external uri or buffer not loaded
    data: ?[]const u8 = null,
    uri: ?[]const u8 = null,
    width: u32 = 0,
    height: u32 = 0,
    components: u32 = 0,
    has_dims: bool = false,
    disk_bytes: u64 = 0,
};

pub const Filter = enum { nearest, linear, unknown };
pub const Wrap = enum { clamp_to_edge, mirrored_repeat, repeat, unknown };

pub const Sampler = struct {
    mag: Filter = .unknown,
    min: Filter = .unknown,
    wrap_s: Wrap = .unknown,
    wrap_t: Wrap = .unknown,
};

pub const Texture = struct {
    name: ?[]const u8 = null,
    image: ?u32 = null,
    sampler: ?u32 = null,
};

pub const Node = struct {
    name: ?[]const u8 = null,
    children: []const u32 = &.{},
    mesh: ?u32 = null,
    skin: ?u32 = null,
    translation: [3]f32 = .{ 0, 0, 0 },
    rotation: [4]f32 = .{ 0, 0, 0, 1 },
    scale: [3]f32 = .{ 1, 1, 1 },
    has_matrix: bool = false,
    matrix: [16]f32 = undefined,
};

pub const Scene = struct {
    name: ?[]const u8 = null,
    roots: []const u32 = &.{},
};

pub const Animation = struct {
    name: ?[]const u8 = null,
    channels: u32 = 0,
    samplers: u32 = 0,
    duration: ?f32 = null,
    /// node indices targeted by channels (for reachability/prune)
    targets: []const u32 = &.{},
};

pub const Skin = struct {
    name: ?[]const u8 = null,
    joints: u32 = 0,
    has_inverse_bind_matrices: bool = false,
};

pub const Buffer = struct {
    name: ?[]const u8 = null,
    byte_length: u64 = 0,
    /// null uri = GLB BIN chunk (embedded)
    uri: ?[]const u8 = null,
};

pub const Asset = struct {
    generator: ?[]const u8 = null,
    version: ?[]const u8 = null,
    copyright: ?[]const u8 = null,

    scenes: []const Scene = &.{},
    nodes: []const Node = &.{},
    meshes: []const Mesh = &.{},
    materials: []const Material = &.{},
    textures: []const Texture = &.{},
    images: []const Image = &.{},
    samplers: []const Sampler = &.{},
    animations: []const Animation = &.{},
    skins: []const Skin = &.{},
    buffers: []const Buffer = &.{},
    extensions_used: []const []const u8 = &.{},
    extensions_required: []const []const u8 = &.{},

    is_glb: bool = false,
    json_size: u64 = 0,
    bin_size: u64 = 0,
    file_size: u64 = 0,
};

test "refAll" {
    std.testing.refAllDecls(@This());
}
