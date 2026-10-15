#!/usr/bin/env python3
"""Turn the split STL parts into named, normalised mesh groups for the GLB.

Does the geometry work that needs the part topology:
  - drops the 40 battery cells (53% of the triangles, sealed inside the hull)
  - detects each thruster's axis of revolution and splits it into a static
    half and a rotating propeller half; the two angled, ducted front
    thrusters get a free axis (one of them is pulled out of the hull, where
    the CAD export welded it)
  - separates the acrylic LED and camera covers on the front panel
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
THRUSTER_TRIS = 91066  # 4 identical thruster assemblies (rear + mid)
HULL_TRIS = 177681     # hull shell; one front thruster is welded into it
FRONT_THRUSTER_TRIS = 163819  # the free front thruster; its mirror twin is in the hull
CAMERA_TRIS = 4590     # the camera's acrylic cover, front centre

# The front panel sits at x = 680.4 mm; the two LED covers stand 17 mm proud
# of it, either side of the camera. Hull triangles in front of this plane and
# inside the panel's z band are the LED covers.
LED_FRONT_X = 681.0
PANEL_Z = (150.0, 415.0)

# Blade band of the ducted front thrusters, measured on the model in mm:
# radius from the hub (16.5) to just inside the duct throat (34.5), and the
# axial span of the blades relative to the assembly's vertex centroid. The
# struts and duct wall also fall in this band but form separate welded
# components, which is how they are told apart from the three blades.
BLADE_R = (16.5, 34.5)
BLADE_T = (-6.0, 21.0)

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


def vertex_points(verts, tris, idx):
    seen = set()
    for i in idx:
        for k in range(3):
            seen.add(tris[i * 3 + k])
    return [(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]) for v in seen]


def enclosing_axis(points):
    """Axis of a solid of revolution that isn't aligned to x/y/z: the
    direction about which the points' maximum radius is smallest (a duct seen
    end-on is a circle; from any other angle it looks wider). Coarse grid
    over the hemisphere, then a fine pass around the best cell."""
    n = len(points)
    c = [sum(p[k] for p in points) / n for k in range(3)]
    q = [(p[0] - c[0], p[1] - c[1], p[2] - c[2]) for p in points[:: max(1, n // 6000)]]

    def unit(el, az):
        e, a = math.radians(el), math.radians(az)
        return (math.cos(e) * math.cos(a), math.sin(e), math.cos(e) * math.sin(a))

    def score(ax):
        m = 0.0
        for x, y, z in q:
            t = x * ax[0] + y * ax[1] + z * ax[2]
            r2 = x * x + y * y + z * z - t * t
            if r2 > m:
                m = r2
        return m

    best = min((score(unit(el, az)), el, az)
               for el in range(-90, 91, 3) for az in range(0, 180, 3))
    _s, el0, az0 = best
    best = min((score(unit(el0 + i * 0.25, az0 + j * 0.25)), el0 + i * 0.25, az0 + j * 0.25)
               for i in range(-12, 13) for j in range(-12, 13))
    return unit(best[1], best[2]), c


def axial_radial(p, ax, c):
    x, y, z = p[0] - c[0], p[1] - c[1], p[2] - c[2]
    t = x * ax[0] + y * ax[1] + z * ax[2]
    return t, math.sqrt(max(0.0, x * x + y * y + z * z - t * t))


def extract_mirror_twin(verts, tris, src, host, ax, ctr, z_sum):
    """Pull the mirror image (across z = z_sum/2) of thruster `src` out of
    the `host` part it was welded into. The CAD re-tessellated the copy, so
    vertices don't match exactly; instead keep host triangles that lie
    inside src's radial profile (max radius per 2 mm along the axis),
    mirrored. What's left over is the mounting bracket, which stays in the
    host."""
    prof = {}
    for p in vertex_points(verts, tris, src):
        t, r = axial_radial(p, ax, ctr)
        b = round(t / 2) * 2
        prof[b] = max(prof.get(b, 0.0), r)
    tmin, tmax = min(prof) - 1, max(prof) + 1
    max_ = (ax[0], ax[1], -ax[2])
    mctr = (ctr[0], ctr[1], z_sum - ctr[2])

    twin, rest = [], []
    for i in host:
        inside = True
        for k in range(3):
            vi = tris[i * 3 + k]
            t, r = axial_radial((verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]), max_, mctr)
            b = round(t / 2) * 2
            lim = max(prof.get(b, 0.0), prof.get(b - 2, 0.0), prof.get(b + 2, 0.0)) + 1.0
            if not (tmin <= t <= tmax and r <= lim):
                inside = False
                break
        (twin if inside else rest).append(i)
    return twin, rest, max_, mctr


def welded_components(tris, idx):
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for i in idx:
        for k in (1, 2):
            ra, rb = find(tris[i * 3]), find(tris[i * 3 + k])
            if ra != rb:
                parent[ra] = rb
    out = defaultdict(list)
    for i in idx:
        out[find(tris[i * 3])].append(i)
    return sorted(out.values(), key=len, reverse=True)


def split_ducted(verts, tris, idx, ax, ctr):
    """Split a ducted front thruster into (static, blades, blade_centroid).
    The three blades are the large welded components inside BLADE_R/BLADE_T
    that stay clear of the duct wall; their centroid lies on the spin axis by
    symmetry, so it is the pivot."""
    band = []
    for i in idx:
        c = [sum(verts[tris[i * 3 + k] * 3 + j] for k in range(3)) / 3 for j in range(3)]
        t, r = axial_radial(c, ax, ctr)
        if BLADE_R[0] < r < BLADE_R[1] and BLADE_T[0] <= t <= BLADE_T[1]:
            band.append(i)
    blades = []
    for comp in welded_components(tris, band):
        if len(comp) < 1000:
            break
        rmax = max(axial_radial(p, ax, ctr)[1] for p in vertex_points(verts, tris, comp))
        if rmax <= BLADE_R[1] - 2.0:  # the duct throat ring reaches the band edge
            blades.extend(comp)
    bs = set(blades)
    pts = vertex_points(verts, tris, blades)
    pivot = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
    return [i for i in idx if i not in bs], blades, pivot


def quat_from_y(v):
    """Quaternion (x, y, z, w) rotating +Y onto unit vector v."""
    # cross((0,1,0), v) = (v.z, 0, -v.x); w = 1 + dot = 1 + v.y
    x, y, z, w = v[2], 0.0, -v[0], 1.0 + v[1]
    n = math.sqrt(x * x + y * y + z * z + w * w)
    return [x / n, y / n, z / n, w / n]


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
    hull = [p for p, c in counts.items() if c == HULL_TRIS]
    front = [p for p, c in counts.items() if c == FRONT_THRUSTER_TRIS]
    camera = [p for p, c in counts.items() if c == CAMERA_TRIS]
    if not (hull and front and camera):
        raise SystemExit("expected hull, front thruster and camera parts; STL changed?")

    print("dropping %d battery cells (%d triangles)" % (len(cells), len(cells) * BATTERY_TRIS))
    print("thrusters: %s, front: %s" % (thrusters, front))

    groups = []
    used = set(cells) | set(thrusters) | set(hull) | set(front) | set(camera)

    # --- hull, with the welded-in front thruster and LED covers taken out ---
    all_mn, all_mx = bbox_of(verts, tris, range(len(part_of_tri)))
    z_sum = all_mn[2] + all_mx[2]  # the assembly is mirror-symmetric in z
    f_idx = by_part[front[0]]
    f_ax, f_ctr = enclosing_axis(vertex_points(verts, tris, f_idx))
    twin, _bracket, t_ax, t_ctr = extract_mirror_twin(
        verts, tris, f_idx, by_part[hull[0]], f_ax, f_ctr, z_sum)
    print("  front thruster axis %s; twin pulled from hull: %d tris (source %d)"
          % ([round(a, 3) for a in f_ax], len(twin), len(f_idx)))
    twin_set = set(twin)

    leds = ([], [])
    hull_idx = []
    for i in by_part[hull[0]]:
        if i in twin_set:
            continue
        c = [sum(verts[tris[i * 3 + k] * 3 + j] for k in range(3)) / 3 for j in range(3)]
        if c[0] > LED_FRONT_X and PANEL_Z[0] < c[2] < PANEL_Z[1]:
            leds[0 if c[2] < z_sum / 2 else 1].append(i)
        else:
            hull_idx.append(i)
    groups.append(("hull", hull_idx, None))

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

    # --- the two angled, ducted front thrusters ---
    # Their axis isn't x/y/z, so the prop's pivot node gets a rotation that
    # maps its local +Y onto the real axis and the runtime spins local Y.
    # The twin is a mirror image, so its blades are handed the other way.
    n = len(thrusters)
    for idx, ax, ctr, sign in ((f_idx, f_ax, f_ctr, 1.0), (twin, t_ax, t_ctr, -1.0)):
        n += 1
        static, blades, pivot = split_ducted(verts, tris, idx, ax, ctr)
        print("  thruster_%d ducted axis=%s  static=%6d prop=%6d"
              % (n, [round(a, 3) for a in ax], len(static), len(blades)))
        groups.append(("thruster_%d" % n, static, None))
        groups.append(("prop_%d" % n, blades,
                       {"axis": 1, "pivot": pivot, "sign": sign, "rot": quat_from_y(ax)}))

    # --- acrylic covers: LEDs either side, camera in the middle ---
    for name, idx, role in (("led_1", leds[0], "led"), ("led_2", leds[1], "led"),
                            ("camera", by_part[camera[0]], "camera")):
        mn, mx = bbox_of(verts, tris, idx)
        cy, cz = (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2
        print("  %-8s %5d tris  dia %.1f  x %.1f-%.1f" % (name, len(idx), mx[1] - mn[1], mn[0], mx[0]))
        groups.append((name, idx, {"role": role, "base": [mn[0], cy, cz],
                                   "tip": [mx[0], cy, cz], "radius": (mx[1] - mn[1]) / 2}))

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
        if meta and "role" in meta:
            g["role"] = meta["role"]
            g["base"] = [(meta["base"][c] - ctr[c]) * scale for c in range(3)]
            g["tip"] = [(meta["tip"][c] - ctr[c]) * scale for c in range(3)]
            g["radius"] = meta["radius"] * scale
        elif meta:
            g["axis"] = "xyz"[meta["axis"]]
            g["sign"] = meta["sign"]
            g["pivot"] = [(meta["pivot"][c] - ctr[c]) * scale for c in range(3)]
            if "rot" in meta:
                g["rot"] = meta["rot"]
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
