// Remote player avatars, enemies, and their VFX (telegraph flash, freeze tint,
// downed beacons). All positions come from server snapshots and are interpolated.
import * as THREE from 'three';
import type { EnemySnap, PlayerSnap } from '../shared/messages';
import { PALETTE } from '../shared/palette';
import { textSprite } from './world';
import { Interpolator } from './interp';
import type { DynamicLights, LightHandle } from './render/lights';

// ---------- peers ----------
// An articulated, low-poly "explorer" rig — faceted suit panels, a glowing accent
// visor + chest core, and swinging limbs driven by the avatar's ground speed. Local
// players are first-person, so this is what you see of your teammates in co-op.
interface AvatarRig {
  root: THREE.Group;                       // whole humanoid (collapses when downed)
  legL: THREE.Group; legR: THREE.Group;    // hip-pivoting leg groups
  armL: THREE.Group; armR: THREE.Group;    // shoulder-pivoting arm groups
  torso: THREE.Group;                       // subtle breathing bob
  recolor: THREE.MeshStandardMaterial[];    // accent emissives (→ hostile when downed)
}

function limb(len: number, top: number, bottom: number, mat: THREE.Material, accent?: THREE.Mesh): THREE.Group {
  // a single tapered segment hanging from a pivot at y=0, plus an optional joint cap
  const g = new THREE.Group();
  const seg = new THREE.Mesh(new THREE.CylinderGeometry(bottom, top, len, 6), mat);
  seg.position.y = -len / 2;
  seg.castShadow = true;
  g.add(seg);
  if (accent) g.add(accent);
  return g;
}

export function buildAvatar(accentHex: string): AvatarRig {
  const accent = new THREE.Color(accentHex);
  const recolor: THREE.MeshStandardMaterial[] = [];
  const suit = new THREE.MeshStandardMaterial({
    color: '#c9c5d8', roughness: 0.5, metalness: 0.35, flatShading: true,
    emissive: accent, emissiveIntensity: 0.14,
  });
  recolor.push(suit);
  const panel = new THREE.MeshStandardMaterial({
    color: '#43405e', roughness: 0.42, metalness: 0.5, flatShading: true,
  });
  const glow = () => {
    const m = new THREE.MeshStandardMaterial({ color: accentHex, emissive: accentHex, emissiveIntensity: 1.5, roughness: 0.3 });
    recolor.push(m);
    return m;
  };

  const root = new THREE.Group();

  // ---- torso: tapered chest over a slimmer waist ----
  const torso = new THREE.Group();
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.52, 6), suit);
  chest.position.y = 1.24; chest.castShadow = true;
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.28, 6), panel);
  waist.position.y = 0.92;
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.2, 6), suit);
  hips.position.y = 0.8;
  // glowing chest core + collar trim
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), glow());
  core.position.set(0, 1.3, -0.28);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16), glow());
  collar.position.y = 1.5; collar.rotation.x = Math.PI / 2;
  // small backpack
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.18), panel);
  pack.position.set(0, 1.24, 0.3); pack.castShadow = true;
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.04), glow());
  vent.position.set(0, 1.32, 0.4);
  torso.add(chest, waist, hips, core, collar, pack, vent);

  // ---- head: helmet with a wraparound visor band ----
  const head = new THREE.Group(); head.position.y = 1.6;
  const helmet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), suit);
  helmet.castShadow = true;
  // glowing visor band across the FRONT face (θ=π is -Z); radius just proud of the helmet
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.208, 0.208, 0.13, 12, 1, true,
    Math.PI * 0.55, Math.PI * 0.9), glow());
  visor.position.set(0, -0.01, 0);
  const brow = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 6, 14, Math.PI), panel);
  brow.position.y = 0.09; brow.rotation.set(Math.PI / 2, 0, Math.PI);   // dark crest hood over the visor
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.22), panel);
  crest.position.set(0, 0.11, 0.02);
  head.add(helmet, visor, brow, crest);
  torso.add(head);
  root.add(torso);

  // ---- shoulders + arms (swing from the shoulder) ----
  const armFor = (side: number): THREE.Group => {
    const pauldron = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), suit);
    const arm = limb(0.62, 0.11, 0.08, suit, pauldron);
    const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), panel);
    hand.position.y = -0.62; arm.add(hand);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 5, 12), glow());
    band.position.y = -0.34; band.rotation.x = Math.PI / 2; arm.add(band);
    arm.position.set(side * 0.36, 1.42, 0);
    return arm;
  };
  const armL = armFor(-1), armR = armFor(1);
  root.add(armL, armR);

  // ---- legs (swing from the hip) ----
  const legFor = (side: number): THREE.Group => {
    const leg = limb(0.66, 0.13, 0.09, suit);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), panel);
    boot.position.set(0, -0.66, -0.04); boot.castShadow = true; leg.add(boot);
    const knee = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 5, 12), glow());
    knee.position.y = -0.36; knee.rotation.x = Math.PI / 2; leg.add(knee);
    leg.position.set(side * 0.16, 0.8, 0);
    return leg;
  };
  const legL = legFor(-1), legR = legFor(1);
  root.add(legL, legR);

  return { root, legL, legR, armL, armR, torso, recolor };
}

class PeerAvatar {
  group = new THREE.Group();
  interp = new Interpolator();
  downed = false;
  private bubble?: THREE.Sprite;
  private bubbleUntil = 0;
  hpBar: THREE.Sprite;
  private rig: AvatarRig;
  private dl: LightHandle;
  echoGhost?: THREE.Mesh;
  accent: string;
  private phase = Math.random() * Math.PI * 2;   // desync stride between peers
  private speed = 0;
  private prev = new THREE.Vector3();
  private collapse = 0;                            // 0 = standing, 1 = fully downed

