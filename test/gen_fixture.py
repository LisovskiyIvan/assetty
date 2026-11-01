#!/usr/bin/env python3
"""Generate test/fixtures/box.glb — cube, 2 materials, 1 texture, anim, garbage nodes."""
import json, struct, zlib, sys, os

def pad4(b, fill=b'\x00'):
    return b + fill * ((4 - len(b) % 4) % 4)

def png1x1(rgb=(255, 0, 0)):
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b'\x00' + bytes(rgb))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

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
        for i, (ui, vi) in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
            pos.append([origin[0] + u[0]*ui + v[0]*vi,
                        origin[1] + u[1]*ui + v[1]*vi,
                        origin[2] + u[2]*ui + v[2]*vi])
            nrm.append(list(n))
            uv.append([ui, vi])
        idx += [base, base+1, base+2, base, base+2, base+3]
    return pos, nrm, uv, idx

def f32buf(flat):
    return struct.pack('<%df' % len(flat), *flat)

def u16buf(flat):
    return struct.pack('<%dH' % len(flat), *flat)

pos, nrm, uv, idx = cube()
times = [0.0, 0.25, 0.5, 0.75, 1.0]
import math
quats = [[0.0, math.sin(t*math.pi), 0.0, math.cos(t*math.pi)] for t in times]

blob = bytearray()
def view(data, target=None):
    while len(blob) % 4:
        blob.append(0)
    off = len(blob)
    blob.extend(data)
    v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target: v["target"] = target
    return v

views = []
views.append(view(u16buf(idx), 34963))
views.append(view(f32buf([c for p in pos for c in p]), 34962))
views.append(view(f32buf([c for n in nrm for c in n]), 34962))
views.append(view(f32buf([c for t in uv for c in t]), 34962))
times_v = view(f32buf(times))
views.append(times_v)
views.append(view(f32buf([c for q in quats for c in q])))
png = png1x1()
views.append(view(png))

accessors = [
    {"bufferView": 0, "componentType": 5123, "count": len(idx), "type": "SCALAR"},
    {"bufferView": 1, "componentType": 5126, "count": len(pos), "type": "VEC3",
     "min": [-0.5]*3, "max": [0.5]*3},
    {"bufferView": 2, "componentType": 5126, "count": len(nrm), "type": "VEC3"},
    {"bufferView": 3, "componentType": 5126, "count": len(uv), "type": "VEC2"},
    {"bufferView": 4, "componentType": 5126, "count": len(times), "type": "SCALAR",
     "min": [0.0], "max": [1.0]},
    {"bufferView": 5, "componentType": 5126, "count": len(quats), "type": "VEC4"},
]

gltf = {
    "asset": {"version": "2.0", "generator": "basset fixture gen"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [
        {"name": "Root", "children": [1, 2, 3]},
        {"name": "BoxA", "mesh": 0, "translation": [-1.2, 0, 0]},
        {"name": "BoxB", "mesh": 0, "translation": [1.2, 0, 0]},
        {"name": "UnusedNode"},
    ],
    "meshes": [{"name": "Box", "primitives": [{
        "attributes": {"POSITION": 1, "NORMAL": 2, "TEXCOORD_0": 3},
        "indices": 0, "material": 0}]}],
    "materials": [
        {"name": "mat_red", "pbrMetallicRoughness": {
            "baseColorTexture": {"index": 0}, "metallicFactor": 0.0}},
        {"name": "mat_blue", "pbrMetallicRoughness": {
            "baseColorFactor": [0.1, 0.2, 0.9, 1.0], "metallicFactor": 0.2, "roughnessFactor": 0.6}},
        {"name": "mat_unused", "pbrMetallicRoughness": {"baseColorFactor": [1, 0, 0, 1]}},
    ],
    "textures": [{"sampler": 0, "source": 0}],
    "images": [{"bufferView": 6, "mimeType": "image/png", "name": "red1x1"}],
    "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
    "animations": [{
        "name": "spin",
        "channels": [{"sampler": 0, "target": {"node": 1, "path": "rotation"}}],
        "samplers": [{"input": 4, "output": 5}],
    }],
    "buffers": [{"byteLength": len(blob)}],
    "bufferViews": views,
    "accessors": accessors,
}

js = pad4(json.dumps(gltf, separators=(',', ':')).encode(), b' ')
bin_chunk = pad4(bytes(blob))

out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(bin_chunk))
out += struct.pack('<II', len(js), 0x4E4F534A) + js
out += struct.pack('<II', len(bin_chunk), 0x004E4942) + bin_chunk

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'fixtures', 'box.glb')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'wb') as f:
    f.write(out)
print(f"{path}: {len(out)} bytes")
