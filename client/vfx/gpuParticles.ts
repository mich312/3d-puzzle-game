// GPU particle pool. One InstancedBufferGeometry quad, one interleaved instance
// buffer, one draw call for every burst/spark/ring/puff in the game.
//
// The CPU only writes a particle ONCE, at spawn (position, velocity, spawn time,
// life, size, colour, sprite, mode…). Motion is evaluated in closed form in the
// vertex shader from the global time uniform — exponential drag + gravity,
// velocity-stretched streaks, surface-oriented rings and orbit/spiral motion —
// so there is zero per-particle CPU work per frame. Newly written slots are
// uploaded with at most two sub-range updates of the single buffer per frame.
//
// Dead / not-yet-born particles collapse to an off-screen point in the vertex
// shader and cost no fill. Spawn time may be in the future (brush.delay) for
// staggered, sequenced effects without timers.
import * as THREE from 'three';
import { vfxAtlas, ATLAS_COLS, ATLAS_ROWS } from './sprites';
import { applyPremulBlend, bindFog, FOG_GLSL, MINPX_GLSL } from './common';

/** motion modes (see vertex shader) */
export const MODE = {
  billboard: 0,   // camera-facing, drag + gravity ballistic
  streak: 1,      // camera-facing, stretched along screen-space velocity
  plane: 2,       // static, oriented in the plane whose normal is the "velocity"
  orbit: 3,       // circles an axis (the "velocity") around the spawn point
} as const;

const STRIDE = 24; // floats per particle (6 x vec4)

/**
 * Mutable spawn state ("brush"): set it once per effect, then emit many
 * particles varying only position/velocity/life/size. No allocations.
 */
export class Brush {
  color = new THREE.Color(1, 1, 1);  // linear, may exceed 1 (HDR → bloom)
  alpha = 1;
  sprite = 0;
  mode: number = MODE.billboard;
  grow = 1;         // end size = size * grow (ease-out)
  grav = 0;         // m/s² on y (orbit: rise speed m/s)
  drag = 0;         // 1/s exponential velocity decay (orbit: radius decay, <0 expands)
  rot = 0;          // initial sprite rotation (orbit: start angle)
  spin = 0;         // rad/s (orbit: angular speed)
  stretch = 0;      // streak: extra length per m/s of screen velocity (orbit: radius)
  fadeIn = 0;       // fraction of life
  fadeOut = 0.5;    // fade starts at this fraction of life
  hot = 0;          // fraction of life spent desaturated toward white-hot
  additive = 1;     // 1 = glow (additive), 0 = alpha-over (smoke, ash)
  delay = 0;        // seconds until the particle is born
  reset(): this {
    this.color.setRGB(1, 1, 1); this.alpha = 1; this.sprite = 0; this.mode = MODE.billboard;
    this.grow = 1; this.grav = 0; this.drag = 0; this.rot = 0; this.spin = 0; this.stretch = 0;
    this.fadeIn = 0; this.fadeOut = 0.5; this.hot = 0; this.additive = 1; this.delay = 0;
    return this;
  }
}

