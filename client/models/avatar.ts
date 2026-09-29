// The explorer avatar: a sculpted, skinned procedural character (lathe-profiled
// limbs, beveled clearcoat armour plates, woven suit fabric, a glassy fresnel visor,
// backpack + harness, accent-emissive trims) and a procedural locomotion system —
// two-bone leg IK with foot planting, walk/run blend, hip sway + counter-rotating
// shoulders, idle breathing and weight shifts, airborne tuck, landing squash,
// head pitch, a smooth downed collapse / revive get-up, and a verlet scarf.
//
// Whole body = one SkinnedMesh per material (6 draw calls) sharing a cached geometry;
// only the accent materials (trim, visor) are per-avatar so they can be recoloured.
import * as THREE from 'three';
import { markShared } from '../render/dispose';
import {
  M, PartSet, lathe, roundedBox, roundedOutline, plate, capsule, cyl, torus, sphere,
  fabricNormalMap, sharedMat, paintMat, glowMat, withRim, damp, clamp01, smoothstep, lerp,
  modelQuality, cachedGeo,
} from './common';
import type { DeviceId } from '../../shared/devices';
import { DEVICES } from '../../shared/devices';

// ---------- skeleton layout ----------
const B = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  uaL: 5, faL: 6, hL: 7, uaR: 8, faR: 9, hR: 10,
  thL: 11, shL: 12, ftL: 13, thR: 14, shR: 15, ftR: 16,
} as const;
const BONE_DEF: [name: string, parent: number, x: number, y: number, z: number][] = [
  ['hips', -1, 0, 0.95, 0],
  ['spine', B.hips, 0, 0.1, 0],
  ['chest', B.spine, 0, 0.2, 0],
  ['neck', B.chest, 0, 0.24, 0],
  ['head', B.neck, 0, 0.09, 0],
  ['uaL', B.chest, -0.215, 0.17, 0.01],
  ['faL', B.uaL, 0, -0.28, 0],
  ['hL', B.faL, 0, -0.25, 0],
  ['uaR', B.chest, 0.215, 0.17, 0.01],
  ['faR', B.uaR, 0, -0.28, 0],
  ['hR', B.faR, 0, -0.25, 0],
  ['thL', B.hips, -0.1, -0.04, 0],
  ['shL', B.thL, 0, -0.42, 0],
  ['ftL', B.shL, 0, -0.42, 0],
  ['thR', B.hips, 0.1, -0.04, 0],
  ['shR', B.thR, 0, -0.42, 0],
  ['ftR', B.shR, 0, -0.42, 0],
];
const THIGH = 0.42, SHIN = 0.42, ANKLE_H = 0.07;
const HIP_REST_Y = 0.95 - 0.04;

function makeBones(): THREE.Bone[] {
  const bones = BONE_DEF.map(([name, , x, y, z]) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); return b; });
  BONE_DEF.forEach(([, parent], i) => { if (parent >= 0) bones[parent].add(bones[i]); });
  return bones;
}

// ---------- geometry (built once per tier, shared by every avatar) ----------
const KEYS = ['suit', 'armor', 'metal', 'rubber', 'trim', 'visor'] as const;
type Key = typeof KEYS[number];

/** outward-facing plate rotation: local +Z must point into the body */
const inward = (ux: number, uz: number) => Math.atan2(-ux, -uz);

