// THRESHOLD global palette (spec §10). All hexes tunable in one place.
export const PALETTE = {
  sky: '#1a1b2e',
  horizon: '#6b5b95',
  fog: '#4a4468',
  geometry: '#d8d3e0',
  shadow: '#3a3550',
  portalA: '#6ec6ff',
  portalB: '#ff9ecb',
  interactable: '#ffd98a',
  success: '#a8f0c6',
  hostile: '#e0654a',
} as const;

// Per-world colour scripts (sky / fog / key-light tint / ambient intensity)
export const WORLD_PALETTES: Record<string, {
  sky: string; fog: string; fogDensity: number; key: string; keyIntensity: number;
  hemiSky: string; hemiGround: string; ambient: number;
}> = {
  nexus: { sky: '#211f33', fog: '#4a4468', fogDensity: 0.022, key: '#cfc4ff', keyIntensity: 1.1, hemiSky: '#6b5b95', hemiGround: '#3a3550', ambient: 0.55 },
  atrium: { sky: '#1d2740', fog: '#44507a', fogDensity: 0.020, key: '#bcd4ff', keyIntensity: 1.3, hemiSky: '#7d90c9', hemiGround: '#39365a', ambient: 0.5 },
  vaults: { sky: '#131226', fog: '#2c2848', fogDensity: 0.034, key: '#8f86d8', keyIntensity: 0.8, hemiSky: '#4d4780', hemiGround: '#221f3a', ambient: 0.35 },
  gardens: { sky: '#2e2138', fog: '#5c4a68', fogDensity: 0.018, key: '#ffd9a0', keyIntensity: 1.6, hemiSky: '#a5799a', hemiGround: '#43364e', ambient: 0.6 },
  observatory: { sky: '#0e0c20', fog: '#252043', fogDensity: 0.026, key: '#b8a8ff', keyIntensity: 1.0, hemiSky: '#584f9e', hemiGround: '#1a1730', ambient: 0.4 },
};

export const PLAYER_ACCENTS = ['#6ec6ff', '#ff9ecb', '#a8f0c6', '#ffd98a'];
