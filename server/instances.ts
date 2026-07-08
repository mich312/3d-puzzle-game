// Instance manager + authoritative level/lobby runtimes (spec §5, §20, §22).
// One live instance per level id (spec adjustment: friends walking into the same
// portal land together; beacons flag an instance as "needs a hand").
import { evalExpr } from '../shared/expr';
import { DEVICES, DEVICE_COMBAT, STARTER_DEVICE, type DeviceId } from '../shared/devices';
import { SKILLS, type SkillId } from '../shared/skills';
import { DOWNED_BLEEDOUT_MS, HP_REGEN_DELAY_MS, HP_REGEN_PER_S, PLAYER_MAX_HP, REVIVE_MS, REVIVE_RANGE } from '../shared/enemies';
import { PLAYER_ACCENTS } from '../shared/palette';
import type { InteractableDef, LevelDef, PortalDef, Vec3 } from '../shared/level';
import type { ClientMsg, InstanceSnapshot, PlayerSnap, ServerMsg } from '../shared/messages';
import { buildColliders, groundHeight, pointNearBox, raycast, segmentClear, v3, type AABB } from './physics';
import { damageEnemy, freezeEnemy, makeEnemy, stepEnemy, type CombatCtx, type EnemyState } from './enemies';
import { getLevel } from './content';
import type { Profile, Store } from './persistence';

const TICK_MS = 50;          // 20 Hz level tick
const LOBBY_TICK_MS = 100;   // 10 Hz lobby tick
const LOBBY_CAP = 24;
const REAP_AFTER_MS = 60_000;
const SLOT_HOLD_MS = 90_000;
const WORLD_SHARD_GATES: Record<string, number> = { atrium: 0, vaults: 3, gardens: 6, observatory: 9 };

export interface ClientLink { send(msg: ServerMsg): void }

interface Charge { n: number; lastRegen: number }

export class PlayerSession {
  id: string;
  link: ClientLink;
  profile: Profile;
  pos: Vec3 = [0, 1, 0];
  yaw = 0; pitch = 0; anim = 0;
  hp = PLAYER_MAX_HP;
  state: 'alive' | 'downed' = 'alive';
  equipped: DeviceId = STARTER_DEVICE;
  carrying?: string;
  echo?: Vec3;
  difficulty: 'story' | 'normal' = 'normal';
  instance?: Instance;
  lastDamageAt = 0;
  downedAt = 0;
  lastCheckpoint = -1;
  charges = new Map<DeviceId, Charge>();
  lastFireAt = new Map<DeviceId, number>();
  overchargeUntil = 0;
  reviveTargetId?: string;
  reviveStartAt = 0;
  tractor?: { targetId: string; aim: Vec3 };
  /** fixed portals only fire once the player has been >2.2m away — prevents
      spawn-adjacent portals from instantly bouncing a fresh joiner back */
  armedPortals = new Set<string>();
  portalCooldownUntil = 0;
  ignoreMovesUntil = 0;
  lastToastAt = 0;
  disconnectedAt?: number;

  constructor(id: string, link: ClientLink, profile: Profile) {
    this.id = id; this.link = link; this.profile = profile;
  }
  get accent() { return this.profile.accent; }
  hasSkill(s: SkillId) { return this.profile.skills.includes(s); }
  cooldownScale() { return Date.now() < this.overchargeUntil ? 0.5 : 1; }
  snap(): PlayerSnap {
    return {
      id: this.id, name: this.profile.name, accent: this.accent,
      p: this.pos, yaw: this.yaw, pitch: this.pitch, anim: this.anim,
      hp: this.hp, state: this.state, equipped: this.equipped,
      carrying: this.carrying, echo: this.echo,
    };
  }
  toast(text: string, kind: 'info' | 'success' | 'warn' = 'info') {
    this.link.send({ t: 'toast', v: 1, text, kind });
  }
}

// ---------- shared instance base ----------
export abstract class Instance {
  id: string;
  players = new Map<string, PlayerSession>();
  emptySince = Date.now();
  constructor(id: string) { this.id = id; }
  abstract kind(): 'lobby' | 'level';
  broadcast(msg: ServerMsg, except?: string) {
    for (const p of this.players.values()) if (p.id !== except) p.link.send(msg);
  }
  abstract snapshot(): InstanceSnapshot;
  removePlayer(p: PlayerSession) {
    this.players.delete(p.id);
    this.broadcast({ t: 'peer_left', v: 1, id: p.id });
    if (this.players.size === 0) this.emptySince = Date.now();
  }
}

// ---------- lobby ----------
export class LobbyInstance extends Instance {
  constructor(id: string, private mgr: GameServer) { super(id); }
  kind() { return 'lobby' as const; }
  snapshot(): InstanceSnapshot {
    return {
      instanceId: this.id, kind: 'lobby',
      levelId: 'nexus',
      players: [...this.players.values()].map((p) => p.snap()),
      beacons: this.mgr.beaconList(),
      serverTime: Date.now(),
    };
  }
  tick() {
    const nexus = getLevel('nexus');
    // fixed portals: walking into one enters that level
    for (const p of this.players.values()) {
      if (Date.now() < p.portalCooldownUntil) continue;
      for (const portal of nexus?.portals ?? []) {
        const d = v3.dist(p.pos, portal.pos);
        if (d > 2.2) { p.armedPortals.add(portal.id); continue; }
        if (d < 1.4 && p.armedPortals.has(portal.id)) {
          const gate = portal.requiresShards ?? 0;
          if (p.profile.shards.length < gate) {
            if (Date.now() - p.lastToastAt > 2500) {
              p.lastToastAt = Date.now();
              p.toast(`Sealed — needs ${gate} shard${gate === 1 ? '' : 's'} (you have ${p.profile.shards.length}).`, 'warn');
            }
            continue;
          }
          const target = portal.linkedTo.split(':')[0];
          if (getLevel(target)) { this.mgr.enterLevel(p, target); return; }
        }
      }
      // lobby has no fail state: catch falls
      if (p.pos[1] < -12) { p.pos = [...(nexus?.spawns['entry'] ?? [0, 1, 0])] as Vec3; p.ignoreMovesUntil = Date.now() + 400; p.link.send({ t: 'respawn', v: 1, id: p.id, p: p.pos }); }
    }
    this.broadcast({ t: 'snap', v: 1, s: this.snapshot() });
  }
}

// ---------- interactable runtime state ----------
type IState = Record<string, number | boolean>;

interface Body { id: string; pos: Vec3; vel: Vec3; spawn: Vec3; mass: 'light' | 'heavy'; kind: string; holders: string[] }