function avatarParts(): PartSet {
  const P = new PartSet();
  const E = 0.72;   // torso depth squash

  // ---- hips ----
  P.add('suit', lathe([[0, -0.13], [0.1, -0.125], [0.15, -0.06], [0.16, 0.03], [0.148, 0.1], [0, 0.1]], 18), M(0, 0, 0, 0, 0, 0, 1, 1, E), B.hips);
  P.add('metal', torus(0.152, 0.022, 28), M(0, 0.055, 0, Math.PI / 2, 0, 0, 1, 1.0, 1), B.hips);
  P.add('metal', roundedBox(0.09, 0.06, 0.03, 0.01), M(0, 0.055, -0.118), B.hips);
  P.add('trim', roundedBox(0.05, 0.012, 0.01, 0.004), M(0, 0.055, -0.135), B.hips);
  const tasset = plate(roundedOutline([[-0.055, 0.06], [0.055, 0.06], [0.05, -0.07], [-0.045, -0.08]], 0.02), 0.014, 0.006, 5);
  for (const s of [-1, 1]) {
    const ux = s * 0.94, uz = -0.34;
    P.add('armor', tasset, M(ux * 0.16, -0.03, uz * 0.16 * E, 0.12 * s * 0, inward(ux, uz), -s * 0.08), B.hips);
  }
  P.add('armor', plate(roundedOutline([[-0.1, 0.05], [0.1, 0.05], [0.08, -0.06], [-0.08, -0.06]], 0.02), 0.014, 0.006, -3), M(0, 0.0, 0.12), B.hips);

  // ---- spine / abdomen ----
  P.add('suit', lathe([[0, -0.05], [0.135, -0.04], [0.138, 0.06], [0.15, 0.2], [0, 0.21]], 18), M(0, 0, 0, 0, 0, 0, 1, 1, E), B.spine);
  const ab = plate(roundedOutline([[-0.085, 0.032], [0.085, 0.032], [0.075, -0.032], [-0.075, -0.032]], 0.015), 0.016, 0.006, 3.4);
  P.add('armor', ab, M(0, 0.02, -0.103), B.spine);
  P.add('armor', ab, M(0, 0.1, -0.108, 0, 0, 0, 1.06, 1, 1), B.spine);

  // ---- chest ----
  P.add('suit', lathe([[0, -0.04], [0.15, -0.03], [0.18, 0.06], [0.2, 0.14], [0.17, 0.22], [0.08, 0.265], [0, 0.265]], 20), M(0, 0, 0, 0, 0, 0, 1, 1, 0.68), B.chest);
  const cuirass = plate(roundedOutline([[-0.17, 0.11], [0.17, 0.11], [0.15, -0.06], [0.055, -0.12], [-0.055, -0.12], [-0.15, -0.06]], 0.035), 0.03, 0.01, 3.0, 1.4);
  P.add('armor', cuirass, M(0, 0.1, -0.142), B.chest);
  P.add('metal', cyl(0.036, 0.036, 0.016, 6), M(0, 0.07, -0.168, Math.PI / 2, 0, 0), B.chest);
  P.add('trim', cyl(0.024, 0.024, 0.018, 6), M(0, 0.07, -0.172, Math.PI / 2, 0, 0), B.chest);
  for (const s of [-1, 1]) {
    P.add('trim', roundedBox(0.085, 0.009, 0.01, 0.004), M(s * 0.095, 0.17, -0.163, 0, 0, s * 0.28), B.chest);
    // harness straps over the shoulders
    P.add('rubber', roundedBox(0.035, 0.2, 0.012, 0.005), M(s * 0.1, 0.19, -0.1, -0.5, 0, 0), B.chest);
  }
  P.add('metal', torus(0.078, 0.024, 20), M(0, 0.245, 0.005, Math.PI / 2, 0, 0, 1, 1, 0.9), B.chest);
  P.add('armor', plate(roundedOutline([[-0.13, 0.1], [0.13, 0.1], [0.12, -0.1], [-0.12, -0.1]], 0.03), 0.02, 0.008, -2.5), M(0, 0.1, 0.135), B.chest);
  // backpack: core pack, twin canisters with glowing bands, vent, thrusters, antenna
  P.add('metal', roundedBox(0.22, 0.26, 0.1, 0.03), M(0, 0.1, 0.19), B.chest);
  for (const s of [-1, 1]) {
    P.add('armor', capsule(0.034, 0.16, 12), M(s * 0.078, 0.1, 0.262), B.chest);
    P.add('trim', torus(0.036, 0.006, 16), M(s * 0.078, 0.03, 0.262, Math.PI / 2, 0, 0), B.chest);
    P.add('trim', torus(0.036, 0.006, 16), M(s * 0.078, 0.17, 0.262, Math.PI / 2, 0, 0), B.chest);
    P.add('metal', cyl(0.026, 0.036, 0.045, 12), M(s * 0.06, -0.05, 0.2), B.chest);
  }
  P.add('trim', roundedBox(0.1, 0.018, 0.01, 0.004), M(0, 0.2, 0.243), B.chest);
  P.add('metal', cyl(0.005, 0.006, 0.2, 6), M(0.085, 0.32, 0.215), B.chest);
  P.add('trim', sphere(0.012, 8, 6), M(0.085, 0.425, 0.215), B.chest);

  // ---- neck ----
  P.add('rubber', cyl(0.055, 0.062, 0.12, 14), M(0, 0.03, 0), B.neck);

  // ---- head: egg-profile helmet, wrap visor, brow arc, ear modules, crest ----
  P.add('armor', lathe([[0, -0.045], [0.1, -0.035], [0.135, 0.04], [0.145, 0.11], [0.13, 0.19], [0.08, 0.24], [0, 0.255]], 22), M(0, 0, 0.005, 0, 0, 0, 1, 1, 1.1), B.head);
  const visor = new THREE.SphereGeometry(0.14, 28, 12, Math.PI * 1.5 - 1.15, 2.3, 1.02, 0.86);
  P.add('visor', visor, M(0, 0.1, 0.0, 0, 0, 0, 1.075, 1.0, 1.2), B.head);
  const brow = new THREE.TorusGeometry(0.157, 0.011, 6, 24, 2.4);
  brow.rotateZ(-Math.PI / 2 - 1.2); brow.rotateX(Math.PI / 2);
  P.add('metal', brow, M(0, 0.172, 0, 0, 0, 0, 1, 1, 1.12), B.head);
  const chin = new THREE.TorusGeometry(0.15, 0.013, 6, 20, 1.8);
  chin.rotateZ(-Math.PI / 2 - 0.9); chin.rotateX(Math.PI / 2);
  P.add('metal', chin, M(0, 0.028, 0.0, -0.18, 0, 0, 1, 1, 1.12), B.head);
  for (const s of [-1, 1]) {
    P.add('metal', cyl(0.046, 0.046, 0.034, 16), M(s * 0.143, 0.095, 0.02, 0, 0, Math.PI / 2), B.head);
    P.add('trim', torus(0.034, 0.006, 16), M(s * 0.161, 0.095, 0.02, 0, Math.PI / 2, 0), B.head);
  }
  const crest = plate(roundedOutline([[-0.12, 0], [0.1, 0], [0.08, 0.025], [-0.08, 0.045]], 0.01), 0.018, 0.005);
  P.add('armor', crest, M(0, 0.228, 0.01, 0, Math.PI / 2, 0), B.head);
  P.add('trim', roundedBox(0.008, 0.008, 0.12, 0.003), M(0, 0.262, 0.0), B.head);

  // ---- arms ----
  const upper = lathe([[0, 0.03], [0.06, 0.02], [0.063, -0.08], [0.055, -0.2], [0.05, -0.27], [0, -0.28]], 14);
  const pauldron = lathe([[0, 0.1], [0.065, 0.094], [0.1, 0.06], [0.113, 0.0], [0.108, -0.035], [0, -0.03]], 18);
  const fore = lathe([[0, 0.01], [0.05, 0], [0.052, -0.08], [0.042, -0.2], [0, -0.21]], 14);
  const gauntlet = lathe([[0, -0.035], [0.057, -0.04], [0.063, -0.1], [0.05, -0.205], [0, -0.21]], 16);
  const palm = roundedBox(0.032, 0.085, 0.072, 0.012);
  const fingers = roundedBox(0.028, 0.068, 0.068, 0.012);
  const thumb = capsule(0.013, 0.035, 8);
  for (const s of [-1, 1]) {
    const ua = s < 0 ? B.uaL : B.uaR, fa = s < 0 ? B.faL : B.faR, h = s < 0 ? B.hL : B.hR;
    P.add('suit', upper, M(), ua);
    P.add('rubber', sphere(0.058, 14, 10), M(), ua);
    const pm = M(s * 0.022, 0.03, 0, 0, 0, -s * 0.28, 1, 0.82, 1.05);
    P.add('armor', pauldron, pm, ua);
    const arc = new THREE.TorusGeometry(0.111, 0.0045, 4, 20, Math.PI * 1.1);
    arc.rotateZ(s > 0 ? -Math.PI * 0.55 : Math.PI - Math.PI * 0.55);
    P.add('trim', arc, pm.clone().multiply(M(0, 0.004, 0, Math.PI / 2, 0, 0)), ua);
    P.add('rubber', torus(0.057, 0.012, 16), M(0, -0.2, 0, Math.PI / 2, 0, 0), ua);
    P.add('suit', fore, M(), fa);
    P.add('rubber', sphere(0.053, 12, 10), M(), fa);
    P.add('armor', gauntlet, M(), fa);
    P.add('trim', torus(0.046, 0.0065, 16), M(0, -0.2, 0, Math.PI / 2, 0, 0), fa);
    if (s < 0) {   // wrist computer on the left gauntlet
      P.add('metal', roundedBox(0.022, 0.07, 0.05, 0.008), M(-0.058, -0.11, 0), fa);
      P.add('trim', roundedBox(0.004, 0.05, 0.034, 0.002), M(-0.07, -0.11, 0), fa);
    }
    P.add('rubber', palm, M(0, -0.048, 0), h);
    P.add('rubber', fingers, M(-s * 0.014, -0.105, 0, 0, 0, -s * 0.55), h);
    P.add('rubber', thumb, M(-s * 0.014, -0.05, -0.04, 0.55, 0, -s * 0.35), h);
    P.add('armor', roundedBox(0.012, 0.045, 0.06, 0.005), M(s * 0.018, -0.058, 0), h);
  }

  // ---- legs ----
  const thigh = lathe([[0, 0.04], [0.085, 0.03], [0.09, -0.08], [0.074, -0.3], [0.058, -0.41], [0, -0.42]], 16);
  const thighPlate = plate(roundedOutline([[-0.058, 0.13], [0.058, 0.13], [0.05, -0.13], [-0.048, -0.13]], 0.02), 0.016, 0.006, 6);
  const shin = lathe([[0, 0.02], [0.06, 0.01], [0.064, -0.1], [0.05, -0.3], [0.045, -0.4], [0, -0.41]], 16);
  const shinGuard = plate(roundedOutline([[-0.052, 0.14], [0.052, 0.14], [0.046, -0.14], [-0.046, -0.14]], 0.02), 0.016, 0.006, 7);
  const kneePad = lathe([[0, 0.05], [0.04, 0.045], [0.052, 0.0], [0.045, -0.04], [0, -0.05]], 14);
  const boot = plate(roundedOutline([[-0.065, -0.07], [0.17, -0.07], [0.185, -0.04], [0.12, -0.005], [0.055, 0.03], [0.05, 0.075], [-0.055, 0.075], [-0.075, 0.0]], 0.02), 0.085, 0.014);
  for (const s of [-1, 1]) {
    const th = s < 0 ? B.thL : B.thR, sh = s < 0 ? B.shL : B.shR, ft = s < 0 ? B.ftL : B.ftR;
    P.add('suit', thigh, M(), th);
    P.add('rubber', sphere(0.075, 14, 10), M(), th);
    P.add('armor', thighPlate, M(s * 0.012, -0.17, -0.078, 0, s * 0.18, 0), th);
    P.add('trim', roundedBox(0.006, 0.17, 0.007, 0.003), M(s * 0.06, -0.17, -0.07, 0, s * 0.18, 0), th);
    if (s > 0) P.add('metal', roundedBox(0.035, 0.12, 0.08, 0.012), M(0.09, -0.12, 0.0), th);   // holster
    P.add('suit', shin, M(), sh);
    P.add('rubber', sphere(0.05, 12, 10), M(), sh);
    P.add('armor', kneePad, M(0, 0.0, -0.045, 0, 0, 0, 1, 1, 0.7), sh);
    P.add('armor', shinGuard, M(0, -0.19, -0.058), sh);
    P.add('trim', roundedBox(0.012, 0.012, 0.01, 0.004), M(0, 0.0, -0.083), sh);
    P.add('metal', boot, M(0, 0.0, -0.0, 0, Math.PI / 2, 0), ft);
    P.add('rubber', roundedBox(0.11, 0.026, 0.25, 0.01), M(0, -0.058, -0.055), ft);
    P.add('armor', roundedBox(0.1, 0.045, 0.075, 0.02), M(0, -0.037, -0.14), ft);
    P.add('trim', roundedBox(0.1, 0.008, 0.008, 0.003), M(0, 0.03, -0.045), ft);
  }
  return P;
}

