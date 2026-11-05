//! Constant animation-track removal (`animops` step).
//!
//! For every animation channel, the sampler output values are read as plain
//! floats (meshopt input is inflated at parse, so no decoder is needed) and
//! compared keyframe by keyframe: a track is *constant* when every keyframe's
//! value equals the first keyframe's within `epsilon` per component — not
//! merely "first == last", which would miss a bump in the middle.
//!
//! Constant channels are dropped. When the dropped channel is the ONLY
//! channel of its animation targeting the same node+path, the node's static
//! TRS component is snapped to the constant value (the runtime semantic: the
//! track baked that value every frame, so the bind pose carries it now).
//! Nodes with a MATRIX transform are never snapped (the matrix wins over TRS
//! at render time, so a TRS write would be dead data); their constant
//! channels are still dropped. Animations left with no channels are removed.
//!
//! Interpolation handling: LINEAR and STEP compare raw values; CUBICSPLINE
//! compares the value keys and additionally requires all in/out tangents to
//! be ~0 (equal endpoints with non-zero tangents still overshoot, so such
//! tracks are kept). Non-TRS paths (weights and anything beyond) are dropped
//! when ALL output floats are equal — no node snap applies there (morph
//! weights live on the mesh, not the node TRS).
//!
//! Additive blending (KHR_animation_additive) is not modeled by cgltf: every
//! channel is treated as an override track. A constant-identity additive
//! track (translation 0, rotation 0,0,0,1, scale 1) is all-equal, so dropping
//! it stays correct; a constant-NON-identity additive track would change the
//! composed result — animations carrying an "additive" extension on the
//! animation or any of its channels are left untouched as a guard.

const std = @import("std");
const c = @import("cgltf");

pub const Options = struct {
    /// Drop constant tracks (and snap static nodes). False = no-op step.
    remove_constant_tracks: bool = true,
    /// Per-component equality tolerance for the constant check.
    epsilon: f32 = 1e-5,
};

pub const Result = struct {
    /// channels dropped as constant
    channels_removed: u32 = 0,
    /// animations removed (emptied by the step, or already empty)
    animations_dropped: u32 = 0,
    /// nodes whose static TRS was snapped to a baked constant
    nodes_snapped: u32 = 0,
};

fn sl(comptime T: type, ptr: [*c]T, n: usize) []T {
    if (n == 0 or @intFromPtr(ptr) == 0) return &.{};
    return ptr[0..n];
}

fn ptrIndex(comptime T: type, base: [*c]T, count: usize, p: [*c]T) ?u32 {
    if (count == 0 or @intFromPtr(base) == 0 or @intFromPtr(p) == 0) return null;
    const b: usize = @intFromPtr(base);
    const q: usize = @intFromPtr(p);
    if (q < b) return null;
    const off = q - b;
    if (off % @sizeOf(T) != 0) return null;
    const i = off / @sizeOf(T);
    if (i >= count) return null;
    return @intCast(i);
}

fn numComponents(t: c.cgltf_type) usize {
    return switch (t) {
        1 => 1,
        2 => 2,
        3 => 3,
        4 => 4,
        5 => 4,
        6 => 9,
        7 => 16,
        else => 1,
    };
}

fn expectedComponents(path: c.cgltf_animation_path_type) ?usize {
    return switch (path) {
        c.cgltf_animation_path_type_translation => 3,
        c.cgltf_animation_path_type_rotation => 4,
        c.cgltf_animation_path_type_scale => 3,
        else => null, // weights and beyond: all-equal over the raw floats
    };
}

/// Plain-float decode of an accessor (sparse-aware via unpack). Null when the
/// bytes are unavailable (already-compressed views, corrupt offsets).
fn readFloats(a: std.mem.Allocator, acc: *const c.cgltf_accessor) !?[]f32 {
    const ncomp = numComponents(acc.type);
    const count: usize = @intCast(acc.count);
    if (count == 0 or ncomp == 0) return null;
    const total = count * ncomp;
    const out = try a.alloc(f32, total);
    errdefer a.free(out);
    var cp = acc.*;
    if (cp.stride == 0) cp.stride = c.cgltf_calc_size(cp.type, cp.component_type);
    if (c.cgltf_accessor_unpack_floats(&cp, out.ptr, total) < total) {
        a.free(out);
        return null;
    }
    return out;
}

