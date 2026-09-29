// Title-screen backdrop: a self-contained 2D-canvas vista of the game's world —
// night sky with twinkling stars, aurora bands, drifting islands with lit lamps and
// a slow portal vortex behind the title, tinted by the chosen accent. Gentle
// pointer parallax. No dependency on the renderer (it runs before the game boots);
// stops when the title screen goes, and draws one still frame under reduced motion.
export interface Backdrop { setAccent(hex: string): void; stop(): void }

export function startBackdrop(canvas: HTMLCanvasElement, accent: string, reduceMotion: boolean): Backdrop {
  const ctx = canvas.getContext('2d');
  let running = true, raf = 0;
  let acc = accent;
  if (!ctx) return { setAccent() { /* no-op */ }, stop() { running = false; } };
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let w = 0, h = 0;
  const fit = () => {
    w = canvas.clientWidth || innerWidth; h = canvas.clientHeight || innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion && running) draw(0);
  };

  // deterministic pseudo-random so the composition is stable between loads
  let seed = 7;
  const rnd = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };
  const stars = Array.from({ length: 160 }, () => ({ x: rnd(), y: rnd(0, 0.85), z: rnd(0.25, 1), tw: rnd(0, 6.28), spd: rnd(0.2, 1) }));
  const islands = [
    { x: 0.12, y: 0.7, s: 1.35, ph: 0.5 }, { x: 0.86, y: 0.62, s: 1.1, ph: 2.2 },
    { x: 0.28, y: 0.88, s: 0.8, ph: 4.0 }, { x: 0.7, y: 0.9, s: 1.0, ph: 1.3 },
    { x: 0.95, y: 0.84, s: 0.6, ph: 3.1 },
  ];
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  const onMove = (e: PointerEvent) => { tmx = e.clientX / w - 0.5; tmy = e.clientY / h - 0.5; };

  const rgba = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  function draw(tms: number) {
    if (!ctx) return;
    const t = tms / 1000;
    mx += (tmx - mx) * 0.04; my += (tmy - my) * 0.04;
    // night sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#12101f'); sky.addColorStop(0.55, '#1d1a33'); sky.addColorStop(1, '#100e1b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    // stars (nearer ones parallax more)
    for (const s of stars) {
      const a = 0.3 + 0.5 * s.z * (0.6 + 0.4 * Math.sin(t * s.spd + s.tw));
      ctx.fillStyle = `rgba(222,226,255,${a.toFixed(3)})`;
      const r = 0.4 + s.z * 1.1;
      ctx.fillRect(s.x * w - mx * 24 * s.z, s.y * h - my * 14 * s.z, r, r);
    }
    // aurora bands
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      const baseY = h * (0.2 + b * 0.16) - my * 10;
      ctx.moveTo(0, baseY);
      for (let x = 0; x <= w + 24; x += 24)
        ctx.lineTo(x, baseY + Math.sin(x * 0.0018 + t * 0.12 + b * 2.1) * 46 + Math.sin(x * 0.0007 - t * 0.07) * 70);
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = b === 0 ? 'rgba(107,91,149,0.10)' : b === 1 ? rgba(acc, 0.05) : 'rgba(255,158,203,0.04)';
      ctx.fill();
    }
    // portal vortex behind the logo: soft core + counter-rotating arc rings + a slow dashed halo
    const px = w / 2 - mx * 12, py = h * 0.3 - my * 8, pr = Math.min(w, h) * 0.22;
    const glow = ctx.createRadialGradient(px, py, pr * 0.1, px, py, pr * 1.6);
    glow.addColorStop(0, rgba(acc, 0.16)); glow.addColorStop(0.6, 'rgba(255,158,203,0.04)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(px - pr * 1.7, py - pr * 1.7, pr * 3.4, pr * 3.4);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ringCol = [rgba(acc, 0.38), 'rgba(255,158,203,0.22)', 'rgba(201,168,255,0.18)'];
    for (let ring = 0; ring < 3; ring++) {
      const rr = pr * (0.55 + ring * 0.22);
      const rot = t * (0.1 + ring * 0.06) * (ring % 2 ? -1 : 1);
      ctx.strokeStyle = ringCol[ring];
      ctx.lineWidth = 2 - ring * 0.5;
      for (let i = 0; i < 5; i++) {
        const a0 = rot + (i / 5) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(px, py, rr, a0, a0 + Math.PI * 0.26); ctx.stroke();
      }
    }
    ctx.strokeStyle = rgba(acc, 0.16); ctx.lineWidth = 1;
    ctx.setLineDash([2, 10]); ctx.lineDashOffset = -t * 8;
    ctx.beginPath(); ctx.arc(px, py, pr * 1.35, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // floating islands: slab + drift-rock cone + accent rim + lamp
    for (const is of islands) {
      const bob = Math.sin(t * 0.4 + is.ph) * 6 * is.s;
      const ix = is.x * w - mx * 50 * is.s, iy = is.y * h + bob - my * 24 * is.s, sw = 130 * is.s;
      ctx.fillStyle = '#1c1830';
      ctx.beginPath(); ctx.ellipse(ix, iy, sw, 16 * is.s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(ix - sw * 0.7, iy + 6 * is.s); ctx.lineTo(ix, iy + 95 * is.s); ctx.lineTo(ix + sw * 0.7, iy + 6 * is.s);
      ctx.closePath(); ctx.fillStyle = '#16132a'; ctx.fill();
      ctx.strokeStyle = rgba(acc, 0.28); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(ix, iy - 3 * is.s, sw * 0.92, 12 * is.s, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      const lampA = 0.5 + Math.sin(t * 1.3 + is.ph * 3) * 0.2;
      ctx.fillStyle = `rgba(255,217,138,${lampA.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(ix + sw * 0.4, iy - 14 * is.s, 3 * is.s, 0, Math.PI * 2); ctx.fill();
    }
  }

  fit();
  addEventListener('resize', fit);
  if (!reduceMotion) {
    addEventListener('pointermove', onMove);
    const loop = (tms: number) => { if (!running) return; draw(tms); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  } else draw(0);
  return {
    setAccent(hex) { acc = hex; if (reduceMotion) draw(0); },
    stop() {
      running = false; cancelAnimationFrame(raf);
      removeEventListener('resize', fit); removeEventListener('pointermove', onMove);
    },
  };
}
