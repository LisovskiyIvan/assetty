//! The release signing key: Ed25519 signatures over release manifests.
//!
//! Every release publishes `manifest.json` (the version plus the sha256 of
//! each platform archive) next to a detached Ed25519 signature of it,
//! `manifest.json.sig`. The signature is what makes the feed trustworthy:
//! the manifest is only believed when it carries a signature made with the
//! private key that only the release workflow holds. A checksum alone would
//! only prove that the archive matches the manifest — not that either came
//! from this project.
//!
//! The public key is compiled into the app, so a tampered or substituted
//! feed is rejected before any of its content is used.
//!
//! One-time setup by the maintainer:
//!
//!   1. `zig build update-keygen` — prints a seed (the private half) and
//!      the matching public key hex.
//!   2. Paste the public key hex into `default_public_key_hex` below.
//!   3. Store the seed as the repository secret `ASSETTY_UPDATE_SEED`; the
//!      release workflow signs every manifest with it (`zig build
//!      sign-manifest -- out/manifest.json`).
//!
//! An empty public key disables the updater: a build without the project's
//! key cannot tell a real release from a tampered feed, so it refuses to
//! install anything rather than trusting an unauthenticated one.
const std = @import("std");

/// The project's Ed25519 public key, hex (64 chars). Empty = the updater is
/// disabled in every build.
///
/// Rotate with `zig build update-keygen`: put the new public key here and
/// the new seed into the `ASSETTY_UPDATE_SEED` repository secret.
pub const default_public_key_hex: []const u8 = "c6b30c3646ca58660f5c1933c38095b84b2fccc4fef4b8b2b3ba8d204d5f28e7";

/// The key the app trusts. A `var` so tests can point the updater at their
/// own key pair; the shipped build uses `default_public_key_hex`.
pub var public_key_hex: []const u8 = default_public_key_hex;

pub const Error = error{
    /// The key is not valid hex of the expected length.
    InvalidKey,
    /// The signature is not valid hex of the expected length.
    InvalidSignature,
    /// The signature does not match the message and key.
    BadSignature,
} || std.mem.Allocator.Error;

/// The hex Ed25519 seed: the private half of the release key. Kept out of
/// the repository (it lives in the release workflow's secret store).
pub const SeedHexLen = 64;

/// The hex public key length (32 bytes, hex-encoded).
pub const PublicKeyHexLen = 64;

/// The hex signature length (64 bytes, hex-encoded).
pub const SignatureHexLen = 128;

/// Decodes `hex` into `out`. False means a wrong length or a non-hex
/// digit; the caller says which half of the key material is broken.
fn hexToBytes(out: []u8, hex: []const u8) bool {
    if (hex.len != out.len * 2) return false;
    _ = std.fmt.hexToBytes(out, hex) catch return false;
    return true;
}

/// Verifies a hex Ed25519 signature (`sig_hex`, 128 chars) over `message`
/// with the hex public key `key_hex` (64 chars).
///
/// The two failure kinds stay apart: a broken key is a broken build, a
/// broken signature is a broken feed.
pub fn verify(key_hex: []const u8, message: []const u8, sig_hex: []const u8) Error!void {
    if (key_hex.len != PublicKeyHexLen) return error.InvalidKey;
    if (sig_hex.len != SignatureHexLen) return error.InvalidSignature;
    var key: [32]u8 = undefined;
    if (!hexToBytes(&key, key_hex)) return error.InvalidKey;
    var sig_bytes: [64]u8 = undefined;
    if (!hexToBytes(&sig_bytes, sig_hex)) return error.InvalidSignature;
    const pk = std.crypto.sign.Ed25519.PublicKey.fromBytes(key) catch return error.InvalidKey;
    const sig = std.crypto.sign.Ed25519.Signature.fromBytes(sig_bytes);
    sig.verify(message, pk) catch return error.BadSignature;
}

