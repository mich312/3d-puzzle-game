// Remote player avatars, enemies, echo ghosts and ping markers. All positions come
// from server snapshots and are interpolated; the models + procedural animation
// live in client/models/ (avatar.ts, enemies.ts), this file wires them to the net.
import * as THREE from 'three';
import { disposeObject } from './render/dispose';
import type { EnemySnap, PlayerSnap } from '../shared/messages';
import { PALETTE } from '../shared/palette';
import { Interpolator } from './interp';
import type { DynamicLights, LightHandle } from './render/lights';
import { buildAvatar, AvatarAnimator, type AvatarRig } from './models/avatar';
import { EnemyModel } from './models/enemies';
import { holoMat } from './models/common';
import { nameTag, makeBar, setBar, tickBar, bubbleSprite } from './models/labels';

export { setModelQuality } from './models/common';
export { buildAvatar } from './models/avatar';

// ---------- peers ----------
class PeerAvatar {
  group = new THREE.Group();
  interp = new Interpolator();
  downed = false;
  private bubble?: THREE.Sprite;
  private bubbleUntil = 0;
  hpBar: THREE.Sprite;
  private rig: AvatarRig;
  private anim: AvatarAnimator;
  private dl: LightHandle;
  accent: string;
  private vel = new THREE.Vector3();
  private grounded = true;
  private pitch = 0;
  private carrying = false;
  private wasDowned = false;

  constructor(snap: PlayerSnap, private lights: DynamicLights) {
    this.accent = snap.accent || PALETTE.portalA;
    this.rig = buildAvatar(this.accent);
    this.anim = new AvatarAnimator(this.rig);
    const name = nameTag(snap.name, this.accent, 0.17);
    name.position.y = 2.2;
    this.hpBar = makeBar(this.accent, 0.72);
    this.hpBar.position.y = 2.04;
    this.dl = lights.register(PALETTE.hostile, { intensity: 0, range: 8, priority: 2 });
    this.group.add(this.rig.root, name, this.hpBar);
    this.group.position.set(...snap.p);
    this.group.rotation.y = snap.yaw;
    this.interp.push(snap.p, snap.yaw);
  }

  dispose() { this.lights.unregister(this.dl); disposeObject(this.group); }

  apply(snap: PlayerSnap) {
    this.interp.push(snap.p, snap.yaw);
    setBar(this.hpBar, snap.hp / 100);
    const downed = snap.state === 'downed';
    this.downed = downed;
    this.dl.intensity = downed ? 3 : 0;
    this.grounded = snap.anim !== 2;
    this.pitch = snap.pitch ?? 0;
    this.carrying = !!snap.carrying;
    this.rig.setDevice(snap.equipped);
    if (downed !== this.wasDowned) {
      this.wasDowned = downed;
      for (const m of this.rig.recolor) m.emissive.set(downed ? PALETTE.hostile : this.accent);
    }
  }

  say(text: string) {
    if (this.bubble) { this.group.remove(this.bubble); disposeObject(this.bubble); }
    this.bubble = bubbleSprite(text);
    this.bubble.position.y = 2.65;
    this.group.add(this.bubble);
    this.bubbleUntil = performance.now() + 4500 + text.length * 40;
  }