fn hasAdditiveExt(extensions: [*c]c.cgltf_extension, n: usize) bool {
    for (sl(c.cgltf_extension, extensions, n)) |*e| {
        if (@intFromPtr(e.name) == 0) continue;
        const s = std.mem.span(e.name);
        if (s.len < 8) continue;
        var i: usize = 0;
        while (i + 8 <= s.len) : (i += 1) {
            if (std.ascii.eqlIgnoreCase(s[i .. i + 8], "additive")) return true;
        }
    }
    return false;
}

/// Constant value of a channel's output, or null when the track varies (or is
/// unreadable). Returned slice is the first keyframe's components (caller
/// frees the backing floats).
fn constantValue(
    a: std.mem.Allocator,
    ch: *const c.cgltf_animation_channel,
    s: *const c.cgltf_animation_sampler,
    eps: f32,
) !?[]const f32 {
    if (@intFromPtr(s.input) == 0 or @intFromPtr(s.output) == 0) return null;
    if (@intFromPtr(ch.target_node) == 0) return null;
    const out_acc: *const c.cgltf_accessor = @ptrCast(s.output);
    const in_acc: *const c.cgltf_accessor = @ptrCast(s.input);
    const nkeys: usize = @intCast(in_acc.count);
    if (nkeys == 0) return null;

    const vals = try readFloats(a, out_acc) orelse return null;
    errdefer a.free(vals);

    const ncomp = numComponents(out_acc.type);
    if (ncomp == 0 or vals.len % ncomp != 0) {
        a.free(vals);
        return null;
    }

    if (expectedComponents(ch.target_path)) |ec| {
        if (ncomp != ec) {
            a.free(vals);
            return null;
        }
        const cubic = s.interpolation == c.cgltf_interpolation_type_cubic_spline;
        const group: usize = if (cubic) 3 * ncomp else ncomp;
        if (vals.len != nkeys * group) {
            a.free(vals);
            return null;
        }
        if (nkeys == 1) return vals[0..ncomp]; // single keyframe: trivially constant
        if (cubic) {
            // value keys are the middle group of each triple; tangents must
            // be ~0 or equal endpoints still overshoot.
            for (0..nkeys) |k| {
                const base = k * group;
                for (0..ncomp) |ax| {
                    if (@abs(vals[base + ax] - 0) > eps) {
                        a.free(vals);
                        return null;
                    }
                    if (@abs(vals[base + 2 * ncomp + ax] - 0) > eps) {
                        a.free(vals);
                        return null;
                    }
                }
            }
            const first = ncomp; // first value key offset within key 0
            for (1..nkeys) |k| {
                const base = k * group + ncomp;
                for (0..ncomp) |ax| {
                    if (@abs(vals[base + ax] - vals[first + ax]) > eps) {
                        a.free(vals);
                        return null;
                    }
                }
            }
            const out_first = try a.dupe(f32, vals[first .. first + ncomp]);
            a.free(vals);
            return out_first;
        }
        for (1..nkeys) |k| {
            for (0..ncomp) |ax| {
                if (@abs(vals[k * ncomp + ax] - vals[ax]) > eps) {
                    a.free(vals);
                    return null;
                }
            }
        }
        const out_first = try a.dupe(f32, vals[0..ncomp]);
        a.free(vals);
        return out_first;
    }

    // non-TRS paths: every float identical
    for (vals[1..]) |v| {
        if (@abs(v - vals[0]) > eps) {
            a.free(vals);
            return null;
        }
    }
    const out_first = try a.dupe(f32, vals[0..@min(ncomp, vals.len)]);
    a.free(vals);
    return out_first;
}

fn snapNode(node: *c.cgltf_node, path: c.cgltf_animation_path_type, v: []const f32) bool {
    if (node.has_matrix != 0) return false; // matrix wins over TRS: TRS write is dead
    switch (path) {
        c.cgltf_animation_path_type_translation => {
            if (v.len < 3) return false;
            node.has_translation = 1;
            node.translation = .{ v[0], v[1], v[2] };
            return true;
        },
        c.cgltf_animation_path_type_rotation => {
            if (v.len < 4) return false;
            node.has_rotation = 1;
            node.rotation = .{ v[0], v[1], v[2], v[3] };
            return true;
        },
        c.cgltf_animation_path_type_scale => {
            if (v.len < 3) return false;
            node.has_scale = 1;
            node.scale = .{ v[0], v[1], v[2] };
            return true;
        },
        else => return false, // weights and beyond: no TRS to snap
    }
}

