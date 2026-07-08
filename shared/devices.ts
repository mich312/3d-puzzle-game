// Dual-use tool-weapons (spec §14). Defined once, referenced by client + server.
export type DeviceId = 'pulse' | 'freeze' | 'tractor' | 'portalgun';

export interface DeviceDef {
  id: DeviceId;
  name: string;
  color: string;          // emissive accent for the wielded device + effects
  cooldownMs: number;     // between fires
  charges: number;        // charges regenerate; 0 = infinite (tractor is channeled)
  chargeRegenMs: number;
  range: number;          // metres
  puzzleUse: string;
  combatUse: string;
}

export const DEVICES: Record<DeviceId, DeviceDef> = {
  pulse: {
    id: 'pulse', name: 'Kinetic Pulse', color: '#ffd98a',
    cooldownMs: 600, charges: 0, chargeRegenMs: 0, range: 18,
    puzzleUse: 'Trigger switches and plates at range; knock blocks.',
    combatUse: 'Stagger foes, break shields, shatter frozen enemies, knock into hazards.',
  },
  freeze: {
    id: 'freeze', name: 'Freeze Ray', color: '#9fdcff',
    cooldownMs: 900, charges: 3, chargeRegenMs: 4000, range: 24,
    puzzleUse: 'Freeze steam, water and mechanisms to cross or stop them.',
    combatUse: 'Freeze an enemy solid — shatter it with a Pulse or a fall.',
  },
  tractor: {
    id: 'tractor', name: 'Tractor Beam', color: '#c9a8ff',
    cooldownMs: 150, charges: 0, chargeRegenMs: 0, range: 22,
    puzzleUse: 'Pull and carry distant objects; hold weights on plates.',
    combatUse: 'Drag foes off ledges, into hazards, or expose weak points.',
  },
  portalgun: {
    id: 'portalgun', name: 'Portal Device', color: '#ff9ecb',
    cooldownMs: 700, charges: 0, chargeRegenMs: 0, range: 60,
    puzzleUse: 'Place a linked pair of portals on marked surfaces; route anything.',
    combatUse: 'Flank, escape, or route a hazard onto an enemy.',
  },
};

// Damage / effect numbers (server truth; client mirrors for prediction feel)
export const DEVICE_COMBAT = {
  pulseDamage: 25,
  pulseKnockback: 7,        // m/s impulse
  pulseShatterBonus: 999,   // vs frozen
  freezeDurationMs: 5000,
  tractorPullForce: 9,      // m/s toward aim point
  hitTolerance: 1.6,        // generous PvE aim validation radius (m)
} as const;

export const STARTER_DEVICE: DeviceId = 'pulse';
