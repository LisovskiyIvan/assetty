//! Self-update from GitHub releases, button-driven (Settings tab).
//!
//! The contract both sides share: every release carries `manifest.json`
//!
//!     {"version":"0.2.0","files":{"assetty-macos-arm64.zip":{"sha256":"…"}}}
//!
//! next to one archive per platform (see `assetFor`) and a detached
//! Ed25519 signature of the manifest bytes, `manifest.json.sig` (hex).
//!
//! The signature is what makes the feed trustworthy: the manifest (and with
//! it every archive hash) is verified against the public key baked into this
//! build before a single byte of the manifest is believed. A manifest
//! without a valid signature is refused — the checksum alone only proves
//! that the archive matches the manifest, not that either came from the
//! project.
//!
//! `updateCheck` fetches the manifest, verifies the signature and compares
//! versions; `updateApply` downloads this platform's archive, checks its
//! sha256, unpacks it, verifies the staged program reports the new version
//! via `--version`, swaps it over the running exe — then relaunches the new
//! program detached and quits, so the update takes effect without a manual
//! reopen (`relaunch`). Relaunch is best-effort: when the spawn fails the
//! install still stands and the user relaunches by hand.
//!
//! The manifest is fetched exactly once per operation: `check` and `apply`
//! share one fetch, so the version that was announced and the hashes that
//! are verified always come from the same signed document.
//
//! Why not `nanoui.Updater`: on macOS it only updates signed `.app` bundles
//! (its `detect` requires a `*.app` bundle path and a team signature), and
//! assetty ships as a lone binary — there the updater stays `off`. On
//! Linux/Windows `Updater`'s portable flow does apply, but it is timer- and
//! thread-driven with no synchronous "check now" result a button can await.
//! This module reuses its pure contract (`newer`, `parseManifest`, the
//! manifest shape, the curl/tar tools) with synchronous calls the bindings
//! return directly. UI blocks during download (a user-initiated button, like
//! `openDialog` blocks); a background job with progress is future work.
const std = @import("std");
const builtin = @import("builtin");
const nanoui = @import("nanoui");
const core = @import("core");
const update_key = core.update_key;

/// This platform's archive in every release. The release workflow
/// (`.github/workflows/release.yml`) must produce exactly these names.
pub fn assetFor(os: []const u8, arch: []const u8) []const u8 {
    if (std.mem.eql(u8, os, "windows")) {
        if (std.mem.eql(u8, arch, "x64")) return "assetty-windows-x64.zip";
    } else if (std.mem.eql(u8, os, "macos")) {
        if (std.mem.eql(u8, arch, "arm64")) return "assetty-macos-arm64.zip";
        if (std.mem.eql(u8, arch, "x64")) return "assetty-macos-x64.zip";
    } else if (std.mem.eql(u8, os, "linux")) {
        if (std.mem.eql(u8, arch, "x64")) return "assetty-linux-x64.tar.gz";
        if (std.mem.eql(u8, arch, "arm64")) return "assetty-linux-arm64.tar.gz";
    }
    return "assetty-unknown";
}

fn archName() []const u8 {
    return switch (builtin.cpu.arch) {
        .aarch64 => "arm64",
        .x86_64 => "x64",
        else => @tagName(builtin.cpu.arch),
    };
}

/// This build's archive name, comptime-resolved for the target.
pub const asset_name: []const u8 = assetFor(@tagName(builtin.os.tag), archName());

/// Where the checks look: the latest release's files. A `file://` directory
/// (a folder holding `manifest.json` + archives) works too — the tests and
/// any staging feed use that.
pub fn feedDefault(a: std.mem.Allocator, repo: []const u8) ![]const u8 {
    return std.fmt.allocPrint(a, "https://github.com/{s}/releases/latest/download", .{repo});
}

pub fn manifestUrl(a: std.mem.Allocator, feed: []const u8) ![]const u8 {
    return std.fmt.allocPrint(a, "{s}/manifest.json", .{feed});
}

/// The detached signature of `manifest.json`: hex-encoded Ed25519 signature
/// over the exact manifest bytes. Published next to the manifest by the
/// release workflow (`zig build sign-manifest`, see `tools/release_key.zig`).
pub fn manifestSigUrl(a: std.mem.Allocator, feed: []const u8) ![]const u8 {
    return std.fmt.allocPrint(a, "{s}/manifest.json.sig", .{feed});
}

/// The immutable per-version URL (the `latest` redirect could move underfoot
/// mid-download); mirrors `nanoui.update`.
pub fn taggedAssetUrl(a: std.mem.Allocator, repo: []const u8, version: []const u8, asset: []const u8) ![]const u8 {
    return std.fmt.allocPrint(a, "https://github.com/{s}/releases/download/v{s}/{s}", .{ repo, version, asset });
}

pub fn notesUrl(a: std.mem.Allocator, repo: []const u8, version: []const u8) ![]const u8 {
    return std.fmt.allocPrint(a, "https://github.com/{s}/releases/tag/v{s}", .{ repo, version });
}

/// Whether dotted `latest` is past `current` (same semantics as
/// `nanoui.update.newer`: a leading `v` is ignored, garbage never wins).
pub fn newer(latest: []const u8, current: []const u8) bool {
    return nanoui.update.newer(latest, current);
}