pub fn run(a: std.mem.Allocator, data: *c.cgltf_data, file_bytes: []const u8, opts: Options) !Result {
    _ = file_bytes;
    var res: Result = .{};
    if (!opts.remove_constant_tracks) return res;
    if (data.animations_count == 0) return res;

    const anims = sl(c.cgltf_animation, data.animations, data.animations_count);
    var kept_anims: usize = 0;

    for (anims, 0..) |*an, ai| {
        _ = ai;
        const additive_anim = hasAdditiveExt(an.extensions, an.extensions_count);
        const channels = sl(c.cgltf_animation_channel, an.channels, an.channels_count);
        const samplers = sl(c.cgltf_animation_sampler, an.samplers, an.samplers_count);

        // pass 1: classify every channel (constant value or null = varies)
        const const_vals = try a.alloc(?[]const f32, channels.len);
        defer {
            for (const_vals) |cv| if (cv) |v| a.free(v);
            a.free(const_vals);
        }
        for (channels, 0..) |*ch, ci| {
            const_vals[ci] = null;
            if (additive_anim) continue;
            if (@intFromPtr(ch.sampler) == 0) continue;
            if (hasAdditiveExt(ch.extensions, ch.extensions_count)) continue;
            const s: *const c.cgltf_animation_sampler = @ptrCast(ch.sampler);
            const_vals[ci] = try constantValue(a, ch, s, opts.epsilon);
        }

        // pass 2: drop constants; snap sole-target static nodes
        var kept_ch: usize = 0;
        for (channels, 0..) |*ch, ci| {
            const cv = const_vals[ci] orelse {
                channels[kept_ch] = ch.*;
                kept_ch += 1;
                continue;
            };
            res.channels_removed += 1;
            // sole channel of this animation on (node, path)? then bake it.
            var others: usize = 0;
            for (channels, 0..) |*o, oi| {
                if (oi == ci) continue;
                if (@intFromPtr(o.target_node) == @intFromPtr(ch.target_node) and o.target_path == ch.target_path) others += 1;
            }
            if (others == 0 and expectedComponents(ch.target_path) != null) {
                const node: *c.cgltf_node = @ptrCast(ch.target_node);
                if (snapNode(node, ch.target_path, cv)) res.nodes_snapped += 1;
            }
        }
        an.channels_count = kept_ch;

        // compact samplers to the referenced-only set, remap channel pointers
        if (kept_ch > 0 and samplers.len > 0) {
            const used = try a.alloc(bool, samplers.len);
            defer a.free(used);
            @memset(used, false);
            for (channels[0..kept_ch]) |*ch| {
                if (@intFromPtr(ch.sampler) == 0) continue;
                const si = ptrIndex(c.cgltf_animation_sampler, an.samplers, an.samplers_count, ch.sampler) orelse continue;
                used[si] = true;
            }
            const remap = try a.alloc(usize, samplers.len);
            defer a.free(remap);
            var n: usize = 0;
            for (samplers, 0..) |*s, si| {
                if (!used[si]) continue;
                samplers[n] = s.*;
                remap[si] = n;
                n += 1;
            }
            an.samplers_count = n;
            // survivors shifted down in place; channel pointers still hold
            // ORIGINAL addresses, so the old index recovers via the (stable)
            // array head and remaps to the new slot.
            for (channels[0..kept_ch]) |*ch| {
                if (@intFromPtr(ch.sampler) == 0) continue;
                const old: usize = (@intFromPtr(ch.sampler) - @intFromPtr(an.samplers)) / @sizeOf(c.cgltf_animation_sampler);
                if (old >= samplers.len or !used[old]) continue;
                ch.sampler = an.samplers + remap[old];
            }
        } else {
            an.samplers_count = 0;
        }

        if (kept_ch == 0) {
            res.animations_dropped += 1;
            continue; // animation removed
        }
        anims[kept_anims] = an.*;
        kept_anims += 1;
    }
    data.animations_count = kept_anims;
    return res;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

const testing = std.testing;
const parse_mod = @import("../gltf/parse.zig");
const write_mod = @import("../gltf/write.zig");

const Reparsed = struct {
    loaded: parse_mod.Loaded,
    tmp: testing.TmpDir,
};

/// Minimal GLB: nodes Static + Mover, animations still (constant translation
/// on Static), move (varying translation on Mover), empty (no channels).
/// `still_b` is the second keyframe value of the constant track: equal to
/// `still_a` for the drop case, off by more than epsilon to keep it.
fn glbTwoAnims(a: std.mem.Allocator, tmp_name: []const u8, still_b: [3]f32) !Reparsed {
    const json =
        \\{"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":[0,1]}],
        \\"nodes":[{"name":"Static"},{"name":"Mover"}],
        \\"animations":[
        \\{"name":"still","samplers":[{"input":0,"output":1}],"channels":[{"sampler":0,"target":{"node":0,"path":"translation"}}]},
        \\{"name":"move","samplers":[{"input":2,"output":3}],"channels":[{"sampler":0,"target":{"node":1,"path":"translation"}}]},
        \\{"name":"empty","samplers":[],"channels":[]}],
        \\"buffers":[{"byteLength":64}],
        \\"bufferViews":[
        \\{"buffer":0,"byteOffset":0,"byteLength":8},
        \\{"buffer":0,"byteOffset":8,"byteLength":24},
        \\{"buffer":0,"byteOffset":32,"byteLength":8},
        \\{"buffer":0,"byteOffset":40,"byteLength":24}],
        \\"accessors":[
        \\{"bufferView":0,"componentType":5126,"count":2,"type":"SCALAR"},
        \\{"bufferView":1,"componentType":5126,"count":2,"type":"VEC3"},
        \\{"bufferView":2,"componentType":5126,"count":2,"type":"SCALAR"},
        \\{"bufferView":3,"componentType":5126,"count":2,"type":"VEC3"}]}
    ;

    var bin: [64]u8 = @splat(0);
    const times = [2]f32{ 0, 1 };
    const still_a = [3]f32{ 1, 2, 3 };
    const move_b = [3]f32{ 5, 0, 0 };
    for (times, 0..) |v, k| std.mem.writeInt(u32, bin[k * 4 ..][0..4], @bitCast(v), .little);
    for (still_a, 0..) |v, k| std.mem.writeInt(u32, bin[8 + k * 4 ..][0..4], @bitCast(v), .little);
    for (still_b, 0..) |v, k| std.mem.writeInt(u32, bin[20 + k * 4 ..][0..4], @bitCast(v), .little);
    for (times, 0..) |v, k| std.mem.writeInt(u32, bin[32 + k * 4 ..][0..4], @bitCast(v), .little);
    for ([2][3]f32{ .{ 0, 0, 0 }, move_b }, 0..) |vec, k| {
        for (vec, 0..) |v, j| std.mem.writeInt(u32, bin[40 + k * 12 + j * 4 ..][0..4], @bitCast(v), .little);
    }

    const pad = (4 - (json.len % 4)) % 4;
    const total = 12 + 8 + json.len + pad + 8 + 64;
    const out = try a.alloc(u8, total);
    @memset(out, 0);
    std.mem.writeInt(u32, out[0..4], 0x46546C67, .little);
    std.mem.writeInt(u32, out[4..8], 2, .little);
    std.mem.writeInt(u32, out[8..12], @intCast(total), .little);
    std.mem.writeInt(u32, out[12..16], @intCast(json.len + pad), .little);
    std.mem.writeInt(u32, out[16..20], 0x4E4F534A, .little);
    @memcpy(out[20 .. 20 + json.len], json);
    @memset(out[20 + json.len .. 20 + json.len + pad], ' ');
    const bh = 20 + json.len + pad;
    std.mem.writeInt(u32, out[bh..][0..4], 64, .little);
    std.mem.writeInt(u32, out[bh + 4 ..][0..4], 0x004E4942, .little);
    @memcpy(out[bh + 8 ..][0..64], &bin);

    var tmp = testing.tmpDir(.{});
    errdefer tmp.cleanup();
    try tmp.dir.writeFile(testing.io, .{ .sub_path = tmp_name, .data = out });
    const out_path = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}/{s}", .{ tmp.sub_path[0..], tmp_name });
    // the tmp dir outlives the mmap: callers clean it up after loaded.deinit.
    const loaded = try parse_mod.loadFile(testing.io, a, out_path);
    return .{ .loaded = loaded, .tmp = tmp };
}

