// Remote player avatars, enemies, and their VFX (telegraph flash, freeze tint,
// downed beacons). All positions come from server snapshots and are interpolated.
import * as THREE from 'three';
import type { EnemySnap, PlayerSnap } from '../shared/messages';
import { PALETTE } from '../shared/palette';
import { textSprite } from './world';
import { Interpolator } from './interp';
import type { DynamicLights, LightHandle } from './render/lights';

// ---------- peers ----------
class PeerAvatar {
  group = new THREE.Group();
  interp = new Interpolator();
  downed = false;
  private bubble?: THREE.Sprite;
  private bubbleUntil = 0;
  hpBar: THREE.Sprite;
  body: THREE.Mesh;
  private dl: LightHandle;
  echoGhost?: THREE.Mesh;
  accent: string;

  constructor(snap: PlayerSnap, private lights: DynamicLights) {
    this.accent = snap.accent || PALETTE.portalA;
    const mat = new THREE.MeshStandardMaterial({ color: '#d8d3e0', roughness: 0.6, emissive: this.accent, emissiveIntensity: 0.25 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 12), mat);
    this.body.position.y = 0.85;
    this.body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshStandardMaterial({ color: this.accent, emissive: this.accent, emissiveIntensity: 0.9 }));
    head.position.y = 1.55;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    visor.position.set(0, 1.57, -0.18);
    const name = textSprite(snap.name, this.accent, 0.42);
    name.position.y = 2.15;
    this.hpBar = makeBar(this.accent);
    this.hpBar.position.y = 1.95;
    this.dl = lights.register(PALETTE.hostile, { intensity: 0, range: 8, priority: 2 });
    this.group.add(this.body, head, visor, name, this.hpBar);
    this.group.position.set(...snap.p);
    this.interp.push(snap.p, snap.yaw);
  }

  dispose() { this.lights.unregister(this.dl); }

  apply(snap: PlayerSnap) {
    this.interp.push(snap.p, snap.yaw);
    setBar(this.hpBar, snap.hp / 100);
    const downed = snap.state === 'downed';
    this.downed = downed;
    this.dl.intensity = downed ? 3 : 0;
    (this.body.material as THREE.MeshStandardMaterial).emissive.set(downed ? PALETTE.hostile : this.accent);
    this.body.rotation.x = downed ? Math.PI / 2 : 0;
    this.body.position.y = downed ? 0.4 : 0.85;
  }

  say(text: string) {
    if (this.bubble) this.group.remove(this.bubble);
    this.bubble = bubbleSprite(text);
    this.bubble.position.y = 2.6;
    this.group.add(this.bubble);
    this.bubbleUntil = performance.now() + 4500 + text.length * 40;
  }

  update(dt: number) {
    const s = this.interp.sample(this.group.position);
    if (s) this.group.rotation.y = s.yaw;
    if (this.downed) this.dl.pos.copy(this.group.position).setY(this.group.position.y + 1);
    if (this.bubble && performance.now() > this.bubbleUntil) {
      this.group.remove(this.bubble);
      this.bubble = undefined;
    }
  }
}

function bubbleSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = '500 30px "Segoe UI", system-ui, sans-serif';
  const short = text.length > 60 ? text.slice(0, 58) + '…' : text;
  const w = Math.min(560, Math.max(120, ctx.measureText(short).width + 44));
  c.width = 576; c.height = 96;
  ctx.font = '500 30px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const x0 = (c.width - w) / 2;
  ctx.fillStyle = 'rgba(16,14,28,0.88)';
  ctx.strokeStyle = 'rgba(170,160,230,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x0, 14, w, 60, 14);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();          // little tail
  ctx.moveTo(c.width / 2 - 8, 74); ctx.lineTo(c.width / 2, 90); ctx.lineTo(c.width / 2 + 8, 74);
  ctx.fillStyle = 'rgba(16,14,28,0.88)';
  ctx.fill();
  ctx.fillStyle = '#efeaf8';
  ctx.fillText(short, c.width / 2, 45, w - 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(3.2, 0.53, 1);
  return sp;
}

