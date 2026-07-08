// Message protocol (spec §23). JSON envelopes; high-rate snapshots use compact arrays.
// Every message: { t: MsgType, v: 1, ...payload }
import type { Vec3, LevelDef } from './level';
import type { DeviceId } from './devices';
import type { SkillId } from './skills';

export const PROTOCOL_V = 1;

// ---- client → server ----
export type ClientMsg =
  | { t: 'hello'; v: 1; token?: string; name?: string; target?: string }  // target: lobby/instance id from URL
  | { t: 'move'; v: 1; p: Vec3; yaw: number; pitch: number; anim?: number }
  | { t: 'enter_level'; v: 1; level: string }
  | { t: 'join_instance'; v: 1; instanceId: string }
  | { t: 'leave_level'; v: 1 }
  | { t: 'raise_beacon'; v: 1 } | { t: 'lower_beacon'; v: 1 }
  | { t: 'interact'; v: 1; target: string }
  | { t: 'grab'; v: 1; target: string } | { t: 'release'; v: 1 }
  | { t: 'fire'; v: 1; device: DeviceId; origin: Vec3; dir: Vec3; charged?: boolean; targetId?: string }
  | { t: 'tractor'; v: 1; active: boolean; targetId?: string; aim?: Vec3 }
  | { t: 'place_portal'; v: 1; slot: 0 | 1; pos: Vec3; normal: Vec3 }
  | { t: 'equip'; v: 1; device: DeviceId }
  | { t: 'pickup'; v: 1; itemId: string }
  | { t: 'use_item'; v: 1; item: string; socketId: string }
  | { t: 'unlock_skill'; v: 1; skill: SkillId }
  | { t: 'respec'; v: 1 }
  | { t: 'revive_start'; v: 1; target: string } | { t: 'revive_cancel'; v: 1 }
  | { t: 'reset_level'; v: 1 }
  | { t: 'chat'; v: 1; text: string }                 // instance-scoped chat (rate-limited, sanitized)
  | { t: 'ping'; v: 1; pos: Vec3 }                    // "look here" world marker
  | { t: 'echo'; v: 1; place: boolean }               // Echo Core skill: leave/recall a stationary echo
  | { t: 'set_opts'; v: 1; difficulty?: 'story' | 'normal' }
  | { t: 'set_name'; v: 1; name: string }
  | { t: 'telemetry'; v: 1; name: string; payload?: Record<string, unknown> };

// ---- server → client ----
export interface PlayerSnap {
  id: string; name: string; accent: string;
  p: Vec3; yaw: number; pitch: number; anim: number;
  hp: number; state: 'alive' | 'downed';
  equipped: DeviceId; carrying?: string;
  echo?: Vec3;               // Echo Core placement, if any
}
export interface EnemySnap {
  id: string; type: string; p: Vec3; yaw: number; hp: number; maxHp: number;
  state: string; // idle|chase|telegraph|attack|frozen|staggered|down
  frozenUntil?: number; target?: string;
}
export interface BodySnap { id: string; p: Vec3; heldBy?: string | null }
export interface PortalPlacementSnap { owner: string; slot: 0 | 1; pos: Vec3; normal: Vec3 }

export interface InstanceSnapshot {
  instanceId: string;
  kind: 'lobby' | 'level';
  levelId?: string;
  level?: LevelDef;             // sent on join only
  players: PlayerSnap[];
  enemies?: EnemySnap[];
  bodies?: BodySnap[];
  states?: Record<string, Record<string, number | boolean>>; // interactable public state
  portalsPlaced?: PortalPlacementSnap[];
  solved?: boolean;
  beacons?: { instanceId: string; level: string; levelName: string; present: number; needed: number }[];
  serverTime: number;
}

export type ServerMsg =
  | { t: 'welcome'; v: 1; playerId: string; token: string;
      profile: { name: string; accent: string; shards: string[]; skillPoints: number;
        skills: SkillId[]; devices: DeviceId[]; inventory: string[];
        bestTimes: Record<string, number>; unlockedWorlds: string[] } }
  | { t: 'joined'; v: 1; snapshot: InstanceSnapshot; spawn: Vec3; spawnYaw: number }
  | { t: 'snap'; v: 1; s: InstanceSnapshot }                        // 10-20 Hz tick delta (players/enemies/bodies)
  | { t: 'peer_left'; v: 1; id: string } | { t: 'peer_joined'; v: 1; player: PlayerSnap }
  | { t: 'state_update'; v: 1; id: string; state: Record<string, number | boolean> }
  | { t: 'enemy_event'; v: 1; id: string; ev: 'telegraph' | 'attack' | 'hit' | 'frozen' | 'shatter' | 'stagger' | 'down' | 'spawn'; data?: Record<string, unknown> }
  | { t: 'device_effect'; v: 1; player: string; device: DeviceId; origin: Vec3; dir: Vec3; hit?: Vec3; targetId?: string }
  | { t: 'portal_placed'; v: 1; placement: PortalPlacementSnap }
  | { t: 'portal_traverse'; v: 1; player: string; to: Vec3 }
  | { t: 'hp'; v: 1; id: string; hp: number }
  | { t: 'downed'; v: 1; id: string } | { t: 'revived'; v: 1; id: string; by: string }
  | { t: 'revive_progress'; v: 1; id: string; pct: number }
  | { t: 'respawn'; v: 1; id: string; p: Vec3 }
  | { t: 'inventory'; v: 1; inventory: string[] }
  | { t: 'devices'; v: 1; devices: DeviceId[]; note?: string }
  | { t: 'skills'; v: 1; skills: SkillId[]; skillPoints: number }
  | { t: 'solved'; v: 1; levelId: string; via: 'coop' | 'solo'; timeMs: number; shard: string; skillPoints: number }
  | { t: 'shards'; v: 1; shards: string[]; unlockedWorlds: string[] }
  | { t: 'beacons'; v: 1; beacons: InstanceSnapshot['beacons'] }
  | { t: 'reset_done'; v: 1 }
  | { t: 'chat'; v: 1; from: string; name: string; accent: string; text: string; system?: boolean }
  | { t: 'ping'; v: 1; from: string; accent: string; pos: Vec3 }
  | { t: 'gate_wait'; v: 1; level: string; levelName: string; waiting: number; needed: number }
  | { t: 'toast'; v: 1; text: string; kind?: 'info' | 'success' | 'warn' }
  | { t: 'error'; v: 1; code: string; message: string };
