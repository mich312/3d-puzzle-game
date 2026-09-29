// Global height fog. Patches THREE.ShaderChunk's fog chunks once at import so
// EVERY fogged material (built-in PBR, points, sprites, custom ShaderMaterials
// that include the fog chunks) gets analytic exponential height fog instead of
// the flat FogExp2 wash:
//   density(y) = fogDensity * exp(-falloff * (y - base))
// integrated along the camera→fragment ray, plus a small uniform distance haze.
// The fog colour leans toward the key light (sun in-scatter) and toward a deep
// void tint when looking down, so floating islands read with depth over the
// void below instead of fading into milk.
//
// The extra uniforms are shared by reference: their values are plain {x,y,z(,w)}
// objects, which UniformsUtils.clone passes through uncloned, so one update here
// reaches every compiled program with no per-material bookkeeping. Programs that
// lack the uniforms (a ShaderMaterial built without UniformsLib.fog) read zeros,
// and falloff 0 falls back to the classic FOG_EXP2 curve.
import * as THREE from 'three';

type V3 = { x: number; y: number; z: number };
type V4 = V3 & { w: number };

/** x = falloff (1/m), y = base height, z = in-scatter strength, w = distance-haze floor (fraction of density) */
export const hfogParams: V4 = { x: 0, y: 0, z: 0, w: 0 };
export const hfogSunDir: V3 = { x: 0.5, y: 0.6, z: 0.4 };
export const hfogSunColor: V3 = { x: 1, y: 1, z: 1 };
export const hfogLowColor: V3 = { x: 0, y: 0, z: 0 };

const extraUniforms = {
  hfogParams: { value: hfogParams },
  hfogSunDir: { value: hfogSunDir },
  hfogSunColor: { value: hfogSunColor },
  hfogLowColor: { value: hfogLowColor },
};

let patched = false;
export function installHeightFog() {
  if (patched) return;
  patched = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;

  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;

  // world position from the (rigid) view matrix — works for instanced, skinned
  // and batched meshes alike since mvPosition already includes all of that
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif`;

  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
    uniform vec4 hfogParams;
    uniform vec3 hfogSunDir;
    uniform vec3 hfogSunColor;
    uniform vec3 hfogLowColor;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogCol = fogColor;
    float fogFactor;
    if ( hfogParams.x > 1e-4 ) {
      vec3 fogRay = vFogWorldPos - cameraPosition;
      float fogDist = length( fogRay );
      vec3 fogDir = fogRay / max( fogDist, 1e-4 );
      float fb = hfogParams.x;
      float fk = clamp( fb * fogDir.y * fogDist, -40.0, 40.0 );
      float fInteg = abs( fk ) > 1e-3 ? ( 1.0 - exp( - fk ) ) / fk : 1.0 - 0.5 * fk;
      float fh = clamp( cameraPosition.y - hfogParams.y, -40.0, 200.0 );
      float fogAmt = fogDensity * fogDist * ( exp( - fb * fh ) * fInteg + hfogParams.w );
      fogFactor = 1.0 - exp( - fogAmt );
      // colour: sun in-scatter toward the key light, void tint looking down
      float sunAmt = pow( max( dot( fogDir, hfogSunDir ), 0.0 ), 6.0 ) * hfogParams.z;
      fogCol = mix( fogCol, hfogLowColor, smoothstep( 0.0, -0.6, fogDir.y ) * 0.75 );
      fogCol += hfogSunColor * sunAmt * fogCol;
    } else {
      fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    }
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    vec3 fogCol = fogColor;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;

  // add the shared uniforms wherever three's fog uniforms live, so built-in
  // materials (cloned from ShaderLib) and custom ones merging UniformsLib.fog get them
  Object.assign(THREE.UniformsLib.fog, extraUniforms);
  for (const shader of Object.values(THREE.ShaderLib)) {
    if (shader.uniforms && 'fogDensity' in shader.uniforms) Object.assign(shader.uniforms, extraUniforms);
  }
}

export interface HeightFogSettings {
  falloff: number; base: number; inscatter: number; floor: number;
  sunDir: THREE.Vector3; sunColor: THREE.Color; lowColor: THREE.Color;
}

export function setHeightFog(s: HeightFogSettings) {
  hfogParams.x = s.falloff; hfogParams.y = s.base; hfogParams.z = s.inscatter; hfogParams.w = s.floor;
  hfogSunDir.x = s.sunDir.x; hfogSunDir.y = s.sunDir.y; hfogSunDir.z = s.sunDir.z;
  hfogSunColor.x = s.sunColor.r; hfogSunColor.y = s.sunColor.g; hfogSunColor.z = s.sunColor.b;
  hfogLowColor.x = s.lowColor.r; hfogLowColor.y = s.lowColor.g; hfogLowColor.z = s.lowColor.b;
}