const BAR_W = 320, BAR_H = 44;
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
function makeBar(color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = BAR_W; c.height = BAR_H;
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.3, 0.18, 1);
  sp.userData = { canvas: c, tex, color };
  return sp;
}
function setBar(sp: THREE.Sprite, pct: number) {
  const { canvas, tex, color } = sp.userData as { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; color: string };
  const ctx = canvas.getContext('2d')!;
  const p = Math.max(0, Math.min(1, pct));
  ctx.clearRect(0, 0, BAR_W, BAR_H);
  // rounded dark track with border
  ctx.fillStyle = 'rgba(8,7,16,0.72)';
  roundRect(ctx, 2, 2, BAR_W - 4, BAR_H - 4, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(180,170,230,0.35)'; ctx.lineWidth = 3;
  roundRect(ctx, 2, 2, BAR_W - 4, BAR_H - 4, 18); ctx.stroke();
  // gradient fill
  const w = (BAR_W - 20) * p;
  if (w > 1) {
    const g = ctx.createLinearGradient(10, 0, 10 + w, 0);
    const col = new THREE.Color(color);
    g.addColorStop(0, `#${col.clone().offsetHSL(0, 0, -0.12).getHexString()}`);
    g.addColorStop(1, `#${col.clone().offsetHSL(0, 0, 0.12).getHexString()}`);
    ctx.fillStyle = g;
    roundRect(ctx, 10, 10, w, BAR_H - 20, 12); ctx.fill();
  }
  tex.needsUpdate = true;
}

export class Peers {
  private map = new Map<string, PeerAvatar>();
  constructor(private scene: THREE.Scene, private selfId: () => string, private lights: DynamicLights) {}

  sync(snaps: PlayerSnap[]) {
    const seen = new Set<string>();
    for (const s of snaps) {
      if (s.id === this.selfId()) continue;
      seen.add(s.id);
      let a = this.map.get(s.id);
      if (!a) { a = new PeerAvatar(s, this.lights); this.map.set(s.id, a); this.scene.add(a.group); }
      a.apply(s);
    }
    for (const [id, a] of this.map) {
      if (!seen.has(id)) { a.dispose(); this.scene.remove(a.group); this.map.delete(id); }
    }
  }
  remove(id: string) {
    const a = this.map.get(id);
    if (a) { a.dispose(); this.scene.remove(a.group); this.map.delete(id); }
  }
  update(dt: number) { for (const a of this.map.values()) a.update(dt); }
  say(id: string, text: string) { this.map.get(id)?.say(text); }
  positionOf(id: string): THREE.Vector3 | undefined { return this.map.get(id)?.group.position; }
  clear() { for (const [id] of this.map) this.remove(id); }
  /** downed peers for revive prompts */
  entries() { return this.map.entries(); }
}

// ---------- ping markers ("look here") ----------
export class Pings {
  private list: { group: THREE.Group; until: number; ring: THREE.Mesh }[] = [];
  constructor(private scene: THREE.Scene) {}
  add(pos: [number, number, number], accent: string) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 8, 28),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, 5, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 2.5;
    const light = new THREE.PointLight(accent, 2, 8);
    light.position.y = 1;
    g.add(ring, beam, light);
    g.position.set(...pos);
    this.scene.add(g);
    this.list.push({ group: g, until: performance.now() + 4000, ring });
  }
  update(dt: number) {
    const now = performance.now();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const left = (p.until - now) / 4000;
      if (left <= 0) { this.scene.remove(p.group); this.list.splice(i, 1); continue; }
      p.ring.scale.setScalar(1 + Math.sin(now * 0.008) * 0.18);
      p.group.children.forEach((c) => {
        const m = (c as THREE.Mesh).material as THREE.Material & { opacity?: number };
        if (m && 'opacity' in m) m.opacity = Math.min(1, left * 2) * ((c as THREE.Mesh).geometry?.type === 'TorusGeometry' ? 0.9 : 0.4);
      });
    }
  }
  clear() { for (const p of this.list) this.scene.remove(p.group); this.list.length = 0; }
}

