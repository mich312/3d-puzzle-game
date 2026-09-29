// Static level geometry → a handful of merged, bevelled, detailed meshes.
//
// Each static GeometryDef becomes a rounded box / bevelled cylinder with the exact
// collider footprint, baked into world space and merged per (material, shadow flag,
// 40 m cell) so the Nexus renders in ~100 draws instead of ~700 while frustum
// culling still works per cell.
//
// Architectural detailing is added procedurally from simple, conservative size
// heuristics and is purely visual (never collides):
//   • platforms  → a metal trim band just under the top edge (1.5 cm proud)
//   • walls      → a coping cap along exposed tops
//   • pillars    → plinth base, capital and an astragal ring (≤ 5 cm proud)
//   • floating platforms → inverted rock hangs BELOW the slab, inside the footprint,
//     only where there is clear air beneath (never into walkable space)
import * as THREE from 'three';
import type { GeometryDef, LevelDef, MaterialRole, Vec3 } from '../../shared/level';
import { getMaterial, getBatchMaterial, emissiveCap } from './materials';
import type { TexRole } from './textures';
import { roundedBox, bevelCylinder, bevelFor, rockSpike, finalize, mergeAll } from './geometry';
import { mulberry } from './textures';

export type Tier = 'low' | 'medium' | 'high';

const TRIM: Record<string, string> = {
  nexus: '#8c86b0', atrium: '#9aa8c8', vaults: '#6e76a0', gardens: '#b39063', observatory: '#c9a55a',
};
const ROCK: Record<string, string> = {
  nexus: '#8a84a6', atrium: '#8490b0', vaults: '#66628a', gardens: '#a48a90', observatory: '#64608a',
};

export interface Piece {
  g: GeometryDef; i: number;
  box: THREE.Box3;               // world AABB (rotated extents)
  w: number; h: number; d: number;   // local dims (cylinder: 2r, h, 2r)
  solid: boolean;
}

export function pieceOf(g: GeometryDef, i: number): Piece {
  const [x, y, z] = g.pos;
  let hx: number, hy: number, hz: number, w: number, d: number;
  if (g.shape === 'cylinder') { hx = hz = g.size[0]; hy = g.size[1] / 2; w = d = g.size[0] * 2; }
  else {
    const c = Math.abs(Math.cos(g.rotY ?? 0)), s = Math.abs(Math.sin(g.rotY ?? 0));
    hx = (c * g.size[0] + s * g.size[2]) / 2; hz = (s * g.size[0] + c * g.size[2]) / 2; hy = g.size[1] / 2;
    w = g.size[0]; d = g.size[2];
  }
  return {
    g, i, w, h: g.size[1], d,
    box: new THREE.Box3(new THREE.Vector3(x - hx, y - hy, z - hz), new THREE.Vector3(x + hx, y + hy, z + hz)),
    solid: g.collider !== false,
  };
}

/** Bevelled geometry for one GeometryDef, in LOCAL space (centre at origin, unrotated). */
export function pieceGeometry(g: GeometryDef, tier: Tier): THREE.BufferGeometry {
  const origin = new THREE.Vector3(...g.pos).applyAxisAngle(new THREE.Vector3(0, 1, 0), -(g.rotY ?? 0));
  if (g.shape === 'cylinder') {
    const r = g.size[0];
    // triangle budget: radial density ~7/m, round rims only on big high-tier drums
    const radial = Math.round(THREE.MathUtils.clamp(r * 7, 12, 40) / (tier === 'low' ? 1.5 : 1));
    const seg = tier === 'high' && r >= 1 ? 2 : 1;
    const bevel = bevelFor([r * 2, g.size[1], r * 2], g.material);
    return bevelCylinder(r, g.size[1], bevel, radial, seg, origin);
  }
  // soft chamfer everywhere; fully rounded arcs only on large high-tier pieces
  const big = Math.min(...g.size) >= 0.4 && Math.max(...g.size) >= 2;
  const seg = tier === 'high' && big ? 2 : 1;
  return roundedBox(g.size[0], g.size[1], g.size[2], bevelFor(g.size, g.material), seg, origin);
}

export function pieceMatrix(g: GeometryDef): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(g.rotY ?? 0);
  m.setPosition(g.pos[0], g.pos[1], g.pos[2]);
  return m;
}

