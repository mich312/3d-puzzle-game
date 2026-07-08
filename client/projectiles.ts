// Traveling device projectiles: pooled glowing orbs that fly muzzle→target,
// each carrying a dynamic light that sweeps the environment, an additive trail,
// and a bright impact flash + particle burst on arrival. Purely cosmetic — the
// server still validates the hit instantly; the orb is fast enough (~70 m/s)
// that the feedback still reads as immediate.
import * as THREE from 'three';
import { Particles } from './particles';
import { DynamicLights, LightHandle } from './render/lights';

interface Shot {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  trail: THREE.Line;
  trailPts: THREE.Vector3[];
  from: THREE.Vector3;
  to: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  travelled: number;
  speed: number;
  color: THREE.Color;
  light: LightHandle | null;
  active: boolean;
}

interface Flash { handle: LightHandle; ttl: number; max: number }

function glowSprite(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Projectiles {
  private shots: Shot[] = [];
  private flashes: Flash[] = [];
  private glowTex = glowSprite();
  private useLights = true;

  constructor(private scene: THREE.Scene, private particles: Particles, private lights: DynamicLights) {}

  setQuality(projectileLights: boolean) { this.useLights = projectileLights; }

  private make(): Shot {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9,
    }));
    glow.scale.setScalar(0.8);
    mesh.add(glow);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(mesh, trail);
    return {
      mesh, glow, trail, trailPts: [], from: new THREE.Vector3(), to: new THREE.Vector3(),
      dir: new THREE.Vector3(), dist: 0, travelled: 0, speed: 70, color: new THREE.Color(), light: null, active: false,
    };
  }

  fire(from: [number, number, number] | THREE.Vector3, to: [number, number, number], color: string, opts: { speed?: number; scale?: number } = {}) {
    let s = this.shots.find((x) => !x.active);
    if (!s) { s = this.make(); this.shots.push(s); }
    if (Array.isArray(from)) s.from.set(from[0], from[1], from[2]);
    else s.from.copy(from);
    s.to.set(to[0], to[1], to[2]);
    s.dir.copy(s.to).sub(s.from);
    s.dist = s.dir.length();
    s.dir.normalize();
    s.travelled = 0;
    s.speed = opts.speed ?? 70;
    s.color.set(color);
    s.active = true;
    s.mesh.visible = true;
    s.mesh.position.copy(s.from);
    s.mesh.scale.setScalar(opts.scale ?? 1);
    (s.mesh.material as THREE.MeshBasicMaterial).color.copy(s.color).lerp(new THREE.Color('#ffffff'), 0.5);
    (s.glow.material as THREE.SpriteMaterial).color.copy(s.color);
    (s.trail.material as THREE.LineBasicMaterial).color.copy(s.color);
    s.trailPts = [s.from.clone()];
    if (this.useLights && !s.light) s.light = this.lights.register(color, { intensity: 2.4, range: 8, priority: 3 });
    else if (!this.useLights && s.light) { this.lights.unregister(s.light); s.light = null; }
    if (s.light) { s.light.color.set(color); s.light.pos.copy(s.from); s.light.intensity = 2.4; }
  }

  update(dt: number) {
    for (const s of this.shots) {
      if (!s.active) continue;
      s.travelled += s.speed * dt;
      const done = s.travelled >= s.dist;
      const t = done ? s.dist : s.travelled;
      s.mesh.position.copy(s.from).addScaledVector(s.dir, t);
      if (s.light) s.light.pos.copy(s.mesh.position);
      // trail
      s.trailPts.push(s.mesh.position.clone());
      if (s.trailPts.length > 8) s.trailPts.shift();
      const attr = s.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < 8; i++) {
        const p = s.trailPts[Math.min(i, s.trailPts.length - 1)] ?? s.mesh.position;
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      attr.needsUpdate = true;
      // faint spark shed along the path
      if (Math.random() < dt * 30)
        this.particles.spawn(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z, `#${s.color.getHexString()}`,
          (Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5), 0.4, { drag: 3 });
      if (done) this.impact(s);
    }
    // impact flashes fade out
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.ttl -= dt;
      f.handle.intensity = Math.max(0, (f.ttl / f.max) * 5);
      if (f.ttl <= 0) { this.lights.unregister(f.handle); this.flashes.splice(i, 1); }
    }
  }

  private impact(s: Shot) {
    s.active = false;
    s.mesh.visible = false;
    const attr = s.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 8; i++) attr.setXYZ(i, s.to.x, s.to.y, s.to.z);
    attr.needsUpdate = true;
    this.particles.burst(s.to, `#${s.color.getHexString()}`, 12, 3.2, 0.5);
    if (s.light) { s.light.intensity = 0; }
    if (this.useLights) {
      const flash = this.lights.register(`#${s.color.getHexString()}`, { intensity: 5, range: 10, priority: 4 });
      flash.pos.copy(s.to);
      this.flashes.push({ handle: flash, ttl: 0.22, max: 0.22 });
    }
  }

  clear() {
    for (const s of this.shots) {
      s.active = false; s.mesh.visible = false;
      if (s.light) { this.lights.unregister(s.light); s.light = null; }
    }
    for (const f of this.flashes) this.lights.unregister(f.handle);
    this.flashes.length = 0;
  }
}
