// Remote player avatars, enemies, and their VFX (telegraph flash, freeze tint,
// downed beacons). All positions come from server snapshots and are interpolated.
import * as THREE from 'three';
import type { EnemySnap, PlayerSnap } from '../shared/messages';
import { PALETTE } from '../shared/palette';
import { textSprite } from './world';

// ---------- peers ----------
class PeerAvatar {
  group = new THREE.Group();
  target = new THREE.Vector3();
  targetYaw = 0;
  downed = false;
  hpBar: THREE.Sprite;
  body: THREE.Mesh;
  downedLight: THREE.PointLight;
  echoGhost?: THREE.Mesh;
  accent: string;

  constructor(snap: PlayerSnap) {
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
    this.downedLight = new THREE.PointLight(PALETTE.hostile, 0, 8);
    this.downedLight.position.y = 1;
    this.group.add(this.body, head, visor, name, this.hpBar, this.downedLight);
    this.group.position.set(...snap.p);
    this.target.set(...snap.p);
  }

  apply(snap: PlayerSnap) {
    this.target.set(...snap.p);
    this.targetYaw = snap.yaw;
    setBar(this.hpBar, snap.hp / 100);
    const downed = snap.state === 'downed';
    this.downed = downed;
    this.downedLight.intensity = downed ? 3 : 0;
    (this.body.material as THREE.MeshStandardMaterial).emissive.set(downed ? PALETTE.hostile : this.accent);
    this.body.rotation.x = downed ? Math.PI / 2 : 0;
    this.body.position.y = downed ? 0.4 : 0.85;
  }

  update(dt: number) {
    this.group.position.lerp(this.target, Math.min(1, dt * 12));
    const dy = this.targetYaw - this.group.rotation.y;
    this.group.rotation.y += (((dy + Math.PI) % (Math.PI * 2)) - Math.PI + Math.PI * 2) % (Math.PI * 2) * Math.min(1, dt * 10) - 0;
    this.group.rotation.y = this.targetYaw; // simple: snap yaw (interp above is cosmetic)
  }
}

function makeBar(color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.2, 0.15, 1);
  sp.userData = { canvas: c, tex, color };
  return sp;
}
function setBar(sp: THREE.Sprite, pct: number) {
  const { canvas, tex, color } = sp.userData as { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; color: string };
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 16);
  ctx.fillStyle = 'rgba(10,10,20,0.6)';
  ctx.fillRect(0, 0, 128, 16);
  ctx.fillStyle = color;
  ctx.fillRect(2, 2, Math.max(0, pct) * 124, 12);
  tex.needsUpdate = true;
}

export class Peers {
  private map = new Map<string, PeerAvatar>();
  constructor(private scene: THREE.Scene, private selfId: () => string) {}

  sync(snaps: PlayerSnap[]) {
    const seen = new Set<string>();
    for (const s of snaps) {
      if (s.id === this.selfId()) continue;
      seen.add(s.id);
      let a = this.map.get(s.id);
      if (!a) { a = new PeerAvatar(s); this.map.set(s.id, a); this.scene.add(a.group); }
      a.apply(s);
    }
    for (const [id, a] of this.map) {
      if (!seen.has(id)) { this.scene.remove(a.group); this.map.delete(id); }
    }
  }
  remove(id: string) {
    const a = this.map.get(id);
    if (a) { this.scene.remove(a.group); this.map.delete(id); }
  }
  update(dt: number) { for (const a of this.map.values()) a.update(dt); }
  positionOf(id: string): THREE.Vector3 | undefined { return this.map.get(id)?.group.position; }
  clear() { for (const [id] of this.map) this.remove(id); }
  /** downed peers for revive prompts */
  entries() { return this.map.entries(); }
}

// ---------- enemies ----------
const HOSTILE = new THREE.Color(PALETTE.hostile);
const ICE = new THREE.Color('#bfe8ff');

class EnemyVis {
  group = new THREE.Group();
  target = new THREE.Vector3();
  targetYaw = 0;
  core: THREE.Mesh;
  extra: THREE.Mesh[] = [];
  hpBar: THREE.Sprite;
  light: THREE.PointLight;
  telegraphT = 0;
  dead = false;
  fade = 1;
  height: number;

