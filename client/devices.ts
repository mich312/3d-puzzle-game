// Client device handling: local cooldown/charge mirror for instant feel
// (server still validates), aim helpers, and beam/tracer VFX. Tracers and the
// curved tractor beam are pooled shader ribbons (client/vfx/beams.ts) — no
// geometry or material is created per shot.
import * as THREE from 'three';
import { DEVICES, type DeviceId } from '../shared/devices';
import type { Vec3 } from '../shared/level';
import { Beams } from './vfx/beams';
import { MODE } from './vfx/gpuParticles';
import { SPR } from './vfx/sprites';
import type { Particles } from './particles';

export class DeviceRig {
  equipped: DeviceId = 'pulse';
  owned: DeviceId[] = ['pulse'];
  private lastFire = new Map<DeviceId, number>();
  private charges = new Map<DeviceId, { n: number; lastRegen: number }>();
  private beams: Beams;
  private tA = new THREE.Vector3();
  private tB = new THREE.Vector3();
  private tC = new THREE.Vector3();
  private orbitAcc = 0;
  tractorActive = false;
  tractorTarget?: string;
  tractorDist = 6;
  chargeStart = 0;          // charged-pulse hold

  constructor(scene: THREE.Scene, private particles?: Particles) {
    this.beams = new Beams(scene);
    for (const d of Object.values(DEVICES)) {
      if (d.charges > 0) this.charges.set(d.id, { n: d.charges, lastRegen: performance.now() });
    }
  }

  setOwned(devices: DeviceId[]) {
    this.owned = devices;
    if (!devices.includes(this.equipped)) this.equipped = devices[0] ?? 'pulse';
  }

  canFire(d: DeviceId): boolean {
    const def = DEVICES[d];
    if (performance.now() - (this.lastFire.get(d) ?? 0) < def.cooldownMs) return false;
    if (def.charges > 0 && (this.charges.get(d)?.n ?? 0) <= 0) return false;
    return true;
  }
  markFired(d: DeviceId) {
    this.lastFire.set(d, performance.now());
    const def = DEVICES[d];
    if (def.charges > 0) {
      const c = this.charges.get(d)!;
      c.n = Math.max(0, c.n - 1);
      c.lastRegen = performance.now();
    }
  }
  cooldownPct(d: DeviceId): number {
    const def = DEVICES[d];
    return Math.min(1, (performance.now() - (this.lastFire.get(d) ?? 0)) / def.cooldownMs);
  }
  chargeText(d: DeviceId): string {
    const def = DEVICES[d];
    if (def.charges === 0) return '∞';
    return `${this.charges.get(d)?.n ?? 0}/${def.charges}`;
  }
  /** dt in seconds — charge regen stays on wall-clock ms exactly as before */
  update(dt = 1 / 60) {
    const now = performance.now();
    for (const [id, c] of this.charges) {
      const def = DEVICES[id];
      if (c.n < def.charges && now - c.lastRegen >= def.chargeRegenMs) { c.n++; c.lastRegen = now; }
    }
    this.beams.update(dt);
  }

  /** short fading beam (portal shots, remote devices). ttl in ms. */
  tracer(from: Vec3, to: Vec3, color: string, thick = 0.04, ttl = 140) {
    this.tA.set(from[0], from[1], from[2]);
    this.tB.set(to[0], to[1], to[2]);
    this.beams.tracer(this.tA, this.tB, color, thick * 1.6, ttl / 1000);
  }

  /**
   * Continuous curved tractor beam, re-aimed every frame while held. It leaves
   * the emitter along the aim direction and bends into the target (quadratic
   * Bézier), with an orbiting particle sheath and a grip glow at the target.
   * Call per frame; it fades out by itself once calls stop.
   */
  tractorBeam(key: string, from: THREE.Vector3, aimDir: THREE.Vector3 | Vec3, to: THREE.Vector3, color: string, dt: number) {
    const dir = Array.isArray(aimDir) ? this.tC.set(aimDir[0], aimDir[1], aimDir[2]) : this.tC.copy(aimDir as THREE.Vector3);
    const dist = from.distanceTo(to);
    const ctrl = this.tA.copy(from).addScaledVector(dir.normalize(), dist * 0.55);
    this.beams.hold(key, from, ctrl, to, color, 0.07, 0.15, 'tractor');
    const p = this.particles;
    if (!p) return;
    // orbiting sheath: a few particles per frame, rate fixed per second
    this.orbitAcc += dt * 45 * p.fx.scale;
    const pool = p.pool, b = pool.brush;
    while (this.orbitAcc >= 1) {
      this.orbitAcc -= 1;
      const t = 0.15 + Math.random() * 0.85;   // keep the sheath away from the emitter/eye
      // point + tangent on the curve
      const u = 1 - t;
      const q = this.tB.set(
        u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
        u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
        u * u * from.z + 2 * u * t * ctrl.z + t * t * to.z);
      const tx = 2 * u * (ctrl.x - from.x) + 2 * t * (to.x - ctrl.x);
      const ty = 2 * u * (ctrl.y - from.y) + 2 * t * (to.y - ctrl.y);
      const tz = 2 * u * (ctrl.z - from.z) + 2 * t * (to.z - ctrl.z);
      b.reset();
      b.color.set(color).multiplyScalar(2.0);
      b.sprite = SPR.glow; b.mode = MODE.orbit;
      b.stretch = 0.12 + Math.random() * 0.12; b.rot = Math.random() * 6.283; b.spin = 9 + Math.random() * 6;
      b.drag = -0.8; b.grav = 0; b.fadeIn = 0.2; b.fadeOut = 0.4;
      pool.emit(q.x, q.y, q.z, tx, ty, tz, 0.25 + Math.random() * 0.2, 0.025 + Math.random() * 0.02);
    }
    // grip at the target: slow inward swirl
    if (Math.random() < dt * 14) {
      p.fx.spiral(to, dir.set(0, 1, 0), color, 3, 0.7, 5, 0.2, 2.5, 0.5, 0.04, 2.0);
    }
  }

  clearVfx() { this.beams.clear(); }
}