/** A surface look: role + optional colour override + (size-capped) emissive. */
export interface Look { role: TexRole; color?: string; emissive?: string; ei: number }

export function pieceLook(g: GeometryDef): Look {
  const cap = g.emissive ? emissiveCap(g.size, g.shape, g.material) : 1;
  const ei = g.emissive ? Math.round(Math.min(g.emissiveIntensity ?? 1, cap) * 100) / 100 : 1;
  return { role: g.material, color: g.color, emissive: g.emissive, ei };
}

/** Material for a GeometryDef, emissive capped by the piece's size (no bloom slabs). */
export function pieceMaterial(g: GeometryDef): THREE.MeshStandardMaterial {
  const l = pieceLook(g);
  return getMaterial(l.role, l.color, l.emissive, l.ei);
}

/** Collects geometry per material bucket and flushes merged meshes. */
export class StaticBatcher {
  private buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  private tmpC = new THREE.Color();
  constructor(private cell = 40) {}

  /** add a finalized, world-space geometry with a surface look (colour → vertex colours) */
  add(geo: THREE.BufferGeometry, look: Look, cast: boolean, at: THREE.Vector3) {
    const mat = getBatchMaterial(look.role, look.emissive, look.ei);
    const c = this.tmpC.set(look.color ?? '#ffffff');
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const cx = Math.floor(at.x / this.cell), cz = Math.floor(at.z / this.cell);
    const key = `${mat.uuid}|${cast ? 1 : 0}|${cx},${cz}`;
    let b = this.buckets.get(key);
    if (!b) { b = { mat, cast, geos: [] }; this.buckets.set(key, b); }
    b.geos.push(geo);
  }

