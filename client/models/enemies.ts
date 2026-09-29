// Enemy models + animation. Every archetype is one skinned rig (rigid parts bound
// to bones → a handful of draw calls per enemy, geometry cached & shared across
// instances) with its own silhouette in the game's sci-fi dream language: obsidian
// clearcoat carapace, dark inner mechanics, ember (#e0654a) cores. Each reacts to
// the snapshot state: idle life, chase lean, telegraph wind-up, strike, hit flash,
// stagger, frost shell while frozen, and a shader noise-dissolve with a burning
// edge on death (icy edge when shattered).
import { crateModel, compact as compactModel } from '../render/interactables';
import * as THREE from 'three';
import { markShared } from '../render/dispose';
import { PALETTE } from '../../shared/palette';
import {
  M, PartSet, lathe, roundedBox, roundedOutline, plate, capsule, cyl, torus, sphere,
  sharedMat, paintMat, glowMat, withFx, withRim, makeFx, frostMat, damp, smoothstep, lerp, clamp01,
  modelQuality, type FxUniforms,
} from './common';

export const HOSTILE = new THREE.Color(PALETTE.hostile);
export const ICE = new THREE.Color('#bfe8ff');

export interface EnemyAnim {
  state: string;           // snapshot FSM state (idle|chase|telegraph|cooldown|frozen|staggered|down)
  speed: number;           // planar speed (m/s)
  telegraph?: number;      // wind-up progress 0..1 while telegraphing
  disguised?: boolean;     // mimic still pretending to be a crate
  exposed?: boolean;       // colossus core laid open (tractored)
}

type BoneDef = [name: string, parent: string | null, x: number, y: number, z: number, ry?: number];
interface Spec {
  bones: BoneDef[];
  build(P: PartSet, bi: (n: string) => number): void;
  height: number;
  bounds: [number, number, number, number];
}

const TAU = Math.PI * 2;
/** rest yaw so a bone's local -Z points outward along azimuth a (x=cos a, z=sin a) */
const outward = (a: number) => Math.atan2(-Math.cos(a), -Math.sin(a));
/** plate rotation so its local +Z points into the body from outward dir (ux,uz) */
const inward = (ux: number, uz: number) => Math.atan2(-ux, -uz);

// ======================= specs =======================
const DRIFTER: Spec = {
  height: 1.6, bounds: [0, 1.0, 0, 1.2],
  bones: [
    ['root', null, 0, 0, 0],
    ['body', 'root', 0, 1.15, 0],
    ['ring', 'body', 0, 0, 0],
    ['head', 'body', 0, 0.34, 0.03],
    ...[0, 1, 2, 3].map((i): BoneDef => { const a = Math.PI / 4 + i * Math.PI / 2; return [`p${i}`, 'body', Math.cos(a) * 0.14, 0.26, Math.sin(a) * 0.14, outward(a)]; }),
    ...[0, 1, 2].flatMap((i): BoneDef[] => {
      const a = Math.PI / 2 + (i - 1) * 1.1;
      return [[`t${i}0`, 'body', Math.cos(a) * 0.08, -0.2, Math.sin(a) * 0.08], [`t${i}1`, `t${i}0`, 0, -0.17, 0], [`t${i}2`, `t${i}1`, 0, -0.16, 0], [`t${i}3`, `t${i}2`, 0, -0.15, 0]];
    }),
  ],
  build(P, bi) {
    const body = bi('body');
    P.add('core', new THREE.IcosahedronGeometry(0.15, 1), M(), body);
    P.add('inner', capsule(0.035, 0.34, 8), M(0, 0.02, 0.1), body);
    P.add('shell', new THREE.ConeGeometry(0.085, 0.2, 12), M(0, -0.22, 0, Math.PI, 0, 0), body);
    P.add('inner', torus(0.06, 0.018, 14), M(0, -0.13, 0, Math.PI / 2, 0, 0), body);
    const ring = bi('ring');
    P.add('inner', torus(0.3, 0.016, 40), M(0, 0, 0, Math.PI / 2 + 0.35, 0, 0), ring);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU;
      P.add('glow', new THREE.OctahedronGeometry(0.035), M(Math.cos(a) * 0.3, Math.sin(a) * 0.3 * Math.sin(0.35), Math.sin(a) * 0.3 * Math.cos(0.35)), ring);
    }
    const head = bi('head');
    P.add('shell', lathe([[0, -0.1], [0.1, -0.09], [0.14, 0.0], [0.13, 0.1], [0.08, 0.17], [0, 0.2]], 16), M(0, 0, 0.02, 0, 0, 0, 1.2, 1.15, 1.35), head);
    P.add('inner', roundedBox(0.2, 0.14, 0.06, 0.025), M(0, -0.01, -0.16, 0.15, 0, 0), head);
    P.add('glow', roundedBox(0.17, 0.022, 0.02, 0.009), M(0, 0.015, -0.195), head);
    for (const s of [-1, 1]) {
      P.add('shell', new THREE.ConeGeometry(0.032, 0.42, 8), M(s * 0.1, 0.19, 0.1, 1.0, 0, -s * 0.4), head);
      P.add('glow', sphere(0.014, 6, 4), M(s * 0.06, -0.035, -0.19), head);
    }
    const leaf = plate(roundedOutline([[0, 0.03], [0.15, -0.08], [0.16, -0.3], [0.07, -0.5], [0, -0.57], [-0.07, -0.5], [-0.16, -0.3], [-0.15, -0.08]], 0.025), 0.03, 0.01, 2.2, 0.75);
    for (let i = 0; i < 4; i++) {
      const p = bi(`p${i}`);
      P.add('shell', leaf, M(0, 0, -0.14), p);
      P.add('glow', roundedBox(0.014, 0.34, 0.014, 0.006), M(0, -0.25, -0.13, -0.3, 0, 0), p);
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const r = 0.055 - j * 0.011;
      const bn = bi(`t${i}${j}`);
      P.add('shell', new THREE.ConeGeometry(r, 0.19, 10), M(0, -0.085, 0, Math.PI, 0, 0), bn);
      P.add('inner', sphere(r * 0.85, 8, 6), M(), bn);
      if (j === 3) P.add('glow', new THREE.ConeGeometry(0.014, 0.08, 6), M(0, -0.2, 0, Math.PI, 0, 0), bn);
    }
  },
};