let geoByTier: Partial<Record<string, Record<Key, THREE.BufferGeometry>>> = {};
function avatarGeometry(): Record<Key, THREE.BufferGeometry> {
  const t = modelQuality();
  const hit = geoByTier[t];
  if (hit) return hit;
  const bones = makeBones();
  const root = new THREE.Group(); root.add(bones[0]); root.updateMatrixWorld(true);
  const rest = bones.map((b) => b.matrixWorld.clone());
  const parts = avatarParts();
  const out = {} as Record<Key, THREE.BufferGeometry>;
  for (const k of KEYS) out[k] = markShared(parts.build(k, rest));
  geoByTier[t] = out;
  return out;
}

// ---------- materials ----------
function sharedAvatarMats() {
  return {
    suit: sharedMat('av-suit', () => new THREE.MeshStandardMaterial({
      color: '#3b3950', roughness: 0.82, metalness: 0.05,
      normalMap: fabricNormalMap(), normalScale: new THREE.Vector2(0.55, 0.55),
    })),
    armor: sharedMat('av-armor', () => paintMat('#cdc8d8', 0.4, 0.06)),
    metal: sharedMat('av-metal', () => new THREE.MeshStandardMaterial({ color: '#56546b', roughness: 0.34, metalness: 0.82 })),
    rubber: sharedMat('av-rubber', () => new THREE.MeshStandardMaterial({ color: '#1d1c27', roughness: 0.88, metalness: 0.0 })),
  };
}
function visorMat(accent: string): THREE.MeshStandardMaterial {
  const base = modelQuality() === 'low'
    ? new THREE.MeshStandardMaterial({ color: '#0c0e1c', roughness: 0.08, metalness: 0.9, emissive: accent, emissiveIntensity: 0.25 })
    : new THREE.MeshPhysicalMaterial({
      color: '#0a0c18', roughness: 0.05, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.03,
      emissive: accent, emissiveIntensity: 0.22, envMapIntensity: 1.6,
    });
  return withRim(base, 3.0, 9);
}

