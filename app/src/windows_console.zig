//! Windows console attach for the GUI-subsystem app binary.
//!
//! The Windows app build ships as GUI-subsystem, so a double-click starts
//! with no console and no std handles — that launch must stay silent and
//! window-only. A CLI launch from a shell (`assetty info …`, `--version`)
//! starts with no console either, but the parent shell *did* pass std
//! handles at CreateProcess time when output is piped or redirected
//! (`> out`, `2> err`, `| …`), and Zig reads them straight from the PEB
//! (`std.Io.File.stdout()` uses `peb().ProcessParameters.hStd*`, not
//! `GetStdHandle`), so they must stay valid there.
//!
//! The old code unconditionally overwrote all three PEB handles with
//! `CONIN$`/`CONOUT$` after `AttachConsole`, destroying inherited pipes and
//! redirections. This instead snapshots the inherited handles *before*
//! attaching, restores every handle that was already valid (pipe, file,
//! console), and opens the parent console device only for the streams that
//! are still missing. Both the kernel32 std table (`SetStdHandle`, used by
//! child processes) and the PEB slots (used by Zig) are updated together.
//! When there is no parent console at all (`AttachConsole` fails — e.g. a
//! double-click from Explorer) nothing is touched.
const std = @import("std");
const builtin = @import("builtin");

pub fn attachParentConsole(init: std.process.Init) void {
    if (builtin.os.tag != .windows) return;
    const win = std.os.windows;
    const pp = win.peb().ProcessParameters;

    // Snapshot BEFORE AttachConsole: these are the CreateProcess-inherited
    // handles (pipes/redirections). Prefer the PEB slots Zig reads, but
    // accept the kernel32 table as a fallback if they disagree.
    const saved_in = pickValid(pp.hStdInput, GetStdHandle(STD_INPUT_HANDLE));
    const saved_out = pickValid(pp.hStdOutput, GetStdHandle(STD_OUTPUT_HANDLE));
    const saved_err = pickValid(pp.hStdError, GetStdHandle(STD_ERROR_HANDLE));

    if (AttachConsole(ATTACH_PARENT_PROCESS) == 0) return; // no parent console: stay window-only

    ensureStream(init, pp, .in, saved_in);
    ensureStream(init, pp, .out, saved_out);
    ensureStream(init, pp, .err, saved_err);
}

const Stream = enum { in, out, err };

fn ensureStream(init: std.process.Init, pp: *std.os.windows.RTL_USER_PROCESS_PARAMETERS, which: Stream, saved: std.os.windows.HANDLE) void {
    if (isValidHandle(saved)) {
        setStream(pp, which, saved);
        return;
    }
    const name: []const u8, const read: bool = switch (which) {
        .in => .{ "CONIN$", true },
        .out, .err => .{ "CONOUT$", false },
    };
    const h = openConsole(init, name, read);
    if (!isValidHandle(h)) return; // leave whatever AttachConsole set up
    setStream(pp, which, h);
}

fn setStream(pp: *std.os.windows.RTL_USER_PROCESS_PARAMETERS, which: Stream, h: std.os.windows.HANDLE) void {
    const id: u32 = switch (which) {
        .in => STD_INPUT_HANDLE,
        .out => STD_OUTPUT_HANDLE,
        .err => STD_ERROR_HANDLE,
    };
    _ = SetStdHandle(id, h);
    switch (which) {
        .in => pp.hStdInput = h,
        .out => pp.hStdOutput = h,
        .err => pp.hStdError = h,
    }
}

/// First valid handle wins; otherwise an invalid sentinel (caller fills it).
fn pickValid(a: std.os.windows.HANDLE, b: std.os.windows.HANDLE) std.os.windows.HANDLE {
    if (isValidHandle(a)) return a;
    if (isValidHandle(b)) return b;
    return std.os.windows.INVALID_HANDLE_VALUE;
}

/// A live pipe/file/console handle. `GetFileType` reports `FILE_TYPE_UNKNOWN`
/// for dead slots, so redirected and piped handles survive while null/invalid
/// ones fall through to the console device.
fn isValidHandle(h: std.os.windows.HANDLE) bool {
    if (@intFromPtr(h) == 0) return false;
    if (h == std.os.windows.INVALID_HANDLE_VALUE) return false;
    return GetFileType(h) != FILE_TYPE_UNKNOWN;
}

fn openConsole(init: std.process.Init, name: []const u8, read: bool) std.os.windows.HANDLE {
    const w = std.unicode.utf8ToUtf16LeAllocZ(init.gpa, name) catch return std.os.windows.INVALID_HANDLE_VALUE;
    defer init.gpa.free(w);
    const access: u32 = if (read) GENERIC_READ | GENERIC_WRITE else GENERIC_WRITE;
    return CreateFileW(w.ptr, access, FILE_SHARE_READ | FILE_SHARE_WRITE, null, OPEN_EXISTING, 0, null);
}

const ATTACH_PARENT_PROCESS: u32 = 0xFFFFFFFF;
const STD_INPUT_HANDLE: u32 = 0xFFFFFFF6;
const STD_OUTPUT_HANDLE: u32 = 0xFFFFFFF5;
const STD_ERROR_HANDLE: u32 = 0xFFFFFFF4;
const FILE_TYPE_UNKNOWN: u32 = 0;
const GENERIC_READ: u32 = 0x80000000;
const GENERIC_WRITE: u32 = 0x40000000;
const FILE_SHARE_READ: u32 = 1;
const FILE_SHARE_WRITE: u32 = 2;
const OPEN_EXISTING: u32 = 3;

extern "kernel32" fn AttachConsole(dwProcessId: u32) callconv(.winapi) i32;
extern "kernel32" fn GetStdHandle(nStdHandle: u32) callconv(.winapi) std.os.windows.HANDLE;
extern "kernel32" fn SetStdHandle(nStdHandle: u32, hHandle: std.os.windows.HANDLE) callconv(.winapi) i32;
extern "kernel32" fn GetFileType(hFile: std.os.windows.HANDLE) callconv(.winapi) u32;
extern "kernel32" fn CreateFileW(lpFileName: [*:0]const u16, dwDesiredAccess: u32, dwShareMode: u32, lpSecurityAttributes: ?*anyopaque, dwCreationDisposition: u32, dwFlagsAndAttributes: u32, hTemplateFile: ?*anyopaque) std.os.windows.HANDLE;