const WARDEN: Spec = {
  height: 2.2, bounds: [0, 1.1, 0, 1.5],
  bones: [
    ['root', null, 0, 0, 0],
    ['base', 'root', 0, 0.5, 0],
    ['torso', 'base', 0, 0.42, 0],
    ['head', 'torso', 0, 0.8, -0.02],
    ['uaL', 'torso', -0.52, 0.6, 0], ['faL', 'uaL', 0, -0.42, 0],
    ['uaR', 'torso', 0.52, 0.6, 0], ['faR', 'uaR', 0, -0.42, 0],
  ],
  build(P, bi) {
    const base = bi('base');
    P.add('shell', lathe([[0, -0.32], [0.2, -0.3], [0.34, -0.14], [0.36, 0.04], [0.28, 0.16], [0, 0.18]], 20), M(), base);
    P.add('glow', torus(0.2, 0.035, 28), M(0, -0.3, 0, Math.PI / 2, 0, 0), base);
    P.add('core', cyl(0.12, 0.08, 0.05, 16), M(0, -0.33, 0), base);
    const skirt = plate(roundedOutline([[-0.12, 0.14], [0.12, 0.14], [0.09, -0.2], [0, -0.26], [-0.09, -0.2]], 0.02), 0.03, 0.01, 2.5);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + 0.2;
      const ux = Math.cos(a), uz = Math.sin(a);
      P.add('shell', skirt, M(ux * 0.37, -0.08, uz * 0.37, -0.25, inward(ux, uz), 0), base);
    }
    const torso = bi('torso');
    P.add('inner', cyl(0.22, 0.26, 0.34, 16), M(0, -0.02, 0), torso);
    P.add('shell', lathe([[0, 0.05], [0.28, 0.08], [0.4, 0.3], [0.45, 0.56], [0.36, 0.74], [0, 0.78]], 22), M(0, 0, 0.02, 0, 0, 0, 1, 1, 0.72), torso);
    const breast = plate(roundedOutline([[-0.3, 0.2], [0.3, 0.2], [0.26, -0.08], [0.0, -0.3], [-0.26, -0.08]], 0.05), 0.05, 0.015, 1.6, 0.6);
    P.add('shell', breast, M(0, 0.45, -0.31), torso);
    P.add('core', new THREE.OctahedronGeometry(0.075), M(0, 0.42, -0.36, 0, 0, 0, 0.8, 1.5, 0.5), torso);
    P.add('glow', roundedBox(0.02, 0.26, 0.02, 0.008), M(-0.16, 0.44, -0.345, 0, 0, 0.5), torso);
    P.add('glow', roundedBox(0.02, 0.26, 0.02, 0.008), M(0.16, 0.44, -0.345, 0, 0, -0.5), torso);
    P.add('shell', plate(roundedOutline([[-0.28, 0.25], [0.28, 0.25], [0.24, -0.25], [-0.24, -0.25]], 0.05), 0.04, 0.012, -1.4), M(0, 0.46, 0.33), torso);
    for (const s of [-1, 1]) P.add('glow', roundedBox(0.03, 0.34, 0.02, 0.01), M(s * 0.1, 0.48, 0.365), torso);
    const head = bi('head');
    P.add('inner', cyl(0.1, 0.13, 0.14, 12), M(0, -0.04, 0), head);
    P.add('shell', lathe([[0, -0.04], [0.14, -0.02], [0.17, 0.12], [0.15, 0.26], [0.08, 0.34], [0, 0.36]], 18), M(0, 0, 0, 0, 0, 0, 1, 1, 1.15), head);
    P.add('shell', plate(roundedOutline([[-0.2, 0], [0.16, 0], [0.12, 0.1], [-0.02, 0.2], [-0.2, 0.12]], 0.02), 0.03, 0.01), M(0, 0.3, 0.02, 0, Math.PI / 2, 0), head);
    P.add('glow', roundedBox(0.2, 0.028, 0.02, 0.01), M(0, 0.16, -0.188), head);
    P.add('glow', roundedBox(0.03, 0.13, 0.02, 0.01), M(0, 0.09, -0.186), head);
    const pauldron = lathe([[0, 0.2], [0.14, 0.18], [0.24, 0.1], [0.27, -0.02], [0.25, -0.1], [0, -0.08]], 20);
    for (const s of [-1, 1]) {
      const ua = bi(s < 0 ? 'uaL' : 'uaR'), fa = bi(s < 0 ? 'faL' : 'faR');
      P.add('shell', pauldron, M(s * 0.04, 0.02, 0, 0, 0, -s * 0.35, 1.05, 0.8, 1.1), ua);
      P.add('glow', torus(0.255, 0.012, 32), M(s * 0.04, 0.02, 0, 0, 0, -s * 0.35, 1.05, 0.8, 1.1).multiply(M(0, -0.06, 0, Math.PI / 2, 0, 0)), ua);
      P.add('inner', capsule(0.09, 0.3, 12), M(0, -0.2, 0), ua);
      P.add('inner', sphere(0.105, 12, 10), M(0, -0.42, 0), ua);
      P.add('shell', roundedBox(0.2, 0.42, 0.22, 0.05), M(0, -0.22, 0), fa);
      P.add('glow', roundedBox(0.21, 0.025, 0.225, 0.01), M(0, -0.36, 0), fa);
      if (s < 0) {
        // tower-shield projector plate
        P.add('shell', plate(roundedOutline([[-0.24, 0.42], [0.24, 0.42], [0.22, -0.3], [0, -0.48], [-0.22, -0.3]], 0.05), 0.05, 0.015, 1.2), M(0, -0.3, -0.18), fa);
        P.add('glow', new THREE.OctahedronGeometry(0.06), M(0, -0.28, -0.225, 0, 0, 0, 1, 1.6, 0.5), fa);
      } else {
        // blade
        P.add('inner', roundedBox(0.14, 0.12, 0.14, 0.03), M(0, -0.47, 0), fa);
        P.add('shell', plate([[-0.06, 0], [0.06, 0], [0.05, -0.66], [0, -0.8], [-0.03, -0.66]], 0.035, 0.012), M(0, -0.5, -0.02, 0, Math.PI / 2, 0), fa);
        P.add('glow', roundedBox(0.012, 0.7, 0.02, 0.005), M(0, -0.88, -0.075, 0.06, 0, 0), fa);
      }
    }
  },
};