// ---------- echo ghosts (Echo Core skill) ----------
export class Echoes {
  private map = new Map<string, THREE.Mesh>();
  constructor(private scene: THREE.Scene) {}
  sync(snaps: PlayerSnap[]) {
    const seen = new Set<string>();
    for (const s of snaps) {
      if (!s.echo) continue;
      seen.add(s.id);
      let m = this.map.get(s.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 12),
          new THREE.MeshStandardMaterial({
            color: s.accent || PALETTE.portalA, emissive: s.accent || PALETTE.portalA,
            emissiveIntensity: 0.8, transparent: true, opacity: 0.35, depthWrite: false,
          }));
        this.map.set(s.id, m);
        this.scene.add(m);
      }
      m.position.set(s.echo[0], s.echo[1] + 0.85, s.echo[2]);
    }
    for (const [id, m] of this.map) {
      if (!seen.has(id)) { this.scene.remove(m); this.map.delete(id); }
    }
  }
  clear() { for (const [id, m] of this.map) { this.scene.remove(m); this.map.delete(id); } }
}

// ---------- enemies ----------
const HOSTILE = new THREE.Color(PALETTE.hostile);
const ICE = new THREE.Color('#bfe8ff');

interface EnemyBuild { core: THREE.Mesh; parts: THREE.Object3D[]; height: number }

/** Detailed, layered enemy models — faceted bodies, emissive cores, orbiting
 *  parts. `bodyMats`/`glowMats` collect the materials the state machine recolours;
 *  `spinners` collect groups that rotate each frame. */
function buildEnemy(
  type: string,
  bodyMats: THREE.MeshStandardMaterial[],
  glowMats: THREE.MeshStandardMaterial[],
  spinners: THREE.Object3D[],
): EnemyBuild {
  const bodyMat = () => {
    const m = new THREE.MeshStandardMaterial({
      color: '#3f3b57', roughness: 0.42, metalness: 0.35,
      emissive: HOSTILE, emissiveIntensity: 0.55, flatShading: true,
    });
    bodyMats.push(m);
    return m;
  };
  const glowMat = () => {
    const m = new THREE.MeshStandardMaterial({
      color: PALETTE.hostile, emissive: PALETTE.hostile, emissiveIntensity: 1.5, roughness: 0.3,
    });
    glowMats.push(m);
    return m;
  };
  const auraMat = () => new THREE.MeshBasicMaterial({
    color: PALETTE.hostile, transparent: true, opacity: 0.07, side: THREE.BackSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const parts: THREE.Object3D[] = [];

  if (type === 'drifter') {
    const body = bodyMat(), glow = glowMat();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), body);
    core.position.y = 1.15;
    const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), glow);
    inner.position.y = 1.15; parts.push(inner);
    const aura = new THREE.Mesh(new THREE.IcosahedronGeometry(0.74, 1), auraMat());
    aura.position.y = 1.15; parts.push(aura);
    const orbit = new THREE.Group(); orbit.position.y = 1.15; orbit.userData.spin = 1.6;
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.14), glow);
      const a = (i / 3) * Math.PI * 2;
      shard.position.set(Math.cos(a) * 0.66, Math.sin(a * 1.3) * 0.18, Math.sin(a) * 0.66);
      orbit.add(shard);
    }
    spinners.push(orbit); parts.push(orbit);
    return { core, parts, height: 1.6 };
  }

  if (type === 'warden') {
    const body = bodyMat(), glow = glowMat();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.74, 1.5, 6), body);
    core.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), body);
    head.position.y = 2.0; parts.push(head);
    for (const side of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.66), body);
      sh.position.set(side * 0.72, 1.6, 0); sh.rotation.z = side * 0.35; parts.push(sh);
    }
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.12), glow);
    slit.position.set(0, 1.2, -0.56); parts.push(slit);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 6, 16), glow);
    crown.position.y = 2.0; crown.rotation.x = Math.PI / 2; parts.push(crown);
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 2.1, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: PALETTE.portalA, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
    shield.position.y = 1.1; shield.name = 'shield'; parts.push(shield);
    return { core, parts, height: 2.2 };
  }

  if (type === 'sower') {
    const body = bodyMat(), glow = glowMat();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), body);
    core.position.y = 0.95;
    const maw = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.11, 8, 18), glow);
    maw.position.y = 0.95; maw.rotation.x = Math.PI / 2; parts.push(maw);
    const sac = new THREE.Mesh(new THREE.SphereGeometry(0.74, 16, 12), auraMat());
    sac.position.y = 0.95; parts.push(sac);
    const spin = new THREE.Group(); spin.position.y = 0.95; spin.userData.spin = 0.9;
    for (let i = 0; i < 8; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 6), body);
      const a = (i / 8) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62);
      spike.rotation.z = -Math.PI / 2; spike.rotation.y = -a;
      spin.add(spike);
    }
    spinners.push(spin); parts.push(spin);
    return { core, parts, height: 1.4 };
  }

  // colossus
  const body = bodyMat(), glow = glowMat();
  const core = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.2), body);
  core.position.y = 1.75;
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.4), body);
  base.position.y = 0.5; parts.push(base);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), body);
  head.position.y = 2.95; parts.push(head);
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.1), glow);
  eye.position.set(0, 2.98, -0.42); parts.push(eye);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.5), body);
    arm.position.set(side * 1.15, 1.7, 0); parts.push(arm);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.62), body);
    fist.position.set(side * 1.15, 0.85, 0); parts.push(fist);
  }
  // glowing cracks down the torso
  for (let i = 0; i < 3; i++) {
    const crack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.06), glow);
    crack.position.set((i - 1) * 0.4, 1.7, -0.61); crack.rotation.z = (i - 1) * 0.12; parts.push(crack);
  }
  const heartMat = glowMat();
  const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.46), heartMat);
  heart.position.set(0, 1.95, -0.62); heart.name = 'heart'; parts.push(heart);
  const heartRing = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.06, 8, 20), body);
  heartRing.position.set(0, 1.95, -0.5); parts.push(heartRing);
  return { core, parts, height: 3.4 };
}

