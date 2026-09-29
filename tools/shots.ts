// Visual test rig: boots two headless clients against a running server, walks them
// into a set of levels and saves screenshots from player A's view (player B stands
// in frame so avatars are covered too).
// Usage: PORT=8080 tsx server/index.ts &  then  tsx tools/shots.ts [outDir] [level ...]
// Env: BASE_URL (default http://127.0.0.1:8080), QUALITY=low|medium|high (default high),
//      SOLO=1 (one client only — cheaper; co-op levels are skipped since they need two)
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const OUT = process.argv[2] ?? 'shots';
const ONLY = process.argv.slice(3);
const W = 1280, H = 720;
const QUALITY = process.env.QUALITY ?? 'high';
const SOLO = process.env.SOLO === '1';
const SOLO_LEVELS = new Set(['nexus', 'atrium-01', 'proving-01']);

type Api = { enterLevel(id: string): void; warp(x: number, y: number, z: number): void; look(yaw: number, pitch?: number): void; pos(): number[] };
const api = (p: Page) => p.evaluate.bind(p);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// [level, [ [label, pos, yaw, pitch] ... ]]  — pos null = stay at spawn
const PLAN: [string, [string, [number, number, number] | null, number, number][]][] = [
  ['nexus', [['spawn', null, 0, -0.05], ['plaza', [0, 3, 14], 0, -0.25], ['back', null, Math.PI, -0.05]]],
  ['atrium-01', [['spawn', null, 0, -0.05]]],
  ['proving-01', [['spawn', null, 0, -0.05]]],
  ['gardens-02', [['spawn', null, 0, -0.05]]],
  ['vaults-01', [['spawn', null, 0, -0.05]]],
  ['observatory-02', [['spawn', null, 0, -0.05]]],
];

async function boot(page: Page, name: string) {
  await page.goto(BASE);
  await page.fill('#intro-name', name);
  // boot is main-thread heavy under software GL — click async so we don't stall on it
  await page.evaluate(() => { setTimeout(() => (document.getElementById('intro-go') as HTMLButtonElement).click(), 0); });
  await page.waitForFunction(() => !!(window as unknown as { __threshold?: unknown }).__threshold, null, { timeout: 120000, polling: 500 });
  await sleep(2500);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const mk = async (name: string) => {
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript((q) => localStorage.setItem('t-quality', q), QUALITY);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] console`, m.text()); });
    await boot(page, name);
    return page;
  };
  const a = await mk('Aster');
  const b = SOLO ? null : await mk('Brin');
  for (const [level, views] of PLAN) {
    if (ONLY.length && !ONLY.includes(level)) continue;
    if (SOLO && !SOLO_LEVELS.has(level)) continue;
    const both = b ? [a, b] : [a];
    if (level !== 'nexus') {
      for (const p of both) await api(p)((id: string) => ((window as unknown as { __threshold: Api }).__threshold).enterLevel(id), level);
      await sleep(5000);
    }
    for (const [label, pos, yaw, pitch] of views) {
      await api(a)(([pos, yaw, pitch]) => {
        const t = (window as unknown as { __threshold: Api }).__threshold;
        if (pos) t.warp(pos[0], pos[1], pos[2]);
        t.look(yaw as number, pitch as number);
      }, [pos, yaw, pitch] as const);
      // park B a few metres in front of A so the avatar is in shot
      const ap = await api(a)(() => (window as unknown as { __threshold: Api }).__threshold.pos());
      if (b) await api(b)(([x, y, z, yaw]) => {
        const t = (window as unknown as { __threshold: Api }).__threshold;
        t.warp(x - Math.sin(yaw) * 4 + 1, y, z - Math.cos(yaw) * 4); t.look(yaw + Math.PI * 0.8, 0);
      }, [ap[0], ap[1], ap[2], yaw] as const);
      await sleep(2500);
      const file = join(OUT, `${level}-${label}.png`);
      // software GL on the high tier can take well over the 30 s default per frame
      await a.screenshot({ path: file, timeout: 180_000 });
      console.log('saved', file);
    }
    if (level !== 'nexus') {
      for (const p of both) await api(p)(() => (window as unknown as { __threshold: { leave(): void } }).__threshold.leave());
      await sleep(3000);
    }
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
