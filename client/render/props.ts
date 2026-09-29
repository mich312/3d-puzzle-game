// Per-world set dressing — purely visual, no collision, deterministic (seeded by
// level id), instanced, tier-gated (low = none).
//
// Placement rules keep props out of the way:
//   • only along REAL edges of walkable tops (a drop or a wall base) — an edge that
//     continues into same-height floor is mid-path and skipped;
//   • never within ~1.5 m of interactables, spawns, checkpoints, doors (portals 2.5 m);
//   • never inside other geometry; low profile (≤ ~0.5 m) unless against a wall.
//
//   gardens      grass tufts, flowers, moss clumps, hanging vines (wind sway)
//   vaults       ice-crystal clusters at wall bases, pipe runs high on long walls
//   observatory  brass rings on pillars, small orreries, drifting star motes
//   nexus/atrium banners on tall pillars, lamp posts on edges, far floating debris
import * as THREE from 'three';
import type { LevelDef, Vec3 } from '../../shared/level';
import { getMaterial } from './materials';
import { markShared } from './dispose';
import { mulberry } from './textures';
import { finalize, mergeAll, roundedBox, bevelCylinder } from './geometry';
import { hashStr, type Piece, type Tier } from './levelMesh';

export interface KeepOut { p: Vec3; r: number }

export interface Dressing {
  group: THREE.Group;
  update(dt: number): void;
}

const windU = { value: 0 };

// ---------------------------------------------------------------- shared assets
const assets = new Map<string, THREE.BufferGeometry | THREE.Material>();
function asset<T extends THREE.BufferGeometry | THREE.Material>(key: string, make: () => T): T {
  let a = assets.get(key) as T | undefined;
  if (!a) { a = markShared(make()); assets.set(key, a); }
  return a;
}

