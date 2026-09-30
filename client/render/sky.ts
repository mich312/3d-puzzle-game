// Procedural sky: one GLSL shader on an inverted sphere (no canvas textures).
// Zenith→horizon gradient with a warm horizon glow, a sun/moon disc + halo
// aligned with the key light, two layers of twinkling stars, and soft drifting
// fbm nebula bands — all tinted per world from WORLD_PALETTES. The horizon uses
// the same fog colour + sun in-scatter as the height fog, so distant geometry
// melts into the sky instead of hitting a seam.
//
// The same material (ENV_MODE, no stars) is rendered once into a PMREM cube for
// image-based lighting — see environment.ts — so ambient light always matches
// the sky the player sees.
//
// CLOUD_SEA (sky-temples theme): below the horizon the view ray is intersected
// with a cloud-deck plane (uCloudY) and shaded with banded, sun-toned fbm; above
// it, low cloud banks and thin cirrus replace the additive nebula.
import * as THREE from 'three';
import { worldPalette } from './theme';

export interface SkyOptions {
  /** world-space unit vector toward the key light */
  sunDir: THREE.Vector3;
  /** 1 = cheap (1 star layer, 3 nebula octaves), 2 = full */
  detail: 1 | 2;
  /** render for the IBL cube: no stars/twinkle, lifted ground bounce */
  envMode?: boolean;
}

const vert = /* glsl */`
  varying vec3 vDir;       // world-space direction (gradient, sun)
  varying vec3 vLocal;     // object-space direction (stars/nebula drift with rotation)
  void main() {
    vLocal = normalize(position);
    // un-rotated world view direction: gradient + sun stay put while the
    // star/nebula layer (object space) drifts with the sky's slow spin
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;  // pin to the far plane
  }`;

const frag = /* glsl */`
  uniform vec3 uTop, uSky, uHorizon, uGlow, uVoid, uNebA, uNebB, uSunColor;
  uniform vec3 uSunDir;
  uniform float uTime, uStars, uSunSize, uInscatter;
  uniform vec3 uCloudLit, uCloudShade;
  uniform float uCloudY, uCloudCover, uCloudScale;
  varying vec3 vDir;
  varying vec3 vLocal;

  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
                   mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                   mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < NEB_OCTAVES; i++) { s += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
    return s;
  }
  // one star layer: jittered point per 3D cell of the direction lattice
  float stars(vec3 d, float scale, float thresh, float seed) {
    vec3 p = d * scale;
    vec3 c = floor(p);
    float h = hash3(c + seed);
    if (h < thresh) return 0.0;
    vec3 j = vec3(hash3(c + seed + 11.0), hash3(c + seed + 23.0), hash3(c + seed + 37.0)) * 0.7 + 0.15;
    float dist = length(fract(p) - j);
    float size = 0.035 + 0.05 * hash3(c + seed + 51.0);
    float b = smoothstep(size, 0.0, dist);
    #ifndef ENV_MODE
      b *= 0.65 + 0.35 * sin(uTime * (1.5 + 3.0 * hash3(c + seed + 71.0)) + h * 40.0);
    #endif
    return b * (0.6 + 1.6 * pow(hash3(c + seed + 91.0), 6.0));
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;

    // --- gradient: void below, horizon (fog colour), mid sky, zenith ---
    vec3 col = mix(uHorizon, uSky, smoothstep(0.0, 0.28, y));
    col = mix(col, uTop, smoothstep(0.22, 0.95, y));
    vec3 below = mix(uHorizon, uVoid, smoothstep(0.0, -0.45, y));
    #ifdef ENV_MODE
      below = mix(uHorizon, uVoid * 2.0 + uHorizon * 0.35 + uGlow * 0.05, smoothstep(0.0, -0.6, y));
    #endif
    #ifdef CLOUD_SEA
      if (y < 0.0) {
        // cloud deck: intersect the view ray with the plane y = uCloudY
        float t = (uCloudY - cameraPosition.y) / min(y, -1e-3);
        if (t > 0.0) {
          vec2 p = cameraPosition.xz + d.xz * t + vec2(uTime * 0.6, uTime * 0.25);
          float c1 = fbm(vec3(p * uCloudScale, 0.0));
          float c2 = fbm(vec3((p + normalize(uSunDir.xz + 1e-4) * 6.0) * uCloudScale, 0.0));
          float cov = smoothstep(uCloudCover - 0.05, uCloudCover + 0.05, c1);
          // sun-side tops brighter, toned into 3 flat bands (painted, not photographic)
          float lit = clamp(0.5 + (c1 - c2) * 5.0 + (c1 - uCloudCover) * 1.5, 0.0, 1.0);
          lit = floor(lit * 2.99) / 2.0;
          vec3 cloud = mix(uCloudShade, uCloudLit, lit) + uSunColor * pow(max(dot(d, uSunDir) * 0.5 + 0.5, 0.0), 4.0) * 0.15;
          // gaps look down into lapis depth so the cloud shapes read against white marble
          vec3 gap = mix(uCloudShade, uTop, 0.7);
          vec3 deck = mix(gap, cloud, cov);
          below = mix(deck, uHorizon, clamp(1.0 - exp(-t * 0.0022), 0.0, 1.0));
        } else {
          below = uVoid;
        }
        below = mix(uHorizon, below, smoothstep(0.0, -0.06, y));
        #ifdef ENV_MODE
          below = mix(uHorizon, mix(uCloudShade, uCloudLit, 0.6) * 0.9, smoothstep(0.0, -0.6, y));
        #endif
      }
    #endif
    col = y < 0.0 ? below : col;
    // horizon glow band, brighter on the sun side
    float sunSide = 0.55 + 0.45 * max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4)), 0.0);
    col += uGlow * exp(-abs(y) * 9.0) * 0.2 * sunSide;

    // --- nebula / cloud bands (object space, drift with the slow sky rotation) ---
    vec3 l = normalize(vLocal);
    float band = exp(-pow(dot(l, normalize(vec3(0.35, 0.8, 0.45))) * 2.6, 2.0));
    float n = fbm(l * 2.6 + vec3(0.0, uTime * 0.004, 0.0));
    float n2 = fbm(l * 5.3 - vec3(uTime * 0.006, 0.0, 0.0));
    float neb = smoothstep(0.38, 0.85, n * 0.75 + n2 * 0.45) * band;
    float skyMask = smoothstep(-0.05, 0.25, y);
    #ifdef CLOUD_SEA
      // low cumulus banks hugging the horizon + thin high cirrus (opaque mixes, not glow)
      float cb = fbm(l * vec3(3.0, 9.0, 3.0) + vec3(uTime * 0.01, 0.0, 0.0));
      float cm = smoothstep(0.5, 0.72, cb) * exp(-max(y, 0.0) * 5.0) * smoothstep(-0.02, 0.04, y);
      col = mix(col, mix(uCloudShade, uCloudLit, 0.35 + 0.65 * sunSide), cm * 0.85);
      float ci = smoothstep(0.55, 0.8, fbm(l * vec3(1.5, 6.0, 1.5) - vec3(0.0, 0.0, uTime * 0.004))) * smoothstep(0.1, 0.5, y) * (1.0 - smoothstep(0.7, 0.95, y));
      col = mix(col, uCloudLit, ci * 0.35);
    #else
      col += mix(uNebA, uNebB, smoothstep(0.35, 0.75, n2)) * neb * 0.16 * skyMask;
    #endif

    // --- sun / moon disc + halo aligned with the key light ---
    float cs = dot(d, uSunDir);
    float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.75), cs);
    float halo = pow(max(cs, 0.0), 48.0) * 0.55 + pow(max(cs, 0.0), 6.0) * 0.12 * uInscatter;
    col += uSunColor * halo;
    #ifndef ENV_MODE
      col += uSunColor * disc * 2.4;   // true HDR: the one sky element that blooms
    #else
      col += uSunColor * disc * 1.2;
    #endif

    #ifndef ENV_MODE
      // --- stars: fade at the horizon, under nebula and near the sun ---
      float sMask = smoothstep(0.02, 0.35, y) * (1.0 - neb * 0.7) * (1.0 - halo * 2.0);
      float s = stars(l, 90.0, 0.55, 3.0);
      #if STAR_LAYERS > 1
        s += stars(l, 190.0, 0.35, 17.0) * 0.55;
      #endif
      col += vec3(0.92, 0.95, 1.0) * s * uStars * max(sMask, 0.0);
    #endif

    gl_FragColor = vec4(col, 1.0);
  }`;