interface PortalPlacement { owner: string; slot: 0 | 1; pos: Vec3; normal: Vec3 }

// ---------- level instance ----------
export class LevelInstance extends Instance {
  level: LevelDef;
  colliders: AABB[];
  states = new Map<string, IState>();
  inter = new Map<string, InteractableDef>();
  bodies = new Map<string, Body>();
  enemies = new Map<string, EnemyState>();
  placements: PortalPlacement[] = [];
  socketFilledBy = new Map<string, string>();
  solved = false;
  solvedVia: 'coop' | 'solo' = 'coop';
  startedAt = Date.now();
  beacon = false;
  killY: number;
  entityPortalCd = new Map<string, number>();

  constructor(id: string, level: LevelDef, private mgr: GameServer) {
    super(id);
    this.level = level;
    this.colliders = buildColliders(level);
    this.killY = Math.min(...level.geometry.map((g) => g.pos[1])) - 15;
    this.seed();
  }
  kind() { return 'level' as const; }

  seed() {
    this.states.clear(); this.inter.clear(); this.bodies.clear(); this.enemies.clear();
    this.placements = []; this.socketFilledBy.clear();
    this.solved = false; this.startedAt = Date.now();
    for (const it of this.level.interactables ?? []) {
      this.inter.set(it.id, it);
      switch (it.type) {
        case 'plate': this.states.set(it.id, { pressed: false, mass: 0 }); break;
        case 'lever': case 'rotator': this.states.set(it.id, { state: 0 }); break;
        case 'switch': this.states.set(it.id, { on: false }); break;
        case 'collectible': this.states.set(it.id, { collected: false }); break;
        case 'socket': this.states.set(it.id, { filled: false }); break;
        case 'receiver': this.states.set(it.id, { lit: false }); break;
        case 'hazard': this.states.set(it.id, { frozen: false, frozenUntil: 0 }); break;
        case 'carryable':
          this.bodies.set(it.id, { id: it.id, pos: [...it.pos] as Vec3, vel: [0, 0, 0], spawn: [...it.pos] as Vec3, mass: it.mass ?? 'light', kind: it.kind ?? 'cube', holders: [] });
          break;
        case 'emitter': break;
      }
    }
    for (const e of this.level.enemies ?? []) this.enemies.set(e.id, makeEnemy(e));
    this.applyExprGeometry();
  }

  // ----- expression state lookup -----
  lookup = (path: string): number | boolean | undefined => {
    if (path === 'allEnemiesDown') {
      for (const e of this.enemies.values()) if (e.state !== 'down') return false;
      return true;
    }
    if (path === 'playersPresent') return this.players.size;
    const [root, prop] = path.split('.');
    const enemy = this.enemies.get(root);
    if (enemy) return prop === 'down' ? enemy.state === 'down' : undefined;
    const st = this.states.get(root);
    if (st && prop !== undefined) return st[prop];
    // door open state
    const doorGeo = this.level.geometry.find((g) => g.door?.id === root);
    if (doorGeo && prop === 'open') { try { return evalExpr(doorGeo.door!.openWhen, this.lookup); } catch { return false; } }
    return undefined;
  };

  private evalSafe(expr: string): boolean {
    try { return evalExpr(expr, this.lookup); } catch { return false; }
  }

  applyExprGeometry() {
    for (const c of this.colliders) {
      const g = this.level.geometry[c.geoIndex];
      let active = true;
      if (g.activeWhen) active = this.evalSafe(g.activeWhen);
      if (g.door) active = !this.evalSafe(g.door.openWhen);   // open door = no collider
      c.active = active;
    }
  }

  setState(id: string, patch: IState) {
    const st = this.states.get(id) ?? {};
    Object.assign(st, patch);
    this.states.set(id, st);
    this.broadcast({ t: 'state_update', v: 1, id, state: st });
  }

  // ----- join/leave -----
  addPlayer(p: PlayerSession, spawnName = 'entry') {
    this.players.set(p.id, p);
    p.instance = this;
    const spawn = this.level.spawns[spawnName] ?? this.level.spawns['entry'];
    // join mid-combat: spawn at nearest checkpoint if any enemy is engaged
    let pos = jitter(spawn);
    if ([...this.enemies.values()].some((e) => e.targetId && e.state !== 'down') && this.level.checkpoints?.length) {
      pos = jitter(this.level.checkpoints[0]);
    }
    p.pos = pos; p.hp = PLAYER_MAX_HP; p.state = 'alive'; p.carrying = undefined; p.echo = undefined;
    p.lastCheckpoint = -1; p.ignoreMovesUntil = Date.now() + 500; p.portalCooldownUntil = Date.now() + 1500;
    p.armedPortals.clear();
    if (this.level.grantsDevice && !p.profile.devices.includes(this.level.grantsDevice)) {
      p.profile.devices.push(this.level.grantsDevice);
      this.mgr.store.saveProfile(p.profile);
      p.link.send({ t: 'devices', v: 1, devices: p.profile.devices, note: this.level.grantsDevice });
      p.toast(`${DEVICES[this.level.grantsDevice].name} acquired — press ${p.profile.devices.length} to equip.`, 'success');
    }
    p.link.send({ t: 'joined', v: 1, snapshot: this.joinSnapshot(), spawn: pos, spawnYaw: 0 });
    this.broadcast({ t: 'peer_joined', v: 1, player: p.snap() }, p.id);
    this.updateBeacon();
    this.mgr.store.telemetry(p.profile.token, 'level_enter', { level: this.level.id, present: this.players.size });
  }

  override removePlayer(p: PlayerSession) {
    for (const b of this.bodies.values()) b.holders = b.holders.filter((h) => h !== p.id);
    p.carrying = undefined; p.tractor = undefined; p.echo = undefined;
    this.placements = this.placements.filter((pl) => pl.owner !== p.id);
    super.removePlayer(p);
    if (this.players.size === 0) this.beacon = false;
    this.updateBeacon();
  }

  snapshot(): InstanceSnapshot { return this.joinSnapshot(); }

