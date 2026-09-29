// Shared toolkit for the procedural character / enemy / device models: sculpted
// primitive builders (lathe profiles, beveled plates, rounded boxes), a per-material
// part merger (optionally skinned, so a whole character is a handful of draw calls),
// cached shared materials + procedural textures, and shader injections (noise
// dissolve, hit flash, fresnel rim, frost shell, hologram, viewmodel depth squash).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { markShared } from '../render/dispose';

// ---------- quality ----------
export type ModelTier = 'low' | 'medium' | 'high';
let tier: ModelTier = 'high';
/** New models read this (clearcoat, segment counts). Existing models keep theirs. */
export function setModelQuality(t: ModelTier) { tier = t; }
export function modelQuality(): ModelTier { return tier; }
/** radial segment count scaled by tier */
export function segs(high: number): number {
  return tier === 'low' ? Math.max(6, Math.round(high * 0.6)) : high;
}

// ---------- small math helpers ----------
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
/** compose a transform: position, euler rotation (XYZ), scale */
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  _e.set(rx, ry, rz);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}
export const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// ---------- geometry cache ----------
const geoCache = new Map<string, THREE.BufferGeometry>();
export function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = markShared(make()); geoCache.set(key, g); }
  return g;
}

// ---------- sculpted primitives ----------
/** Smooth lathe from sparse [radius, y] control points (Catmull-Rom resampled). */
export function lathe(ctrl: [number, number][], radial = 16, samples = 18, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  // LatheGeometry faces point outward only for profiles running bottom → top
  if (ctrl[0][1] > ctrl[ctrl.length - 1][1]) ctrl = [...ctrl].reverse();
  const curve = new THREE.SplineCurve(ctrl.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(Math.max(ctrl.length, samples)).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  // exact end radii so caps close cleanly
  pts[0].x = ctrl[0][0]; pts[pts.length - 1].x = ctrl[ctrl.length - 1][0];
  const g = new THREE.LatheGeometry(pts, segs(radial), phiStart, phiLength);
  g.computeVertexNormals();
  return g;
}

export function roundedBox(w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, tier === 'low' ? 1 : seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

/** Beveled armour plate: extruded 2D outline (x,y), centred on its thickness,
 *  optionally bent around the Y axis (z -= bend * x²) so it wraps a limb/torso. */
export function plate(outline: [number, number][], depth: number, bevel: number, bend = 0, bendY = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9,
    bevelSegments: tier === 'low' ? 1 : 3, curveSegments: 6, steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  if (bend || bendY) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, p.getZ(i) + bend * x * x + bendY * y * y);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Smooth rounded outline: corner-rounded polygon for plate(). */
export function roundedOutline(pts: [number, number][], r: number, steps = 3): [number, number][] {
  const out: [number, number][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const rr = Math.min(r, da / 2, db / 2);
    const pa: [number, number] = [p[0] + (a[0] - p[0]) / da * rr, p[1] + (a[1] - p[1]) / da * rr];
    const pb: [number, number] = [p[0] + (b[0] - p[0]) / db * rr, p[1] + (b[1] - p[1]) / db * rr];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // quadratic bezier pa → p → pb
      const x = (1 - t) * (1 - t) * pa[0] + 2 * (1 - t) * t * p[0] + t * t * pb[0];
      const y = (1 - t) * (1 - t) * pa[1] + 2 * (1 - t) * t * p[1] + t * t * pb[1];
      out.push([x, y]);
    }
  }
  return out;
}

export function capsule(r: number, len: number, radial = 12): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, tier === 'low' ? 2 : 4, segs(radial));
}
export function cyl(rt: number, rb: number, h: number, radial = 16, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rt, rb, h, segs(radial), 1, open);
}
export function torus(r: number, tube: number, radial = 24, arc = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, tier === 'low' ? 4 : 8, segs(radial), arc);
}
export function sphere(r: number, w = 16, h = 12): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, segs(w), segs(h));
}

// ---------- part merger ----------
interface Part { geo: THREE.BufferGeometry; m: THREE.Matrix4; bone: number }

/** Collects geometry parts per material key and merges them into one indexed
 *  BufferGeometry per key. With skinning, each part is rigidly bound to a bone. */