const SOWER: Spec = {
  height: 1.4, bounds: [0, 0.9, 0, 1.2],
  bones: [
    ['root', null, 0, 0, 0],
    ['body', 'root', 0, 0.95, 0],
    ...[0, 1, 2, 3, 4, 5].map((i): BoneDef => { const a = i / 6 * TAU; return [`p${i}`, 'body', Math.cos(a) * 0.2, 0.32, Math.sin(a) * 0.2, outward(a)]; }),
    ['maw', 'body', 0, 0.0, -0.44],
    ...[0, 1, 2].map((i): BoneDef => { const a = Math.PI * 0.5 + (i - 1) * 1.3; return [`pod${i}`, 'body', Math.cos(a) * 0.44, -0.08, Math.sin(a) * 0.44]; }),
    ...[0, 1, 2, 3, 4].flatMap((i): BoneDef[] => {
      const a = i / 5 * TAU + 0.3;
      return [[`r${i}0`, 'body', Math.cos(a) * 0.2, -0.36, Math.sin(a) * 0.2], [`r${i}1`, `r${i}0`, 0, -0.15, 0], [`r${i}2`, `r${i}1`, 0, -0.13, 0]];
    }),
  ],
  build(P, bi) {
    const body = bi('body');
    P.add('dim', sphere(0.4, 20, 14), M(0, 0, 0, 0, 0, 0, 1, 1.05, 1), body);
    const rib = plate(roundedOutline([[0, 0.44], [0.08, 0.3], [0.1, 0], [0.08, -0.3], [0, -0.42], [-0.08, -0.3], [-0.1, 0], [-0.08, 0.3]], 0.03), 0.03, 0.01, 1.2, 1.12);
    for (let i = 0; i < 11; i++) {
      const a = -Math.PI / 2 + (i + 0.5) / 12 * TAU + TAU / 24;   // leave the front open for the maw
      if (Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) < 0.3) continue;
      const ux = Math.cos(a), uz = Math.sin(a);
      P.add('shell', rib, M(ux * 0.445, 0, uz * 0.445, 0, inward(ux, uz), 0), body);
    }
    P.add('shell', lathe([[0, 0.5], [0.12, 0.47], [0.2, 0.38], [0.18, 0.33], [0, 0.34]], 16), M(), body);
    P.add('inner', lathe([[0, -0.36], [0.2, -0.38], [0.16, -0.46], [0, -0.5]], 16), M(), body);
    P.add('inner', torus(0.17, 0.055, 24), M(0, 0, -0.43), body);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU;
      P.add('shell', new THREE.ConeGeometry(0.03, 0.12, 6), M(Math.cos(a) * 0.15, Math.sin(a) * 0.15, -0.47, 0, 0, a + Math.PI / 2), body);
    }
    P.add('core', sphere(0.12, 14, 10), M(), bi('maw'));
    const spine = plate(roundedOutline([[-0.05, 0], [0.05, 0], [0.035, 0.34], [0, 0.5], [-0.035, 0.34]], 0.015), 0.025, 0.008, 2);
    for (let i = 0; i < 6; i++) {
      const p = bi(`p${i}`);
      P.add('shell', spine, M(0, 0, -0.02), p);
      P.add('glow', new THREE.OctahedronGeometry(0.025), M(0, 0.5, -0.02, 0, 0, 0, 1, 1.8, 1), p);
    }
    for (let i = 0; i < 3; i++) {
      const pb = bi(`pod${i}`);
      P.add('glow', sphere(0.1, 12, 10), M(), pb);
      P.add('shell', lathe([[0, -0.13], [0.09, -0.11], [0.12, -0.02], [0.1, 0.04], [0, 0.03]], 12), M(0, 0, 0), pb);
    }
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const bn = bi(`r${i}${j}`), r = 0.035 - j * 0.009;
      P.add('inner', new THREE.ConeGeometry(r, 0.17, 8), M(0, -0.075, 0, Math.PI, 0, 0), bn);
      if (j === 2) P.add('glow', sphere(0.018, 6, 5), M(0, -0.16, 0), bn);
    }
  },
};

const MIMIC: Spec = {
  height: 1.1, bounds: [0, 0.5, 0, 1.0],
  bones: [
    ['root', null, 0, 0, 0],
    ['body', 'root', 0, 0.31, 0],
    ['lid', 'body', 0, 0.14, 0.3],
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].flatMap(([sx, sz], i): BoneDef[] => {
      const a = Math.atan2(sz, sx);
      return [[`h${i}`, 'body', sx * 0.24, -0.16, sz * 0.24, outward(a)], [`k${i}`, `h${i}`, 0, 0.12, -0.24]];
    }),
  ],
  build(P, bi) {
    const body = bi('body');
    P.add('crate', roundedBox(0.6, 0.45, 0.6, 0.035), M(0, -0.085, 0), body);
    P.add('inner', roundedBox(0.5, 0.06, 0.5, 0.02), M(0, 0.12, 0), body);
    P.add('core', sphere(0.09, 12, 10), M(0, 0.1, -0.02), body);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU;
      const x = Math.max(-0.24, Math.min(0.24, Math.cos(a) * 0.34)), z = Math.max(-0.24, Math.min(0.24, Math.sin(a) * 0.34));
      P.add('shell', new THREE.ConeGeometry(0.03, 0.1, 6), M(x, 0.17, z), body);
    }
    // ember fissures on the crate faces
    P.add('glow', roundedBox(0.012, 0.3, 0.012, 0.004), M(-0.12, -0.08, -0.303, 0, 0, 0.35), body);
    P.add('glow', roundedBox(0.012, 0.18, 0.012, 0.004), M(0.1, -0.15, -0.303, 0, 0, -0.5), body);
    P.add('glow', roundedBox(0.303 * 2, 0.012, 0.012, 0.004), M(0, 0.02, 0.2, 0, 0, 0, 1, 1, 1).multiply(M(0, 0, 0.103)), body);
    P.add('glow', roundedBox(0.012, 0.26, 0.012, 0.004), M(0.303, -0.1, 0.05, 0.4, 0, 0), body);
    P.add('glow', roundedBox(0.012, 0.26, 0.012, 0.004), M(-0.303, -0.12, -0.08, -0.3, 0, 0), body);
    const lid = bi('lid');
    P.add('crate', roundedBox(0.62, 0.15, 0.62, 0.035), M(0, 0.03, -0.3), lid);
    for (let i = 0; i < 8; i++) {
      const t = (i + 0.5) / 8;
      P.add('shell', new THREE.ConeGeometry(0.028, 0.09, 6), M(lerp(-0.26, 0.26, t), -0.07, -0.56, Math.PI, 0, 0), lid);
    }
    P.add('glow', roundedBox(0.012, 0.012, 0.4, 0.004), M(0.1, 0.108, -0.3, 0, 0.5, 0), lid);
    for (let i = 0; i < 4; i++) {
      const h = bi(`h${i}`), k = bi(`k${i}`);
      P.add('inner', sphere(0.05, 10, 8), M(), h);
      P.add('shell', capsule(0.035, 0.2, 8), M(0, 0.06, -0.12, -Math.PI / 2 + 0.45, 0, 0), h);
      P.add('inner', sphere(0.042, 10, 8), M(), k);
      P.add('shell', new THREE.ConeGeometry(0.04, 0.44, 8), M(0, -0.22, 0, Math.PI, 0, 0), k);
      P.add('glow', new THREE.ConeGeometry(0.014, 0.05, 6), M(0, -0.45, 0, Math.PI, 0, 0), k);
    }
  },
};

