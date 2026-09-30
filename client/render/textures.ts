// Procedural PBR texture synthesis — no asset files. Every role gets a tileable
// set built on typed arrays (no canvas round-trips):
//   map    sRGB albedo with baked cavity/AO
//   normal tangent-space normal from the height field
//   orm    R = ambient occlusion, G = roughness, B = metalness (three.js reads
//          aoMap.r / roughnessMap.g / metalnessMap.b, so ONE texture feeds all three)
//   glow   (crystal / void only) emissive mask: veins + inner cloud
// Patterns are authored in METRES of a 4 m tile so every role shares one world UV
// density (see WORLD_UV_DENSITY) and textures line up across neighbouring pieces.
import * as THREE from 'three';
import type { MaterialRole } from '../../shared/level';
import { markShared } from './dispose';
import { SKY_THEME, initialPixelScale } from './theme';

// sky theme + pixel scale: textures are nearest-magnified so texels stay crisp
// blocks (read once at boot — toggling the pixel scale later doesn't re-texture)
const NEAREST_MAG = SKY_THEME && initialPixelScale() > 0;

export const TILE_METRES = 4;
export const WORLD_UV_DENSITY = 1 / TILE_METRES;

export interface TexSet {
  map: THREE.DataTexture;
  normal: THREE.DataTexture;
  orm: THREE.DataTexture;
  glow?: THREE.DataTexture;
}

// ---------------------------------------------------------------- noise kit
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => smooth(clamp01((v - a) / (b - a)));
const fract = (v: number) => v - Math.floor(v);

/** periodic value noise; u,v in tile space [0,1), `p` lattice cells per tile */
function vnoise(u: number, v: number, p: number, seed: number): number {
  const x = u * p, y = v * p;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const xa = ((x0 % p) + p) % p, ya = ((y0 % p) + p) % p;
  const xb = (xa + 1) % p, yb = (ya + 1) % p;
  const a = hash2(xa, ya, seed), b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed), d = hash2(xb, yb, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** tileable fBm, 0..1-ish */
function fbm(u: number, v: number, p: number, oct: number, seed: number, gain = 0.5): number {
  let s = 0, amp = 0.5, norm = 0, q = p;
  for (let o = 0; o < oct; o++) {
    s += vnoise(u, v, q, seed + o * 31) * amp;
    norm += amp; amp *= gain; q *= 2;
  }
  return s / norm;
}
/** tileable worley: returns [F1, F2, cellHash] with distances in cell units */
const _w: [number, number, number] = [0, 0, 0];
function worley(u: number, v: number, p: number, seed: number): [number, number, number] {
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
      const px = cx + hash2(wx, wy, seed), py = cy + hash2(wx, wy, seed + 7);
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 13); }
      else if (d < f2) f2 = d;
    }
  }
  _w[0] = f1; _w[1] = f2; _w[2] = id;
  return _w;
}

// ---------------------------------------------------------------- field ops
function boxBlur(src: Float32Array, n: number, r: number): Float32Array {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * n + ((k + n) % n)];
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = acc / w;
      acc += src[y * n + ((x + r + 1) % n)] - src[y * n + ((x - r + n) % n)];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[((k + n) % n) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = acc / w;
      acc += tmp[((y + r + 1) % n) * n + x] - tmp[((y - r + n) % n) * n + x];
    }
  }
  return out;
}

function toTexture(data: Uint8Array<ArrayBuffer>, n: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = NEAREST_MAG ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = SKY_THEME ? 2 : 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return markShared(t);
}