  joinSnapshot(): InstanceSnapshot {
    const states: Record<string, IState> = {};
    for (const [id, st] of this.states) states[id] = st;
    return {
      instanceId: this.id, kind: 'level', levelId: this.level.id, level: this.level,
      players: [...this.players.values()].map((p) => p.snap()),
      enemies: this.enemySnaps(), bodies: this.bodySnaps(), states,
      portalsPlaced: this.placements, solved: this.solved, serverTime: Date.now(),
    };
  }
  enemySnaps() {
    return [...this.enemies.values()].map((e) => ({
      id: e.id, type: e.type, p: e.pos, yaw: e.yaw, hp: e.hp, maxHp: e.def.hp,
      state: e.state, frozenUntil: e.frozenUntil || undefined, target: e.targetId,
    }));
  }
  bodySnaps() {
    return [...this.bodies.values()].map((b) => ({ id: b.id, p: b.pos, heldBy: b.holders[0] ?? null }));
  }

  updateBeacon() { this.mgr.pushBeacons(); }

  // ----- interaction handlers -----
  interact(p: PlayerSession, targetId: string) {
    if (p.state === 'downed') return;
    const it = this.inter.get(targetId);
    if (!it || v3.dist(p.pos, (it as { pos: Vec3 }).pos) > 3) return;
    if (it.type === 'lever' || it.type === 'rotator') {
      const states = it.type === 'lever' ? (it.states ?? 2) : it.states;
      const st = this.states.get(it.id)!;
      this.setState(it.id, { state: ((st.state as number) + 1) % states });
      this.applyExprGeometry();
    } else if (it.type === 'collectible') {
      this.pickup(p, it.id);
    }
  }

  pickup(p: PlayerSession, itemId: string) {
    const it = this.inter.get(itemId);
    if (!it || it.type !== 'collectible') return;
    const st = this.states.get(itemId)!;
    if (st.collected) return;
    if (v3.dist(p.pos, it.pos) > 3) return;
    if (p.profile.inventory.length >= 6) { p.toast('Inventory full (6 slots).', 'warn'); return; }
    this.setState(itemId, { collected: true });
    p.profile.inventory.push(it.grants);
    this.mgr.store.saveProfile(p.profile);
    p.link.send({ t: 'inventory', v: 1, inventory: p.profile.inventory });
    p.toast(`Picked up: ${it.grants}`, 'success');
    this.mgr.store.telemetry(p.profile.token, 'pickup', { level: this.level.id, item: it.grants });
  }

  useItem(p: PlayerSession, item: string, socketId: string) {
    const it = this.inter.get(socketId);
    if (!it || it.type !== 'socket' || v3.dist(p.pos, it.pos) > 3) return;
    if (it.accepts !== item || !p.profile.inventory.includes(item)) return;
    const st = this.states.get(socketId)!;
    if (st.filled) return;
    p.profile.inventory = p.profile.inventory.filter((x, i) => i !== p.profile.inventory.indexOf(item));
    this.mgr.store.saveProfile(p.profile);
    this.setState(socketId, { filled: true });
    this.socketFilledBy.set(socketId, p.id);
    p.link.send({ t: 'inventory', v: 1, inventory: p.profile.inventory });
    this.applyExprGeometry();
  }

  grab(p: PlayerSession, targetId: string) {
    if (p.state === 'downed' || p.carrying) return;
    const b = this.bodies.get(targetId);
    if (!b || v3.dist(p.pos, b.pos) > 3) return;
    if (b.holders.includes(p.id)) return;
    if (b.mass === 'heavy' && b.holders.length === 0 && !p.hasSkill('quick-carry')) {
      // first grabber "braces" it — needs a second player (shared-carry) unless Quick Carry
      b.holders.push(p.id);
      p.carrying = targetId;
      p.toast('Too heavy alone — a partner must grab it too (or Quick Carry).', 'info');
      return;
    }
    b.holders.push(p.id);
    p.carrying = targetId;
  }

  release(p: PlayerSession) {
    if (!p.carrying) return;
    const b = this.bodies.get(p.carrying);
    if (b) b.holders = b.holders.filter((h) => h !== p.id);
    p.carrying = undefined;
  }

  // ----- devices -----
  fire(p: PlayerSession, msg: Extract<ClientMsg, { t: 'fire' }>) {
    if (p.state === 'downed') return;
    const dev = DEVICES[msg.device];
    if (!dev || !p.profile.devices.includes(msg.device)) return;
    const now = Date.now();
    if (now - (p.lastFireAt.get(msg.device) ?? 0) < dev.cooldownMs * p.cooldownScale()) return;
    // charges
    if (dev.charges > 0) {
      const c = p.charges.get(msg.device) ?? { n: dev.charges, lastRegen: now };
      if (c.n <= 0) { p.charges.set(msg.device, c); return; }
      c.n--; c.lastRegen = now; p.charges.set(msg.device, c);
    }
    p.lastFireAt.set(msg.device, now);
    const origin: Vec3 = v3.dist(msg.origin, v3.add(p.pos, [0, 1.5, 0])) < 2.5 ? msg.origin : v3.add(p.pos, [0, 1.5, 0]);
    const dir = v3.norm(msg.dir);
    this.broadcast({ t: 'device_effect', v: 1, player: p.id, device: msg.device, origin, dir, targetId: msg.targetId }, p.id);

    const ctx = this.combatCtx(0);
    if (msg.device === 'pulse') {
      const charged = !!msg.charged && p.hasSkill('charged-pulse');
      const dmg = DEVICE_COMBAT.pulseDamage * (charged ? 2 : 1);
      const enemy = this.enemyOnRay(origin, dir, dev.range);
      if (enemy) {
        damageEnemy(enemy, dmg, 'pulse', ctx);
        const kb = DEVICE_COMBAT.pulseKnockback * (charged ? 1.8 : 1);
        enemy.vel = v3.add(enemy.vel, [dir[0] * kb, 1.2, dir[2] * kb]);
        this.mgr.store.telemetry(p.profile.token, 'combat_hit', { level: this.level.id, device: 'pulse', enemy: enemy.type });
      }
      // switches
      for (const it of this.inter.values()) {
        if (it.type !== 'switch') continue;
        if (this.pointOnRay(it.pos, origin, dir, dev.range, 1.2) && segmentClear(this.colliders, origin, it.pos)) {
          const st = this.states.get(it.id)!;
          if (it.latched === false) {
            this.setState(it.id, { on: true });
            setTimeout(() => { this.setState(it.id, { on: false }); this.applyExprGeometry(); }, 3000);
          } else this.setState(it.id, { on: !st.on });
          this.applyExprGeometry();
        }
      }
      // knock carryables
      for (const b of this.bodies.values()) {
        if (b.holders.length === 0 && this.pointOnRay(b.pos, origin, dir, dev.range, 1.0)) {
          b.vel = v3.add(b.vel, [dir[0] * 6, 2.5, dir[2] * 6]);
        }
      }
    } else if (msg.device === 'freeze') {
      const enemy = this.enemyOnRay(origin, dir, dev.range);
      if (enemy) {
        freezeEnemy(enemy, DEVICE_COMBAT.freezeDurationMs, ctx);
        this.mgr.store.telemetry(p.profile.token, 'combat_hit', { level: this.level.id, device: 'freeze', enemy: enemy.type });
      } else {
        for (const it of this.inter.values()) {
          if (it.type !== 'hazard' || it.freezable === false) continue;
          const centre = it.pos;
          if (this.pointOnRay(centre, origin, dir, dev.range, Math.max(...it.size) / 2 + 0.8)) {
            this.setState(it.id, { frozen: true, frozenUntil: Date.now() + 7000 });
          }
        }
      }
    }
  }

