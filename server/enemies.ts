// Server-side enemy AI (spec §15): small FSM per enemy, telegraphed attacks,
// puzzle-flavored vulnerabilities (freeze/shatter, pulse-stagger, tractor-expose).
import { ENEMIES, type EnemyDef, type EnemyType } from '../shared/enemies';
import type { EnemySpawnDef, Vec3 } from '../shared/level';
import { groundHeight, v3, type AABB } from './physics';

export type EnemyFsm = 'idle' | 'chase' | 'telegraph' | 'attack' | 'cooldown' | 'frozen' | 'staggered' | 'down';

export interface EnemyState {
  id: string;
  type: EnemyType;
  def: EnemyDef;
  pos: Vec3;                // feet
  yaw: number;
  vel: Vec3;                // knockback / falling
  hp: number;
  state: EnemyFsm;
  home: Vec3;
  patrol?: Vec3[];
  patrolIdx: number;
  targetId?: string;
  frozenUntil: number;
  staggeredUntil: number;   // warden vulnerability window
  telegraphUntil: number;
  telegraphPos?: Vec3;      // sower ranged: locked target position
  nextAttackAt: number;
  cooldownUntil: number;
  nextSpawnAt: number;      // sower adds
  addCount: number;
  isAdd?: boolean;
  fellOut?: boolean;
  linkedTo?: string;        // warden pairs: partner sharing one shield
  woken?: boolean;          // mimic: sprung its ambush (full aggro from then on)
}

export interface CombatCtx {
  now: number;
  dt: number;
  colliders: AABB[];
  killY: number;
  alivePlayers(): { id: string; pos: Vec3 }[];
  damagePlayer(id: string, dmg: number, source: string): void;
  event(id: string, ev: 'telegraph' | 'attack' | 'hit' | 'frozen' | 'shatter' | 'stagger' | 'down' | 'spawn', data?: Record<string, unknown>): void;
  addEnemy(e: EnemyState): void;
  isTractored(enemyId: string): boolean;
  getEnemy(id: string): EnemyState | undefined;
}

export function makeEnemy(def: EnemySpawnDef): EnemyState {
  const d = ENEMIES[def.type];
  return {
    id: def.id, type: def.type, def: d,
    pos: [...def.spawn] as Vec3, yaw: 0, vel: [0, 0, 0],
    hp: d.hp, state: 'idle',
    home: [...def.spawn] as Vec3, patrol: def.patrol, patrolIdx: 0,
    frozenUntil: 0, staggeredUntil: 0, telegraphUntil: 0,
    nextAttackAt: 0, cooldownUntil: 0, nextSpawnAt: 0, addCount: 0,
    linkedTo: def.linkedTo,
  };
}

/** Apply damage to an enemy. kind: 'pulse' | 'freeze' | 'generic' | 'fall'. Returns actual damage. */
export function damageEnemy(e: EnemyState, dmg: number, kind: string, ctx: CombatCtx): number {
  if (e.state === 'down') return 0;
  const now = ctx.now;

  // Frozen + pulse = shatter (environmental kill)
  if (e.state === 'frozen' && kind === 'pulse') {
    e.hp = 0;
    e.state = 'down';
    ctx.event(e.id, 'shatter');
    ctx.event(e.id, 'down', { via: 'shatter' });
    return 9999;
  }
  // Mimic: any hit springs the ambush
  if (e.type === 'mimic') e.woken = true;
  // Warden shield: immune until pulse-staggered; the staggering hit itself deals no
  // damage. Linked pairs share one shield — BOTH must be staggered at the same time.
  if (e.def.shielded) {
    const partner = e.linkedTo ? ctx.getEnemy(e.linkedTo) : undefined;
    const partnerOpen = !partner || partner.state === 'down' || now < partner.staggeredUntil;
    const vulnerable = now < e.staggeredUntil && partnerOpen;
    if (kind === 'pulse' && now >= e.staggeredUntil) {
      e.staggeredUntil = now + (e.def.staggerWindowMs ?? 3000);
      if (e.state !== 'frozen') e.state = 'staggered';
      ctx.event(e.id, 'stagger');
      return 0;
    }
    if (!vulnerable && kind !== 'fall') {
      ctx.event(e.id, 'hit', { blocked: true });
      return 0;
    }
  }
  // Colossus: only takes damage while a tractor beam exposes its core (or from falls)
  if (e.def.twoRole && kind !== 'fall' && !ctx.isTractored(e.id)) {
    ctx.event(e.id, 'hit', { blocked: true });
    return 0;
  }
  e.hp = Math.max(0, e.hp - dmg);
  ctx.event(e.id, 'hit', { dmg });
  if (e.hp <= 0) {
    e.state = 'down';
    ctx.event(e.id, 'down', { via: kind });
  }
  return dmg;
}

export function freezeEnemy(e: EnemyState, durationMs: number, ctx: CombatCtx): boolean {
  if (e.state === 'down' || !e.def.freezable) return false;
  e.state = 'frozen';
  e.frozenUntil = ctx.now + durationMs;
  ctx.event(e.id, 'frozen', { until: e.frozenUntil });
  return true;
}