const VERT = /* glsl */`
  attribute vec4 aPos;   // xyz spawn, w spawn time
  attribute vec4 aVel;   // xyz velocity | plane/orbit normal, w life
  attribute vec4 aSize;  // size0, size1, grav, drag
  attribute vec4 aCol;   // linear rgb (HDR), alpha
  attribute vec4 aSpr;   // sprite + mode*16, rot0, spin, stretch
  attribute vec4 aFade;  // fadeIn, fadeOutStart, hot, additive
  uniform float uTime;
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vAdd;
  varying vec3 vStreak;   // x,y = quad corner, z = 1 for analytic streak coverage
  ${FOG_GLSL}
  ${MINPX_GLSL}

  vec3 perpBasis(vec3 n, out vec3 t2) {
    vec3 up = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t1 = normalize(cross(n, up));
    t2 = cross(n, t1);
    return t1;
  }

  void main() {
    float age = uTime - aPos.w;
    float life = aVel.w;
    if (age < 0.0 || age >= life) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // outside clip → culled, zero fill
      vCol = vec4(0.0); vUv = vec2(0.0); vAdd = 1.0; vStreak = vec3(0.0);
      return;
    }
    float a = age / life;
    float mode = floor(aSpr.x / 16.0 + 0.01);
    float spr = aSpr.x - mode * 16.0;
    float e = 1.0 - (1.0 - a) * (1.0 - a);                 // ease-out size curve
    float size = mix(aSize.x, aSize.y, e);
    vec2 c = position.xy;
    vec4 mv;
    float energy = 1.0;

    if (mode < 0.5 || (mode > 0.5 && mode < 1.5)) {
      float k = max(aSize.w, 0.0005);
      float ek = exp(-k * age);
      vec3 wp = aPos.xyz + aVel.xyz * (1.0 - ek) / k + vec3(0.0, 0.5 * aSize.z * age * age, 0.0);
      mv = viewMatrix * vec4(wp, 1.0);
      energy = vfxMinSize(size, -mv.z, 1.5);
      if (mode < 0.5) {
        float r = aSpr.y + aSpr.z * age;
        float cs = cos(r), sn = sin(r);
        mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
      } else {
        vec3 vel = aVel.xyz * ek + vec3(0.0, aSize.z * age, 0.0);
        vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
        vec2 sv = vv.xy + vec2(0.0, 1e-5);
        float sl = length(sv);
        vec2 dirA = sv / sl;
        vec2 dirP = vec2(dirA.y, -dirA.x);   // (dirP, dirA) keeps the quad's winding
        float len = size + sl * aSpr.w;
        // head sits at the particle, the tail trails behind along -velocity
        mv.xy += dirP * (c.x * size) + dirA * (c.y * len - len + size);
      }
    } else if (mode < 2.5) {
      vec3 n = normalize(aVel.xyz);
      vec3 t2;
      vec3 t1 = perpBasis(n, t2);
      float r = aSpr.y + aSpr.z * age;
      float cs = cos(r), sn = sin(r);
      vec2 cr = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
      mv = viewMatrix * vec4(aPos.xyz + (t1 * cr.x + t2 * cr.y) * size, 1.0);
    } else {
      vec3 n = normalize(aVel.xyz);
      vec3 t2;
      vec3 t1 = perpBasis(n, t2);
      float ang = aSpr.y + aSpr.z * age;
      float rad = aSpr.w * exp(-aSize.w * age);
      vec3 wp = aPos.xyz + (t1 * cos(ang) + t2 * sin(ang)) * rad + n * (aSize.z * age);
      mv = viewMatrix * vec4(wp, 1.0);
      energy = vfxMinSize(size, -mv.z, 1.5);
      mv.xy += c * size;
    }
    gl_Position = projectionMatrix * mv;

    float fin = aFade.x > 0.0 ? smoothstep(0.0, aFade.x, a) : 1.0;
    float fout = 1.0 - smoothstep(aFade.y, 1.0, a);
    float dist = length(mv.xyz);
    float nearFade = smoothstep(0.25, 1.1, -mv.z);   // never flood the eye
    vec3 col = aCol.rgb;
    if (aFade.z > 0.0) {
      float lum = max(col.r, max(col.g, col.b));
      col = mix(vec3(lum), col, smoothstep(0.0, aFade.z, a));
    }
    vCol = vec4(col, aCol.a * energy * fin * fout * nearFade * vfxFog(dist));
    vAdd = aFade.w;
    vStreak = vec3(c, (mode > 0.5 && mode < 1.5) ? 1.0 : 0.0);
    vec2 cell = vec2(mod(spr, ${ATLAS_COLS.toFixed(1)}), floor(spr / ${ATLAS_COLS.toFixed(1)}));
    vUv = (cell + c * 0.5 + 0.5) / vec2(${ATLAS_COLS.toFixed(1)}, ${ATLAS_ROWS.toFixed(1)});
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec4 vCol;
  varying float vAdd;
  varying vec3 vStreak;
  void main() {
    float m;
    if (vStreak.z > 0.5) {
      // thin streaks: analytic coverage (a texture would mip away across the width)
      float along = clamp(vStreak.y * 0.5 + 0.5, 0.0, 1.0);   // 0 tail → 1 head
      m = exp(-vStreak.x * vStreak.x * 5.0) * along * along * (1.0 - smoothstep(0.85, 1.0, along));
    } else m = texture2D(uAtlas, vUv).r;
    m *= vCol.a;
    if (m < 0.002) discard;
    gl_FragColor = vec4(vCol.rgb * m, m * (1.0 - vAdd));
  }
`;

