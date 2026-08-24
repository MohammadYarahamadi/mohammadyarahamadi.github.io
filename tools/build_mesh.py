#!/usr/bin/env python3
"""Turn the split STL parts into named, normalised mesh groups for the GLB.

Does the geometry work that needs the part topology:
  - drops the 40 battery cells (53% of the triangles, sealed inside the hull)
  - detects each thruster's axis of revolution and splits it into a static
    half and a rotating propeller half
  - joins the remaining small bodies into one "hardware" group to keep the
    draw-call count down
  - centres the assembly and scales it so its longest dimension is 1.0

Writes tools/out/mesh.json + mesh.bin, which tools/build_glb.mjs decimates
and packs into a GLB.

Usage:
    python3 tools/build_mesh.py
"""

import json
import math
import os
import pickle
import struct
from array import array
from collections import defaultdict

CACHE = "tools/out/parts.pkl"
OUT_DIR = "tools/out"

BATTERY_TRIS = 23800   # 40 identical 21700 cells
THRUSTER_TRIS = 91066  # 4 identical thruster assemblies
FRAME_TRIS = 177681
ENCLOSURE_TRIS = 163819

# Axial offset (mm from the thruster centroid, along its own axis) separating
# the rotating propeller from the static motor body. Verified by rendering:
# above this the geometry is blades plus a section of motor can, and a can is
# a surface of revolution so spinning it is visually undetectable.
PROP_CUT = 20.0


def part_indices(part_of_tri):
    by_part = defaultdict(list)
    for i, p in enumerate(part_of_tri):
        by_part[p].append(i)
    return by_part


def bbox_of(verts, tris, idx):
    mn = [1e30] * 3
    mx = [-1e30] * 3
    for i in idx:
        for k in range(3):
            vi = tris[i * 3 + k]
            for c in range(3):
                v = verts[vi * 3 + c]
                if v < mn[c]: mn[c] = v
                if v > mx[c]: mx[c] = v
    return mn, mx


def centroid_of(verts, tris, idx):
    s = [0.0] * 3
    n = 0
    for i in idx:
        for k in range(3):
            vi = tris[i * 3 + k]
            for c in range(3):
                s[c] += verts[vi * 3 + c]
            n += 1
    return [c / n for c in s]


def thruster_axis(verts, tris, idx):
    """A thruster is a solid of revolution: the two axes perpendicular to its
    axis share the circular cross-section diameter, so the axis is whichever
    extent differs from the other two."""
    mn, mx = bbox_of(verts, tris, idx)
    d = [mx[c] - mn[c] for c in range(3)]
    # For each candidate axis, the other two extents are the circular
    # cross-section diameter and so should match. The axis is the candidate
    # whose *other two* agree most closely.
    pairs = ((1, 2), (0, 2), (0, 1))
    return min(range(3), key=lambda c: abs(d[pairs[c][0]] - d[pairs[c][1]]))


def split_thruster(verts, tris, idx, ax):
    """Return (static_tris, prop_tris). The propeller end is whichever side of
    the cut plane reaches a larger radius — the blades sweep wide, the nose
    cone is narrow."""
    ctr = centroid_of(verts, tris, idx)
    u, v = [c for c in range(3) if c != ax]

    def axial_radius(i):
        a = r = 0.0
        for k in range(3):
            vi = tris[i * 3 + k]
            a += verts[vi * 3 + ax] - ctr[ax]
            du = verts[vi * 3 + u] - ctr[u]
            dv = verts[vi * 3 + v] - ctr[v]
            r += math.sqrt(du * du + dv * dv)
        return a / 3.0, r / 3.0

    ar = [axial_radius(i) for i in idx]
    rmax_pos = max((r for a, r in ar if a >= PROP_CUT), default=0.0)
    rmax_neg = max((r for a, r in ar if a <= -PROP_CUT), default=0.0)
    sign = 1.0 if rmax_pos >= rmax_neg else -1.0

    static, prop = [], []
    for i, (a, _r) in zip(idx, ar):
        (prop if a * sign >= PROP_CUT else static).append(i)
    return static, prop, ctr, sign, max(rmax_pos, rmax_neg)