  update(dt: number) {
    const s = this.interp.sample(this.group.position);
    if (s) this.group.rotation.y = s.yaw;
    // smoothed interpolated velocity drives stride, air pose and landing
    this.vel.lerp(this.interp.velocity, Math.min(1, dt * 12));
    this.anim.update(dt, this.group.rotation.y, {
      vel: this.vel, grounded: this.grounded, pitch: this.pitch, downed: this.downed,
      carrying: this.carrying, holding: true,
    });
    tickBar(this.hpBar, dt);
    if (this.downed) this.dl.pos.copy(this.group.position).setY(this.group.position.y + 0.5);
    if (this.bubble && performance.now() > this.bubbleUntil) {
      this.group.remove(this.bubble);
      disposeObject(this.bubble);
      this.bubble = undefined;
    }
  }
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
  private list: { group: THREE.Group; until: number; ring: THREE.Mesh; lh: LightHandle }[] = [];
  constructor(private scene: THREE.Scene, private lights: DynamicLights) {}
  add(pos: [number, number, number], accent: string) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 8, 28),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, 5, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 2.5;
    // pooled light: adding a real PointLight changes the light count, which forces
    // three to recompile every lit material (a visible hitch per ping)
    const lh = this.lights.register(accent, { intensity: 2, range: 8, priority: 3 });
    lh.pos.set(pos[0], pos[1] + 1, pos[2]);
    g.add(ring, beam);
    g.position.set(...pos);
    this.scene.add(g);
    this.list.push({ group: g, until: performance.now() + 4000, ring, lh });
  }
  update(dt: number) {
    const now = performance.now();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const left = (p.until - now) / 4000;
      if (left <= 0) { this.drop(p); this.list.splice(i, 1); continue; }
      p.lh.intensity = 2 * Math.min(1, left * 2);
      p.ring.scale.setScalar(1 + Math.sin(now * 0.008) * 0.18);
      p.group.children.forEach((c) => {
        const m = (c as THREE.Mesh).material as THREE.Material & { opacity?: number };
        if (m && 'opacity' in m) m.opacity = Math.min(1, left * 2) * ((c as THREE.Mesh).geometry?.type === 'TorusGeometry' ? 0.9 : 0.4);
      });
    }
  }
  private drop(p: { group: THREE.Group; lh: LightHandle }) {
    this.scene.remove(p.group); disposeObject(p.group); this.lights.unregister(p.lh);
  }
  clear() { for (const p of this.list) this.drop(p); this.list.length = 0; }
}

// ---------- echo ghosts (Echo Core skill) ----------
// A holographic copy of the explorer (fresnel + scanlines, additive) standing at
// the echo point, breathing idly. It animates itself from onBeforeRender, so the
// class needs no per-frame hook from main.
interface Echo { group: THREE.Group; rig: AvatarRig; anim: AvatarAnimator; time: { value: number }; last: number }
const ZERO = new THREE.Vector3();
export class Echoes {
  private map = new Map<string, Echo>();
  constructor(private scene: THREE.Scene) {}
  sync(snaps: PlayerSnap[]) {
    const seen = new Set<string>();
    for (const s of snaps) {
      if (!s.echo) continue;
      seen.add(s.id);
      let e = this.map.get(s.id);
      if (!e) {
        const time = { value: 0 };
        const rig = buildAvatar(s.accent || PALETTE.portalA, { override: holoMat(s.accent || PALETTE.portalA, time) });
        const group = new THREE.Group();
        group.add(rig.root);
        group.rotation.y = s.yaw;
        const echo: Echo = { group, rig, anim: new AvatarAnimator(rig), time, last: performance.now() };
        rig.meshes[0].onBeforeRender = () => {
          const now = performance.now();
          const dt = Math.min(0.1, (now - echo.last) / 1000);
          if (dt <= 0) return;
          echo.last = now;
          time.value += dt;
          rig.root.position.y = 0.04 + Math.sin(time.value * 1.4) * 0.03;
          echo.anim.update(dt, group.rotation.y, { vel: ZERO, grounded: true, pitch: 0, downed: false });
        };
        e = echo;
        this.map.set(s.id, e);
        this.scene.add(group);
      }
      e.group.position.set(s.echo[0], s.echo[1], s.echo[2]);
    }
    for (const [id, e] of this.map) {
      if (!seen.has(id)) { this.scene.remove(e.group); disposeObject(e.group); this.map.delete(id); }
    }
  }
  clear() { for (const [id, e] of this.map) { this.scene.remove(e.group); disposeObject(e.group); this.map.delete(id); } }
}

// ---------- enemies ----------
const ICE_LIGHT = new THREE.Color('#9fdcff');
const HOSTILE_LIGHT = new THREE.Color(PALETTE.hostile);

class EnemyVis {
  group: THREE.Group;
  interp = new Interpolator();
  hasTarget = false;
  model: EnemyModel;
  hpBar: THREE.Sprite;
  private lh: LightHandle;
  telegraphT = 0;
  private telegraphTotal = 1;
  dead = false;
  frozen = false;
  height: number;
  private state = 'idle';
  private disguised = false;
  private exposedUntil = 0;
  private hpPct = 1;
  private vel = new THREE.Vector3();

