// Loads and validates all level content at boot; hot-reloads in dev.
import { readdirSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { validateLevel, type LevelDef } from '../shared/level';

const ROOT = join(import.meta.dirname, '..', 'content', 'worlds');
const levels = new Map<string, LevelDef>();

export function loadContent(): Map<string, LevelDef> {
  levels.clear();
  for (const world of readdirSync(ROOT)) {
    for (const f of readdirSync(join(ROOT, world))) {
      if (!f.endsWith('.json')) continue;
      try {
        const lv = JSON.parse(readFileSync(join(ROOT, world, f), 'utf8')) as LevelDef;
        const errs = validateLevel(lv);
        if (errs.length) {
          console.error(`[content] ${f} INVALID:`, errs.join('; '));
          continue;
        }
        levels.set(lv.id, lv);
      } catch (e) {
        console.error(`[content] failed to load ${f}:`, (e as Error).message);
      }
    }
  }
  console.log(`[content] loaded ${levels.size} levels: ${[...levels.keys()].join(', ')}`);
  return levels;
}

export function getLevel(id: string): LevelDef | undefined {
  return levels.get(id);
}

export function watchContent(onChange: () => void) {
  if (process.env.NODE_ENV === 'production') return;
  try {
    watch(ROOT, { recursive: true }, () => {
      setTimeout(() => { loadContent(); onChange(); }, 100);
    });
  } catch { /* recursive watch unsupported on some platforms; fine */ }
}