const COLOSSUS: Spec = {
  height: 3.4, bounds: [0, 1.7, 0, 2.6],
  bones: [
    ['root', null, 0, 0, 0],
    ['pelvis', 'root', 0, 1.2, 0],
    ['torso', 'pelvis', 0, 0.3, 0.05],
    ['chestL', 'torso', -0.44, 0.58, -0.36], ['chestR', 'torso', 0.44, 0.58, -0.36],
    ['core', 'torso', 0, 0.58, -0.16],
    ['head', 'torso', 0, 1.02, -0.22],
    ['uaL', 'torso', -0.92, 0.95, 0.02], ['faL', 'uaL', 0, -0.72, 0], ['fL', 'faL', 0, -0.66, 0],
    ['uaR', 'torso', 0.92, 0.95, 0.02], ['faR', 'uaR', 0, -0.72, 0], ['fR', 'faR', 0, -0.66, 0],
    ['thL', 'pelvis', -0.45, -0.08, 0], ['shL', 'thL', 0, -0.54, 0], ['ftL', 'shL', 0, -0.52, 0],
    ['thR', 'pelvis', 0.45, -0.08, 0], ['shR', 'thR', 0, -0.54, 0], ['ftR', 'shR', 0, -0.52, 0],
  ],
  build(P, bi) {
    const pelvis = bi('pelvis');
    P.add('shell', lathe([[0, -0.28], [0.4, -0.25], [0.56, -0.05], [0.52, 0.15], [0, 0.2]], 20), M(0, 0, 0, 0, 0, 0, 1, 1, 0.7), pelvis);
    P.add('glow', roundedBox(0.6, 0.03, 0.03, 0.01), M(0, 0.05, -0.39), pelvis);
    const torso = bi('torso');
    P.add('inner', cyl(0.36, 0.4, 0.4, 18), M(0, 0.05, 0), torso);
    P.add('shell', lathe([[0, 0.1], [0.5, 0.14], [0.72, 0.45], [0.8, 0.82], [0.62, 1.08], [0, 1.14]], 24), M(0, 0, 0.08, 0, 0, 0, 1, 1, 0.6), torso);
    // cavity behind the chest plates
    P.add('inner', cyl(0.36, 0.36, 0.1, 20), M(0, 0.58, 0.0, Math.PI / 2, 0, 0), torso);
    P.add('glow', torus(0.36, 0.028, 32), M(0, 0.58, -0.41), torso);
    // back ridge + shoulder crystals
    for (let i = 0; i < 4; i++) P.add('shell', new THREE.ConeGeometry(0.09, 0.34, 8), M(0, 0.35 + i * 0.2, 0.56 - i * 0.02, 1.2, 0, 0), torso);
    for (const s of [-1, 1]) {
      P.add('glow', new THREE.OctahedronGeometry(0.12), M(s * 0.62, 1.12, 0.18, 0, 0, -s * 0.5, 0.7, 2.6, 0.7), torso);
      P.add('glow', new THREE.OctahedronGeometry(0.08), M(s * 0.42, 1.16, 0.28, 0.2, 0, -s * 0.3, 0.7, 2.2, 0.7), torso);
    }
    const chestPlate = plate(roundedOutline([[0, 0.38], [0.46, 0.34], [0.47, -0.3], [0.2, -0.42], [0, -0.36]], 0.06), 0.07, 0.02, -0.45, 0.5);
    P.add('shell', chestPlate, M(0, 0, -0.02), bi('chestL'));
    P.add('glow', roundedBox(0.03, 0.62, 0.03, 0.01), M(0.455, 0, -0.14), bi('chestL'));
    P.add('shell', chestPlate, M(0, 0, -0.02, 0, 0, 0, -1, 1, 1), bi('chestR'));
    P.add('glow', roundedBox(0.03, 0.62, 0.03, 0.01), M(-0.455, 0, -0.14), bi('chestR'));
    P.add('core', new THREE.IcosahedronGeometry(0.2, 1), M(), bi('core'));
    const head = bi('head');
    P.add('shell', roundedBox(0.46, 0.4, 0.5, 0.1), M(0, 0.16, 0), head);
    P.add('shell', plate(roundedOutline([[-0.3, 0.06], [0.3, 0.06], [0.22, -0.06], [-0.22, -0.06]], 0.03), 0.06, 0.02, 1), M(0, 0.28, -0.26, -0.25, 0, 0), head);
    P.add('glow', roundedBox(0.3, 0.035, 0.03, 0.012), M(0, 0.17, -0.255), head);
    for (const s of [-1, 1]) P.add('shell', new THREE.ConeGeometry(0.06, 0.42, 8), M(s * 0.2, 0.42, 0.06, 0.7, 0, -s * 0.5), head);
    const pauldron = lathe([[0, 0.34], [0.24, 0.3], [0.4, 0.16], [0.45, -0.02], [0.4, -0.16], [0, -0.12]], 22);
    const fore = lathe([[0, 0.05], [0.18, 0.03], [0.22, -0.2], [0.3, -0.5], [0.28, -0.64], [0, -0.66]], 18);
    for (const s of [-1, 1]) {
      const ua = bi(s < 0 ? 'uaL' : 'uaR'), fa = bi(s < 0 ? 'faL' : 'faR'), f = bi(s < 0 ? 'fL' : 'fR');
      P.add('shell', pauldron, M(s * 0.06, 0.04, 0, 0, 0, -s * 0.3), ua);
      P.add('glow', torus(0.43, 0.02, 36), M(s * 0.06, 0.04, 0, 0, 0, -s * 0.3).multiply(M(0, -0.04, 0, Math.PI / 2, 0, 0)), ua);
      P.add('inner', capsule(0.19, 0.5, 14), M(0, -0.36, 0), ua);
      P.add('inner', sphere(0.21, 14, 10), M(0, -0.72, 0), ua);
      P.add('shell', fore, M(), fa);
      P.add('glow', roundedBox(0.03, 0.4, 0.03, 0.01), M(s * 0.26, -0.38, -0.12, 0, 0, -s * 0.18), fa);
      P.add('glow', roundedBox(0.03, 0.4, 0.03, 0.01), M(s * 0.26, -0.38, 0.12, 0, 0, -s * 0.18), fa);
      P.add('shell', roundedBox(0.5, 0.42, 0.5, 0.1), M(0, -0.18, 0), f);
      P.add('inner', roundedBox(0.52, 0.12, 0.2, 0.04), M(0, -0.28, -0.2), f);
    }
    const shin = lathe([[0, 0.04], [0.2, 0.02], [0.24, -0.15], [0.19, -0.44], [0.16, -0.52], [0, -0.53]], 16);
    for (const s of [-1, 1]) {
      const th = bi(s < 0 ? 'thL' : 'thR'), sh = bi(s < 0 ? 'shL' : 'shR'), ft = bi(s < 0 ? 'ftL' : 'ftR');
      P.add('inner', capsule(0.2, 0.34, 14), M(0, -0.27, 0), th);
      P.add('shell', plate(roundedOutline([[-0.2, 0.2], [0.2, 0.2], [0.17, -0.2], [-0.17, -0.2]], 0.05), 0.05, 0.015, 2.2), M(0, -0.25, -0.2), th);
      P.add('inner', sphere(0.2, 14, 10), M(), sh);
      P.add('shell', shin, M(), sh);
      P.add('shell', new THREE.ConeGeometry(0.14, 0.22, 10), M(0, 0.05, -0.2, -1.4, 0, 0), sh);
      P.add('shell', roundedBox(0.44, 0.2, 0.66, 0.07), M(0, -0.02, -0.12), ft);
      P.add('glow', roundedBox(0.4, 0.025, 0.025, 0.01), M(0, 0.02, -0.46), ft);
    }
  },
};