  tractorMsg(p: PlayerSession, active: boolean, targetId?: string, aim?: Vec3) {
    if (!active || p.state === 'downed') { p.tractor = undefined; return; }
    if (!p.profile.devices.includes('tractor')) return;
    if (!targetId || !aim) { p.tractor = undefined; return; }
    const valid = this.bodies.has(targetId) || this.enemies.has(targetId);
    if (!valid) { p.tractor = undefined; return; }
    const tpos = this.bodies.get(targetId)?.pos ?? this.enemies.get(targetId)!.pos;
    if (v3.dist(p.pos, tpos) > DEVICES.tractor.range + 2) { p.tractor = undefined; return; }
    p.tractor = { targetId, aim };
  }

  placePortal(p: PlayerSession, slot: 0 | 1, pos: Vec3, normal: Vec3) {
    if (!this.level.placeablePortals?.enabled) { p.toast('Portals find no purchase here.', 'warn'); return; }
    if (!p.profile.devices.includes('portalgun')) return;
    // validate: near a portalSurface collider
    const ok = this.colliders.some((c) => c.portalSurface && c.active && pointNearBox(c, pos, 0.4));
    if (!ok) return;
    this.placements = this.placements.filter((pl) => !(pl.owner === p.id && pl.slot === slot));
    const placement: PortalPlacement = { owner: p.id, slot, pos, normal: v3.norm(normal) };
    this.placements.push(placement);
    this.broadcast({ t: 'portal_placed', v: 1, placement });
  }

  // ----- revive -----
  reviveStart(p: PlayerSession, targetId: string) {
    const target = this.players.get(targetId);
    if (!target || target.state !== 'downed' || p.state === 'downed') return;
    const range = p.hasSkill('field-medic') ? 4 : REVIVE_RANGE;
    if (v3.dist(p.pos, target.pos) > range) return;
    p.reviveTargetId = targetId; p.reviveStartAt = Date.now();
  }

  // ----- reset (softlock protection §19) -----
  reset(byPlayer?: PlayerSession) {
    // refund socketed items to whoever slotted them (if present)
    for (const [socketId, playerId] of this.socketFilledBy) {
      const it = this.inter.get(socketId);
      const owner = this.players.get(playerId);
      if (it?.type === 'socket' && owner && owner.profile.inventory.length < 6) {
        owner.profile.inventory.push(it.accepts);
        this.mgr.store.saveProfile(owner.profile);
        owner.link.send({ t: 'inventory', v: 1, inventory: owner.profile.inventory });
      }
    }
    // collectibles whose item is in someone's inventory stay collected
    const keptCollected = new Set<string>();
    for (const it of this.inter.values()) {
      if (it.type === 'collectible' && [...this.players.values()].some((pl) => pl.profile.inventory.includes(it.grants)))
        keptCollected.add(it.id);
    }
    this.seed();
    for (const id of keptCollected) { const st = this.states.get(id); if (st) st.collected = true; }
    for (const p of this.players.values()) {
      p.pos = [...this.level.spawns['entry']] as Vec3;
      p.hp = PLAYER_MAX_HP; p.state = 'alive'; p.carrying = undefined; p.echo = undefined;
      p.lastCheckpoint = -1; p.ignoreMovesUntil = Date.now() + 500; p.portalCooldownUntil = Date.now() + 1500;
      p.link.send({ t: 'joined', v: 1, snapshot: this.joinSnapshot(), spawn: p.pos, spawnYaw: 0 });
    }
    this.broadcast({ t: 'reset_done', v: 1 });
    if (byPlayer) this.mgr.store.telemetry(byPlayer.profile.token, 'reset', { level: this.level.id });
  }

