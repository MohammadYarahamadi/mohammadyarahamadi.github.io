#!/usr/bin/env python3
"""Slice a thruster along its axis to find where the propeller ends and the
motor body / mounting hardware begins.

Two modes:
  --mode bands     colour triangles by axial band, to read the structure
  --mode isolate   keep only triangles inside an axial/radial window

Both render through tools/preview.py's rasteriser.

Usage:
    python3 tools/thruster_cut.py --part 1 --mode bands --out tools/out/bands.png
    python3 tools/thruster_cut.py --part 1 --mode isolate \
        --axial -4 12 --radius 6 32 --out tools/out/prop.png
"""

import argparse
import math
import pickle
from array import array

from PIL import Image

import preview

AXIS = {"x": 0, "y": 1, "z": 2}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="tools/out/parts.pkl")
    ap.add_argument("--part", type=int, required=True)
    ap.add_argument("--axis", default="y", choices=list(AXIS))
    ap.add_argument("--mode", default="bands", choices=["bands", "isolate"])
    ap.add_argument("--band", type=float, default=4.0, help="band height in mm")
    ap.add_argument("--axial", nargs=2, type=float, default=None, metavar=("LO", "HI"))
    ap.add_argument("--radius", nargs=2, type=float, default=None, metavar=("LO", "HI"))
    ap.add_argument("--invert", action="store_true", help="keep everything OUTSIDE the window")
    ap.add_argument("--views", default="iso,y,x")
    ap.add_argument("--size", type=int, default=420)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    with open(args.cache, "rb") as f:
        d = pickle.load(f)
    verts, tris, pot = d["verts"], d["tris"], d["part_of_tri"]

    ax = AXIS[args.axis]
    u, v = [c for c in range(3) if c != ax]

    idx = [i for i in range(len(pot)) if pot[i] == args.part]
    n = 0
    ctr = [0.0, 0.0, 0.0]
    for i in idx:
        for k in range(3):
            vi = tris[i * 3 + k]
            for c in range(3):
                ctr[c] += verts[vi * 3 + c]
            n += 1
    ctr = [c / n for c in ctr]

    sel = array("i")
    synth = {}
    kept_axial = []
    for i in idx:
        a = r = 0.0
        for k in range(3):
            vi = tris[i * 3 + k]
            a += verts[vi * 3 + ax] - ctr[ax]
            du = verts[vi * 3 + u] - ctr[u]
            dv = verts[vi * 3 + v] - ctr[v]
            r += math.sqrt(du * du + dv * dv)
        a /= 3.0
        r /= 3.0

        if args.mode == "isolate":
            inside = True
            if args.axial and not (args.axial[0] <= a <= args.axial[1]):
                inside = False
            if args.radius and not (args.radius[0] <= r <= args.radius[1]):
                inside = False
            if inside == bool(args.invert):
                continue
            sel.append(i)
            synth[i] = 0
        else:
            sel.append(i)
            synth[i] = int(math.floor(a / args.band))
        kept_axial.append(a)

    if not sel:
        raise SystemExit("nothing selected")

    bands = sorted(set(synth.values()))
    remap = {b: n for n, b in enumerate(bands)}
    pot2 = array("i", bytes(4 * len(pot)))
    for i in sel:
        pot2[i] = remap[synth[i]]

    print("selected %d of %d triangles (%.1f%%)" % (len(sel), len(idx), 100.0 * len(sel) / len(idx)))
    print("axial range kept: %.1f .. %.1f mm" % (min(kept_axial), max(kept_axial)))
    if args.mode == "bands":
        print("bands (%.0fmm each), colour order:" % args.band)
        for b in bands:
            print("   band %+d  ->  axial %+.0f .. %+.0f mm"
                  % (remap[b], b * args.band, (b + 1) * args.band))

    views = args.views.split(",")
    S = args.size
    sheet = Image.new("RGB", (S * len(views), S), preview.BG)
    for i, vw in enumerate(views):
        img = preview.render(verts, tris, sel, pot2, S, S, vw,
                             args.mode == "bands", len(bands))
        sheet.paste(img, (i * S, 0))
    sheet.save(args.out)
    print("wrote %s" % args.out)


if __name__ == "__main__":
    main()
