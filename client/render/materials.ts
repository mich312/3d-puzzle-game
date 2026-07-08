// Normal-mapped PBR materials from procedural canvas textures (spec §10):
// tiling *material* normals — stone grain, brushed metal, worn wood — no asset files.
import * as THREE from 'three';
import type { MaterialRole } from '../../shared/level';

const cache = new Map<string, THREE.MeshStandardMaterial>();

// Tangent-space normal maps need vertex tangents to render correctly on the WebGPU
// node-material path (WebGL fakes them from screen-space derivatives; WebGPU does
// not). Our box/cylinder geometries carry no tangents, so on WebGPU the normal maps
// produce black/unlit surfaces. Until tangents are generated, WebGPU drops the
// normal map (surfaces stay correctly lit, just without the fine grain).
let USE_NORMAL_MAPS = true;
export function setRenderBackend(backend: 'webgl2' | 'webgpu') {
  USE_NORMAL_MAPS = backend !== 'webgpu';
}
const texCache = new Map<string, { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }>();

function makeCanvas(n = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return [c, c.getContext('2d')!];
}

/** Height field → tangent-space normal map. */
function normalFromHeight(height: Float32Array, n: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(n);
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const h = (xx: number, yy: number) => height[((yy + n) % n) * n + ((xx + n) % n)];
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// deterministic value noise
function noiseField(n: number, seed: number, octaves: number): Float32Array {
  const rnd = mulberry(seed);
  const field = new Float32Array(n * n);
  let amp = 1, scale = 8;
  for (let o = 0; o < octaves; o++) {
    const grid = Math.max(2, Math.floor(scale));
    const g = new Float32Array((grid + 1) * (grid + 1));
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const gx = (x / n) * grid, gy = (y / n) * grid;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = smooth(gx - x0), fy = smooth(gy - y0);
        const v =
          lerp(lerp(g[y0 * (grid + 1) + x0], g[y0 * (grid + 1) + x0 + 1], fx),
               lerp(g[(y0 + 1) * (grid + 1) + x0], g[(y0 + 1) * (grid + 1) + x0 + 1], fx), fy);
        field[y * n + x] += v * amp;
      }
    }
    amp *= 0.5; scale *= 2.1;
  }
  return field;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RoleSpec {
  base: string; rough: [number, number]; metal: number; seed: number;
  normalStrength: number; grain: 'noise' | 'brushed' | 'planks' | 'tiles';
  tint: number; // color variation amount
}
const ROLES: Record<MaterialRole, RoleSpec> = {
  stone:   { base: '#d8d3e0', rough: [0.75, 0.95], metal: 0.0, seed: 11, normalStrength: 2.2, grain: 'noise', tint: 0.08 },
  tile:    { base: '#cfc9dd', rough: [0.35, 0.7], metal: 0.05, seed: 23, normalStrength: 1.6, grain: 'tiles', tint: 0.05 },
  metal:   { base: '#9d99b0', rough: [0.25, 0.5], metal: 0.85, seed: 37, normalStrength: 1.0, grain: 'brushed', tint: 0.04 },
  wood:    { base: '#8a6f5c', rough: [0.55, 0.8], metal: 0.0, seed: 51, normalStrength: 1.8, grain: 'planks', tint: 0.1 },
  crystal: { base: '#bfc4ff', rough: [0.05, 0.25], metal: 0.1, seed: 67, normalStrength: 0.8, grain: 'noise', tint: 0.06 },
  accent:  { base: '#ffd98a', rough: [0.4, 0.6], metal: 0.2, seed: 71, normalStrength: 1.2, grain: 'noise', tint: 0.05 },
  void:    { base: '#14121f', rough: [0.9, 1.0], metal: 0.0, seed: 83, normalStrength: 0.5, grain: 'noise', tint: 0.02 },
};