/** height (metres) → tangent-space normal map bytes */
function normalBytes(h: Float32Array, n: number, metresPerPx: number, strength: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n * n * 4);
  const k = strength / (2 * metresPerPx);
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1 + n) % n) * n, yp = ((y + 1) % n) * n, yc = y * n;
    for (let x = 0; x < n; x++) {
      const xm = (x - 1 + n) % n, xp = (x + 1) % n;
      const dx = (h[yc + xp] - h[yc + xm]) * k;
      // DataTexture rows run bottom-up in UV space (v grows with y) → +dy is +v
      const dy = (h[yp + x] - h[ym + x]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- role synthesis
interface Fields {
  h: Float32Array;          // height in metres
  r: Float32Array; g: Float32Array; b: Float32Array;   // linear-ish albedo 0..1 (written as sRGB bytes)
  rough: Float32Array; metal: Float32Array; ao: Float32Array;
  glow?: Float32Array;
}
function alloc(n: number, glow = false): Fields {
  const N = n * n;
  return {
    h: new Float32Array(N), r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N),
    rough: new Float32Array(N), metal: new Float32Array(N), ao: new Float32Array(N).fill(1),
    glow: glow ? new Float32Array(N) : undefined,
  };
}
const hex = (s: string) => { const c = new THREE.Color(s); return [c.r, c.g, c.b]; };

// Stone: coursed ashlar — 1 m courses, blocks 1–2 m, pillowed faces, chipped arrises,
// worley pitting, fbm staining. Joints darkened (AO) and rough.
function stone(n: number, f: Fields) {
  const T = TILE_METRES, rows = 4;
  const rnd = mulberry(1103);
  const rowDef = Array.from({ length: rows }, () => {
    const nb = rnd() < 0.5 ? 2 : 3;
    return { nb, off: rnd(), shade: 0 };
  });
  const [br, bg, bb] = hex('#d6d1de');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    const rowF = v * rows, row = Math.floor(rowF), fy = rowF - row;
    const rd = rowDef[row];
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const bxF = u * rd.nb + rd.off, bi = ((Math.floor(bxF) % rd.nb) + rd.nb) % rd.nb, bx = fract(bxF);
      const bw = T / rd.nb, bh = T / rows;
      // warped edge distance in metres → irregular, chipped arrises
      const warp = (fbm(u, v, 16, 3, 5) - 0.5) * 0.06 + (fbm(u, v, 64, 2, 9) - 0.5) * 0.02;
      const ed = Math.min(Math.min(bx, 1 - bx) * bw, Math.min(fy, 1 - fy) * bh) + warp;
      const joint = sstep(0.008, 0.03, ed);
      const pillow = sstep(0.0, 0.14, ed);
      const blockId = hash2(bi, row, 77);
      const detail = fbm(u, v, 24, 4, 17);
      const wz = worley(u, v, 48, 23 + (blockId * 8 | 0));
      const pitZone = sstep(0.5, 0.68, fbm(u, v, 8, 2, 29 + (blockId * 5 | 0)));
      const pit = sstep(0.16 * (0.4 + wz[2]), 0.0, wz[0]) * pitZone;
      const chip = sstep(0.58, 0.74, fbm(u, v, 32, 2, 41)) * sstep(0.1, 0.02, ed);
      const speck = vnoise(u, v, 256, 43);
      const wc = worley(u, v, 10, 47);
      const flake = sstep(0.04, 0.0, wc[1] - wc[0]) * 0.5;       // faint natural veins
      f.h[i] = joint * (0.012 * pillow + detail * 0.007 - pit * 0.004 - chip * 0.009 - flake * 0.001) - (1 - joint) * 0.004;
      const stain = fbm(u, v, 4, 4, 61);
      const tone = 0.9 + (blockId - 0.5) * 0.16 + (detail - 0.5) * 0.22 - (stain - 0.5) * 0.26
        - pit * 0.14 + chip * 0.1 + (speck - 0.5) * 0.08 - flake * 0.06;
      const warm = (hash2(bi, row, 91) - 0.5) * 0.04;
      f.r[i] = br * tone * (1 + warm); f.g[i] = bg * tone; f.b[i] = bb * tone * (1 - warm);
      const jointDark = 0.45 + 0.55 * joint;
      f.ao[i] = jointDark * (1 - pit * 0.35);
      f.rough[i] = 0.78 + detail * 0.14 + (1 - joint) * 0.1 - chip * 0.08;
      f.metal[i] = 0;
    }
  }
}

