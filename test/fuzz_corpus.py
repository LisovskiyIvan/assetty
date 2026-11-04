#!/usr/bin/env python3
"""Build a corruption corpus from valid GLBs.

Each output must be handled gracefully (clean error, exit 2) — never a
crash, hang, or silent accept as valid. Covers: truncation, bad magic,
broken lengths, header flips, JSON text patches, cyclic node parents,
out-of-range accessor refs, oversized buffer_view byteLength.
"""
import os
import random
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = [
    "fixtures/box.glb",
    "fixtures/real/Box.glb",
    "fixtures/real/BoxTextured.glb",
    "fixtures/real/DamagedHelmet.glb",
]
OUT = os.path.join(HERE, "corpus")
N_PER_CLASS = 12


def read(p):
    with open(os.path.join(HERE, p), "rb") as f:
        return f.read()


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data)


def glb_split(data):
    """(header12, json_bytes, bin_bytes) or None if not a GLB."""
    if len(data) < 12 or data[:4] != b"glTF":
        return None
    total = struct.unpack("<I", data[8:12])[0]
    off = 12
    if off + 8 > len(data):
        return None
    jlen, jtype = struct.unpack("<II", data[off : off + 8])
    jstart = off + 8
    json_b = data[jstart : jstart + jlen]
    off = jstart + jlen
    bin_b = b""
    if off + 8 <= len(data):
        blen, btype = struct.unpack("<II", data[off : off + 8])
        if btype == 0x004E4942:
            bin_b = data[off + 8 : off + 8 + blen]
    return data[:12], json_b, bin_b


def glb_join(header12, json_b, bin_b):
    jp = (len(json_b) + 3) & ~3
    json_p = json_b + b" " * (jp - len(json_b))
    out = bytearray()
    out += header12[:4] + struct.pack("<II", 2, 0)  # magic, version, len fixed below
    out += struct.pack("<II", jp, 0x4E4F534A) + json_p
    if bin_b:
        bp = (len(bin_b) + 3) & ~3
        out += struct.pack("<II", bp, 0x004E4942) + bin_b + b"\0" * (bp - len(bin_b))
    out[8:12] = struct.pack("<I", len(out))
    return bytes(out)


def main():
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 0xA55E77
    rng = random.Random(seed)
    if os.path.isdir(OUT):
        for f in os.listdir(OUT):
            os.remove(os.path.join(OUT, f))
    n = 0

    for si, src in enumerate(SRC):
        base = f"s{si}-" + os.path.basename(src).replace(".glb", "")
        try:
            data = read(src)
        except FileNotFoundError:
            continue
        write(f"{base}-valid.glb", data)
        n += 1
        parts = glb_split(data)
        if parts is None:
            continue
        hdr, js, bn = parts

        # 1. truncation at random offsets (+ empty + 1..20 bytes)
        for i in range(N_PER_CLASS):
            cut = rng.choice([0, 1, 5, 11, 12, 13, 20, rng.randrange(len(data))])
            write(f"{base}-trunc{i:02d}.glb", data[:cut])
            n += 1

        # 2. random byte flips in header / json / bin regions
        for i in range(N_PER_CLASS):
            b = bytearray(data)
            for _ in range(rng.randint(1, 4)):
                pos = rng.randrange(len(b))
                b[pos] = rng.randrange(256)
            write(f"{base}-flip{i:02d}.glb", bytes(b))
            n += 1

        # 3. bad magic / version / huge declared total length
        for i, patch in enumerate(
            [b"glFX", b"\x00\x00\x00\x00", b"glTf", b"glb\x00", b"GLTF"]
        ):
            b = bytearray(data)
            b[0:4] = patch
            write(f"{base}-magic{i:02d}.glb", bytes(b))
            n += 1
        for i, ver in enumerate([1, 0, 0xFFFFFFFF, 3]):
            b = bytearray(data)
            b[4:8] = struct.pack("<I", ver)
            write(f"{base}-ver{i:02d}.glb", bytes(b))
            n += 1
        for i, ln in enumerate([0, 12, 0xFFFFFFFF, 0x7FFFFFFF, len(data) + 100]):
            b = bytearray(data)
            b[8:12] = struct.pack("<I", ln)
            write(f"{base}-len{i:02d}.glb", bytes(b))
            n += 1

        # 4. chunk type/length lies
        b = bytearray(data)
        if len(b) >= 20:
            b[12:16] = struct.pack("<I", 0xFFFFFFFF)
            write(f"{base}-chunklen0.glb", bytes(b))
            n += 1
            b2 = bytearray(data)
            b2[16:20] = struct.pack("<I", 0xDEADBEEF)
            write(f"{base}-chunktype0.glb", bytes(b2))
            n += 1

        # 5. JSON text patches: negative counts, huge counts, bad refs
        try:
            text = js.decode("utf-8", "replace")
        except Exception:
            continue
        patches = [
            ('"count"', '"count":-1', 1),
            ('"byteLength"', '"byteLength":4294967295', 1),
            ('"byteOffset"', '"byteOffset":4294967295', 1),
            ('"bufferView"', '"bufferView":99999', 1),
            ('"accessor"', '"accessor":99999', 0),
            ('"mesh"', '"mesh":99999', 1),
            ('"node"', '"node":99999', 0),
            ('"children"', '"children":[99999]', 0),
            ('"COUNT"', '"count"', 0),  # no-op control (valid file, renamed key ignored)
        ]
        for i, (old, new, _) in enumerate(patches):
            if old in text:
                write(f"{base}-json{i:02d}.glb", glb_join(hdr, text.replace(old, new).encode(), bn))
                n += 1
        # cyclic node parents: every node lists node 0 as child, node 0 lists itself
        if '"nodes"' in text and '"children"' in text:
            import re

            cyc = re.sub(r'"children"\s*:\s*\[[^\]]*\]', '"children":[0]', text, count=1)
            write(f"{base}-cyclic.glb", glb_join(hdr, cyc.encode(), bn))
            n += 1
        # empty json
        write(f"{base}-emptyjson.glb", glb_join(hdr, b"{}", bn))
        n += 1
        # json not an object
        write(f"{base}-jsonarray.glb", glb_join(hdr, b"[]", bn))
        n += 1

        # 6. oversized buffer_view byteLength (valid json otherwise)
        if bn:
            big = bytearray(bn) + b"\x00" * 64
            write(f"{base}-bigbin.glb", glb_join(hdr, js, bytes(big)))
            n += 1

    print(f"wrote {n} corpus files to {OUT}")


if __name__ == "__main__":
    main()