/// The version prefix version comparison understands: `0.1.0-dev` and
/// `0.1.0+local` compare as `0.1.0`, so dev builds still see releases.
pub fn comparable(v: []const u8) []const u8 {
    var i: usize = 0;
    while (i < v.len and v[i] != '-' and v[i] != '+') : (i += 1) {}
    return v[0..i];
}

pub const Check = struct {
    available: bool,
    /// The release's version when available, else `current`.
    version: []const u8,
    current: []const u8,
    asset: []const u8,
    download_url: []const u8,
    notes_url: []const u8,
};

/// The feed's manifest, verified.
pub const VerifiedManifest = struct {
    /// The manifest bytes as fetched (arena-owned).
    text: []const u8,
    /// The release the manifest describes for this platform.
    release: nanoui.update.Release,
};

/// The Ed25519 public key that release manifests are signed with.
///
/// Baked into the binary (see `core/src/update_key.zig`): the release
/// workflow signs every manifest with the matching private key, so a
/// tampered or substituted feed is rejected before any of its content is
/// used. The private key never lives in the repository.
pub fn publicKeyHex() []const u8 {
    return update_key.public_key_hex;
}

/// Signs `message` with the hex seed (the release workflow's secret). Used
/// by the tests and by the `sign-manifest` build step.
pub fn signManifest(a: std.mem.Allocator, io: std.Io, seed_hex: []const u8, message: []const u8) ![]const u8 {
    return update_key.sign(a, io, seed_hex, message);
}

pub const VerifyError = error{
    /// The feed published no signature next to the manifest.
    MissingSignature,
    /// The signature is not valid for this manifest and key.
    BadSignature,
    /// The build has no public key configured: the feed cannot be trusted.
    NoPublicKey,
} || std.mem.Allocator.Error;

/// Verifies `manifest` against `signature` (hex, 128 chars) with the
/// build's public key. The signature covers the manifest bytes exactly as
/// fetched, so any change to the document invalidates it.
pub fn verifyManifest(manifest: []const u8, signature: []const u8) VerifyError!void {
    const key = publicKeyHex();
    if (key.len == 0) return error.NoPublicKey;
    update_key.verify(key, manifest, signature) catch |err| switch (err) {
        error.BadSignature => return error.BadSignature,
        // A malformed signature is a broken feed, not a broken build.
        error.InvalidSignature => return error.BadSignature,
        error.InvalidKey => return error.NoPublicKey,
        error.OutOfMemory => return error.OutOfMemory,
    };
}

/// Fetches the manifest and its detached signature and verifies them.
///
/// The signature is fetched from the same feed, but it buys nothing on its
/// own: what makes it meaningful is that the public key is compiled into
/// this binary, so only the holder of the matching private key (the release
/// workflow) can produce a manifest this build accepts.
pub fn fetchVerifiedManifest(
    a: std.mem.Allocator,
    io: std.Io,
    feed: []const u8,
    asset: []const u8,
) !VerifiedManifest {
    const manifest = try fetchText(a, io, try manifestUrl(a, feed));
    const sig = fetchText(a, io, try manifestSigUrl(a, feed)) catch |err| switch (err) {
        error.FileNotFound => return error.MissingSignature,
        else => return err,
    };
    // Trim the trailing newline the release workflow's signer leaves.
    const sig_trimmed = std.mem.trim(u8, sig, " \t\r\n");
    verifyManifest(manifest, sig_trimmed) catch |err| return err;
    const release = try nanoui.update.parseManifest(a, manifest, asset);
    return .{ .text = manifest, .release = release };
}

/// Fetches the feed's manifest and compares it to `current`. `feed` defaults
/// to the repo's latest release; pass a `file://` dir in tests.
pub fn check(
    a: std.mem.Allocator,
    io: std.Io,
    feed: []const u8,
    repo: []const u8,
    asset: []const u8,
    current: []const u8,
) !Check {
    const m = try fetchVerifiedManifest(a, io, feed, asset);
    return checkFromManifest(a, feed, repo, asset, current, m.release);
}

/// The version comparison half of `check`, given an already verified manifest.
fn checkFromManifest(
    a: std.mem.Allocator,
    feed: []const u8,
    repo: []const u8,
    asset: []const u8,
    current: []const u8,
    release: nanoui.update.Release,
) !Check {
    const notes = try notesUrl(a, repo, release.version);
    if (!newer(release.version, current)) {
        return .{
            .available = false,
            .version = current,
            .current = current,
            .asset = asset,
            .download_url = try downloadUrl(a, feed, repo, release.version, asset),
            .notes_url = notes,
        };
    }
    return .{
        .available = true,
        .version = release.version,
        .current = current,
        .asset = asset,
        .download_url = try downloadUrl(a, feed, repo, release.version, asset),
        .notes_url = notes,
    };
}

fn downloadUrl(a: std.mem.Allocator, feed: []const u8, repo: []const u8, version: []const u8, asset: []const u8) ![]const u8 {
    if (std.mem.startsWith(u8, feed, "https://github.com/")) return taggedAssetUrl(a, repo, version, asset);
    return std.fmt.allocPrint(a, "{s}/{s}", .{ feed, asset });
}

