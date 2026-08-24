#!/usr/bin/env python3
"""Orthographic software rasteriser for STL parts, using Pillow.

This is the visual verification loop for the pipeline. There is no 3D
application on this machine, so instead of a viewport we render the geometry
to PNGs and look at those. Flat-shaded, z-buffered, with an optional
per-part palette for telling bodies apart.

Usage:
    python3 tools/preview.py --out tools/out/all.png
    python3 tools/preview.py --parts 2 --views iso,x --out tools/out/thruster.png
    python3 tools/preview.py --exclude-tris 23800 --color-by-part --out tools/out/no-cells.png
"""

import argparse
import math
import os
import pickle
from array import array

from PIL import Image

BG = (11, 13, 16)  # matches the site's --color-bg


def view_matrix(name):
    """Rows are the view-space basis: screen-x, screen-y, depth."""
    if name == "z":  # front: looking down -Z
        return ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    if name == "x":  # side: looking down -X
        return ((0, 0, 1), (0, 1, 0), (1, 0, 0))
    if name == "y":  # top: looking down -Y
        return ((1, 0, 0), (0, 0, 1), (0, 1, 0))
    if name == "iso":
        a = math.radians(35.264)
        b = math.radians(45.0)
        ca, sa, cb, sb = math.cos(a), math.sin(a), math.cos(b), math.sin(b)
        # rotate about Y then about X
        return (
            (cb, 0.0, -sb),
            (sa * sb, ca, sa * cb),
            (ca * sb, -sa, ca * cb),
        )
    raise SystemExit("unknown view %r (use x, y, z or iso)" % name)


def hue_rgb(i, n):
    h = (i * 0.6180339887) % 1.0  # golden-ratio hue spacing
    s, v = 0.55, 0.95
    k = int(h * 6)
    f = h * 6 - k
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    r, g, b = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][k % 6]
    return (int(r * 255), int(g * 255), int(b * 255))


def render(verts, tris, sel, part_of_tri, W, H, view, color_by_part, n_parts):
    m = view_matrix(view)
    mx0, mx1, my0, my1 = 1e30, -1e30, 1e30, -1e30

    # Transform once, cache: memory is tight, so store as flat arrays.
    nsel = len(sel)
    sx = array("f", bytes(4 * nsel * 3))
    sy = array("f", bytes(4 * nsel * 3))
    sz = array("f", bytes(4 * nsel * 3))

    for n, ti in enumerate(sel):
        for k in range(3):
            vi = tris[ti * 3 + k]
            x, y, z = verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]
            a = m[0][0] * x + m[0][1] * y + m[0][2] * z
            b = m[1][0] * x + m[1][1] * y + m[1][2] * z
            c = m[2][0] * x + m[2][1] * y + m[2][2] * z
            sx[n * 3 + k], sy[n * 3 + k], sz[n * 3 + k] = a, b, c
            if a < mx0: mx0 = a
            if a > mx1: mx1 = a
            if b < my0: my0 = b
            if b > my1: my1 = b

    span = max(mx1 - mx0, my1 - my0) or 1.0
    scale = (min(W, H) - 16) / span
    ox = (W - (mx1 - mx0) * scale) * 0.5 - mx0 * scale
    oy = (H - (my1 - my0) * scale) * 0.5 - my0 * scale

    zbuf = array("f", [1e30]) * (W * H)
    fb = bytearray(BG * (W * H))

    for n in range(nsel):
        x0 = sx[n * 3] * scale + ox
        x1 = sx[n * 3 + 1] * scale + ox
        x2 = sx[n * 3 + 2] * scale + ox
        y0 = H - (sy[n * 3] * scale + oy)
        y1 = H - (sy[n * 3 + 1] * scale + oy)
        y2 = H - (sy[n * 3 + 2] * scale + oy)
        # Depth must use the same scale as x/y: the face normal below is
        # computed in screen space, so mixing pixel units with model units
        # collapses every normal onto the view axis and flattens the shading.
        z0 = sz[n * 3] * scale
        z1 = sz[n * 3 + 1] * scale
        z2 = sz[n * 3 + 2] * scale

        area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if area == 0.0:
            continue

        # Face normal in view space -> Lambert against a headlight.
        ux, uy, uz = x1 - x0, y1 - y0, z1 - z0
        vx, vy, vz = x2 - x0, y2 - y0, z2 - z0
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        ln = math.sqrt(nx * nx + ny * ny + nz * nz)
        lam = abs(nz / ln) if ln else 0.0
        shade = 0.18 + 0.82 * lam

        if color_by_part:
            base = hue_rgb(part_of_tri[sel[n]], n_parts)
        else:
            base = (168, 214, 224)
        cr = int(base[0] * shade)
        cg = int(base[1] * shade)
        cb = int(base[2] * shade)

        ix0 = max(0, int(min(x0, x1, x2)))
        ix1 = min(W - 1, int(max(x0, x1, x2)) + 1)
        iy0 = max(0, int(min(y0, y1, y2)))
        iy1 = min(H - 1, int(max(y0, y1, y2)) + 1)
        if ix1 < ix0 or iy1 < iy0:
            continue

        # Sub-pixel triangles dominate a CAD mesh at preview resolution;
        # splatting the centroid is both correct enough and much faster.
        if ix1 - ix0 <= 1 and iy1 - iy0 <= 1:
            px, py = int((x0 + x1 + x2) / 3.0), int((y0 + y1 + y2) / 3.0)
            if 0 <= px < W and 0 <= py < H:
                z = (z0 + z1 + z2) / 3.0
                o = py * W + px
                if z < zbuf[o]:
                    zbuf[o] = z
                    fb[o * 3] = cr
                    fb[o * 3 + 1] = cg
                    fb[o * 3 + 2] = cb
            continue

        for py in range(iy0, iy1 + 1):
            row = py * W
            for px in range(ix0, ix1 + 1):
                w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area
                if w0 < -1e-6:
                    continue
                w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area
                if w1 < -1e-6:
                    continue
                w2 = 1.0 - w0 - w1
                if w2 < -1e-6:
                    continue
                z = w0 * z0 + w1 * z1 + w2 * z2
                o = row + px
                if z < zbuf[o]:
                    zbuf[o] = z
                    fb[o * 3] = cr
                    fb[o * 3 + 1] = cg
                    fb[o * 3 + 2] = cb

    return Image.frombytes("RGB", (W, H), bytes(fb))