// Tile: 1 m polished stone tiles with 1 cm grout, bevelled tile edges, corner chips,
// faint marble veining and per-tile tint/gloss variance.
function tile(n: number, f: Fields) {
  const cells = TILE_METRES;   // 1 m tiles
  const [br, bg, bb] = hex('#d2cce0');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const cu = u * cells, cv = v * cells;
      const ti = Math.floor(cu), tj = Math.floor(cv);
      const fu = cu - ti, fv = cv - tj;
      const ed = Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv));   // metres (1 m tiles)
      const cornerD = Math.hypot(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv));
      const tid = hash2(ti % cells, tj % cells, 5);
      const chip = (tid > 0.7 ? 1 : 0) * sstep(0.06, 0.02, cornerD + (fbm(u, v, 48, 2, 3) - 0.5) * 0.03);
      const grout = sstep(0.004, 0.009, ed);
      const bevel = sstep(0.0, 0.03, ed);
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 3 + v * 1.3 + fbm(u, v, 6, 5, 71) * 2.2) * Math.PI * 2)), 18);
      const cloud = fbm(u, v, 12, 4, 29);
      f.h[i] = grout * (0.004 * bevel - chip * 0.003) + (cloud - 0.5) * 0.0006;
      const tone = 0.93 + (tid - 0.5) * 0.1 + (cloud - 0.5) * 0.1 - vein * 0.06;
      f.r[i] = br * tone; f.g[i] = bg * tone; f.b[i] = bb * tone * 1.01;
      if (grout < 0.5) { f.r[i] *= 0.55; f.g[i] *= 0.54; f.b[i] *= 0.58; }
      f.ao[i] = (0.5 + 0.5 * grout) * (1 - chip * 0.25);
      f.rough[i] = grout > 0.5 ? 0.28 + tid * 0.16 + cloud * 0.12 + chip * 0.4 : 0.92;
      f.metal[i] = 0;
    }
  }
}

// Metal: 2 m × 1 m panels (staggered), 6 mm seams, rivet rows, brushed grain,
// random scratches, grime pooled into seams.
function metal(n: number, f: Fields) {
  const [br, bg, bb] = hex('#a4a0b6');
  const rows = 4;
  const scratch = new Float32Array(n * n);
  const rnd = mulberry(4441);
  for (let s = 0; s < 260; s++) {
    let x = rnd() * n, y = rnd() * n;
    const a = rnd() * Math.PI, len = (0.05 + rnd() * 0.4) * n * 0.25, depth = 0.4 + rnd() * 0.6;
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let t = 0; t < len; t++) {
      const xi = ((Math.floor(x) % n) + n) % n, yi = ((Math.floor(y) % n) + n) % n;
      scratch[yi * n + xi] = Math.max(scratch[yi * n + xi], depth);
      x += dx; y += dy;
    }
  }
  for (let y = 0; y < n; y++) {
    const v = y / n;
    const rowF = v * rows, row = Math.floor(rowF), fy = rowF - row;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const off = row % 2 ? 0.25 : 0;
      const pF = u * 2 + off, pi = Math.floor(pF), fx = fract(pF);
      const pw = 2, ph = 1;
      const ex = Math.min(fx, 1 - fx) * pw, ey = Math.min(fy, 1 - fy) * ph;
      const ed = Math.min(ex, ey);
      const seam = sstep(0.003, 0.007, ed);
      // rivets 4 cm in from the panel edge, every 25 cm
      let rivet = 0;
      const rin = 0.05;
      const alongX = fract(fx * pw / 0.25), alongY = fract(fy * ph / 0.25);
      if (Math.abs(ey - rin) < 0.03) rivet = Math.max(rivet, 1 - Math.hypot((alongX - 0.5) * 0.25, ey - rin) / 0.02);
      if (Math.abs(ex - rin) < 0.03) rivet = Math.max(rivet, 1 - Math.hypot((alongY - 0.5) * 0.25, ex - rin) / 0.02);
      rivet = clamp01(rivet);
      const pid = hash2(((pi % 2) + 2) % 2, row, 19);
      const brushed = vnoise(u * 0.5, v, 900, 3) * 0.5 + vnoise(u, v, 256, 7) * 0.5;
      const grime = fbm(u, v, 8, 4, 83);
      const nearSeam = sstep(0.06, 0.0, ed);
      const sc = scratch[i];
      f.h[i] = seam * (0.0012 + rivet * rivet * 0.004 + (brushed - 0.5) * 0.0002 - sc * 0.00025) - (1 - seam) * 0.003;
      const dirt = clamp01(nearSeam * 0.5 + (grime - 0.6) * 1.2);
      const tone = 0.9 + (pid - 0.5) * 0.12 + (brushed - 0.5) * 0.08 + sc * 0.12 + rivet * 0.1;
      f.r[i] = br * tone * (1 - dirt * 0.45); f.g[i] = bg * tone * (1 - dirt * 0.45); f.b[i] = bb * tone * (1 - dirt * 0.4);
      f.ao[i] = (0.4 + 0.6 * seam) * (1 - nearSeam * 0.2);
      f.rough[i] = clamp01(0.3 + (brushed - 0.5) * 0.12 + pid * 0.12 + dirt * 0.45 - sc * 0.18 + (1 - seam) * 0.4);
      f.metal[i] = seam > 0.5 ? 0.82 - dirt * 0.4 : 0.3;   // painted/brushed panels, not mirror chrome
    }
  }
}

