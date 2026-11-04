#!/usr/bin/env python3
"""Generate /tmp/big_grid.glb — large NON-indexed grid: per-triangle vertices
(duplicated positions) so weld has real work. N=NN env var (default 300 =>
300*300*2 triangles, ~540K verts)."""
import json, struct, os, sys

N = int(os.environ.get("NN", "300"))
tris = []
S = 1.0 / N
for y in range(N):
    for x in range(N):
        x0, x1 = x * S, (x + 1) * S
        y0, y1 = y * S, (y + 1) * S
        tris.append((x0, y0, x1, y0, x0, y1))
        tris.append((x1, y0, x1, y1, x0, y1))

verts = []  # non-indexed: 3 verts per tri
for (x0, y0, x1, y1, x2, y2) in tris:
    verts += [(x0, y0, 0), (x1, y0, 0), (x2, y1, 0)]
vc = len(verts)
idx = list(range(vc))

pos = b"".join(struct.pack("<fff", *v) for v in verts)
nrm = b"".join(struct.pack("<fff", 0, 0, 1) for _ in range(vc))
ind = b"".join(struct.pack("<I", i) for i in idx)

j = {
    "asset": {"version": "2.0"},
    "scenes": [{"nodes": [0]}],
    "scene": 0,
    "nodes": [{"mesh": 0}],
    "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "mode": 4}]}],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": vc, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 0]},
        {"bufferView": 1, "componentType": 5126, "count": vc, "type": "VEC3"},
        {"bufferView": 2, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
    ],
    "bufferViews": [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
        {"buffer": 0, "byteOffset": len(pos), "byteLength": len(nrm), "target": 34962},
        {"buffer": 0, "byteOffset": len(pos) + len(nrm), "byteLength": len(ind), "target": 34963},
    ],
    "buffers": [{"byteLength": len(pos) + len(nrm) + len(ind)}],
}
js = json.dumps(j, separators=(",", ":")).encode()
binp = pos + nrm + ind
jsp = js + b"\x00" * ((4 - len(js) % 4) % 4)
bp = binp + b"\x00" * ((4 - len(binp) % 4) % 4)
total = 12 + 8 + len(jsp) + 8 + len(bp)
out = b"glTF" + struct.pack("<II", 2, total)
out += struct.pack("<II", len(jsp), 0x4E4F534A) + jsp
out += struct.pack("<II", len(bp), 0x004E4942) + bp
open("/tmp/big_grid.glb", "wb").write(out)
print(f"verts={vc} tris={len(tris)} bytes={len(out)}")