// ---------- rig ----------
export interface AvatarRig {
  root: THREE.Group;
  bones: THREE.Bone[];
  meshes: THREE.SkinnedMesh[];
  /** accent emissives (trim, visor, scarf) — recoloured hostile while downed */
  recolor: THREE.MeshStandardMaterial[];
  scarf?: Scarf;
  held?: THREE.Group;
  setDevice(d: DeviceId | undefined): void;
}

export interface AvatarOptions {
  /** replace every material (echo hologram) */
  override?: THREE.Material;
  scarf?: boolean;
  castShadow?: boolean;
}

export function buildAvatar(accentHex: string, opts: AvatarOptions = {}): AvatarRig {
  const geo = avatarGeometry();
  const bones = makeBones();
  const root = new THREE.Group();
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const shared = sharedAvatarMats();
  const recolor: THREE.MeshStandardMaterial[] = [];
  let mats: Record<Key, THREE.Material>;
  if (opts.override) {
    const o = opts.override;
    mats = { suit: o, armor: o, metal: o, rubber: o, trim: o, visor: o };
  } else {
    const trim = glowMat(accentHex, 2.2), visor = visorMat(accentHex);
    recolor.push(trim, visor);
    mats = { ...shared, trim, visor };
  }
  const meshes: THREE.SkinnedMesh[] = [];
  const bounds = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.5);
  for (const k of KEYS) {
    const m = new THREE.SkinnedMesh(geo[k], mats[k]);
    m.bind(skeleton, new THREE.Matrix4());
    m.castShadow = (opts.castShadow ?? !opts.override) && k !== 'trim' && k !== 'visor';
    m.boundingSphere = bounds.clone();
    m.name = 'av-' + k;
    root.add(m);
    meshes.push(m);
  }
  const rig: AvatarRig = { root, bones, meshes, recolor, setDevice: () => {} };
  if (opts.scarf !== false && !opts.override) {
    rig.scarf = new Scarf(accentHex);
    recolor.push(rig.scarf.material);
    root.add(rig.scarf.mesh);
  }
  if (!opts.override) {
    const held = new THREE.Group();
    held.position.set(-0.012, -0.1, -0.005);
    bones[B.hR].add(held);
    rig.held = held;
    let cur: DeviceId | undefined;
    rig.setDevice = (d) => {
      if (d === cur) return;
      cur = d;
      held.clear();
      if (d) held.add(...heldDevice(d));
    };
  }
  return rig;
}

// small third-person device carried in the right fist (long axis along hand -Y)
function heldDevice(d: DeviceId): THREE.Mesh[] {
  const body = cachedGeo('held-body', () => {
    const P = new PartSet();
    P.add('a', roundedBox(0.05, 0.2, 0.06, 0.015), M(0, -0.06, -0.01));
    P.add('a', cyl(0.028, 0.034, 0.05, 12), M(0, -0.18, -0.01));
    P.add('a', roundedBox(0.03, 0.08, 0.03, 0.01), M(0, 0.02, 0.03, 0.4, 0, 0));
    return P.build('a');
  });
  const glow = cachedGeo('held-glow', () => {
    const P = new PartSet();
    P.add('a', torus(0.03, 0.006, 16), M(0, -0.2, -0.01, Math.PI / 2, 0, 0));
    P.add('a', roundedBox(0.052, 0.07, 0.01, 0.004), M(0, -0.06, -0.042));
    return P.build('a');
  });
  const metal = sharedMat('av-metal', () => new THREE.MeshStandardMaterial({ color: '#56546b', roughness: 0.34, metalness: 0.82 }));
  const g = sharedMat('held-glow-' + d, () => glowMat(DEVICES[d].color, 2.4));
  const a = new THREE.Mesh(body, metal), b = new THREE.Mesh(glow, g);
  a.castShadow = true;
  return [a, b];
}