  constructor(snap: EnemySnap, private lights: DynamicLights) {
    this.model = new EnemyModel(snap.type);
    this.group = this.model.group;
    this.height = this.model.height;
    this.hpBar = makeBar(PALETTE.hostile, snap.type === 'colossus' ? 1.3 : 0.8);
    this.hpBar.position.y = this.height + 0.45;
    this.lh = lights.register(PALETTE.hostile, { intensity: 0.8, range: snap.type === 'colossus' ? 10 : 7, priority: 2 });
    this.group.add(this.hpBar);
    this.group.position.set(...snap.p);
    this.group.rotation.y = snap.yaw;
    this.interp.push(snap.p, snap.yaw);
  }

  dispose() { this.lights.unregister(this.lh); disposeObject(this.group); }

  apply(snap: EnemySnap) {
    this.interp.push(snap.p, snap.yaw);
    this.hasTarget = !!snap.target && snap.state !== 'down' && snap.state !== 'frozen';
    this.hpPct = snap.hp / snap.maxHp;
    setBar(this.hpBar, this.hpPct);
    this.dead = snap.state === 'down';
    this.frozen = snap.state === 'frozen';
    this.state = snap.state;
    // mimic disguise: a full-hp idle mimic passes for an ordinary crate
    this.disguised = this.model.type === 'mimic' && snap.state === 'idle' && !snap.target && snap.hp >= snap.maxHp;
  }

  telegraph(ms: number) { this.telegraphT = ms / 1000; this.telegraphTotal = Math.max(0.1, ms / 1000); }
  expose(ms: number) { this.exposedUntil = Math.max(this.exposedUntil, performance.now() + ms); }

  update(dt: number, time: number) {
    const s = this.interp.sample(this.group.position);
    if (s) this.group.rotation.y = s.yaw;
    this.vel.lerp(this.interp.velocity, Math.min(1, dt * 10));
    const speed = Math.hypot(this.vel.x, this.vel.z);
    let wind: number | undefined;
    if (this.telegraphT > 0) {
      this.telegraphT = Math.max(0, this.telegraphT - dt);
      wind = 1 - this.telegraphT / this.telegraphTotal;
    }
    const state = this.telegraphT > 0 && !this.dead && !this.frozen ? 'telegraph' : this.state;
    this.model.update(dt, time, {
      state, speed, telegraph: wind ?? (state === 'telegraph' ? 1 : 0),
      disguised: this.disguised, exposed: performance.now() < this.exposedUntil,
    });
    tickBar(this.hpBar, dt);
    this.hpBar.visible = !this.dead && !this.disguised && (this.hasTarget || this.hpPct < 0.999);
    // pooled light follows the core; flashes on wind-up
    this.lh.pos.copy(this.group.position).setY(this.group.position.y + this.height * 0.55);
    const flash = this.telegraphT > 0 ? (0.5 + Math.sin(time * 24) * 0.5) * 3 : 0;
    this.lh.intensity = this.dead || this.disguised ? 0 : this.model.lightLevel() + flash;
    this.lh.color.copy(this.frozen ? ICE_LIGHT : HOSTILE_LIGHT);
  }
}

export class Enemies {
  private map = new Map<string, EnemyVis>();
  private time = 0;
  private tractored?: string;
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
  telegraph(id: string, ms: number) { this.map.get(id)?.telegraph(ms); }
  /** forward server enemy events for hit flashes, shield ripples, strikes, core exposure */
  event(id: string, ev: string, data?: Record<string, unknown>) {
    const v = this.map.get(id);
    if (!v) return;
    if (ev === 'hit') {
      const blocked = !!data?.blocked;
      v.model.hit(blocked);
      // an unblocked hit on the colossus means someone's tractor has its core open
      if (!blocked && v.model.type === 'colossus') v.expose(1500);
    } else if (ev === 'stagger') v.model.hit(false);
    else if (ev === 'attack') v.model.attack();
  }
  /** the local player's tractor target (lays a colossus core open) */
  setTractored(id: string | undefined) {
    if (id !== this.tractored) this.tractored = id;
    if (id) this.map.get(id)?.expose(250);
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
