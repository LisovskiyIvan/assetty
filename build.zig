const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

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
        .flags = &.{"-O2"},
    });
    core_mod.addCSourceFiles(.{
        .root = b.path("vendor"),
        .files = &.{
            "meshoptimizer/quantization.cpp",
            "meshoptimizer/simplifier.cpp",
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
        .flags = &.{ "-O2", "-w", "-std=c++17", "-DBASISU_SUPPORT_OPENCL=1" },
    });
    if (target.result.os.tag == .macos) {
        core_mod.linkFramework("OpenCL", .{});
    }

    const exe = b.addExecutable(.{
        .name = "assetty",
        .root_module = b.createModule(.{
            .root_source_file = b.path("cli/src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "core", .module = core_mod },
            },
        }),
    });
    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    const run_step = b.step("run", "Run assetty CLI");
    run_step.dependOn(&run_cmd.step);

    const unit_tests = b.addTest(.{ .root_module = core_mod });
    const run_tests = b.addRunArtifact(unit_tests);
    const test_step = b.step("test", "Run core tests");
    test_step.dependOn(&run_tests.step);
}
