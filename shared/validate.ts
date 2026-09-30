// Structural validation for untrusted client messages (spec §23). The server
// runs every inbound message through `validateClientMsg` before dispatch, so
// handlers can rely on field types (finite numbers, bounded strings, known enums)
// and only have to apply gameplay rules (range, cooldowns, ownership).
import type { ClientMsg } from './messages';
import type { Vec3 } from './level';
import { DEVICES, type DeviceId } from './devices';
import { SKILLS, type SkillId } from './skills';

export const MAX_ID_LEN = 64;           // interactable / enemy / instance / level ids
export const MAX_NAME_LEN = 24;         // display names
export const MAX_CHAT_LEN = 200;
export const MAX_TELEMETRY_BYTES = 2048;
export const MAX_ECHO_POINTS = 84;

/** Own-property lookup: rejects prototype keys like "constructor" / "__proto__". */
export function hasKey<T extends object>(obj: T, key: unknown): key is keyof T {
  return typeof key === 'string' && Object.hasOwn(obj, key);
}
export const isDeviceId = (v: unknown): v is DeviceId => hasKey(DEVICES, v);
export const isSkillId = (v: unknown): v is SkillId => hasKey(SKILLS, v);

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
export const isStr = (v: unknown, max = MAX_ID_LEN): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
/** finite coordinates, bounded to a sane world extent */
export const isVec3 = (v: unknown, bound = 1e4): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => isNum(n) && Math.abs(n) <= bound);
const opt = <T>(v: unknown, test: (x: unknown) => x is T): boolean => v === undefined || test(v);
const optStr = (v: unknown, max = MAX_ID_LEN) => v === undefined || isStr(v, max);

/** Strip control chars, bidi overrides and zero-width/invisible code points, collapse whitespace. */
export function sanitizeText(s: string, max: number): string {
  return s
    .replace(/[\t\n\r\f\v]/g, ' ')        // whitespace controls separate words — keep them as spaces
    .replace(/[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Reserved display names (system chat speaker) — case/spacing-insensitive. */
export function isReservedName(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return n === 'threshold' || n === 'system' || n === 'server';
}

/** Returns a sanitized display name, or null if unusable. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = sanitizeText(raw.slice(0, 200), MAX_NAME_LEN);
  if (!name || isReservedName(name)) return null;
  return name;
}

/** Client telemetry events the server will store (namespaced "client:<name>"). */
export const CLIENT_TELEMETRY_EVENTS = new Set([
  'session_start', 'settings', 'tutorial_step', 'ui', 'perf', 'client_error', 'feedback',
]);

/** Is `raw` a well-formed ClientMsg? Pure structural check — no game state. */
export function validateClientMsg(raw: unknown): raw is ClientMsg {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const m = raw as Record<string, unknown>;
  if (m.v !== 1 || typeof m.t !== 'string') return false;
  switch (m.t) {
    case 'hello':
      return optStr(m.token, 64) && (m.name === undefined || typeof m.name === 'string') && optStr(m.target);
    case 'move':
      return isVec3(m.p) && isNum(m.yaw) && isNum(m.pitch) && (m.anim === undefined || isInt(m.anim, 0, 15));
    case 'enter_level': return isStr(m.level);
    case 'join_instance': return isStr(m.instanceId);
    case 'leave_level': case 'raise_beacon': case 'lower_beacon': case 'release':
    case 'respec': case 'revive_cancel': case 'reset_level':
      return true;
    case 'interact': case 'grab': case 'revive_start':
      return isStr(m.target);
    case 'fire':
      return isDeviceId(m.device) && isVec3(m.origin) && isVec3(m.dir) &&
        Math.hypot(...(m.dir as Vec3)) > 1e-6 && opt(m.charged, isBool) && optStr(m.targetId);
    case 'tractor':
      return isBool(m.active) && optStr(m.targetId) && opt(m.aim, (v): v is Vec3 => isVec3(v));
    case 'place_portal':
      return (m.slot === 0 || m.slot === 1) && isVec3(m.pos) && isVec3(m.normal) &&
        Math.hypot(...(m.normal as Vec3)) > 1e-6;
    case 'equip': return isDeviceId(m.device);
    case 'pickup': return isStr(m.itemId);
    case 'use_item': return isStr(m.item) && isStr(m.socketId);
    case 'unlock_skill': return isSkillId(m.skill);
    case 'chat': return typeof m.text === 'string' && m.text.length <= MAX_CHAT_LEN * 4;
    case 'ping': return isVec3(m.pos);
    case 'echo':
      return isBool(m.place) && (m.path === undefined ||
        (Array.isArray(m.path) && m.path.length <= MAX_ECHO_POINTS && m.path.every((pt) => isVec3(pt))));
    case 'set_opts': return m.difficulty === undefined || m.difficulty === 'story' || m.difficulty === 'normal';
    case 'set_name':
      return typeof m.name === 'string' && m.name.length <= 200 && optStr(m.accent, 16);
    case 'telemetry': {
      if (!isStr(m.name, 32) || !CLIENT_TELEMETRY_EVENTS.has(m.name)) return false;
      if (m.payload === undefined) return true;
      if (!m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) return false;
      try { return JSON.stringify(m.payload).length <= MAX_TELEMETRY_BYTES; } catch { return false; }
    }
    default: return false;
  }
}