  // ----- helpers -----
  pointOnRay(point: Vec3, origin: Vec3, dir: Vec3, range: number, tol: number): boolean {
    const rel = v3.sub(point, origin);
    const t = rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2];
    if (t < 0 || t > range) return false;
    const closest: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    return v3.dist(closest, point) < tol;
  }

  enemyOnRay(origin: Vec3, dir: Vec3, range: number): EnemyState | null {
    let best: EnemyState | null = null;
    let bestT = Infinity;
    for (const e of this.enemies.values()) {
      if (e.state === 'down') continue;
      const centre: Vec3 = [e.pos[0], e.pos[1] + e.def.height / 2, e.pos[2]];
      const rel = v3.sub(centre, origin);
      const t = rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2];
      if (t < 0 || t > range) continue;
      const closest: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      if (v3.dist(closest, centre) < e.def.radius + DEVICE_COMBAT.hitTolerance) {
        if (t < bestT && segmentClear(this.colliders, origin, centre)) { bestT = t; best = e; }
      }
    }
    return best;
  }

  combatCtx(dt: number): CombatCtx {
    return {
      now: Date.now(), dt,
      colliders: this.colliders,
      killY: this.killY,
      alivePlayers: () => [...this.players.values()].filter((p) => p.state === 'alive').map((p) => ({ id: p.id, pos: p.pos })),
      damagePlayer: (id, dmg, source) => this.damagePlayer(id, dmg, source),
      event: (id, ev, data) => this.broadcast({ t: 'enemy_event', v: 1, id, ev, data }),
      addEnemy: (e) => this.enemies.set(e.id, e),
      isTractored: (enemyId) => [...this.players.values()].some((pl) => pl.tractor?.targetId === enemyId),
    };
  }

  damagePlayer(id: string, dmg: number, source: string) {
    const p = this.players.get(id);
    if (!p || p.state === 'downed') return;
    const actual = Math.round(dmg * (p.difficulty === 'story' ? 0.4 : 1));
    p.hp = Math.max(0, p.hp - actual);
    p.lastDamageAt = Date.now();
    this.broadcast({ t: 'hp', v: 1, id, hp: p.hp });
    if (p.hp <= 0) {
      p.state = 'downed'; p.downedAt = Date.now();
      this.release(p); p.tractor = undefined;
      this.broadcast({ t: 'downed', v: 1, id });
      this.mgr.store.telemetry(p.profile.token, 'downed', { level: this.level.id, source });
    }
  }

  respawn(p: PlayerSession) {
    const cp = p.lastCheckpoint >= 0 ? this.level.checkpoints?.[p.lastCheckpoint] : undefined;
    p.pos = [...(cp ?? this.level.spawns['entry'])] as Vec3;
    p.hp = PLAYER_MAX_HP; p.state = 'alive';
    p.ignoreMovesUntil = Date.now() + 500;
    this.broadcast({ t: 'respawn', v: 1, id: p.id, p: p.pos });
    this.mgr.store.telemetry(p.profile.token, 'respawn', { level: this.level.id });
  }

  // ----- main tick -----
  tick() {
    const now = Date.now();
    const dt = TICK_MS / 1000;

    // charge regen
    for (const p of this.players.values()) {
      for (const [devId, c] of p.charges) {
        const dev = DEVICES[devId];
        if (dev.charges > 0 && c.n < dev.charges && now - c.lastRegen >= dev.chargeRegenMs) {
          c.n++; c.lastRegen = now;
        }
      }
    }

    // held bodies follow holders; loose bodies fall; tractor moves targets
    for (const b of this.bodies.values()) {
      b.holders = b.holders.filter((h) => this.players.get(h)?.state === 'alive');
      const needsTwo = b.mass === 'heavy';
      const canCarry = b.holders.length >= 2 || (b.holders.length === 1 && (!needsTwo || this.players.get(b.holders[0])!.hasSkill('quick-carry')));
      if (b.holders.length > 0 && canCarry) {
        const hs = b.holders.map((h) => this.players.get(h)!);
        const cx = hs.reduce((s, h) => s + h.pos[0], 0) / hs.length;
        const cy = hs.reduce((s, h) => s + h.pos[1], 0) / hs.length;
        const cz = hs.reduce((s, h) => s + h.pos[2], 0) / hs.length;
        // player forward is (-sin yaw, 0, -cos yaw) — carry held objects in front
        const fx = hs.reduce((s, h) => s - Math.sin(h.yaw), 0) / hs.length;
        const fz = hs.reduce((s, h) => s - Math.cos(h.yaw), 0) / hs.length;
        b.pos = [cx + fx * 1.2, cy + 1.0, cz + fz * 1.2];
        b.vel = [0, 0, 0];
        continue;
      }
      // tractor override
      const puller = [...this.players.values()].find((pl) => pl.tractor?.targetId === b.id);
      if (puller?.tractor) {
        const to = puller.tractor.aim;
        const d = v3.sub(to, b.pos);
        const l = v3.len(d);
        if (l > 0.3) {
          const step = Math.min(l, DEVICE_COMBAT.tractorPullForce * dt);
          b.pos = v3.add(b.pos, v3.scale(v3.norm(d), step));
        }
        b.vel = [0, 0, 0];
        continue;
      }
      // gravity + rest
      const g = groundHeight(this.colliders, b.pos[0], b.pos[1], b.pos[2]);
      b.pos = v3.add(b.pos, v3.scale(b.vel, dt));
      b.vel[0] *= Math.max(0, 1 - 4 * dt); b.vel[2] *= Math.max(0, 1 - 4 * dt);
      if (g !== null && b.pos[1] <= g + 0.31) { b.pos[1] = g + 0.3; b.vel[1] = 0; }
      else { b.vel[1] -= 22 * dt; }
      if (b.pos[1] < this.killY) { b.pos = [...b.spawn] as Vec3; b.vel = [0, 0, 0]; }  // auto-unstick
    }

    // tractor on enemies: drag toward aim
    for (const pl of this.players.values()) {
      if (!pl.tractor) continue;
      const e = this.enemies.get(pl.tractor.targetId);
      if (e && e.state !== 'down') {
        const d = v3.sub(pl.tractor.aim, e.pos);
        const l = v3.len(d);
        if (l > 0.5) {
          const pull = e.def.twoRole ? 0 : DEVICE_COMBAT.tractorPullForce * 0.55;   // colossus: exposes core, doesn't move
          e.pos = v3.add(e.pos, v3.scale(v3.norm([d[0], 0, d[2]]), Math.min(l, pull * dt)));
        }
      }
    }

    // plates: player/echo/body mass
    for (const it of this.inter.values()) {
      if (it.type !== 'plate') continue;
      const size = it.size ?? [2.4, 0.4, 2.4];
      const onPlate = (pos: Vec3) =>
        Math.abs(pos[0] - it.pos[0]) < size[0] / 2 + 0.35 &&
        Math.abs(pos[2] - it.pos[2]) < size[2] / 2 + 0.35 &&
        Math.abs(pos[1] - it.pos[1]) < 1.4;
      let mass = 0;
      for (const p of this.players.values()) {
        if (p.state === 'alive' && onPlate(p.pos)) mass += 1;
        if (p.echo && onPlate(p.echo)) mass += 1;
      }
      for (const b of this.bodies.values()) if (onPlate(b.pos)) mass += b.mass === 'heavy' ? 3 : 1;
      const pressed = it.reads === 'mass' ? mass >= (it.threshold ?? 1) : mass > 0;
      const st = this.states.get(it.id)!;
      if (st.pressed !== pressed || st.mass !== mass) {
        this.setState(it.id, { pressed, mass });
        this.applyExprGeometry();
      }
    }

    // hazards: unfreeze timers + damage
    for (const it of this.inter.values()) {
      if (it.type !== 'hazard') continue;
      const st = this.states.get(it.id)!;
      if (st.frozen && now > (st.frozenUntil as number)) { this.setState(it.id, { frozen: false, frozenUntil: 0 }); }
      if (st.frozen) continue;
      for (const p of this.players.values()) {
        if (p.state !== 'alive') continue;
        const inside =
          Math.abs(p.pos[0] - it.pos[0]) < it.size[0] / 2 &&
          p.pos[1] + 0.9 > it.pos[1] - it.size[1] / 2 && p.pos[1] < it.pos[1] + it.size[1] / 2 &&
          Math.abs(p.pos[2] - it.pos[2]) < it.size[2] / 2;
        if (!inside) continue;
        if (it.kind === 'void') { this.damagePlayer(p.id, 12, it.id); this.respawn(p); }
        else this.damagePlayer(p.id, (it.dps ?? 20) * dt, it.id);
      }
    }

    // beams
    this.stepBeams();

    // enemies
    const ctx = this.combatCtx(dt);
    for (const e of [...this.enemies.values()]) stepEnemy(e, ctx);

    // players: falls, checkpoints, regen, bleedout, revive progress, portal traversal
    for (const p of this.players.values()) {
      if (p.pos[1] < this.killY + 5 && p.state === 'alive') { this.damagePlayer(p.id, 10, 'fall'); this.respawn(p); }
      this.level.checkpoints?.forEach((cp, i) => {
        if (i > p.lastCheckpoint && v3.dist(p.pos, cp) < 3.5) p.lastCheckpoint = i;
      });
      if (p.state === 'alive' && p.hp < PLAYER_MAX_HP && now - p.lastDamageAt > HP_REGEN_DELAY_MS) {
        p.hp = Math.min(PLAYER_MAX_HP, p.hp + HP_REGEN_PER_S * dt);
        if (Math.floor(p.hp) % 5 === 0) this.broadcast({ t: 'hp', v: 1, id: p.id, hp: Math.round(p.hp) });
      }
      if (p.state === 'downed') {
        const anyAlive = [...this.players.values()].some((o) => o.id !== p.id && o.state === 'alive');
        const limit = anyAlive ? DOWNED_BLEEDOUT_MS : 4000;
        if (now - p.downedAt > limit) this.respawn(p);
      }
      if (p.reviveTargetId) {
        const target = this.players.get(p.reviveTargetId);
        const range = p.hasSkill('field-medic') ? 4 : REVIVE_RANGE;
        const duration = p.hasSkill('field-medic') ? REVIVE_MS / 2 : REVIVE_MS;
        if (!target || target.state !== 'downed' || p.state === 'downed' || v3.dist(p.pos, target.pos) > range) {
          p.reviveTargetId = undefined;
        } else {
          const pct = (now - p.reviveStartAt) / duration;
          this.broadcast({ t: 'revive_progress', v: 1, id: target.id, pct: Math.min(1, pct) });
          if (pct >= 1) {
            target.state = 'alive'; target.hp = 60; target.downedAt = 0;
            this.broadcast({ t: 'revived', v: 1, id: target.id, by: p.id });
            if (p.hasSkill('overcharge')) p.overchargeUntil = now + 10_000;
            p.reviveTargetId = undefined;
            this.mgr.store.telemetry(p.profile.token, 'revive', { level: this.level.id });
          }
        }
      }
      this.stepPortalTraversal(p);
      this.stepFixedPortals(p);
    }

    // placeable portals also move loose bodies + enemies
    this.stepEntityPortals();

    // solved?
    if (!this.solved && this.level.puzzle) {
      const base = this.evalSafe(this.level.puzzle.solved);
      const solo = this.level.puzzle.soloSolution ? this.evalSafe(this.level.puzzle.soloSolution) : false;
      if (base || solo) this.onSolved(base ? (this.players.size > 1 ? 'coop' : 'solo') : 'solo');
    }

    this.broadcast({ t: 'snap', v: 1, s: this.tickSnapshot() });
  }

  stepBeams() {
    const emitters = [...this.inter.values()].filter((i) => i.type === 'emitter');
    const receivers = [...this.inter.values()].filter((i) => i.type === 'receiver');
    if (!emitters.length || !receivers.length) return;
    const lit = new Set<string>();
    for (const em of emitters) {
      if (em.type !== 'emitter') continue;
      const dir = v3.norm(em.dir);
      const hit = raycast(this.colliders, em.pos, dir, 80);
      const maxT = hit?.dist ?? 80;
      for (const r of receivers) {
        if (this.pointOnRay(r.pos, em.pos, dir, maxT + 0.6, 0.8)) lit.add(r.id);
      }
      // prism redirect: filled socket on the beam relays to any receiver with clear LOS
      for (const s of this.inter.values()) {
        if (s.type !== 'socket') continue;
        const st = this.states.get(s.id)!;
        if (!st.filled) continue;
        if (this.pointOnRay(s.pos, em.pos, dir, maxT + 0.6, 0.9)) {
          for (const r of receivers) if (segmentClear(this.colliders, s.pos, r.pos)) lit.add(r.id);
        }
      }
    }
    for (const r of receivers) {
      const st = this.states.get(r.id)!;
      const isLit = lit.has(r.id);
      if (st.lit !== isLit) { this.setState(r.id, { lit: isLit }); this.applyExprGeometry(); }
    }
  }

  stepPortalTraversal(p: PlayerSession) {
    if (Date.now() < p.portalCooldownUntil) return;
    for (const pl of this.placements) {
      const pair = this.placements.find((o) => o.owner === pl.owner && o.slot !== pl.slot);
      if (!pair) continue;
      if (v3.dist(p.pos, pl.pos) < 1.1) {
        p.pos = v3.add(pair.pos, v3.scale(pair.normal, 1.0));
        p.pos[1] = Math.max(p.pos[1], (groundHeight(this.colliders, p.pos[0], p.pos[1] + 2, p.pos[2]) ?? p.pos[1]));
        p.portalCooldownUntil = Date.now() + 1200;
        p.ignoreMovesUntil = Date.now() + 400;
        this.broadcast({ t: 'portal_traverse', v: 1, player: p.id, to: p.pos });
        return;
      }
    }
  }

  stepEntityPortals() {
    const now = Date.now();
    const tryTeleport = (id: string, pos: Vec3): Vec3 | null => {
      if (now < (this.entityPortalCd.get(id) ?? 0)) return null;
      for (const pl of this.placements) {
        const pair = this.placements.find((o) => o.owner === pl.owner && o.slot !== pl.slot);
        if (!pair) continue;
        if (v3.dist(pos, pl.pos) < 1.0) {
          this.entityPortalCd.set(id, now + 1200);
          return v3.add(pair.pos, v3.scale(pair.normal, 1.0));
        }
      }
      return null;
    };
    for (const b of this.bodies.values()) {
      if (b.holders.length) continue;
      const to = tryTeleport(b.id, b.pos);
      if (to) b.pos = to;
    }
    for (const e of this.enemies.values()) {
      if (e.state === 'down') continue;
      const to = tryTeleport(e.id, e.pos);
      if (to) e.pos = to;
    }
  }

  stepFixedPortals(p: PlayerSession) {
    if (Date.now() < p.portalCooldownUntil || p.state === 'downed') return;
    for (const portal of this.level.portals ?? []) {
      const d = v3.dist(p.pos, portal.pos);
      if (d > 2.2) { p.armedPortals.add(portal.id); continue; }
      if (d > 1.4 || !p.armedPortals.has(portal.id)) continue;
      if (portal.requiresSolved && !this.solved) {
        if (Date.now() - p.lastToastAt > 2500) { p.lastToastAt = Date.now(); p.toast('The Threshold is still sealed.', 'warn'); }
        continue;
      }
      const [target, spawnName] = portal.linkedTo.split(':');
      if (target === 'nexus') { this.mgr.toLobby(p); return; }
      if (getLevel(target)) { this.mgr.enterLevel(p, target, spawnName); return; }
    }
  }

  onSolved(via: 'coop' | 'solo') {
    this.solved = true; this.solvedVia = via;
    const timeMs = Date.now() - this.startedAt;
    const pz = this.level.puzzle!;
    for (const p of this.players.values()) {
      const firstClear = !p.profile.shards.includes(pz.shard);
      if (firstClear) {
        p.profile.shards.push(pz.shard);
        p.profile.skillPoints += pz.skillPoints ?? 1;
      }
      const best = p.profile.bestTimes[this.level.id];
      if (!best || timeMs < best) p.profile.bestTimes[this.level.id] = timeMs;
      this.mgr.store.saveProfile(p.profile);
      p.link.send({ t: 'solved', v: 1, levelId: this.level.id, via, timeMs, shard: pz.shard, skillPoints: firstClear ? (pz.skillPoints ?? 1) : 0 });
      p.link.send({ t: 'shards', v: 1, shards: p.profile.shards, unlockedWorlds: unlockedWorlds(p.profile) });
      p.link.send({ t: 'skills', v: 1, skills: p.profile.skills, skillPoints: p.profile.skillPoints });
      if (p.hasSkill('overcharge')) p.overchargeUntil = Date.now() + 10_000;
      this.mgr.store.telemetry(p.profile.token, 'solved', { level: this.level.id, via, timeMs, present: this.players.size });
    }
    this.beacon = false;
    this.updateBeacon();
  }

  tickSnapshot(): InstanceSnapshot {
    return {
      instanceId: this.id, kind: 'level', levelId: this.level.id,
      players: [...this.players.values()].map((p) => p.snap()),
      enemies: this.enemySnaps(), bodies: this.bodySnaps(),
      portalsPlaced: this.placements, solved: this.solved, serverTime: Date.now(),
    };
  }
}