/** vertex-coloured, wind-swayed foliage material (instanced) */
function foliageMat(key: string, sway: number, emissive = 0): THREE.MeshStandardMaterial {
  return asset(`fol|${key}`, () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    if (emissive) { m.emissive = new THREE.Color('#ffffff'); m.emissiveIntensity = emissive; }
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = windU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 ip = vec3(0.0);
          #endif
          float bend = max(position.y, 0.0);
          float ph = uWind * 1.7 + ip.x * 0.37 + ip.z * 0.29;
          transformed.x += sin(ph) * bend * bend * ${sway.toFixed(3)};
          transformed.z += cos(ph * 0.8 + 1.3) * bend * bend * ${(sway * 0.6).toFixed(3)};`);
    };
    m.customProgramCacheKey = () => `fol${sway}`;
    return m;
  });
}

function colorize(g: THREE.BufferGeometry, fn: (y: number, i: number) => THREE.Color) {
  const p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const col = fn(p.getY(i), i); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function grassGeo(): THREE.BufferGeometry {
  return asset('geo|grass', () => {
    const rnd = mulberry(77);
    const pos: number[] = [];
    for (let b = 0; b < 9; b++) {
      const a = rnd() * Math.PI * 2, h = 0.22 + rnd() * 0.22, w = 0.035 + rnd() * 0.02;
      const lean = 0.08 + rnd() * 0.12, ox = (rnd() - 0.5) * 0.18, oz = (rnd() - 0.5) * 0.18;
      const cx = Math.cos(a), sz = Math.sin(a);
      const px = -sz, pz = cx;   // blade plane across the lean direction
      const bl = [ox - px * w, 0, oz - pz * w], br = [ox + px * w, 0, oz + pz * w];
      const ml = [ox - px * w * 0.6 + cx * lean * 0.4, h * 0.55, oz - pz * w * 0.6 + sz * lean * 0.4];
      const mr = [ox + px * w * 0.6 + cx * lean * 0.4, h * 0.55, oz + pz * w * 0.6 + sz * lean * 0.4];
      const tp = [ox + cx * lean, h, oz + sz * lean];
      pos.push(...bl, ...br, ...mr, ...bl, ...mr, ...ml, ...ml, ...mr, ...tp);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const lo = new THREE.Color('#2e4a2a'), hi = new THREE.Color('#9fc46a');
    return colorize(g, (y) => lo.clone().lerp(hi, Math.min(1, y / 0.4)));
  });
}
function flowerGeo(): THREE.BufferGeometry {
  return asset('geo|flower', () => {
    const stem = new THREE.CylinderGeometry(0.008, 0.012, 0.32, 4).translate(0, 0.16, 0);
    const head = new THREE.CircleGeometry(0.06, 5).rotateX(-Math.PI / 2).translate(0, 0.33, 0);
    const heart = new THREE.SphereGeometry(0.02, 6, 4).translate(0, 0.335, 0);
    const parts = [stem, head, heart].map((g) => g.toNonIndexed());
    const cols = [new THREE.Color('#3d5a32'), new THREE.Color('#ffffff'), new THREE.Color('#ffd98a')];
    parts.forEach((g, k) => colorize(g, () => cols[k]));
    for (const g of parts) { g.deleteAttribute('uv'); }
    const m = mergeAll(parts)!;
    return m;
  });
}
function mossGeo(): THREE.BufferGeometry {
  return asset('geo|moss', () => {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    const rnd = mulberry(5);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setXYZ(i, p.getX(i) * (0.9 + rnd() * 0.2), Math.max(-0.05, y) * 0.22, p.getZ(i) * (0.9 + rnd() * 0.2));
    }
    g.computeVertexNormals();
    const a = new THREE.Color('#3f5a34'), b = new THREE.Color('#6d8a48');
    return colorize(g, (_y, i) => a.clone().lerp(b, (i * 0.618) % 1));
  });
}
function vineGeo(): THREE.BufferGeometry {
  return asset('geo|vine', () => {
    // hangs DOWN from y=0 to y=-1 (scaled per instance); position.y<0 → sway uses max(y,0)=0,
    // so we flip: sway is applied by the vine's own material using -y
    const pos: number[] = [];
    const rnd = mulberry(9);
    const segs = 8;
    for (let s = 0; s < segs; s++) {
      const y0 = -s / segs, y1 = -(s + 1) / segs, w = 0.012;
      pos.push(-w, y0, 0, w, y0, 0, w, y1, 0, -w, y0, 0, w, y1, 0, -w, y1, 0);
      // leaf pair
      const ly = (y0 + y1) / 2, side = s % 2 ? 1 : -1, L = 0.07 + rnd() * 0.05;
      pos.push(0, ly, 0, side * L, ly - 0.03, 0.03, side * L * 0.7, ly - 0.09, -0.02);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const a = new THREE.Color('#34502e'), b = new THREE.Color('#7fa65a');
    return colorize(g, (y, i) => a.clone().lerp(b, ((i * 0.37) % 1) * 0.7 + (-y) * 0.3));
  });
}
function vineMat(): THREE.MeshStandardMaterial {
  return asset('mat|vine', () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = windU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 ip = instanceMatrix[3].xyz;
          float hang = -position.y;
          transformed.z += sin(uWind * 1.2 + ip.x * 0.5 + ip.z * 0.3) * hang * hang * 0.12;`);
    };
    m.customProgramCacheKey = () => 'vine';
    return m;
  });
}
function iceGeo(): THREE.BufferGeometry {
  return asset('geo|ice', () => {
    const rnd = mulberry(31);
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const h = 0.25 + rnd() * 0.45, r = 0.04 + rnd() * 0.05;
      const shaft = new THREE.CylinderGeometry(r, r * 1.1, h, 6).translate(0, h / 2, 0);
      const tip = new THREE.ConeGeometry(r, r * 2.5, 6).translate(0, h + r * 1.25, 0);
      for (const g of [shaft, tip]) {
        g.rotateZ((rnd() - 0.5) * 0.9); g.rotateX((rnd() - 0.5) * 0.9);
        g.translate((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25);
        parts.push(finalize(g.toNonIndexed()));
      }
    }
    const m = mergeAll(parts)!;
    m.computeVertexNormals();
    return m;
  });
}
function rockGeo(): THREE.BufferGeometry {
  return asset('geo|rock', () => {
    const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    const rnd = mulberry(13);
    const p = g.getAttribute('position');
    const jit = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!jit.has(k)) jit.set(k, 0.7 + rnd() * 0.5);
      const s = jit.get(k)!;
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.75, p.getZ(i) * s);
    }
    g.computeVertexNormals();
    return finalize(g, true);     // object-space box projection (instances share it)
  });
}

// ---------------------------------------------------------------- placement
interface Ctx {
  level: LevelDef; tier: Tier; pieces: Piece[]; statics: Piece[]; keepOut: KeepOut[]; rnd: () => number;
  density: number;
}
interface EdgePt { pos: THREE.Vector3; out: THREE.Vector3; wall: boolean; drop: boolean; p: Piece }

