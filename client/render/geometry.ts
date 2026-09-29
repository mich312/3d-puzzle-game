// Level-geometry mesh builders. Every piece keeps the EXACT axis-aligned footprint
// of its collider (bevels round inward, never outward), carries world-projected UVs
// (so textures line up across neighbouring pieces and never stretch), and an
// `aEdge` attribute (0 on flat faces → 1 on the bevel ridge) that the material
// shader uses for edge wear / highlight.
//
// All builders return INDEXED geometry with exactly: position, normal, uv, aEdge —
// so anything can be merged with anything (BufferGeometryUtils.mergeGeometries).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD_UV_DENSITY } from './textures';

const D = WORLD_UV_DENSITY;

/** bevel radius for a box — scales with the smallest dimension, small on thin slabs */
export function bevelFor(size: [number, number, number], role: string): number {
  const m = Math.min(size[0], size[1], size[2]);
  const max = role === 'metal' || role === 'accent' ? 0.05 : role === 'crystal' ? 0.04 : role === 'wood' ? 0.035 : 0.09;
  return Math.max(0.006, Math.min(max, m * 0.16));
}

/**
 * Rounded box via the cube-sphere construction: each face owns its half of every
 * bevel arc, so seams between faces coincide exactly and normals are smooth.
 * `seg` = arc segments per face-half (1 = soft chamfer, 2 = round).
 * UVs are projected in the box's local frame, offset by `uvOrigin` (the box centre
 * expressed along the same local axes) so they're continuous in world space.
 */
export function roundedBox(w: number, h: number, d: number, r: number, seg: number, uvOrigin?: THREE.Vector3): THREE.BufferGeometry {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  r = Math.min(r, hx * 0.999, hy * 0.999, hz * 0.999);
  const ix = hx - r, iy = hy - r, iz = hz - r;
  const o = uvOrigin ?? new THREE.Vector3();
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], edge: number[] = [];
  const idx: number[] = [];
  // per-axis samples: [inner offset sign, tangent t in -1..1]
  const samples: [number, number][] = [];
  for (let m = 0; m <= seg; m++) samples.push([-1, -1 + m / seg]);   // low arc t: -1 → 0
  for (let m = 0; m <= seg; m++) samples.push([1, m / seg]);         // high arc t: 0 → 1
  const S = samples.length;
  const inner = [ix, iy, iz];
  // face: axis (0=x,1=y,2=z), sign, tangent axes a,b
  const faces: [number, number, number, number][] = [
    [0, 1, 2, 1], [0, -1, 1, 2], [1, 1, 0, 2], [1, -1, 2, 0], [2, 1, 1, 0], [2, -1, 0, 1],
  ];
  const n = new THREE.Vector3(), p = new THREE.Vector3();
  const nv = [0, 0, 0], pv = [0, 0, 0];
  for (const [ax, sg, ta, tb] of faces) {
    const base = pos.length / 3;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const [sa, a] = samples[i], [sb, b] = samples[j];
        // cube-sphere direction
        nv[ax] = sg; nv[ta] = Math.tan(a * Math.PI / 4); nv[tb] = Math.tan(b * Math.PI / 4);
        n.set(nv[0], nv[1], nv[2]).normalize();
        pv[ax] = sg * inner[ax]; pv[ta] = sa * inner[ta]; pv[tb] = sb * inner[tb];
        p.set(pv[0] + n.x * r, pv[1] + n.y * r, pv[2] + n.z * r);
        pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z);
        edge.push(Math.max(Math.abs(a), Math.abs(b)));
        // project UV along the face's own tangent axes (world metres * density)
        const pc = [p.x + o.x, p.y + o.y, p.z + o.z];
        let u: number, v: number;
        if (ax === 1) { u = pc[0]; v = pc[2] * sg; }
        else if (ax === 0) { u = -pc[2] * sg; v = pc[1]; }
        else { u = pc[0] * sg; v = pc[1]; }
        uv.push(u * D, v * D);
      }
    }
    for (let j = 0; j < S - 1; j++) {
      for (let i = 0; i < S - 1; i++) {
        const a = base + j * S + i, b = a + 1, c = a + S, e = c + 1;
        // the (ta,tb) basis in the table is left-handed w.r.t. the outward normal,
        // so (a,e,b),(a,c,e) is the CCW (front-facing) order seen from outside
        idx.push(a, e, b, a, c, e);
      }
    }
  }
  return build(pos, nrm, uv, edge, idx);
}

/**
 * Cylinder with rounded top/bottom rims (lathe of a profile), exact radius/height.
 * Side UVs wrap in metres of circumference so nothing stretches.
 */
