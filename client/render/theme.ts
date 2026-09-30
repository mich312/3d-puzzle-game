// Sky-temples art direction ("Golden-Hour Fresco, pixel-edged") — PROTOTYPE.
//
// A render-side theme layered over the existing pipeline; nothing here touches
// level data, colliders or PALETTE hexes (those are gameplay match keys):
//   • SKY_PALETTES  — eternal golden hour per world (apricot-rose key, never
//     yellow), a banded cloud deck in the sky shader, cloud-coloured fog. Worlds
//     without an entry (vaults, gardens, observatory) keep their night script.
//   • themeLook()   — remaps a static batch look (colour/emissive) so the violet
//     JSON overrides read as marble / bronze / terracotta / olive, keeping each
//     override's relative lightness as tonal variety.
//   • pixel scale   — the drawing buffer renders at 1/N and the browser does a
//     nearest upscale (renderer.ts); GradePass adds a static Bayer dither and a
//     soft pull toward a 16-entry palette, HDR signals bypass both.
//
// A/B in the same build: ?theme=night gives the old look; ?px=0|2|3|4 sets the
// pixel scale (persisted as localStorage 't-px', default 3).
import * as THREE from 'three';
import { WORLD_PALETTES, type WorldPalette } from '../../shared/palette';
import type { Look } from './levelMesh';

function query(): string {
  try { return typeof location === 'undefined' ? '' : location.search; } catch { return ''; }
}

export const SKY_THEME = !/[?&]theme=night\b/.test(query());

export type PixelScale = 0 | 2 | 3 | 4;

function clampScale(n: number): PixelScale {
  if (!Number.isFinite(n) || n < 1) return 0;
  if (n < 2.5) return 2;
  if (n < 3.5) return 3;
  return 4;
}

/** Target rows per setting: 2/3/4 are named for their block at 720p, but the
 *  block follows the screen so every display gets the same pixel density. */
export const PIXEL_ROWS: Record<Exclude<PixelScale, 0>, number> = { 2: 360, 3: 240, 4: 180 };

/** whole device pixels per rendered pixel for `deviceRows` of output */
export function pixelBlock(n: PixelScale, deviceRows: number): number {
  if (!n) return 1;
  return Math.max(1, Math.round(deviceRows / PIXEL_ROWS[n]));
}

/** ?px wins (and is remembered), then localStorage 't-px', then 3× */
export function initialPixelScale(): PixelScale {
  const m = /[?&]px=(\d+)/.exec(query());
  if (m) {
    const n = clampScale(Number(m[1]));
    try { localStorage.setItem('t-px', String(n)); } catch { /* storage blocked */ }
    return n;
  }
  try {
    const s = localStorage.getItem('t-px');
    if (s !== null) return clampScale(Number(s));
  } catch { /* storage blocked */ }
  return 3;
}

export interface SkyExtras {
  /** cloud-deck plane height (m) and colours: sunlit tops, rose-lilac shade */
  cloudY: number; cloudLit: string; cloudShade: string;
  /** fbm threshold (0 = overcast, 1 = clear) and world-space frequency (1/m) */
  cloudCover: number; cloudScale: number;
  /** multiplier on the FogExp2 colour (the night palettes use 0.72) */
  fogScale: number;
  /** level JSON fog colours were tuned for dusk — keep the palette's instead */
  ignoreLevelFogColor: boolean;
  /** 16 sRGB hexes the pixel grade gently pulls toward */
  pixelPalette: string[];
  /** display-space black / white points: AgX leaves golden hour flat and milky */
  levels: [number, number];
}
export type ThemedPalette = WorldPalette & Partial<SkyExtras>;

const NEXUS_PIX = ['#2e2440', '#4a5288', '#8a86ac', '#c9aebd', '#b9a58f', '#eee6d8', '#fff3e2', '#f1c6a8',
  '#ffb88a', '#9bb8dc', '#4a6aae', '#b8643e', '#9a6a3a', '#6f7f45', '#f2c25a', '#5a3a2e'];
const ATRIUM_PIX = NEXUS_PIX.map((h, i) => ({ 7: '#f4d8bf', 8: '#ffc79a', 9: '#a6c4e4', 10: '#5478bc' } as Record<number, string>)[i] ?? h);

