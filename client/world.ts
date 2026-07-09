// Builds a renderable world from a LevelDef and keeps it in sync with server state.
// Uses the SAME shared collision + expression code as the server, so client-side
// movement prediction agrees with the authoritative sim.
import * as THREE from 'three';
import type { InteractableDef, LevelDef, Vec3 } from '../shared/level';
import { evalExpr } from '../shared/expr';
import { buildColliders, raycast, type AABB } from '../shared/collision';
import { getMaterial, applyWorldUV } from './render/materials';
import { makePortalVortex, type PortalVortex } from './render/portalMaterial';
import { PALETTE } from '../shared/palette';
import { Interpolator } from './interp';
import type { DynamicLights, LightHandle } from './render/lights';
import type { HeroFloor } from './render/renderer';

export type IState = Record<string, number | boolean>;

export function textSprite(text: string, color = '#ffffff', size = 0.5): THREE.Sprite {
  // high-DPI supersampled label: crisp text with a soft halo + dark outline
  const W = 1024, H = 256;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  c.width = W; c.height = H;
  ctx.font = '600 92px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // dark halo for legibility over bright emissives
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 22;
  ctx.strokeStyle = 'rgba(10,8,20,0.9)'; ctx.lineWidth = 10;
  ctx.strokeText(text, W / 2, H / 2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(4 * size, size, 1);
  return sp;
}

interface DoorVis { mesh: THREE.Mesh; baseY: number; height: number; t: number; open: boolean }
interface ActiveVis { mesh: THREE.Mesh; expr: string; on: boolean; t: number }

export class World {
  group = new THREE.Group();
  level: LevelDef;
  colliders: AABB[];
  states = new Map<string, IState>();
  enemyDown = new Set<string>();
  enemyIds = new Set<string>();
  playersPresent = 1;
  solved = false;
  phaseSight = false;

  private doors: DoorVis[] = [];
  private actives: ActiveVis[] = [];
  private interVis = new Map<string, THREE.Object3D>();
  private portalVis = new Map<string, {
    group: THREE.Group; gate: THREE.Group; ring: THREE.Mesh; ringInner: THREE.Mesh;
    orbit: THREE.Group; vortex: PortalVortex; lh: LightHandle;
    def: NonNullable<LevelDef['portals']>[number];
  }>();
  private interLights = new Map<string, LightHandle>();
  private beamGroup = new THREE.Group();
  private hazardMats = new Map<string, THREE.MeshStandardMaterial>();
  private placedGroup = new THREE.Group();
  private placedVis = new Map<string, THREE.Group>();
  private placedLights = new Map<string, LightHandle>();
  private bodyInterp = new Map<string, Interpolator>();
  private bodyHeld = new Map<string, boolean>();
  /** carryable crates as solid colliders for the LOCAL player (their true box
      shape — stand on them, push against them). Kept in sync every frame;
      inactive while held so a carried crate can't shove its carrier. */
  private bodyColliders = new Map<string, AABB>();
  private staticMeshes: THREE.Mesh[] = [];
  private checkpointRings: THREE.Mesh[] = [];
  private spinners: { mesh: THREE.Mesh; rate: number }[] = [];
  private trophyGroup?: THREE.Group;
  private cullAcc = 0;
  private time = 0;

  constructor(private scene: THREE.Scene, level: LevelDef, states: Record<string, IState> | undefined, private lights: DynamicLights) {
    this.level = level;
    this.colliders = buildColliders(level);
    if (states) for (const [id, st] of Object.entries(states)) this.states.set(id, { ...st });
    for (const e of level.enemies ?? []) this.enemyIds.add(e.id);
    this.build();
    this.group.add(this.beamGroup, this.placedGroup);
    this.applyStates();
    scene.add(this.group);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const { lh } of this.portalVis.values()) this.lights.unregister(lh);
    for (const lh of this.interLights.values()) this.lights.unregister(lh);
    for (const lh of this.placedLights.values()) this.lights.unregister(lh);
    this.portalVis.clear(); this.interLights.clear(); this.placedLights.clear();
  }

  // ---------- expression lookup (mirrors server) ----------
  lookup = (path: string): number | boolean | undefined => {
    if (path === 'allEnemiesDown') {
      for (const id of this.enemyIds) if (!this.enemyDown.has(id)) return false;
      return true;
    }
    if (path === 'playersPresent') return this.playersPresent;
    const [root, prop] = path.split('.');
    if (this.enemyIds.has(root)) return prop === 'down' ? this.enemyDown.has(root) : undefined;
    const st = this.states.get(root);
    if (st && prop !== undefined) return st[prop];
    const doorGeo = this.level.geometry.find((g) => g.door?.id === root);
    if (doorGeo && prop === 'open') { try { return evalExpr(doorGeo.door!.openWhen, this.lookup); } catch { return false; } }
    return undefined;
  };
  evalSafe(expr: string): boolean { try { return evalExpr(expr, this.lookup); } catch { return false; } }

  // ---------- construction ----------
  private build() {
    this.level.geometry.forEach((g, i) => {
      // cap emissive so set-piece crystals glow without blowing out the bloom pass
      const mat = getMaterial(g.material, g.color, g.emissive, Math.min(g.emissiveIntensity ?? 1, 1.5));
      let geo: THREE.BufferGeometry;
      if (g.shape === 'cylinder') geo = new THREE.CylinderGeometry(g.size[0], g.size[0], g.size[1], 24);
      else { geo = new THREE.BoxGeometry(...g.size); applyWorldUV(geo, g.size); }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...g.pos);
      if (g.rotY) mesh.rotation.y = g.rotY;
      mesh.castShadow = g.size[1] > 0.2;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (g.spin && g.collider === false) this.spinners.push({ mesh, rate: g.spin });
      if (g.door) this.doors.push({ mesh, baseY: g.pos[1], height: g.size[1], t: 0, open: false });
      else if (g.activeWhen) this.actives.push({ mesh, expr: g.activeWhen, on: true, t: 1 });
      else this.staticMeshes.push(mesh);
    });
    for (const it of this.level.interactables ?? []) this.buildInteractable(it);
    for (const p of this.level.portals ?? []) this.buildPortal(p);
    for (const cp of this.level.checkpoints ?? []) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 32),
        new THREE.MeshStandardMaterial({ color: PALETTE.success, emissive: PALETTE.success, emissiveIntensity: 0.4, transparent: true, opacity: 0.5 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cp[0], cp[1] - 0.85, cp[2]);
      this.checkpointRings.push(ring);
      this.group.add(ring);
    }
  }

  private buildInteractable(it: InteractableDef) {
    const g = new THREE.Group();
    g.position.set(...(it as { pos: Vec3 }).pos);
    const accent = getMaterial('accent', undefined, PALETTE.interactable, 0.7);
    switch (it.type) {
      case 'plate': {
        const size = it.size ?? [2.4, 0.4, 2.4];
        const base = new THREE.Mesh(new THREE.BoxGeometry(size[0] + 0.4, 0.12, size[2] + 0.4), getMaterial('metal'));
        base.position.y = 0.06;
        const top = new THREE.Mesh(new THREE.BoxGeometry(size[0], 0.16, size[2]), accent);
        top.position.y = 0.2; top.name = 'top';
        g.add(base, top);
        break;
      }
      case 'lever': case 'rotator': {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.1, 12), getMaterial('metal'));
        post.position.y = 0.55;
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), accent);
        handle.position.set(0, 1.0, 0); handle.name = 'handle';
        handle.geometry.translate(0, 0.35, 0);
        g.add(post, handle);
        if (it.type === 'rotator') {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 8, 24), accent);
          ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; ring.name = 'ring';
          g.add(ring);
        }
        break;
      }
      case 'switch': {
        const plateM = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 16),
          new THREE.MeshStandardMaterial({ color: PALETTE.interactable, emissive: PALETTE.interactable, emissiveIntensity: 0.3 }));
        plateM.rotation.x = Math.PI / 2; plateM.name = 'eye';
        g.add(plateM);
        break;
      }
      case 'carryable': {
        const heavy = it.mass === 'heavy';
        const s = heavy ? 1.1 : 0.6;
        const mesh = heavy
          ? new THREE.Mesh(new THREE.BoxGeometry(s, s, s), getMaterial('stone', '#b8b2c8', PALETTE.interactable, 0.12))
          : new THREE.Mesh(new THREE.BoxGeometry(s, s, s), getMaterial('crystal', undefined, PALETTE.interactable, 0.35));
        mesh.castShadow = true; mesh.name = 'body';
        // rune-etched edge frame + a slow-pulsing core so crates read as artefacts
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(s * 1.02, s * 1.02, s * 1.02)),
          new THREE.LineBasicMaterial({ color: PALETTE.interactable, transparent: true, opacity: heavy ? 0.9 : 0.75 }));
        edges.name = 'edges';
        mesh.add(edges);
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.22),
          new THREE.MeshStandardMaterial({ color: PALETTE.interactable, emissive: PALETTE.interactable, emissiveIntensity: 1.6 }));
        core.name = 'core';
        mesh.add(core);
        g.add(mesh);
        // solid to the local player: matches the server body half-extents
        const half = heavy ? 0.55 : 0.3;
        this.bodyColliders.set(it.id, {
          min: [it.pos[0] - half, it.pos[1] - half, it.pos[2] - half],
          max: [it.pos[0] + half, it.pos[1] + half, it.pos[2] + half],
          geoIndex: -1, active: true,
        });
        break;
      }
      case 'collectible': {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32),
          new THREE.MeshStandardMaterial({ color: PALETTE.interactable, emissive: PALETTE.interactable, emissiveIntensity: 1.4 }));
        gem.name = 'gem';
        g.add(gem);
        const lh = this.lights.register(PALETTE.interactable, { intensity: 1.2, range: 6, priority: 1 });
        lh.pos.set(it.pos[0], it.pos[1] + 0.4, it.pos[2]);
        this.interLights.set(it.id, lh);
        break;
      }
      case 'socket': {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 8, 24), accent);
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1;
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.3),
          new THREE.MeshStandardMaterial({ color: PALETTE.success, emissive: PALETTE.success, emissiveIntensity: 1.4 }));
        gem.position.y = 0.5; gem.name = 'gem'; gem.visible = false;
        g.add(ring, gem);
        break;
      }
      case 'emitter': {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 12),
          new THREE.MeshStandardMaterial({ color: PALETTE.portalA, emissive: PALETTE.portalA, emissiveIntensity: 1.5 }));
        const d = new THREE.Vector3(...it.dir).normalize();
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        g.add(cone);
        break;
      }
      case 'receiver': {
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12),
          new THREE.MeshStandardMaterial({ color: '#666a88', emissive: '#222436', emissiveIntensity: 1 }));
        orb.name = 'orb';
        g.add(orb);
        const lh = this.lights.register(PALETTE.portalA, { intensity: 0, range: 7, priority: 2 });
        lh.pos.set(it.pos[0], it.pos[1], it.pos[2]);
        this.interLights.set(it.id, lh);
        break;
      }
      case 'hazard': {
        const conveyor = it.kind === 'conveyor';
        const mat = new THREE.MeshStandardMaterial({
          color: it.kind === 'void' ? '#2a1020' : conveyor ? '#8fb4ff' : '#cfe8ff',
          emissive: it.kind === 'void' ? PALETTE.hostile : conveyor ? '#7ea8ff' : '#9fdcff',
          emissiveIntensity: it.kind === 'void' ? 0.5 : 0.35,
          transparent: true, opacity: it.kind === 'void' ? 0.55 : conveyor ? 0.25 : 0.35,
          depthWrite: false,
        });
        this.hazardMats.set(it.id, mat);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...it.size), mat);
        mesh.name = 'field';
        g.add(mesh);
        // conveyors show chevrons drifting along the flow
        if (conveyor && it.dir) {
          const d = new THREE.Vector3(it.dir[0], 0, it.dir[2]).normalize();
          for (let i = 0; i < 4; i++) {
            const chev = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4),
              new THREE.MeshStandardMaterial({ color: '#dce8ff', emissive: '#9fc2ff', emissiveIntensity: 1.2 }));
            chev.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
            chev.name = `chev${i}`;
            g.add(chev);
          }
        }
        break;
      }
      case 'scale': {
        // balance beam: fulcrum post, tilting beam, a pan hanging off each end
        const span = it.span ?? 3.0;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.2, 10), getMaterial('metal', '#cfcce0'));
        post.position.y = 0.6;
        const arm = new THREE.Group(); arm.name = 'arm'; arm.position.y = 1.25;
        if (it.rotY) arm.rotation.y = it.rotY;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 0.12, 0.24), getMaterial('metal', '#cfcce0'));
        const pivot = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), accent);
        arm.add(beam, pivot);
        for (const side of [-1, 1] as const) {
          const pan = new THREE.Group(); pan.name = side < 0 ? 'panL' : 'panR';
          pan.position.x = side * span / 2;
          const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), getMaterial('metal'));
          chain.position.y = -0.5;
          const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.0, 0.14, 18), accent);
          dish.position.y = -1.05;
          pan.add(chain, dish);
          arm.add(pan);
        }
        g.add(post, arm);
        break;
      }
      case 'resonator': {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.7, 8), getMaterial('stone'));
        pillar.position.y = 0.85; pillar.castShadow = true;
        // the chime crystal: dark until sounded, numbered by stacked notches
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.3),
          new THREE.MeshStandardMaterial({ color: '#6a648a', emissive: '#2a2740', emissiveIntensity: 1 }));
        gem.position.y = 2.0; gem.name = 'gem';
        for (let i = 0; i <= it.order; i++) {
          const notch = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.1), accent);
          notch.position.set(0, 0.35 + i * 0.18, -0.34);
          g.add(notch);
        }
        g.add(pillar, gem);
        const lh = this.lights.register(PALETTE.interactable, { intensity: 0, range: 6, priority: 1 });
        lh.pos.set(it.pos[0], it.pos[1] + 2.0, it.pos[2]);
        this.interLights.set(it.id, lh);
        break;
      }
    }
    this.interVis.set(it.id, g);
    this.group.add(g);
  }

  private buildPortal(def: NonNullable<LevelDef['portals']>[number]) {
    const color = def.color ?? PALETTE.portalA;
    const g = new THREE.Group();
    g.position.set(...def.pos);
    // face the approach: explicit rotY wins, else look toward the entry spawn
    const entry = this.level.spawns['entry'];
    const dx = entry[0] - def.pos[0], dz = entry[2] - def.pos[2];
    g.rotation.y = def.rotY ?? (Math.hypot(dx, dz) > 0.5 ? Math.atan2(dx, dz) : 0);

    // the gate: swirling vortex framed by counter-rotating rings + orbiting shards
    const gate = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.085, 12, 48),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8, metalness: 0.4, roughness: 0.3 }));
    const ringInner = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.032, 8, 40),
      new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: 2.6 }));
    const vortex = makePortalVortex(color);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.04, 40), vortex.material);
    const orbit = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 }));
      const a = (i / 6) * Math.PI * 2;
      shard.position.set(Math.cos(a) * 1.34, Math.sin(a) * 1.34, 0);
      shard.rotation.set(a, a * 1.7, 0);
      orbit.add(shard);
    }
    gate.add(ring, ringInner, disc, orbit);
    g.add(gate);

    // anchor pad on the ground below the gate (gates float ~1.3m over the floor)
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.62, 0.07, 28),
      getMaterial('metal', '#4d4870', color, 0.18));
    pad.position.y = -1.28;
    const padRing = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.045, 8, 40),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.3 }));
    padRing.rotation.x = -Math.PI / 2; padRing.position.y = -1.22; padRing.name = 'padRing';
    g.add(pad, padRing);

    // volumetric-ish light cone rising from the portal (fake god-ray)
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.05, 3.2, 20, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    cone.position.y = 1.6; cone.name = 'cone';
    g.add(cone);
    if (def.label) {
      const label = textSprite(def.label, '#ffffff', 0.55);
      label.position.y = 2.05;
      g.add(label);
    }
    this.group.add(g);
    const lh = this.lights.register(color, { intensity: 2.2, range: 11, priority: 3 });
    lh.pos.set(def.pos[0], def.pos[1] + 0.4, def.pos[2]);
    this.portalVis.set(def.id, { group: g, gate, ring, ringInner, orbit, vortex, lh, def });
  }

  // ---------- state sync ----------
  setState(id: string, st: IState) {
    this.states.set(id, { ...(this.states.get(id) ?? {}), ...st });
    this.applyStates();
  }

  /** Re-evaluate doors/activeWhen → collider active flags + visual targets. */
  applyStates() {
    for (const c of this.colliders) {
      const g = this.level.geometry[c.geoIndex];
      let active = true;
      if (g.activeWhen) active = this.evalSafe(g.activeWhen);
      if (g.door) active = !this.evalSafe(g.door.openWhen);
      c.active = active;
    }
    // doors: open state from expressions
    this.level.geometry.forEach((g) => {
      if (!g.door) return;
      const d = this.doors.find((dd) => Math.abs(dd.baseY - g.pos[1]) < 0.001 && dd.mesh.position.x === g.pos[0] && dd.mesh.position.z === g.pos[2]);
      if (d) d.open = this.evalSafe(g.door.openWhen);
    });
    for (const a of this.actives) a.on = this.evalSafe(a.expr);
  }

  /** portal lock display: shards owned + solved state */
  updatePortalLocks(shardCount: number) {
    for (const { ring, ringInner, orbit, lh, def, group } of this.portalVis.values()) {
      const locked = (def.requiresShards ?? 0) > shardCount || (def.requiresSolved === true && !this.solved);
      (ring.material as THREE.MeshStandardMaterial).emissiveIntensity = locked ? 0.15 : 1.8;
      (ringInner.material as THREE.MeshStandardMaterial).emissiveIntensity = locked ? 0.1 : 2.6;
      orbit.visible = !locked;
      const cone = group.getObjectByName('cone') as THREE.Mesh | undefined;
      if (cone) (cone.material as THREE.MeshBasicMaterial).opacity = locked ? 0.01 : 0.07;
      const padRing = group.getObjectByName('padRing') as THREE.Mesh | undefined;
      if (padRing) (padRing.material as THREE.MeshStandardMaterial).emissiveIntensity = locked ? 0.2 : 1.3;
      lh.intensity = locked ? 0.25 : 2.2;
      group.userData.locked = locked;
    }
  }

  /** hero floor for planar reflections — only the grand social/finale spaces */
  heroFloor(): HeroFloor | undefined {
    if (this.level.world === 'nexus') return { y: 0, size: 30, tint: '#6a6490', shape: 'circle' };
    if (this.level.id === 'observatory-02') return { y: 0, size: 34, tint: '#544e86', shape: 'circle' };
    if (this.level.world === 'observatory') return { y: 0, size: 30, tint: '#4a4478', shape: 'plane' };
    return undefined;
  }

  interactableAt(id: string): THREE.Object3D | undefined { return this.interVis.get(id); }
  interactableDefs(): InteractableDef[] { return this.level.interactables ?? []; }

  /** colliders for LOCAL player movement: level geometry + solid loose crates */
  playerColliders(): AABB[] {
    return [...this.colliders, ...this.bodyColliders.values()];
  }

  /** conveyor flow at a position (players own their movement, so the push is client-side) */
  conveyorPush(pos: THREE.Vector3): Vec3 | null {
    for (const it of this.level.interactables ?? []) {
      if (it.type !== 'hazard' || it.kind !== 'conveyor' || !it.dir) continue;
      if (this.states.get(it.id)?.frozen) continue;
      if (Math.abs(pos.x - it.pos[0]) < it.size[0] / 2 &&
          pos.y + 0.9 > it.pos[1] - it.size[1] / 2 && pos.y < it.pos[1] + it.size[1] / 2 &&
          Math.abs(pos.z - it.pos[2]) < it.size[2] / 2) return it.dir;
    }
    return null;
  }

  /** shard trophies ringing the Nexus pedestal — one gold crystal per shard earned */
  setTrophies(count: number) {
    if (this.level.world !== 'nexus') return;
    if (this.trophyGroup) this.group.remove(this.trophyGroup);
    this.trophyGroup = new THREE.Group();
    const n = Math.min(count, 12);
    for (let i = 0; i < n; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16),
        new THREE.MeshStandardMaterial({ color: '#ffd98a', emissive: '#ffd98a', emissiveIntensity: 1.6 }));
      gem.position.set(Math.cos(a) * 2.55, 1.32, Math.sin(a) * 2.55);
      gem.rotation.y = a;
      this.trophyGroup.add(gem);
    }
    this.group.add(this.trophyGroup);
  }

  /** feed a carryable body snapshot into its interpolation buffer (smoothed per frame) */
  setBodyPos(id: string, pos: Vec3, held: boolean) {
    let interp = this.bodyInterp.get(id);
    if (!interp) { interp = new Interpolator(); this.bodyInterp.set(id, interp); }
    interp.push(pos);
    this.bodyHeld.set(id, held);
  }

  setPlacedPortals(placements: { owner: string; slot: 0 | 1; pos: Vec3; normal: Vec3 }[], accentOf: (owner: string) => string) {
    const want = new Set(placements.map((p) => `${p.owner}:${p.slot}`));
    for (const [key, vis] of this.placedVis) {
      if (!want.has(key)) {
        this.placedGroup.remove(vis);
        this.placedVis.delete(key);
        const lh = this.placedLights.get(key);
        if (lh) { this.lights.unregister(lh); this.placedLights.delete(key); }
      }
    }
    for (const p of placements) {
      const key = `${p.owner}:${p.slot}`;
      if (this.placedVis.has(key)) {
        this.placedVis.get(key)!.position.set(...p.pos);
        this.placedLights.get(key)?.pos.set(...p.pos);
        continue;
      }
      const color = p.slot === 0 ? PALETTE.portalA : PALETTE.portalB;
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.075, 10, 36),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, metalness: 0.4, roughness: 0.3 }));
      const ringInner = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.026, 8, 32),
        new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: color, emissiveIntensity: 2.6 }));
      const vortex = makePortalVortex(color, { intensity: 1.15 });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.78, 32), vortex.material);
      g.add(ring, ringInner, disc);
      g.userData.vortex = vortex;
      g.userData.spin = [ring, ringInner];
      const lh = this.lights.register(color, { intensity: 1.8, range: 8, priority: 2 });
      lh.pos.set(...p.pos);
      this.placedLights.set(key, lh);
      g.position.set(...p.pos);
      const n = new THREE.Vector3(...p.normal);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.placedGroup.add(g);
      this.placedVis.set(key, g);
    }
  }

  /** ray helper for aiming (walls only) */
  raycastWalls(origin: Vec3, dir: Vec3, maxDist: number, portalSurfaceOnly = false) {
    return raycast(this.colliders, origin, dir, maxDist, portalSurfaceOnly ? (b) => !!b.portalSurface : undefined);
  }

  /** world-space positions of active fixed portals — used for ambient motes */
  portalPoints(): { pos: Vec3; color: string }[] {
    const out: { pos: Vec3; color: string }[] = [];
    for (const { def, group } of this.portalVis.values()) {
      if (!group.userData.locked) out.push({ pos: def.pos, color: def.color ?? PALETTE.portalA });
    }
    return out;
  }

  // ---------- per-frame animation ----------
  update(dt: number, viewer?: THREE.Vector3) {
    this.time += dt;
    // big open worlds: cull static meshes beyond fog reach (checked ~2x/sec)
    if (viewer && this.staticMeshes.length > 220) {
      this.cullAcc += dt;
      if (this.cullAcc > 0.45) {
        this.cullAcc = 0;
        for (const m of this.staticMeshes) {
          m.visible = m.position.distanceTo(viewer) < 150;
        }
      }
    }
    // carryables: sample interpolators every frame + tumble with velocity
    for (const [id, interp] of this.bodyInterp) {
      const vis = this.interVis.get(id);
      if (!vis) continue;
      const bc = this.bodyColliders.get(id);
      if (bc) {
        const held = !!this.bodyHeld.get(id);
        const half = (bc.max[0] - bc.min[0]) / 2 || 0.3;
        bc.active = !held;
        bc.min = [vis.position.x - half, vis.position.y - half, vis.position.z - half];
        bc.max = [vis.position.x + half, vis.position.y + half, vis.position.z + half];
      }
      if (interp.sample(vis.position)) {
        const body = vis.getObjectByName('body');
        const speed = Math.hypot(interp.velocity.x, interp.velocity.z);
        if (body && speed > 0.4 && !this.bodyHeld.get(id)) {
          body.rotation.x += interp.velocity.z * dt * 1.8;
          body.rotation.z -= interp.velocity.x * dt * 1.8;
        } else if (body && this.bodyHeld.get(id)) {
          body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, 0, dt * 6);
          body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, 0, dt * 6);
        }
      }
    }
    // doors slide down
    for (const d of this.doors) {
      d.t = THREE.MathUtils.clamp(d.t + (d.open ? dt : -dt) * 1.6, 0, 1);
      const e = d.t * d.t * (3 - 2 * d.t);
      d.mesh.position.y = d.baseY - e * (d.height - 0.08);
      d.mesh.visible = d.t < 0.98;
    }
    // activeWhen fade/scale
    for (const a of this.actives) {
      a.t = THREE.MathUtils.clamp(a.t + (a.on ? dt : -dt) * 2.5, 0, 1);
      a.mesh.visible = a.t > 0.02;
      const m = a.mesh.material as THREE.MeshStandardMaterial;
      m.transparent = a.t < 0.99;
      m.opacity = a.t;
    }
    // interactable animations
    for (const it of this.level.interactables ?? []) {
      const vis = this.interVis.get(it.id);
      if (!vis) continue;
      const st = this.states.get(it.id) ?? {};
      switch (it.type) {
        case 'carryable': {
          const core = vis.getObjectByName('core') as THREE.Mesh | undefined;
          if (core) {
            core.rotation.y += dt * 1.2;
            (core.material as THREE.MeshStandardMaterial).emissiveIntensity =
              1.3 + Math.sin(this.time * 2.6 + it.pos[0]) * 0.5;
          }
          break;
        }
        case 'plate': {
          const top = vis.getObjectByName('top');
          if (top) top.position.y = THREE.MathUtils.lerp(top.position.y, st.pressed ? 0.08 : 0.2, dt * 10);
          break;
        }
        case 'lever': {
          const h = vis.getObjectByName('handle');
          if (h) h.rotation.x = THREE.MathUtils.lerp(h.rotation.x, ((st.state as number) ?? 0) ? 0.9 : -0.9, dt * 8);
          break;
        }
        case 'rotator': {
          const h = vis.getObjectByName('handle');
          const states = it.states;
          if (h) h.rotation.y = THREE.MathUtils.lerp(h.rotation.y, (((st.state as number) ?? 0) / states) * Math.PI * 2, dt * 6);
          break;
        }
        case 'switch': {
          const eye = vis.getObjectByName('eye') as THREE.Mesh | undefined;
          if (eye) (eye.material as THREE.MeshStandardMaterial).emissiveIntensity = st.on ? 2.2 : 0.3;
          break;
        }
        case 'collectible': {
          const gem = vis.getObjectByName('gem') as THREE.Mesh | undefined;
          const collected = !!st.collected;
          vis.visible = !collected;
          if (gem) {
            gem.rotation.y += dt * 1.5;
            gem.position.y = 0.35 + Math.sin(this.time * 2.2) * 0.12;
            // hidden items are a faint glimmer without Phase Sight, unmissable with it
            const dim = it.hidden && !this.phaseSight;
            gem.scale.setScalar(dim ? 0.45 : 1);
            (gem.material as THREE.MeshStandardMaterial).emissiveIntensity = dim ? 0.35 : 1.4;
          }
          const clh = this.interLights.get(it.id);
          if (clh) clh.intensity = collected ? 0 : (it.hidden && !this.phaseSight) ? 0.15 : 1.2;
          break;
        }
        case 'socket': {
          const gem = vis.getObjectByName('gem');
          if (gem) gem.visible = !!st.filled;
          break;
        }
        case 'receiver': {
          const orb = vis.getObjectByName('orb') as THREE.Mesh | undefined;
          if (orb) {
            const m = orb.material as THREE.MeshStandardMaterial;
            m.emissive.set(st.lit ? (it.accepts ?? PALETTE.portalA) : '#222436');
            m.emissiveIntensity = st.lit ? 2.4 : 1;
          }
          const rlh = this.interLights.get(it.id);
          if (rlh) rlh.intensity = st.lit ? 2.2 : 0;
          break;
        }
        case 'hazard': {
          const mat = this.hazardMats.get(it.id);
          if (mat) {
            if (st.frozen) { mat.emissive.set('#bfe8ff'); mat.opacity = 0.85; mat.emissiveIntensity = 0.5; }
            else if (it.kind === 'void') { mat.emissive.set(PALETTE.hostile); mat.opacity = 0.5 + Math.sin(this.time * 3) * 0.08; }
            else if (it.kind === 'conveyor') { mat.emissive.set('#7ea8ff'); mat.opacity = 0.22 + Math.sin(this.time * 4) * 0.05; }
            else { mat.emissive.set('#9fdcff'); mat.opacity = 0.3 + Math.sin(this.time * 5 + it.pos[0]) * 0.08; mat.emissiveIntensity = 0.35; }
          }
          // conveyor chevrons drift with the flow (freeze pins them mid-run)
          if (it.kind === 'conveyor' && it.dir) {
            const d = new THREE.Vector3(it.dir[0], 0, it.dir[2]);
            const speed = d.length() || 1;
            const along = Math.max(Math.abs(it.dir[0]) > Math.abs(it.dir[2]) ? it.size[0] : it.size[2], 1);
            const dn = d.clone().normalize();
            for (let i = 0; i < 4; i++) {
              const chev = vis.getObjectByName(`chev${i}`);
              if (!chev) break;
              const phase = st.frozen ? (i / 4) * along : ((this.time * speed + (i / 4) * along) % along);
              chev.position.copy(dn.clone().multiplyScalar(phase - along / 2));
              chev.position.y = -it.size[1] / 2 + 0.3;
            }
          }
          break;
        }
        case 'scale': {
          const arm = vis.getObjectByName('arm');
          if (arm) {
            const target = ((st.tilt as number) ?? 0) * 0.16;
            arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, -target, dt * 4);
            // pans stay level: counter-rotate against the beam
            const panL = arm.getObjectByName('panL'), panR = arm.getObjectByName('panR');
            if (panL && panR) { panL.rotation.z = -arm.rotation.z; panR.rotation.z = -arm.rotation.z; }
          }
          break;
        }
        case 'resonator': {
          const gem = vis.getObjectByName('gem') as THREE.Mesh | undefined;
          if (gem) {
            const m = gem.material as THREE.MeshStandardMaterial;
            m.emissive.set(st.lit ? PALETTE.interactable : '#2a2740');
            m.emissiveIntensity = st.lit ? 2.2 : 1;
            gem.rotation.y += dt * (st.lit ? 2.4 : 0.4);
          }
          const rlh = this.interLights.get(it.id);
          if (rlh) rlh.intensity = st.lit ? 1.6 : 0;
          break;
        }
      }
    }
    // decor spinners (windmill crystals etc.)
    for (const s of this.spinners) s.mesh.rotation.y += dt * s.rate;
    // trophy shards glint
    if (this.trophyGroup) this.trophyGroup.children.forEach((c, i) => { c.rotation.y += dt * 0.8; c.position.y = 1.32 + Math.sin(this.time * 2 + i) * 0.05; });
    // checkpoint rings breathe gently
    for (let i = 0; i < this.checkpointRings.length; i++) {
      const r = this.checkpointRings[i];
      const pulse = Math.sin(this.time * 1.8 + i * 1.7) * 0.5 + 0.5;
      (r.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + pulse * 0.5;
      r.scale.setScalar(1 + pulse * 0.06);
    }
    // beams
    this.updateBeams();
    // portals: swirl the vortex, counter-rotate rings, orbit shards, bob + breathe
    for (const v of this.portalVis.values()) {
      const locked = !!v.group.userData.locked;
      v.vortex.tick(dt, locked ? 0.12 : 1);
      if (locked) continue;
      const phase = v.def.pos[0] * 0.7 + v.def.pos[2] * 0.3;
      v.ring.rotation.z += dt * 0.4;
      v.ringInner.rotation.z -= dt * 1.2;
      v.orbit.rotation.z += dt * 0.7;
      v.gate.position.y = Math.sin(this.time * 1.3 + phase) * 0.07;
      v.lh.intensity = 2.2 + Math.sin(this.time * 2.1 + phase) * 0.5;
    }
    // placed portal pairs share the same treatment
    for (const vis of this.placedVis.values()) {
      const vortex = vis.userData.vortex as PortalVortex | undefined;
      vortex?.tick(dt, 1);
      const spin = vis.userData.spin as THREE.Object3D[] | undefined;
      if (spin) { spin[0].rotation.z += dt * 0.9; spin[1].rotation.z -= dt * 1.6; }
    }
  }

  private updateBeams() {
    this.beamGroup.clear();
    const emitters = (this.level.interactables ?? []).filter((i): i is Extract<InteractableDef, { type: 'emitter' }> => i.type === 'emitter');
    if (!emitters.length) return;
    const receivers = (this.level.interactables ?? []).filter((i): i is Extract<InteractableDef, { type: 'receiver' }> => i.type === 'receiver');
    const addSegment = (a: THREE.Vector3, b: THREE.Vector3, mat: THREE.Material) => {
      const len = a.distanceTo(b);
      if (len < 0.05) return;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6), mat);
      cyl.position.copy(a).lerp(b, 0.5);
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.beamGroup.add(cyl);
    };
    for (const em of emitters) {
      const color = em.color ?? PALETTE.portalA;
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 });
      const matches = (r: { accepts?: string }) => !r.accepts || !em.color || em.color === r.accepts;
      const o = new THREE.Vector3(...em.pos);
      const d = new THREE.Vector3(...em.dir).normalize();
      const hit = raycast(this.colliders, em.pos, [d.x, d.y, d.z], 80);
      const end = o.clone().add(d.clone().multiplyScalar(hit?.dist ?? 80));
      addSegment(o, end, mat);
      // relay points: filled prism sockets + prisms carried into the beam
      const relays: THREE.Vector3[] = [];
      for (const s of this.level.interactables ?? []) {
        if (s.type === 'socket') {
          if (!this.states.get(s.id)?.filled) continue;
          relays.push(new THREE.Vector3(...s.pos));
        } else if (s.type === 'carryable' && s.kind === 'prism') {
          if (!this.bodyHeld.get(s.id)) continue;
          const vis = this.interVis.get(s.id);
          if (vis) relays.push(vis.position.clone());
        }
      }
      for (const rp of relays) {
        const t = rp.clone().sub(o).dot(d);
        if (t > 0 && t < (hit?.dist ?? 80) + 0.6 && rp.distanceTo(o.clone().add(d.clone().multiplyScalar(t))) < 1.0) {
          for (const r of receivers) {
            if (matches(r)) addSegment(rp, new THREE.Vector3(...r.pos), mat);
          }
        }
      }
    }
  }
}
