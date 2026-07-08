// Graphics quality tiers (spec §10 perf posture). Auto-detected at boot from the
// GPU string + device pixel ratio, overridable in settings. Every heavy effect
// reads its budget from here so weaker machines auto-scale and hold 60fps.
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySpec {
  tier: QualityTier;
  pixelRatioCap: number;
  shadowMap: number;          // directional shadow resolution (0 = shadows off)
  lightBudget: number;        // simultaneous dynamic point lights
  projectileLights: boolean;  // projectiles carry a dynamic light
  reflections: boolean;       // planar mirror floors on hero surfaces
  reflectionRes: number;      // reflector render-target size
  reflectionOpacity: number;  // how strongly the mirror shows through the floor
  bloomStrength: number;
  bloomRadius: number;
  volumetrics: boolean;       // fake light shafts / god-ray cones at bright sources
  ambientParticles: boolean;  // per-world weather
}

export const QUALITY: Record<QualityTier, QualitySpec> = {
  low: {
    tier: 'low', pixelRatioCap: 1, shadowMap: 1024, lightBudget: 4,
    projectileLights: false, reflections: false, reflectionRes: 0, reflectionOpacity: 0,
    bloomStrength: 0.45, bloomRadius: 0.35, volumetrics: false, ambientParticles: false,
  },
  medium: {
    tier: 'medium', pixelRatioCap: 1.5, shadowMap: 2048, lightBudget: 8,
    projectileLights: true, reflections: true, reflectionRes: 512, reflectionOpacity: 0.5,
    bloomStrength: 0.6, bloomRadius: 0.6, volumetrics: true, ambientParticles: true,
  },
  high: {
    tier: 'high', pixelRatioCap: 2, shadowMap: 2048, lightBudget: 12,
    projectileLights: true, reflections: true, reflectionRes: 1024, reflectionOpacity: 0.62,
    bloomStrength: 0.72, bloomRadius: 0.75, volumetrics: true, ambientParticles: true,
  },
};

/** Best-effort auto pick from GPU renderer string + DPR. Conservative by default. */
export function autoQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): QualityTier {
  const saved = localStorage.getItem('t-quality');
  if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  let renderer = '';
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  } catch { /* blocked by privacy settings — fall through to heuristics */ }
  const cores = navigator.hardwareConcurrency ?? 4;
  const strong = /nvidia|geforce|rtx|radeon rx|apple m\d|apple gpu|arc a/.test(renderer);
  const weak = /intel|swiftshader|llvmpipe|mali|adreno|powervr|software/.test(renderer);
  if (weak || cores <= 4 || devicePixelRatio > 2.5) return 'low';
  if (strong && cores >= 8) return 'high';
  return 'medium';
}