export function stepEnemy(e: EnemyState, ctx: CombatCtx): void {
  if (e.state === 'down') return;
  const { now, dt } = ctx;
  const d = e.def;

  // knockback integration — horizontal only; vertical is owned by the ground logic below
  const speed2 = Math.hypot(e.vel[0], e.vel[2]);
  if (speed2 > 0.01) {
    e.pos[0] += e.vel[0] * dt;
    e.pos[2] += e.vel[2] * dt;
    e.vel[0] *= Math.max(0, 1 - 6 * dt);
    e.vel[2] *= Math.max(0, 1 - 6 * dt);
  }
  const g = groundHeight(ctx.colliders, e.pos[0], e.pos[1] + 0.5, e.pos[2]);
  if (g === null) {
    e.vel[1] -= 22 * dt;                       // falling — pushed off a ledge
    e.pos[1] += e.vel[1] * dt;
    if (e.pos[1] < ctx.killY) {
      e.hp = 0; e.state = 'down'; e.fellOut = true;
      ctx.event(e.id, 'down', { via: 'fall' });
    }
    return;
  } else {
    if (e.pos[1] > g + 0.05) {
      e.vel[1] -= 22 * dt;
      e.pos[1] = Math.max(g, e.pos[1] + e.vel[1] * dt);
    } else { e.pos[1] = g; e.vel[1] = 0; }
  }

  if (e.state === 'frozen') {
    if (now >= e.frozenUntil) e.state = 'cooldown', e.cooldownUntil = now + 300;
    return;
  }
  if (e.state === 'staggered' && now >= e.staggeredUntil) e.state = 'chase';

  // acquire target: nearest alive player in aggro range (1.6x leash while chasing)
  const players = ctx.alivePlayers();
  let target: { id: string; pos: Vec3 } | undefined;
  let bestD = Infinity;
  for (const p of players) {
    const dist = v3.dist(e.pos, p.pos);
    if (dist < bestD) { bestD = dist; target = p; }
  }
  const engaged = e.targetId !== undefined;
  // a woken mimic hunts at full range; a dormant one only feels footsteps beside it
  const baseRange = e.type === 'mimic' && e.woken ? 16 : d.aggroRange;
  const range = engaged ? baseRange * 1.6 : baseRange;
  if (!target || bestD > range) {
    e.targetId = undefined;
    // patrol / idle drift
    if (e.patrol && e.patrol.length > 0 && e.state !== 'telegraph') {
      const wp = e.patrol[e.patrolIdx];
      if (v3.distXZ(e.pos, wp) < 0.5) e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
      else moveToward(e, wp, d.speed * 0.5, dt);
      e.state = 'idle';
    }
    return;
  }
  // mimic springing: fire the reveal event once
  if (e.type === 'mimic' && !e.woken) {
    e.woken = true;
    ctx.event(e.id, 'spawn', { ambush: true });
  }
  e.targetId = target.id;

  switch (e.state) {
    case 'idle':
    case 'chase':
    case 'staggered': {
      if (bestD > d.attackRange * 0.85) moveToward(e, target.pos, d.speed * (e.state === 'staggered' ? 0.4 : 1), dt);
      faceToward(e, target.pos);
      if (bestD <= d.attackRange && now >= e.nextAttackAt) {
        e.state = 'telegraph';
        e.telegraphUntil = now + d.telegraphMs;
        e.telegraphPos = [...target.pos] as Vec3;
        ctx.event(e.id, 'telegraph', { ms: d.telegraphMs, target: target.id });
      } else if (e.state === 'idle') e.state = 'chase';
      break;
    }
    case 'telegraph': {
      faceToward(e, target.pos);
      if (now >= e.telegraphUntil) {
        e.state = 'cooldown';
        e.cooldownUntil = now + 450;
        e.nextAttackAt = now + d.attackCooldownMs;
        ctx.event(e.id, 'attack');
        if (d.spawnsAdds) {
          // sower ranged bolt: hits if the target hasn't moved off the locked spot
          if (e.telegraphPos && v3.dist(target.pos, e.telegraphPos) < 2.2)
            ctx.damagePlayer(target.id, d.attackDamage, e.id);
        } else if (v3.dist(e.pos, target.pos) <= d.attackRange * 1.35) {
          ctx.damagePlayer(target.id, d.attackDamage, e.id);
        }
      }
      break;
    }
    case 'cooldown': {
      if (now >= e.cooldownUntil) e.state = 'chase';
      break;
    }
  }

  // sower: spawn drifter adds while alive and engaged
  if (d.spawnsAdds && e.targetId && now >= e.nextSpawnAt) {
    e.nextSpawnAt = now + (d.spawnIntervalMs ?? 9000);
    if (e.addCount < 3) {
      e.addCount++;
      const add = makeEnemy({ type: 'drifter', id: `${e.id}-add${e.addCount}-${now % 10000}`, spawn: v3.add(e.pos, [1.2, 0, 1.2]) as Vec3 });
      add.isAdd = true;
      ctx.addEnemy(add);
      ctx.event(add.id, 'spawn', { by: e.id });
    }
  }
}

function moveToward(e: EnemyState, to: Vec3, speed: number, dt: number) {
  const dir = v3.norm([to[0] - e.pos[0], 0, to[2] - e.pos[2]]);
  e.pos[0] += dir[0] * speed * dt;
  e.pos[2] += dir[2] * speed * dt;
}
function faceToward(e: EnemyState, to: Vec3) {
  e.yaw = Math.atan2(to[0] - e.pos[0], to[2] - e.pos[2]);
}
