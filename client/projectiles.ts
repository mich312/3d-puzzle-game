// Traveling device projectiles: pooled ray-marched plasma orbs that fly
// muzzle→target with a tapered ribbon trail (pooled beam), a light that sweeps
// the environment, shed sparks / ice glitter, and a full impact effect on
// arrival (sparks + shock ring + light flash, or a frost burst for the freeze
// ray). Purely cosmetic — the server validates the hit instantly; the orb is
// fast enough (~50–70 m/s) that the feedback still reads as immediate.
//
// Nothing here allocates per shot: shots, trails and light handles are pooled
// and re-used; impact light flashes use the effects library's pooled handles.
import * as THREE from 'three';
import { markShared } from './render/dispose';
import { Particles } from './particles';
import { DynamicLights, LightHandle } from './render/lights';
import { makeProjectileMaterial } from './render/projectileMaterial';
import { Beams, type Beam } from './vfx/beams';
import { SPR } from './vfx/sprites';

export type ProjectileKind = 'pulse' | 'freeze';

interface Shot {
  mesh: THREE.Mesh;                       // ray-marched volumetric billboard
  mat: THREE.ShaderMaterial;
  baseSize: number;
  trail: Beam | null;
  trailLen: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  travelled: number;
  speed: number;
  age: number;
  color: THREE.Color;
  hex: string;
  kind: ProjectileKind;
  light: LightHandle | null;
  active: boolean;
  shed: number;                           // spark-shedding accumulator (frame-rate independent)
}

// one shared unit quad — the vertex shader billboards + scales it per-draw
const QUAD = new THREE.PlaneGeometry(2, 2);
markShared(QUAD);