// Wood: 25 cm planks with staggered butt joints, warped growth rings, knots.
function wood(n: number, f: Fields) {
  const planks = TILE_METRES / 0.25;
  const rnd = mulberry(733);
  const ends = Array.from({ length: planks }, () => [rnd(), rnd()]);
  const [br, bg, bb] = hex('#9a7a62');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    const pF = v * planks, pk = Math.floor(pF), fv = pF - pk;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const e = ends[pk];
      // two butt joints per plank per tile at random offsets
      const d1 = Math.abs(fract(u - e[0] + 0.5) - 0.5) * TILE_METRES, d2 = Math.abs(fract(u - e[1] + 0.5) - 0.5) * TILE_METRES;
      const ed = Math.min(Math.min(fv, 1 - fv) * 0.25, d1, d2);
      const gap = sstep(0.002, 0.006, ed);
      const segId = hash2(pk, (u - e[0] + 1) % 1 < ((e[1] - e[0] + 1) % 1) ? 1 : 2, 11);
      const warp = fbm(u, v, 4, 4, 91 + pk) * 3;
      const ring = 0.5 + 0.5 * Math.sin((fv * 5 + warp + segId * 7) * Math.PI * 2 + Math.sin(u * Math.PI * 8) * 0.4);
      const fine = vnoise(u * 0.25, v, 600, pk + 3);
      const wz = worley(u, v, 10, 51 + pk);
      const knot = sstep(0.12, 0.0, wz[0]) * (wz[2] > 0.7 ? 1 : 0);
      f.h[i] = gap * (0.001 * ring + fine * 0.0006 - knot * 0.0015) - (1 - gap) * 0.003;
      const tone = 0.92 + (segId - 0.5) * 0.3 + ring * 0.12 + (fine - 0.5) * 0.08 - knot * 0.35;
      f.r[i] = br * tone; f.g[i] = bg * tone * 0.98; f.b[i] = bb * tone * 0.94;
      f.ao[i] = 0.35 + 0.65 * gap;
      f.rough[i] = 0.58 + ring * 0.12 + (1 - gap) * 0.3 - knot * 0.1;
      f.metal[i] = 0;
    }
  }
}

// Crystal: faceted worley cells (each cell a tilted plane), bright fracture lines,
// cloudy inclusions. Glow mask = veins along fractures + inner cloud.
function crystal(n: number, f: Fields) {
  const [br, bg, bb] = hex('#c4c8ff');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const w = worley(u, v, 4, 101);
      const f1 = w[0], f2 = w[1], id = w[2];
      const edge = f2 - f1;
      const gx = Math.cos(id * 6.283), gy = Math.sin(id * 6.283);
      const facet = (u * gx + v * gy) * 0.06 * (0.5 + id);
      const w2 = worley(u, v, 18, 131);
      const cloud = fbm(u, v, 8, 4, 141);
      f.h[i] = facet + sstep(0.0, 0.08, edge) * 0.004 + (w2[1] - w2[0]) * 0.0015;
      const vein = sstep(0.04, 0.0, edge);
      const tone = 0.82 + id * 0.16 + (cloud - 0.5) * 0.2 + vein * 0.25;
      f.r[i] = br * tone; f.g[i] = bg * tone; f.b[i] = bb * tone;
      f.ao[i] = 1;
      f.rough[i] = 0.05 + cloud * 0.12 + (1 - sstep(0, 0.03, edge)) * 0.2;
      f.metal[i] = 0;
      f.glow![i] = clamp01(0.45 + vein * 0.35 + (cloud - 0.45) * 0.8 + sstep(0.35, 0.05, f1) * 0.15);
    }
  }
}

