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

    const core_mod = b.createModule(.{
        .root_source_file = b.path("core/src/root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
        .imports = &.{
            .{ .name = "cgltf", .module = cgltf_mod },
            .{ .name = "meshopt", .module = meshopt_mod },
        },
    });
    core_mod.addCSourceFiles(.{
        .root = b.path("vendor"),
        .files = &.{
            "cgltf/cgltf_impl.c",
            "stb/stb_impl.c",
            "meshoptimizer/quantization.cpp",
            "meshoptimizer/simplifier.cpp",
        },
        .flags = &.{"-O2"},
    });

    const exe = b.addExecutable(.{
        .name = "basset",
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
    const run_step = b.step("run", "Run basset CLI");
    run_step.dependOn(&run_cmd.step);

    const unit_tests = b.addTest(.{ .root_module = core_mod });
    const run_tests = b.addRunArtifact(unit_tests);
    const test_step = b.step("test", "Run core tests");
    test_step.dependOn(&run_tests.step);
}
