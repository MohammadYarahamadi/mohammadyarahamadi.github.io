#!/usr/bin/env python3
"""Find a thruster's axis of revolution and profile its geometry along it.

The axis is found by testing rotational self-symmetry: a thruster (motor body +
N blades + N struts) mapped onto itself by a rotation about its true axis, and
not about any other. Voxelising and measuring Jaccard overlap after rotation is
decisive and needs no eigendecomposition.

Once the axis is known, triangles are binned by axial position and radius,
which is what tells us where to cut the propeller away from the motor body.

Usage:
    python3 tools/thruster_axis.py --part 1
"""

import argparse
import math
import pickle
from array import array
from collections import defaultdict

VOX = 1.0  # voxel size in mm for the symmetry test


def load_part(cache, pid):
    with open(cache, "rb") as f:
        d = pickle.load(f)
    verts, tris, pot = d["verts"], d["tris"], d["part_of_tri"]
    idx = [i for i in range(len(pot)) if pot[i] == pid]
    vs = set()
    for i in idx:
        for k in range(3):
            vs.add(tris[i * 3 + k])
    vlist = sorted(vs)
    remap = {v: n for n, v in enumerate(vlist)}
    P = array("f")
    for v in vlist:
        P.append(verts[v * 3]); P.append(verts[v * 3 + 1]); P.append(verts[v * 3 + 2])
    T = array("i")
    for i in idx:
        for k in range(3):
            T.append(remap[tris[i * 3 + k]])
    return P, T


def rot(axis, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    if axis == 0:
        return ((1, 0, 0), (0, c, -s), (0, s, c))
    if axis == 1:
        return ((c, 0, s), (0, 1, 0), (-s, 0, c))
    return ((c, -s, 0), (s, c, 0), (0, 0, 1))


def voxels(P, ctr, M=None):
    out = set()
    n = len(P) // 3
    for i in range(n):
        x, y, z = P[i * 3] - ctr[0], P[i * 3 + 1] - ctr[1], P[i * 3 + 2] - ctr[2]
        if M:
            x, y, z = (
                M[0][0] * x + M[0][1] * y + M[0][2] * z,
                M[1][0] * x + M[1][1] * y + M[1][2] * z,
                M[2][0] * x + M[2][1] * y + M[2][2] * z,
            )
        out.add((int(x / VOX), int(y / VOX), int(z / VOX)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="tools/out/parts.pkl")
    ap.add_argument("--part", type=int, required=True)
    args = ap.parse_args()

    P, T = load_part(args.cache, args.part)
    n = len(P) // 3
    ctr = [sum(P[i * 3 + c] for i in range(n)) / n for c in range(3)]
    print("part %d: %d verts, %d tris" % (args.part, n, len(T) // 3))
    print("centroid: (%.2f, %.2f, %.2f)" % tuple(ctr))

    mn = [min(P[i * 3 + c] for i in range(n)) for c in range(3)]
    mx = [max(P[i * 3 + c] for i in range(n)) for c in range(3)]
    print("per-axis dims: X=%.2f Y=%.2f Z=%.2f" % tuple(mx[c] - mn[c] for c in range(3)))

    base = voxels(P, ctr)
    print("\nrotational self-symmetry (Jaccard overlap after rotating about each axis):")
    print("%-6s %-9s %-9s %-9s" % ("axis", "90deg", "120deg", "180deg"))
    best, best_score = None, -1.0
    for a, name in ((0, "X"), (1, "Y"), (2, "Z")):
        scores = []
        for deg in (90, 120, 180):
            r = voxels(P, ctr, rot(a, deg))
            j = len(base & r) / len(base | r)
            scores.append(j)
        print("%-6s %-9.3f %-9.3f %-9.3f" % (name, *scores))
        if scores[0] > best_score:
            best_score, best = scores[0], a
    print("\n-> axis is %s (90deg overlap %.3f)" % ("XYZ"[best], best_score))

    # Profile along the axis: how much geometry sits at each axial slice, and
    # how far out it reaches. The propeller shows up as a band with large
    # radius; the motor body as a compact core.
    u, v = [c for c in range(3) if c != best]
    axial = defaultdict(lambda: [0, 0.0, 0.0])  # count, max radius, sum radius
    for i in range(n):
        a = P[i * 3 + best] - ctr[best]
        du = P[i * 3 + u] - ctr[u]
        dv = P[i * 3 + v] - ctr[v]
        r = math.sqrt(du * du + dv * dv)
        b = int(math.floor(a / 2.0))  # 2mm slices
        e = axial[b]
        e[0] += 1
        if r > e[1]:
            e[1] = r
        e[2] += r

    print("\naxial profile (2mm slices along %s, relative to centroid):" % "XYZ"[best])
    print("%-9s %-8s %-9s %-9s" % ("axial mm", "verts", "max r", "mean r"))
    for b in sorted(axial):
        c, rmax, rsum = axial[b]
        bar = "#" * int(rmax / 2)
        print("%-9.0f %-8d %-9.1f %-9.1f %s" % (b * 2.0, c, rmax, rsum / c, bar))


if __name__ == "__main__":
    main()
