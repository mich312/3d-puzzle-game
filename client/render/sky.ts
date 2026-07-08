// Procedural sky: an inverted sphere with a canvas-painted starfield + aurora
// bands tinted per world. Replaces the flat background colour.
import * as THREE from 'three';
import { WORLD_PALETTES } from '../../shared/palette';

export function makeSky(world: string): THREE.Mesh {
  const p = WORLD_PALETTES[world] ?? WORLD_PALETTES.nexus;
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const ctx = c.getContext('2d')!;

  // vertical gradient: horizon glow → deep sky
  const grad = ctx.createLinearGradient(0, c.height, 0, 0);
  grad.addColorStop(0, p.fog);
  grad.addColorStop(0.35, p.sky);
  grad.addColorStop(1, shade(p.sky, 0.55));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);

  // aurora bands: wide translucent sine ribbons in the world's key colour
  for (let band = 0; band < 3; band++) {
    ctx.beginPath();
    const baseY = c.height * (0.22 + band * 0.13);
    const amp = 30 + band * 22;
    const phase = band * 2.1;
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= c.width; x += 16)
      ctx.lineTo(x, baseY + Math.sin(x * 0.004 + phase) * amp + Math.sin(x * 0.011 + phase * 3) * amp * 0.4);
    ctx.strokeStyle = hexA(p.key, 0.05 + band * 0.02);
    ctx.lineWidth = 60 - band * 14;
    ctx.stroke();
  }

  // stars: seeded scatter, denser near the top, a few bright with cross glints
  let seed = world.length * 1013 + 77;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 900; i++) {
    const x = rnd() * c.width;
    const y = rnd() * rnd() * c.height * 0.9;
    const r = rnd() * 1.3 + 0.2;
    const a = 0.25 + rnd() * 0.75;
    ctx.fillStyle = `rgba(255,255,255,${a * (world === 'observatory' ? 1 : 0.7)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 1.2 && rnd() > 0.6) {
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.35})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x - r * 4, y); ctx.lineTo(x + r * 4, y);
      ctx.moveTo(x, y - r * 4); ctx.lineTo(x, y + r * 4);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(240, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.renderOrder = -1;
  mesh.name = 'sky';
  return mesh;
}

function shade(hex: string, f: number): string {
  const col = new THREE.Color(hex).multiplyScalar(f);
  return `#${col.getHexString()}`;
}
function hexA(hex: string, a: number): string {
  const col = new THREE.Color(hex);
  return `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
}