  constructor(snap: PlayerSnap, private lights: DynamicLights) {
    this.accent = snap.accent || PALETTE.portalA;
    this.rig = buildAvatar(this.accent);
    const name = textSprite(snap.name, this.accent, 0.42);
    name.position.y = 2.15;
    this.hpBar = makeBar(this.accent);
    this.hpBar.position.y = 1.95;
    this.dl = lights.register(PALETTE.hostile, { intensity: 0, range: 8, priority: 2 });
    this.group.add(this.rig.root, name, this.hpBar);
    this.group.position.set(...snap.p);
    this.prev.copy(this.group.position);
    this.interp.push(snap.p, snap.yaw);
  }

  dispose() { this.lights.unregister(this.dl); }

  apply(snap: PlayerSnap) {
    this.interp.push(snap.p, snap.yaw);
    setBar(this.hpBar, snap.hp / 100);
    const downed = snap.state === 'downed';
    this.downed = downed;
    this.dl.intensity = downed ? 3 : 0;
    for (const m of this.rig.recolor) m.emissive.set(downed ? PALETTE.hostile : this.accent);
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

    // ground speed drives the stride (planar delta since last frame)
    const inst = this.group.position.distanceTo(this.prev) / Math.max(dt, 1e-3);
    this.prev.copy(this.group.position);
    this.speed += (inst - this.speed) * Math.min(1, dt * 10);   // smooth
    const t = performance.now() / 1000;

    // collapse toward the downed pose (or back up)
    this.collapse += ((this.downed ? 1 : 0) - this.collapse) * Math.min(1, dt * 8);
    const { root, legL, legR, armL, armR, torso } = this.rig;

    if (this.collapse > 0.001) {
      root.rotation.z = this.collapse * Math.PI * 0.5;
      root.position.set(this.collapse * 0.2, this.collapse * -0.1, 0);
    } else {
      root.rotation.z = 0; root.position.set(0, 0, 0);
    }

    const moving = this.speed > 0.4;
    if (moving) this.phase += this.speed * dt * 1.9;
    const stand = 1 - this.collapse;
    const amp = (moving ? Math.min(0.62, 0.22 + this.speed * 0.05) : 0) * stand;
    legL.rotation.x = Math.sin(this.phase) * amp;
    legR.rotation.x = Math.sin(this.phase + Math.PI) * amp;
    armL.rotation.x = Math.sin(this.phase + Math.PI) * amp * 0.85;
    armR.rotation.x = Math.sin(this.phase) * amp * 0.85;
    // step bob while walking, gentle breathing while idle
    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.05 : (Math.sin(t * 1.6) * 0.5 + 0.5) * 0.02;
    torso.position.y = bob * stand;
    torso.rotation.z = Math.sin(this.phase) * 0.04 * amp;
    // arms relax outward a touch when idle-collapsed
    armL.rotation.z = (0.08 + this.collapse * 0.5) ;
    armR.rotation.z = -(0.08 + this.collapse * 0.5);

    if (this.downed) this.dl.pos.copy(this.group.position).setY(this.group.position.y + 0.5);
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

  if (type === 'mimic') {
    // disguised as a light crate: crystal cube + gold edge frame. When it wakes,
    // the lid tips open over a glowing maw and stubby legs unfold.
    const body = bodyMat(), glow = glowMat();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.5, 0.66), body);
    core.position.y = 0.35;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.16, 0.68), body);
    lid.position.set(0, 0.66, 0.02); lid.name = 'lid'; parts.push(lid);
    const maw = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.06, 6, 14), glow);
    maw.position.y = 0.62; maw.rotation.x = Math.PI / 2; maw.name = 'maw'; parts.push(maw);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.7, 0.72, 0.7)),
      new THREE.LineBasicMaterial({ color: PALETTE.interactable, transparent: true, opacity: 0.8 }));
    edges.position.y = 0.36; edges.name = 'disguiseEdges'; parts.push(edges);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 5), body);
      leg.position.set(sx * 0.26, 0.1, sz * 0.26); leg.rotation.x = Math.PI;
      leg.name = 'leg'; parts.push(leg);
    }
    return { core, parts, height: 1.1 };
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
  private type: string;
  private disguised = false;

  constructor(snap: EnemySnap, private lights: DynamicLights) {
    this.type = snap.type;
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
    // mimic disguise: a full-hp idle mimic passes for an ordinary crate
    if (this.type === 'mimic') {
      this.disguised = snap.state === 'idle' && !snap.target && snap.hp >= snap.maxHp;
      const maw = this.group.getObjectByName('maw');
      const lid = this.group.getObjectByName('lid');
      this.group.traverse((o) => { if (o.name === 'leg') o.visible = !this.disguised; });
      if (maw) maw.visible = !this.disguised;
      if (lid) lid.rotation.x = this.disguised ? 0 : -0.85;
      this.hpBar.visible = !this.disguised && !this.dead;
      this.lh.intensity = this.disguised ? 0 : 0.8;
      if (this.disguised) {
        for (const m of this.bodyMats) { m.color.set('#b8b2c8'); m.emissive.set(PALETTE.interactable); m.emissiveIntensity = 0.3; }
        return;
      }
    }
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
      this.lh.intensity = this.disguised ? 0 : 0.8;
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
      this.hpBar.visible = !this.disguised;
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
