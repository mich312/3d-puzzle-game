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

// Per-world colour scripts (sky / fog / key-light tint / ambient intensity).
// The original keys (sky, fog, fogDensity, key, keyIntensity, hemiSky, hemiGround,
// ambient) keep their meaning; the rest drive the render pipeline: image-based
// lighting, height fog, the procedural sky shader, tone-mapping exposure and the
// final colour grade (client/render/*).
export interface WorldPalette {
  sky: string; fog: string; fogDensity: number; key: string; keyIntensity: number;
  hemiSky: string; hemiGround: string; ambient: number;
  /** tone-mapping exposure (AgX) */
  exposure: number;
  /** scene.environmentIntensity for the per-world PMREM environment */
  envIntensity: number;
  /** key-light direction: azimuth (deg, 0 = +Z, 90 = +X) and elevation (deg) */
  sunAz: number; sunEl: number;
  /** sky shader: zenith, horizon glow, void below, two nebula tints, star amount 0..1 */
  skyTop: string; skyGlow: string; voidColor: string;
  nebulaA: string; nebulaB: string; stars: number;
  /** height fog: base height (density reference), falloff per metre, uniform
   *  distance-haze floor (fraction of base density), sun in-scatter strength */
  fogBase: number; fogFalloff: number; fogFloor: number; inscatter: number;
  /** grade (applied after tone mapping): shadow tint, highlight tint, saturation, contrast */
  gradeShadows: string; gradeHighlights: string; saturation: number; contrast: number;
}

export const WORLD_PALETTES: Record<string, WorldPalette> = {
  nexus: {
    sky: '#211f33', fog: '#4a4468', fogDensity: 0.022, key: '#d9ccff', keyIntensity: 1.9, hemiSky: '#6b5b95', hemiGround: '#3a3550', ambient: 0.12,
    exposure: 1.0, envIntensity: 1.0, sunAz: 58, sunEl: 34,
    skyTop: '#0d0b1c', skyGlow: '#9a78c8', voidColor: '#0a0816', nebulaA: '#6d4fa8', nebulaB: '#c86f9a', stars: 0.8,
    fogBase: -4, fogFalloff: 0.16, fogFloor: 0.1, inscatter: 0.55,
    gradeShadows: '#241c3c', gradeHighlights: '#fff0e0', saturation: 1.08, contrast: 1.06,
  },
  atrium: {
    sky: '#1d2740', fog: '#44507a', fogDensity: 0.020, key: '#d2e2ff', keyIntensity: 2.0, hemiSky: '#7d90c9', hemiGround: '#39365a', ambient: 0.12,
    exposure: 1.0, envIntensity: 1.05, sunAz: 75, sunEl: 38,
    skyTop: '#0a1128', skyGlow: '#7fa2e0', voidColor: '#070b1a', nebulaA: '#3f6cb8', nebulaB: '#6fb8d8', stars: 0.7,
    fogBase: -3, fogFalloff: 0.13, fogFloor: 0.1, inscatter: 0.5,
    gradeShadows: '#15203a', gradeHighlights: '#f2f6ff', saturation: 1.05, contrast: 1.06,
  },
  vaults: {
    sky: '#131226', fog: '#2c2848', fogDensity: 0.034, key: '#a39af0', keyIntensity: 1.6, hemiSky: '#4d4780', hemiGround: '#221f3a', ambient: 0.1,
    exposure: 1.1, envIntensity: 0.9, sunAz: 120, sunEl: 48,
    skyTop: '#07061a', skyGlow: '#5a50a8', voidColor: '#05040f', nebulaA: '#3a3290', nebulaB: '#6a8ae0', stars: 0.9,
    fogBase: -2, fogFalloff: 0.12, fogFloor: 0.14, inscatter: 0.4,
    gradeShadows: '#12103a', gradeHighlights: '#eef0ff', saturation: 1.05, contrast: 1.08,
  },
  gardens: {
    sky: '#2e2138', fog: '#5c4a68', fogDensity: 0.018, key: '#ffd9a0', keyIntensity: 2.4, hemiSky: '#a5799a', hemiGround: '#43364e', ambient: 0.14,
    exposure: 1.0, envIntensity: 1.05, sunAz: 210, sunEl: 26,
    skyTop: '#1a1230', skyGlow: '#f0a07a', voidColor: '#140c1a', nebulaA: '#c46a8e', nebulaB: '#f0b070', stars: 0.35,
    fogBase: -3, fogFalloff: 0.12, fogFloor: 0.1, inscatter: 0.8,
    gradeShadows: '#2e1a34', gradeHighlights: '#fff0d8', saturation: 1.1, contrast: 1.05,
  },
  observatory: {
    sky: '#0e0c20', fog: '#252043', fogDensity: 0.026, key: '#c4b6ff', keyIntensity: 1.7, hemiSky: '#584f9e', hemiGround: '#1a1730', ambient: 0.1,
    exposure: 1.05, envIntensity: 0.9, sunAz: 300, sunEl: 40,
    skyTop: '#04030e', skyGlow: '#6a5ab8', voidColor: '#030208', nebulaA: '#4a3aa0', nebulaB: '#d8b060', stars: 1.0,
    fogBase: -3, fogFalloff: 0.13, fogFloor: 0.1, inscatter: 0.5,
    gradeShadows: '#100c2c', gradeHighlights: '#fff4dc', saturation: 1.06, contrast: 1.08,
  },
};

export const PLAYER_ACCENTS = ['#6ec6ff', '#ff9ecb', '#a8f0c6', '#ffd98a', '#c9a8ff', '#8fe8e0'];
