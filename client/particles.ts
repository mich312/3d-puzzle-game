// Particle front-end. All effects run on the GPU (client/vfx/):
//  - pool: one instanced, closed-form-animated particle buffer (single draw call,
//    zero per-particle CPU per frame; slots are written once at spawn)
//  - fx: the effects library (impacts, frost, portals, deaths, revive, pickups…)
//  - atmosphere: per-world ambient motes wrapped around the viewer
// The legacy spawn/burst/motes/ambient API is kept for existing call sites.
import * as THREE from 'three';
import type { DynamicLights } from './render/lights';
import type { QualitySpec } from './render/quality';
import { GpuParticles } from './vfx/gpuParticles';
import { Effects } from './vfx/effects';
import { Atmosphere } from './vfx/atmosphere';
import { SPR } from './vfx/sprites';

const CAPACITY = 4096;

export class Particles {
  readonly pool: GpuParticles;
  readonly fx: Effects;
  readonly atmosphere: Atmosphere;
  private ambientShown = false;
  private tmp = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, lights?: DynamicLights) {
    this.pool = new GpuParticles(scene, CAPACITY);
    this.fx = new Effects(this.pool, lights);
    this.atmosphere = new Atmosphere(scene);
  }

  setQuality(q: QualitySpec) {
    this.fx.setTier(q.tier, q.projectileLights);
    this.atmosphere.setDensity(q.tier === 'high' ? 1 : q.tier === 'medium' ? 0.6 : 0.35);
  }

  setReduceMotion(on: boolean) { this.atmosphere.reduceMotion = on; }

  /** single glowing particle (legacy API) */
  spawn(x: number, y: number, z: number, color: string | number,
    vx = 0, vy = 0, vz = 0, life = 1, opts: { drag?: number; grav?: number } = {}) {
    this.fx.mote(x, y, z, color, vx, vy, vz, life, opts.drag ?? 0.5, opts.grav ?? 0);
  }

  /** radial burst (legacy API) — now velocity-stretched sparks + a soft flash */
  burst(p: THREE.Vector3 | [number, number, number], color: string, n = 14, speed = 3.5, life = 0.7) {
    const v = Array.isArray(p) ? this.tmp.set(p[0], p[1], p[2]) : this.tmp.copy(p);
    this.fx.glow(v, color, 0.3, 2.2, 0.15, 1.8);
    this.fx.sparks(v, this.up, color, n, [speed * 0.4, speed * 1.2], 2.5, [life * 0.5, life * 1.2], 2.2, -4);
  }

  /** slow rising motes at a point (portals, pedestals) */
  motes(x: number, y: number, z: number, color: string) {
    const b = this.pool.brush.reset();
    b.color.set(color).multiplyScalar(1.7);
    b.sprite = SPR.glow; b.drag = 0.05; b.fadeIn = 0.25; b.fadeOut = 0.55;
    this.pool.emit(
      x + (Math.random() - 0.5) * 1.6, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 1.6,
      (Math.random() - 0.5) * 0.15, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.15,
      2.5 + Math.random() * 2, 0.035 + Math.random() * 0.03);
  }

  /** per-world ambient atmosphere around the viewer; call each frame it should show */
  ambient(world: string, viewer: THREE.Vector3, dt: number) {
    this.atmosphere.setWorld(world);
    this.atmosphere.visible = true;
    this.atmosphere.update(dt, viewer);
    this.ambientShown = true;
  }

  update(dt: number) {
    if (!this.ambientShown && this.atmosphere.visible) {
      this.atmosphere.visible = false;
      this.atmosphere.update(0, this.tmp.set(0, 0, 0));
    }
    this.ambientShown = false;
    this.fx.update(dt);
    this.pool.update(dt);
  }

  /** drop every live particle (level change) */
  clear() {
    this.pool.clear();
    this.fx.clear();
  }

  dispose() {
    this.pool.dispose();
    this.atmosphere.dispose();
  }
}