// ---------- verlet scarf ----------
const SCARF_N = 9, SCARF_SEG = 0.095, SCARF_W = 0.05;
const _st = new THREE.Vector3(), _sl = new THREE.Vector3();
export class Scarf {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  private pts: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private acc = 0;
  private init = false;
  private geo: THREE.BufferGeometry;
  private side = new THREE.Vector3(1, 0, 0);
  private time = Math.random() * 10;
  constructor(accent: string) {
    for (let i = 0; i < SCARF_N; i++) { this.pts.push(new THREE.Vector3()); this.prev.push(new THREE.Vector3()); }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SCARF_N * 2 * 3), 3));
    const uv = new Float32Array(SCARF_N * 2 * 2);
    for (let i = 0; i < SCARF_N; i++) { uv[i * 4] = 0; uv[i * 4 + 1] = i / (SCARF_N - 1); uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i / (SCARF_N - 1); }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let i = 0; i < SCARF_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    const c = new THREE.Color(accent).multiplyScalar(0.55);
    this.material = new THREE.MeshStandardMaterial({
      color: c, roughness: 0.75, metalness: 0, side: THREE.DoubleSide,
      emissive: accent, emissiveIntensity: 0.18, normalMap: fabricNormalMap(), normalScale: new THREE.Vector2(0.4, 0.4),
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }
  /** anchor/side/back are world-space; body = the mesh parent's world matrix (+Z = behind) */
  step(dt: number, anchor: THREE.Vector3, side: THREE.Vector3, back: THREE.Vector3, body: THREE.Matrix4, bodyInv: THREE.Matrix4) {
    const toLocal = bodyInv;
    this.time += dt;
    if (!this.init) {
      for (let i = 0; i < SCARF_N; i++) { this.pts[i].copy(anchor).addScaledVector(back, i * 0.02).y -= i * SCARF_SEG; this.prev[i].copy(this.pts[i]); }
      this.init = true;
    }
    this.side.lerp(side, 0.5).normalize();
    this.acc = Math.min(this.acc + dt, 4 / 60);
    const h = 1 / 60;
    const tmp = _st, local = _sl;
    while (this.acc >= h) {
      this.acc -= h;
      const wind = Math.sin(this.time * 2.3) * 0.6 + Math.sin(this.time * 5.1) * 0.3;
      for (let i = 1; i < SCARF_N; i++) {
        const p = this.pts[i], q = this.prev[i];
        tmp.copy(p).sub(q).multiplyScalar(0.94);            // damping
        q.copy(p);
        p.add(tmp);
        p.y -= 7.5 * h * h;                                  // gravity (a little floaty)
        p.addScaledVector(this.side, wind * 0.35 * h * h * i / SCARF_N);
        p.addScaledVector(back, 1.2 * h * h);                 // slight drift behind
      }
      this.pts[0].copy(anchor); this.prev[0].copy(anchor);
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < SCARF_N - 1; i++) {
          const a = this.pts[i], b = this.pts[i + 1];
          tmp.copy(b).sub(a);
          const d = tmp.length() || 1e-6;
          const diff = (d - SCARF_SEG) / d;
          if (i === 0) b.addScaledVector(tmp, -diff);
          else { a.addScaledVector(tmp, diff * 0.5); b.addScaledVector(tmp, -diff * 0.5); }
        }
        // keep the cloth behind the back (body space: +Z is behind) and above the ground
        for (let i = 1; i < SCARF_N; i++) {
          local.copy(this.pts[i]).applyMatrix4(bodyInv);
          const zMin = Math.abs(local.x) < 0.13 && local.y > 0.95 && local.y < 1.6 ? 0.3 : 0.17;
          if (local.y > 0.35 && local.y < 1.75 && Math.abs(local.x) < 0.3 && local.z < zMin) {
            local.z = zMin;
            this.pts[i].copy(local).applyMatrix4(body);
          }
          if (local.y < 0.02) { local.y = 0.02; this.pts[i].copy(local).applyMatrix4(body); }
        }
      }
    }
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < SCARF_N; i++) {
      const w = SCARF_W * (1 - i / SCARF_N * 0.45);
      tmp.copy(this.pts[i]).addScaledVector(this.side, -w).applyMatrix4(toLocal);
      pos.setXYZ(i * 2, tmp.x, tmp.y, tmp.z);
      tmp.copy(this.pts[i]).addScaledVector(this.side, w).applyMatrix4(toLocal);
      pos.setXYZ(i * 2 + 1, tmp.x, tmp.y, tmp.z);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
  reset() { this.init = false; }
}

// ---------- procedural animation ----------
export interface LocoInput {
  vel: THREE.Vector3;     // world-space velocity (m/s)
  grounded: boolean;
  pitch: number;          // look pitch (rad, + = up)
  downed: boolean;
  carrying?: boolean;
  holding?: boolean;      // a device is in the right hand
}

interface Pose {
  px: number; py: number; pz: number; prx: number; pry: number; prz: number;   // pelvis
  srx: number; sry: number; srz: number;                                       // spine
  crx: number; cry: number; crz: number;                                       // chest
  hrx: number; hry: number; hrz: number;                                       // head
  fL: THREE.Vector3; fR: THREE.Vector3; pitchL: number; pitchR: number; poleUp: number;
  uaLx: number; uaLz: number; uaLy: number; faL: number;
  uaRx: number; uaRz: number; uaRy: number; faR: number;
}
function newPose(): Pose {
  return {
    px: 0, py: 0.93, pz: 0, prx: 0, pry: 0, prz: 0, srx: 0, sry: 0, srz: 0, crx: 0, cry: 0, crz: 0,
    hrx: 0, hry: 0, hrz: 0, fL: new THREE.Vector3(-0.11, ANKLE_H, 0), fR: new THREE.Vector3(0.11, ANKLE_H, 0),
    pitchL: 0, pitchR: 0, poleUp: 0,
    uaLx: 0, uaLz: -0.12, uaLy: 0, faL: 0.2, uaRx: 0, uaRz: 0.12, uaRy: 0, faR: 0.2,
  };
}
function blendPose(a: Pose, b: Pose, t: number, out: Pose) {
  for (const k of Object.keys(a) as (keyof Pose)[]) {
    const av = a[k], bv = b[k];
    if (typeof av === 'number') (out as unknown as Record<string, number>)[k] = lerp(av, bv as number, t);
    else (out[k] as THREE.Vector3).copy(av).lerp(bv as THREE.Vector3, t);
  }
}

