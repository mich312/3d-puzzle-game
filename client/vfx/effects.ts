// VFX library: every one-shot effect in the game, authored as short recipes on
// top of the GPU particle pool (+ pooled light flashes). Counts scale with the
// quality tier; nothing here allocates per call.
//
// Bloom convention (renderer): only pre-tonemap luminance > ~1 blooms, so hot
// cores / sparks sit at 1.5–3, halos, rings and smoke stay below ~1.2.
import * as THREE from 'three';
import type { DynamicLights, LightHandle } from '../render/lights';
import { GpuParticles, MODE } from './gpuParticles';
import { SPR } from './sprites';

type V3 = THREE.Vector3 | readonly [number, number, number];
const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** a handful of light handles registered ONCE and re-used for every flash */
class FlashLights {
  private slots: { h: LightHandle; ttl: number; max: number; peak: number }[] = [];
  enabled = true;
  constructor(lights: DynamicLights | undefined, n: number) {
    if (!lights) return;
    for (let i = 0; i < n; i++) {
      this.slots.push({ h: lights.register('#ffffff', { intensity: 0, range: 8, priority: 4 }), ttl: 0, max: 1, peak: 0 });
    }
  }
  flash(p: THREE.Vector3, color: THREE.Color, peak: number, range: number, dur: number) {
    if (!this.enabled || !this.slots.length) return;
    // free slot, else the one closest to finishing
    let best = this.slots[0];
    for (const s of this.slots) if (s.ttl <= 0 || s.ttl < best.ttl) { best = s; if (s.ttl <= 0) break; }
    best.h.pos.copy(p);
    best.h.color.copy(color);
    best.h.range = range;
    best.ttl = best.max = dur;
    best.peak = peak;
    best.h.intensity = peak;
  }
  update(dt: number) {
    for (const s of this.slots) {
      if (s.ttl <= 0) continue;
      s.ttl -= dt;
      const f = Math.max(0, s.ttl / s.max);
      s.h.intensity = s.ttl > 0 ? s.peak * f * f : 0;
    }
  }
  clear() { for (const s of this.slots) { s.ttl = 0; s.h.intensity = 0; } }
}

export class Effects {
  private c = new THREE.Color();
  private c2 = new THREE.Color();
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  private t1 = new THREE.Vector3();
  private t2 = new THREE.Vector3();
  private flashes: FlashLights;
  /** particle count multiplier for the quality tier */
  scale = 1;

  constructor(private pool: GpuParticles, lights?: DynamicLights) {
    this.flashes = new FlashLights(lights, 4);
  }

  setTier(tier: 'low' | 'medium' | 'high', lightsOn: boolean) {
    this.scale = tier === 'low' ? 0.45 : tier === 'medium' ? 0.75 : 1;
    this.flashes.enabled = lightsOn;
    if (!lightsOn) this.flashes.clear();
  }

  update(dt: number) { this.flashes.update(dt); }
  clear() { this.flashes.clear(); }

  private cnt(n: number) { return Math.max(1, Math.round(n * this.scale)); }
  private vec(p: V3, out = this.v) {
    return Array.isArray(p) ? out.set(p[0], p[1], p[2]) : out.copy(p as THREE.Vector3);
  }
  /** random unit vector in the hemisphere around n (cosine-ish), into out */
  private hemi(n: THREE.Vector3, spread: number, out: THREE.Vector3) {
    out.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
    if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
    out.normalize().multiplyScalar(spread).add(n).normalize();
    return out;
  }
  private light(p: THREE.Vector3, color: THREE.ColorRepresentation, peak: number, range: number, dur: number) {
    this.c2.set(color);
    this.flashes.flash(p, this.c2, peak, range, dur);
  }

  // ---------------------------------------------------------------- primitives

  /** simple glow puff at a point (flash core) */
  glow(p: THREE.Vector3, color: THREE.ColorRepresentation, size: number, grow: number, life: number, intensity: number) {
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(intensity);
    b.sprite = SPR.glow; b.grow = grow; b.fadeOut = 0.1; b.hot = 0.5;
    this.pool.emit(p.x, p.y, p.z, 0, 0, 0, life, size);
  }