/** offset spawns slightly so simultaneous joiners don't stack inside each other */
function jitter(p: Vec3): Vec3 {
  const a = Math.random() * Math.PI * 2;
  const r = 0.4 + Math.random() * 0.8;
  return [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r];
}

export function unlockedWorlds(profile: Profile): string[] {
  const n = profile.shards.length;
  return Object.entries(WORLD_SHARD_GATES).filter(([, gate]) => n >= gate).map(([w]) => w);
}

// ---------- game server (instance manager + dispatch) ----------
export class GameServer {
  lobbies: LobbyInstance[] = [];
  levels = new Map<string, LevelInstance>();
  sessions = new Map<string, PlayerSession>();          // by player id
  byToken = new Map<string, PlayerSession>();
  private levelTimer: ReturnType<typeof setInterval>;
  private lobbyTimer: ReturnType<typeof setInterval>;

  constructor(public store: Store) {
    this.levelTimer = setInterval(() => this.tickLevels(), TICK_MS);
    this.lobbyTimer = setInterval(() => this.tickLobbies(), LOBBY_TICK_MS);
  }

  stop() { clearInterval(this.levelTimer); clearInterval(this.lobbyTimer); }

  tickLevels() {
    const now = Date.now();
    for (const [id, inst] of this.levels) {
      if (inst.players.size > 0) inst.tick();
      else if (now - inst.emptySince > REAP_AFTER_MS) this.levels.delete(id);
    }
  }
  tickLobbies() {
    for (const l of this.lobbies) l.tick();
  }

