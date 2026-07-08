// Persistence adapter (spec §21). SQLite (node:sqlite) behind a minimal interface
// so Postgres is a drop-in later.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DeviceId } from '../shared/devices';
import type { SkillId } from '../shared/skills';

export interface Profile {
  token: string;
  name: string;
  accent: string;
  shards: string[];
  skillPoints: number;
  skills: SkillId[];
  devices: DeviceId[];
  inventory: string[];
  bestTimes: Record<string, number>;
}

export interface Store {
  getOrCreateProfile(token?: string): Profile;
  saveProfile(p: Profile): void;
  telemetry(token: string, name: string, payload: Record<string, unknown>): void;
  telemetrySummary(): unknown;
}

export function openStore(dataDir = join(import.meta.dirname, '..', 'data')): Store {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'threshold.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      token TEXT PRIMARY KEY, name TEXT, accent TEXT,
      shards TEXT, skillPoints INTEGER, skills TEXT, devices TEXT,
      inventory TEXT, bestTimes TEXT, createdAt INTEGER, lastSeen INTEGER
    );
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, token TEXT, name TEXT, payload TEXT
    );
  `);
  const getStmt = db.prepare('SELECT * FROM profiles WHERE token = ?');
  const insStmt = db.prepare(`INSERT INTO profiles VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const updStmt = db.prepare(`UPDATE profiles SET name=?, accent=?, shards=?, skillPoints=?,
    skills=?, devices=?, inventory=?, bestTimes=?, lastSeen=? WHERE token=?`);
  const telStmt = db.prepare('INSERT INTO telemetry (ts, token, name, payload) VALUES (?,?,?,?)');

  return {
    getOrCreateProfile(token?: string): Profile {
      if (token) {
        const row = getStmt.get(token) as Record<string, unknown> | undefined;
        if (row) {
          return {
            token: row.token as string,
            name: row.name as string,
            accent: row.accent as string,
            shards: JSON.parse(row.shards as string),
            skillPoints: row.skillPoints as number,
            skills: JSON.parse(row.skills as string),
            devices: JSON.parse(row.devices as string),
            inventory: JSON.parse(row.inventory as string),
            bestTimes: JSON.parse(row.bestTimes as string),
          };
        }
      }
      const p: Profile = {
        token: token && /^[a-f0-9]{32}$/.test(token) ? token : randomBytes(16).toString('hex'),
        name: `Wanderer-${randomBytes(2).toString('hex')}`,
        accent: '',
        shards: [], skillPoints: 0, skills: [], devices: ['pulse'], inventory: [], bestTimes: {},
      };
      insStmt.run(p.token, p.name, p.accent, '[]', 0, '[]', '["pulse"]', '[]', '{}', Date.now(), Date.now());
      return p;
    },
    saveProfile(p: Profile) {
      updStmt.run(p.name, p.accent, JSON.stringify(p.shards), p.skillPoints,
        JSON.stringify(p.skills), JSON.stringify(p.devices), JSON.stringify(p.inventory),
        JSON.stringify(p.bestTimes), Date.now(), p.token);
    },
    telemetry(token, name, payload) {
      try { telStmt.run(Date.now(), token, name, JSON.stringify(payload)); } catch { /* non-fatal */ }
    },
    telemetrySummary() {
      return db.prepare(`
        SELECT name, COUNT(*) as n, payload FROM telemetry GROUP BY name ORDER BY n DESC LIMIT 50
      `).all();
    },
  };
}
