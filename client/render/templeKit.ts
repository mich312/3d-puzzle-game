// Temple kit (sky-temples prototype) — pure, visual-only geometry builders for the
// Greek order dressing: fluted column shafts, pediment prisms, lathe ring bands
// and low-poly cloud puffs. Nothing here ever grows past a collider: the fluted
// shaft's arrises sit exactly on the collider radius and the flutes cut inward.
//
// Builders return non-indexed, flat-shaded geometry with position/normal/uv
// (+ aEdge where it matters); finalize() adds the index / missing attributes so
// everything merges with the level batches.
import * as THREE from 'three';
import { WORLD_UV_DENSITY } from './textures';

const D = WORLD_UV_DENSITY;

/**
 * Doric-ish shaft: 2F points around the rim alternate between the arris (r) and
 * the bottom of a V-flute (0.93 r); the top ring tapers to 0.93 (entasis-lite).
 * aEdge = 1 on the arrises → the edge-wear layer paints a free rim highlight.
 */
export function flutedShaft(r: number, h: number, tier: 'low' | 'medium' | 'high', uvOrigin?: THREE.Vector3): THREE.BufferGeometry {
  const F = tier === 'low' ? 12 : r < 0.8 ? 16 : 20;
  const hy = h / 2;
  const ox = uvOrigin?.x ?? 0, oy = uvOrigin?.y ?? 0;
  const pos: number[] = [], uv: number[] = [], edge: number[] = [];
  const ring = (k: number, y: number, s: number) => {
    const a = (k * Math.PI) / F;
    const rr = r * s * (k % 2 === 0 ? 1 : 0.93);
    return { x: Math.sin(a) * rr, y, z: Math.cos(a) * rr, u: (a * r + ox) * D, v: (y + oy) * D, e: k % 2 === 0 ? 1 : 0 };
  };
  type V = ReturnType<typeof ring>;
  const push = (...vs: V[]) => { for (const v of vs) { pos.push(v.x, v.y, v.z); uv.push(v.u, v.v); edge.push(v.e); } };
  for (let k = 0; k < 2 * F; k++) {
    const b0 = ring(k, -hy, 1), b1 = ring(k + 1, -hy, 1);
    const t0 = ring(k, hy, 0.93), t1 = ring(k + 1, hy, 0.93);
    push(b0, b1, t1, b0, t1, t0);
    // caps (fans around the axis)
    const ct = { x: 0, y: hy, z: 0, u: ox * D, v: (hy + oy) * D, e: 0 };
    const cb = { x: 0, y: -hy, z: 0, u: ox * D, v: (-hy + oy) * D, e: 0 };
    push(ct, t0, t1);
    push(cb, b1, b0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.computeVertexNormals();    // non-indexed → flat facets (crisp flutes at low res)
  return g;
}

/** triangular pediment: apex up, base on y = 0, depth along z */
export function pedimentPrism(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2, hz = d / 2;
  const L = [-hw, 0], R = [hw, 0], A = [0, h];
  const v = (p: number[], z: number) => [p[0], p[1], z];
  const tris: number[][][] = [
    [v(L, hz), v(R, hz), v(A, hz)],                         // front
    [v(R, -hz), v(L, -hz), v(A, -hz)],                      // back
    [v(L, -hz), v(R, -hz), v(R, hz)], [v(L, -hz), v(R, hz), v(L, hz)],   // bottom
    [v(R, hz), v(R, -hz), v(A, -hz)], [v(R, hz), v(A, -hz), v(A, hz)],   // right slope
    [v(L, -hz), v(L, hz), v(A, hz)], [v(L, -hz), v(A, hz), v(A, -hz)],   // left slope
  ];
  const pos: number[] = [];
  for (const t of tris) for (const p of t) pos.push(p[0], p[1], p[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** flat ring band (architrave / frieze / cornice of a tholos), base at y = 0 */
export function ringBand(R: number, width: number, height: number, segs = 64): THREE.BufferGeometry {
  const v2 = ([x, y]: number[]) => new THREE.Vector2(x, y);
  const prof = [[R - width / 2, 0], [R + width / 2, 0], [R + width / 2, height], [R - width / 2, height], [R - width / 2, 0]].map(v2);
  const g = new THREE.LatheGeometry(prof, segs).toNonIndexed();
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

/** one flattened, jittered, flat-shaded cloud puff with baked lit→shade vertex colours */
export function cloudPuffGeo(lit: THREE.Color, shade: THREE.Color, seed = 97): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const p = g.getAttribute('position');
  let a = seed >>> 0;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  const jit = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!jit.has(k)) jit.set(k, 0.8 + rnd() * 0.4);
    const s = jit.get(k)!;
    const y = p.getY(i);
    // flat-ish bottom, billowy top
    p.setXYZ(i, p.getX(i) * s, (y < 0 ? y * 0.45 : y) * s * 0.55, p.getZ(i) * s);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(shade).lerp(lit, THREE.MathUtils.clamp(0.5 + 0.5 * n.getY(i), 0, 1));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
