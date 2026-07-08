// Client device handling: local cooldown/charge mirror for instant feel
// (server still validates), aim helpers, and beam/tracer VFX.
import * as THREE from 'three';
import { DEVICES, type DeviceId } from '../shared/devices';
import type { Vec3 } from '../shared/level';

interface Tracer { mesh: THREE.Mesh; ttl: number; max: number }

export class DeviceRig {
  equipped: DeviceId = 'pulse';
  owned: DeviceId[] = ['pulse'];
  private lastFire = new Map<DeviceId, number>();
  private charges = new Map<DeviceId, { n: number; lastRegen: number }>();
  private tracers: Tracer[] = [];
  private group = new THREE.Group();
  tractorActive = false;
  tractorTarget?: string;
  tractorDist = 6;
  chargeStart = 0;          // charged-pulse hold

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
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
  update() {
    const now = performance.now();
    for (const [id, c] of this.charges) {
      const def = DEVICES[id];
      if (c.n < def.charges && now - c.lastRegen >= def.chargeRegenMs) { c.n++; c.lastRegen = now; }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.ttl -= 16;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.ttl / t.max) * 0.85;
      if (t.ttl <= 0) { this.group.remove(t.mesh); this.tracers.splice(i, 1); }
    }
  }

  tracer(from: Vec3, to: Vec3, color: string, thick = 0.04, ttl = 140) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    if (len < 0.01) return;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(thick, thick, len, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.group.add(mesh);
    this.tracers.push({ mesh, ttl, max: ttl });
  }
}