const WALKABLE = new Set(['stone', 'tile', 'wood', 'metal']);

function clearOf(ctx: Ctx, x: number, y: number, z: number, extra = 0): boolean {
  for (const k of ctx.keepOut) {
    const dy = Math.abs(k.p[1] - y);
    if (dy < 3.5 && Math.hypot(k.p[0] - x, k.p[2] - z) < k.r + extra) return false;
  }
  return true;
}
function insideAny(ctx: Ctx, x: number, y: number, z: number, self?: Piece): Piece | undefined {
  for (const q of ctx.pieces) {
    if (q === self) continue;
    const b = q.box;
    if (x > b.min.x && x < b.max.x && y > b.min.y && y < b.max.y && z > b.min.z && z < b.max.z) return q;
  }
  return undefined;
}

/** sample points along the real edges of walkable tops */
function edgePoints(ctx: Ctx, spacing: number, insetMin: number, insetMax: number): EdgePt[] {
  const out: EdgePt[] = [];
  const rnd = ctx.rnd;
  for (const p of ctx.statics) {
    const g = p.g;
    if (!p.solid || !WALKABLE.has(g.material) || Math.min(p.w, p.d) < 1.0 || p.h < 0.15) continue;
    const top = p.box.max.y;
    const rot = g.rotY ?? 0, c = Math.cos(rot), s = Math.sin(rot);
    const toWorld = (lx: number, lz: number) => new THREE.Vector3(g.pos[0] + lx * c + lz * s, top, g.pos[2] - lx * s + lz * c);
    const cand: [THREE.Vector3, THREE.Vector3][] = [];   // [point, outward dir]
    if (g.shape === 'cylinder') {
      const R = g.size[0];
      const n = Math.floor((2 * Math.PI * R) / spacing);
      for (let i = 0; i < n; i++) {
        const a = ((i + rnd() * 0.6) / n) * Math.PI * 2, e = insetMin + rnd() * (insetMax - insetMin);
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        cand.push([new THREE.Vector3(g.pos[0] + dir.x * (R - e), top, g.pos[2] + dir.z * (R - e)), dir]);
      }
    } else {
      const hw = g.size[0] / 2, hd = g.size[2] / 2;
      const sides: [number, number, number, number, number][] = [   // start x,z, along x,z, length
        [-hw, hd, 1, 0, g.size[0]], [-hw, -hd, 1, 0, g.size[0]], [hw, -hd, 0, 1, g.size[2]], [-hw, -hd, 0, 1, g.size[2]],
      ];
      for (const [sx, sz, ax, az, len] of sides) {
        const n = Math.floor(len / spacing);
        const nx = az !== 0 ? Math.sign(sx) : 0, nz = ax !== 0 ? Math.sign(sz) : 0;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.2 + rnd() * 0.6) * (len / Math.max(n, 1));
          const e = insetMin + rnd() * (insetMax - insetMin);
          const lx = sx + ax * t - nx * e, lz = sz + az * t - nz * e;
          if (Math.abs(lx) > hw - 0.05 || Math.abs(lz) > hd - 0.05) continue;
          const o = new THREE.Vector3(nx * c + nz * s, 0, -nx * s + nz * c);
          cand.push([toWorld(lx, lz), o]);
        }
      }
    }
    for (const [pt, dir] of cand) {
      // outward probe just past the edge, slightly below the top surface
      const probe = pt.clone().addScaledVector(dir, insetMax + 0.35);
      const nb = insideAny(ctx, probe.x, top - 0.05, probe.z, p) ?? insideAny(ctx, probe.x, top + 0.4, probe.z, p);
      let wall = false, drop = false;
      if (nb) {
        const nTop = nb.box.max.y;
        if (Math.abs(nTop - top) < 0.35) continue;           // floor continues → mid-path, skip
        if (nTop > top + 0.9) wall = true; else continue;    // small step: keep clear
      } else drop = true;
      // occupancy above the point
      if (insideAny(ctx, pt.x, top + 0.1, pt.z, p) || insideAny(ctx, pt.x, top + 0.45, pt.z, p)) continue;
      if (!clearOf(ctx, pt.x, top, pt.z)) continue;
      out.push({ pos: pt, out: dir, wall, drop, p });
    }
  }
  return out;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], cast = false): THREE.InstancedMesh | null {
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = cast; im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}
const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
function mtx(pos: THREE.Vector3, rotY: number, sx: number, sy = sx, sz = sx): THREE.Matrix4 {
  tmpQ.setFromAxisAngle(Y, rotY); tmpS.set(sx, sy, sz);
  return new THREE.Matrix4().compose(pos, tmpQ, tmpS);
}