def emit(verts, tris, idx):
    """Compact a triangle selection into its own vertex/index arrays."""
    remap = {}
    P = array("f")
    I = array("I")
    for i in idx:
        for k in range(3):
            vi = tris[i * 3 + k]
            j = remap.get(vi, -1)
            if j < 0:
                j = len(P) // 3
                remap[vi] = j
                P.append(verts[vi * 3]); P.append(verts[vi * 3 + 1]); P.append(verts[vi * 3 + 2])
            I.append(j)
    return P, I


def main():
    with open(CACHE, "rb") as f:
        d = pickle.load(f)
    verts, tris, part_of_tri = d["verts"], d["tris"], d["part_of_tri"]
    by_part = part_indices(part_of_tri)

    counts = {p: len(ix) for p, ix in by_part.items()}
    cells = [p for p, c in counts.items() if c == BATTERY_TRIS]
    thrusters = sorted(
        (p for p, c in counts.items() if c == THRUSTER_TRIS),
        key=lambda p: centroid_of(verts, tris, by_part[p])[0],
    )
    frame = [p for p, c in counts.items() if c == FRAME_TRIS]
    enclosure = [p for p, c in counts.items() if c == ENCLOSURE_TRIS]

    print("dropping %d battery cells (%d triangles)" % (len(cells), len(cells) * BATTERY_TRIS))
    print("thrusters: %s" % thrusters)

    groups = []
    used = set(cells) | set(thrusters) | set(frame) | set(enclosure)

    if frame:
        groups.append(("frame", by_part[frame[0]], None))
    if enclosure:
        groups.append(("enclosure", by_part[enclosure[0]], None))

    for n, p in enumerate(thrusters, start=1):
        idx = by_part[p]
        ax = thruster_axis(verts, tris, idx)
        static, prop, ctr, sign, rmax = split_thruster(verts, tris, idx, ax)
        print(
            "  thruster_%d part=%-3d axis=%s sign=%+.0f  static=%6d prop=%6d  prop rmax=%.1f"
            % (n, p, "XYZ"[ax], sign, len(static), len(prop), rmax)
        )
        groups.append(("thruster_%d" % n, static, None))
        groups.append(("prop_%d" % n, prop, {"axis": ax, "pivot": ctr, "sign": sign}))

    rest = []
    for p, idx in by_part.items():
        if p not in used:
            rest.extend(idx)
    if rest:
        groups.append(("hardware", rest, None))

    # --- normalise: centre at origin, longest dimension -> 1.0 -------------
    all_idx = [i for _n, ix, _m in groups for i in ix]
    mn, mx = bbox_of(verts, tris, all_idx)
    ctr = [(mn[c] + mx[c]) / 2.0 for c in range(3)]
    scale = 1.0 / max(mx[c] - mn[c] for c in range(3))
    print("\nassembly bbox %s -> centre %s, scale %.6f"
          % ([round(mx[c] - mn[c], 1) for c in range(3)],
             [round(c, 1) for c in ctr], scale))

    manifest = {"groups": [], "scale": scale}
    pos_blob = bytearray()
    idx_blob = bytearray()

    for name, ix, meta in groups:
        P, I = emit(verts, tris, ix)
        for j in range(len(P) // 3):
            for c in range(3):
                P[j * 3 + c] = (P[j * 3 + c] - ctr[c]) * scale
        g = {
            "name": name,
            "pos_offset": len(pos_blob),
            "vertex_count": len(P) // 3,
            "idx_offset": len(idx_blob),
            "index_count": len(I),
        }
        if meta:
            g["axis"] = "xyz"[meta["axis"]]
            g["sign"] = meta["sign"]
            g["pivot"] = [(meta["pivot"][c] - ctr[c]) * scale for c in range(3)]
        manifest["groups"].append(g)
        pos_blob += P.tobytes()
        idx_blob += I.tobytes()
        print("  %-14s %7d tris  %7d verts" % (name, len(I) // 3, len(P) // 3))

    manifest["pos_bytes"] = len(pos_blob)
    manifest["idx_bytes"] = len(idx_blob)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "mesh.bin"), "wb") as f:
        f.write(pos_blob)
        f.write(idx_blob)
    with open(os.path.join(OUT_DIR, "mesh.json"), "w") as f:
        json.dump(manifest, f, indent=1)

    total = sum(g["index_count"] // 3 for g in manifest["groups"])
    print("\n%d groups, %d triangles -> %s" % (len(manifest["groups"]), total, OUT_DIR))


if __name__ == "__main__":
    main()