  /** expanding ring; normal=null → camera facing */
  ring(p: THREE.Vector3, normal: THREE.Vector3 | null, color: THREE.ColorRepresentation, r0: number, r1: number, life: number, intensity: number, delay = 0) {
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(intensity);
    b.sprite = SPR.ring; b.grow = r1 / Math.max(0.001, r0); b.fadeOut = 0.25; b.delay = delay;
    if (normal) { b.mode = MODE.plane; this.pool.emit(p.x, p.y, p.z, normal.x, normal.y, normal.z, life, r0); }
    else this.pool.emit(p.x, p.y, p.z, 0, 0, 0, life, r0);
  }

  /** velocity-stretched spark spray around direction n */
  sparks(p: THREE.Vector3, n: THREE.Vector3, color: THREE.ColorRepresentation, count: number, speed: [number, number], spread: number, life: [number, number], intensity = 2.4, grav = -9) {
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(intensity);
    b.sprite = SPR.streak; b.mode = MODE.streak; b.stretch = 0.05; b.grav = grav; b.drag = 2.2;
    b.hot = 0.2; b.fadeOut = 0.4; b.grow = 0.6;
    const d = this.t1;
    for (let i = 0, N = this.cnt(count); i < N; i++) {
      this.hemi(n, spread, d);
      const s = rnd(speed[0], speed[1]);
      this.pool.emit(p.x, p.y, p.z, d.x * s, d.y * s, d.z * s, rnd(life[0], life[1]), rnd(0.03, 0.05));
    }
  }

  /** soft alpha smoke / dust / mist puffs */
  puffs(p: THREE.Vector3, color: THREE.ColorRepresentation, count: number, size: number, grow: number, life: number, alpha: number, speed = 0.6, rise = 0.3, spreadR = 0.15) {
    const b = this.pool.brush.reset();
    b.color.set(color);
    b.sprite = SPR.smoke; b.additive = 0; b.alpha = alpha; b.grow = grow; b.drag = 1.8;
    b.fadeIn = 0.08; b.fadeOut = 0.35; b.spin = rnd(-0.6, 0.6); b.grav = 0;
    for (let i = 0, N = this.cnt(count); i < N; i++) {
      const a = Math.random() * TAU;
      b.rot = Math.random() * TAU;
      b.spin = rnd(-0.8, 0.8);
      this.pool.emit(p.x + Math.cos(a) * spreadR, p.y + rnd(-0.05, 0.1), p.z + Math.sin(a) * spreadR,
        Math.cos(a) * speed * rnd(0.4, 1), rise * rnd(0.5, 1.2), Math.sin(a) * speed * rnd(0.4, 1),
        life * rnd(0.75, 1.25), size * rnd(0.8, 1.2));
    }
  }

  /** particles spiralling around axis n (radius decays by `drag`, negative expands) */
  spiral(p: THREE.Vector3, n: THREE.Vector3, color: THREE.ColorRepresentation, count: number, radius: number, angSpeed: number, rise: number, drag: number, life: number, size: number, intensity: number, sprite: number = SPR.glow, stagger = 0, height = 0) {
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(intensity);
    b.sprite = sprite; b.mode = MODE.orbit; b.grav = rise; b.drag = drag;
    b.spin = angSpeed; b.stretch = radius; b.fadeIn = 0.12; b.fadeOut = 0.55;
    for (let i = 0, N = this.cnt(count); i < N; i++) {
      b.rot = (i / N) * TAU + rnd(-0.2, 0.2);
      b.stretch = radius * rnd(0.8, 1.15);
      b.delay = stagger * (i / N);
      const h = height * Math.random();
      this.pool.emit(p.x + n.x * h, p.y + n.y * h, p.z + n.z * h, n.x, n.y, n.z, life * rnd(0.8, 1.2), 1.6 * size * rnd(0.7, 1.3));
    }
  }

  /** point-cloud of slowly drifting motes (rising: positive vy) */
  motes(p: THREE.Vector3, color: THREE.ColorRepresentation, count: number, r: number, vy: number, life: number, size: number, intensity: number, sprite: number = SPR.glow, stagger = 0) {
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(intensity);
    b.sprite = sprite; b.drag = 0.3; b.fadeIn = 0.2; b.fadeOut = 0.5;
    for (let i = 0, N = this.cnt(count); i < N; i++) {
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * r;
      b.delay = Math.random() * stagger;
      this.pool.emit(p.x + Math.cos(a) * rr, p.y + rnd(-0.2, 0.3), p.z + Math.sin(a) * rr,
        rnd(-0.15, 0.15), vy * rnd(0.6, 1.3), rnd(-0.15, 0.15), life * rnd(0.7, 1.3), 1.6 * size * rnd(0.7, 1.3));
    }
  }

