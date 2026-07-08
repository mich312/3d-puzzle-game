// Pooled particle system: one THREE.Points pool drives every effect —
// impact bursts, shatters, portal motes, and per-world ambient weather
// (vault snow, garden pollen, observatory stardust). CPU-integrated;
// budget ~1600 particles, far below frame cost at this scale.
import * as THREE from 'three';

const MAX = 1600;

interface P { life: number; maxLife: number; vx: number; vy: number; vz: number; drag: number; grav: number }

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class Particles {
  private points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private meta: P[] = new Array(MAX);
  private cursor = 0;
  private ambientAcc = 0;
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) this.meta[i] = { life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, drag: 0, grav: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.14, map: dotTexture(), vertexColors: true, transparent: true,
      opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x: number, y: number, z: number, color: string | number,
    vx = 0, vy = 0, vz = 0, life = 1, opts: { drag?: number; grav?: number } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    const m = this.meta[i];
    m.life = life; m.maxLife = life;
    m.vx = vx; m.vy = vy; m.vz = vz;
    m.drag = opts.drag ?? 0.5;
    m.grav = opts.grav ?? 0;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.tmpColor.set(color);
    this.col[i * 3] = this.tmpColor.r; this.col[i * 3 + 1] = this.tmpColor.g; this.col[i * 3 + 2] = this.tmpColor.b;
  }

  /** radial burst — impacts, shatters, revives */
  burst(p: THREE.Vector3 | [number, number, number], color: string, n = 14, speed = 3.5, life = 0.7) {
    const [x, y, z] = Array.isArray(p) ? p : [p.x, p.y, p.z];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, z, color,
        Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + speed * 0.3, Math.sin(a) * Math.cos(b) * s,
        life * (0.6 + Math.random() * 0.8), { drag: 2, grav: -4 });
    }
  }

  /** slow rising motes at a point (portals, pedestals) */
  motes(x: number, y: number, z: number, color: string) {
    this.spawn(
      x + (Math.random() - 0.5) * 1.6, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 1.6,
      color, (Math.random() - 0.5) * 0.15, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.15,
      2.5 + Math.random() * 2, { drag: 0.05 });
  }

  /** per-world ambient weather around the viewer */
  ambient(world: string, viewer: THREE.Vector3, dt: number) {
    this.ambientAcc += dt;
    const interval = world === 'vaults' ? 0.03 : 0.06;
    while (this.ambientAcc > interval) {
      this.ambientAcc -= interval;
      const r = 6 + Math.random() * 22;
      const a = Math.random() * Math.PI * 2;
      const x = viewer.x + Math.cos(a) * r;
      const z = viewer.z + Math.sin(a) * r;
      switch (world) {
        case 'vaults':   // snowfall
          this.spawn(x, viewer.y + 6 + Math.random() * 5, z, '#cfe0f5',
            (Math.random() - 0.5) * 0.3, -1.1 - Math.random() * 0.5, (Math.random() - 0.5) * 0.3,
            7, { drag: 0.02 });
          break;
        case 'gardens':  // drifting pollen
          this.spawn(x, viewer.y + Math.random() * 5, z, '#ffe9b8',
            0.4 + Math.random() * 0.3, (Math.random() - 0.3) * 0.25, (Math.random() - 0.5) * 0.3,
            6, { drag: 0.01 });
          break;
        case 'observatory': // stardust
          this.spawn(x, viewer.y + Math.random() * 8, z, '#c9befc',
            (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.1,
            8, { drag: 0 });
          break;
        default:         // nexus/atrium: faint cool motes
          if (Math.random() < 0.4)
            this.spawn(x, viewer.y + Math.random() * 6, z, '#9aa8d8',
              (Math.random() - 0.5) * 0.1, 0.12 + Math.random() * 0.1, (Math.random() - 0.5) * 0.1,
              7, { drag: 0 });
      }
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      const m = this.meta[i];
      if (m.life <= 0) continue;
      m.life -= dt;
      if (m.life <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      m.vy += m.grav * dt;
      const d = Math.max(0, 1 - m.drag * dt);
      m.vx *= d; m.vy *= m.grav !== 0 ? 1 : d; m.vz *= d;
      this.pos[i * 3] += m.vx * dt;
      this.pos[i * 3 + 1] += m.vy * dt;
      this.pos[i * 3 + 2] += m.vz * dt;
      const f = m.life / m.maxLife;
      const fade = f < 0.3 ? f / 0.3 : 1;
      this.col[i * 3] *= 0.999; // slight cool-down of colour over time
      if (fade < 1) {
        // fade by darkening (additive blending → dark = invisible)
        this.col[i * 3] *= 0.94; this.col[i * 3 + 1] *= 0.94; this.col[i * 3 + 2] *= 0.94;
      }
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
