/**
 * Decimate the mesh groups from build_mesh.py and pack them into a GLB.
 *
 * Triangle budget is allocated per group in proportion to surface area (a
 * single global ratio annihilates small parts), with the propellers weighted
 * up since they are the animated focal point.
 *
 * Normals are generated with an angle threshold rather than fully smoothed:
 * CAD geometry needs its hard edges, but flat shading would triple the vertex
 * count and blow the size budget.
 *
 * Usage:
 *   node tools/build_glb.mjs [--out public/models/rov-v2.glb] [--dump <stem>]
 */
import fs from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = argOf("--out", "public/models/rov-v2.glb");
const DUMP = argOf("--dump", "");
const NORMAL_ANGLE = Math.cos((42 * Math.PI) / 180);

// Explicit per-group targets rather than a share of surface area. Area-
// proportional allocation hands most of the budget to the frame, whose large
// flat panels decimate to almost nothing anyway, and starves the small but
// geometrically dense thrusters that the viewer actually looks at.
const TARGETS = {
  hull: 14000,
  thruster_5: 6000, // the ducted front pair: duct, struts and mount bracket
  thruster_6: 6000,
  thruster: 4200,   // each
  prop: 3000,       // each — animated focal point
  led: 900,         // acrylic covers: plain cylinders
  camera: 1200,
  hardware: 7000,
};
const targetFor = (name) => {
  for (const [k, v] of Object.entries(TARGETS)) if (name.startsWith(k)) return v;
  return 2000;
};

function surfaceArea(pos, idx) {
  let a = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const p = idx[i] * 3, q = idx[i + 1] * 3, r = idx[i + 2] * 3;
    const ux = pos[q] - pos[p], uy = pos[q + 1] - pos[p + 1], uz = pos[q + 2] - pos[p + 2];
    const vx = pos[r] - pos[p], vy = pos[r + 1] - pos[p + 1], vz = pos[r + 2] - pos[p + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    a += 0.5 * Math.hypot(cx, cy, cz);
  }
  return a;
}

/** Rotate packed xyz triples in place by unit quaternion q = [x, y, z, w]. */
function rotateAll(arr, q) {
  const [qx, qy, qz, qw] = q;
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], y = arr[i + 1], z = arr[i + 2];
    // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    arr[i] = x + qw * tx + (qy * tz - qz * ty);
    arr[i + 1] = y + qw * ty + (qz * tx - qx * tz);
    arr[i + 2] = z + qw * tz + (qx * ty - qy * tx);
  }
}

/** Drop vertices no longer referenced after simplification. */
function compact(pos, idx) {
  const remap = new Int32Array(pos.length / 3).fill(-1);
  let n = 0;
  for (let i = 0; i < idx.length; i++) if (remap[idx[i]] < 0) remap[idx[i]] = n++;
  const out = new Float32Array(n * 3);
  for (let v = 0; v < remap.length; v++) {
    if (remap[v] < 0) continue;
    out[remap[v] * 3] = pos[v * 3];
    out[remap[v] * 3 + 1] = pos[v * 3 + 1];
    out[remap[v] * 3 + 2] = pos[v * 3 + 2];
  }
  const ni = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) ni[i] = remap[idx[i]];
  return [out, ni];
}

/**
 * Per-vertex normals that preserve hard edges: a vertex is split whenever the
 * faces meeting there diverge by more than NORMAL_ANGLE.
 */