// Accent: warm brushed gold with engraved deco lines + faint hammering.
function accent(n: number, f: Fields) {
  // f.glow = engraved inlay lines (emissive accents glow through the engraving, not as a slab)
  const [br, bg, bb] = hex('#ffdc92');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const cu = fract(u * 4), cv = fract(v * 4);              // 1 m motif
      const diamond = Math.abs(cu - 0.5) + Math.abs(cv - 0.5);
      const line = Math.min(Math.abs(diamond - 0.46), Math.min(cu, 1 - cu, cv, 1 - cv) * 2);
      const groove = sstep(0.004, 0.018, line);
      const hammer = worley(u, v, 48, 211);
      const brushed = vnoise(u, v * 0.5, 700, 5);
      f.h[i] = groove * (0.001 + hammer[0] * 0.0012 + brushed * 0.0002) - (1 - groove) * 0.0015;
      const tone = 0.9 + (brushed - 0.5) * 0.1 + hammer[2] * 0.06 - (1 - groove) * 0.25;
      f.r[i] = br * tone; f.g[i] = bg * tone; f.b[i] = bb * tone;
      f.ao[i] = 0.55 + 0.45 * groove;
      f.rough[i] = 0.32 + brushed * 0.12 + (1 - groove) * 0.3;
      f.metal[i] = groove > 0.5 ? 1 : 0.6;
      f.glow![i] = 0.4 + (1 - groove) * 0.6;
    }
  }
}

// Void: glassy obsidian with conchoidal facets and faint ember fissures.
function voidRole(n: number, f: Fields) {
  const [br, bg, bb] = hex('#1c1828');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const w = worley(u, v, 5, 307);
      const edge = w[1] - w[0];
      const cloud = fbm(u, v, 6, 4, 311);
      f.h[i] = -w[0] * w[0] * 0.03 + sstep(0, 0.05, edge) * 0.003;
      const tone = 0.8 + cloud * 0.35 + w[2] * 0.12;
      f.r[i] = br * tone; f.g[i] = bg * tone; f.b[i] = bb * tone;
      f.rough[i] = 0.18 + cloud * 0.5;
      f.metal[i] = 0;
      f.ao[i] = 1;
      f.glow![i] = sstep(0.05, 0.0, edge) * (0.4 + cloud * 0.6);
    }
  }
}

// Rock: natural, un-cut stone for floating-island undersides — warped strata,
// worley fractures, lichen-free dusty faces.
function rock(n: number, f: Fields) {
  const [br, bg, bb] = hex('#b4aec0');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const warp = fbm(u, v, 4, 4, 401);
      const strata = 0.5 + 0.5 * Math.sin((v * 9 + warp * 2.5) * Math.PI * 2);
      const w = worley(u, v, 7, 409);
      const crack = sstep(0.05, 0.0, w[1] - w[0]);
      const grain = fbm(u, v, 32, 3, 419);
      f.h[i] = strata * 0.02 + grain * 0.012 + w[0] * 0.02 - crack * 0.02;
      const tone = 0.78 + strata * 0.12 + (grain - 0.5) * 0.2 + (w[2] - 0.5) * 0.12 - crack * 0.3;
      f.r[i] = br * tone; f.g[i] = bg * tone; f.b[i] = bb * tone;
      f.ao[i] = 1 - crack * 0.6;
      f.rough[i] = 0.85 + grain * 0.12;
      f.metal[i] = 0;
    }
  }
}

export type TexRole = MaterialRole | 'rock';
const SYNTH: Record<TexRole, { fn: (n: number, f: Fields) => void; normal: number; glow?: boolean; cavity: number }> = {
  stone:   { fn: stone, normal: 1.0, cavity: 6 },
  tile:    { fn: tile, normal: 1.0, cavity: 3 },
  metal:   { fn: metal, normal: 1.0, cavity: 3 },
  wood:    { fn: wood, normal: 1.0, cavity: 4 },
  crystal: { fn: crystal, normal: 0.6, glow: true, cavity: 0 },
  accent:  { fn: accent, normal: 1.0, glow: true, cavity: 3 },
  void:    { fn: voidRole, normal: 0.8, glow: true, cavity: 0 },
  rock:    { fn: rock, normal: 1.4, cavity: 5 },
};

