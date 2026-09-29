// Procedural VFX sprite atlas: one 512x256 single-channel (R8) mask texture,
// 4x2 cells of 128px, generated in code at boot (no image assets). Every VFX
// shader samples it as a coverage mask and tints in-shader, so one texture and
// one sampler serve every particle, ember, ring and puff in the game.
import * as THREE from 'three';
import { markShared } from '../render/dispose';

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;

/** sprite cell indices into the atlas */
export const SPR = {
  glow: 0,      // soft gaussian with a hot pin-point core
  streak: 1,    // narrow, tapered spark streak (stretched along velocity)
  ring: 2,      // thin soft annulus — shock rings, portal rings
  smoke: 3,     // noisy puff — dust, mist, ash (alpha-blended)
  flare: 4,     // 4-point glint — sparkles, stars, pickups
  crystal: 5,   // faceted ice shard
  ember: 6,     // small hot dot with a halo
  bokeh: 7,     // soft disc with a brighter rim — dust motes in light
} as const;

const CELL = 128;

// deterministic value noise for the smoke cell
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 4; i++) { s += a * vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; }
  return s;
}
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// each cell function maps u,v in [-1,1] to coverage [0,1]
const CELLS: ((u: number, v: number) => number)[] = [
  // 0 glow
  (u, v) => {
    const r2 = u * u + v * v;
    return (Math.exp(-r2 * 4.2) * 0.75 + Math.exp(-r2 * 38) * 0.5) * (1 - sstep(0.8, 1, Math.sqrt(r2)));
  },
  // 1 streak — long axis is v
  (u, v) => {
    const taper = Math.max(0, 1 - v * v);
    return Math.exp(-u * u * 22 / Math.max(0.15, taper)) * Math.pow(taper, 1.4);
  },
  // 2 ring
  (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    const d = r - 0.78;
    return (Math.exp(-d * d * 420) + 0.28 * Math.exp(-d * d * 36)) * (1 - sstep(0.93, 1, r));
  },
  // 3 smoke puff
  (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    const n = fbm(u * 2.6 + 7.3, v * 2.6 + 1.9);
    const edge = 1 - sstep(0.35, 0.98, r + (n - 0.5) * 0.55);
    return edge * (0.55 + 0.45 * n);
  },
  // 4 flare / 4-point glint
  (u, v) => {
    const r2 = u * u + v * v;
    const arms = Math.max(
      Math.exp(-Math.abs(u) * 30) * Math.exp(-v * v * 2.6),
      Math.exp(-Math.abs(v) * 30) * Math.exp(-u * u * 2.6));
    return Math.min(1, Math.exp(-r2 * 28) + arms * 0.85) * (1 - sstep(0.85, 1, Math.sqrt(r2)));
  },
  // 5 ice crystal — elongated diamond with two shaded facets
  (u, v) => {
    const d = Math.abs(u) * 1.9 + Math.abs(v) * 1.05;
    const body = 1 - sstep(0.78, 0.9, d);
    const facet = u > 0 ? 1 : 0.55;
    const edgeHi = Math.exp(-Math.pow(d - 0.82, 2) * 400) * 0.6;
    return Math.min(1, body * (0.45 + 0.35 * facet + 0.2 * (1 - d)) + edgeHi * body);
  },
  // 6 ember
  (u, v) => {
    const r2 = u * u + v * v;
    return (Math.exp(-r2 * 60) + Math.exp(-r2 * 9) * 0.45) * (1 - sstep(0.8, 1, Math.sqrt(r2)));
  },
  // 7 bokeh
  (u, v) => {
    const r = Math.sqrt(u * u + v * v);
    return (1 - sstep(0.78, 0.95, r)) * (0.42 + 0.58 * sstep(0.45, 0.9, r)) * 0.85;
  },
];

let cached: THREE.DataTexture | null = null;

/** shared atlas (created once; never disposed — lives for the app lifetime) */
export function vfxAtlas(): THREE.DataTexture {
  if (cached) return cached;
  const W = CELL * ATLAS_COLS, H = CELL * ATLAS_ROWS;
  const data = new Uint8Array(W * H);
  for (let ci = 0; ci < CELLS.length; ci++) {
    const cx = (ci % ATLAS_COLS) * CELL, cy = Math.floor(ci / ATLAS_COLS) * CELL;
    const f = CELLS[ci];
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        // 4% margin so mip levels never bleed between cells
        const u = ((x + 0.5) / CELL * 2 - 1) * 1.04;
        const v = ((y + 0.5) / CELL * 2 - 1) * 1.04;
        const a = Math.abs(u) > 1 || Math.abs(v) > 1 ? 0 : Math.max(0, Math.min(1, f(u, v)));
        data[(cy + y) * W + cx + x] = Math.round(a * 255);
      }
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  markShared(t);
  cached = t;
  return t;
}