  connect(link: ClientLink, token?: string, name?: string): PlayerSession {
    const profile = this.store.getOrCreateProfile(token);
    // reconnection: same token within slot-hold window → resume session
    const existing = this.byToken.get(profile.token);
    if (existing && existing.disconnectedAt && Date.now() - existing.disconnectedAt < SLOT_HOLD_MS) {
      existing.link = link;
      existing.disconnectedAt = undefined;
      if (name) { existing.profile.name = name.slice(0, 24); this.store.saveProfile(existing.profile); }
      return existing;
    }
    if (existing) this.disconnect(existing, true);
    const id = `p${Math.random().toString(36).slice(2, 9)}`;
    const p = new PlayerSession(id, link, profile);
    if (!profile.accent) profile.accent = PLAYER_ACCENTS[this.sessions.size % PLAYER_ACCENTS.length];
    if (name) profile.name = name.slice(0, 24);
    this.store.saveProfile(profile);
    this.sessions.set(id, p);
    this.byToken.set(profile.token, p);
    return p;
  }

  welcome(p: PlayerSession) {
    p.link.send({
      t: 'welcome', v: 1, playerId: p.id, token: p.profile.token,
      profile: {
        name: p.profile.name, accent: p.profile.accent, shards: p.profile.shards,
        skillPoints: p.profile.skillPoints, skills: p.profile.skills,
        devices: p.profile.devices, inventory: p.profile.inventory,
        bestTimes: p.profile.bestTimes, unlockedWorlds: unlockedWorlds(p.profile),
      },
    });
  }

  /** After hello: resume live instance or drop into a lobby. */
  place(p: PlayerSession, target?: string) {
    if (p.instance) {          // reconnection into live instance
      const inst = p.instance;
      if (inst instanceof LevelInstance) {
        p.link.send({ t: 'joined', v: 1, snapshot: inst.joinSnapshot(), spawn: p.pos, spawnYaw: p.yaw });
        return;
      }
    }
    if (target && this.levels.has(target)) { this.joinInstance(p, target); return; }
    this.toLobby(p);
  }

  toLobby(p: PlayerSession) {
    p.instance?.removePlayer(p);
    let lobby = this.lobbies.find((l) => l.players.size < LOBBY_CAP);
    if (!lobby) {
      lobby = new LobbyInstance(`lobby-${this.lobbies.length}`, this);
      this.lobbies.push(lobby);
    }
    p.instance = lobby;
    const nexus = getLevel('nexus');
    p.pos = jitter(nexus?.spawns['entry'] ?? [0, 1, 0]);
    p.hp = PLAYER_MAX_HP; p.state = 'alive'; p.carrying = undefined; p.tractor = undefined; p.echo = undefined;
    p.portalCooldownUntil = Date.now() + 1500;
    p.ignoreMovesUntil = Date.now() + 500;
    p.armedPortals.clear();
    lobby.players.set(p.id, p);
    const snap = lobby.snapshot();
    snap.level = nexus;
    p.link.send({ t: 'joined', v: 1, snapshot: snap, spawn: p.pos, spawnYaw: 0 });
    lobby.broadcast({ t: 'peer_joined', v: 1, player: p.snap() }, p.id);
  }

