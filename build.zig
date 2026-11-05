const std = @import("std");

/// Files under app/web/dist served to the app's webview, relative to `dist`.
/// Contains a placeholder when the frontend has not been built yet.
pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    // The desktop app shell: nanoui is cross-platform (AppKit/WebKit on
    // macOS, GTK + WebKitGTK via runtime dlopen on Linux, Win32 + WebView2
    // pages on Windows), so `-Dapp` defaults to true everywhere. `-Dapp=false`
    // builds the CLI alone. Nothing extra to link on Linux: both GTK and
    // WebKitGTK are dlopened at runtime, never linked at build time.
    const is_mac = target.result.os.tag == .macos;
    const want_app = b.option(bool, "app", "Build the desktop app shell alongside the CLI") orelse true;
    // Plain `zig build` ships a fast binary; `-Doptimize=Debug` stays available.
    // Default .fast: measured ~25% faster optimize pipeline vs .safe on
    // DamagedHelmet/BoomBox (mobile preset), bit-identical outputs, 79/79 core
    // tests pass. Trade-off: ReleaseFast disables runtime safety (OOB/overflow
    // checks) — malformed inputs may crash instead of erroring cleanly.
    const optimize = b.option(std.builtin.Optimize, "optimize", "Prioritize performance, safety, or binary size") orelse .fast;

    const cgltf_mod = b.addTranslateC(.{
        .root_source_file = b.path("vendor/cgltf/cgltf.h"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    }).createModule();

    const meshopt_mod = b.addTranslateC(.{
        .root_source_file = b.path("vendor/meshoptimizer/meshoptimizer.h"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    }).createModule();

    const basisu_mod = b.addTranslateC(.{
        .root_source_file = b.path("vendor/basisu/basisu_wrapper.h"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    }).createModule();

    const core_mod = b.createModule(.{
        .root_source_file = b.path("core/src/root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
        .imports = &.{
            .{ .name = "cgltf", .module = cgltf_mod },
            .{ .name = "meshopt", .module = meshopt_mod },
            .{ .name = "basisu_c", .module = basisu_mod },
        },
    });
    core_mod.addCSourceFiles(.{
        .root = b.path("vendor"),
        .files = &.{
            "cgltf/cgltf_impl.c",
            "stb/stb_impl.c",
            "basisu/zstd/zstd.c",
        },
        .flags = &.{ "-O3", "-DNDEBUG" },
    });
    // OpenCL is a macOS-only acceleration path (and never enabled at runtime:
    // the wrapper passes use_opencl=false). Everywhere else basisu falls
    // back to CPU (basisu_opencl.cpp compiles to stubs when the define is 0).
    const basisu_opencl_define: []const u8 = if (is_mac) "-DBASISU_SUPPORT_OPENCL=1" else "-DBASISU_SUPPORT_OPENCL=0";
    core_mod.addCSourceFiles(.{
        .root = b.path("vendor"),
        .files = &.{
            "meshoptimizer/quantization.cpp",
            "meshoptimizer/simplifier.cpp",
            "meshoptimizer/allocator.cpp",
            "meshoptimizer/indexcodec.cpp",
            "meshoptimizer/vertexcodec.cpp",
            "meshoptimizer/vertexfilter.cpp",
            // basis_universal v1_60: encoder (ETC1S + UASTC + KTX2) and transcoder
            "basisu/transcoder/basisu_transcoder.cpp",
            "basisu/encoder/3rdparty/android_astc_decomp.cpp",
            "basisu/encoder/3rdparty/tinyexr.cpp",
            "basisu/encoder/basisu_astc_hdr_6x6_enc.cpp",
            "basisu/encoder/basisu_astc_hdr_common.cpp",
            "basisu/encoder/basisu_backend.cpp",
            "basisu/encoder/basisu_basis_file.cpp",
            "basisu/encoder/basisu_bc7enc.cpp",
            "basisu/encoder/basisu_comp.cpp",
            "basisu/encoder/basisu_enc.cpp",
            "basisu/encoder/basisu_etc.cpp",
            "basisu/encoder/basisu_frontend.cpp",
            "basisu/encoder/basisu_gpu_texture.cpp",
            "basisu/encoder/basisu_kernels_sse.cpp",
            "basisu/encoder/basisu_opencl.cpp",
            "basisu/encoder/basisu_pvrtc1_4.cpp",
            "basisu/encoder/basisu_resample_filters.cpp",
            "basisu/encoder/basisu_resampler.cpp",
            "basisu/encoder/basisu_ssim.cpp",
            "basisu/encoder/basisu_uastc_enc.cpp",
            "basisu/encoder/basisu_uastc_hdr_4x4_enc.cpp",
            "basisu/encoder/jpgd.cpp",
            "basisu/encoder/pvpngreader.cpp",
            "basisu/basisu_wrapper.cpp",
        },
        .flags = &.{ "-O3", "-DNDEBUG", "-w", "-std=c++17", basisu_opencl_define },
    });
    if (is_mac) {
        core_mod.linkFramework("OpenCL", .{});
    }

    // Release identity baked into the binary: `zig build -Dversion=0.2.0
    // -Drepo=owner/name`. The release workflow passes both; local builds get
    // dev defaults. Consumed by `assetty --version` and the app's
    // updater bindings (appInfo/updateCheck/updateApply), which expect release
    // assets named per `app/src/update.zig`.
    const version = b.option([]const u8, "version", "Semver of this build (no leading v)") orelse "0.1.0-dev";
    const repo = b.option([]const u8, "repo", "GitHub repo as owner/name (release feed)") orelse "LisovskiyIvan/assetty";

    // `config.has_app` is comptime-known, so a `-Dapp=false` CLI-only build
    // prunes the app branch in main.zig entirely (nanoui is never referenced).
    const config_src = b.addWriteFiles().add("config.zig", b.fmt(
        \\pub const has_app: bool = {s};
        \\pub const version: []const u8 = "{s}";
        \\pub const repo: []const u8 = "{s}";
        \\
    , .{ if (want_app) "true" else "false", version, repo }));
    const config_mod = b.createModule(.{ .root_source_file = config_src });

    const exe_imports: []const std.Build.Module.Import = if (want_app) &.{
        .{ .name = "core", .module = core_mod },
        .{ .name = "config", .module = config_mod },
        .{ .name = "nanoui", .module = b.dependency("nanoui", .{
            .target = target,
            .optimize = optimize,
        }).module("nanoui") },
        .{ .name = "dist_assets", .module = distAssets(b) },
    } else &.{
        .{ .name = "core", .module = core_mod },
        .{ .name = "config", .module = config_mod },
    };

    const exe = b.addExecutable(.{
        .name = "assetty",
        .root_module = b.createModule(.{
            .root_source_file = b.path("main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = exe_imports,
        }),
    });
    b.installArtifact(exe);
    // The Windows backend calls kernel32/user32/gdi32/comdlg32/shell32/ole32
    // directly (nanoui links nothing itself); Zig links the first three by
    // default, the rest are added here.
    if (target.result.os.tag == .windows) {
        for ([_][]const u8{ "comdlg32", "shell32", "ole32" }) |lib| {
            exe.root_module.linkSystemLibrary(lib, .{});
        }
    }

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    const run_step = b.step("run", "Run assetty (no args = desktop app)");
    run_step.dependOn(&run_cmd.step);

    const unit_tests = b.addTest(.{ .root_module = core_mod });
    const run_tests = b.addRunArtifact(unit_tests);
    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_tests.step);

    // ---- desktop app tests -------------------------------------------------
    // Backend impls are platform-independent (the page/IPC glue works wherever
    // nanoui has a webview — macOS, Windows, Linux); they run wherever the
    // host can execute them.
    {
        const app_tests = b.addTest(.{ .root_module = b.createModule(.{
            .root_source_file = b.path("app/src/tests.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "core", .module = core_mod },
                .{ .name = "config", .module = config_mod },
                .{ .name = "nanoui", .module = b.dependency("nanoui", .{
                    .target = target,
                    .optimize = optimize,
                }).module("nanoui") },
                .{ .name = "dist_assets", .module = distAssets(b) },
            },
        }) });
        test_step.dependOn(&b.addRunArtifact(app_tests).step);
    }
}

/// Builds the `dist_assets` module from app/web/dist.
///
/// The module is generated: every file is copied into the module's directory
/// and `@embedFile`d there (Zig only embeds files inside a module's own path),
/// so the binary is self-contained and Vite's hashed names are picked up
/// automatically. app/src/assets.zig turns `entries` into nanoui assets.
fn distAssets(b: *std.Build) *std.Build.Module {
    const dist_rel = "app/web/dist";
    const io = b.graph.io;
    const gpa = b.allocator;

    const Entry = struct { url: []const u8, rel: []const u8 };
    var entries: std.ArrayList(Entry) = .empty;
    // Reconfigure when Vite adds/removes/renames files, so no stale names.
    b.dependOnDirectoryContents(b.path(dist_rel));

    if (std.Io.Dir.cwd().openDir(io, dist_rel, .{ .iterate = true })) |dir_| {
        var dir = dir_;
        defer dir.close(io);
        var walker = dir.walk(gpa) catch @panic("OOM");
        defer walker.deinit();
        while (walker.next(io) catch null) |entry| {
            if (entry.kind == .directory) {
                b.dependOnDirectoryContents(b.path(b.fmt("{s}/{s}", .{ dist_rel, entry.path })));
                continue;
            }
            if (entry.kind != .file) continue;
            entries.append(gpa, .{
                .url = b.fmt("/{s}", .{entry.path}),
                .rel = b.dupe(entry.path),
            }) catch @panic("OOM");
        }
    } else |_| {}

    std.mem.sort(Entry, entries.items, {}, struct {
        fn lt(_: void, x: Entry, y: Entry) bool {
            return std.mem.lessThan(u8, x.url, y.url);
        }
    }.lt);

    const wf = b.addWriteFiles();
    var aw: std.Io.Writer.Allocating = .init(gpa);
    const w = &aw.writer;
    w.writeAll("pub const Entry = struct { url: []const u8, data: []const u8 };\n") catch @panic("OOM");
    w.writeAll("pub const entries = [_]Entry{\n") catch @panic("OOM");
    for (entries.items) |e| {
        if (std.mem.eql(u8, e.url, "/index.html")) {
            const raw = std.Io.Dir.cwd().readFileAlloc(io, b.fmt("{s}/{s}", .{ dist_rel, e.rel }), gpa, .limited(64 * 1024 * 1024)) catch
                @panic("assetty: cannot read app/web/dist/index.html");
            _ = wf.add(e.rel, patchIndex(gpa, raw));
        } else {
            // Copy next to the generated source so @embedFile stays in-package.
            _ = wf.addCopyFile(b.path(b.fmt("{s}/{s}", .{ dist_rel, e.rel })), e.rel);
        }
        w.print("    .{{ .url = \"{s}\", .data = @embedFile(\"{s}\") }},\n", .{ e.url, e.rel }) catch
            @panic("OOM");
    }
    w.writeAll("};\n") catch @panic("OOM");

    return b.createModule(.{ .root_source_file = wf.add("assets.zig", aw.written()) });
}

/// The webview only exposes nanoui's `window.nanoui.call/on`. The frontend
/// probes for a host object with callable methods (or `invoke`), so inject the
/// thinnest adapter before any page script runs. Drop this once the frontend
/// speaks `window.nanoui.call` directly.
const host_shim =
    \\<script>
    \\(function () {
    \\  var n = window.nanoui;
    \\  if (!n || typeof n.call !== "function" || window.assetty) return;
    \\  var on = function (name, fn) { return n.on(name, fn); };
    \\  window.assetty = new Proxy({ on: on, subscribe: on, addEventListener: on }, {
    \\    get: function (t, k) {
    \\      if (k in t) return t[k];
    \\      if (typeof k !== "string" || k === "then" || k === "toJSON") return undefined;
    \\      return function () { return n.call("Backend." + k, ...arguments); };
    \\    },
    \\    has: function () { return true; }
    \\  });
    \\})();
    \\</script>
    \\
;

fn patchIndex(gpa: std.mem.Allocator, html: []const u8) []const u8 {
    // Right after <head> so the shim exists before the app's module script.
    const at = if (std.mem.indexOf(u8, html, "<head>")) |i|
        i + "<head>".len
    else if (std.mem.indexOf(u8, html, "<head ")) |i|
        (std.mem.indexOfScalarPos(u8, html, i, '>') orelse i) + 1
    else if (std.mem.indexOf(u8, html, "<script")) |i|
        i
    else
        return html;

    var aw: std.Io.Writer.Allocating = .init(gpa);
    aw.writer.writeAll(html[0..at]) catch @panic("OOM");
    aw.writer.writeAll(host_shim) catch @panic("OOM");
    aw.writer.writeAll(html[at..]) catch @panic("OOM");
    return aw.written();
}