// ---------------------------------------------------------------- sky-temples sets
// Painted, low-frequency surfaces for the golden-hour fresco look: at 240–360
// rendered rows anything finer than ~4 cycles/m just aliases into noise, so every
// generator keeps its noise at ≤ 16 cells per 4 m tile (joint / grout lines excepted).
// Colours are authored as sRGB hexes and written as-is (the albedo bytes are sRGB).
const srgb = (s: string) => { const c = new THREE.Color(s); return [c.r, c.g, c.b].map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;
function marbleVein(u: number, v: number, freq: number) {
  return Math.pow(1 - Math.abs(Math.sin((u * 2 * freq + v * 0.8 * freq + fbm(u, v, 3, 3, 5) * 1.4) * TAU)), 12);
}

// Marble ashlar: the stone() course layout with smooth pillowed blocks, soft veins.
function marbleAshlar(n: number, f: Fields) {
  const T = TILE_METRES, rows = 4;
  const rnd = mulberry(1103);
  const rowDef = Array.from({ length: rows }, () => ({ nb: rnd() < 0.5 ? 2 : 3, off: rnd() }));
  const base = srgb('#eee6d8'), vein = srgb('#a99a8e');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    const rowF = v * rows, row = Math.floor(rowF), fy = rowF - row;
    const rd = rowDef[row];
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const bxF = u * rd.nb + rd.off, bi = ((Math.floor(bxF) % rd.nb) + rd.nb) % rd.nb, bx = fract(bxF);
      const ed = Math.min(Math.min(bx, 1 - bx) * (T / rd.nb), Math.min(fy, 1 - fy) * (T / rows));
      const joint = sstep(0.006, 0.016, ed);
      const blockTone = 0.94 + (hash2(bi, row, 77) - 0.5) * 0.1;
      const vn = marbleVein(u, v, 1);
      const cloud = (fbm(u, v, 4, 3, 9) - 0.5) * 0.08;
      const tone = blockTone + cloud;
      f.h[i] = joint * sstep(0, 0.08, ed) * 0.004 - (1 - joint) * 0.003;
      for (let k = 0; k < 3; k++) {
        const c = lerp(base[k] * tone, vein[k], vn * 0.35) * (1 - vn * 0.06);
        (k === 0 ? f.r : k === 1 ? f.g : f.b)[i] = c;
      }
      f.ao[i] = lerp(0.55, 1, joint);
      f.rough[i] = joint > 0.5 ? 0.5 + cloud * 1.2 : 0.9;
      f.metal[i] = 0;
    }
  }
}

// Marble floor: 2 m checker of cream and rose-grey slabs, fine grout, soft veins.
function marbleTile(n: number, f: Fields) {
  const cells = 2;
  const a = srgb('#f2ece2'), b = srgb('#d8cbbd'), grout = srgb('#8a7e74');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const cu = u * cells, cv = v * cells;
      const ti = Math.floor(cu), tj = Math.floor(cv);
      const fu = cu - ti, fv = cv - tj;
      const ed = Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv)) * (TILE_METRES / cells);
      const g = sstep(0.004, 0.008, ed);
      const alt = (ti + tj) % 2;
      const vn = marbleVein(u, v, 1.5);
      const cloud = (fbm(u, v, 4, 3, 29) - 0.5) * 0.06;
      const tone = 1 + cloud - vn * 0.08;
      const col = alt ? b : a;
      f.r[i] = lerp(grout[0], col[0] * tone, g); f.g[i] = lerp(grout[1], col[1] * tone, g); f.b[i] = lerp(grout[2], col[2] * tone, g);
      f.h[i] = g * 0.002;
      f.ao[i] = 0.6 + 0.4 * g;
      f.rough[i] = g > 0.5 ? 0.32 + alt * 0.06 + cloud : 0.9;
      f.metal[i] = 0;
    }
  }
}

// Bronze: warm cast metal, faint hammering, a cast groove every metre, verdigris.
function bronze(n: number, f: Fields) {
  const base = srgb('#9a6a3a'), pat = srgb('#5f9a86');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const hammer = worley(u, v, 8, 211)[0];
      const gv = Math.abs(fract(v * TILE_METRES) - 0.5) * 1;       // metres from the groove line
      const groove = sstep(0.02, 0.0, 0.5 - gv);
      const patina = clamp01(sstep(0.6, 0.8, fbm(u, v, 3, 4, 17)) * 0.8 + groove * 0.5);
      f.h[i] = hammer * 0.002 - groove * 0.002;
      f.r[i] = lerp(base[0], pat[0], patina); f.g[i] = lerp(base[1], pat[1], patina); f.b[i] = lerp(base[2], pat[2], patina);
      f.ao[i] = 1 - groove * 0.3;
      f.rough[i] = 0.4 + 0.4 * patina;
      f.metal[i] = 1 - 0.85 * patina;
    }
  }
}