// ---------------------------------------------------------------- per world
function gardens(ctx: Ctx, grp: THREE.Group) {
  const rnd = ctx.rnd;
  const pts = edgePoints(ctx, 0.55 / ctx.density, 0.12, 0.55);
  const grass: THREE.Matrix4[] = [], gcol: THREE.Color[] = [];
  const flowers: THREE.Matrix4[] = [], fcol: THREE.Color[] = [];
  const moss: THREE.Matrix4[] = [];
  const petals = ['#ff9ecb', '#ffd98a', '#f4f0ff', '#ffb38a', '#d6a8ff'].map((c) => new THREE.Color(c));
  for (const e of pts) {
    const r = rnd();
    const pos = e.pos.clone(); pos.y += 0.005;
    if (r < 0.62) {
      grass.push(mtx(pos, rnd() * 6.28, 0.8 + rnd() * 0.7, 0.7 + rnd() * 0.8));
      gcol.push(new THREE.Color().setHSL(0.22 + rnd() * 0.08, 0.3 + rnd() * 0.25, 0.55 + rnd() * 0.25));
      if (rnd() < 0.35) {
        const fp = pos.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3));
        flowers.push(mtx(fp, rnd() * 6.28, 0.8 + rnd() * 0.6)); fcol.push(petals[Math.floor(rnd() * petals.length)]);
      }
    } else if (r < 0.85) {
      moss.push(mtx(pos, rnd() * 6.28, 0.5 + rnd() * 0.9, 0.6 + rnd() * 0.6, 0.5 + rnd() * 0.9));
    }
  }
  const add = (m: THREE.Object3D | null) => { if (m) grp.add(m); };
  add(instanced(grassGeo(), foliageMat('grass', 0.35), grass, gcol));
  add(instanced(flowerGeo(), foliageMat('flower', 0.3, 0.06), flowers, fcol));
  add(instanced(mossGeo(), foliageMat('moss', 0), moss));
  // vines over real drops (air below the edge)
  const vines: THREE.Matrix4[] = [];
  const vpts = edgePoints(ctx, 0.9 / ctx.density, 0.0, 0.02);
  for (const e of vpts) {
    if (!e.drop || rnd() < 0.45) continue;
    const top = e.pos.y;
    const hang = 0.8 + rnd() * 2.2;
    const below = e.pos.clone().addScaledVector(e.out, 0.25);
    if (insideAny(ctx, below.x, top - hang * 0.5, below.z) || insideAny(ctx, below.x, top - hang, below.z)) continue;
    const pos = e.pos.clone().addScaledVector(e.out, 0.05); pos.y = top + 0.02;
    const yaw = Math.atan2(e.out.x, e.out.z);
    vines.push(mtx(pos, yaw + (rnd() - 0.5) * 0.4, 1.3 + rnd() * 0.6, hang, 1.3));
  }
  add(instanced(vineGeo(), vineMat(), vines));
}

