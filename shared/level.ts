// THRESHOLD level format v1 (spec §17) — data-driven, versioned, validated.
import type { DeviceId } from './devices';
import type { EnemyType } from './enemies';
import { exprIdents } from './expr';

export type Vec3 = [number, number, number];

export type CoopTier = 'solo' | 'co-op-optional' | 'co-op-required' | 'strictly-co-op';

export type MaterialRole =
  | 'stone' | 'metal' | 'wood' | 'crystal' | 'tile' | 'accent' | 'void';

export interface GeometryDef {
  shape: 'box' | 'cylinder';
  pos: Vec3;                  // centre
  size: Vec3;                 // box: [w,h,d]; cylinder: [radius, height, radius]
  rotY?: number;              // radians; colliders only honour multiples of PI/2
  material: MaterialRole;
  color?: string;             // hex override on top of the role's base
  emissive?: string;
  emissiveIntensity?: number;
  collider?: boolean;         // default true
  /** geometry exists (visual + collider) only while this expression is true */
  activeWhen?: string;
  /** tag as a door: slides open (collider off) when `openWhen` expr is true */
  door?: { id: string; openWhen: string };
  /** legal surface for placeable portals */
  portalSurface?: boolean;
}

export type InteractableDef =
  | { type: 'plate'; id: string; pos: Vec3; size?: Vec3; reads?: 'any' | 'mass'; threshold?: number }
  | { type: 'lever'; id: string; pos: Vec3; states?: number }
  | { type: 'rotator'; id: string; pos: Vec3; states: number }
  | { type: 'switch'; id: string; pos: Vec3; latched?: boolean }   // pulse-activated
  | { type: 'carryable'; id: string; pos: Vec3; mass?: 'light' | 'heavy'; kind?: string }
  | { type: 'collectible'; id: string; pos: Vec3; grants: string; hidden?: boolean }
  | { type: 'socket'; id: string; pos: Vec3; accepts: string }
  | { type: 'emitter'; id: string; pos: Vec3; dir: Vec3 }          // light beam source
  | { type: 'receiver'; id: string; pos: Vec3 }                    // condition: <id>.lit
  | { type: 'hazard'; id: string; pos: Vec3; size: Vec3; kind: 'steam' | 'void' | 'spark'; freezable?: boolean; dps?: number };

export interface EnemySpawnDef {
  type: EnemyType;
  id: string;
  spawn: Vec3;
  patrol?: Vec3[];
  weakTo?: string[];          // documentation for the HUD / editor
}

export interface PortalDef {
  id: string;
  pos: Vec3;
  /** "levelId" or "levelId:spawnName"; "nexus" returns to the lobby */
  linkedTo: string;
  label?: string;
  color?: string;
  requiresShards?: number;    // gate in the Nexus
  requiresSolved?: boolean;   // exit Threshold: activates once the level is solved
}

export interface LevelDef {
  v: 1;
  id: string;
  name: string;
  world: 'nexus' | 'atrium' | 'vaults' | 'gardens' | 'observatory';
  coop: CoopTier;
  dependency: string[];       // taxonomy tags (spec §13)
  encounters: string[];       // combat encounter tags, [] for pure puzzle
  players: { min: number; max: number };
  requiresDevice: DeviceId[]; // base path requirement — usually []
  intro?: string;             // one-line diegetic hint shown on entry
  fog?: { color?: string; density?: number };
  geometry: GeometryDef[];
  spawns: Record<string, Vec3>;   // must include "entry"
  checkpoints?: Vec3[];
  portals?: PortalDef[];
  placeablePortals?: { enabled: boolean; budgetPerPlayer?: number };
  interactables?: InteractableDef[];
  enemies?: EnemySpawnDef[];
  /** grants a device permanently on first clear / pickup within level */
  grantsDevice?: DeviceId;
  puzzle?: {
    solved: string;           // base-gear co-op path expression — ALWAYS present for levels
    soloSolution?: string;    // additive gear/skill-gated path; omitted for strictly-co-op
    shard: string;
    skillPoints?: number;
  };
}

/** Validate a level. Returns list of problems; empty = valid. */
export function validateLevel(lv: LevelDef): string[] {
  const errs: string[] = [];
  if (lv.v !== 1) errs.push(`unsupported version ${lv.v}`);
  if (!lv.id) errs.push('missing id');
  if (!lv.spawns || !lv.spawns['entry']) errs.push('missing spawns.entry');
  if (!Array.isArray(lv.geometry) || lv.geometry.length === 0) errs.push('no geometry');
  const ids = new Set<string>();
  for (const it of lv.interactables ?? []) {
    if (ids.has(it.id)) errs.push(`duplicate interactable id ${it.id}`);
    ids.add(it.id);
  }
  for (const e of lv.enemies ?? []) {
    if (ids.has(e.id)) errs.push(`duplicate id ${e.id}`);
    ids.add(e.id);
  }
  if (lv.world !== 'nexus') {
    if (!lv.puzzle) errs.push('level missing puzzle block');
    else {
      if (!lv.puzzle.solved) errs.push('puzzle.solved missing');
      if (lv.coop === 'strictly-co-op' && lv.puzzle.soloSolution)
        errs.push('strictly-co-op level must not declare a soloSolution');
      // Device availability for the base path is progression-order dependent and
      // is enforced by the cross-level validator (tools/validate-content.ts).
    }
    if ((lv.enemies?.length ?? 0) > 20) errs.push('enemy budget exceeded (max 20 per instance)');
    const bodies = (lv.interactables ?? []).filter((i) => i.type === 'carryable').length;
    if (bodies > 24) errs.push('physics body budget exceeded (max 24 carryables)');
  } else if (lv.enemies?.length) {
    errs.push('the Nexus is combat-free: no enemies allowed');
  }
  // expression sanity: all expressions must parse and reference known ids
  const known = new Set<string>([...ids, 'allEnemiesDown', 'playersPresent', 'true', 'false']);
  for (const g of lv.geometry) if (g.door) known.add(g.door.id);
  const checkExpr = (src: string, where: string) => {
    try {
      for (const ident of exprIdents(src)) {
        const root = ident.split('.')[0];
        if (!known.has(root)) errs.push(`${where}: unknown identifier "${ident}"`);
      }
    } catch (e) {
      errs.push(`${where}: unparseable expression "${src}" (${(e as Error).message})`);
    }
  };
  for (const g of lv.geometry) {
    if (g.activeWhen) checkExpr(g.activeWhen, `geometry activeWhen`);
    if (g.door) checkExpr(g.door.openWhen, `door ${g.door.id}`);
  }
  if (lv.puzzle) {
    checkExpr(lv.puzzle.solved, 'puzzle.solved');
    if (lv.puzzle.soloSolution) checkExpr(lv.puzzle.soloSolution, 'puzzle.soloSolution');
  }
  return errs;
}