const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _hip = new THREE.Vector3(), _dir = new THREE.Vector3(), _pole = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _basis = new THREE.Matrix4();
const _lv = new THREE.Vector3(), _qc = new THREE.Quaternion();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();

export class AvatarAnimator {
  private phase = Math.random();
  private speed = 0;
  private lvel = new THREE.Vector2(0, -1);    // smoothed planar local move direction
  private air = 0;
  private airTime = 0;
  private lastVy = 0;
  private squash = 0; private squashV = 0;
  private down = 0;                               // linear 0..1 progress
  private wasDowned = false;
  private breath = Math.random() * 10;
  private shift = 0; private shiftTarget = 0; private shiftTimer = 3 + Math.random() * 4;
  private look = 0; private lookTarget = 0; private lookTimer = 2;
  private pitch = 0;
  private hold = 0; private carry = 0;
  private lean = 0;
  private prevYaw = 0; private yawRate = 0;
  private loco = newPose(); private downedPose = newPose(); private pose = newPose();
  private anchor = new THREE.Vector3(); private sideW = new THREE.Vector3(); private backW = new THREE.Vector3();

  constructor(private rig: AvatarRig) {}

  /** `yaw` is the rig's facing (root/group rotation.y). */
  update(dt: number, yaw: number, inp: LocoInput) {
    dt = Math.min(dt, 0.1);
    const b = this.rig.bones;
    // planar velocity in rig space (front = -Z)
    _lv.copy(inp.vel).setY(0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
    const spd = _lv.length();
    this.speed += (spd - this.speed) * damp(8, dt);
    if (spd > 0.3) {
      const k = damp(10, dt);
      this.lvel.x += (_lv.x / spd - this.lvel.x) * k; this.lvel.y += (_lv.z / spd - this.lvel.y) * k;
      this.lvel.normalize();
    }
    let dy = yaw - this.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.prevYaw = yaw;
    this.yawRate += (dy / Math.max(dt, 1e-3) - this.yawRate) * damp(6, dt);

    // air / landing
    const airborne = !inp.grounded && !inp.downed;
    if (airborne) { this.airTime += dt; this.lastVy = inp.vel.y; }
    else if (this.airTime > 0) {
      if (this.airTime > 0.18) this.squashV -= Math.min(2.2, 0.5 + Math.abs(this.lastVy) * 0.18);
      this.airTime = 0;
    }
    this.air += ((airborne && this.airTime > 0.06 ? 1 : 0) - this.air) * damp(12, dt);
    // squash spring (slightly underdamped)
    const k = 170, c = 2 * Math.sqrt(k) * 0.55;
    const sub = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < sub; i++) {
      const h = dt / sub;
      this.squashV += (-k * this.squash - c * this.squashV) * h;
      this.squash += this.squashV * h;
    }

    // downed progress: collapse ~0.8 s, get-up ~1.2 s
    if (inp.downed !== this.wasDowned) this.wasDowned = inp.downed;
    this.down = clamp01(this.down + (inp.downed ? dt / 0.8 : -dt / 1.2));
    const downE = inp.downed ? 1 - Math.pow(1 - this.down, 3) : this.down * this.down * (3 - 2 * this.down);

    this.pitch += (THREE.MathUtils.clamp(inp.pitch, -1.2, 1.2) - this.pitch) * damp(10, dt);
    this.hold += ((inp.holding && !inp.carrying ? 1 : 0) - this.hold) * damp(6, dt);
    this.carry += ((inp.carrying ? 1 : 0) - this.carry) * damp(6, dt);

    // idle life: breathing, weight shift, glances
    this.breath += dt;
    this.shiftTimer -= dt;
    if (this.shiftTimer <= 0) { this.shiftTimer = 4 + Math.random() * 5; this.shiftTarget = [-1, 0, 1][Math.floor(Math.random() * 3)]; }
    this.shift += (this.shiftTarget - this.shift) * damp(2.2, dt);
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) { this.lookTimer = 2.5 + Math.random() * 4; this.lookTarget = (Math.random() - 0.5) * 0.9; }
    this.look += (this.lookTarget - this.look) * damp(3, dt);

    const moveW = smoothstep(0.25, 1.2, this.speed) * (1 - downE);
    const runW = smoothstep(2.6, 5.4, this.speed);
    const cycle = THREE.MathUtils.clamp(0.95 + this.speed * 0.27, 0.95, 2.55);
    if (this.speed > 0.05) this.phase = (this.phase + dt * this.speed / cycle) % 1;
    const duty = lerp(0.6, 0.34, runW);
    const range = duty * cycle;
    const idleW = 1 - moveW;