pub const ApplyOutcome = union(enum) {
    installed: struct { version: []const u8 },
    up_to_date: struct { version: []const u8 },
    failed: []const u8,
};

/// Full flow: check, download, verify, unpack, `--version`-check, swap over
/// `exe`. Downloads land in `cache_dir/updates/`, removed on success.
/// `exe` is the running program's path; `cache_dir` a writable directory.
pub fn apply(
    a: std.mem.Allocator,
    io: std.Io,
    feed: []const u8,
    repo: []const u8,
    asset: []const u8,
    current: []const u8,
    exe: []const u8,
    cache_dir: []const u8,
) ApplyOutcome {
    // One manifest, one verification: the version that is announced and the
    // hashes that are checked always come from the same signed document.
    const m = fetchVerifiedManifest(a, io, feed, asset) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "update check: {s}", .{errorText(err)}) catch "out of memory" };
    };
    const release = m.release;
    const c = checkFromManifest(a, feed, repo, asset, current, release) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "update check: {s}", .{errorText(err)}) catch "out of memory" };
    };
    if (!c.available) return .{ .up_to_date = .{ .version = current } };

    const dir = std.fmt.allocPrint(a, "{s}{c}updates{c}{s}", .{ cache_dir, std.fs.path.sep, std.fs.path.sep, release.version }) catch return oom(a);
    std.Io.Dir.cwd().deleteTree(io, dir) catch {};
    std.Io.Dir.cwd().createDirPath(io, dir) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "cache dir: {s}", .{@errorName(err)}) catch "out of memory" };
    };
    errdefer std.Io.Dir.cwd().deleteTree(io, dir) catch {};

    const archive = std.fmt.allocPrint(a, "{s}{c}{s}", .{ dir, std.fs.path.sep, asset }) catch return oom(a);
    downloadTo(a, io, c.download_url, archive) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "download: {s}", .{@errorName(err)}) catch "out of memory" };
    };
    verifySha256(io, archive, release.sha256) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "checksum: {s}", .{errorText(err)}) catch "out of memory" };
    };

    const unpacked = std.fmt.allocPrint(a, "{s}{c}unpacked", .{ dir, std.fs.path.sep }) catch return oom(a);
    std.Io.Dir.cwd().createDirPath(io, unpacked) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "unpack dir: {s}", .{@errorName(err)}) catch "out of memory" };
    };
    unpack(a, io, archive, unpacked) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "unpack: {s}", .{errorText(err)}) catch "out of memory" };
    };
    std.Io.Dir.cwd().deleteFile(io, archive) catch {};

    const staged = findProgram(a, io, unpacked, std.fs.path.basename(exe)) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "no program in archive: {s}", .{@errorName(err)}) catch "out of memory" };
    };
    checkStagedVersion(a, io, staged, release.version) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "staged program: {s}", .{@errorName(err)}) catch "out of memory" };
    };

    clearAside(io, exe);
    swapOver(a, io, staged, exe) catch |err| {
        return .{ .failed = std.fmt.allocPrint(a, "install: {s}", .{@errorName(err)}) catch "out of memory" };
    };
    std.Io.Dir.cwd().deleteTree(io, dir) catch {};
    return .{ .installed = .{ .version = release.version } };
}

fn oom(a: std.mem.Allocator) ApplyOutcome {
    _ = a;
    return .{ .failed = "out of memory" };
}

/// A message the user can act on. The raw error name says nothing to a
/// person ("BadSignature"); this says what went wrong with the feed.
pub fn errorText(err: anyerror) []const u8 {
    return switch (err) {
        error.MissingSignature => "the release manifest is not signed (manifest.json.sig is missing)",
        error.BadSignature => "the release manifest signature does not match this build's key",
        error.NoPublicKey => "this build has no release key, so it cannot trust any feed",
        error.ChecksumMismatch => "the downloaded archive does not match the signed manifest",
        error.UnsafeArchiveEntry => "the release archive contains an unsafe entry",
        else => @errorName(err),
    };
}

const windows = builtin.os.tag == .windows;

/// The tools on every machine (System32 since Windows 10), as in
/// `nanoui.update_portable`.
const curl_bin = if (windows) "C:\\Windows\\System32\\curl.exe" else "/usr/bin/curl";
const tar_bin = if (windows) "C:\\Windows\\System32\\tar.exe" else "/usr/bin/tar";

fn run(a: std.mem.Allocator, io: std.Io, argv: []const []const u8) ![]const u8 {
    const r = try std.process.run(a, io, .{ .argv = argv, .stdout_limit = .limited(1 << 20), .stderr_limit = .limited(1 << 20) });
    if (!r.term.success()) return error.CommandFailed;
    return r.stdout;
}

