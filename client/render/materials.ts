// PBR material library from procedural texture sets (spec §10) — no asset files.
// One cached material per (role, colour, emissive, intensity), shared and marked so
// disposal skips it. Medium/high tiers add a shader layer on top of MeshStandard:
//   • macro variation — a world-space, triplanar low-frequency noise that modulates
//     albedo + roughness so the 4 m texture tile never reads as repeating;
//   • edge wear — driven by the geometry's `aEdge` attribute (bevel ridge = 1):
//     lighter chipped stone, bare bright metal, worn wood;
//   • top-face dust — upward faces pick up a faint, rougher film.
// Crystal on high is a MeshPhysicalMaterial (clearcoat + iridescence + a parallax
// "inner cloud" emissive layer that shifts with the view — reads as depth without
// the cost of a transmission pass).
import * as THREE from 'three';
import type { MaterialRole } from '../../shared/level';
import { markShared } from './dispose';
import { roleTextures, macroNoise, WORLD_UV_DENSITY, type TexRole } from './textures';
import { SKY_THEME } from './theme';

export type MatTier = 'low' | 'medium' | 'high';
let tier: MatTier = 'high';

/** Set before building a world. Changing tier drops the cache (new worlds rebuild). */
export function setMaterialTier(t: MatTier) {
  if (t === tier) return;
  tier = t;
  cache.clear();
}
export function materialTier(): MatTier { return tier; }

const cache = new Map<string, THREE.MeshStandardMaterial>();

interface RoleLook {
  metal: number;           // scalar multiplier on the ORM metalness channel
  normalScale: number;
  env: number;             // envMapIntensity for scene IBL
  macro: number;           // albedo macro-variation amount
  macroRough: number;
  wearTint: [number, number, number];
  wear: number;
  wearRough: number;       // added to roughness on worn edges (negative = polished)
  dust: number;
}
const LOOK: Record<TexRole, RoleLook> = {
  stone:   { metal: 0, normalScale: 1.1, env: 0.7, macro: 0.32, macroRough: 0.12, wearTint: [1.22, 1.2, 1.18], wear: 0.8, wearRough: -0.05, dust: 0.18 },
  tile:    { metal: 0, normalScale: 0.9, env: 1.0, macro: 0.18, macroRough: 0.18, wearTint: [1.12, 1.12, 1.1], wear: 0.6, wearRough: 0.18, dust: 0.1 },
  metal:   { metal: 1, normalScale: 0.9, env: 1.0, macro: 0.2, macroRough: 0.2, wearTint: [1.45, 1.42, 1.4], wear: 0.9, wearRough: -0.2, dust: 0.12 },
  wood:    { metal: 0, normalScale: 1.0, env: 0.55, macro: 0.25, macroRough: 0.1, wearTint: [1.3, 1.22, 1.12], wear: 0.7, wearRough: 0.05, dust: 0.1 },
  crystal: { metal: 0, normalScale: 0.5, env: 1.4, macro: 0.1, macroRough: 0.05, wearTint: [1.15, 1.15, 1.2], wear: 0.5, wearRough: -0.02, dust: 0 },
  accent:  { metal: 1, normalScale: 0.8, env: 1.1, macro: 0.12, macroRough: 0.12, wearTint: [1.25, 1.2, 1.1], wear: 0.8, wearRough: -0.15, dust: 0 },
  void:    { metal: 0, normalScale: 0.8, env: 1.2, macro: 0.2, macroRough: 0.3, wearTint: [1.6, 1.4, 1.6], wear: 0.5, wearRough: -0.1, dust: 0 },
  rock:    { metal: 0, normalScale: 1.2, env: 0.5, macro: 0.4, macroRough: 0.1, wearTint: [1.2, 1.18, 1.15], wear: 0.6, wearRough: 0, dust: 0.25 },
};