    // ---- locomotion + idle pose ----
    const L = this.loco;
    const ph = this.phase * Math.PI * 2;
    const breath = Math.sin(this.breath * 1.7);
    const sway = Math.sin(ph);
    L.px = moveW * sway * lerp(0.025, 0.012, runW) + idleW * this.shift * 0.035;
    L.py = 0.935 - moveW * lerp(0.03, 0.07, runW)
      - moveW * (Math.cos(ph * 2) * 0.5 + 0.5) * lerp(0.022, 0.05, runW)
      + idleW * (breath * 0.004 - Math.abs(this.shift) * 0.012) + this.squash * 0.18;
    L.pz = moveW * runW * 0.04;
    this.lean += ((-this.yawRate * 0.05 * moveW) - this.lean) * damp(5, dt);
    L.prx = moveW * lerp(0.02, 0.1, runW) * -1;
    L.pry = moveW * sway * lerp(0.16, 0.1, runW);
    L.prz = moveW * sway * 0.05 - idleW * this.shift * 0.05 + this.lean;
    L.srx = -moveW * lerp(0.03, 0.18, runW) + idleW * breath * 0.012 - this.squash * 0.4;
    L.sry = -L.pry * 0.8;
    L.srz = -L.prz * 0.6;
    L.crx = idleW * breath * 0.015 - moveW * 0.02;
    L.cry = -L.pry * 0.9;
    L.crz = -L.prz * 0.4 + idleW * this.shift * 0.02;
    L.hrx = this.pitch * 0.65 - L.srx * 0.7 - L.prx;
    L.hry = idleW * this.look * (1 - this.hold * 0.6) - L.cry - L.sry * 0.5;
    L.hrz = -L.crz * 0.5;
    L.poleUp = 0;

    // feet: stance → plant & slide back at body speed; swing → arc forward
    const lat = lerp(0.105, 0.085, runW);
    for (const side of [-1, 1]) {
      const p = (this.phase + (side < 0 ? 0 : 0.5)) % 1;
      let fwd: number, up: number, pitch: number;
      if (p < duty) {
        const s = p / duty;
        fwd = lerp(range / 2, -range / 2, s);
        up = smoothstep(0.65, 1, s) * lerp(0.05, 0.1, runW);
        pitch = lerp(-0.15, 0, smoothstep(0, 0.2, s)) + smoothstep(0.6, 1, s) * 0.55;
      } else {
        const s = (p - duty) / (1 - duty);
        const e = s * s * (3 - 2 * s);
        fwd = lerp(-range / 2, range / 2, e);
        up = Math.sin(Math.PI * Math.min(1, s * 1.1)) * lerp(0.1, 0.3, runW) + (1 - s) * lerp(0.03, 0.12, runW);
        pitch = lerp(0.6, -0.25, smoothstep(0, 0.8, s));
      }
      fwd -= runW * 0.06;
      const f = side < 0 ? L.fL : L.fR;
      // idle stance with weight shift: the unloaded foot eases forward / heel lifts
      const unload = Math.max(0, this.shift * side * -1);
      const ix = side * (0.12 + Math.max(0, this.shift * side) * 0.02), iz = -unload * 0.07, iy = ANKLE_H + unload * 0.02;
      f.set(
        lerp(ix, side * lat + this.lvel.x * fwd, moveW) + L.px * 0.2,
        lerp(iy, ANKLE_H + up, moveW),
        lerp(iz, this.lvel.y * fwd, moveW));
      const fp = lerp(unload * 0.25, pitch, moveW);
      if (side < 0) L.pitchL = fp; else L.pitchR = fp;
    }
    // arms: counter-swing, elbows bend more when running
    const swing = moveW * lerp(0.32, 0.85, runW);
    L.uaLx = Math.sin(ph) * swing * -1 + idleW * breath * 0.02;
    L.uaRx = Math.sin(ph) * swing;
    L.uaLz = -(0.1 + runW * 0.1 + idleW * breath * 0.015);
    L.uaRz = 0.1 + runW * 0.1 + idleW * breath * 0.015;
    L.uaLy = L.uaRy = 0;
    L.faL = 0.18 + moveW * lerp(0.2, 1.35, runW) + Math.max(0, -Math.sin(ph)) * swing * 0.3;
    L.faR = 0.18 + moveW * lerp(0.2, 1.35, runW) + Math.max(0, Math.sin(ph)) * swing * 0.3;
    // device ready pose on the right arm (follows look pitch)
    if (this.hold > 0.001) {
      const h = this.hold * (1 - runW * 0.5);
      L.uaRx = lerp(L.uaRx, 0.55 + this.pitch * 0.55, h);
      L.faR = lerp(L.faR, 1.05, h);
      L.uaRz = lerp(L.uaRz, 0.2, h);
      L.uaRy = lerp(0, -0.25, h);
    }
    if (this.carry > 0.001) {
      const c = this.carry;
      L.uaLx = lerp(L.uaLx, 1.05, c); L.uaRx = lerp(L.uaRx, 1.05, c);
      L.faL = lerp(L.faL, 0.55, c); L.faR = lerp(L.faR, 0.55, c);
      L.uaLz = lerp(L.uaLz, -0.28, c); L.uaRz = lerp(L.uaRz, 0.28, c);
      L.uaLy = lerp(L.uaLy, 0.35, c); L.uaRy = lerp(L.uaRy, -0.35, c);
    }
    // airborne: tuck on the rise, reach down on the fall, arms out for balance
    if (this.air > 0.001) {
      const a = this.air;
      const rising = smoothstep(-2, 3, this.lastVy);
      L.fL.lerp(_tmp.set(-0.11, lerp(0.2, 0.42, rising), lerp(0.02, -0.18, rising)), a);
      L.fR.lerp(_tmp.set(0.11, lerp(0.12, 0.24, rising), lerp(-0.1, 0.12, rising)), a);
      L.pitchL = lerp(L.pitchL, 0.3, a); L.pitchR = lerp(L.pitchR, 0.45, a);
      L.uaLz = lerp(L.uaLz, -0.75, a); L.uaRz = lerp(L.uaRz, this.hold > 0.5 ? L.uaRz : 0.75, a);
      L.uaLx = lerp(L.uaLx, 0.35, a);
      L.faL = lerp(L.faL, 0.6, a);
      L.srx = lerp(L.srx, -0.08 * rising + 0.06, a);
      L.py = lerp(L.py, 0.95, a);
    }