/// `file://` feeds read straight off disk (hermetic tests, staging feeds);
/// anything else goes through curl like `nanoui.update`.
fn fetchText(a: std.mem.Allocator, io: std.Io, url: []const u8) ![]const u8 {
    if (std.mem.startsWith(u8, url, "file://")) {
        return std.Io.Dir.cwd().readFileAlloc(io, url["file://".len..], a, .limited(1 << 20));
    }
    const r = try std.process.run(a, io, .{ .argv = &.{ curl_bin, "-fsSL", "--max-time", "30", url }, .stdout_limit = .limited(1 << 20), .stderr_limit = .limited(1 << 20) });
    if (!r.term.success()) {
        // curl -f exits 22 when the server answered HTTP >= 400: for the
        // signature URL that means the release published no signature (404),
        // which callers report as a missing signature, not a transport
        // failure. Other exits are transport failures and keep the raw name.
        switch (r.term) {
            .exited => |code| if (code == 22) return error.FileNotFound,
            else => {},
        }
        return error.CommandFailed;
    }
    return r.stdout;
}

fn downloadTo(a: std.mem.Allocator, io: std.Io, url: []const u8, dst: []const u8) !void {
    if (std.mem.startsWith(u8, url, "file://")) {
        const src = url["file://".len..];
        _ = std.Io.Dir.cwd().updateFile(io, src, std.Io.Dir.cwd(), dst, .{ .replace = true }) catch return error.DownloadFailed;
        return;
    }
    _ = try run(a, io, &.{ curl_bin, "-fsSL", "--max-time", "900", "-o", dst, url });
}

/// Streams the file through SHA-256 instead of loading it into memory: a
/// release archive is tens of megabytes, and a hostile feed should not be
/// able to make the app allocate the whole file twice.
fn verifySha256(io: std.Io, path: []const u8, want_hex: []const u8) !void {
    const file = try std.Io.Dir.cwd().openFile(io, path, .{});
    defer file.close(io);

    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    var buf: [64 * 1024]u8 = undefined;
    var reader = file.reader(io, &buf);
    while (true) {
        // A short read is not the end of the file: only a zero-length read
        // is. Stopping on the first short read would hash a prefix of the
        // archive and reject a perfectly good download.
        const n = reader.interface.readSliceShort(&buf) catch |err| switch (err) {
            error.ReadFailed => return error.ReadFailed,
        };
        if (n == 0) break;
        hasher.update(buf[0..n]);
    }
    var digest: [32]u8 = undefined;
    hasher.final(&digest);
    if (!std.ascii.eqlIgnoreCase(&std.fmt.bytesToHex(digest, .lower), want_hex)) return error.ChecksumMismatch;
}

/// Extracts the archive into `dst`.
///
/// The archive itself is authenticated (its sha256 comes from the signed
/// manifest), but the extraction is still hardened: no `-P`, so the tools
/// refuse absolute member paths, and both refuse `..` members by default.
/// After extraction the tree is walked: only regular files and directories
/// are allowed, so a symlink cannot smuggle a program in from outside.
fn unpack(a: std.mem.Allocator, io: std.Io, archive: []const u8, dst: []const u8) !void {
    if (std.mem.endsWith(u8, archive, ".tar.gz") or std.mem.endsWith(u8, archive, ".tgz")) {
        _ = try run(a, io, &.{ tar_bin, "-xf", archive, "-C", dst, "--no-same-owner", "--no-same-permissions" });
    } else if (windows) {
        _ = try run(a, io, &.{ tar_bin, "-xf", archive, "-C", dst, "--no-same-owner", "--no-same-permissions" });
    } else {
        _ = try run(a, io, &.{ "/usr/bin/unzip", "-q", "-o", archive, "-d", dst });
    }
    try verifyExtractedTree(a, io, dst);
}

/// Rejects anything but regular files and directories in the extracted tree.
fn verifyExtractedTree(a: std.mem.Allocator, io: std.Io, root: []const u8) !void {
    var dir = try std.Io.Dir.cwd().openDir(io, root, .{ .iterate = true });
    defer dir.close(io);
    var walker = try dir.walk(a);
    defer walker.deinit();
    while (try walker.next(io)) |e| {
        switch (e.kind) {
            .file, .directory => {},
            else => return error.UnsafeArchiveEntry,
        }
    }
}

/// The file called `name` in `root` or a folder in it (archives nest the
/// program in `<app>-<version>-<os>-<arch>/`).
///
/// Only regular files match: a symlink named like the program would point
/// somewhere else on disk, and a hostile archive must not be able to make
/// the updater swap in a file it did not ship.
fn findProgram(a: std.mem.Allocator, io: std.Io, root: []const u8, name: []const u8) ![]const u8 {
    var dir = try std.Io.Dir.cwd().openDir(io, root, .{ .iterate = true });
    defer dir.close(io);
    var walker = try dir.walk(a);
    defer walker.deinit();
    while (try walker.next(io)) |e| {
        if (e.kind == .file and std.mem.eql(u8, e.basename, name)) return std.fs.path.join(a, &.{ root, e.path });
    }
    return error.NoProgram;
}

/// It runs, and it is the version the manifest names.
fn checkStagedVersion(a: std.mem.Allocator, io: std.Io, staged: []const u8, version: []const u8) !void {
    const said = try run(a, io, &.{ staged, "--version" });
    if (std.mem.indexOf(u8, said, version) == null) return error.WrongVersion;
}