  flush(parent: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const b of this.buckets.values()) {
      const merged = mergeAll(b.geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

// ------------------------------------------------------------------ detailing
const STRUCT: MaterialRole[] = ['stone', 'tile', 'metal'];

interface DetailCtx {
  level: LevelDef; tier: Tier; pieces: Piece[]; keepOut: Vec3[];
  batch: StaticBatcher;
}

/** is anything (other than `self`) overlapping this world box? returns the highest top below `limitTop` */
function overlaps(ctx: DetailCtx, box: THREE.Box3, self: Piece): Piece[] {
  const hits: Piece[] = [];
  for (const p of ctx.pieces) if (p !== self && p.box.intersectsBox(box)) hits.push(p);
  return hits;
}

function addLocal(ctx: DetailCtx, geo: THREE.BufferGeometry, local: THREE.Matrix4, owner: GeometryDef, mat: Look, cast: boolean, worldUV = false) {
  geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(pieceMatrix(owner), local));
  finalize(geo, worldUV);
  ctx.batch.add(geo, mat, cast, new THREE.Vector3(...owner.pos));
}

/** top surface covered by something sitting on it? */
function topCovered(ctx: DetailCtx, p: Piece): boolean {
  const probe = p.box.clone();
  probe.min.y = p.box.max.y - 0.01; probe.max.y = p.box.max.y + 0.08;
  probe.expandByVector(new THREE.Vector3(-0.05, 0, -0.05));
  const area = (probe.max.x - probe.min.x) * (probe.max.z - probe.min.z);
  for (const q of ctx.pieces) {
    if (q === p || !q.box.intersectsBox(probe)) continue;
    const ix = Math.min(q.box.max.x, probe.max.x) - Math.max(q.box.min.x, probe.min.x);
    const iz = Math.min(q.box.max.z, probe.max.z) - Math.max(q.box.min.z, probe.min.z);
    if (ix * iz > area * 0.5) return true;
  }
  return false;
}

function trimBand(ctx: DetailCtx, p: Piece) {
  const g = p.g;
  const trimMat: Look = { role: 'metal', color: TRIM[ctx.level.world] ?? TRIM.nexus, ei: 1 };
  const bandH = THREE.MathUtils.clamp(p.h * 0.2, 0.05, 0.14);
  const y = p.h / 2 - 0.035 - bandH / 2;
  const t = 0.03;       // straddles the face: 1.5 cm proud, 1.5 cm buried
  const seg = 1;
  if (g.shape === 'cylinder') {
    const r = g.size[0];
    const geo = bevelCylinder(r + t / 2, bandH, 0.012, Math.round(THREE.MathUtils.clamp(r * 10, 14, 56)), seg);
    addLocal(ctx, geo, new THREE.Matrix4().makeTranslation(0, y, 0), g, trimMat, false);
    return;
  }
  const w = g.size[0], d = g.size[2];
  const bars: [number, number, number, number, number][] = [
    [w + t, bandH, t, 0, d / 2], [w + t, bandH, t, 0, -d / 2],
    [t, bandH, d + t, w / 2, 0], [t, bandH, d + t, -w / 2, 0],
  ];
  for (const [bw, bh, bd, x, z] of bars) {
    const geo = roundedBox(bw, bh, bd, 0.01, seg);
    addLocal(ctx, geo, new THREE.Matrix4().makeTranslation(x, y, z), g, trimMat, false, true);
  }
}

function coping(ctx: DetailCtx, p: Piece, mat: Look) {
  const g = p.g;
  const thinX = g.size[0] < g.size[2];
  const lip = 0.04, ch = 0.14;
  const w = thinX ? g.size[0] + lip * 2 : g.size[0];
  const d = thinX ? g.size[2] : g.size[2] + lip * 2;
  const geo = roundedBox(w, ch, d, 0.03, 1);
  addLocal(ctx, geo, new THREE.Matrix4().makeTranslation(0, g.size[1] / 2 - ch / 2 + 0.001, 0), g, mat, true, true);
}

function pillarDress(ctx: DetailCtx, p: Piece, mat: Look) {
  const g = p.g;
  const lip = 0.05;
  const hy = g.size[1] / 2;
  const parts: [number, number, number][] = [   // [height, lip, centreY]
    [0.24, lip, -hy + 0.12],
    [0.06, lip * 0.5, -hy + 0.27],
    [0.2, lip, hy - 0.1],
    [0.05, lip * 0.6, hy - 0.36],
  ];
  for (const [ph, l, cy] of parts) {
    let geo: THREE.BufferGeometry;
    if (g.shape === 'cylinder') {
      const r = g.size[0] + l;
      geo = bevelCylinder(r, ph, Math.min(0.03, ph * 0.3), Math.round(THREE.MathUtils.clamp(r * 10, 14, 40)), 1);
      addLocal(ctx, geo, new THREE.Matrix4().makeTranslation(0, cy, 0), g, mat, true, true);
    } else {
      geo = roundedBox(g.size[0] + l * 2, ph, g.size[2] + l * 2, Math.min(0.03, ph * 0.3), 1);
      addLocal(ctx, geo, new THREE.Matrix4().makeTranslation(0, cy, 0), g, mat, true, true);
    }
  }
}

function rockHang(ctx: DetailCtx, p: Piece, rnd: () => number) {
  const g = p.g;
  const minH = Math.min(p.w, p.d);
  let depth = THREE.MathUtils.clamp(minH * 0.45, 1.0, 9);
  // clearance: anything under the (shrunk) footprint limits the hang
  const probe = p.box.clone();
  probe.expandByVector(new THREE.Vector3(-p.w * 0.06, 0, -p.d * 0.06));
  probe.max.y = p.box.min.y - 0.01; probe.min.y = p.box.min.y - depth - 1.5;
  let floor = -Infinity;
  for (const q of overlaps(ctx, probe, p)) floor = Math.max(floor, q.box.max.y);
  if (floor > -Infinity) depth = Math.min(depth, p.box.min.y - floor - 1.2);
  // keep clear of spawns / interactables that might sit below
  for (const k of ctx.keepOut) {
    if (k[0] > probe.min.x && k[0] < probe.max.x && k[2] > probe.min.z && k[2] < probe.max.z && k[1] < p.box.min.y) {
      depth = Math.min(depth, p.box.min.y - k[1] - 2.5);
    }
  }
  if (depth < 0.8) return;
  const mat: Look = { role: 'rock', color: ROCK[ctx.level.world] ?? ROCK.nexus, ei: 1 };
  const bottom = -g.size[1] / 2 + 0.03;          // tuck into the slab's underside
  const maxSpikes = ctx.tier === 'low' ? 6 : ctx.tier === 'medium' ? 14 : 22;
  const cell = THREE.MathUtils.clamp(minH / 2, 1.4, 5);
  const spikes: [number, number, number][] = [];   // local x, z, top radius
  if (g.shape === 'cylinder') {
    const R = g.size[0];
    spikes.push([0, 0, Math.min(R * 0.7, cell * 0.9)]);
    const rings = Math.max(0, Math.floor(R / cell));
    for (let k = 1; k <= rings; k++) {
      const rr = (k / (rings + 0.5)) * R;
      const count = Math.max(4, Math.round((2 * Math.PI * rr) / cell));
      for (let s = 0; s < count; s++) {
        const a = (s / count) * Math.PI * 2 + rnd() * 0.4;
        const tr = Math.min(cell * 0.6, (R - rr) * 0.95);
        if (tr > 0.25) spikes.push([Math.cos(a) * rr, Math.sin(a) * rr, tr]);
      }
    }
  } else {
    const nx = Math.max(1, Math.round(p.w / cell)), nz = Math.max(1, Math.round(p.d / cell));
    const cw = p.w / nx, cd = p.d / nz;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const x = -p.w / 2 + cw * (ix + 0.5) + (rnd() - 0.5) * cw * 0.3;
        const z = -p.d / 2 + cd * (iz + 0.5) + (rnd() - 0.5) * cd * 0.3;
        const edge = Math.min(p.w / 2 - Math.abs(x), p.d / 2 - Math.abs(z));
        const tr = Math.min(Math.min(cw, cd) * 0.62, edge * 0.97);
        if (tr > 0.2) spikes.push([x, z, tr]);
      }
    }
  }
  // biggest/deepest in the middle: classic inverted-cone island silhouette
  const maxR = g.shape === 'cylinder' ? g.size[0] : Math.hypot(p.w, p.d) / 2;
  spikes.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  for (const [x, z, tr] of spikes.slice(0, maxSpikes)) {
    const centre = 1 - Math.hypot(x, z) / (maxR + 0.01);
    const dd = depth * (0.35 + 0.65 * centre) * (0.75 + rnd() * 0.35);
    if (dd < 0.3) continue;
    const geo = rockSpike(tr, Math.min(dd, depth), rnd, ctx.tier === 'low' ? 6 : 7, ctx.tier === 'low' ? 2 : 3);
    addLocal(ctx, geo, new THREE.Matrix4().makeTranslation(x, bottom, z), g, mat, true, true);
  }
}

