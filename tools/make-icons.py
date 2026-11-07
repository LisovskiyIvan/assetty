#!/usr/bin/env python3
"""Reproducible assetty icons. Stdlib only (no PIL, no network).

Renders one design — isometric cyan/teal cube on a dark rounded square —
at 2x with scanline fills, box-downsamples, and writes:
  app/resources/assetty.svg   vector master (Linux launcher, docs)
  app/resources/assetty.png   512px RGBA (Linux launcher fallback)
  app/resources/assetty.icns  ic07/ic08/ic09/ic10 as PNG (mac .app)
  app/resources/assetty.ico   16/32/48/256 as PNG (Windows .rc)
  app/resources/assetty.rc    IDI_ICON1 ICON "assetty.ico"

Run:  python3 tools/make-icons.py
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "app", "resources")

# Design space: 512x512.
BG_TOP = (27, 36, 51)
BG_BOT = (11, 15, 22)
BG_R = 112
SHADOW_A = 90
TOP_A = (165, 243, 252)
TOP_B = (34, 211, 238)
LEFT = (20, 184, 166)
RIGHT = (14, 116, 144)
RIDGE_A = 110
RIDGE_W = 3.5
CUBE = dict(T=(256, 140), UR=(366, 204), LR=(366, 332), B=(256, 396),
            LL=(146, 332), UL=(146, 204), C=(256, 266))
SHADOW = (256, 412, 118, 16)  # cx, cy, rx, ry


def lerp(a, b, t):
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


def poly_spans(verts, y, w):
    """Integer x-span(s) of a polygon on scanline y (pixel centers)."""
    yy = y + 0.5
    xs = []
    n = len(verts)
    for i in range(n):
        x0, y0 = verts[i]
        x1, y1 = verts[(i + 1) % n]
        if (y0 > yy) == (y1 > yy):
            continue
        xs.append(x0 + (yy - y0) * (x1 - x0) / (y1 - y0))
    xs.sort()
    out = []
    for i in range(0, len(xs) - 1, 2):
        x0 = max(0, int(math.floor(xs[i])))
        x1 = min(w, int(math.ceil(xs[i + 1])))
        if x1 > x0:
            out.append((x0, x1))
    return out


def rr_span(y, w, h, r):
    yy = y + 0.5
    if r <= yy < h - r:
        return (0, w)
    cy = r if yy < r else h - r
    dy = abs(yy - cy)
    if dy >= r:
        return None
    dx = math.sqrt(r * r - dy * dy)
    return (max(0, int(math.floor(r - dx))), min(w, int(math.ceil(w - r + dx))))


def blend_px(row, idx, rgb, alpha):
    t = alpha / 255.0
    row[idx] = int(round(row[idx] + (rgb[0] - row[idx]) * t))
    row[idx + 1] = int(round(row[idx + 1] + (rgb[1] - row[idx + 1]) * t))
    row[idx + 2] = int(round(row[idx + 2] + (rgb[2] - row[idx + 2]) * t))
    row[idx + 3] = 255


def fill_spans(buf, spans, y, rgba):
    if not spans:
        return
    row = buf[y]
    px = bytes(rgba)
    for x0, x1 in spans:
        row[x0 * 4:x1 * 4] = px * (x1 - x0)


def render(target):
    """Render the icon at target x target px. Returns list of bytes rows."""
    s = (2 * target) / 512.0  # buffer scale (2x supersample)
    w = h = 2 * target
    sc = lambda p: (p[0] * s, p[1] * s)
    buf = [bytearray(w * 4) for _ in range(h)]
    r = BG_R * s

    for y in range(h):
        sp = rr_span(y, w, h, r)
        if sp is None:
            continue
        c = lerp(BG_TOP, BG_BOT, y / (h - 1))
        fill_spans(buf, [sp], y, c + (255,))

    # Ground shadow (under the cube, over the background).
    cx, cy, rx, ry = (c * s for c in SHADOW)
    y0 = max(0, int(math.floor(cy - ry)))
    y1 = min(h, int(math.ceil(cy + ry)))
    for y in range(y0, y1):
        t = (y + 0.5 - cy) / ry
        dx = rx * math.sqrt(max(0.0, 1 - t * t))
        x0 = max(0, int(math.floor(cx - dx)))
        x1 = min(w, int(math.ceil(cx + dx)))
        row = buf[y]
        for x in range(x0, x1):
            i = x * 4
            if row[i + 3]:
                blend_px(row, i, (0, 0, 0), SHADOW_A)

    K = CUBE
    top = [sc(K[k]) for k in ("T", "UR", "C", "UL")]
    left = [sc(K[k]) for k in ("UL", "C", "B", "LL")]
    right = [sc(K[k]) for k in ("C", "UR", "LR", "B")]

    y0 = max(0, int(math.floor(min(p[1] for p in left))))
    y1 = min(h, int(math.ceil(max(p[1] for p in left))))
    for y in range(y0, y1):
        fill_spans(buf, poly_spans(left, y, w), y, LEFT + (255,))
    y0 = max(0, int(math.floor(min(p[1] for p in right))))
    y1 = min(h, int(math.ceil(max(p[1] for p in right))))
    for y in range(y0, y1):
        fill_spans(buf, poly_spans(right, y, w), y, RIGHT + (255,))
    ys = [p[1] for p in top]
    y0 = max(0, int(math.floor(min(ys))))
    y1 = min(h, int(math.ceil(max(ys))))
    for y in range(y0, y1):
        c = lerp(TOP_A, TOP_B, (y - y0) / max(1, y1 - y0))
        fill_spans(buf, poly_spans(top, y, w), y, c + (255,))

    # Ridge highlights along the two top edges.
    for a, b in ((K["T"], K["UR"]), (K["T"], K["UL"])):
        ax, ay = sc(a)
        bx, by = sc(b)
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln * RIDGE_W * s / 2, dx / ln * RIDGE_W * s / 2
        quad = [(ax + nx, ay + ny), (bx + nx, by + ny),
                (bx - nx, by - ny), (ax - nx, ay - ny)]
        y0 = max(0, int(math.floor(min(p[1] for p in quad))))
        y1 = min(h, int(math.ceil(max(p[1] for p in quad))))
        for y in range(y0, y1):
            row = buf[y]
            for x0, x1 in poly_spans(quad, y, w):
                for x in range(x0, x1):
                    i = x * 4
                    if row[i + 3]:
                        blend_px(row, i, (255, 255, 255), RIDGE_A)

    return halve(buf, w, h)


def halve(buf, w, h):
    """Box-downsample RGBA by 2 in premultiplied space. Returns bytes rows."""
    out = []
    for y in range(0, h, 2):
        r0, r1 = buf[y], buf[y + 1]
        ro = bytearray(w * 2)
        for x in range(0, w, 2):
            i = x * 4
            den = r0[i + 3] + r0[i + 4 + 3] + r1[i + 3] + r1[i + 4 + 3]
            o = x * 2
            if den == 0:
                ro[o:o + 4] = b"\x00\x00\x00\x00"
                continue
            a = (den + 2) // 4
            for c in range(3):
                num = r0[i + c] * r0[i + 3] + r0[i + 4 + c] * r0[i + 4 + 3] \
                    + r1[i + c] * r1[i + 3] + r1[i + 4 + c] * r1[i + 4 + 3]
                ro[o + c] = (num + den // 2) // den
            ro[o + 3] = a
        out.append(bytes(ro))
    return out


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + \
        struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png_rgba(w, rows):
    body = b"".join(b"\x00" + r for r in rows)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, len(rows), 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(body, 9))
            + chunk(b"IEND", b""))


def write_icns(path, entries):
    blobs = b"".join(t + struct.pack(">I", len(d) + 8) + d for t, d in entries)
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(blobs) + 8) + blobs)


def write_ico(path, images):
    n = len(images)
    head = struct.pack("<HHH", 0, 1, n)
    off = 6 + 16 * n
    dirs, data = [], []
    for size, png in images:
        wh = 0 if size >= 256 else size
        dirs.append(struct.pack("<BBBBHHII", wh, wh, 0, 0, 1, 32, len(png), off))
        data.append(png)
        off += len(png)
    with open(path, "wb") as f:
        f.write(head + b"".join(dirs) + b"".join(data))


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b2433"/>
      <stop offset="1" stop-color="#0b0f16"/>
    </linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a5f3fc"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <ellipse cx="256" cy="412" rx="118" ry="16" fill="#000" opacity="0.35"/>
  <polygon points="146,204 256,266 256,396 146,332" fill="#14b8a6"/>
  <polygon points="256,266 366,204 366,332 256,396" fill="#0e7490"/>
  <polygon points="256,140 366,204 256,266 146,204" fill="url(#top)"/>
  <polyline points="256,140 366,204" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round"/>
  <polyline points="256,140 146,204" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="3.5" stroke-linecap="round"/>
</svg>
"""

RC = 'IDI_ICON1 ICON "assetty.ico"\n'


def main():
    os.makedirs(RES, exist_ok=True)
    imgs = {}
    for size in (1024, 512, 256, 128, 48, 32, 16):
        rows = render(size)
        imgs[size] = png_rgba(size, rows)
        print("rendered", size)

    with open(os.path.join(RES, "assetty.svg"), "w") as f:
        f.write(SVG)
    with open(os.path.join(RES, "assetty.png"), "wb") as f:
        f.write(imgs[512])
    write_icns(os.path.join(RES, "assetty.icns"),
               [(b"ic07", imgs[128]), (b"ic08", imgs[256]),
                (b"ic09", imgs[512]), (b"ic10", imgs[1024])])
    write_ico(os.path.join(RES, "assetty.ico"),
              [(256, imgs[256]), (48, imgs[48]),
               (32, imgs[32]), (16, imgs[16])])
    with open(os.path.join(RES, "assetty.rc"), "w") as f:
        f.write(RC)
    print("wrote", RES)


if __name__ == "__main__":
    main()
