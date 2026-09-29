// Shared bits for the VFX shaders: premultiplied "additive-or-over" blending
// (one draw call can mix glowing sparks and alpha smoke), and scene-fog pickup
// so emissive effects fade into the world's fog instead of glowing through it.
import * as THREE from 'three';

/**
 * Premultiplied blending: src.rgb is pre-multiplied by coverage, and src.a is
 * the "occlusion" part. alpha=0 → pure additive glow; alpha=cov → normal over.
 */
export function applyPremulBlend(m: THREE.ShaderMaterial) {
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = true;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
}

/** GLSL: exp2 fog transmittance for a view-space distance (1 = clear) */
export const FOG_GLSL = /* glsl */`
  uniform float uFogDensity;
  float vfxFog(float d) { float f = d * uFogDensity; return exp(-f * f); }
`;

/**
 * GLSL: grow a sprite to at least `minPx` pixels (uPxWorld = world size of one
 * pixel at unit depth) and return the alpha factor that conserves its energy, so
 * distant motes stay as faint, stable dots instead of sub-pixel shimmer.
 */
export const MINPX_GLSL = /* glsl */`
  uniform float uPxWorld;
  float vfxMinSize(inout float size, float depth, float minPx) {
    float s = max(size, minPx * uPxWorld * depth);
    float k = size / s;
    size = s;
    return k * k;
  }
`;

const _dbs = new THREE.Vector2();
/**
 * Per-draw uniform sync at zero cost: uFogDensity from scene.fog and (when the
 * material has it) uPxWorld from the camera + drawing buffer.
 */
export function bindFog(obj: THREE.Object3D, uniforms: { uFogDensity: { value: number }; uPxWorld?: { value: number } }) {
  obj.onBeforeRender = (r, scene, camera) => {
    const f = scene.fog;
    uniforms.uFogDensity.value = f instanceof THREE.FogExp2 ? f.density
      : f instanceof THREE.Fog ? 1.6 / Math.max(1, f.far) : 0;
    if (uniforms.uPxWorld && camera instanceof THREE.PerspectiveCamera) {
      r.getDrawingBufferSize(_dbs);
      uniforms.uPxWorld.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, _dbs.y);
    }
  };
}
