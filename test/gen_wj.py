#!/usr/bin/env python3
"""Generate test/fixtures/weld_join_target.glb — fixture for the weld/join ops.

Contents (one mesh, four primitives):
  * prim A: indexed triangles, material 0 — two clean quads plus a third quad
    whose first two vertices are byte-identical copies of prim A's vertices
    0 and 1 (the "seam duplicate" weld must collapse),
  * prim B: indexed triangles, material 0 — same shape as A on other faces,
    so join can merge A + B,
  * prim C: NON-indexed triangles, material 0 — join must leave it alone,
  * prim D: indexed triangles, material 1 — join must leave it alone (other
    material), weld finds no duplicates.

All primitives carry POSITION / NORMAL / TEXCOORD_0.

Expected results:
  * weld:  A 12 -> 10, B 12 -> 10 (4 vertices removed, 2 prims rewritten)
  * join:  material-0 group A+B -> one 24-vertex / 36-index primitive,
           primitives 4 -> 3 (1 merged prim, 1 rewritten mesh)

Run: python3 test/gen_wj.py [out.glb]
"""
import json
import os
import struct
import sys

S = 0.5

# (normal, u axis, v axis, origin) per cube face
FACES = [
    ((0, 0, 1), (1, 0, 0), (0, 1, 0), (-S, -S, S)),
    ((1, 0, 0), (0, 0, -1), (0, 1, 0), (S, -S, S)),
    ((0, 0, -1), (-1, 0, 0), (0, 1, 0), (S, -S, -S)),
    ((-1, 0, 0), (0, 0, 1), (0, 1, 0), (-S, -S, -S)),
    ((0, 1, 0), (1, 0, 0), (0, 0, -1), (-S, S, S)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1), (-S, -S, -S)),
]


def face(fi):
    """Four (position, normal, uv) corners of a cube face."""
    n, u, v, o = FACES[fi]
    out = []
    for ui, vi in [(0, 0), (1, 0), (1, 1), (0, 1)]:
        out.append((
            (o[0] + u[0] * ui + v[0] * vi,
             o[1] + u[1] * ui + v[1] * vi,
             o[2] + u[2] * ui + v[2] * vi),
            n,
            (ui, vi),
        ))
    return out


def quad_indices(base):
    return [base, base + 1, base + 2, base, base + 2, base + 3]


def seam_pair():
    """Primitive vertex layout: quad0, quad1, then a quad reusing quad0's
    first two vertices verbatim (byte-identical duplicates) and adding two."""
    f0, f1, f2 = face(0), face(1), face(2)
    verts = f0 + f1 + [f0[0], f0[1], f2[2], f2[3]]
    idx = quad_indices(0) + quad_indices(4) + quad_indices(8)
    return verts, idx


blob = bytearray()
views = []
accessors = []


def view(data, target=None):
    while len(blob) % 4:
        blob.append(0)
    off = len(blob)
    blob.extend(data)
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target:
        v["target"] = target
    views.append(v)
    return len(views) - 1


def f32buf(flat):
    return struct.pack("<%df" % len(flat), *flat)


def u16buf(flat):
    return struct.pack("<%dH" % len(flat), *flat)


def add_acc(vi, ctype, count, typ, lo=None, hi=None):
    a = {"bufferView": vi, "componentType": ctype, "count": count, "type": typ}
    if lo is not None:
        a["min"] = lo
    if hi is not None:
        a["max"] = hi
    accessors.append(a)
    return len(accessors) - 1


def add_prim(verts, idx):
    """Register POSITION/NORMAL/TEXCOORD_0 (+ optional indices) accessors."""
    pos = [c for p, _, _ in verts for c in p]
    nrm = [c for _, n, _ in verts for c in n]
    uv = [c for _, _, t in verts for c in t]
    lo = [min(p[k] for p, _, _ in verts) for k in range(3)]
    hi = [max(p[k] for p, _, _ in verts) for k in range(3)]
    attrs = {
        "POSITION": add_acc(view(f32buf(pos), 34962), 5126, len(verts), "VEC3", lo, hi),
        "NORMAL": add_acc(view(f32buf(nrm), 34962), 5126, len(verts), "VEC3"),
        "TEXCOORD_0": add_acc(view(f32buf(uv), 34962), 5126, len(verts), "VEC2"),
    }
    prim = {"attributes": attrs}
    if idx is not None:
        prim["indices"] = add_acc(view(u16buf(idx), 34963), 5123, len(idx), "SCALAR")
    return prim


# prim A: two quads + a quad that reuses quad0's first two vertices verbatim,
# i.e. two byte-identical seam duplicates.
verts_a, idx_a = seam_pair()
# prim B: same seam trick on other faces (partners with A for join).
f3, f4, f5 = face(3), face(4), face(5)
verts_b = f3 + f4 + [f3[0], f3[1], f5[2], f5[3]]
idx_b = quad_indices(0) + quad_indices(4) + quad_indices(8)
# prim C: non-indexed triangle (weld + join must skip it).
verts_c = face(0)[:3]

prim_a = add_prim(verts_a, idx_a)
prim_a["material"] = 0
prim_b = add_prim(verts_b, idx_b)
prim_b["material"] = 0
prim_c = add_prim(verts_c, None)
prim_c["material"] = 0
prim_d = add_prim(face(2), quad_indices(0))
prim_d["material"] = 1

mat_main = {
    "name": "mat_main",
    "pbrMetallicRoughness": {
        "baseColorFactor": [0.8, 0.8, 0.8, 1.0],
        "metallicFactor": 0.0,
        "roughnessFactor": 0.5,
    },
}
mat_side = {
    "name": "mat_side",
    "pbrMetallicRoughness": {
        "baseColorFactor": [0.9, 0.2, 0.1, 1.0],
        "metallicFactor": 0.0,
        "roughnessFactor": 0.8,
    },
}

gltf = {
    "asset": {"version": "2.0", "generator": "basset weld/join fixture gen"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"name": "WeldJoinBox", "mesh": 0}],
    "meshes": [{"name": "WeldJoinBox", "primitives": [prim_a, prim_b, prim_c, prim_d]}],
    "materials": [mat_main, mat_side],
    "buffers": [{"byteLength": len(blob)}],
    "bufferViews": views,
    "accessors": accessors,
}


def pad4(b, fill=b"\x00"):
    return b + fill * ((4 - len(b) % 4) % 4)


js = pad4(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
bin_chunk = pad4(bytes(blob))

out = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(js) + 8 + len(bin_chunk))
out += struct.pack("<II", len(js), 0x4E4F534A) + js
out += struct.pack("<II", len(bin_chunk), 0x004E4942) + bin_chunk

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), "fixtures", "weld_join_target.glb")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "wb") as f:
    f.write(out)
print(f"{path}: {len(out)} bytes "
      f"({len(accessors)} accessors, {len(views)} bufferViews, "
      f"{len(gltf['meshes'][0]['primitives'])} primitives)")