export class GpuParticles {
  readonly brush = new Brush();
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private buf: THREE.InstancedInterleavedBuffer;
  private data: Float32Array;
  private cursor = 0;
  private dirtyStart = -1;   // first slot written this frame
  private dirtyCount = 0;    // slots written this frame (may wrap)
  private time = 0;
  private fullUpload = false;  // clear() rewrote everything → next upload is the whole buffer
  readonly capacity: number;

  constructor(scene: THREE.Scene, capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    // every particle starts long dead: spawn time far in the past, life 0
    for (let i = 0; i < capacity; i++) this.data[i * STRIDE + 3] = -1e6;
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const names = ['aPos', 'aVel', 'aSize', 'aCol', 'aSpr', 'aFade'];
    names.forEach((n, i) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4)));
    geo.instanceCount = capacity;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAtlas: { value: vfxAtlas() }, uFogDensity: { value: 0 }, uPxWorld: { value: 0.002 } },
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    });
    applyPremulBlend(this.mat);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;       // after the world's transparent surfaces
    bindFog(this.mesh, this.mat.uniforms as { uFogDensity: { value: number }; uPxWorld: { value: number } });
    this.mesh.onAfterRender = () => this.uploaded();
    scene.add(this.mesh);
  }

  /** seconds on the particle clock (spawn times are relative to it) */
  get now() { return this.time; }

  /** write one particle using the current brush */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    const b = this.brush;
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    if (this.dirtyStart < 0) this.dirtyStart = i;
    if (this.dirtyCount < this.capacity) this.dirtyCount++;
    const d = this.data, o = i * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = this.time + b.delay;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = Math.max(0.01, life);
    d[o + 8] = size; d[o + 9] = size * b.grow; d[o + 10] = b.grav; d[o + 11] = b.drag;
    d[o + 12] = b.color.r; d[o + 13] = b.color.g; d[o + 14] = b.color.b; d[o + 15] = b.alpha;
    d[o + 16] = b.sprite + b.mode * 16; d[o + 17] = b.rot; d[o + 18] = b.spin; d[o + 19] = b.stretch;
    d[o + 20] = b.fadeIn; d[o + 21] = b.fadeOut; d[o + 22] = b.hot; d[o + 23] = b.additive;
  }

  /**
   * Advance the clock and queue this frame's newly written slots for upload.
   * Ranges accumulate until the renderer uploads them (three clears them after
   * upload), so several updates between two renders never lose writes.
   */
  update(dt: number) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.dirtyStart < 0) return;
    const buf = this.buf;
    if (!this.fullUpload) {        // fullUpload: no ranges = whole-buffer upload
      const start = this.dirtyStart, n = this.dirtyCount;
      if (start + n <= this.capacity) buf.addUpdateRange(start * STRIDE, n * STRIDE);
      else {
        buf.addUpdateRange(start * STRIDE, (this.capacity - start) * STRIDE);
        buf.addUpdateRange(0, (start + n - this.capacity) * STRIDE);
      }
    }
    buf.needsUpdate = true;
    this.dirtyStart = -1;
    this.dirtyCount = 0;
  }

  /** kill everything (level change) */
  clear() {
    for (let i = 0; i < this.capacity; i++) this.data[i * STRIDE + 3] = -1e6;
    this.buf.clearUpdateRanges();
    this.buf.needsUpdate = true;
    this.fullUpload = true;
    this.dirtyStart = -1;
    this.dirtyCount = 0;
  }

  /** called once the renderer has consumed an upload (see onAfterRender) */
  private uploaded() { this.fullUpload = false; }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