export const SKY_PALETTES: Record<string, WorldPalette & SkyExtras> = {
  nexus: {
    sky: '#9bb8dc', fog: '#f1c6a8', fogDensity: 0.014, key: '#ffd8b0', keyIntensity: 2.7,
    hemiSky: '#a9c0e4', hemiGround: '#e6c8b8', ambient: 0.1,
    exposure: 1.05, envIntensity: 0.6, sunAz: 58, sunEl: 30,
    skyTop: '#4a6aae', skyGlow: '#ffb88a', voidColor: '#ecd9d2', nebulaA: '#fff3e2', nebulaB: '#c9aebd', stars: 0,
    fogBase: -10, fogFalloff: 0.2, fogFloor: 0.06, inscatter: 0.6,
    gradeShadows: '#2a3060', gradeHighlights: '#fff1de', saturation: 1.12, contrast: 1.08,
    cloudY: -22, cloudLit: '#fff3e2', cloudShade: '#c9aebd', cloudCover: 0.44, cloudScale: 0.03,
    fogScale: 1.0, ignoreLevelFogColor: true, pixelPalette: NEXUS_PIX, levels: [0.12, 0.84],
  },
  atrium: {
    sky: '#a6c4e4', fog: '#f4d8bf', fogDensity: 0.02, key: '#ffe4c0', keyIntensity: 2.6,
    hemiSky: '#b4cbe8', hemiGround: '#e8d2c0', ambient: 0.1,
    exposure: 1.05, envIntensity: 0.65, sunAz: 75, sunEl: 36,
    skyTop: '#5478bc', skyGlow: '#ffc79a', voidColor: '#efe2d8', nebulaA: '#fff6ea', nebulaB: '#c4bcd6', stars: 0,
    fogBase: -8, fogFalloff: 0.2, fogFloor: 0.05, inscatter: 0.55,
    gradeShadows: '#283462', gradeHighlights: '#fff4e6', saturation: 1.1, contrast: 1.08,
    cloudY: -16, cloudLit: '#fff6ea', cloudShade: '#c4bcd6', cloudCover: 0.46, cloudScale: 0.034,
    fogScale: 1.0, ignoreLevelFogColor: true, pixelPalette: ATRIUM_PIX, levels: [0.12, 0.84],
  },
};

/** the active colour script for a world (theme first, then the night palettes) */
export function worldPalette(world: string): ThemedPalette {
  return (SKY_THEME && SKY_PALETTES[world]) || WORLD_PALETTES[world] || WORLD_PALETTES.nexus;
}

const _hsl = { h: 0, s: 0, l: 0 };
const _c = new THREE.Color();

/**
 * Re-hue a static look for the sky theme. Only merged static batches pass through
 * here, so doors, barriers, portals and interactables keep their gameplay colours.
 * HSL is taken in sRGB so "lightness" means what the JSON author saw.
 */
export function themeLook(l: Look, world: string): Look {
  if (!SKY_THEME || !SKY_PALETTES[world]) return l;
  const out: Look = { ...l };
  if (l.color) {
    _c.set(l.color).getHSL(_hsl, THREE.SRGBColorSpace);
    const L = _hsl.l;
    let hsl: [number, number, number] | null = null;
    if (_hsl.h > 0.19 && _hsl.h < 0.5 && _hsl.s > 0.15) hsl = [0.22, 0.32, 0.28 + 0.5 * L];   // greens → olive
    else switch (l.role) {
      case 'stone': case 'tile': case 'rock': hsl = [0.10, 0.14, 0.60 + 0.38 * L]; break;
      case 'metal': hsl = [0.08, 0.35, 0.55 + 0.35 * L]; break;
      case 'wood': hsl = [0.05, 0.40, 0.55 + 0.35 * L]; break;
      case 'crystal': hsl = [0.09, 0.25, 0.80 + 0.18 * L]; break;
      default: break;   // accent / void keep their colour
    }
    if (hsl) out.color = '#' + _c.setHSL(hsl[0], hsl[1], Math.min(hsl[2], 0.98), THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace);
  }
  if (l.emissive) {
    // non-gameplay glow becomes warm gilded inlay light, never above the bloom knee
    out.emissive = '#ffc987';
    out.ei = Math.round(Math.min(l.ei * 0.6, 1.2) * 100) / 100;
  }
  return out;
}