// ---- shader layer (shared code → one program per material type) ----
const macroUniform = { value: null as THREE.Texture | null };
function patchSurface(mat: THREE.MeshStandardMaterial, look: RoleLook, crystal: boolean) {
  const u = {
    uMacro: macroUniform,
    uMacroAmt: { value: look.macro },
    uMacroRough: { value: look.macroRough },
    uWearTint: { value: new THREE.Vector3(...look.wearTint) },
    uWearAmt: { value: look.wear },
    uWearRough: { value: look.wearRough },
    uDust: { value: look.dust },
    uInner: { value: crystal ? 1 : 0 },
  };
  mat.userData.surface = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aEdge;
        varying float vEdge;
        varying vec3 vWPos;
        varying vec3 vWNrm;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vEdge = aEdge;
        vec4 tWPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          tWPos = instanceMatrix * tWPos;
        #endif
        vWPos = (modelMatrix * tWPos).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uMacro;
        uniform float uMacroAmt, uMacroRough, uWearAmt, uWearRough, uDust, uInner;
        uniform vec3 uWearTint;
        varying float vEdge;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float sMacro; float sWear; float sDust;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 bw = pow(abs(vWNrm), vec3(4.0)); bw /= (bw.x + bw.y + bw.z + 1e-4);
          vec3 p = vWPos * 0.045;
          float m = texture2D(uMacro, p.zy).r * bw.x + texture2D(uMacro, p.xz).r * bw.y + texture2D(uMacro, p.xy).r * bw.z;
          vec3 q = vWPos * 0.16;
          float m2 = texture2D(uMacro, q.zy + 0.37).g * bw.x + texture2D(uMacro, q.xz + 0.37).g * bw.y + texture2D(uMacro, q.xy + 0.37).g * bw.z;
          sMacro = (m - 0.5) * 1.4 + (m2 - 0.5) * 0.6;
          diffuseColor.rgb *= 1.0 + sMacro * uMacroAmt;
          // edge wear: bevel ridge x chipped noise mask
          vec3 w = vWPos * 1.7;
          float chipN = texture2D(uMacro, w.zy).b * bw.x + texture2D(uMacro, w.xz).b * bw.y + texture2D(uMacro, w.xy).b * bw.z;
          sWear = smoothstep(0.15, 0.9, vEdge) * smoothstep(0.35, 0.6, chipN + vEdge * 0.25);
          diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb * uWearTint, vec3(1.0)), sWear * uWearAmt);
          // dust film on up-facing surfaces, broken up by the macro noise
          sDust = smoothstep(0.55, 0.95, vWNrm.y) * smoothstep(0.35, 0.75, m2) * uDust;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * 1.12, sDust);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + sMacro * uMacroRough + sWear * uWearRough + sDust * 0.35, 0.04, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uInner > 0.5) {
          // parallax inner cloud: sample the noise BEHIND the surface along the view
          // ray so the glow drifts against the facets as the camera moves
          vec3 V = normalize(cameraPosition - vWPos);
          vec3 d1 = (vWPos - V * 0.35) * 0.9, d2 = (vWPos - V * 0.8) * 0.55;
          float c1 = texture2D(uMacro, d1.xz + d1.y * 0.31).g;
          float c2 = texture2D(uMacro, d2.zy + d2.x * 0.27).r;
          float inner = smoothstep(0.35, 0.8, c1 * 0.6 + c2 * 0.6);
          float fres = pow(1.0 - clamp(dot(V, normalize(vWNrm)), 0.0, 1.0), 3.0);
          totalEmissiveRadiance *= 0.55 + inner * 0.9;
          totalEmissiveRadiance += diffuseColor.rgb * (inner * 0.05 + fres * 0.12);
        }`);
  };
}

export function getMaterial(role: TexRole, colorOverride?: string, emissive?: string, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  return makeMaterial(role, colorOverride, emissive, emissiveIntensity, false);
}

/**
 * Material for merged static batches: colour overrides travel as vertex colours,
 * so every piece of one (role, emissive) look shares ONE material → one draw per
 * batch cell instead of one per colour variant (fewer draws in every scene pass).
 */
export function getBatchMaterial(role: TexRole, emissive?: string, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  return makeMaterial(role, undefined, emissive, emissiveIntensity, true);
}

function makeMaterial(role: TexRole, colorOverride: string | undefined, emissive: string | undefined, emissiveIntensity: number, vc: boolean): THREE.MeshStandardMaterial {
  const key = `${vc ? 'vc|' : ''}${role}|${colorOverride ?? ''}|${emissive ?? ''}|${emissiveIntensity}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // sky theme: painted, low-detail surfaces (softer normals, less macro, no dust)
  const look = SKY_THEME ? { ...LOOK[role], normalScale: LOOK[role].normalScale * 0.5, macro: LOOK[role].macro * 0.6, dust: 0 } : LOOK[role];
  const res = SKY_THEME ? 128 : tier === 'low' ? 256 : 512;
  const tex = roleTextures(role, res);
  const physical = role === 'crystal' && tier === 'high' && !SKY_THEME;
  const params: THREE.MeshStandardMaterialParameters = {
    map: tex.map,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(look.normalScale, look.normalScale),
    roughnessMap: tex.orm,
    metalnessMap: tex.orm,
    aoMap: tex.orm,
    aoMapIntensity: 0.7,
    roughness: 1,
    metalness: 1,                     // ORM.b already encodes the role's metalness
    envMapIntensity: look.env,
    color: colorOverride ? new THREE.Color(colorOverride) : new THREE.Color('#ffffff'),
  };
  let mat: THREE.MeshStandardMaterial;
  if (physical) {
    mat = new THREE.MeshPhysicalMaterial({
      ...params,
      clearcoat: 1, clearcoatRoughness: 0.08,
      iridescence: 0.55, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
      specularIntensity: 1, ior: 1.6,
    });
  } else {
    mat = new THREE.MeshStandardMaterial(params);
  }
  if (vc) mat.vertexColors = true;
  if (emissive) {
    mat.emissive = new THREE.Color(emissive);
    mat.emissiveIntensity = emissiveIntensity;
    // crystals/void glow through their vein mask instead of as a flat slab
    if (tex.glow) mat.emissiveMap = tex.glow;
  }
  if (role === 'crystal') {
    // darker body so the glow + reflections carry the look (a bright albedo PLUS
    // emissive is what used to bloom into white slabs)
    mat.color.multiplyScalar(emissive ? 0.55 : 0.85);
  }
  if (tier !== 'low') {
    macroUniform.value = macroNoise();
    patchSurface(mat, look, role === 'crystal' && tier === 'high');
  }
  cache.set(key, markShared(mat));
  return mat;
}

/**
 * Emissive budget for a piece of geometry: small accents may glow hot (bloom),
 * large surfaces stay under the bloom threshold so they never blow out to white.
 */
export function emissiveCap(size: [number, number, number], shape: 'box' | 'cylinder', role: MaterialRole): number {
  const dims = shape === 'cylinder' ? [size[0] * 2, size[1], size[0] * 2] : size;
  const s = [...dims].sort((a, b) => b - a);
  const area = s[0] * s[1];              // largest face-ish area
  // 0.25 m² → 2.2 · 4 m² → 1.0 · 16 m²+ → 0.6
  const cap = THREE.MathUtils.clamp(2.2 - Math.log2(Math.max(area, 0.25) / 0.25) * 0.3, 0.6, 2.2);
  return role === 'crystal' || role === 'void' || role === 'accent' ? cap * 1.25 : cap;   // masked by veins / inlays
}

/** World-scale UV tiling for plain BoxGeometry (kept for external callers). */
export function applyWorldUV(geometry: THREE.BufferGeometry, size: [number, number, number]) {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!uv || !normal) return;
  const density = WORLD_UV_DENSITY;
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
