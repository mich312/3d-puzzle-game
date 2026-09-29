// Pooled energy beams: tracers, projectile trails and the curved tractor beam.
// Every beam shares ONE static ribbon geometry (t along the beam × side across);
// the vertex shader evaluates a quadratic Bézier from three uniforms and turns
// the ribbon to face the camera, so re-aiming a beam is three vec3 writes — no
// geometry rebuilds, no per-shot allocations. The fragment shader draws a
// tapered core + soft halo (tracer/trail) or a scrolling helical energy stream
// (tractor). Output is premultiplied-additive; cores sit at ~1.5–2 (small
// bright accents bloom), halos stay well under 1.
import * as THREE from 'three';
import { markShared } from '../render/dispose';
import { applyPremulBlend, bindFog, FOG_GLSL } from './common';

export const BEAM_STYLE = { tracer: 0, tractor: 1, trail: 2, ice: 3 } as const;
export type BeamStyleName = keyof typeof BEAM_STYLE;

const SEGS = 32;
let ribbon: THREE.BufferGeometry | null = null;
function ribbonGeo(): THREE.BufferGeometry {
  if (ribbon) return ribbon;
  const pos = new Float32Array((SEGS + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    pos.set([t, -1, 0, t, 1, 0], i * 6);
    if (i < SEGS) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  markShared(g);
  ribbon = g;
  return g;
}

const VERT = /* glsl */`
  uniform vec3 uP0;
  uniform vec3 uP1;
  uniform vec3 uP2;
  uniform vec2 uWidth;     // width at t=0, t=1 (half-width, metres)
  varying float vT;
  varying float vS;
  varying float vFog;
  ${FOG_GLSL}
  void main() {
    float t = position.x, s = position.y;
    vec3 a = mix(uP0, uP1, t), b = mix(uP1, uP2, t);
    vec3 p = mix(a, b, t);
    vec3 tan = b - a;
    if (dot(tan, tan) < 1e-10) tan = uP2 - uP0 + vec3(0.0, 1e-4, 0.0);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vec3 tv = (viewMatrix * vec4(tan, 0.0)).xyz;
    vec3 side = cross(tv, mv.xyz);
    float sl = length(side);
    side = sl > 1e-6 ? side / sl : vec3(1.0, 0.0, 0.0);
    mv.xyz += side * s * mix(uWidth.x, uWidth.y, t);
    gl_Position = projectionMatrix * mv;
    vT = t; vS = s;
    vFog = vfxFog(length(mv.xyz)) * smoothstep(0.05, 0.4, -mv.z);
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uStyle;
  uniform float uLen;
  uniform float uSeed;
  varying float vT;
  varying float vS;
  varying float vFog;
  void main() {
    float s = vS;
    float core = exp(-s * s * 16.0);
    float halo = exp(-s * s * 3.2) * (1.0 - s * s);
    vec3 hot = mix(uColor, vec3(1.0), 0.35);
    vec3 col;
    float along;
    if (uStyle < 0.5) {
      // tracer: crisp at the muzzle end, tapering + dimming toward the far end
      along = smoothstep(0.0, 0.03, vT) * (1.0 - 0.55 * vT) * (1.0 - smoothstep(0.97, 1.0, vT));
      col = uColor * halo * 0.55 + hot * core * 1.7;
    } else if (uStyle < 1.5) {
      // tractor: scrolling bands + two counter-phased helical strands
      float x = vT * uLen;
      float flow = x * 3.0 - uTime * 9.0;
      float bands = 0.6 + 0.4 * sin(flow + uSeed);
      float w = 0.5 * sin(x * 2.1 - uTime * 6.0);
      float s1 = exp(-(s - w) * (s - w) * 70.0);
      float s2 = exp(-(s + w) * (s + w) * 70.0);
      float sparkle = pow(max(0.0, sin(flow * 2.7 + 1.3) * sin(x * 0.9 + uTime * 2.0)), 6.0);
      along = smoothstep(0.0, 0.12, vT) * (1.0 - smoothstep(0.92, 1.0, vT));
      col = uColor * halo * 0.4 * bands + hot * (core * 0.8 * bands + (s1 + s2) * 1.2 + core * sparkle * 1.2);
    } else if (uStyle < 2.5) {
      // projectile trail: fades out toward the tail (t=0), soft
      along = pow(vT, 1.8);
      col = uColor * halo * 0.5 + hot * core * 1.1;
    } else {
      // ice trail: frosty, slightly noisy core
      along = pow(vT, 1.3);
      float frost = 0.75 + 0.25 * sin(vT * uLen * 14.0 + uSeed * 7.0);
      col = uColor * halo * 0.6 + mix(uColor, vec3(1.0), 0.7) * core * 1.2 * frost;
    }
    float a = along * uAlpha * vFog;
    if (a < 0.002) discard;
    gl_FragColor = vec4(col * a, 0.0);
  }
`;

export interface Beam {
  mesh: THREE.Mesh;
  u: {
    uP0: { value: THREE.Vector3 }; uP1: { value: THREE.Vector3 }; uP2: { value: THREE.Vector3 };
    uWidth: { value: THREE.Vector2 }; uColor: { value: THREE.Color }; uAlpha: { value: number };
    uTime: { value: number }; uStyle: { value: number }; uLen: { value: number }; uSeed: { value: number };
    uFogDensity: { value: number };
  };
  active: boolean;
  key: string | null;   // held beams (tractor) are re-aimed by key each frame
  ttl: number;          // seconds remaining
  max: number;
  alpha: number;        // peak alpha
  fadeIn: number;       // held beams: 0..1 ramp
}

export class Beams {
  private pool: Beam[] = [];
  private time = 0;
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.group.name = 'vfx-beams';
    scene.add(this.group);
  }

  private make(): Beam {
    const u = {
      uP0: { value: new THREE.Vector3() }, uP1: { value: new THREE.Vector3() }, uP2: { value: new THREE.Vector3() },
      uWidth: { value: new THREE.Vector2(0.04, 0.04) }, uColor: { value: new THREE.Color() }, uAlpha: { value: 1 },
      uTime: { value: 0 }, uStyle: { value: 0 }, uLen: { value: 1 }, uSeed: { value: 0 }, uFogDensity: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });
    applyPremulBlend(mat);
    const mesh = new THREE.Mesh(ribbonGeo(), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 21;
    mesh.visible = false;
    bindFog(mesh, u);
    this.group.add(mesh);
    const b: Beam = { mesh, u, active: false, key: null, ttl: 0, max: 1, alpha: 1, fadeIn: 0 };
    this.pool.push(b);
    return b;
  }

  /** grab a free beam from the pool (grows on demand; pool is small in practice) */
  acquire(style: BeamStyleName): Beam {
    const b = this.pool.find((x) => !x.active) ?? this.make();
    b.active = true;
    b.key = null;
    b.ttl = Infinity;
    b.max = 1;
    b.alpha = 1;
    b.fadeIn = 1;
    b.mesh.visible = true;
    b.u.uStyle.value = BEAM_STYLE[style];
    b.u.uSeed.value = Math.random() * 10;
    b.u.uAlpha.value = 1;
    return b;
  }

  release(b: Beam) {
    b.active = false;
    b.key = null;
    b.mesh.visible = false;
  }

  /** straight beam helper: sets P0/P2 and a mid control point */
  static aimStraight(b: Beam, a: THREE.Vector3, c: THREE.Vector3) {
    b.u.uP0.value.copy(a);
    b.u.uP2.value.copy(c);
    b.u.uP1.value.copy(a).add(c).multiplyScalar(0.5);
    b.u.uLen.value = a.distanceTo(c);
  }

  /** fire-and-forget fading tracer */
  tracer(a: THREE.Vector3, c: THREE.Vector3, color: THREE.ColorRepresentation, halfWidth: number, ttlSec: number, style: BeamStyleName = 'tracer') {
    if (a.distanceToSquared(c) < 1e-4) return;
    const b = this.acquire(style);
    Beams.aimStraight(b, a, c);
    b.u.uColor.value.set(color);
    b.u.uWidth.value.set(halfWidth, halfWidth * 0.55);
    b.ttl = b.max = ttlSec;
  }

  /**
   * A continuously held, curved beam (e.g. tractor). Call every frame while
   * held; it fades out on its own `holdSec` after the last call.
   */
  hold(key: string, p0: THREE.Vector3, ctrl: THREE.Vector3, p2: THREE.Vector3, color: THREE.ColorRepresentation, halfWidth: number, holdSec = 0.15, style: BeamStyleName = 'tractor'): Beam {
    let b = this.pool.find((x) => x.active && x.key === key);
    if (!b) { b = this.acquire(style); b.key = key; b.fadeIn = 0; }
    b.u.uP0.value.copy(p0);
    b.u.uP1.value.copy(ctrl);
    b.u.uP2.value.copy(p2);
    b.u.uLen.value = p0.distanceTo(ctrl) + ctrl.distanceTo(p2);
    b.u.uColor.value.set(color);
    b.u.uWidth.value.set(halfWidth * 0.3, halfWidth * 1.15);   // thin at the emitter (it sits by the eye)
    b.ttl = b.max = holdSec;
    return b;
  }

  update(dt: number) {
    this.time += dt;
    for (const b of this.pool) {
      if (!b.active) continue;
      b.u.uTime.value = this.time;
      if (b.key !== null) {
        // held: ramp in fast, fade out over the hold window once no longer refreshed
        b.fadeIn = Math.min(1, b.fadeIn + dt * 12);
        b.ttl -= dt;
        const out = b.ttl > 0 ? 1 : Math.max(0, 1 + b.ttl / 0.12);
        b.u.uAlpha.value = b.alpha * b.fadeIn * out;
        if (out <= 0) this.release(b);
      } else if (b.ttl !== Infinity) {
        b.ttl -= dt;
        const f = Math.max(0, b.ttl / b.max);
        b.u.uAlpha.value = b.alpha * f * f * (3 - 2 * f);
        if (b.ttl <= 0) this.release(b);
      }
    }
  }

  clear() { for (const b of this.pool) this.release(b); }

  dispose() {
    for (const b of this.pool) (b.mesh.material as THREE.Material).dispose();
    this.pool.length = 0;
    this.group.removeFromParent();
  }
}
