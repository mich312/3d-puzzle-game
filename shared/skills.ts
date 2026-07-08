// Curated skill tree (spec §16) — small, legible, freely respec-able.
export type SkillId =
  | 'double-jump' | 'quick-carry' | 'phase-sight' | 'echo-core'
  | 'charged-pulse' | 'dash' | 'field-medic' | 'overcharge';

export interface SkillDef {
  id: SkillId;
  name: string;
  branch: 'traversal' | 'combat';
  cost: number;             // skill points
  requires?: SkillId;
  description: string;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  'double-jump':  { id: 'double-jump', name: 'Double Jump', branch: 'traversal', cost: 1,
    description: 'Jump again mid-air. Opens vertical shortcuts.' },
  'quick-carry':  { id: 'quick-carry', name: 'Quick Carry', branch: 'traversal', cost: 1,
    description: 'Carry heavy objects alone (slowly).' },
  'phase-sight':  { id: 'phase-sight', name: 'Phase Sight', branch: 'traversal', cost: 2, requires: 'double-jump',
    description: 'Hold V to reveal hidden collectibles and routes nearby.' },
  'echo-core':    { id: 'echo-core', name: 'Echo Core', branch: 'traversal', cost: 3, requires: 'quick-carry',
    description: 'Record 8s of your actions, then replay them as an echo. The signature solo enabler.' },
  'charged-pulse':{ id: 'charged-pulse', name: 'Charged Pulse', branch: 'combat', cost: 1,
    description: 'Hold fire to charge: double damage and knockback.' },
  'dash':         { id: 'dash', name: 'Dash', branch: 'combat', cost: 1,
    description: 'Shift to dash with brief invulnerability (3s cooldown).' },
  'field-medic':  { id: 'field-medic', name: 'Field Medic', branch: 'combat', cost: 2, requires: 'dash',
    description: 'Revive twice as fast, from 4m away.' },
  'overcharge':   { id: 'overcharge', name: 'Overcharge', branch: 'combat', cost: 2, requires: 'charged-pulse',
    description: 'Device cooldowns halved for 10s after a revive or shard.' },
};