/// Deletes what an install on Windows moved aside (`<exe>.old-…`).
fn clearAside(io: std.Io, exe: []const u8) void {
    const dir_path = std.fs.path.dirname(exe) orelse return;
    var dir = std.Io.Dir.cwd().openDir(io, dir_path, .{ .iterate = true }) catch return;
    defer dir.close(io);
    var buf: [256]u8 = undefined;
    const prefix = std.fmt.bufPrint(&buf, "{s}.old-", .{std.fs.path.basename(exe)}) catch return;
    var it = dir.iterate();
    while (it.next(io) catch null) |e| {
        if (std.mem.startsWith(u8, e.name, prefix)) dir.deleteFile(io, e.name) catch {};
    }
}

/// Puts `staged` where `exe` is: a copy beside it first, then a rename over
/// it — on Windows with the old one renamed aside first (a running .exe
/// cannot be replaced, but it can be renamed), mirroring
/// `nanoui.update_portable.swap`.
fn swapOver(a: std.mem.Allocator, io: std.Io, staged: []const u8, exe: []const u8) !void {
    const cwd = std.Io.Dir.cwd();
    const n = std.Thread.getCurrentId();
    const fresh = try std.fmt.allocPrint(a, "{s}.new-{d}", .{ exe, n });
    defer a.free(fresh);
    const data = try cwd.readFileAlloc(io, staged, a, .limited(1 << 30));
    defer a.free(data);
    const perms: std.Io.File.Permissions = if (windows) .default_file else .fromMode(0o755);
    try cwd.writeFile(io, .{ .sub_path = fresh, .data = data, .flags = .{ .permissions = perms } });
    errdefer cwd.deleteFile(io, fresh) catch {};
    if (!windows) return std.Io.Dir.renameAbsolute(fresh, exe, io);
    const old = try std.fmt.allocPrint(a, "{s}.old-{d}", .{ exe, n });
    defer a.free(old);
    try moveFile(a, exe, old);
    moveFile(a, fresh, exe) catch |err| {
        moveFile(a, old, exe) catch {};
        return err;
    };
}

extern "kernel32" fn MoveFileExW(from: [*:0]const u16, to: [*:0]const u16, flags: u32) callconv(.winapi) i32;

/// A rename as Windows lets a running program be renamed (std's rename asks
/// for access the loader's open file refuses).
fn moveFile(a: std.mem.Allocator, from: []const u8, to: []const u8) !void {
    const f = try std.unicode.utf8ToUtf16LeAllocZ(a, from);
    defer a.free(f);
    const t = try std.unicode.utf8ToUtf16LeAllocZ(a, to);
    defer a.free(t);
    if (MoveFileExW(f, t, 1) == 0) return error.FileBusy; // MOVEFILE_REPLACE_EXISTING
}

/// Argv for relaunching `exe` after an install: the program on its own.
/// Nothing is forwarded: headless flags (like `--nanoui-eval`) must not
/// re-run in the fresh app, and this updater defines no persistent CLI
/// flags worth keeping. Pure, so the restart sequencing is unit-testable
/// without spawning anything.
pub fn relaunchArgv(a: std.mem.Allocator, exe: []const u8) ![]const []const u8 {
    const argv = try a.alloc([]const u8, 1);
    argv[0] = exe;
    return argv;
}

/// Starts the installed program on its own (detached stdio; its own process
/// group on posix so it survives our exit), then the caller quits. True when
/// the spawn succeeded, false when the user must relaunch by hand — the
/// install still stands either way. Same spawn shape as
/// `nanoui.update_portable.relaunch`.
pub fn relaunch(io: std.Io, exe: []const u8) bool {
    const argv: []const []const u8 = &.{exe};
    const started = if (windows)
        std.process.spawn(io, .{ .argv = argv, .stdin = .ignore, .stdout = .ignore, .stderr = .ignore })
    else
        std.process.spawn(io, .{ .argv = argv, .stdin = .ignore, .stdout = .ignore, .stderr = .ignore, .pgid = 0 });
    _ = started catch return false;
    return true;
}

// ---- tests ----------------------------------------------------------------

const testing = std.testing;

test "asset names match the release workflow's artifacts" {
    try testing.expectEqualStrings("assetty-macos-arm64.zip", assetFor("macos", "arm64"));
    try testing.expectEqualStrings("assetty-macos-x64.zip", assetFor("macos", "x64"));
    try testing.expectEqualStrings("assetty-windows-x64.zip", assetFor("windows", "x64"));
    try testing.expectEqualStrings("assetty-linux-x64.tar.gz", assetFor("linux", "x64"));
    try testing.expectEqualStrings("assetty-linux-arm64.tar.gz", assetFor("linux", "arm64"));
    // The workflow only publishes these four; anything else is a bug upstream.
    try testing.expectEqualStrings("assetty-unknown", assetFor("linux", "riscv64"));
}

test "feed and release URLs" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    try testing.expectEqualStrings(
        "https://github.com/o/r/releases/latest/download",
        try feedDefault(a, "o/r"),
    );
    try testing.expectEqualStrings(
        "https://github.com/o/r/releases/latest/download/manifest.json",
        try manifestUrl(a, "https://github.com/o/r/releases/latest/download"),
    );
    try testing.expectEqualStrings(
        "https://github.com/o/r/releases/download/v0.2.0/assetty-linux-x64.tar.gz",
        try taggedAssetUrl(a, "o/r", "0.2.0", "assetty-linux-x64.tar.gz"),
    );
    try testing.expectEqualStrings(
        "https://github.com/o/r/releases/tag/v0.2.0",
        try notesUrl(a, "o/r", "0.2.0"),
    );
}

