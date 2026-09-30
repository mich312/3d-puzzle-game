// Cloud dressing for the sky-temples theme — opaque, flat-shaded, instanced puffs
// (no soft particles, no transparency: they read as crisp shapes at low res and
// cost two draws). Deterministic via the dressing ctx's seeded rnd.
//
//   cloudCollars  puffs tucked UNDER floating platforms (world space), so islands
//                 sit on cloud instead of hanging over nothing
//   cloudRing     a slow-turning ring of puffs + distant banks around the level
//                 (centre-relative, replaces the old far debris ring)
import * as THREE from 'three';
import { markShared } from './dispose';
import { cloudPuffGeo } from './templeKit';
import { SKY_THEME, SKY_PALETTES } from './theme';
import type { Piece, Tier } from './levelMesh';

export interface CloudCtx {
  tier: Tier; pieces: Piece[]; statics: Piece[]; rnd: () => number;
}

function inside(pieces: Piece[], x: number, y: number, z: number): boolean {
  for (const q of pieces) {
    const b = q.box;
    if (x > b.min.x && x < b.max.x && y > b.min.y && y < b.max.y && z > b.min.z && z < b.max.z) return true;
  }
  return false;
}

const assets = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material }>();
function puffAssets(world: string) {
  let a = assets.get(world);
  if (a) return a;
  const p = SKY_PALETTES[world];
  const lit = new THREE.Color(p.cloudLit), shade = new THREE.Color(p.cloudShade);
  a = {
    geo: markShared(cloudPuffGeo(lit, shade)),
    mat: markShared(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: shade.clone().multiplyScalar(0.25) })),
  };
  assets.set(world, a);
  return a;
}

/** add the cloud meshes to `grp`; returns the names it created */
export function buildClouds(ctx: CloudCtx, grp: THREE.Group, world: string): string[] {
  if (!SKY_THEME || !SKY_PALETTES[world]) return [];
  const { geo, mat } = puffAssets(world);
  const rnd = ctx.rnd;
  const names: string[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();

  // (a) collars under floating platforms
  const cap = ctx.tier === 'low' ? 120 : 220;
  const collars: THREE.Matrix4[] = [];
  for (const p of ctx.statics) {
    const g = p.g;
    if (collars.length >= cap) break;
    if (!p.solid || !['stone', 'tile', 'metal', 'wood'].includes(g.material) || g.emissive) continue;
    if (p.h > 4 || Math.min(p.w, p.d) < 2.5) continue;
    // floating: no solid piece in the 12 m of air under the (shrunk) footprint
    const probe = p.box.clone();
    probe.expandByVector(new THREE.Vector3(-p.w * 0.1, 0, -p.d * 0.1));
    probe.max.y = p.box.min.y - 0.5; probe.min.y = p.box.min.y - 12;
    if (ctx.pieces.some((o) => o !== p && o.solid && o.box.intersectsBox(probe))) continue;
    const footR = Math.min(p.w, p.d) / 2;
    const n = THREE.MathUtils.clamp(Math.round(footR / 3), 2, 7);
    const cx = (p.box.min.x + p.box.max.x) / 2, cz = (p.box.min.z + p.box.max.z) / 2;
    for (let k = 0; k < n && collars.length < cap; k++) {
      const a = rnd() * Math.PI * 2, rr = footR * (0.55 + rnd() * 0.6);
      const y = p.box.min.y - (2.5 + rnd() * 5);
      const s = THREE.MathUtils.clamp(footR * 0.35, 1.5, 5) * (0.7 + rnd() * 0.6);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      if (inside(ctx.pieces, x, y, z) || y + 0.55 * s > p.box.min.y - 1.0) continue;
      q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0));
      collars.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)));
    }
  }
  if (collars.length) {
    const im = new THREE.InstancedMesh(geo, mat, collars.length);
    collars.forEach((m, i) => im.setMatrixAt(i, m));
    im.name = 'cloudCollars';
    im.computeBoundingSphere();
    im.receiveShadow = true;
    grp.add(im);
    names.push(im.name);
  }

  // (b) ring of puffs + far banks around the level, relative to its centre
  const box = new THREE.Box3();
  for (const p of ctx.statics) box.union(p.box);
  const c = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2;
  const ring: THREE.Matrix4[] = [];
  const n = world === 'nexus' ? 70 : 30;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = rad + 30 + rnd() * 70;
    const s = 4 + rnd() * 6;
    q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0));
    ring.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, -26 + rnd() * 14 - c.y, Math.sin(a) * d), q, new THREE.Vector3(s, s, s)));
  }
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, d = 140 + rnd() * 60;
    const s = 10 + rnd() * 12;
    q.setFromEuler(e.set(0, rnd() * Math.PI * 2, 0));
    ring.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, -5 + rnd() * 20 - c.y, Math.sin(a) * d), q, new THREE.Vector3(s * 1.6, s * 0.4, s)));
  }
  const rm = new THREE.InstancedMesh(geo, mat, ring.length);
  ring.forEach((m, i) => rm.setMatrixAt(i, m));
  rm.name = 'cloudRing';
  rm.position.copy(c);
  rm.frustumCulled = false;
  grp.add(rm);
  names.push(rm.name);
  return names;
}