function buildTextures(role: MaterialRole) {
  if (texCache.has(role)) return texCache.get(role)!;
  const spec = ROLES[role];
  const n = 512;                       // HD: 4x the texel density of the old 256
  let height = noiseField(n, spec.seed, 4);

  const sc = n / 256;                  // keep pattern scale constant as resolution grows
  if (spec.grain === 'brushed') {
    const step = Math.round(6 * sc);
    const h2 = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        h2[y * n + x] = height[y * n + Math.floor(x / step) * step] * 0.3 + Math.sin(y * 0.9 / sc + height[y * n + x] * 6) * 0.06;
    height = h2;
  } else if (spec.grain === 'planks') {
    const pw = 42 * sc;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const plank = Math.floor(y / pw);
        const edge = Math.min(1, Math.abs((y % pw) - pw / 2) / (4 * sc));
        height[y * n + x] = height[y * n + x] * 0.5 + edge * 0.4 + (plank % 2) * 0.05 + Math.sin(x * 0.35 / sc + plank * 9) * 0.04;
      }
  } else if (spec.grain === 'tiles') {
    const tw = 64 * sc, half = tw / 2;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const gx = Math.abs((x % tw) - half) / half, gy = Math.abs((y % tw) - half) / half;
        const groove = Math.min(1, Math.min(gx, gy) * 10);
        height[y * n + x] = height[y * n + x] * 0.35 + groove * 0.6;
      }
  }

  // albedo: base colour with tint variation from height
  const [c, ctx] = makeCanvas(n);
  const base = new THREE.Color(spec.base);
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = 1 - spec.tint + height[i] * spec.tint * 2 * 0.9;
    img.data[i * 4] = Math.min(255, base.r * 255 * v);
    img.data[i * 4 + 1] = Math.min(255, base.g * 255 * v);
    img.data[i * 4 + 2] = Math.min(255, base.b * 255 * v);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // roughness map from inverted height
  const [rc, rctx] = makeCanvas(n);
  const rimg = rctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const r = lerp(spec.rough[0], spec.rough[1], 1 - Math.min(1, Math.max(0, height[i])));
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = r * 255;
    rimg.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);

  const mk = (canvas: HTMLCanvasElement, srgb = false) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;                 // max the GPU allows (three clamps to hw limit)
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    return t;
  };
  const out = {
    map: mk(c, true),
    normal: mk(normalFromHeight(height, n, spec.normalStrength)),
    rough: mk(rc),
  };
  texCache.set(role, out);
  return out;
}

export function getMaterial(role: MaterialRole, colorOverride?: string, emissive?: string, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  const key = `${role}|${colorOverride ?? ''}|${emissive ?? ''}|${emissiveIntensity}`;
  if (cache.has(key)) return cache.get(key)!;
  const spec = ROLES[role];
  const tex = buildTextures(role);
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: USE_NORMAL_MAPS ? tex.normal : null,
    roughnessMap: tex.rough,
    roughness: 1,
    metalness: spec.metal,
    color: colorOverride ? new THREE.Color(colorOverride) : new THREE.Color('#ffffff'),
  });
  if (emissive) {
    mat.emissive = new THREE.Color(emissive);
    mat.emissiveIntensity = emissiveIntensity;
  }
  if (role === 'crystal') { mat.transparent = true; mat.opacity = 0.92; }
  cache.set(key, mat);
  return mat;
}

/** World-scale UV tiling so textures don't stretch across large slabs. */
export function applyWorldUV(geometry: THREE.BufferGeometry, size: [number, number, number]) {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!uv || !normal) return;
  const density = 0.35;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i));
    let su: number, sv: number;
    if (ny > 0.5) { su = size[0]; sv = size[2]; }
    else if (nx > 0.5) { su = size[2]; sv = size[1]; }
    else { su = size[0]; sv = size[1]; }
    uv.setXY(i, uv.getX(i) * su * density, uv.getY(i) * sv * density);
  }
  uv.needsUpdate = true;
}