test "newer follows dotted versions, never garbage" {
    try testing.expect(newer("0.2.0", "0.1.0"));
    try testing.expect(newer("0.1.10", "0.1.9"));
    try testing.expect(newer("v1.0", "0.9.9"));
    try testing.expect(!newer("0.1.0-dev", "0.1.0-dev"));
    try testing.expect(!newer("0.1.0", "0.2.0"));
    try testing.expect(!newer("garbage", "0.1.0"));
    try testing.expectEqualStrings("0.1.0", comparable("0.1.0-dev"));
    try testing.expectEqualStrings("0.2.0", comparable("0.2.0+local"));
    try testing.expectEqualStrings("0.2.0", comparable("0.2.0"));
    // A dev build still detects its release: the suffix never compares.
    try testing.expect(newer("0.2.0", comparable("0.1.0-dev")));
}

/// A feed dir on disk: `manifest.json` + its signature + one archive, like a
/// release. The manifest is signed with the test key the updater trusts.
fn makeFeed(a: std.mem.Allocator, io: std.Io, root: []const u8, version: []const u8, asset: []const u8, program_text: []const u8) ![]const u8 {
    const cwd = std.Io.Dir.cwd();
    const prog_name = "assetty-test-prog";
    const folder = try std.fmt.allocPrint(a, "{s}/pack/app-{s}", .{ root, version });
    try cwd.createDirPath(io, folder);
    const prog = try std.fmt.allocPrint(a, "{s}/{s}", .{ folder, prog_name });
    try cwd.writeFile(io, .{ .sub_path = prog, .data = program_text, .flags = .{ .permissions = .fromMode(0o755) } });
    const feed = try std.fmt.allocPrint(a, "{s}/feed", .{root});
    try cwd.createDirPath(io, feed);
    const archive = try std.fmt.allocPrint(a, "{s}/{s}", .{ feed, asset });
    if (std.mem.endsWith(u8, asset, ".tar.gz")) {
        _ = try run(a, io, &.{ tar_bin, "-czf", archive, "-C", try std.fmt.allocPrint(a, "{s}/pack", .{root}), std.fs.path.basename(folder) });
    } else {
        _ = try run(a, io, &.{ "/usr/bin/zip", "-jq", archive, prog });
    }
    const bytes = try cwd.readFileAlloc(io, archive, a, .limited(1 << 20));
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bytes, &digest, .{});
    const manifest = try std.fmt.allocPrint(a, "{{\"version\":\"{s}\",\"files\":{{\"{s}\":{{\"sha256\":\"{s}\"}}}}}}", .{ version, asset, std.fmt.bytesToHex(digest, .lower) });
    try writeSignedManifest(a, io, feed, manifest);
    return std.fmt.allocPrint(a, "file://{s}/feed", .{root});
}

/// Writes `manifest.json` and its detached signature into the feed dir.
fn writeSignedManifest(a: std.mem.Allocator, io: std.Io, feed: []const u8, manifest: []const u8) !void {
    const cwd = std.Io.Dir.cwd();
    try cwd.writeFile(io, .{ .sub_path = try std.fmt.allocPrint(a, "{s}/manifest.json", .{feed}), .data = manifest });
    const sig = try update_key.signForTest(a, io, manifest);
    try cwd.writeFile(io, .{ .sub_path = try std.fmt.allocPrint(a, "{s}/manifest.json.sig", .{feed}), .data = sig });
}

/// Points the updater at the test key pair: the feed helper signs with it,
/// and the verifier must trust its public half.
fn useTestKey() void {
    update_key.useTestKey();
}

test "check: newer release found, same version quiet" {
    useTestKey();
    if (windows) return error.SkipZigTest; // the fake program is a shell script
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const io = testing.io;

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}", .{tmp.sub_path[0..]});
    // Absolute: curl never sees it (file:// reads go straight to disk), but
    // keep it absolute anyway so the URLs stay valid anywhere.
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(io, root, a);
    const asset = "assetty-test.tar.gz";
    const feed = try makeFeed(a, io, abs, "0.2.0", asset, "#!/bin/sh\necho \"assetty 0.2.0\"\n");

    const hit = try check(a, io, feed, "o/r", asset, "0.1.0");
    try testing.expect(hit.available);
    try testing.expectEqualStrings("0.2.0", hit.version);
    try testing.expect(std.mem.indexOf(u8, hit.download_url, asset) != null);
    try testing.expect(std.mem.indexOf(u8, hit.notes_url, "releases/tag/v0.2.0") != null);

    const miss = try check(a, io, feed, "o/r", asset, "0.2.0");
    try testing.expect(!miss.available);
    try testing.expectEqualStrings("0.2.0", miss.version);
}