def load_mesh_dump(stem):
    """Read the build_mesh.py / build_glb.mjs group format (.json + .bin) into
    the same flat arrays the rasteriser expects, with one 'part' per group."""
    import json

    with open(stem + ".json") as f:
        man = json.load(f)
    blob = open(stem + ".bin", "rb").read()
    idx_base = man["pos_bytes"]

    verts = array("f")
    tris = array("i")
    pot = array("i")
    names = []
    for gi, g in enumerate(man["groups"]):
        base = len(verts) // 3
        p = array("f")
        p.frombytes(blob[g["pos_offset"]: g["pos_offset"] + g["vertex_count"] * 12])
        verts.extend(p)
        i = array("I")
        i.frombytes(blob[idx_base + g["idx_offset"]: idx_base + g["idx_offset"] + g["index_count"] * 4])
        for v in i:
            tris.append(base + v)
        for _ in range(g["index_count"] // 3):
            pot.append(gi)
        names.append(g["name"])
    return verts, tris, pot, names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="tools/out/parts.pkl")
    ap.add_argument("--mesh", default="", help="render a .json/.bin group dump instead")
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=520)
    ap.add_argument("--views", default="iso,z,y")
    ap.add_argument("--parts", default="", help="comma-separated part ids; blank = all")
    ap.add_argument("--exclude-tris", default="", help="drop parts with these exact tri counts")
    ap.add_argument("--color-by-part", action="store_true")
    args = ap.parse_args()

    if args.mesh:
        verts, tris, part_of_tri, names = load_mesh_dump(args.mesh)
        n_parts = len(names)
        print("groups: %s" % ", ".join("%d=%s" % (i, n) for i, n in enumerate(names)))
    else:
        with open(args.cache, "rb") as f:
            d = pickle.load(f)
        verts, tris, part_of_tri, n_parts = d["verts"], d["tris"], d["part_of_tri"], d["n_parts"]

    keep_ids = None
    if args.parts:
        keep_ids = set(int(x) for x in args.parts.split(","))

    drop_counts = set()
    if args.exclude_tris:
        drop_counts = set(int(x) for x in args.exclude_tris.split(","))
    if drop_counts:
        counts = {}
        for p in part_of_tri:
            counts[p] = counts.get(p, 0) + 1
        drop_parts = {p for p, c in counts.items() if c in drop_counts}
    else:
        drop_parts = set()

    sel = array("i")
    for i in range(len(part_of_tri)):
        p = part_of_tri[i]
        if p in drop_parts:
            continue
        if keep_ids is not None and p not in keep_ids:
            continue
        sel.append(i)
    print("rendering %d triangles" % len(sel))

    views = args.views.split(",")
    S = args.size
    sheet = Image.new("RGB", (S * len(views), S), BG)
    for i, v in enumerate(views):
        img = render(verts, tris, sel, part_of_tri, S, S, v, args.color_by_part, n_parts)
        sheet.paste(img, (i * S, 0))
        print("  %s done" % v)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    sheet.save(args.out)
    print("wrote %s (%dx%d)" % (args.out, sheet.width, sheet.height))


if __name__ == "__main__":
    main()