/** Add procedural architectural details for every eligible static piece. */
export function addDetails(level: LevelDef, tier: Tier, pieces: Piece[], statics: Piece[], batch: StaticBatcher, keepOut: Vec3[]) {
  const ctx: DetailCtx = { level, tier, pieces, keepOut, batch };
  const rnd = mulberry(hashStr(level.id));
  for (const p of statics) {
    const g = p.g;
    if (!p.solid) continue;
    const role = g.material;
    const minH = Math.min(p.w, p.d), maxH = Math.max(p.w, p.d);
    const quarter = Math.abs(Math.sin(2 * (g.rotY ?? 0))) < 0.01;   // axis-aligned (trims read cleanly)
    const mat: Look = { role: g.material, color: g.color, ei: 1 };   // non-emissive twin for trims/caps
    // platform: trim band + hangs
    if ((STRUCT.includes(role) || role === 'wood') && p.h <= 4 && p.h >= 0.25 && minH >= 1.8 && maxH >= 2 && !g.emissive) {
      if (quarter || g.shape === 'cylinder') trimBand(ctx, p);
      if (role !== 'metal' && p.h <= 3 && minH >= 2.5) rockHang(ctx, p, rnd);
      continue;
    }
    if (!STRUCT.includes(role) || g.emissive) continue;
    // pillar: tall + slender
    if (p.h >= 2.2 && maxH <= 1.8 && p.h >= 1.8 * maxH && minH >= 0.25) { pillarDress(ctx, p, mat); continue; }
    // wall: tall, thin, long, exposed top
    if (g.shape === 'box' && quarter && p.h >= 2 && minH <= 1.5 && maxH >= 2.5 && !topCovered(ctx, p)) coping(ctx, p, mat);
  }
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