test "an unsigned or tampered manifest is refused" {
    useTestKey();
    if (windows) return error.SkipZigTest; // the fake program is a shell script
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const io = testing.io;
    const cwd = std.Io.Dir.cwd();

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}", .{tmp.sub_path[0..]});
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(io, root, a);
    const asset = "assetty-test.tar.gz";
    const feed = try makeFeed(a, io, abs, "0.2.0", asset, "#!/bin/sh\necho \"assetty 0.2.0\"\n");
    const manifest_path = try std.fmt.allocPrint(a, "{s}/feed/manifest.json", .{abs});
    const sig_path = try std.fmt.allocPrint(a, "{s}/feed/manifest.json.sig", .{abs});

    // A manifest with no signature at all is not trusted.
    try cwd.deleteFile(io, sig_path);
    try testing.expectError(error.MissingSignature, check(a, io, feed, "o/r", asset, "0.1.0"));

    // A signature over different bytes is not trusted either.
    const manifest = try cwd.readFileAlloc(io, manifest_path, a, .limited(1 << 20));
    const other_sig = try update_key.signForTest(a, io, "{\"version\":\"9.9.9\"}");
    try cwd.writeFile(io, .{ .sub_path = sig_path, .data = other_sig });
    try testing.expectError(error.BadSignature, check(a, io, feed, "o/r", asset, "0.1.0"));

    // Garbage in the signature file is not trusted.
    try cwd.writeFile(io, .{ .sub_path = sig_path, .data = "not a signature" });
    try testing.expectError(error.BadSignature, check(a, io, feed, "o/r", asset, "0.1.0"));

    // The right signature is accepted: the checks above did not break the
    // feed by accident.
    const good_sig = try update_key.signForTest(a, io, manifest);
    try cwd.writeFile(io, .{ .sub_path = sig_path, .data = good_sig });
    const hit = try check(a, io, feed, "o/r", asset, "0.1.0");
    try testing.expect(hit.available);
}

test "apply refuses a bad checksum" {
    useTestKey();
    if (windows) return error.SkipZigTest; // the fake program is a shell script
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const io = testing.io;
    const cwd = std.Io.Dir.cwd();

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}", .{tmp.sub_path[0..]});
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(io, root, a);
    const asset = "assetty-test.tar.gz";
    const feed = try makeFeed(a, io, abs, "0.3.0", asset, "#!/bin/sh\necho \"assetty 0.3.0\"\n");

    // Tamper the archive, not the manifest: the manifest stays signed and
    // valid, so the checksum is what catches the mismatch.
    const archive = try std.fmt.allocPrint(a, "{s}/feed/{s}", .{ abs, asset });
    try cwd.writeFile(io, .{ .sub_path = archive, .data = "not the archive you are looking for" });

    const exe = try std.fmt.allocPrint(a, "{s}/assetty-test-prog", .{abs});
    try cwd.writeFile(io, .{ .sub_path = exe, .data = "#!/bin/sh\necho \"assetty 0.1.0\"\n", .flags = .{ .permissions = .fromMode(0o755) } });
    const cache = try std.fmt.allocPrint(a, "{s}/cache", .{abs});
    try cwd.createDirPath(io, cache);

    switch (apply(a, io, feed, "o/r", asset, "0.1.0", exe, cache)) {
        .failed => |msg| try testing.expect(std.mem.indexOf(u8, msg, "checksum") != null),
        else => return error.TestUnexpectedResult,
    }
    // The old program is untouched.
    const said = try run(a, io, &.{ exe, "--version" });
    try testing.expectEqualStrings("assetty 0.1.0\n", said);
}

test "apply: staged program takes the exe's place" {
    useTestKey();
    if (windows) return error.SkipZigTest; // the fake program is a shell script
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const io = testing.io;
    const cwd = std.Io.Dir.cwd();

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}", .{tmp.sub_path[0..]});
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(io, root, a);
    const asset = "assetty-test.tar.gz";
    const feed = try makeFeed(a, io, abs, "0.2.0", asset, "#!/bin/sh\necho \"assetty 0.2.0\"\n");

    // The "installed" program: a script answering the old version.
    const exe = try std.fmt.allocPrint(a, "{s}/assetty-test-prog", .{abs});
    try cwd.writeFile(io, .{ .sub_path = exe, .data = "#!/bin/sh\necho \"assetty 0.1.0\"\n", .flags = .{ .permissions = .fromMode(0o755) } });
    const cache = try std.fmt.allocPrint(a, "{s}/cache", .{abs});
    try cwd.createDirPath(io, cache);

    switch (apply(a, io, feed, "o/r", asset, "0.1.0", exe, cache)) {
        .installed => |i| try testing.expectEqualStrings("0.2.0", i.version),
        .up_to_date => return error.TestUnexpectedResult,
        .failed => |msg| {
            std.debug.print("apply failed: {s}\n", .{msg});
            return error.TestUnexpectedResult;
        },
    }
    // The exe now reports the new version; the version dir is gone
    // (its empty `updates/` parent may remain).
    const said = try run(a, io, &.{ exe, "--version" });
    try testing.expectEqualStrings("assetty 0.2.0\n", said);
    const vdir = try std.fmt.allocPrint(a, "{s}/updates/0.2.0", .{cache});
    if (cwd.openDir(io, vdir, .{})) |d| {
        var dd = d;
        dd.close(io);
        return error.TestUnexpectedResult; // updates/<version> should be gone
    } else |_| {}

    // Already current: no download, no touch.
    switch (apply(a, io, feed, "o/r", asset, "0.2.0", exe, cache)) {
        .up_to_date => |u| try testing.expectEqualStrings("0.2.0", u.version),
        else => return error.TestUnexpectedResult,
    }
}

