// Inline SVG icon set — one hand-drawn 24x24 stroke icon per game concept.
// All icons use currentColor so CSS colour applies; no asset files.
export type IconName =
  // devices
  | 'pulse' | 'freeze' | 'tractor' | 'portalgun'
  // skills
  | 'double-jump' | 'quick-carry' | 'phase-sight' | 'echo-core'
  | 'charged-pulse' | 'dash' | 'field-medic' | 'overcharge'
  // ui
  | 'shard' | 'beacon' | 'downed' | 'ping' | 'chat' | 'heart'
  | 'gem' | 'lock' | 'reset' | 'respec' | 'players' | 'check' | 'link';

const S = `fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`;

const PATHS: Record<IconName, string> = {
  pulse: `<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="6" ${S}/><path ${S} d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>`,
  freeze: `<path ${S} d="M12 2v20M12 2l-2.5 3M12 2l2.5 3M12 22l-2.5-3M12 22l2.5-3M3.3 7l17.4 10M3.3 7l3.9.3M3.3 7l.6 3.9M20.7 17l-3.9-.3M20.7 17l-.6-3.9M20.7 7L3.3 17M20.7 7l-3.9.3M20.7 7l-.6 3.9M3.3 17l3.9-.3M3.3 17l.6-3.9"/>`,
  tractor: `<path ${S} d="M5 4c0 9 3 13 7 13s7-4 7-13"/><path ${S} d="M8.5 4c0 6 1.5 9.5 3.5 9.5S15.5 10 15.5 4"/><circle cx="12" cy="20" r="1.6" fill="currentColor" stroke="none"/>`,
  portalgun: `<ellipse cx="8" cy="12" rx="4" ry="7" ${S}/><ellipse cx="16" cy="12" rx="4" ry="7" ${S} stroke-dasharray="3 2.4"/>`,
  'double-jump': `<path ${S} d="M6 20l6-6 6 6"/><path ${S} d="M6 12l6-6 6 6"/>`,
  'quick-carry': `<rect x="7" y="9" width="10" height="10" rx="1" ${S}/><path ${S} d="M9 9V6.5a3 3 0 0 1 6 0V9"/>`,
  'phase-sight': `<path ${S} d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.4" ${S} stroke-dasharray="2.4 2"/>`,
  'echo-core': `<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="5.4" ${S} stroke-dasharray="3 2.4"/><circle cx="12" cy="12" r="9" ${S} stroke-dasharray="3.5 3.4"/>`,
  'charged-pulse': `<path ${S} d="M13 2L5 13h5l-1.5 9L18 10h-5l1.5-8z"/>`,
  dash: `<path ${S} d="M4 6h9M2 12h13M4 18h9"/><path ${S} d="M15 6l6 6-6 6"/>`,
  'field-medic': `<path ${S} d="M12 4v16M4 12h16"/><circle cx="12" cy="12" r="9.4" ${S} stroke-dasharray="4.2 3"/>`,
  overcharge: `<circle cx="12" cy="13" r="7" ${S}/><path ${S} d="M12 13V8.5M9 3h6"/><path ${S} d="M12 13l3 3"/>`,
  shard: `<path ${S} d="M12 2l6 5-2.6 13.5L12 22l-3.4-1.5L6 7l6-5z"/><path ${S} d="M12 2v20M6.5 7.5L12 10l5.5-2.5"/>`,
  beacon: `<path ${S} d="M6 22V3l12 4-12 4"/>`,
  downed: `<circle cx="12" cy="12" r="9" ${S}/><path ${S} d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>`,
  ping: `<path ${S} d="M12 21s-7-6.5-7-11.5A7 7 0 0 1 19 9.5C19 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.2" ${S}/>`,
  chat: `<path ${S} d="M4 5h16v11H9l-5 4V5z"/>`,
  heart: `<path ${S} d="M12 20s-8-5.3-8-10.6C4 6.4 6.2 4.5 8.7 4.5c1.4 0 2.6.7 3.3 1.8.7-1.1 1.9-1.8 3.3-1.8 2.5 0 4.7 1.9 4.7 4.9C20 14.7 12 20 12 20z"/>`,
  gem: `<path ${S} d="M12 3l5 6-5 12L7 9l5-6z"/><path ${S} d="M7 9h10"/>`,
  lock: `<rect x="6" y="10" width="12" height="10" rx="1.5" ${S}/><path ${S} d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/>`,
  reset: `<path ${S} d="M4 12a8 8 0 1 0 2.3-5.7"/><path ${S} d="M4 3v5h5"/>`,
  respec: `<path ${S} d="M8 3v12M8 15l-3-3M8 15l3-3M16 21V9M16 9l-3 3M16 9l3 3"/>`,
  players: `<circle cx="8.5" cy="8" r="3.2" ${S}/><path ${S} d="M2.5 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="16.5" cy="9" r="2.6" ${S}/><path ${S} d="M15.5 14.7c3 .2 6 2.2 6 5.3"/>`,
  check: `<path ${S} d="M4 12.5l5.5 5.5L20 6.5"/>`,
  link: `<path ${S} d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 1 0-6.4-6.4l-1.6 1.6"/><path ${S} d="M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 1 0 6.4 6.4l1.6-1.6"/>`,
};

/** returns an inline <svg> string; size in px, colour via `color` or CSS currentColor */
export function icon(name: IconName, size = 18, color?: string): string {
  const style = color ? ` style="color:${color}"` : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"${style} aria-hidden="true">${PATHS[name]}</svg>`;
}

import type { DeviceId } from '../shared/devices';
import type { SkillId } from '../shared/skills';
export const DEVICE_ICON: Record<DeviceId, IconName> = {
  pulse: 'pulse', freeze: 'freeze', tractor: 'tractor', portalgun: 'portalgun',
};
export const SKILL_ICON: Record<SkillId, IconName> = {
  'double-jump': 'double-jump', 'quick-carry': 'quick-carry', 'phase-sight': 'phase-sight',
  'echo-core': 'echo-core', 'charged-pulse': 'charged-pulse', 'dash': 'dash',
  'field-medic': 'field-medic', 'overcharge': 'overcharge',
};