const SPECS: Record<string, Spec> = { drifter: DRIFTER, warden: WARDEN, sower: SOWER, mimic: MIMIC, colossus: COLOSSUS };
const KEYS = ['shell', 'inner', 'glow', 'core', 'crate', 'dim'] as const;
type Key = typeof KEYS[number];

// ---------- geometry cache (per type + tier) ----------
function makeBones(spec: Spec): { bones: THREE.Bone[]; byName: Record<string, THREE.Bone> } {
  const byName: Record<string, THREE.Bone> = {};
  const bones = spec.bones.map(([name, , x, y, z, ry]) => {
    const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z);
    if (ry) b.rotation.set(0, ry, 0, 'YXZ'); else b.rotation.order = 'YXZ';
    byName[name] = b; return b;
  });
  spec.bones.forEach(([name, parent]) => { if (parent) byName[parent].add(byName[name]); });
  return { bones, byName };
}
const geoCache = new Map<string, Partial<Record<Key, THREE.BufferGeometry>>>();
function enemyGeometry(type: string): Partial<Record<Key, THREE.BufferGeometry>> {
  const key = type + '|' + modelQuality();
  const hit = geoCache.get(key);
  if (hit) return hit;
  const spec = SPECS[type];
  const { bones } = makeBones(spec);
  const g = new THREE.Group(); g.add(bones[0]); g.updateMatrixWorld(true);
  const rest = bones.map((b) => b.matrixWorld.clone());
  const names = spec.bones.map((b) => b[0]);
  const P = new PartSet();
  spec.build(P, (n) => { const i = names.indexOf(n); if (i < 0) throw new Error('bone ' + n); return i; });
  const out: Partial<Record<Key, THREE.BufferGeometry>> = {};
  for (const k of KEYS) if (P.has(k)) out[k] = markShared(P.build(k, rest));
  geoCache.set(key, out);
  return out;
}