export class PartSet {
  private lists = new Map<string, Part[]>();
  add(key: string, geo: THREE.BufferGeometry, m: THREE.Matrix4 = new THREE.Matrix4(), bone = 0): this {
    let l = this.lists.get(key);
    if (!l) { l = []; this.lists.set(key, l); }
    l.push({ geo, m, bone });
    return this;
  }
  keys(): string[] { return [...this.lists.keys()]; }
  has(key: string): boolean { return this.lists.has(key); }
  /** merged geometry for `key`; `boneMats` (model-space rest matrices) enables skinning */
  build(key: string, boneMats?: THREE.Matrix4[]): THREE.BufferGeometry {
    const parts = this.lists.get(key) ?? [];
    let vCount = 0, iCount = 0;
    for (const p of parts) {
      vCount += p.geo.attributes.position.count;
      iCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    }
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
    const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    const skinI = boneMats ? new Uint16Array(vCount * 4) : null;
    const skinW = boneMats ? new Float32Array(vCount * 4) : null;
    let vo = 0, io = 0;
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), full = new THREE.Matrix4();
    for (const p of parts) {
      full.copy(p.m);
      if (boneMats) full.premultiply(boneMats[p.bone]);
      nm.getNormalMatrix(full);
      const P = p.geo.attributes.position, N = p.geo.attributes.normal, U = p.geo.attributes.uv;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(full);
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        if (N) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[(vo + i) * 3] = n.x; nor[(vo + i) * 3 + 1] = n.y; nor[(vo + i) * 3 + 2] = n.z; }
        if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
        if (skinI && skinW) { skinI[(vo + i) * 4] = p.bone; skinW[(vo + i) * 4] = 1; }
      }
      const cnt = p.geo.index ? p.geo.index.count : P.count;
      const flipW = full.determinant() < 0;     // mirrored part: keep triangles front-facing
      for (let i = 0; i < cnt; i++) {
        const j = flipW ? (i - (i % 3)) + (2 - (i % 3)) : i;
        idx[io + i] = (p.geo.index ? p.geo.index.getX(j) : j) + vo;
      }
      io += cnt;
      vo += P.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (skinI && skinW) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(skinW, 4));
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- procedural textures ----------
let fabricNormal: THREE.Texture | undefined;
/** tiling woven-fabric normal map for suit cloth */
export function fabricNormalMap(): THREE.Texture {
  if (fabricNormal) return fabricNormal;
  const n = 128;
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // over-under weave: alternating warp/weft ridges
    const cx = (x % 8) / 8, cy = (y % 8) / 8;
    const warp = Math.sin(cx * Math.PI), weft = Math.sin(cy * Math.PI);
    const over = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) ? warp : weft;
    h[y * n + x] = over * 0.8 + (Math.sin(x * 0.9 + y * 0.3) * 0.5 + 0.5) * 0.1;
  }
  fabricNormal = markShared(normalTexFromHeight(h, n, 1.6));
  fabricNormal.repeat.set(6, 4);
  return fabricNormal;
}
let panelNormal: THREE.Texture | undefined;
/** subtle machined panel-line / micro-scratch normal map for armour & housings */
export function panelNormalMap(): THREE.Texture {
  if (panelNormal) return panelNormal;
  const n = 256;
  const h = new Float32Array(n * n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < h.length; i++) h[i] = rnd() * 0.04;
  // recessed panel seams
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (x % 128 < 2 || y % 96 < 2 || (x > 40 && x < 43 && y % 96 > 30 && y % 96 < 70)) h[y * n + x] -= 0.6;
  }
  panelNormal = markShared(normalTexFromHeight(h, n, 1.6));
  return panelNormal;
}
function normalTexFromHeight(h: Float32Array, n: number, strength: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const H = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
    img.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
    img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ---------- shared materials ----------
const matCache = new Map<string, THREE.Material>();
export function sharedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key + '|' + tier) as T | undefined;
  if (!m) { m = markShared(make()); matCache.set(key + '|' + tier, m); }
  return m;
}

/** painted armour — clearcoat on high tier */
export function paintMat(color: string, rough = 0.38, metal = 0.08): THREE.MeshStandardMaterial {
  if (tier === 'high') {
    return new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: metal, clearcoat: 0.7, clearcoatRoughness: 0.18,
      normalMap: panelNormalMap(), normalScale: new THREE.Vector2(0.35, 0.35),
    });
  }
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal,
    normalMap: tier === 'medium' ? panelNormalMap() : null, normalScale: new THREE.Vector2(0.35, 0.35),
  });
}
export function glowMat(color: string | THREE.Color, intensity = 2.2): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.35, metalness: 0 });
}

// ---------- shader injections ----------
const NOISE_GLSL = /* glsl */`
float dhash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float dnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(dhash(i),dhash(i+vec3(1,0,0)),f.x),mix(dhash(i+vec3(0,1,0)),dhash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(dhash(i+vec3(0,0,1)),dhash(i+vec3(1,0,1)),f.x),mix(dhash(i+vec3(0,1,1)),dhash(i+vec3(1,1,1)),f.x),f.y),f.z); }
`;

