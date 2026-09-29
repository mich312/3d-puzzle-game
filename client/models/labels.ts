// World-space UI sprites: name tags, slim HP bars with a lagging damage trail,
// and chat bubbles. All canvas-backed; disposed through disposeObject with the
// sprite (their textures/materials are per-sprite, never shared).
import * as THREE from 'three';

const FONT = '"Segoe UI", "Inter", system-ui, sans-serif';

function spriteFrom(c: HTMLCanvasElement, w: number, h: number): THREE.Sprite {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(w, h, 1);
  return sp;
}

/** Name tag: soft-shadowed caps text with a small accent diamond. */
export function nameTag(text: string, accent: string, height = 0.2): THREE.Sprite {
  const H = 96, pad = 28;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `600 50px ${FONT}`;
  ctx.font = font;
  const label = text.toUpperCase();
  const spacing = 3;
  const tw = [...label].reduce((s, ch) => s + ctx.measureText(ch).width + spacing, 0);
  const W = Math.min(1024, Math.ceil(tw + pad * 2 + 40));
  c.width = W; c.height = H;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  // diamond
  const dx = pad + 8, cy = H / 2;
  ctx.shadowColor = accent; ctx.shadowBlur = 12;
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.moveTo(dx, cy - 9); ctx.lineTo(dx + 9, cy); ctx.lineTo(dx, cy + 9); ctx.lineTo(dx - 9, cy); ctx.closePath(); ctx.fill();
  // text with a soft dark drop shadow, then a crisp fill
  let x = dx + 26;
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#f4f1fb';
  for (const ch of label) { ctx.fillText(ch, x, cy + 2); x += ctx.measureText(ch).width + spacing; }
  const sp = spriteFrom(c, height * W / H, height);
  sp.renderOrder = 10;
  return sp;
}

// ---------- HP bar ----------
const BW = 256, BH = 20;
interface BarData { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; color: string; pct: number; trail: number; drawn: string }

export function makeBar(color: string, width = 0.9): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = BW; c.height = BH;
  const sp = spriteFrom(c, width, width * BH / BW);
  sp.renderOrder = 10;
  const data: BarData = { canvas: c, tex: (sp.material as THREE.SpriteMaterial).map as THREE.CanvasTexture, color, pct: 1, trail: 1, drawn: '' };
  sp.userData.bar = data;
  drawBar(data);
  return sp;
}
export function setBar(sp: THREE.Sprite, pct: number) {
  const d = sp.userData.bar as BarData;
  const p = Math.max(0, Math.min(1, pct));
  if (p > d.pct) d.trail = p;          // heals snap the trail up
  d.pct = p;
  drawBar(d);
}
/** animate the damage trail; cheap no-op when settled */
export function tickBar(sp: THREE.Sprite, dt: number) {
  const d = sp.userData.bar as BarData;
  if (d.trail <= d.pct + 1e-3) return;
  d.trail = Math.max(d.pct, d.trail - dt * 0.6);
  drawBar(d);
}
function drawBar(d: BarData) {
  const key = `${d.pct.toFixed(3)}|${d.trail.toFixed(3)}`;
  if (key === d.drawn) return;
  d.drawn = key;
  const ctx = d.canvas.getContext('2d')!;
  ctx.clearRect(0, 0, BW, BH);
  const x0 = 4, y0 = 6, w = BW - 8, h = BH - 12, r = h / 2;
  // soft shadow + dark track
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 5;
  ctx.fillStyle = 'rgba(10,9,20,0.78)';
  ctx.beginPath(); ctx.roundRect(x0, y0, w, h, r); ctx.fill();
  ctx.shadowBlur = 0;
  // damage trail
  if (d.trail > d.pct) {
    ctx.fillStyle = 'rgba(255,236,220,0.85)';
    ctx.beginPath(); ctx.roundRect(x0 + 1, y0 + 1, (w - 2) * d.trail, h - 2, r); ctx.fill();
  }
  if (d.pct > 0.001) {
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    const col = new THREE.Color(d.color);
    g.addColorStop(0, `#${col.clone().offsetHSL(0, 0, 0.14).getHexString()}`);
    g.addColorStop(1, `#${col.clone().offsetHSL(0, 0, -0.08).getHexString()}`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x0 + 1, y0 + 1, Math.max(h - 2, (w - 2) * d.pct), h - 2, r); ctx.fill();
  }
  // quarter ticks
  ctx.fillStyle = 'rgba(10,9,20,0.55)';
  for (let i = 1; i < 4; i++) ctx.fillRect(x0 + w * i / 4 - 1, y0 + 1, 2, h - 2);
  d.tex.needsUpdate = true;
}

/** Chat bubble with a tail. */
export function bubbleSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `500 30px ${FONT}`;
  ctx.font = font;
  const short = text.length > 60 ? text.slice(0, 58) + '…' : text;
  const w = Math.min(560, Math.max(120, ctx.measureText(short).width + 48));
  c.width = 576; c.height = 100;
  ctx.font = font;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const x0 = (c.width - w) / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
  ctx.fillStyle = 'rgba(18,16,32,0.9)';
  ctx.beginPath();
  ctx.roundRect(x0, 12, w, 62, 18);
  ctx.moveTo(c.width / 2 - 10, 73); ctx.lineTo(c.width / 2, 90); ctx.lineTo(c.width / 2 + 10, 73);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(190,180,245,0.45)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x0 + 1, 13, w - 2, 60, 17); ctx.stroke();
  ctx.fillStyle = '#f1edfa';
  ctx.fillText(short, c.width / 2, 44, w - 30);
  const sp = spriteFrom(c, 3.2, 0.556);
  sp.renderOrder = 11;
  return sp;
}