function lin(hex: string): THREE.Color { return new THREE.Color(hex); }  // Color() already converts sRGB hex → linear

export function makeSkyMaterial(world: string, opts: SkyOptions): THREE.ShaderMaterial {
  const p = worldPalette(world);
  const defines: Record<string, string | number> = {
    NEB_OCTAVES: opts.detail === 2 ? 4 : 3,
    STAR_LAYERS: opts.detail === 2 ? 2 : 1,
  };
  if (opts.envMode) defines.ENV_MODE = '';
  if (p.cloudY !== undefined) defines.CLOUD_SEA = '';
  return new THREE.ShaderMaterial({
    defines,
    uniforms: {
      uTop: { value: lin(p.skyTop) },
      uSky: { value: lin(p.sky) },
      uHorizon: { value: lin(p.fog) },
      uGlow: { value: lin(p.skyGlow) },
      uVoid: { value: lin(p.voidColor) },
      uNebA: { value: lin(p.nebulaA) },
      uNebB: { value: lin(p.nebulaB) },
      uSunColor: { value: lin(p.key) },
      uSunDir: { value: opts.sunDir.clone() },
      uTime: { value: 0 },
      uStars: { value: p.stars },
      uSunSize: { value: world === 'observatory' ? 0.05 : 0.035 },
      uInscatter: { value: p.inscatter },
      uCloudLit: { value: lin(p.cloudLit ?? p.nebulaA) },
      uCloudShade: { value: lin(p.cloudShade ?? p.nebulaB) },
      uCloudY: { value: p.cloudY ?? -20 },
      uCloudCover: { value: p.cloudCover ?? 0.5 },
      uCloudScale: { value: p.cloudScale ?? 0.018 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: !opts.envMode,
    fog: false,
    toneMapped: false,
  });
}

export function makeSky(world: string, opts: SkyOptions): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(240, 48, 24), makeSkyMaterial(world, opts));
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return mesh;
}