  enterLevel(p: PlayerSession, levelId: string, spawnName = 'entry') {
    const def = getLevel(levelId);
    if (!def) { p.toast('That way is closed.', 'warn'); return; }
    p.instance?.removePlayer(p);
    let inst = this.levels.get(levelId);
    if (!inst) {
      inst = new LevelInstance(`lvl-${levelId}-${Date.now().toString(36)}`, def, this);
      this.levels.set(levelId, inst);
    }
    if (inst.players.size >= def.players.max) { p.toast('That threshold is crowded — try again soon.', 'warn'); this.toLobby(p); return; }
    inst.addPlayer(p, spawnName);
  }

  joinInstance(p: PlayerSession, key: string) {
    // key may be a level id or an instance id
    let inst = this.levels.get(key);
    if (!inst) inst = [...this.levels.values()].find((i) => i.id === key);
    if (!inst) { this.toLobby(p); return; }
    p.instance?.removePlayer(p);
    inst.addPlayer(p);
  }

  beaconList() {
    const out: NonNullable<InstanceSnapshot['beacons']> = [];
    for (const inst of this.levels.values()) {
      if (inst.beacon && inst.players.size > 0) {
        out.push({
          instanceId: inst.id, level: inst.level.id, levelName: inst.level.name,
          present: inst.players.size, needed: Math.max(0, inst.level.players.min - inst.players.size),
        });
      }
    }
    return out;
  }
  pushBeacons() {
    const beacons = this.beaconList();
    for (const l of this.lobbies) l.broadcast({ t: 'beacons', v: 1, beacons });
  }

  disconnect(p: PlayerSession, immediate = false) {
    p.disconnectedAt = Date.now();
    if (immediate) {
      p.instance?.removePlayer(p);
      this.sessions.delete(p.id);
      this.byToken.delete(p.profile.token);
      return;
    }
    // hold slot ~90s; then fully remove
    setTimeout(() => {
      if (p.disconnectedAt && Date.now() - p.disconnectedAt >= SLOT_HOLD_MS - 100) {
        p.instance?.removePlayer(p);
        this.sessions.delete(p.id);
        if (this.byToken.get(p.profile.token) === p) this.byToken.delete(p.profile.token);
      }
    }, SLOT_HOLD_MS);
  }

  // ---------- message dispatch ----------
  handle(p: PlayerSession, msg: ClientMsg) {
    const inst = p.instance;
    switch (msg.t) {
      case 'move': {
        if (Date.now() < p.ignoreMovesUntil) break;
        const d = v3.dist(p.pos, msg.p);
        if (d > 12) break;                       // teleport sanity
        p.pos = msg.p; p.yaw = msg.yaw; p.pitch = msg.pitch; p.anim = msg.anim ?? 0;
        break;
      }
      case 'enter_level': this.enterLevel(p, msg.level); break;
      case 'join_instance': this.joinInstance(p, msg.instanceId); break;
      case 'leave_level': this.toLobby(p); break;
      case 'raise_beacon':
        if (inst instanceof LevelInstance) { inst.beacon = true; this.pushBeacons(); p.toast('Beacon raised — the Nexus can see you need a hand.', 'success'); }
        break;
      case 'lower_beacon':
        if (inst instanceof LevelInstance) { inst.beacon = false; this.pushBeacons(); }
        break;
      case 'interact': if (inst instanceof LevelInstance) inst.interact(p, msg.target); break;
      case 'grab': if (inst instanceof LevelInstance) inst.grab(p, msg.target); break;
      case 'release': if (inst instanceof LevelInstance) inst.release(p); break;
      case 'fire': if (inst instanceof LevelInstance) inst.fire(p, msg); break;
      case 'tractor': if (inst instanceof LevelInstance) inst.tractorMsg(p, msg.active, msg.targetId, msg.aim); break;
      case 'place_portal': if (inst instanceof LevelInstance) inst.placePortal(p, msg.slot, msg.pos, msg.normal); break;
      case 'equip':
        if (p.profile.devices.includes(msg.device)) p.equipped = msg.device;
        break;
      case 'pickup': if (inst instanceof LevelInstance) inst.pickup(p, msg.itemId); break;
      case 'use_item': if (inst instanceof LevelInstance) inst.useItem(p, msg.item, msg.socketId); break;
      case 'unlock_skill': {
        const def = SKILLS[msg.skill];
        if (!def || p.profile.skills.includes(msg.skill)) break;
        if (def.requires && !p.profile.skills.includes(def.requires)) break;
        if (p.profile.skillPoints < def.cost) break;
        p.profile.skillPoints -= def.cost;
        p.profile.skills.push(msg.skill);
        this.store.saveProfile(p.profile);
        p.link.send({ t: 'skills', v: 1, skills: p.profile.skills, skillPoints: p.profile.skillPoints });
        break;
      }
      case 'respec': {
        const refund = p.profile.skills.reduce((s, id) => s + (SKILLS[id]?.cost ?? 0), 0);
        p.profile.skillPoints += refund;
        p.profile.skills = [];
        this.store.saveProfile(p.profile);
        p.link.send({ t: 'skills', v: 1, skills: [], skillPoints: p.profile.skillPoints });
        break;
      }
      case 'revive_start': if (inst instanceof LevelInstance) inst.reviveStart(p, msg.target); break;
      case 'revive_cancel': p.reviveTargetId = undefined; break;
      case 'reset_level': if (inst instanceof LevelInstance) inst.reset(p); break;
      case 'echo':
        if (!p.hasSkill('echo-core')) break;
        p.echo = msg.place ? ([...p.pos] as Vec3) : undefined;
        break;
      case 'set_opts': if (msg.difficulty) p.difficulty = msg.difficulty; break;
      case 'set_name':
        p.profile.name = msg.name.slice(0, 24) || p.profile.name;
        this.store.saveProfile(p.profile);
        break;
      case 'telemetry': this.store.telemetry(p.profile.token, msg.name, msg.payload ?? {}); break;
    }
  }
}