/// The raw public key of a hex seed.
pub fn publicKeyFromSeed(seed_hex: []const u8) Error![32]u8 {
    if (seed_hex.len != SeedHexLen) return error.InvalidKey;
    var seed: [32]u8 = undefined;
    if (!hexToBytes(&seed, seed_hex)) return error.InvalidKey;
    const kp = std.crypto.sign.Ed25519.KeyPair.generateDeterministic(seed) catch return error.InvalidKey;
    return kp.public_key.toBytes();
}

/// Signs `message` with the hex Ed25519 seed (`seed_hex`) and returns the
/// hex signature.
pub fn sign(a: std.mem.Allocator, io: std.Io, seed_hex: []const u8, message: []const u8) ![]const u8 {
    if (seed_hex.len != SeedHexLen) return error.InvalidKey;
    var seed: [32]u8 = undefined;
    if (!hexToBytes(&seed, seed_hex)) return error.InvalidKey;
    const kp = std.crypto.sign.Ed25519.KeyPair.generateDeterministic(seed) catch return error.InvalidKey;
    var signer = kp.signer(null, io) catch return error.InvalidKey;
    signer.update(message);
    const sig = signer.finalize();
    const raw = sig.toBytes();
    const hex = try a.alloc(u8, raw.len * 2);
    _ = std.fmt.bufPrint(hex, "{s}", .{std.fmt.bytesToHex(raw, .lower)}) catch unreachable;
    return hex;
}

/// A fresh random seed (hex) for a new key pair.
pub fn generateSeed(a: std.mem.Allocator, io: std.Io) ![]const u8 {
    var seed: [32]u8 = undefined;
    io.random(&seed);
    const hex = try a.alloc(u8, seed.len * 2);
    _ = std.fmt.bufPrint(hex, "{s}", .{std.fmt.bytesToHex(seed, .lower)}) catch unreachable;
    return hex;
}

/// The test key pair: a fixed seed, so every test signs with the same key
/// and the trusted public key can be derived from it.
pub const test_seed = "1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100";

/// Backing storage for the test key: a static buffer, so switching the
/// trusted key allocates nothing (the tests run under a leak checker).
var test_key_buf: [64]u8 = undefined;

/// Points the trusted key at the test key pair: the feed helpers sign with
/// `test_seed`, and the verifier must trust its public half.
///
/// Test-only: the shipped binary always trusts `default_public_key_hex`.
pub fn useTestKey() void {
    const pub_bytes = publicKeyFromSeed(test_seed) catch unreachable;
    _ = std.fmt.bufPrint(&test_key_buf, "{s}", .{std.fmt.bytesToHex(pub_bytes, .lower)}) catch unreachable;
    public_key_hex = &test_key_buf;
}

/// Signs `message` with the test seed (the feed helper's counterpart).
pub fn signForTest(a: std.mem.Allocator, io: std.Io, message: []const u8) ![]const u8 {
    return sign(a, io, test_seed, message);
}

test "sign then verify round-trips" {
    const a = std.testing.allocator;
    const seed = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const pub_hex = try a.dupe(u8, &std.fmt.bytesToHex(try publicKeyFromSeed(seed), .lower));
    defer a.free(pub_hex);

    const msg = "{\"version\":\"0.2.0\"}";
    const sig_hex = try sign(a, std.testing.io, seed, msg);
    defer a.free(sig_hex);
    try verify(pub_hex, msg, sig_hex);

    // A tampered message does not verify.
    try std.testing.expectError(error.BadSignature, verify(pub_hex, "{evil}", sig_hex));
    // A wrong key does not verify.
    var wrong_key: [64]u8 = @splat('0');
    try std.testing.expectError(error.BadSignature, verify(&wrong_key, msg, sig_hex));
    // Garbage hex is rejected, not treated as a valid key.
    try std.testing.expectError(error.InvalidKey, verify("zz", msg, sig_hex));
    // A broken key and a broken signature are told apart: the first is a
    // broken build, the second a broken feed.
    try std.testing.expectError(error.InvalidSignature, verify(pub_hex, msg, "zz"));
    try std.testing.expectError(error.InvalidSignature, verify(pub_hex, msg, "00"));
}