class EnemyVis {
  group = new THREE.Group();
  interp = new Interpolator();
  hasTarget = false;
  core: THREE.Mesh;
  private bodyMats: THREE.MeshStandardMaterial[] = [];   // recoloured to show state
  private glowMats: THREE.MeshStandardMaterial[] = [];   // hostile accent, iced on freeze
  private spinners: THREE.Object3D[] = [];               // parts that rotate each frame
  hpBar: THREE.Sprite;
  private lh: LightHandle;
  telegraphT = 0;
  dead = false;
  frozen = false;
  fade = 1;
  height: number;

  constructor(snap: EnemySnap, private lights: DynamicLights) {
    const b = buildEnemy(snap.type, this.bodyMats, this.glowMats, this.spinners);
    this.core = b.core;
    this.height = b.height;
    this.core.castShadow = true;
    this.hpBar = makeBar(PALETTE.hostile);
    this.hpBar.position.y = this.height + 0.5;
    this.lh = lights.register(PALETTE.hostile, { intensity: 0.8, range: 7, priority: 2 });
    this.group.add(this.core, this.hpBar, ...b.parts);
    this.group.position.set(...snap.p);
    this.interp.push(snap.p, snap.yaw);
  }

  dispose() { this.lights.unregister(this.lh); }

  apply(snap: EnemySnap) {
    this.interp.push(snap.p, snap.yaw);
    this.hasTarget = !!snap.target && snap.state !== 'down' && snap.state !== 'frozen';
    setBar(this.hpBar, snap.hp / snap.maxHp);
    this.dead = snap.state === 'down';
    this.frozen = snap.state === 'frozen';
    for (const m of this.bodyMats) {
      if (snap.state === 'frozen') { m.emissive.copy(ICE); m.emissiveIntensity = 1.0; m.color.set('#9fc8e0'); }
      else if (snap.state === 'staggered') { m.emissive.set('#ffffff'); m.emissiveIntensity = 0.9; m.color.set('#6a6480'); }
      else { m.emissive.copy(HOSTILE); m.color.set('#3f3b57'); m.emissiveIntensity = this.dead ? 0 : 0.55; }
    }
    for (const m of this.glowMats) {
      if (snap.state === 'frozen') { m.emissive.copy(ICE); m.color.set('#bfe8ff'); m.emissiveIntensity = 1.4; }
      else { m.emissive.copy(HOSTILE); m.color.set(PALETTE.hostile); m.emissiveIntensity = this.dead ? 0 : 1.6; }
    }
    const shield = this.group.getObjectByName('shield') as THREE.Mesh | undefined;
    if (shield) shield.visible = snap.state !== 'staggered' && snap.state !== 'down' && snap.state !== 'frozen';
  }

