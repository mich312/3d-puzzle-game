// Seeded bot profiles for the playtest suites. Instead of a server-side bypass flag,
// bots connect with real guest tokens whose profiles are pre-written to the SAME
// SQLite store the server reads — so every access check (shard gates, world gates)
// runs exactly as it does for players.
//
// Tokens are unique per run, so shards earned in an earlier run never make a
// "shard granted" assertion pass vacuously. Profiles get placeholder shards
// (gates only count shards), never real level ids.
//
// The bot process must share the server's data dir: default `<repo>/data`, or
// THRESHOLD_DATA_DIR when set (use the same value for both processes).
import { randomBytes, createHash } from 'node:crypto';
import { openStore, type Store } from '../server/persistence';

const RUN = randomBytes(8).toString('hex');
const SEED_SHARDS = Array.from({ length: 12 }, (_, i) => `test-seed-${i + 1}`);
let store: Store | undefined;

/** Create (or refresh) a seeded profile for `name` and return its guest token. */
export function seededToken(name: string, opts: { shards?: number } = {}): string {
  store ??= openStore(process.env.THRESHOLD_DATA_DIR || undefined);
  const token = createHash('md5').update(`threshold-test:${RUN}:${name}`).digest('hex');
  const p = store.getOrCreateProfile(token);
  p.name = name;
  p.shards = SEED_SHARDS.slice(0, opts.shards ?? SEED_SHARDS.length);
  store.saveProfile(p);
  return token;
}
