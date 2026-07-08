// Validates all level JSON under content/worlds against the format + invariants.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLevel, type LevelDef } from '../shared/level';

const root = join(import.meta.dirname, '..', 'content', 'worlds');
const levels = new Map<string, LevelDef>();
let failed = false;

for (const world of readdirSync(root)) {
  for (const f of readdirSync(join(root, world))) {
    if (!f.endsWith('.json')) continue;
    const path = join(root, world, f);
    let lv: LevelDef;
    try {
      lv = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      console.error(`✗ ${world}/${f}: invalid JSON — ${(e as Error).message}`);
      failed = true;
      continue;
    }
    const errs = validateLevel(lv);
    if (errs.length) {
      failed = true;
      console.error(`✗ ${world}/${f}:`);
      for (const e of errs) console.error(`    ${e}`);
    } else {
      console.log(`✓ ${world}/${f} (${lv.id} — ${lv.coop}, ${lv.geometry.length} geo, ${lv.enemies?.length ?? 0} enemies)`);
    }
    levels.set(lv.id, lv);
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