function vaults(ctx: Ctx, grp: THREE.Group) {
  const rnd = ctx.rnd;
  const pts = edgePoints(ctx, 0.9 / ctx.density, 0.15, 0.45);
  const ice: THREE.Matrix4[] = [];
  for (const e of pts) {
    if (!(e.wall || rnd() < 0.25) || rnd() < 0.3) continue;
    const pos = e.pos.clone(); pos.y -= 0.02;
    const s = e.wall ? 0.8 + rnd() * 0.9 : 0.5 + rnd() * 0.4;
    ice.push(mtx(pos, rnd() * 6.28, s, s * (0.8 + rnd() * 0.6), s));
  }
  const iceMat = asset('mat|ice', () => new THREE.MeshStandardMaterial({
    color: '#bfe2ff', emissive: '#6fb8ff', emissiveIntensity: 0.35, roughness: 0.08, metalness: 0, flatShading: true, envMapIntensity: 1.5,
  }));
  const im = instanced(iceGeo(), iceMat, ice);
  if (im) grp.add(im);
  // pipe runs high along long walls (both faces), with brackets
  const pipeParts: THREE.BufferGeometry[] = [];
  for (const p of ctx.statics) {
    const g = p.g;
    if (g.shape !== 'box' || !p.solid || g.material === 'crystal' || g.emissive) continue;
    const thinX = g.size[0] < g.size[2];
    const len = thinX ? g.size[2] : g.size[0], thick = thinX ? g.size[0] : g.size[2];
    if (g.size[1] < 3.4 || len < 4 || thick > 1.6 || Math.abs(Math.sin(2 * (g.rotY ?? 0))) > 0.01) continue;
    const topY = p.box.max.y;
    for (const side of [-1, 1]) {
      if (rnd() < 0.35) continue;
      const off = thick / 2 + 0.16;
      for (const [dy, r] of [[-0.45, 0.07], [-0.72, 0.045]] as const) {
        const y = topY + dy;
        const L = len - 0.3;
        // stop short of doors/portals and keep-out zones
        const cx = g.pos[0] + (thinX ? side * off : 0), cz = g.pos[2] + (thinX ? 0 : side * off);
        if (!clearOf(ctx, cx, y - 2, cz, -0.5)) continue;
        if (insideAny(ctx, cx, y, cz, p)) continue;
        const pipe = new THREE.CylinderGeometry(r, r, L, 10, 1);
        if (thinX) pipe.rotateX(Math.PI / 2); else pipe.rotateZ(Math.PI / 2);
        pipe.translate(cx, y, cz);
        pipeParts.push(finalize(pipe, true));
        for (let t = -L / 2 + 0.6; t < L / 2; t += 2.2) {
          const bw = thinX ? [0.34, 0.08, 0.08] : [0.08, 0.08, 0.34];
          const br = roundedBox(bw[0], bw[1] * 3, bw[2], 0.015, 1);
          const bx = thinX ? g.pos[0] + side * (thick / 2 + 0.08) : g.pos[0] + t;
          const bz = thinX ? g.pos[2] + t : g.pos[2] + side * (thick / 2 + 0.08);
          br.translate(bx, y, bz);
          pipeParts.push(finalize(br, true));
        }
      }
    }
  }
  const merged = mergeAll(pipeParts);
  if (merged) {
    const m = new THREE.Mesh(merged, getMaterial('metal', '#a29ec0'));
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  }
}

function observatory(ctx: Ctx, grp: THREE.Group) {
  const rnd = ctx.rnd;
  const brass = getMaterial('accent', '#c9a55a');
  const parts: THREE.BufferGeometry[] = [];
  // brass rings on pillars
  for (const p of ctx.statics) {
    const maxH = Math.max(p.w, p.d);
    if (!p.solid || p.h < 2.2 || maxH > 1.8 || p.h < 1.8 * maxH) continue;
    const r = maxH / 2 + 0.09;
    for (const f of [0.25, 0.62]) {
      const ring = new THREE.TorusGeometry(r, 0.03, 6, 36).rotateX(Math.PI / 2);
      ring.translate(p.g.pos[0], p.box.min.y + p.h * f, p.g.pos[2]);
      parts.push(finalize(ring, true));
    }
  }
  // small orreries on some wall-base corners
  const pts = edgePoints(ctx, 3.5, 0.4, 0.6).filter((e) => e.wall);
  let n = 0;
  for (const e of pts) {
    if (n >= 6 * ctx.density || rnd() < 0.6) continue;
    n++;
    const base = e.pos.clone();
    const stand = bevelCylinder(0.12, 0.5, 0.02, 12, 1); stand.translate(base.x, base.y + 0.25, base.z); parts.push(finalize(stand, true));
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.TorusGeometry(0.22 + k * 0.05, 0.012, 6, 32);
      ring.rotateX(rnd() * Math.PI); ring.rotateZ(rnd() * Math.PI);
      ring.translate(base.x, base.y + 0.78, base.z);
      parts.push(finalize(ring, true));
    }
  }
  const merged = mergeAll(parts);
  if (merged) { const m = new THREE.Mesh(merged, brass); m.castShadow = true; grp.add(m); }
  // drifting star motes around the play space
  const box = new THREE.Box3();
  for (const p of ctx.statics) box.union(p.box);
  const count = Math.round(260 * ctx.density);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = THREE.MathUtils.lerp(box.min.x - 8, box.max.x + 8, rnd());
    pos[i * 3 + 1] = THREE.MathUtils.lerp(box.min.y + 1, box.max.y + 10, rnd());
    pos[i * 3 + 2] = THREE.MathUtils.lerp(box.min.z - 8, box.max.z + 8, rnd());
  }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts3 = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#ffe6a8', size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false }));
  pts3.name = 'motes';
  grp.add(pts3);
}