// Gold leaf: warm, low-chroma decor gold with leaf seams and a Greek-key groove.
function goldLeaf(n: number, f: Fields) {
  const base = srgb('#f2c25a');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const tone = 1 + (fbm(u, v, 4, 3, 7) - 0.5) * 0.12;
      const su = fract(u * 8), sv = fract(v * 8);                   // 0.5 m leaf squares
      const seam = Math.min(su, 1 - su, sv, 1 - sv) * 0.5 < 0.003 ? 1 : 0;
      // Greek key: square spiral inward, 2 turns, per 1 m cell (stroke 0.1 m)
      const cu = fract(u * 4), cv = fract(v * 4);
      const key = greekKey(cu, cv);
      f.h[i] = -key * 0.002;
      const t = tone - seam * 0.04 - key * 0.3;
      f.r[i] = base[0] * t; f.g[i] = base[1] * t; f.b[i] = base[2] * t;
      f.ao[i] = 1 - key * 0.4;
      // half-metal: under a dim golden-hour IBL a pure metal reads as khaki, so
      // part of the leaf's colour comes from the sun as diffuse
      f.rough[i] = 0.34 + fbm(u, v, 4, 2, 13) * 0.12;
      f.metal[i] = 0.55;
      f.glow![i] = key;
    }
  }
}
/** 1 inside the groove of a 2-turn square spiral in the unit cell (10 strokes wide) */
function greekKey(u: number, v: number): number {
  const gx = Math.floor(u * 10), gy = Math.floor(v * 10);
  if (gx < 0 || gy < 0 || gx > 9 || gy > 9) return 0;
  // hand-authored 10×10 meander cell ('#' = groove)
  return KEY[9 - gy][gx] === '#' ? 1 : 0;
}
const KEY = [
  '..........',
  '.########.',
  '.#......#.',
  '.#.####.#.',
  '.#.#..#.#.',
  '.#.#.##.#.',
  '.#.#....#.',
  '.#.######.',
  '.#........',
  '.#........',
];

// Terracotta: warm fired clay with a painted black-figure band and a cream line.
function terracotta(n: number, f: Fields) {
  const base = srgb('#b8643e'), band = srgb('#2e2220'), cream = srgb('#e8d0a8');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const tone = 1 + (fbm(u, v, 4, 3, 19) - 0.5) * 0.16;
      const fv = fract(v * 4);
      let c = base.map((k) => k * tone);
      if (fv > 0.46 && fv < 0.54) c = band;
      else if ((fv > 0.40 && fv < 0.43) || (fv > 0.57 && fv < 0.60)) c = cream;
      f.r[i] = c[0]; f.g[i] = c[1]; f.b[i] = c[2];
      f.h[i] = 0;
      f.rough[i] = 0.82;
      f.metal[i] = 0;
    }
  }
}

// Limestone: the rock() strata, warmer and much smoother (island undersides).
function limestone(n: number, f: Fields) {
  const base = srgb('#d6b88c');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const warp = fbm(u, v, 4, 4, 401);
      const strata = 0.5 + 0.5 * Math.sin((v * 9 + warp * 2.5) * TAU);
      const w = worley(u, v, 4, 409);
      const crack = sstep(0.05, 0.0, w[1] - w[0]);
      const grain = fbm(u, v, 8, 3, 419);
      f.h[i] = strata * 0.02 + grain * 0.01 + w[0] * 0.02 - crack * 0.02;
      const tone = 0.82 + strata * 0.1 + (grain - 0.5) * 0.14 + (w[2] - 0.5) * 0.1 - crack * 0.25;
      f.r[i] = base[0] * tone; f.g[i] = base[1] * tone; f.b[i] = base[2] * tone;
      f.ao[i] = 1 - crack * 0.5;
      f.rough[i] = 0.88;
      f.metal[i] = 0;
    }
  }
}

