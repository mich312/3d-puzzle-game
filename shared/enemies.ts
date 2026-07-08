// PvE bestiary (spec §15) — small, archetype-driven, each tied to a device.
export type EnemyType = 'drifter' | 'warden' | 'sower' | 'colossus';

export interface EnemyDef {
  type: EnemyType;
  name: string;
  hp: number;
  speed: number;             // m/s
  aggroRange: number;
  attackRange: number;
  telegraphMs: number;       // wind-up before every attack (fairness cue)
  attackDamage: number;
  attackCooldownMs: number;
  radius: number;            // body radius for hit validation
  height: number;
  shielded?: boolean;        // warden: immune until pulse-staggered
  staggerWindowMs?: number;  // vulnerability window after stagger
  spawnsAdds?: boolean;      // sower
  spawnIntervalMs?: number;
  twoRole?: boolean;         // colossus: weak point must be exposed by tractor
  freezable: boolean;
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  drifter: {
    type: 'drifter', name: 'Drifter', hp: 50, speed: 2.2, aggroRange: 14, attackRange: 2.2,
    telegraphMs: 900, attackDamage: 15, attackCooldownMs: 2200, radius: 0.6, height: 1.6,
    freezable: true,
  },
  warden: {
    type: 'warden', name: 'Warden', hp: 90, speed: 1.6, aggroRange: 16, attackRange: 2.6,
    telegraphMs: 1100, attackDamage: 25, attackCooldownMs: 2800, radius: 0.8, height: 2.2,
    shielded: true, staggerWindowMs: 3500, freezable: true,
  },
  sower: {
    type: 'sower', name: 'Sower', hp: 60, speed: 1.2, aggroRange: 18, attackRange: 20,
    telegraphMs: 1400, attackDamage: 10, attackCooldownMs: 4000, radius: 0.7, height: 1.4,
    spawnsAdds: true, spawnIntervalMs: 9000, freezable: true,
  },
  colossus: {
    type: 'colossus', name: 'Colossus', hp: 300, speed: 1.0, aggroRange: 22, attackRange: 3.5,
    telegraphMs: 1500, attackDamage: 40, attackCooldownMs: 3600, radius: 1.4, height: 3.4,
    twoRole: true, freezable: false,
  },
};

export const PLAYER_MAX_HP = 100;
export const HP_REGEN_PER_S = 8;          // out of combat
export const HP_REGEN_DELAY_MS = 5000;    // after last damage
export const DOWNED_BLEEDOUT_MS = 25000;
export const REVIVE_MS = 3000;
export const REVIVE_RANGE = 2.5;
