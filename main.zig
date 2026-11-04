//! Single-binary entry: `assetty` with no args opens the desktop app,
//! any args are dispatched to the CLI — on every platform.
const std = @import("std");
const config = @import("config");

pub fn main(init: std.process.Init) !u8 {
    var it = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
    _ = it.skip(); // argv[0]
    const first = it.next();

    if (config.has_app) {
        // nanoui's own runtime flags belong to the app
        var nanoui_flag = false;
        {
            var probe = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
            _ = probe.skip();
            while (probe.next()) |a| {
                if (std.mem.startsWith(u8, a, "--nanoui-")) nanoui_flag = true;
            }
        }

        if (first) |a| {
            if (nanoui_flag or std.mem.eql(u8, a, "app") or std.mem.eql(u8, a, "--app") or std.mem.eql(u8, a, "-a")) {
                return @import("app/src/main.zig").run(init);
            }
        } else {
            return @import("app/src/main.zig").run(init);
        }
        return @import("cli/src/main.zig").run(init);
    }

    // CLI-only build (`-Dapp=false`): no desktop app in this binary.
    if (first == null) {
        std.debug.print("assetty: built without the desktop app; use CLI commands (info, optimize, textures, presets)\n", .{});
        return 2;
    }
    return @import("cli/src/main.zig").run(init);
}
