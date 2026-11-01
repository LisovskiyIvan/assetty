#!/usr/bin/env python3
"""Generate test/fixtures/dup.glb — duplicate-heavy asset for dedup + writer GC.

Contents:
  * one box, with every accessor (indices / positions / normals / uvs) stored
    twice in separate buffer views (byte-identical pairs),
  * two meshes referencing those duplicated accessors (mesh primitives are
    therefore structurally identical),
  * two scene nodes, one per mesh (so both meshes are reachable and the GC can
    only drop a mesh after dedup rewrote one node onto the other),
  * three byte-identical materials plus one unreferenced garbage material,
  * one garbage node (not in any scene) pointing at a garbage mesh, which in
    turn uses a garbage accessor pair and the garbage material.

Run: python3 test/gen_dup.py [out.glb]
"""
import json
import math
import os
import struct
import sys


def pad4(b, fill=b'\x00'):
    return b + fill * ((4 - len(b) % 4) % 4)


def cube(s=0.5):
    faces = [
        ((0, 0, 1), (1, 0, 0), (0, 1, 0), (-s, -s, s)),
        ((1, 0, 0), (0, 0, -1), (0, 1, 0), (s, -s, s)),
        ((0, 0, -1), (-1, 0, 0), (0, 1, 0), (s, -s, -s)),
        ((-1, 0, 0), (0, 0, 1), (0, 1, 0), (-s, -s, -s)),
        ((0, 1, 0), (1, 0, 0), (0, 0, -1), (-s, s, s)),
        ((0, -1, 0), (1, 0, 0), (0, 0, 1), (-s, -s, -s)),
    ]
    pos, nrm, uv, idx = [], [], [], []
    for n, u, v, origin in faces:
        base = len(pos)
        for ui, vi in [(0, 0), (1, 0), (1, 1), (0, 1)]:
            pos.append([origin[0] + u[0] * ui + v[0] * vi,
                        origin[1] + u[1] * ui + v[1] * vi,
                        origin[2] + u[2] * ui + v[2] * vi])
            nrm.append(list(n))
            uv.append([ui, vi])
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return pos, nrm, uv, idx


def f32buf(flat):
    return struct.pack('<%df' % len(flat), *flat)


def u16buf(flat):
    return struct.pack('<%dH' % len(flat), *flat)


pos, nrm, uv, idx = cube()

blob = bytearray()


def view(data, target=None):
    while len(blob) % 4:
        blob.append(0)
    off = len(blob)
    blob.extend(data)
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target:
        v["target"] = target
    return v


pos_b = f32buf([c for p in pos for c in p])
nrm_b = f32buf([c for n in nrm for c in n])
uv_b = f32buf([c for t in uv for c in t])
idx_b = u16buf(idx)

# box geometry, stored twice
v_idx_a = view(idx_b, 34963)
v_pos_a = view(pos_b, 34962)
v_nrm_a = view(nrm_b, 34962)
v_uv_a = view(uv_b, 34962)
v_idx_b = view(idx_b, 34963)
v_pos_b = view(pos_b, 34962)
v_nrm_b = view(nrm_b, 34962)
v_uv_b = view(uv_b, 34962)

# garbage triangle (only reachable from the garbage node)
g_pos_b = f32buf([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0])
g_idx_b = u16buf([0, 1, 2])
v_g_pos = view(g_pos_b, 34962)
v_g_idx = view(g_idx_b, 34963)

views = [v_idx_a, v_pos_a, v_nrm_a, v_uv_a,
         v_idx_b, v_pos_b, v_nrm_b, v_uv_b,
         v_g_pos, v_g_idx]


def acc(vi, ctype, count, typ, lo=None, hi=None):
    a = {"bufferView": vi, "componentType": ctype, "count": count, "type": typ}
    if lo is not None:
        a["min"] = lo
    if hi is not None:
        a["max"] = hi
    return a


accessors = [
    acc(0, 5123, len(idx), "SCALAR"),
    acc(1, 5126, len(pos), "VEC3", [-0.5] * 3, [0.5] * 3),
    acc(2, 5126, len(nrm), "VEC3"),
    acc(3, 5126, len(uv), "VEC2"),
    acc(4, 5123, len(idx), "SCALAR"),
    acc(5, 5126, len(pos), "VEC3", [-0.5] * 3, [0.5] * 3),
    acc(6, 5126, len(nrm), "VEC3"),
    acc(7, 5126, len(uv), "VEC2"),
    acc(8, 5126, 3, "VEC3", [0.0, 0.0, 0.0], [1.0, 1.0, 0.0]),
    acc(9, 5123, 3, "SCALAR"),
]

dup_mat = {
    "name": "mat_dup",
    "pbrMetallicRoughness": {
        "baseColorFactor": [0.8, 0.8, 0.8, 1.0],
        "metallicFactor": 0.0,
        "roughnessFactor": 0.5,
    },
}

gltf = {
    "asset": {"version": "2.0", "generator": "basset dup fixture gen"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [
        {"name": "Root", "children": [1, 2]},
        {"name": "DupA", "mesh": 0, "translation": [-1.2, 0.0, 0.0]},
        {"name": "DupB", "mesh": 1, "translation": [1.2, 0.0, 0.0]},
        {"name": "Garbage", "mesh": 2, "translation": [0.0, 5.0, 0.0]},
    ],
    "meshes": [
        {"name": "DupMesh", "primitives": [{
            "attributes": {"POSITION": 1, "NORMAL": 2, "TEXCOORD_0": 3},
            "indices": 0, "material": 0}]},
        {"name": "DupMesh", "primitives": [{
            "attributes": {"POSITION": 5, "NORMAL": 6, "TEXCOORD_0": 7},
            "indices": 4, "material": 1}]},
        {"name": "GarbageMesh", "primitives": [{
            "attributes": {"POSITION": 8}, "indices": 9, "material": 3}]},
    ],
    "materials": [
        dict(dup_mat),
        dict(dup_mat),
        dict(dup_mat),
        {"name": "mat_garbage", "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 0.0, 0.0, 1.0], "metallicFactor": 1.0}},
    ],
    "buffers": [{"byteLength": len(blob)}],
    "bufferViews": views,
    "accessors": accessors,
}

js = pad4(json.dumps(gltf, separators=(',', ':')).encode(), b' ')
bin_chunk = pad4(bytes(blob))

out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(bin_chunk))
out += struct.pack('<II', len(js), 0x4E4F534A) + js
out += struct.pack('<II', len(bin_chunk), 0x004E4942) + bin_chunk

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(__file__), 'fixtures', 'dup.glb')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'wb') as f:
    f.write(out)
print(f"{path}: {len(out)} bytes "
      f"({len(accessors)} accessors, {len(gltf['meshes'])} meshes, "
      f"{len(gltf['materials'])} materials, {len(views)} bufferViews)")
