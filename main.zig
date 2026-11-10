//! Single-binary entry: `assetty` with no args opens the desktop app,
//! commands use the CLI; a `.glb` path opens the desktop viewer.
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
            defer probe.deinit();
            _ = probe.skip();
            while (probe.next()) |a| {
                if (std.mem.startsWith(u8, a, "--nanoui-")) nanoui_flag = true;
            }
        }

        if (first) |a| {
            if (nanoui_flag or std.mem.eql(u8, a, "app") or std.mem.eql(u8, a, "--app") or std.mem.eql(u8, a, "-a") or
                std.mem.eql(u8, a, "--open") or @import("app/src/native_open.zig").isSupportedPath(a))
            {
                return @import("app/src/main.zig").run(init);
            }
        } else {
            // GUI-subsystem binary (Windows app build): a double-click opens
            // the window with no console, ever. Shell launches of the CLI
            // branch below attach the parent console themselves.
            return @import("app/src/main.zig").run(init);
        }
        @import("app/src/windows_console.zig").attachParentConsole(init);
        return @import("cli/src/main.zig").run(init);
    }

    // CLI-only build (`-Dapp=false`): a console program, no console games.
    if (first == null) {
        std.debug.print("assetty: built without the desktop app; use CLI commands (info, optimize, textures, presets)\n", .{});
        return 2;
    }
    return @import("cli/src/main.zig").run(init);
}
