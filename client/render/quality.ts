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
  // --- render pipeline (renderer.ts / post/*) ---
  bloomThreshold: number;     // pre-tonemap luminance where bloom starts (~0.9 + soft knee: only HDR emitters)
  shadowExtent: number;       // half-size (m) of the fitted, texel-snapped shadow frustum
  ao: 'off' | 'half' | 'full';// GTAO ground-contact / crevice occlusion
  aa: 'fxaa' | 'smaa' | 'msaa';// post AA (msaa = multisampled HDR scene target)
  grain: number;              // film grain amplitude (display space)
  aberration: boolean;        // edge chromatic aberration in the grade pass
  skyDetail: 1 | 2;           // sky shader: star layers / nebula octaves
}

export const QUALITY: Record<QualityTier, QualitySpec> = {
  low: {
    tier: 'low', pixelRatioCap: 1, shadowMap: 1024, lightBudget: 4,
    projectileLights: false, reflections: false, reflectionRes: 0, reflectionOpacity: 0,
    bloomStrength: 0.65, bloomRadius: 0.4, volumetrics: false, ambientParticles: false,
    bloomThreshold: 0.85, shadowExtent: 34, ao: 'off', aa: 'fxaa', grain: 0, aberration: false, skyDetail: 1,
  },
  medium: {
    tier: 'medium', pixelRatioCap: 1.5, shadowMap: 2048, lightBudget: 8,
    projectileLights: true, reflections: true, reflectionRes: 512, reflectionOpacity: 0.5,
    bloomStrength: 0.75, bloomRadius: 0.5, volumetrics: true, ambientParticles: true,
    bloomThreshold: 0.85, shadowExtent: 36, ao: 'half', aa: 'smaa', grain: 0.028, aberration: false, skyDetail: 2,
  },
  high: {
    tier: 'high', pixelRatioCap: 2, shadowMap: 4096, lightBudget: 12,
    projectileLights: true, reflections: true, reflectionRes: 768, reflectionOpacity: 0.62,
    bloomStrength: 0.8, bloomRadius: 0.55, volumetrics: true, ambientParticles: true,
    bloomThreshold: 0.85, shadowExtent: 44, ao: 'full', aa: 'msaa', grain: 0.032, aberration: true, skyDetail: 2,
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
