// Ray-marched volumetric projectile. Each pixel the orb covers casts a ray that
// marches through a spherical density field (sphere-traced impostor), accumulating
// emission from animated 3D noise — a hot plasma core fading to the device colour
// with a fresnel rim. This is real ray tracing (ray marching an SDF/volume) done
// per-fragment; WebGL2 has no hardware RT, but a small billboard makes this cheap.
import * as THREE from 'three';

const VERT = /* glsl */`
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;                     // PlaneGeometry(2,2) → xy in [-1,1]
    // camera-facing billboard: offset in view space so it always faces the camera
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uSeed;
  varying vec2 vUv;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; }
    return s;
  }

  void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;                  // outside the impostor disc
    float z = sqrt(1.0 - r2);               // front hemisphere of a unit sphere
    vec3 p0 = vec3(vUv, z);
    vec3 dir = vec3(0.0, 0.0, -1.0);        // march straight back through the volume
    const int STEPS = 14;
    float dens = 0.0, emis = 0.0;
    for (int i = 0; i < STEPS; i++) {
      float t = float(i) / float(STEPS - 1);
      vec3 p = p0 + dir * (z * 2.0) * t;    // front → back of the sphere
      float rr = length(p);
      float shell = smoothstep(1.0, 0.15, rr);            // denser toward the core
      float n = fbm(p * 3.2 + vec3(uSeed, uTime * 1.6, -uTime));
      float d = shell * (0.45 + 0.55 * n);
      dens += d;
      emis += d * d;
    }
    dens /= float(STEPS);
    emis /= float(STEPS);
    float core = pow(1.0 - r2, 3.0);        // white-hot centre
    float rim  = pow(1.0 - z, 2.2);         // fresnel edge glow
    vec3 hot = mix(uColor, vec3(1.0), clamp(core * 0.9 + 0.25, 0.0, 1.0));
    vec3 col = hot * (emis * 3.2 + core * 2.6) + uColor * rim * 1.6;
    float alpha = clamp(dens * 1.7 + core * 0.8, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function makeProjectileMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#ffd98a') },
      uSize: { value: 0.35 },
      uSeed: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
