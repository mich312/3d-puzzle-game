// Validates all level JSON under content/worlds: per-level format rules
// (shared/level.ts) plus cross-level 1.1 design rules:
//   - all levels except the nexus and the tutorial are co-op-required (min >= 2)
//     and declare no soloSolution
//   - "brainy" depth: the solved condition (with door-chains expanded) must span
//     >= 2 interaction families beyond switches and combat — a pulse-switch may
//     never be the effective final gate
//   - requiresDevice must be satisfiable by progression order (starter Pulse,
//     the level's own grant, or a grant from a level gated at fewer shards)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLevel, type LevelDef } from '../shared/level';
import { exprIdents } from '../shared/expr';

const TUTORIAL = 'atrium-01';
const root = join(import.meta.dirname, '..', 'content', 'worlds');
const levels = new Map<string, LevelDef>();
let failed = false;

for (const world of readdirSync(root)) {
  for (const f of readdirSync(join(root, world))) {
    if (!f.endsWith('.json')) continue;
    const path = join(root, world, f);
    try {
      const lv = JSON.parse(readFileSync(path, 'utf8')) as LevelDef;
      const errs = validateLevel(lv);
      if (errs.length) {
        failed = true;
        console.error(`✗ ${world}/${f}:`);
        for (const e of errs) console.error(`    ${e}`);
      }
      levels.set(lv.id, lv);
    } catch (e) {
      console.error(`✗ ${world}/${f}: invalid JSON — ${(e as Error).message}`);
      failed = true;
    }
  }
}

type Family = 'mass' | 'beam-item' | 'mechanism' | 'switch' | 'freeze' | 'combat' | 'unknown';

function familyOf(lv: LevelDef, rootId: string): Family {
  if (rootId === 'allEnemiesDown' || (lv.enemies ?? []).some((e) => e.id === rootId)) return 'combat';
  const it = (lv.interactables ?? []).find((i) => i.id === rootId);
  if (it) {
    switch (it.type) {
      case 'plate': case 'carryable': return 'mass';
      case 'emitter': case 'receiver': case 'socket': case 'collectible': return 'beam-item';
      case 'rotator': case 'lever': return 'mechanism';
      case 'switch': return 'switch';
      case 'hazard': return 'freeze';
    }
  }
  return 'unknown';
}

/** families referenced by an expression, expanding door.open references */
function familiesOf(lv: LevelDef, expr: string, seen = new Set<string>()): Set<Family> {
  const out = new Set<Family>();
  for (const ident of exprIdents(expr)) {
    const rootId = ident.split('.')[0];
    if (rootId === 'playersPresent' || seen.has(rootId)) continue;
    seen.add(rootId);
    const door = lv.geometry.find((g) => g.door?.id === rootId);
    if (door) {
      for (const f of familiesOf(lv, door.door!.openWhen, seen)) out.add(f);
      continue;
    }
    out.add(familyOf(lv, rootId));
  }
  return out;
}

/** minimum shard count required to reach a level via the Nexus portals */
function shardGate(levelId: string): number {
  const nexus = levels.get('nexus');
  const portal = (nexus?.portals ?? []).find((p) => p.linkedTo.split(':')[0] === levelId);
  return portal?.requiresShards ?? 0;
}

for (const lv of levels.values()) {
  const errs: string[] = [];
  if (lv.world === 'nexus') continue;
  const isTutorial = lv.id === TUTORIAL;

  // 1.1 co-op gating
  if (!isTutorial) {
    if (lv.players.min < 2) errs.push(`must be co-op (players.min >= 2) — only the tutorial is soloable`);
    if (lv.coop !== 'co-op-required' && lv.coop !== 'strictly-co-op') errs.push(`coop tier must be co-op-required or strictly-co-op`);
    if (lv.puzzle?.soloSolution) errs.push(`soloSolution is retired in 1.1 — remove it`);
  }

  // brainy depth rule
  if (lv.puzzle && !isTutorial) {
    const fams = familiesOf(lv, lv.puzzle.solved);
    if (fams.has('unknown')) errs.push(`solved references an id with unknown family`);
    const deep = [...fams].filter((f) => f !== 'switch' && f !== 'combat' && f !== 'unknown');
    if (deep.length < 2)
      errs.push(`too shallow: solved spans families [${[...fams].join(', ')}] — needs >= 2 beyond switch/combat (a pulse-switch may never be the effective final gate)`);
  }

  // progression-aware device availability
  const gate = shardGate(lv.id);
  const grantedBelow = new Set(['pulse', lv.grantsDevice].filter(Boolean));
  for (const other of levels.values()) {
    if (other.grantsDevice && shardGate(other.id) < gate) grantedBelow.add(other.grantsDevice);
  }
  for (const d of lv.requiresDevice) {
    if (!grantedBelow.has(d)) errs.push(`requiresDevice "${d}" is not obtainable before this level in progression`);
  }

  if (errs.length) {
    failed = true;
    console.error(`✗ ${lv.id}:`);
    for (const e of errs) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${lv.id} (${lv.coop}, ${lv.geometry.length} geo, ${lv.enemies?.length ?? 0} enemies, families ok)`);
  }
}

// cross-level portal targets
for (const lv of levels.values()) {
  for (const p of lv.portals ?? []) {
    const target = p.linkedTo.split(':')[0];
    if (target !== 'nexus' && !levels.has(target))
      console.warn(`⚠ ${lv.id}: portal ${p.id} links to unknown level "${target}"`);
  }
}

console.log(failed ? '\nvalidation FAILED' : `\nall ${levels.size} levels valid`);
process.exit(failed ? 1 : 0);