const texAssets = new Map<string, THREE.Texture>();
function bannerTexture(base: string, trim: string): THREE.Texture {
  const hit = texAssets.get(base);
  if (hit) return hit;
  const t = markShared((() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 160;
    const x = c.getContext('2d')!;
    x.fillStyle = base; x.fillRect(0, 0, 64, 160);
    const grad = x.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.25)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.06)'); grad.addColorStop(1, 'rgba(0,0,0,0.25)');
    x.fillStyle = grad; x.fillRect(0, 0, 64, 160);
    x.strokeStyle = trim; x.lineWidth = 3; x.strokeRect(5, 3, 54, 150);
    x.fillStyle = trim;
    // emblem: a threshold arch + star
    x.beginPath(); x.moveTo(32, 40); x.lineTo(44, 62); x.lineTo(32, 84); x.lineTo(20, 62); x.closePath(); x.fill();
    x.fillStyle = base; x.beginPath(); x.moveTo(32, 50); x.lineTo(38, 62); x.lineTo(32, 74); x.lineTo(26, 62); x.closePath(); x.fill();
    x.fillStyle = trim;
    for (let i = 0; i < 3; i++) x.fillRect(22, 100 + i * 9, 20, 3);
    // swallowtail
    x.clearRect(0, 150, 64, 10);
    x.beginPath(); x.moveTo(0, 150); x.lineTo(32, 140); x.lineTo(64, 150); x.lineTo(64, 160); x.lineTo(0, 160); x.closePath();
    x.globalCompositeOperation = 'destination-out'; x.fill(); x.globalCompositeOperation = 'source-over';
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
    return tx;
  })());
  texAssets.set(base, t);
  return t;
}