// ---------- warden energy shield (hex-grid fresnel dome) ----------
function shieldMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHit: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(PALETTE.portalA) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uHit; uniform float uAlpha; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
      void main() {
        float fr = pow(1.0 - abs(dot(vN, vV)), 2.2);
        vec2 uv = vec2(atan(vP.x, vP.z) * 3.0, vP.y * 5.2);
        vec2 r = vec2(1.0, 1.732); vec2 h = r * 0.5;
        vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h;
        vec2 g = dot(a, a) < dot(b, b) ? a : b;
        float edge = smoothstep(0.43, 0.5, hexDist(g));
        float band = smoothstep(0.85, 1.0, sin(vP.y * 3.0 - uTime * 2.0) * 0.5 + 0.5);
        float i = (fr * 0.6 + edge * (0.06 + fr * 0.4) + band * 0.035) * uAlpha + uHit * (0.3 + edge * 0.8);
        gl_FragColor = vec4(uColor * i, 1.0);
      }`,
  });
}

// ---------- model ----------
export class EnemyModel {
  /** outer group: positioned/yawed by the caller (server yaw: 0 faces +Z) */
  group = new THREE.Group();
  height: number;
  fx: FxUniforms;
  readonly type: string;
  private flip = new THREE.Group();              // rigs are authored facing -Z
  private b: Record<string, THREE.Bone>;
  private meshes: THREE.SkinnedMesh[] = [];
  private frost?: THREE.SkinnedMesh;
  private mats: { shell: THREE.MeshStandardMaterial; inner: THREE.MeshStandardMaterial; glow: THREE.MeshStandardMaterial; core: THREE.MeshStandardMaterial; crate?: THREE.MeshStandardMaterial; dim?: THREE.MeshStandardMaterial };
  private shield?: THREE.Mesh;
  private shieldMat?: THREE.ShaderMaterial;
  private disguise?: THREE.Group;
  // animation state
  private phase = Math.random();
  private speed = 0;
  private wind = 0;
  private strike = 0;           // 1 → 0 after an attack lands
  private stag = 0;             // stagger blend
  private hitKick = 0;
  private death = 0;            // seconds since down
  private shatter = false;
  private frozenBlend = 0;
  private exposed = 0;
  private wake = 1;             // mimic: 0 folded crate → 1 awake
  private prevState = 'idle';
  private shieldA = 1;
  private shieldHit = 0;
  private seed = Math.random() * 100;
  /** fully dissolved after death */
  gone = false;

  constructor(type: string) {
    this.type = SPECS[type] ? type : 'drifter';
    const spec = SPECS[this.type];
    this.height = spec.height;
    this.fx = makeFx(PALETTE.hostile);
    const { bones, byName } = makeBones(spec);
    this.b = byName;
    this.flip.rotation.y = Math.PI;
    this.group.add(this.flip);
    this.flip.add(bones[0]);
    this.flip.updateMatrixWorld(true);
    const geo = enemyGeometry(this.type);
    const hi = modelQuality() === 'high';
    const shell = withFx(hi ? paintMat('#2d2944', 0.3, 0.45) : new THREE.MeshStandardMaterial({ color: '#2d2944', roughness: 0.32, metalness: 0.45 }), this.fx);
    shell.emissive.set('#000000');
    const inner = withFx(new THREE.MeshStandardMaterial({ color: '#16141f', roughness: 0.7, metalness: 0.3 }), this.fx);
    const glow = withFx(glowMat(PALETTE.hostile, 2.4), this.fx);
    const core = withFx(withRim(glowMat(PALETTE.hostile, 4.0), 2, 2), this.fx);
    this.mats = { shell, inner, glow, core };
    if (geo.dim) this.mats.dim = withFx(withRim(glowMat(PALETTE.hostile, 0.7), 1.6, 1.5), this.fx);
    if (geo.crate) this.mats.crate = withFx(new THREE.MeshStandardMaterial({ color: '#b8b2c8', roughness: 0.22, metalness: 0.1, emissive: PALETTE.hostile, emissiveIntensity: 0.06 }), this.fx);
    const skeleton = new THREE.Skeleton(bones);
    const [cx, cy, cz, r] = spec.bounds;
    const sphereB = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
    for (const k of KEYS) {
      const g = geo[k];
      if (!g) continue;
      const mesh = new THREE.SkinnedMesh(g, this.mats[k]!);
      mesh.bind(skeleton, this.flip.matrixWorld.clone());
      mesh.castShadow = k === 'shell' || k === 'inner' || k === 'crate';
      mesh.boundingSphere = sphereB.clone();
      this.flip.add(mesh);
      this.meshes.push(mesh);
    }
    const frostSrc = geo.shell;
    if (frostSrc && this.type !== 'colossus') {
      this.frost = new THREE.SkinnedMesh(frostSrc, frostMat(this.type === 'warden' ? 0.05 : 0.035));
      this.frost.bind(skeleton, this.flip.matrixWorld.clone());
      this.frost.boundingSphere = sphereB.clone();
      this.frost.visible = false;
      this.frost.renderOrder = 2;
      this.flip.add(this.frost);
    }
    if (this.type === 'warden') {
      this.shieldMat = shieldMaterial();
      this.shield = new THREE.Mesh(sharedShieldGeo(), this.shieldMat);
      this.shield.position.y = 1.12;
      this.shield.scale.set(1.12, 1.18, 1.12);
      this.shield.name = 'shield';
      this.group.add(this.shield);
    }
    if (this.type === 'mimic') {
      // exact replica of a light carryable crate — the same builder World uses
      const d = new THREE.Group();
      const box = compactModel(crateModel(false));
      box.position.y = 0.3;
      d.add(box);
      d.visible = false;
      this.disguise = d;
      this.group.add(d);
    }
  }

  // ---- event hooks ----
  hit(blocked = false) {
    if (blocked && this.shield && this.shieldA > 0.3) { this.shieldHit = 1; return; }
    this.fx.uFlash.value = blocked ? 0.35 : 1;
    this.fx.uFlashColor.value.set(blocked ? '#ffd9c8' : '#ffffff');
    this.hitKick = 1;
  }
  attack() { this.strike = 1; this.wind = 0; }
  isDead() { return this.death > 0; }

  update(dt: number, t: number, a: EnemyAnim) {
    dt = Math.min(dt, 0.1);
    const st = a.state;
    const dead = st === 'down';
    const frozen = st === 'frozen';
    if (dead) {
      if (this.death === 0) this.shatter = this.prevState === 'frozen';
      this.death += dt;
    } else if (this.death > 0) { this.death = 0; this.gone = false; this.group.visible = true; this.fx.uDissolve.value = 0; }
    // strike when a wind-up ends
    if (this.prevState === 'telegraph' && (st === 'cooldown' || st === 'chase')) this.strike = 1;
    this.prevState = st;

    this.fx.uFlash.value = Math.max(0, this.fx.uFlash.value - dt * 7);
    this.hitKick = Math.max(0, this.hitKick - dt * 5);
    this.strike = Math.max(0, this.strike - dt * 1.8);
    this.speed += (a.speed - this.speed) * damp(6, dt);
    const windTarget = st === 'telegraph' ? Math.max(0.35, a.telegraph ?? 1) : 0;
    this.wind += (windTarget - this.wind) * damp(st === 'telegraph' ? 7 : 12, dt);
    this.stag += ((st === 'staggered' ? 1 : 0) - this.stag) * damp(8, dt);
    this.frozenBlend += ((frozen ? 1 : 0) - this.frozenBlend) * damp(10, dt);
    this.exposed += ((a.exposed ? 1 : 0) - this.exposed) * damp(5, dt);
    if (this.disguise) {
      const dis = !!a.disguised && !dead;
      this.wake = dis ? 0 : Math.min(1, this.wake + dt / 0.4);
      this.disguise.visible = dis;
      for (const m of this.meshes) m.visible = !dis;
    }

    // ---- pose (held while frozen: time stops inside the ice) ----
    if (!frozen) {
      if (this.speed > 0.05) this.phase = (this.phase + dt * this.speed * 0.9) % 1;
      const c: Ctx = { t: t + this.seed, dt, speed: this.speed, moveW: smoothstep(0.1, 1.2, this.speed), wind: this.wind, strike: easeStrike(this.strike), stag: this.stag, kick: this.hitKick, die: clamp01(this.death / 1.2), exposed: this.exposed, phase: this.phase, wake: this.wake };
      ANIM[this.type](this.b, c);
    }
    if (this.frost) this.frost.visible = this.frozenBlend > 0.5 && !dead;

    // ---- materials by state ----
    const { shell, glow, core, crate, dim } = this.mats;
    const pulse = 0.5 + 0.5 * Math.sin(t * (6 + this.wind * 14));
    if (this.frozenBlend > 0.01) {
      shell.color.set('#2d2944').lerp(ICE_TINT, this.frozenBlend * 0.75);
      glow.emissive.copy(HOSTILE).lerp(ICE, this.frozenBlend); core.emissive.copy(glow.emissive);
      glow.color.copy(glow.emissive);
      glow.emissiveIntensity = lerp(2.4, 1.3, this.frozenBlend); core.emissiveIntensity = lerp(4, 1.6, this.frozenBlend);
    } else {
      shell.color.set('#2d2944');
      glow.emissive.copy(HOSTILE); core.emissive.copy(HOSTILE); glow.color.copy(HOSTILE);
      const flick = this.stag > 0.05 ? (0.55 + 0.45 * Math.sin(t * 37) * Math.sin(t * 11)) : 1;
      glow.emissiveIntensity = (2.4 + this.wind * 3 * pulse) * flick;
      core.emissiveIntensity = (4 + this.wind * 5 * pulse + this.exposed * 3) * flick;
    }
    if (dim) { dim.emissive.copy(glow.emissive); dim.color.set('#2a1a1a'); dim.emissiveIntensity = glow.emissiveIntensity * 0.3; }
    if (crate) crate.emissiveIntensity = 0.06 + this.wind * 0.25 * pulse;
    // dissolve
    if (dead) {
      const dur = this.shatter ? 0.7 : 1.5;
      const d = smoothstep(0.1, dur, this.death);
      this.fx.uDissolve.value = d;
      this.fx.uEdge.value.copy(this.shatter ? ICE : HOSTILE);
      glow.emissiveIntensity *= 1 - d; core.emissiveIntensity *= 1 - d;
      if (d >= 1 && !this.gone) { this.gone = true; this.group.visible = false; }
      if (this.shield) this.shield.visible = false;
    }
    // warden shield
    if (this.shield && this.shieldMat) {
      const want = st !== 'staggered' && !dead && !frozen ? 1 : 0;
      this.shieldA += (want - this.shieldA) * damp(want ? 3 : 14, dt);
      this.shieldHit = Math.max(0, this.shieldHit - dt * 3);
      this.shieldMat.uniforms.uTime.value = t;
      this.shieldMat.uniforms.uAlpha.value = this.shieldA * (want ? 1 : 0.6 + 0.4 * Math.sin(t * 50));
      this.shieldMat.uniforms.uHit.value = this.shieldHit;
      this.shield.visible = this.shieldA > 0.02 && !dead;
      this.shield.rotation.y = t * 0.15;
    }
  }

  /** light colour/intensity suggestion for the pooled light */
  lightLevel(): number {
    if (this.death > 0 || this.disguise?.visible) return 0;
    return 0.8 + this.wind * 3 + this.exposed * 2.5;
  }
}
const ICE_TINT = new THREE.Color('#9cc6de');
const easeStrike = (s: number) => s <= 0 ? 0 : Math.sin(Math.min(1, (1 - s) * 3.2) * Math.PI * 0.5) * s;

let _shieldGeo: THREE.BufferGeometry | undefined;
function sharedShieldGeo() { return (_shieldGeo ??= markShared(new THREE.SphereGeometry(1, 32, 20))); }

// ======================= animation =======================
interface Ctx {
  t: number; dt: number; speed: number; moveW: number; wind: number; strike: number; stag: number;
  kick: number; die: number; exposed: number; phase: number; wake: number;
}
type Bones = Record<string, THREE.Bone>;

function animDrifter(b: Bones, c: Ctx) {
  const { t, wind, strike, stag, die, moveW } = c;
  const body = b.body;
  body.position.y = 1.15 + Math.sin(t * 1.6) * 0.06 + wind * 0.12 - die * 0.5;
  body.position.z = -strike * 0.55 + c.kick * 0.12;
  body.rotation.x = -moveW * 0.28 + wind * 0.38 - strike * 0.5 + Math.sin(t * 9) * stag * 0.15 + c.kick * 0.25 + die * 0.6;
  body.rotation.z = Math.sin(t * 0.9) * 0.06 + Math.sin(t * 7) * stag * 0.15;
  b.ring.rotation.y = t * (1.2 + wind * 5);
  b.head.rotation.x = -0.12 - wind * 0.25 + Math.sin(t * 1.3) * 0.05;
  b.head.rotation.y = Math.sin(t * 0.7) * 0.25 * (1 - wind);
  const flare = 0.12 + Math.sin(t * 2) * 0.06 + wind * 0.85 - strike * 0.3 + die * 0.6;
  for (let i = 0; i < 4; i++) b[`p${i}`].rotation.x = flare + Math.sin(t * 3 + i) * 0.04 * (1 + wind * 3);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    const bn = b[`t${i}${j}`];
    bn.rotation.x = Math.sin(t * 2.2 - j * 0.8 + i * 2) * (0.14 + j * 0.03) - moveW * 0.35 / (j + 1) + strike * 0.3;
    bn.rotation.z = Math.cos(t * 1.7 - j * 0.9 + i) * (0.1 + j * 0.03);
  }
  const s = 1 + wind * 0.35 * (0.8 + 0.2 * Math.sin(t * 20));
  body.scale.setScalar(1);
  b.ring.scale.setScalar(s);
}

function animWarden(b: Bones, c: Ctx) {
  const { t, wind, strike, stag, die, moveW } = c;
  b.base.position.y = 0.5 + Math.sin(t * 1.3) * 0.045 - die * 0.35;
  b.base.rotation.x = -moveW * 0.12 + stag * 0.1;
  b.base.rotation.z = Math.sin(t * 0.8) * 0.025 + Math.sin(t * 8) * stag * 0.05;
  b.torso.rotation.x = -moveW * 0.08 + wind * 0.12 - strike * 0.35 + stag * (0.3 + Math.sin(t * 7) * 0.08) + c.kick * 0.15 + die * 0.5;
  b.torso.rotation.y = -wind * 0.35 + strike * 0.3 + Math.sin(t * 0.6) * 0.05;
  b.torso.rotation.z = Math.sin(t * 5) * stag * 0.08;
  b.head.rotation.x = -0.05 + stag * 0.35 - wind * 0.15 + die * 0.4;
  b.head.rotation.y = Math.sin(t * 0.5) * 0.3 * (1 - wind) * (1 - stag);
  // blade arm: rest low-ready → raised overhead on wind-up → slammed down
  b.uaR.rotation.x = lerp(lerp(0.45, 2.7, wind), -0.25, strike) * (1 - stag * 0.8) + stag * 0.1 + Math.sin(t * 1.4) * 0.03;
  b.uaR.rotation.z = lerp(0.15, 0.35, wind);
  b.faR.rotation.x = lerp(lerp(0.6, 0.35, wind), 0.15, strike) * (1 - stag * 0.6);
  // shield arm braced forward
  b.uaL.rotation.x = lerp(0.62, 0.9, wind) * (1 - stag * 0.8) + Math.sin(t * 1.2) * 0.03;
  b.uaL.rotation.z = -0.15;
  b.faL.rotation.x = lerp(1.0, 1.35, wind) * (1 - stag * 0.7);
}

function animSower(b: Bones, c: Ctx) {
  const { t, wind, strike, stag, die, moveW } = c;
  const body = b.body;
  body.position.y = 0.95 + Math.sin(t * 1.2) * 0.08 - die * 0.45;
  body.position.z = strike * 0.25 + c.kick * 0.1;
  body.rotation.x = -moveW * 0.15 - wind * 0.15 + strike * 0.35 + Math.sin(t * 8) * stag * 0.12 + die * 0.4;
  body.rotation.z = Math.sin(t * 0.7) * 0.08;
  const inflate = 1 + wind * 0.08 + Math.sin(t * 2.4) * 0.02;
  body.scale.set(inflate, inflate, inflate);
  const open = 0.35 + Math.sin(t * 1.5) * 0.08 + wind * 0.95 + die * 0.5;
  for (let i = 0; i < 6; i++) b[`p${i}`].rotation.x = -open + Math.sin(t * 13 + i) * wind * 0.05;
  b.maw.scale.setScalar(Math.max(0.05, 0.3 + wind * 1.0 * (0.85 + 0.15 * Math.sin(t * 24)) - strike * 0.3));
  for (let i = 0; i < 3; i++) b[`pod${i}`].scale.setScalar(1 + Math.sin(t * 2.2 + i * 2) * 0.12);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
    const bn = b[`r${i}${j}`];
    bn.rotation.x = Math.sin(t * 1.8 - j + i * 1.3) * 0.18 - moveW * 0.25;
    bn.rotation.z = Math.cos(t * 1.5 - j + i) * 0.16;
  }
}

function animMimic(b: Bones, c: Ctx) {
  const { t, wind, strike, stag, die, moveW, wake } = c;
  const w = wake * wake * (3 - 2 * wake);
  const ph = c.phase * TAU * 2;
  b.body.position.y = lerp(0.31, 0.46, w) + moveW * Math.abs(Math.sin(ph)) * 0.04 - die * 0.25;
  b.body.position.z = -strike * 0.4 + c.kick * 0.08;
  b.body.rotation.x = wind * 0.25 - strike * 0.3 + Math.sin(t * 20) * stag * 0.06 + c.kick * 0.2;
  b.body.rotation.z = moveW * Math.sin(ph) * 0.06;
  b.lid.rotation.x = w * (0.28 + Math.abs(Math.sin(t * 6)) * 0.15 * (1 - wind) + wind * 0.85 - strike * 0.9) + die * 0.8;
  for (let i = 0; i < 4; i++) {
    const pair = (i === 0 || i === 3) ? 0 : Math.PI;
    const lift = Math.max(0, Math.sin(ph + pair)) * moveW;
    b[`h${i}`].rotation.x = lerp(1.3, 0.25 + lift * 0.45 - wind * 0.15, w);
    b[`k${i}`].rotation.x = lerp(-1.4, -0.6 - lift * 0.3 + wind * 0.2, w) - die * 0.4;
  }
}

function animColossus(b: Bones, c: Ctx) {
  const { t, wind, strike, die, moveW } = c;
  const ph = c.phase * TAU * 0.6;
  const sway = Math.sin(ph);
  b.pelvis.position.y = 1.2 - moveW * Math.abs(Math.cos(ph)) * 0.06 - strike * 0.18 - die * 0.55 + Math.sin(t * 1.1) * 0.01;
  b.pelvis.rotation.y = sway * 0.1 * moveW;
  b.pelvis.rotation.z = sway * 0.05 * moveW;
  const breath = Math.sin(t * 1.1);
  b.torso.rotation.x = -moveW * 0.1 + wind * 0.28 - strike * 0.4 + breath * 0.02 + c.kick * 0.06 - die * 0.5;
  b.torso.rotation.y = -sway * 0.12 * moveW;
  b.torso.rotation.z = -sway * 0.04 * moveW;
  b.head.rotation.x = 0.1 - wind * 0.3 + strike * 0.2 + die * 0.3;
  b.head.rotation.y = Math.sin(t * 0.4) * 0.2 * (1 - wind);
  const open = c.exposed;
  b.chestL.rotation.y = open * 1.15 + Math.sin(t * 9) * open * 0.03;
  b.chestR.rotation.y = -open * 1.15 - Math.sin(t * 9) * open * 0.03;
  b.core.scale.setScalar(1 + open * 0.4 + Math.sin(t * (3 + open * 5)) * 0.05);
  b.core.position.z = -0.16 - open * 0.12;
  b.core.rotation.y = t * 0.8;
  for (const s of [-1, 1]) {
    const ua = s < 0 ? b.uaL : b.uaR, fa = s < 0 ? b.faL : b.faR;
    const swing = moveW * Math.sin(ph) * 0.3 * s;
    ua.rotation.x = lerp(lerp(0.12 + swing, 2.85, wind), -0.35, strike) + breath * 0.02 - die * 0.1;
    ua.rotation.z = s * lerp(0.2, 0.35, wind) + s * die * 0.2;
    fa.rotation.x = lerp(lerp(0.3, 0.6, wind), 0.1, strike);
    const th = s < 0 ? b.thL : b.thR, sh = s < 0 ? b.shL : b.shR, ft = s < 0 ? b.ftL : b.ftR;
    const lp = Math.sin(ph + (s < 0 ? 0 : Math.PI));
    th.rotation.x = lp * 0.32 * moveW + strike * 0.35 + die * 0.9;
    sh.rotation.x = -Math.max(0, Math.cos(ph + (s < 0 ? 0 : Math.PI))) * 0.55 * moveW - strike * 0.6 - die * 1.4;
    ft.rotation.x = -th.rotation.x - sh.rotation.x;
  }
}

const ANIM: Record<string, (b: Bones, c: Ctx) => void> = {
  drifter: animDrifter, warden: animWarden, sower: animSower, mimic: animMimic, colossus: animColossus,
};