  constructor(snap: EnemySnap) {
    const mat = new THREE.MeshStandardMaterial({ color: '#4a4560', roughness: 0.5, emissive: HOSTILE, emissiveIntensity: 0.6 });
    this.height = 1.6;
    switch (snap.type) {
      case 'drifter': {
        this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), mat);
        this.core.position.y = 1.1;
        break;
      }
      case 'warden': {
        this.height = 2.2;
        this.core = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.7), mat);
        this.core.position.y = 1.1;
        const shield = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.0, 16, 1, true),
          new THREE.MeshBasicMaterial({ color: PALETTE.portalA, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        shield.position.y = 1.1; shield.name = 'shield';
        this.extra.push(shield);
        break;
      }
      case 'sower': {
        this.core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), mat);
        this.core.position.y = 0.9;
        for (let i = 0; i < 6; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), mat);
          const a = (i / 6) * Math.PI * 2;
          spike.position.set(Math.cos(a) * 0.6, 0.9, Math.sin(a) * 0.6);
          spike.rotation.z = -Math.PI / 2; spike.rotation.y = -a;
          this.extra.push(spike);
        }
        break;
      }
      default: { // colossus
        this.height = 3.4;
        this.core = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.8, 1.4), mat);
        this.core.position.y = 1.7;
        const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.4),
          new THREE.MeshStandardMaterial({ color: PALETTE.hostile, emissive: PALETTE.hostile, emissiveIntensity: 2.5 }));
        heart.position.set(0, 1.9, -0.8); heart.name = 'heart';
        this.extra.push(heart);
      }
    }
    this.core.castShadow = true;
    this.hpBar = makeBar(PALETTE.hostile);
    this.hpBar.position.y = this.height + 0.5;
    this.light = new THREE.PointLight(PALETTE.hostile, 0.8, 7);
    this.light.position.y = 1.2;
    this.group.add(this.core, this.hpBar, this.light, ...this.extra);
    this.group.position.set(...snap.p);
    this.target.set(...snap.p);
  }

  apply(snap: EnemySnap) {
    this.target.set(...snap.p);
    this.targetYaw = snap.yaw;
    setBar(this.hpBar, snap.hp / snap.maxHp);
    const mat = this.core.material as THREE.MeshStandardMaterial;
    this.dead = snap.state === 'down';
    if (snap.state === 'frozen') { mat.emissive.copy(ICE); mat.emissiveIntensity = 1.2; mat.color.set('#9fc8e0'); }
    else if (snap.state === 'staggered') { mat.emissive.set('#ffffff'); mat.emissiveIntensity = 1.0; }
    else { mat.emissive.copy(HOSTILE); mat.color.set('#4a4560'); mat.emissiveIntensity = this.dead ? 0 : 0.6; }
    const shield = this.group.getObjectByName('shield') as THREE.Mesh | undefined;
    if (shield) shield.visible = snap.state !== 'staggered' && snap.state !== 'down' && snap.state !== 'frozen';
  }

  update(dt: number, time: number) {
    this.group.position.lerp(this.target, Math.min(1, dt * 10));
    this.group.rotation.y = this.targetYaw;
    if (this.telegraphT > 0) {
      this.telegraphT = Math.max(0, this.telegraphT - dt);
      const flash = 0.5 + Math.sin(time * 24) * 0.5;
      this.light.intensity = 0.8 + flash * 4;
      (this.core.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + flash * 2;
    } else if (!this.dead) {
      this.light.intensity = 0.8;
    }
    if (this.dead && this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt * 0.8);
      this.group.scale.setScalar(0.2 + this.fade * 0.8);
      this.light.intensity = 0;
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
  constructor(private scene: THREE.Scene) {}

  sync(snaps: EnemySnap[]) {
    const seen = new Set<string>();
    for (const s of snaps) {
      seen.add(s.id);
      let v = this.map.get(s.id);
      if (!v) { v = new EnemyVis(s); this.map.set(s.id, v); this.scene.add(v.group); }
      v.apply(s);
    }
    for (const [id, v] of this.map) {
      if (!seen.has(id)) { this.scene.remove(v.group); this.map.delete(id); }
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
    for (const [id, v] of this.map) { this.scene.remove(v.group); this.map.delete(id); }
  }
}