function normalsWithSplit(pos, idx) {
  const triN = new Float32Array((idx.length / 3) * 3);
  for (let t = 0; t < idx.length / 3; t++) {
    const p = idx[t * 3] * 3, q = idx[t * 3 + 1] * 3, r = idx[t * 3 + 2] * 3;
    const ux = pos[q] - pos[p], uy = pos[q + 1] - pos[p + 1], uz = pos[q + 2] - pos[p + 2];
    const vx = pos[r] - pos[p], vy = pos[r + 1] - pos[p + 1], vz = pos[r + 2] - pos[p + 2];
    let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const l = Math.hypot(cx, cy, cz) || 1;
    triN[t * 3] = cx / l; triN[t * 3 + 1] = cy / l; triN[t * 3 + 2] = cz / l;
  }

  const faces = new Map(); // vertex -> triangle ids
  for (let t = 0; t < idx.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let l = faces.get(v);
      if (!l) faces.set(v, (l = []));
      l.push(t);
    }
  }

  const outPos = [], outNrm = [], outIdx = new Uint32Array(idx.length);
  const cache = new Map(); // `${v}|${bucket}` -> new index
  for (let t = 0; t < idx.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let nx = 0, ny = 0, nz = 0;
      for (const f of faces.get(v)) {
        const d = triN[f * 3] * triN[t * 3] + triN[f * 3 + 1] * triN[t * 3 + 1] + triN[f * 3 + 2] * triN[t * 3 + 2];
        if (d >= NORMAL_ANGLE) { nx += triN[f * 3]; ny += triN[f * 3 + 1]; nz += triN[f * 3 + 2]; }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      // Quantise the normal to bucket near-identical ones onto one vertex.
      const key = `${v}|${Math.round(nx * 32)},${Math.round(ny * 32)},${Math.round(nz * 32)}`;
      let ni = cache.get(key);
      if (ni === undefined) {
        ni = outPos.length / 3;
        cache.set(key, ni);
        outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        outNrm.push(nx, ny, nz);
      }
      outIdx[t * 3 + k] = ni;
    }
  }
  return [new Float32Array(outPos), new Float32Array(outNrm), outIdx];
}