export class Projectiles {
  private shots: Shot[] = [];
  private useLights = true;
  private seed = 0.123;
  private beams: Beams;
  private tA = new THREE.Vector3();
  private tB = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private particles: Particles, private lights: DynamicLights) {
    this.beams = new Beams(scene);
  }

  setQuality(projectileLights: boolean) {
    this.useLights = projectileLights;
    if (!projectileLights) {
      for (const s of this.shots) if (s.light) { this.lights.unregister(s.light); s.light = null; }
    }
  }

  private make(): Shot {
    const mat = makeProjectileMaterial();
    const mesh = new THREE.Mesh(QUAD, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 22;
    mesh.visible = false;
    this.scene.add(mesh);
    return {
      mesh, mat, baseSize: 0.42, trail: null, trailLen: 2, from: new THREE.Vector3(), to: new THREE.Vector3(),
      dir: new THREE.Vector3(), dist: 0, travelled: 0, speed: 70, age: 0, color: new THREE.Color(), hex: '#ffffff',
      kind: 'pulse', light: null, active: false, shed: 0,
    };
  }

  fire(from: [number, number, number] | THREE.Vector3, to: [number, number, number], color: string,
    opts: { speed?: number; scale?: number; kind?: ProjectileKind } = {}) {
    let s = this.shots.find((x) => !x.active);
    if (!s) { s = this.make(); this.shots.push(s); }
    if (Array.isArray(from)) s.from.set(from[0], from[1], from[2]);
    else s.from.copy(from);
    s.to.set(to[0], to[1], to[2]);
    s.dir.copy(s.to).sub(s.from);
    s.dist = s.dir.length();
    if (s.dist < 1e-3) s.dir.set(0, 0, -1); else s.dir.divideScalar(s.dist);
    s.travelled = 0;
    s.age = 0;
    s.shed = 0;
    s.speed = opts.speed ?? 70;
    s.kind = opts.kind ?? 'pulse';
    s.color.set(color);
    s.hex = color;
    s.active = true;
    s.mesh.visible = true;
    s.mesh.position.copy(s.from);
    s.baseSize = (s.kind === 'freeze' ? 0.34 : 0.3) * (opts.scale ?? 1);
    this.seed = (this.seed * 7.13 + 0.371) % 1;   // vary the plasma per shot
    s.mat.uniforms.uColor.value.copy(s.color);
    s.mat.uniforms.uSize.value = s.baseSize;
    s.mat.uniforms.uSeed.value = this.seed * 10;
    // trail ribbon (pooled beam, re-aimed every frame)
    if (s.trail) this.beams.release(s.trail);
    s.trail = this.beams.acquire(s.kind === 'freeze' ? 'ice' : 'trail');
    s.trail.u.uColor.value.copy(s.color);
    s.trail.u.uWidth.value.set(0.004, s.kind === 'freeze' ? 0.085 : 0.07);
    s.trailLen = s.kind === 'freeze' ? 4.5 : 3;
    Beams.aimStraight(s.trail, s.from, s.from);
    this.particles.fx.muzzle(s.from, s.dir, color);
    // per-shot light: handle kept with the pooled shot, never re-registered per fire
    if (this.useLights && !s.light) s.light = this.lights.register(color, { intensity: 2.2, range: 8, priority: 3 });
    if (s.light) { s.light.color.set(color); s.light.pos.copy(s.from); s.light.intensity = 2.2; }
  }

  update(dt: number) {
    for (const s of this.shots) {
      if (!s.active) continue;
      const prev = s.travelled;
      s.travelled += s.speed * dt;
      s.age += dt;
      const done = s.travelled >= s.dist;
      const t = done ? s.dist : s.travelled;
      s.mesh.position.copy(s.from).addScaledVector(s.dir, t);
      // animate the volume + a subtle pulse
      s.mat.uniforms.uTime.value = s.age;
      s.mat.uniforms.uSize.value = s.baseSize * (1 + Math.sin(s.age * 40) * 0.06);
      if (s.light) s.light.pos.copy(s.mesh.position);
      // trail: straight tapered ribbon from the tail to the head (shots fly straight)
      if (s.trail) {
        const tail = Math.max(0, t - s.trailLen);
        this.tA.copy(s.from).addScaledVector(s.dir, tail);
        Beams.aimStraight(s.trail, this.tA, s.mesh.position);
      }
      this.shed(s, prev, t, dt);
      if (done) this.impact(s);
    }
    this.beams.update(dt);
  }

  /** spawn along the path just travelled, at a fixed rate per second */
  private shed(s: Shot, a: number, b: number, dt: number) {
    const rate = s.kind === 'freeze' ? 70 : 40;
    s.shed += rate * dt * this.particles.fx.scale;
    const pool = this.particles.pool;
    const br = pool.brush;
    while (s.shed >= 1) {
      s.shed -= 1;
      const d = a + Math.random() * (b - a);
      const p = this.tB.copy(s.from).addScaledVector(s.dir, d);
      if (s.kind === 'freeze') {
        br.reset();
        const glint = Math.random() < 0.4;
        br.sprite = glint ? SPR.flare : SPR.crystal;
        br.color.set(glint ? '#ffffff' : '#cdefff').multiplyScalar(glint ? 2 : 1.4);
        br.drag = 2.5; br.grav = -1.2; br.rot = Math.random() * 6.28; br.spin = (Math.random() - 0.5) * 8;
        br.fadeOut = 0.35;
        pool.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.8, (Math.random() - 0.3) * 0.6, (Math.random() - 0.5) * 0.8,
          0.5 + Math.random() * 0.6, 0.03 + Math.random() * 0.04);
      } else {
        br.reset();
        br.sprite = SPR.ember; br.color.copy(s.color).multiplyScalar(1.8);
        br.drag = 3; br.hot = 0.3; br.fadeOut = 0.3;
        pool.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2,
          0.25 + Math.random() * 0.25, 0.025 + Math.random() * 0.02);
      }
    }
  }

  private impact(s: Shot) {
    s.active = false;
    s.mesh.visible = false;
    if (s.trail) {
      // let the trail collapse onto the impact point over a short fade
      s.trail.ttl = s.trail.max = 0.12;
      s.trail = null;
    }
    if (s.light) s.light.intensity = 0;
    const back = this.tA.copy(s.dir).negate();
    if (s.kind === 'freeze') this.particles.fx.frostBurst(s.to, back, s.hex);
    else this.particles.fx.impact(s.to, back, s.hex);
  }

  clear() {
    for (const s of this.shots) {
      s.active = false; s.mesh.visible = false; s.trail = null;
      if (s.light) { this.lights.unregister(s.light); s.light = null; }
    }
    this.beams.clear();
  }

  dispose() {
    this.clear();
    for (const s of this.shots) { s.mesh.removeFromParent(); s.mat.dispose(); }
    this.shots.length = 0;
    this.beams.dispose();
  }
}