fn findNode(data: *c.cgltf_data, name: []const u8) ?*c.cgltf_node {
    for (sl(c.cgltf_node, data.nodes, data.nodes_count)) |*n| {
        if (@intFromPtr(n.name) == 0) continue;
        if (std.mem.eql(u8, std.mem.span(n.name), name)) return n;
    }
    return null;
}

test "animops drops constant channel, snaps node, keeps animated, drops empty" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var rp = try glbTwoAnims(a, "animops-basic.glb", .{ 1, 2, 3 });
    defer {
        rp.loaded.deinit();
        rp.tmp.cleanup();
    }
    const loaded = rp.loaded;
    try testing.expectEqual(@as(usize, 3), loaded.cdata.animations_count);

    const res = try run(a, loaded.cdata, loaded.map, .{});
    try testing.expectEqual(@as(u32, 1), res.channels_removed);
    // "still" is emptied by the drop, "empty" was already empty: both removed
    try testing.expectEqual(@as(u32, 2), res.animations_dropped);
    try testing.expectEqual(@as(u32, 1), res.nodes_snapped);
    try testing.expectEqual(@as(usize, 1), loaded.cdata.animations_count);

    // Static node snapped to the baked constant
    const st = findNode(loaded.cdata, "Static") orelse return error.NoNode;
    try testing.expect(st.has_translation != 0);
    try testing.expectEqualSlices(f32, &.{ 1, 2, 3 }, st.translation[0..3]);

    // "move" kept whole: channel + sampler intact, values untouched
    const anims = sl(c.cgltf_animation, loaded.cdata.animations, loaded.cdata.animations_count);
    var saw_move = false;
    for (anims) |*an| {
        if (@intFromPtr(an.name) == 0) continue;
        if (!std.mem.eql(u8, std.mem.span(an.name), "move")) continue;
        saw_move = true;
        try testing.expectEqual(@as(usize, 1), an.channels_count);
        try testing.expectEqual(@as(usize, 1), an.samplers_count);
    }
    try testing.expect(saw_move);

    // output re-parses and validates
    const out = try write_mod.serialize(a, loaded.cdata, loaded.map);
    try testing.expect(std.mem.indexOf(u8, out, "\"still\"") == null);
    try testing.expect(std.mem.indexOf(u8, out, "\"move\"") != null);
}