test "unpack handles zip archives (the macOS/Windows artifact)" {
    if (windows) return error.SkipZigTest;
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const io = testing.io;
    const cwd = std.Io.Dir.cwd();

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}", .{tmp.sub_path[0..]});
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(io, root, a);
    try cwd.writeFile(io, .{ .sub_path = try std.fmt.allocPrint(a, "{s}/prog", .{abs}), .data = "new" });
    const archive = try std.fmt.allocPrint(a, "{s}/a.zip", .{abs});
    _ = run(a, io, &.{ "/usr/bin/zip", "-jq", archive, try std.fmt.allocPrint(a, "{s}/prog", .{abs}) }) catch
        return error.SkipZigTest; // no zip(1) on this machine
    const dst = try std.fmt.allocPrint(a, "{s}/out", .{abs});
    try cwd.createDirPath(io, dst);
    try unpack(a, io, archive, dst);
    var buf: [8]u8 = undefined;
    try testing.expectEqualStrings("new", try cwd.readFile(io, try std.fmt.allocPrint(a, "{s}/prog", .{dst}), &buf));
}

test "relaunch argv is the program alone, no flags forwarded" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const argv = try relaunchArgv(arena.allocator(), "/opt/assetty/assetty");
    try testing.expectEqual(@as(usize, 1), argv.len);
    try testing.expectEqualStrings("/opt/assetty/assetty", argv[0]);
}

/// A probe "new binary": answers `--version` like a staged release, and with
/// any other argv writes a marker file — proof it actually got launched.
fn probeScript(a: std.mem.Allocator, dir: []const u8, version: []const u8, marker: []const u8) ![]const u8 {
    const prog = try std.fmt.allocPrint(a, "{s}/probe", .{dir});
    const text = try std.fmt.allocPrint(a,
        \\#!/bin/sh
        \\if [ "$1" = "--version" ]; then echo "assetty {s}"; else echo launched > "{s}"; fi
        \\
    , .{ version, marker });
    try std.Io.Dir.cwd().writeFile(testing.io, .{ .sub_path = prog, .data = text, .flags = .{ .permissions = .fromMode(0o755) } });
    return prog;
}

fn waitForFile(io: std.Io, path: []const u8, tries: u32) !void {
    var i: u32 = 0;
    while (i < tries) : (i += 1) {
        std.Io.Dir.cwd().access(io, path, .{}) catch {
            io.sleep(.fromMilliseconds(100), .awake) catch {};
            continue;
        };
        return;
    }
    return error.Timeout;
}

test "relaunch starts the program detached (probe writes its marker)" {
    if (windows) return error.SkipZigTest; // the probe is a shell script
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}", .{tmp.sub_path[0..]});
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(testing.io, root, a);
    const marker = try std.fmt.allocPrint(a, "{s}/launched", .{abs});
    const prog = try probeScript(a, abs, "9.9.9", marker);

    try testing.expect(relaunch(testing.io, prog));
    try waitForFile(testing.io, marker, 50);
}

test "apply then relaunch: the staged program takes over and gets launched" {
    useTestKey();
    if (windows) return error.SkipZigTest; // the fake program is a shell script
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const io = testing.io;
    const cwd = std.Io.Dir.cwd();

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    const root = try std.fmt.allocPrint(a, ".zig-cache/tmp/{s}", .{tmp.sub_path[0..]});
    const abs = try std.Io.Dir.cwd().realPathFileAlloc(io, root, a);
    const marker = try std.fmt.allocPrint(a, "{s}/relaunched", .{abs});
    const asset = "assetty-test.tar.gz";
    const program_text = try std.fmt.allocPrint(a,
        \\#!/bin/sh
        \\if [ "$1" = "--version" ]; then echo "assetty 0.2.0"; else echo launched > "{s}"; fi
        \\
    , .{marker});
    const feed = try makeFeed(a, io, abs, "0.2.0", asset, program_text);

    const exe = try std.fmt.allocPrint(a, "{s}/assetty-test-prog", .{abs});
    try cwd.writeFile(io, .{ .sub_path = exe, .data = "#!/bin/sh\necho \"assetty 0.1.0\"\n", .flags = .{ .permissions = .fromMode(0o755) } });
    const cache = try std.fmt.allocPrint(a, "{s}/cache", .{abs});
    try cwd.createDirPath(io, cache);

    switch (apply(a, io, feed, "o/r", asset, "0.1.0", exe, cache)) {
        .installed => |i| try testing.expectEqualStrings("0.2.0", i.version),
        else => return error.TestUnexpectedResult,
    }
    // The swap landed and the new program launches detached.
    const said = try run(a, io, &.{ exe, "--version" });
    try testing.expectEqualStrings("assetty 0.2.0\n", said);
    try testing.expect(relaunch(io, exe));
    try waitForFile(io, marker, 50);
}

test "relaunch of a missing program fails instead of throwing" {
    try testing.expect(!relaunch(testing.io, "/nonexistent/assetty-test-prog"));
}