/** Per-entity FX uniforms shared by all of that entity's materials. */
export interface FxUniforms {
  uDissolve: { value: number };     // 0 = solid, 1 = gone
  uEdge: { value: THREE.Color };    // dissolve edge glow colour
  uFlash: { value: number };        // 0..1 additive hit flash
  uFlashColor: { value: THREE.Color };
}
export function makeFx(edge = '#e0654a'): FxUniforms {
  return {
    uDissolve: { value: 0 }, uEdge: { value: new THREE.Color(edge) },
    uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color('#ffffff') },
  };
}

/** Noise dissolve with a glowing burn edge + additive hit flash (onBeforeCompile). */
export function withFx<T extends THREE.Material>(mat: T, fx: FxUniforms, scale = 5): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.();
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, fx);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFxPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFxPos;\nuniform float uDissolve; uniform vec3 uEdge; uniform float uFlash; uniform vec3 uFlashColor;\n${NOISE_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  float fxN = dnoise(vFxPos * ${scale.toFixed(2)}) * 0.7 + dnoise(vFxPos * ${(scale * 2.7).toFixed(2)}) * 0.3;
  float fxCut = uDissolve * 1.15 - 0.05;
  if (uDissolve > 0.001 && fxN < fxCut) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (uDissolve > 0.001) totalEmissiveRadiance += uEdge * (1.0 - smoothstep(fxCut, fxCut + 0.07, fxN)) * 5.0;
  totalEmissiveRadiance += uFlashColor * uFlash * 1.6;`);
  };
  mat.customProgramCacheKey = () => `${prevKey ?? ''}|fx${scale}`;
  return mat;
}

/** Fresnel rim: adds emissive * pow(1-N·V, power) * strength (recolours with .emissive). */
export function withRim<T extends THREE.MeshStandardMaterial>(mat: T, power = 2.5, strength = 3): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.();
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { float rimF = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), ${power.toFixed(2)});
    totalEmissiveRadiance += emissive * rimF * ${strength.toFixed(2)}; }`);
  };
  mat.customProgramCacheKey = () => `${prevKey ?? ''}rim${power}|${strength}`;
  return mat;
}

/** Frost shell: inflated, faceted, translucent ice drawn over a frozen body. Shared. */
export function frostMat(inflate = 0.035): THREE.MeshStandardMaterial {
  return sharedMat('frost' + inflate, () => {
    const m = new THREE.MeshStandardMaterial({
      color: '#dff4ff', emissive: '#bfe8ff', emissiveIntensity: 0.35, roughness: 0.12, metalness: 0.05,
      transparent: true, opacity: 0.55, depthWrite: false, flatShading: true,
    });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed += normal * ${inflate.toFixed(3)};`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
  { float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
    gl_FragColor.rgb += vec3(0.75, 0.9, 1.0) * fr * 0.9; gl_FragColor.a = clamp(opacity * (0.45 + fr), 0.0, 0.95); }`);
    };
    m.customProgramCacheKey = () => 'frost' + inflate;
    return m;
  });
}

/** Hologram: additive fresnel + scanlines in a colour, animated by `uTime`. Works on skinned meshes. */
export function holoMat(color: string, time: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: '#000000', emissive: color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHoloY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHoloY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHoloY;\nuniform float uTime;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  { float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 1.8);
    float scan = 0.6 + 0.4 * sin(vHoloY * 110.0 - uTime * 7.0);
    float sweep = smoothstep(0.92, 1.0, fract(vHoloY * 0.45 - uTime * 0.35));
    float flick = 0.88 + 0.12 * sin(uTime * 31.0) * sin(uTime * 7.3);
    vec3 col = emissive * (0.12 + fr * 1.3 + sweep * 0.9) * scan * flick;
    gl_FragColor = vec4(col, 1.0); }`);
  };
  m.customProgramCacheKey = () => 'holo';
  return m;
}

/** Viewmodel depth squash: maps the mesh's depth into the first 1% of the depth
 *  range so the held device never clips into walls, while still self-occluding. */
export function withDepthSquash<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey?.();
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\ngl_Position.z = (-1.0 + (gl_Position.z / gl_Position.w + 1.0) * 0.01) * gl_Position.w;');
  };
  mat.customProgramCacheKey = () => `${prevKey ?? ''}|vmsquash`;
  return mat;
}