test "animops epsilon boundary: within-eps drops, beyond-eps keeps" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    // second keyframe well within epsilon -> constant, dropped
    {
        var rp = try glbTwoAnims(a, "animops-eps-in.glb", .{ 1 + 5.0e-6, 2, 3 });
        defer {
            rp.loaded.deinit();
            rp.tmp.cleanup();
        }
        const res = try run(a, rp.loaded.cdata, rp.loaded.map, .{ .epsilon = 1e-5 });
        try testing.expectEqual(@as(u32, 1), res.channels_removed);
    }
    // off by 10x epsilon -> varies, channel kept, no snap
    {
        var rp = try glbTwoAnims(a, "animops-eps-out.glb", .{ 1 + 1e-4, 2, 3 });
        defer {
            rp.loaded.deinit();
            rp.tmp.cleanup();
        }
        const res = try run(a, rp.loaded.cdata, rp.loaded.map, .{ .epsilon = 1e-5 });
        try testing.expectEqual(@as(u32, 0), res.channels_removed);
        try testing.expectEqual(@as(u32, 0), res.nodes_snapped);
        try testing.expectEqual(@as(usize, 2), rp.loaded.cdata.animations_count); // empty still dropped
        try testing.expectEqual(@as(u32, 1), res.animations_dropped);
    }
}

test "animops disabled flag is a no-op" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var rp = try glbTwoAnims(a, "animops-off.glb", .{ 1, 2, 3 });
    defer {
        rp.loaded.deinit();
        rp.tmp.cleanup();
    }
    const loaded = rp.loaded;
    const res = try run(a, loaded.cdata, loaded.map, .{ .remove_constant_tracks = false });
    try testing.expectEqual(@as(u32, 0), res.channels_removed);
    try testing.expectEqual(@as(u32, 0), res.animations_dropped);
    try testing.expectEqual(@as(u32, 0), res.nodes_snapped);
    try testing.expectEqual(@as(usize, 3), loaded.cdata.animations_count);
}