  // ---------------------------------------------------------------- effects

  /** device muzzle flash: hot core, forward spark cone, tiny ring */
  muzzle(pos: V3, dir: THREE.Vector3, color: string) {
    const p = this.vec(pos);
    // the muzzle sits ~0.5 m from the eye: keep it small and brief
    this.glow(p, color, 0.07, 1.8, 0.07, 2.2);
    this.sparks(p, dir, color, 5, [3, 6], 0.35, [0.06, 0.12], 1.8, -2);
    this.ring(p, dir, color, 0.03, 0.12, 0.1, 0.9);
    this.light(p, color, 1.8, 5, 0.08);
  }

  /** pulse impact: flash, spark burst, shock ring, embers, smoke wisp, light */
  impact(pos: V3, normal: THREE.Vector3, color: string) {
    const n = this.n.copy(normal).normalize();
    const p = this.vec(pos).addScaledVector(n, 0.12);   // lift camera-facing parts off the surface
    this.glow(p, color, 0.22, 2.4, 0.1, 2.2);
    this.sparks(p, n, color, 18, [3.5, 9], 1.3, [0.22, 0.5], 2.0);
    this.ring(this.t2.copy(p).addScaledVector(n, -0.1), n, color, 0.12, 1.5, 0.32, 1.0);
    this.ring(p, null, color, 0.1, 0.7, 0.15, 0.6);
    // floating embers
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(2); b.sprite = SPR.ember; b.drag = 2.5; b.grav = -1.2; b.hot = 0.2; b.fadeOut = 0.3;
    for (let i = 0, N = this.cnt(6); i < N; i++) {
      this.hemi(n, 1.2, this.t1);
      const s = rnd(0.8, 2.2);
      this.pool.emit(p.x, p.y, p.z, this.t1.x * s, this.t1.y * s + 0.6, this.t1.z * s, rnd(0.6, 1.1), rnd(0.05, 0.08));
    }
    this.puffs(p, '#8a8494', 2, 0.22, 3.5, 0.9, 0.22, 0.35, 0.35, 0.05);
    this.light(p, color, 5, 10, 0.22);
  }

  /** freeze impact: frost crystals, mist, icy ring, lingering glitter */
  frostBurst(pos: V3, normal: THREE.Vector3, color = '#9fdcff', big = false) {
    const n = this.n.copy(normal).normalize();
    const p = this.vec(pos).addScaledVector(n, 0.12);
    const k = big ? 1.6 : 1;
    this.glow(p, color, 0.3 * k, 2.5, 0.16, 2.2);
    this.ring(p, n, '#d8f2ff', 0.1, 1.3 * k, 0.4, 1.2);
    const b = this.pool.brush.reset();
    b.color.set('#cdefff').multiplyScalar(1.8); b.sprite = SPR.crystal; b.drag = 2.2; b.grav = -5; b.fadeOut = 0.55;
    for (let i = 0, N = this.cnt(16 * k); i < N; i++) {
      this.hemi(n, 1.3, this.t1);
      const s = rnd(1.6, 5) * k;
      b.rot = Math.random() * TAU; b.spin = rnd(-8, 8);
      this.pool.emit(p.x, p.y, p.z, this.t1.x * s, this.t1.y * s + 0.8, this.t1.z * s, rnd(0.55, 1.0), rnd(0.08, 0.14) * k);
    }
    // glitter that hangs in the air
    b.reset(); b.color.set('#ffffff').multiplyScalar(2.2); b.sprite = SPR.flare; b.drag = 3; b.grav = -0.3;
    b.fadeIn = 0.1; b.fadeOut = 0.3;
    for (let i = 0, N = this.cnt(10 * k); i < N; i++) {
      this.hemi(n, 1.6, this.t1);
      const s = rnd(0.5, 2.2);
      b.rot = Math.random() * TAU;
      this.pool.emit(p.x, p.y, p.z, this.t1.x * s, this.t1.y * s, this.t1.z * s, rnd(0.8, 1.6), rnd(0.07, 0.12));
    }
    this.puffs(p, '#b9d8ee', 3 * k, 0.3 * k, 3, 1.1, 0.26, 0.6, 0.15, 0.1);
    this.light(p, color, 4, 9, 0.3);
  }

