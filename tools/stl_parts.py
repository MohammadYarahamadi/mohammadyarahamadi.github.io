#!/usr/bin/env python3
"""Parse a binary STL, weld its vertices, and split it into connected parts.

An STL is triangle soup: every triangle carries its own three vertices, with no
shared topology and no notion of "parts". Welding coincident vertices restores
the connectivity, after which a union-find over the triangles recovers the
original CAD bodies as connected components.

Results are cached to <out>/parts.pkl because the weld/split takes ~60s and
every later stage of the pipeline needs it.

Usage:
    python3 tools/stl_parts.py --stl "AAA Complete.STL"
    python3 tools/stl_parts.py --stl "AAA Complete.STL" --force   # rebuild cache
"""

import argparse
import json
import math
import os
import pickle
import struct
import sys
import time
from array import array
from collections import defaultdict

# Vertex weld precision, in source units (mm). Tight on purpose: too loose and
# adjacent bodies that merely touch get fused into one part, permanently losing
# a separation we need.
WELD_Q = 1000.0  # -> 0.001mm


def parse_and_split(path):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        data = f.read()

    if len(data) < 84:
        sys.exit("not an STL: file too short")
    n_tri = struct.unpack_from("<I", data, 80)[0]
    if 84 + 50 * n_tri != size:
        sys.exit(
            "not a binary STL (or it is truncated): declared %d triangles implies "
            "%d bytes, file is %d" % (n_tri, 84 + 50 * n_tri, size)
        )

    print("binary STL: %d triangles" % n_tri)

    # --- weld -------------------------------------------------------------
    t0 = time.time()
    vid = {}
    verts = array("f")
    tris = array("i")
    unpack_from = struct.unpack_from

    for i in range(n_tri):
        v = unpack_from("<9f", data, 84 + i * 50 + 12)
        for k in range(3):
            x, y, z = v[k * 3], v[k * 3 + 1], v[k * 3 + 2]
            key = (
                int(math.floor(x * WELD_Q + 0.5)),
                int(math.floor(y * WELD_Q + 0.5)),
                int(math.floor(z * WELD_Q + 0.5)),
            )
            j = vid.get(key, -1)
            if j < 0:
                j = len(verts) // 3
                vid[key] = j
                verts.append(x)
                verts.append(y)
                verts.append(z)
            tris.append(j)

    n_vert = len(verts) // 3
    print("welded: %d vertices (from %d raw) in %.0fs" % (n_vert, n_tri * 3, time.time() - t0))
    del vid, data

    # --- connected components --------------------------------------------
    t0 = time.time()
    parent = list(range(n_vert))

    def find(x):
        r = x
        while parent[r] != r:
            r = parent[r]
        while parent[x] != r:
            parent[x], x = r, parent[x]
        return r

    for i in range(n_tri):
        a, b, c = tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]
        ra, rb, rc = find(a), find(b), find(c)
        if ra != rb:
            parent[rb] = ra
        if ra != rc:
            parent[rc] = ra

    part_of_tri = array("i", bytes(4 * n_tri))
    roots = {}
    for i in range(n_tri):
        r = find(tris[i * 3])
        p = roots.get(r, -1)
        if p < 0:
            p = len(roots)
            roots[r] = p
        part_of_tri[i] = p

    n_parts = len(roots)
    print("split: %d parts in %.0fs" % (n_parts, time.time() - t0))
    return verts, tris, part_of_tri, n_parts


def part_stats(verts, tris, part_of_tri, n_parts):
    """Per-part metrics. Volume/area/triangle-count are rotation-invariant, so
    identical bodies placed at different orientations still cluster together."""
    acc = [None] * n_parts
    for p in range(n_parts):
        acc[p] = {
            "tris": 0,
            "mn": [1e30] * 3,
            "mx": [-1e30] * 3,
            "sum": [0.0] * 3,
            "area": 0.0,
            "vol": 0.0,
        }

    for i in range(len(part_of_tri)):
        a = acc[part_of_tri[i]]
        i0, i1, i2 = tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]
        p0 = (verts[i0 * 3], verts[i0 * 3 + 1], verts[i0 * 3 + 2])
        p1 = (verts[i1 * 3], verts[i1 * 3 + 1], verts[i1 * 3 + 2])
        p2 = (verts[i2 * 3], verts[i2 * 3 + 1], verts[i2 * 3 + 2])

        for p in (p0, p1, p2):
            for c in range(3):
                if p[c] < a["mn"][c]:
                    a["mn"][c] = p[c]
                if p[c] > a["mx"][c]:
                    a["mx"][c] = p[c]
                a["sum"][c] += p[c]

        ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
        cx, cy, cz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        a["area"] += 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz)
        # Signed tetrahedron volume against the origin; sums to the enclosed
        # volume for a closed shell.
        a["vol"] += (
            p0[0] * (p1[1] * p2[2] - p1[2] * p2[1])
            - p0[1] * (p1[0] * p2[2] - p1[2] * p2[0])
            + p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])
        ) / 6.0
        a["tris"] += 1

    out = []
    for p in range(n_parts):
        a = acc[p]
        nv = a["tris"] * 3
        dims = sorted((a["mx"][c] - a["mn"][c] for c in range(3)), reverse=True)
        out.append(
            {
                "id": p,
                "tris": a["tris"],
                "centroid": [round(a["sum"][c] / nv, 3) for c in range(3)],
                "bbox_min": [round(v, 3) for v in a["mn"]],
                "bbox_max": [round(v, 3) for v in a["mx"]],
                "dims_sorted": [round(d, 3) for d in dims],
                "flatness": round(dims[2] / dims[0], 4) if dims[0] > 0 else 0.0,
                "area": round(a["area"], 3),
                "volume": round(abs(a["vol"]), 3),
            }
        )
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stl", required=True)
    ap.add_argument("--out", default="tools/out")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    cache = os.path.join(args.out, "parts.pkl")

    if os.path.exists(cache) and not args.force:
        print("cache hit: %s (use --force to rebuild)" % cache)
        return

    verts, tris, part_of_tri, n_parts = parse_and_split(args.stl)
    stats = part_stats(verts, tris, part_of_tri, n_parts)

    with open(cache, "wb") as f:
        pickle.dump(
            {"verts": verts, "tris": tris, "part_of_tri": part_of_tri, "n_parts": n_parts},
            f,
            protocol=pickle.HIGHEST_PROTOCOL,
        )
    with open(os.path.join(args.out, "parts.json"), "w") as f:
        json.dump(stats, f, indent=1)

    # Group by invariant signature: identical bodies (thrusters, cells, screws)
    # collapse into one row each, which is how the model gets read.
    groups = defaultdict(list)
    for s in stats:
        groups[(s["tris"], round(s["volume"], 1))].append(s)

    print("\n%-8s %-4s %-26s %-22s %-7s %s" % ("tris", "n", "centroid", "dims", "flat", "vol"))
    for key, g in sorted(groups.items(), key=lambda kv: -kv[0][0] * len(kv[1])):
        s = g[0]
        print(
            "%-8d %-4d (%7.1f,%6.1f,%7.1f)  (%6.1f,%5.1f,%5.1f)  %-7.3f %.0f"
            % (
                s["tris"], len(g),
                s["centroid"][0], s["centroid"][1], s["centroid"][2],
                s["dims_sorted"][0], s["dims_sorted"][1], s["dims_sorted"][2],
                s["flatness"], s["volume"],
            )
        )
    print("\ntotal parts: %d, total tris: %d" % (n_parts, sum(s["tris"] for s in stats)))
    print("wrote %s and parts.json" % cache)


if __name__ == "__main__":
    main()