  update(dt: number, time: number) {
    const s = this.interp.sample(this.group.position);
    if (s) this.group.rotation.y = s.yaw;
    this.lh.pos.copy(this.group.position).setY(this.group.position.y + this.height * 0.55);
    if (!this.dead && !this.frozen) for (const sp of this.spinners) sp.rotation.y += dt * sp.userData.spin;
    if (this.telegraphT > 0) {
      this.telegraphT = Math.max(0, this.telegraphT - dt);
      const flash = 0.5 + Math.sin(time * 24) * 0.5;
      this.lh.intensity = 0.8 + flash * 4;
      this.lh.color.set(PALETTE.hostile);
      for (const m of this.bodyMats) m.emissiveIntensity = 0.55 + flash * 1.8;
    } else if (!this.dead) {
      this.lh.intensity = 0.8;
      this.lh.color.set(this.frozen ? '#9fdcff' : PALETTE.hostile);
    }
    if (this.dead && this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt * 0.8);
      this.group.scale.setScalar(0.2 + this.fade * 0.8);
      this.lh.intensity = 0;
      this.hpBar.visible = false;
      this.group.visible = this.fade > 0.05;
    } else if (!this.dead) {
      this.group.visible = true;
      this.group.scale.setScalar(1);
      this.fade = 1;
      this.hpBar.visible = true;
      this.core.position.y += Math.sin(time * 2 + this.group.position.x) * 0.002;
    }
  }
}

export class Enemies {
  private map = new Map<string, EnemyVis>();
  private time = 0;
  constructor(private scene: THREE.Scene, private lights: DynamicLights) {}

  sync(snaps: EnemySnap[]) {
    const seen = new Set<string>();
    for (const s of snaps) {
      seen.add(s.id);
      let v = this.map.get(s.id);
      if (!v) { v = new EnemyVis(s, this.lights); this.map.set(s.id, v); this.scene.add(v.group); }
      v.apply(s);
    }
    for (const [id, v] of this.map) {
      if (!seen.has(id)) { v.dispose(); this.scene.remove(v.group); this.map.delete(id); }
    }
  }
  telegraph(id: string, ms: number) {
    const v = this.map.get(id);
    if (v) v.telegraphT = ms / 1000;
  }
  positionOf(id: string): THREE.Vector3 | undefined {
    const v = this.map.get(id);
    if (!v) return undefined;
    return v.group.position.clone().setY(v.group.position.y + v.height / 2);
  }
  meshEntries(): { id: string; obj: THREE.Object3D; height: number; dead: boolean }[] {
    return [...this.map.entries()].map(([id, v]) => ({ id, obj: v.group, height: v.height, dead: v.dead }));
  }
  /** positions of aggroed enemies — drives ember-trail particles */
  aggroPositions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const v of this.map.values()) {
      if (v.hasTarget && !v.dead) out.push(v.group.position.clone().setY(v.group.position.y + v.height * 0.6));
    }
    return out;
  }
  anyAggro(selfPos: THREE.Vector3): boolean {
    for (const v of this.map.values()) {
      if (!v.dead && v.group.position.distanceTo(selfPos) < 18) return true;
    }
    return false;
  }
  update(dt: number) {
    this.time += dt;
    for (const v of this.map.values()) v.update(dt, this.time);
  }
  clear() {
    for (const [id, v] of this.map) { v.dispose(); this.scene.remove(v.group); this.map.delete(id); }
  }
}