  /** enemy frozen solid: frost gathers inward, a cold ring */
  frozen(pos: V3) {
    const p = this.vec(pos);
    this.spiral(this.t2.set(p.x, p.y - 0.8, p.z), this.n.set(0, 1, 0), '#bfe8ff', 20, 1.2, 3.5, 0.2, 2.2, 0.8, 0.06, 1.6, SPR.crystal, 0, 1.6);
    this.ring(p, this.n.set(0, 1, 0), '#bfe8ff', 1.4, 0.4, 0.45, 1.1);
    this.puffs(p, '#c8e2f4', 3, 0.35, 2.4, 1.2, 0.22, 0.3, 0.1, 0.4);
    this.light(p, '#9fdcff', 3, 8, 0.3);
  }

  /** frozen enemy shatters: heavy falling ice + glitter + mist */
  shatter(pos: V3) {
    const p = this.vec(pos);
    this.frostBurst(p, this.n.set(0, 1, 0), '#bfe8ff', true);
    const b = this.pool.brush.reset();
    b.color.set('#e4f6ff').multiplyScalar(1.3); b.sprite = SPR.crystal; b.drag = 0.6; b.grav = -12; b.fadeOut = 0.7;
    for (let i = 0, N = this.cnt(22); i < N; i++) {
      const a = Math.random() * TAU, s = rnd(2, 6);
      b.rot = Math.random() * TAU; b.spin = rnd(-10, 10);
      this.pool.emit(p.x + rnd(-0.4, 0.4), p.y + rnd(-0.6, 0.6), p.z + rnd(-0.4, 0.4),
        Math.cos(a) * s, rnd(1.5, 5), Math.sin(a) * s, rnd(0.9, 1.5), rnd(0.12, 0.22));
    }
  }

  /** enemy defeated: ember burst + rising ash (pairs with the dissolve shader) */
  enemyDeath(pos: V3, color = '#e0654a') {
    const p = this.vec(pos);
    this.glow(p, color, 0.5, 2.6, 0.2, 2.2);
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(2.4); b.sprite = SPR.ember; b.drag = 1.6; b.grav = -2.5; b.hot = 0.25; b.fadeOut = 0.35;
    for (let i = 0, N = this.cnt(26); i < N; i++) {
      this.hemi(this.n.set(0, 1, 0), 1.6, this.t1);
      const s = rnd(1.5, 5.5);
      this.pool.emit(p.x + rnd(-0.3, 0.3), p.y + rnd(-0.5, 0.5), p.z + rnd(-0.3, 0.3),
        this.t1.x * s, this.t1.y * s, this.t1.z * s, rnd(0.6, 1.4), rnd(0.06, 0.1));
    }
    // dark ash flakes drifting up (alpha), staggered over the dissolve
    b.reset(); b.color.set('#2a2226'); b.sprite = SPR.smoke; b.additive = 0; b.alpha = 0.8; b.drag = 0.4;
    b.fadeIn = 0.15; b.fadeOut = 0.5; b.grow = 0.6;
    for (let i = 0, N = this.cnt(16); i < N; i++) {
      b.delay = rnd(0, 0.6); b.rot = Math.random() * TAU; b.spin = rnd(-3, 3);
      this.pool.emit(p.x + rnd(-0.5, 0.5), p.y + rnd(-0.8, 0.6), p.z + rnd(-0.5, 0.5),
        rnd(-0.3, 0.3), rnd(0.6, 1.4), rnd(-0.3, 0.3), rnd(1.6, 2.8), rnd(0.07, 0.12));
    }
    // glowing ash — cooling motes rising
    this.motes(p, color, 14, 0.6, 1.0, 2.2, 0.035, 1.6, SPR.ember, 0.6);
    this.ring(this.t2.set(p.x, p.y - 0.9, p.z), this.n.set(0, 1, 0), color, 0.3, 2.2, 0.5, 1.0);
    this.puffs(this.t2.set(p.x, p.y - 0.4, p.z), '#4a3a3e', 4, 0.4, 2.6, 1.4, 0.3, 0.5, 0.4, 0.3);
    this.light(p, color, 5, 10, 0.4);
  }