async function main() {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;

  const manifest = JSON.parse(fs.readFileSync("tools/out/mesh.json", "utf8"));
  const bin = fs.readFileSync("tools/out/mesh.bin");
  const posBase = 0, idxBase = manifest.pos_bytes;

  const groups = manifest.groups.map((g) => {
    const pos = new Float32Array(
      bin.buffer.slice(bin.byteOffset + posBase + g.pos_offset,
                       bin.byteOffset + posBase + g.pos_offset + g.vertex_count * 12));
    const idx = new Uint32Array(
      bin.buffer.slice(bin.byteOffset + idxBase + g.idx_offset,
                       bin.byteOffset + idxBase + g.idx_offset + g.index_count * 4));
    return { ...g, pos, idx, area: surfaceArea(pos, idx) };
  });

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("rov");
  const matBody = doc.createMaterial("body")
    .setBaseColorFactor([0.62, 0.68, 0.72, 1]).setMetallicFactor(0.15).setRoughnessFactor(0.55);
  const matAccent = doc.createMaterial("accent")
    .setBaseColorFactor([0.37, 0.92, 0.83, 1]).setMetallicFactor(0.25).setRoughnessFactor(0.4);
  // The LED and camera covers were clear acrylic.
  const matAcrylic = doc.createMaterial("acrylic")
    .setBaseColorFactor([0.86, 0.94, 0.98, 0.22]).setAlphaMode("BLEND")
    .setMetallicFactor(0).setRoughnessFactor(0.06);

  let before = 0, after = 0;
  const dumped = [];
  for (const g of groups) {
    const target = targetFor(g.name);
    const srcTris = g.idx.length / 3;

    let idx = g.idx;
    if (target < srcTris) {
      const [simplified] = MeshoptSimplifier.simplify(
        g.idx, g.pos, 3, target * 3, 0.05, ["LockBorder"]);
      idx = simplified;
    }
    let [pos, ni] = compact(g.pos, idx);
    const [fpos, fnrm, fidx] = normalsWithSplit(pos, ni);

    before += srcTris;
    after += fidx.length / 3;
    console.log(
      `  ${g.name.padEnd(12)} ${String(srcTris).padStart(7)} -> ${String(fidx.length / 3).padStart(6)} tris` +
      `  ${String(fpos.length / 3).padStart(6)} verts`);

    // Keep a world-space copy for the preview dump before the pivot shift.
    if (DUMP) dumped.push({ name: g.name, pos: fpos.slice(), idx: fidx });

    if (g.axis) {
      // Move the propeller's pivot onto its node origin so the runtime can
      // spin the node directly, and record the axis for it to read back.
      const [px, py, pz] = g.pivot;
      for (let i = 0; i < fpos.length; i += 3) {
        fpos[i] -= px; fpos[i + 1] -= py; fpos[i + 2] -= pz;
      }
      // An angled prop is stored in its pivot's local frame, whose +Y is the
      // real spin axis: undo the node rotation on the geometry here.
      if (g.rot) {
        const inv = [-g.rot[0], -g.rot[1], -g.rot[2], g.rot[3]];
        rotateAll(fpos, inv);
        rotateAll(fnrm, inv);
      }
    }

    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(fpos).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(fnrm).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(fidx).setBuffer(buffer))
      .setMaterial(g.axis ? matAccent : g.role ? matAcrylic : matBody);

    const mesh = doc.createMesh(g.name).addPrimitive(prim);
    if (g.axis) {
      // The spin pivot lives on a parent node, with the mesh on a child.
      // meshopt's quantization rewrites the translation of whichever node
      // holds the mesh (to store its dequantization offset, the bbox centre),
      // and a 3-blade prop's bbox centre is ~5mm off its axis — so a pivot on
      // the mesh node itself would make every prop orbit eccentrically.
      const pivot = doc.createNode(g.name)
        .setTranslation(g.pivot)
        .setExtras({ spinAxis: g.axis, spinSign: g.sign });
      if (g.rot) pivot.setRotation(g.rot);
      pivot.addChild(doc.createNode(`${g.name}_mesh`).setMesh(mesh));
      scene.addChild(pivot);
    } else if (g.role) {
      // Covers carry where their emitter/lens sits so the runtime can place
      // the LED light and camera without hardcoded coordinates.
      scene.addChild(doc.createNode(g.name).setMesh(mesh)
        .setExtras({ role: g.role, base: g.base, tip: g.tip, radius: g.radius }));
    } else {
      scene.addChild(doc.createNode(g.name).setMesh(mesh));
    }
  }

  console.log(`\ntotal: ${before} -> ${after} triangles`);

  if (DUMP) {
    let posBlob = Buffer.alloc(0), idxBlob = Buffer.alloc(0);
    const manifestOut = { groups: [], scale: 1 };
    for (const d of dumped) {
      manifestOut.groups.push({
        name: d.name,
        pos_offset: posBlob.length, vertex_count: d.pos.length / 3,
        idx_offset: idxBlob.length, index_count: d.idx.length,
      });
      posBlob = Buffer.concat([posBlob, Buffer.from(d.pos.buffer, d.pos.byteOffset, d.pos.byteLength)]);
      idxBlob = Buffer.concat([idxBlob, Buffer.from(d.idx.buffer, d.idx.byteOffset, d.idx.byteLength)]);
    }
    manifestOut.pos_bytes = posBlob.length;
    manifestOut.idx_bytes = idxBlob.length;
    fs.writeFileSync(`${DUMP}.bin`, Buffer.concat([posBlob, idxBlob]));
    fs.writeFileSync(`${DUMP}.json`, JSON.stringify(manifestOut, null, 1));
    console.log(`dumped decimated geometry -> ${DUMP}.json/.bin`);
  }

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  // meshopt compression rides on KHR_mesh_quantization — registering only the
  // compression extension silently drops both and writes an uncompressed GLB.
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

  const written = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
  console.log(`extensions: ${written.join(", ") || "(none)"}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(OUT, glb);
  console.log(`wrote ${OUT}  ${(glb.byteLength / 1024).toFixed(1)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