    // ---- downed pose: slumped sitting, braced on the left arm, hand to chest ----
    if (downE > 0.001) {
      const D = this.downedPose;
      const t = this.breath;
      D.px = -0.05; D.py = 0.2; D.pz = 0.12;
      D.prx = 0.35; D.pry = 0.15; D.prz = 0.05;
      D.srx = 0.12 + Math.sin(t * 2.4) * 0.03; D.sry = 0.05; D.srz = 0.12;
      D.crx = 0.05; D.cry = 0.1; D.crz = 0.05;
      D.hrx = -0.55; D.hry = 0.25; D.hrz = 0.2;
      D.fL.set(-0.17, ANKLE_H, -0.62);
      D.fR.set(0.16, ANKLE_H, -0.35);
      D.pitchL = -0.4; D.pitchR = -0.1; D.poleUp = 1;
      D.uaLx = -0.55; D.uaLz = -0.5; D.uaLy = 0; D.faL = 0.1;
      D.uaRx = 0.55; D.uaRz = -0.05; D.uaRy = 0; D.faR = 1.9;
      blendPose(L, D, downE, this.pose);
    } else blendPose(L, L, 0, this.pose);

    this.apply(this.pose);
    this.rig.root.updateMatrixWorld(true);

    // scarf follows the chest
    const scarf = this.rig.scarf;
    if (scarf) {
      const chest = b[B.chest];
      this.anchor.set(-0.085, 0.245, 0.1).applyMatrix4(chest.matrixWorld);
      this.sideW.set(1, 0, 0).transformDirection(chest.matrixWorld);
      this.backW.set(0, 0, 1).transformDirection(this.rig.root.matrixWorld);
      _mi.copy(this.rig.root.matrixWorld).invert();
      scarf.step(dt, this.anchor, this.sideW, this.backW, this.rig.root.matrixWorld, _mi);
    }
  }

  private apply(p: Pose) {
    const b = this.rig.bones;
    b[B.hips].position.set(p.px, p.py, p.pz);
    b[B.hips].rotation.set(p.prx, p.pry, p.prz, 'YXZ');
    b[B.spine].rotation.set(p.srx, p.sry, p.srz);
    b[B.chest].rotation.set(p.crx, p.cry, p.crz);
    b[B.neck].rotation.set(p.hrx * 0.35, p.hry * 0.4, p.hrz * 0.4);
    b[B.head].rotation.set(p.hrx * 0.65, p.hry * 0.6, p.hrz * 0.6);
    b[B.uaL].rotation.set(p.uaLx, p.uaLy, p.uaLz, 'XZY');
    b[B.faL].rotation.set(p.faL, 0, 0);
    b[B.hL].rotation.set(-0.1, 0, 0);
    b[B.uaR].rotation.set(p.uaRx, p.uaRy, p.uaRz, 'XZY');
    b[B.faR].rotation.set(p.faR, 0, 0);
    b[B.hR].rotation.set(-0.1 - this.hold * 0.3, 0, 0);
    b[B.hips].updateMatrix();
    this.leg(b[B.thL], b[B.shL], b[B.ftL], p.fL, p.pitchL, p.poleUp);
    this.leg(b[B.thR], b[B.shR], b[B.ftR], p.fR, p.pitchR, p.poleUp);
  }

  /** two-bone IK in rig space: hips bone matrix maps pelvis-local → rig space */
  private leg(thigh: THREE.Bone, shin: THREE.Bone, foot: THREE.Bone, target: THREE.Vector3, footPitch: number, poleUp: number) {
    const hips = this.rig.bones[B.hips];
    _m.copy(hips.matrix);
    _hip.copy(thigh.position).applyMatrix4(_m);
    _dir.copy(target).sub(_hip);
    let d = _dir.length();
    _dir.divideScalar(d || 1);
    d = THREE.MathUtils.clamp(d, 0.1, (THIGH + SHIN) * 0.9995);
    const cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
    const a = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
    // knee pole: forward, or up+forward when sitting
    _pole.set(0, poleUp * 0.9, -1).normalize();
    _pole.addScaledVector(_dir, -_pole.dot(_dir));
    if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, -1);
    _pole.normalize();
    // thigh direction (rig space)
    const thighDir = _tmp.copy(_dir).multiplyScalar(Math.cos(a)).addScaledVector(_pole, Math.sin(a)).normalize();
    basisQuat(thighDir, _pole, _qa);                                 // thigh rig-space orientation
    // shin direction: from knee to target
    const knee = _x.copy(_hip).addScaledVector(thighDir, THIGH);
    const shinDir = _y.copy(_hip).addScaledVector(_dir, d).sub(knee).normalize();
    const qShin = basisQuat(shinDir, _pole, _qb);
    // local rotations
    _qc.setFromRotationMatrix(_m).invert();
    thigh.quaternion.copy(_qc).multiply(_qa);
    shin.quaternion.copy(_qa).invert().multiply(qShin);
    // foot: flat in rig space with pitch (heel-up positive)
    _qc.setFromAxisAngle(_z.set(1, 0, 0), footPitch);
    foot.quaternion.copy(qShin).invert().multiply(_qc);
  }
}

/** orientation whose -Y runs along `down` and whose -Z leans toward `pole` */
function basisQuat(down: THREE.Vector3, pole: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const y = _by.copy(down).negate();
  const z = _bz.copy(pole).addScaledVector(down, -pole.dot(down)).normalize().negate();
  const x = _bx.crossVectors(y, z);
  _basis.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_basis);
}

export const HIP_HEIGHT = HIP_REST_Y;