  /** placed portal: portal-coloured ring burst + inward spiral */
  portalPlaced(pos: V3, normal: V3, color: string) {
    const p = this.vec(pos);
    const n = this.vec(normal, this.n).normalize();
    this.ring(p, n, color, 0.15, 1.8, 0.45, 1.5);
    this.ring(p, n, color, 1.6, 0.85, 0.35, 1.0, 0.08);
    this.glow(p, color, 0.4, 2.8, 0.18, 1.8);
    // inward spiral, lifted slightly off the wall along the normal
    this.spiral(this.t2.copy(p).addScaledVector(n, 0.05), n, color, 26, 1.25, 6, 0, 3.2, 0.7, 0.045, 2.2, SPR.glow, 0.15);
    this.sparks(p, n, color, 10, [2, 5], 0.9, [0.2, 0.4], 2.0, -3);
    this.light(p, color, 3.5, 8, 0.35);
  }

  /** portal traversal flash at the exit */
  portalTraverse(pos: V3, color: string) {
    const p = this.vec(pos);
    this.glow(p, color, 0.6, 3.5, 0.25, 1.6);
    this.ring(p, null, color, 0.4, 2.6, 0.4, 1.0);
    this.ring(this.t2.set(p.x, p.y - 0.95, p.z), this.n.set(0, 1, 0), color, 0.3, 2.2, 0.5, 1.2);
    this.sparks(p, this.n.set(0, 1, 0), color, 16, [2, 6], 2.0, [0.3, 0.6], 2.0, -4);
    this.spiral(this.t2.set(p.x, p.y - 0.9, p.z), this.n.set(0, 1, 0), color, 16, 0.9, 4, 1.6, -0.3, 1.0, 0.04, 2.0);
    this.light(p, color, 4, 9, 0.4);
  }

  /** player downed: a sinking ring and slow falling motes */
  downed(pos: V3) {
    const p = this.vec(pos);
    const up = this.n.set(0, 1, 0);
    this.ring(this.t2.set(p.x, p.y + 0.05, p.z), up, '#ff7a6a', 0.3, 2.4, 0.9, 1.1);
    this.ring(this.t2.set(p.x, p.y + 0.05, p.z), up, '#ff7a6a', 0.2, 1.6, 0.9, 0.8, 0.25);
    this.motes(this.t2.set(p.x, p.y + 1.2, p.z), '#ff9a8a', 12, 0.6, -0.35, 1.6, 0.04, 1.4, SPR.glow);
  }

  /** player revived: mint rings + rising spiral motes */
  revive(pos: V3, color = '#a8f0c6') {
    const p = this.vec(pos);
    const up = this.n.set(0, 1, 0);
    this.ring(this.t2.set(p.x, p.y + 0.05, p.z), up, color, 0.3, 2.2, 0.6, 1.3);
    this.ring(this.t2.set(p.x, p.y + 0.05, p.z), up, color, 0.2, 1.6, 0.6, 1.0, 0.15);
    this.spiral(this.t2.set(p.x, p.y + 0.1, p.z), up, color, 30, 0.7, 3.2, 1.3, 0.35, 1.5, 0.05, 2.2, SPR.glow, 0.5, 0.8);
    this.motes(this.t2.set(p.x, p.y + 0.6, p.z), color, 14, 0.5, 0.9, 1.4, 0.04, 1.8, SPR.flare, 0.4);
    this.glow(this.t2.set(p.x, p.y + 1.0, p.z), color, 0.3, 2.0, 0.25, 1.0);
    this.light(this.t2.set(p.x, p.y + 1.0, p.z), color, 4, 8, 0.5);
  }

  /** collectible picked up: golden sparkle swirl rising into the player */
  pickup(pos: V3, color = '#ffd98a') {
    const p = this.vec(pos);
    const up = this.n.set(0, 1, 0);
    this.glow(p, color, 0.3, 2.8, 0.2, 2.0);
    this.spiral(this.t2.copy(p).setY(p.y - 0.4), up, color, 24, 0.6, 5, 1.4, 0.9, 0.9, 0.05, 2.4, SPR.flare, 0.3, 0.7);
    this.sparks(p, up, '#fff1c8', 10, [1.5, 3.5], 1.6, [0.3, 0.6], 2.2, -3);
    this.light(p, color, 3, 7, 0.3);
  }

