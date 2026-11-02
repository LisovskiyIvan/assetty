//! Single-binary entry: `assetty` with no args opens the desktop app,
//! any args are dispatched to the CLI.
const std = @import("std");

pub fn main(init: std.process.Init) !u8 {
    var it = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
    _ = it.skip(); // argv[0]
    const first = it.next();

    if (first) |a| {
        if (std.mem.eql(u8, a, "app") or std.mem.eql(u8, a, "--app") or std.mem.eql(u8, a, "-a")) {
            return @import("app/src/main.zig").run(init);
        }
    } else {
        return @import("app/src/main.zig").run(init);
    }
    return @import("cli/src/main.zig").run(init);
}
