//! Release-key helper for the update feed.
//!
//!   zig build update-keygen                 # print a new key pair
//!   zig build sign-manifest -- <file>       # sign <file> -> <file>.sig
//!
//! `update-keygen` prints the private seed (hex — store it as the
//! repository secret `ASSETTY_UPDATE_SEED`) and the public key (hex — paste
//! it into `core/src/update_key.zig`'s `default_public_key_hex`).
//!
//! `sign-manifest` signs the given file with the seed from
//! `ASSETTY_UPDATE_SEED` and writes `<file>.sig` next to it: the hex
//! Ed25519 signature over the file's exact bytes. The release workflow runs
//! it right after `tools/manifest.py` wrote `manifest.json`, so the release
//! publishes a manifest and its signature together.
const std = @import("std");
const update_key = @import("update_key");

pub fn main(init: std.process.Init) !u8 {
    const a = init.gpa;
    const io = init.io;

    var args = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
    defer args.deinit();
    _ = args.skip();
    const cmd = args.next() orelse "keygen";

    if (std.mem.eql(u8, cmd, "keygen")) {
        const seed = try update_key.generateSeed(a, io);
        defer a.free(seed);
        const pub_bytes = try update_key.publicKeyFromSeed(seed);
        const pub_hex = try a.alloc(u8, 64);
        defer a.free(pub_hex);
        _ = try std.fmt.bufPrint(pub_hex, "{s}", .{std.fmt.bytesToHex(pub_bytes, .lower)});
        var out_buf: [256]u8 = undefined;
        var stdout = std.Io.File.stdout().writer(io, &out_buf);
        try stdout.interface.print("seed = {s}\npub  = {s}\n", .{ seed, pub_hex });
        try stdout.interface.flush();
        return 0;
    }

    if (std.mem.eql(u8, cmd, "sign")) {
        const path = args.next() orelse {
            std.debug.print("sign: missing <file>\n", .{});
            return 2;
        };
        const seed = init.environ_map.get("ASSETTY_UPDATE_SEED") orelse {
            std.debug.print("sign: ASSETTY_UPDATE_SEED is not set\n", .{});
            return 2;
        };
        const bytes = try std.Io.Dir.cwd().readFileAlloc(io, path, a, .limited(64 << 20));
        defer a.free(bytes);
        const sig = try update_key.sign(a, io, seed, bytes);
        defer a.free(sig);
        const sig_path = try std.fmt.allocPrint(a, "{s}.sig", .{path});
        defer a.free(sig_path);
        try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = sig_path, .data = sig });
        return 0;
    }

    std.debug.print("unknown command '{s}' (expected keygen or sign)\n", .{cmd});
    return 2;
}