// Alabaster: translucent-looking warm stone for the lamps (crystals).
function alabaster(n: number, f: Fields) {
  const base = srgb('#f4e8d4');
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n, i = y * n + x;
      const c = fbm(u, v, 4, 3, 141);
      f.r[i] = base[0] * (0.95 + c * 0.1); f.g[i] = base[1] * (0.95 + c * 0.1); f.b[i] = base[2] * (0.95 + c * 0.1);
      f.h[i] = c * 0.003;
      f.rough[i] = 0.25;
      f.metal[i] = 0;
      f.glow![i] = 0.5 + 0.5 * c;
    }
  }
}

const SYNTH_SKY: typeof SYNTH = {
  stone:   { fn: marbleAshlar, normal: 0.6, cavity: 3 },
  tile:    { fn: marbleTile, normal: 0.5, cavity: 2 },
  metal:   { fn: bronze, normal: 0.6, cavity: 2 },
  wood:    { fn: terracotta, normal: 0.3, cavity: 0 },
  crystal: { fn: alabaster, normal: 0.3, glow: true, cavity: 0 },
  accent:  { fn: goldLeaf, normal: 0.6, glow: true, cavity: 2 },
  void:    SYNTH.void,
  rock:    { fn: limestone, normal: 0.9, cavity: 3 },
};

const cache = new Map<string, TexSet>();

/** Lazily synthesise (and cache) a role's texture set. `n` = resolution (power of 2). */
export function roleTextures(role: TexRole, n: number): TexSet {
  const key = `${role}@${n}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = (SKY_THEME ? SYNTH_SKY : SYNTH)[role];
  const f = alloc(n, spec.glow);
  spec.fn(n, f);
  const N = n * n;
  // cavity: height below its local mean → darker albedo + AO (baked micro-occlusion)
  if (spec.cavity > 0) {
    const blur = boxBlur(f.h, n, Math.max(1, Math.round(n / 128)));
    for (let i = 0; i < N; i++) {
      const cav = clamp01(1 + (f.h[i] - blur[i]) * spec.cavity * 60);
      f.ao[i] *= 0.6 + 0.4 * cav;
    }
  }
  const map = new Uint8Array(N * 4), orm = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const ao = f.ao[i];
    const bake = 0.55 + 0.45 * ao;     // albedo carries part of the AO (reads without IBL too)
    map[i * 4] = clamp01(f.r[i] * bake) * 255;
    map[i * 4 + 1] = clamp01(f.g[i] * bake) * 255;
    map[i * 4 + 2] = clamp01(f.b[i] * bake) * 255;
    map[i * 4 + 3] = 255;
    orm[i * 4] = clamp01(ao) * 255;
    orm[i * 4 + 1] = clamp01(f.rough[i]) * 255;
    orm[i * 4 + 2] = clamp01(f.metal[i]) * 255;
    orm[i * 4 + 3] = 255;
  }
  const set: TexSet = {
    map: toTexture(map, n, true),
    normal: toTexture(normalBytes(f.h, n, TILE_METRES / n, spec.normal), n, false),
    orm: toTexture(orm, n, false),
  };
  if (f.glow) {
    const g = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      const v = clamp01(f.glow[i]) * 255;
      g[i * 4] = g[i * 4 + 1] = g[i * 4 + 2] = v; g[i * 4 + 3] = 255;
    }
    set.glow = toTexture(g, n, false);   // linear mask: values act as plain multipliers
  }
  cache.set(key, set);
  return set;
}

let macroTex: THREE.DataTexture | undefined;
/** Small tileable noise used by the shader macro-variation / edge-wear layer.
    R = broad fbm, G = mid fbm, B = fine worley-ish chips, A = cellular. */
export function macroNoise(): THREE.DataTexture {
  if (macroTex) return macroTex;
  const n = 128;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n, i = (y * n + x) * 4;
      d[i] = fbm(u, v, 4, 5, 901) * 255;
      d[i + 1] = fbm(u, v, 8, 4, 911) * 255;
      d[i + 2] = fbm(u, v, 16, 3, 921) * 255;
      d[i + 3] = clamp01(worley(u, v, 8, 931)[0]) * 255;
    }
  }
  macroTex = toTexture(d, n, false);
  return macroTex;
}