function nexusLike(ctx: Ctx, grp: THREE.Group, world: 'nexus' | 'atrium') {
  const rnd = ctx.rnd;
  const col = world === 'nexus' ? { cloth: '#4a3a78', trim: '#ffd98a', lamp: '#ffd9a0' } : { cloth: '#2f4a7a', trim: '#cfe0ff', lamp: '#cfe4ff' };
  // banners on tall pillars (face toward the level centre)
  const bmat = asset(`mat|banner|${world}`, () => {
    const m = new THREE.MeshStandardMaterial({ map: bannerTexture(col.cloth, col.trim), side: THREE.DoubleSide, roughness: 0.9, alphaTest: 0.5 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = windU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float hang = clamp(-position.y / 2.4, 0.0, 1.0);
          transformed.z += sin(uWind * 1.4 + position.y * 2.2 + modelMatrix[3].x) * hang * 0.12;`);
    };
    m.customProgramCacheKey = () => 'banner';
    return m;
  });
  const bgeo = asset('geo|banner', () => new THREE.PlaneGeometry(0.9, 2.4, 1, 10).translate(0, -1.2, 0));
  const centre = new THREE.Vector3();
  for (const p of ctx.statics) centre.add(new THREE.Vector3(...p.g.pos));
  centre.divideScalar(Math.max(1, ctx.statics.length));
  let banners = 0;
  for (const p of ctx.statics) {
    const g = p.g;
    const maxH = Math.max(p.w, p.d);
    if (!p.solid || !['stone', 'tile'].includes(g.material) || p.h < 3.6 || maxH > 2 || p.h < 2.2 * maxH) continue;
    if (banners > 24 * ctx.density || rnd() < 0.35) continue;
    const dir = new THREE.Vector3(centre.x - g.pos[0], 0, centre.z - g.pos[2]).normalize();
    if (!Number.isFinite(dir.x)) continue;
    const topY = p.box.max.y - 0.45;
    const pos = new THREE.Vector3(g.pos[0], topY, g.pos[2]).addScaledVector(dir, maxH / 2 + 0.03);
    if (!clearOf(ctx, pos.x, topY - 2.5, pos.z, -0.5) || topY - 2.4 < p.box.min.y + 0.3) continue;
    const m = new THREE.Mesh(bgeo, bmat);
    m.position.copy(pos); m.rotation.y = Math.atan2(dir.x, dir.z);
    m.castShadow = true;
    grp.add(m);
    banners++;
  }
  // lamp posts along real drops of big platforms
  const lampParts: THREE.BufferGeometry[] = [], glassParts: THREE.BufferGeometry[] = [];
  const pts = edgePoints(ctx, 7, 0.35, 0.45).filter((e) => e.drop && Math.min(e.p.w, e.p.d) >= 4);
  let lamps = 0;
  for (const e of pts) {
    if (lamps >= 40 * ctx.density || rnd() < 0.4) continue;
    if (!clearOf(ctx, e.pos.x, e.pos.y, e.pos.z, 1.0)) continue;
    lamps++;
    const b = e.pos;
    const add = (g: THREE.BufferGeometry, list: THREE.BufferGeometry[], y: number) => { g.translate(b.x, b.y + y, b.z); list.push(finalize(g, true)); };
    add(bevelCylinder(0.16, 0.18, 0.03, 12, 1), lampParts, 0.09);
    add(bevelCylinder(0.045, 2.3, 0.01, 8, 1), lampParts, 1.33);
    add(roundedBox(0.26, 0.05, 0.26, 0.015, 1), lampParts, 2.5);
    add(roundedBox(0.3, 0.06, 0.3, 0.02, 1), lampParts, 2.86);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const post = roundedBox(0.03, 0.34, 0.03, 0.008, 1); post.translate(x * 0.11, 0, z * 0.11);
      add(post, lampParts, 2.68);
    }
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.26, 10), glassParts, 2.68);
  }
  const lm = mergeAll(lampParts);
  if (lm) { const m = new THREE.Mesh(lm, getMaterial('metal', '#3e3a56')); m.castShadow = true; grp.add(m); }
  const gm = mergeAll(glassParts);
  if (gm) grp.add(new THREE.Mesh(gm, asset(`mat|lamp|${col.lamp}`, () => new THREE.MeshStandardMaterial({ color: col.lamp, emissive: col.lamp, emissiveIntensity: 2.2 }))));
  // far floating debris around the islands (distance dressing)
  const box = new THREE.Box3();
  for (const p of ctx.statics) box.union(p.box);
  const c = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2;
  const n = Math.round((world === 'nexus' ? 90 : 40) * ctx.density);
  const deb: THREE.Matrix4[] = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = rad + 25 + rnd() * 60;
    // relative to the level centre: the debris ring slowly turns about it
    const pos = new THREE.Vector3(Math.cos(a) * d, -38 + Math.pow(rnd(), 1.5) * 42, Math.sin(a) * d);
    const s = 0.6 + Math.pow(rnd(), 2.5) * 3.5;
    deb.push(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 6, rnd() * 3)), new THREE.Vector3(s, s, s)));
  }
  const dm = instanced(rockGeo(), getMaterial('rock', world === 'nexus' ? '#6a6484' : '#646e8e'), deb);
  if (dm) { dm.name = 'debris'; dm.position.copy(c); dm.frustumCulled = false; grp.add(dm); }
}

/** Build the dressing for a level (empty on low tier). */
export function buildDressing(level: LevelDef, tier: Tier, pieces: Piece[], statics: Piece[], keepOut: KeepOut[]): Dressing {
  const group = new THREE.Group();
  group.name = 'dressing';
  if (tier === 'low') return { group, update() {} };
  const ctx: Ctx = {
    level, tier, pieces, statics, keepOut, rnd: mulberry(hashStr(level.id) ^ 0x9e3779b9),
    density: tier === 'high' ? 1 : 0.5,
  };
  switch (level.world) {
    case 'gardens': gardens(ctx, group); break;
    case 'vaults': vaults(ctx, group); break;
    case 'observatory': observatory(ctx, group); break;
    case 'nexus': nexusLike(ctx, group, 'nexus'); break;
    case 'atrium': nexusLike(ctx, group, 'atrium'); break;
  }
  const debris = group.getObjectByName('debris');
  const motes = group.getObjectByName('motes');
  let t = 0;
  return {
    group,
    update(dt) {
      t += dt;
      windU.value += dt;
      if (debris) debris.rotation.y += dt * 0.004;
      if (motes) { motes.position.y = Math.sin(t * 0.2) * 0.4; motes.rotation.y += dt * 0.01; }
    },
  };
}