export function bevelCylinder(radius: number, height: number, r: number, radial: number, seg: number, uvOrigin?: THREE.Vector3): THREE.BufferGeometry {
  const hy = height / 2;
  r = Math.min(r, radius * 0.5, hy * 0.999);
  const o = uvOrigin ?? new THREE.Vector3();
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], edge: number[] = [];
  const idx: number[] = [];
  // side + rim arcs as one smooth strip: profile points (radius, y, nr, ny, edge)
  const prof: [number, number, number, number, number][] = [];
  for (let m = 0; m <= seg * 2; m++) {           // bottom arc: normal from -y to +r
    const t = m / (seg * 2), a = -Math.PI / 2 + t * Math.PI / 2;
    prof.push([radius - r + Math.cos(a) * r, -hy + r + Math.sin(a) * r, Math.cos(a), Math.sin(a), 1 - t]);
  }
  for (let m = 0; m <= seg * 2; m++) {           // top arc: normal from +r to +y
    const t = m / (seg * 2), a = t * Math.PI / 2;
    prof.push([radius - r + Math.cos(a) * r, hy - r + Math.sin(a) * r, Math.cos(a), Math.sin(a), t]);
  }
  const circ = 2 * Math.PI * radius;
  const cols = radial + 1;
  for (let k = 0; k < prof.length; k++) {
    const [pr, py, nr, ny, e] = prof[k];
    for (let s = 0; s <= radial; s++) {
      const th = (s / radial) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      pos.push(pr * sn, py, pr * c);
      nrm.push(nr * sn, ny, nr * c);
      edge.push(e);
      uv.push((s / radial) * circ * D, (py + o.y) * D);
    }
  }
  for (let k = 0; k < prof.length - 1; k++) {
    for (let s = 0; s < radial; s++) {
      const a = k * cols + s, b = a + 1, c = a + cols, e = c + 1;
      idx.push(a, b, e, a, e, c);
    }
  }
  // flat caps (top & bottom discs inside the rim)
  for (const sg of [1, -1]) {
    const cr = radius - r;
    const centre = pos.length / 3;
    pos.push(0, sg * hy, 0); nrm.push(0, sg, 0); edge.push(0); uv.push(o.x * D, o.z * D * sg);
    for (let s = 0; s <= radial; s++) {
      const th = (s / radial) * Math.PI * 2;
      const x = cr * Math.sin(th), z = cr * Math.cos(th);
      pos.push(x, sg * hy, z); nrm.push(0, sg, 0); edge.push(0);
      uv.push((x + o.x) * D, (z + o.z) * D * sg);
    }
    for (let s = 0; s < radial; s++) {
      if (sg > 0) idx.push(centre, centre + 1 + s, centre + 2 + s);
      else idx.push(centre, centre + 2 + s, centre + 1 + s);
    }
  }
  return build(pos, nrm, uv, edge, idx);
}

function build(pos: number[], nrm: number[], uv: number[], edge: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  return g;
}

/**
 * Normalise any geometry to the mergeable layout (indexed; position/normal/uv/aEdge).
 * `worldUV` re-projects UVs from world position along each vertex's dominant normal
 * axis (for irregular props like rock hangs) — call AFTER applying the transform.
 */
export function finalize(g: THREE.BufferGeometry, worldUV = false, edgeValue = 0): THREE.BufferGeometry {
  if (!g.index) {
    const n = g.getAttribute('position').count;
    const ids = new Array(n); for (let i = 0; i < n; i++) ids[i] = i;
    g.setIndex(ids);
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aEdge'].includes(k)) g.deleteAttribute(k);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.getAttribute('aEdge')) g.setAttribute('aEdge', new THREE.Float32BufferAttribute(new Float32Array(n).fill(edgeValue), 1));
  if (worldUV) {
    const p = g.getAttribute('position'), nr = g.getAttribute('normal'), uv = g.getAttribute('uv');
    for (let i = 0; i < n; i++) {
      const ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), az = Math.abs(nr.getZ(i));
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (ay >= ax && ay >= az) uv.setXY(i, x * D, z * D);
      else if (ax >= az) uv.setXY(i, z * D, y * D);
      else uv.setXY(i, x * D, y * D);
    }
    uv.needsUpdate = true;
  }
  return g;
}

/** A jagged inverted rock spike (flat-shaded, non-smooth) — for platform undersides. */
export function rockSpike(topRadius: number, depth: number, rnd: () => number, radial = 7, rings = 3): THREE.BufferGeometry {
  const pts: THREE.Vector3[][] = [];
  const twist = rnd() * Math.PI;
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const ring: THREE.Vector3[] = [];
    const rr = topRadius * Math.pow(1 - t, 0.85) * (k === rings ? 0 : 1);
    const lean = (rnd() - 0.5) * topRadius * 0.25 * t;
    for (let s = 0; s < radial; s++) {
      const a = (s / radial) * Math.PI * 2 + twist + k * 0.35;
      const j = k === 0 ? 0.92 + rnd() * 0.08 : 0.72 + rnd() * 0.5;
      ring.push(new THREE.Vector3(Math.cos(a) * rr * j + lean, -t * depth * (k === 0 ? 0 : 0.9 + rnd() * 0.1), Math.sin(a) * rr * j));
    }
    pts.push(ring);
  }
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  // top cap (hidden against the slab, but closes the mesh for shadows)
  for (let s = 1; s < radial - 1; s++) tri(pts[0][0], pts[0][s + 1], pts[0][s]);
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < radial; s++) {
      const a = pts[k][s], b = pts[k][(s + 1) % radial], c = pts[k + 1][s], d = pts[k + 1][(s + 1) % radial];
      tri(a, b, d); tri(a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();     // non-indexed → flat facets
  return g;
}

/** Merge a list of already-transformed, finalized geometries. */
export function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const m = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (m) { m.computeBoundingSphere(); m.computeBoundingBox(); }
  return m;
}