  /** checkpoint reached: wide mint ground ring + a rising column of motes */
  checkpoint(pos: V3, color = '#a8f0c6') {
    const p = this.vec(pos);
    const up = this.n.set(0, 1, 0);
    this.ring(this.t2.set(p.x, p.y + 0.06, p.z), up, color, 0.4, 3.6, 0.9, 1.2);
    this.ring(this.t2.set(p.x, p.y + 0.06, p.z), up, color, 0.3, 2.6, 0.9, 0.8, 0.2);
    this.spiral(this.t2.set(p.x, p.y + 0.1, p.z), up, color, 28, 1.4, 1.6, 2.2, 0.25, 1.6, 0.05, 1.8, SPR.glow, 0.6, 1.2);
    this.light(this.t2.set(p.x, p.y + 1.0, p.z), color, 3, 9, 0.6);
  }

  /** shard gained: golden burst, radial rays, rising spiral (spawned ~3 m ahead of the eye) */
  shardGained(pos: V3, color = '#ffd98a') {
    const p = this.vec(pos);
    this.glow(p, color, 0.3, 2.4, 0.3, 1.3);
    this.ring(p, null, color, 0.2, 1.6, 0.55, 0.7);
    this.ring(p, null, '#fff1c8', 0.12, 1.1, 0.45, 0.5, 0.12);
    // rays: slow, heavily stretched streaks that retract as they decelerate
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(1.1); b.sprite = SPR.streak; b.mode = MODE.streak;
    b.stretch = 0.3; b.drag = 2.6; b.fadeIn = 0.05; b.fadeOut = 0.3; b.hot = 0.2;
    for (let i = 0, N = this.cnt(12); i < N; i++) {
      const a = (i / N) * TAU + rnd(-0.1, 0.1), e = rnd(-0.6, 0.6);
      const s = rnd(2, 3.2);
      this.pool.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, rnd(0.6, 0.9), 0.025);
    }
    this.sparks(p, this.n.set(0, 1, 0), '#ffe6a8', 28, [2.5, 7], 2.2, [0.4, 0.9], 1.6, -5);
    this.spiral(this.t2.set(p.x, p.y - 1.0, p.z), this.n.set(0, 1, 0), color, 30, 1.0, 4, 1.8, 0.3, 1.8, 0.04, 1.8, SPR.flare, 0.6, 0.6);
    this.light(p, color, 5, 12, 0.7);
  }

  /** local player arrived (level join / own portal traverse): kept away from the eye */
  arrival(feet: V3, color: string) {
    const p = this.vec(feet);
    const up = this.n.set(0, 1, 0);
    this.ring(this.t2.set(p.x, p.y + 0.05, p.z), up, color, 0.8, 3.0, 0.6, 0.7);
    this.ring(this.t2.set(p.x, p.y + 0.05, p.z), up, color, 0.6, 2.2, 0.6, 0.45, 0.15);
    // a loose ring of motes rising around (not onto) the player
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(1.8); b.sprite = SPR.glow; b.drag = 0.4; b.fadeIn = 0.2; b.fadeOut = 0.5;
    for (let i = 0, N = this.cnt(22); i < N; i++) {
      const a = Math.random() * TAU, r = rnd(1.6, 2.8);
      b.delay = rnd(0, 0.3);
      this.pool.emit(p.x + Math.cos(a) * r, p.y + rnd(0, 0.6), p.z + Math.sin(a) * r, 0, rnd(0.8, 1.6), 0, rnd(1.0, 1.6), rnd(0.03, 0.05));
    }
    this.light(this.t2.set(p.x, p.y + 1, p.z), color, 2, 8, 0.4);
  }

  /** landing dust: low radial puffs at the feet */
  landing(pos: V3, strength: number, tint = '#8e8a9c') {
    const p = this.vec(pos);
    const s = Math.min(1, Math.max(0.2, strength));
    this.puffs(this.t2.set(p.x, p.y + 0.06, p.z), tint, Math.round(4 + 5 * s), 0.08 + 0.06 * s, 3.0, 0.6, 0.2 * s, 1.4 + 1.4 * s, 0.2, 0.25);
  }

  /** a single glowing mote (legacy spawn API: portal motes, aggro embers…) */
  mote(x: number, y: number, z: number, color: THREE.ColorRepresentation, vx: number, vy: number, vz: number, life: number, drag: number, grav: number, size = 0.05, intensity = 1.6) {
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(intensity); b.sprite = SPR.glow; b.drag = drag; b.grav = grav;
    b.fadeIn = 0.15; b.fadeOut = 0.55;
    this.pool.emit(x, y, z, vx, vy, vz, life, size);
  }
}
